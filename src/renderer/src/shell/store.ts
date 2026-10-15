import { useSyncExternalStore } from 'react'
import type { DataProgress, SeasonStatus, Settings } from '@shared/types'
import { api, afterApi, rawApi } from '../api'
import { emit, onDataEvent } from './dataEvents'

/**
 * Small app-wide stores the shell owns: settings (with My Teams), the season list, the global season (01 §1.3)
 * and season downloads. Each is a plain external store read with useSyncExternalStore.
 */

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T) {
      value = next
      listeners.forEach((l) => l())
    },
    subscribe(cb: () => void) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}

// ── Settings ────────────────────────────────────────────────────────────────

const settingsStore = store<Settings | null>(null)

export async function refreshSettings(): Promise<Settings> {
  const s = await rawApi.settings()
  settingsStore.set(s)
  return s
}

export function useSettings(): Settings | null {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.get)
}

export function settingsNow(): Settings | null {
  return settingsStore.get()
}

/** Saves and applies at once; every window hears about it (the api wrapper broadcasts). */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const prev = settingsStore.get()
  if (prev) settingsStore.set({ ...prev, ...patch })
  const s = await api.saveSettings(patch)
  settingsStore.set(s)
  return s
}

// ── My Teams (01 §1.2) ─────────────────────────────────────────────────────

export function useMyTeams(): string[] {
  return useSettings()?.myTeams ?? EMPTY
}
const EMPTY: string[] = []

export async function addMyTeam(abbr: string) {
  const s = settingsStore.get() ?? (await refreshSettings())
  if (s.myTeams.includes(abbr)) return
  await saveSettings({ myTeams: [...s.myTeams, abbr], myTeamsRemoved: (s.myTeamsRemoved ?? []).filter((t) => t !== abbr) })
}

export async function removeMyTeam(abbr: string) {
  const s = settingsStore.get() ?? (await refreshSettings())
  await saveSettings({
    myTeams: s.myTeams.filter((t) => t !== abbr),
    myTeamsRemoved: [...new Set([...(s.myTeamsRemoved ?? []), abbr])]
  })
}

export async function reorderMyTeams(order: string[]) {
  await saveSettings({ myTeams: order })
}

/** Added the first time film is imported for a team or one of its players is graded, unless removed before. */
async function autoAddMyTeam(abbr: string | undefined) {
  if (!abbr) return
  const s = settingsStore.get() ?? (await refreshSettings())
  if (s.myTeams.includes(abbr) || (s.myTeamsRemoved ?? []).includes(abbr)) return
  await saveSettings({ myTeams: [...s.myTeams, abbr] })
}

afterApi('importClips', (args) => void autoAddMyTeam(args[1] as string))
afterApi('saveGrade', (args) => {
  const entry = args[0] as { team?: string; grade?: number | null }
  if (entry?.grade !== null && entry?.grade !== undefined) void autoAddMyTeam(entry.team)
})

// ── Seasons ─────────────────────────────────────────────────────────────────

const seasonsStore = store<SeasonStatus[] | null>(null)

export async function refreshSeasons(): Promise<SeasonStatus[]> {
  const list = await rawApi.seasons()
  seasonsStore.set(list)
  return list
}

export function useSeasons(): SeasonStatus[] | null {
  return useSyncExternalStore(seasonsStore.subscribe, seasonsStore.get)
}

// ── Global season (01 §1.3) ────────────────────────────────────────────────

const SEASON_KEY = 'ui.season'

function storedSeason(): number | null {
  try {
    // v1 kept the season under 'season'; carry it over until v2 saves its own.
    const v = Number(localStorage.getItem(SEASON_KEY) ?? localStorage.getItem('season'))
    return v > 2000 ? v : null
  } catch {
    return null
  }
}

const seasonStore = store<number | null>(storedSeason())
const seasonListeners = new Set<(season: number, prev: number | null) => void>()

/** Default: the newest downloaded season, else the newest season. */
export function defaultSeason(list: SeasonStatus[]): number {
  return (list.find((s) => s.downloaded) ?? list[0])?.season ?? new Date().getFullYear()
}

export function setSeason(season: number) {
  const prev = seasonStore.get()
  if (prev === season) return
  seasonStore.set(season)
  try {
    localStorage.setItem(SEASON_KEY, String(season))
  } catch {
    // Storage can be unavailable; the season just won't be remembered.
  }
  seasonListeners.forEach((l) => l(season, prev))
}

export function onSeasonChange(cb: (season: number, prev: number | null) => void): () => void {
  seasonListeners.add(cb)
  return () => seasonListeners.delete(cb)
}

export function seasonNow(): number | null {
  return seasonStore.get()
}

export function useGlobalSeason(): number | null {
  return useSyncExternalStore(seasonStore.subscribe, seasonStore.get)
}

/** v1-compatible hook: the global season and its setter, plus the season list. */
export function useSeason(): { season: number | null; setSeason: (s: number) => void; seasons: SeasonStatus[] | null; downloaded: boolean } {
  const season = useGlobalSeason()
  const seasons = useSeasons()
  const downloaded = !!seasons?.find((s) => s.season === season)?.downloaded
  return { season, setSeason, seasons, downloaded }
}

// ── Season downloads ───────────────────────────────────────────────────────

export interface DownloadState {
  season: number
  progress: DataProgress | null
  error: unknown
  busy: boolean
}

const downloads = store<Record<number, DownloadState>>({})

function patchDownload(season: number, patch: Partial<DownloadState>) {
  const cur = downloads.get()[season] ?? { season, progress: null, error: null, busy: false }
  downloads.set({ ...downloads.get(), [season]: { ...cur, ...patch } })
}

let progressHooked = false
function hookProgress() {
  if (progressHooked || !rawApi?.onDataProgress) return
  progressHooked = true
  rawApi.onDataProgress((p) => {
    patchDownload(p.season, { progress: p })
    if (p.total) window.shell?.setDockProgress(p.done / p.total)
  })
}

export async function downloadSeason(season: number): Promise<boolean> {
  hookProgress()
  if (downloads.get()[season]?.busy) return false
  patchDownload(season, { busy: true, error: null, progress: null })
  try {
    await api.downloadSeason(season)
    await refreshSeasons()
    patchDownload(season, { busy: false, progress: null })
    return true
  } catch (error) {
    patchDownload(season, { busy: false, error, progress: null })
    return false
  } finally {
    window.shell?.setDockProgress(-1)
  }
}

export function useDownload(season: number | null): DownloadState | null {
  const all = useSyncExternalStore(downloads.subscribe, downloads.get)
  return season === null ? null : all[season] ?? null
}

export function anyDownload(): DownloadState | undefined {
  return Object.values(downloads.get()).find((d) => d.busy)
}

// ── Wiring ──────────────────────────────────────────────────────────────────

let started = false
/** Loads settings and seasons and keeps them fresh. Called once by each window's root. */
export function startStores() {
  if (started) return
  started = true
  hookProgress()
  void refreshSettings()
  void refreshSeasons().then((list) => {
    if (seasonStore.get() === null || !list.some((s) => s.season === seasonStore.get())) setSeason(defaultSeason(list))
  })
  window.shell?.onSettingsChanged(() => {
    void refreshSettings().then(() => emit('settings'))
  })
  // Main changes settings itself too (My Teams after a watch-folder import, Choose Watch Folder), without a broadcast.
  rawApi?.onApiEvent?.((e) => {
    if (e.type === 'changed' && e.kinds.includes('settings')) void refreshSettings()
  })
  onDataEvent('season', () => void refreshSeasons())
}
