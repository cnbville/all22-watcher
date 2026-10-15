import type { Activity, GameInfo, PositionGroup, RecentFilm, SeasonStatus } from '@shared/types'
import { TEAMS } from '@shared/teams'
import { rawApi } from '../api'

/**
 * Typed adapters for data APIs another branch adds (03 §2.2.2, §9.2; 01 §1.2, §6.24). Each calls
 * `window.api.<name>` when the bridge has it and otherwise returns an empty or derived result, so the shell runs
 * before that work is merged. The shapes match the data branch's types; once merged these can import them.
 */

type Loose = Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>
const bridge = () => rawApi as unknown as Loose
export const has = (name: string) => typeof bridge()[name] === 'function'
function call<T>(name: string, ...args: unknown[]): Promise<T> {
  return bridge()[name]!(...args) as Promise<T>
}

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface DataStatus {
  season: number
  state: 'upToDate' | 'updating' | 'notDownloaded' | 'failed'
  downloadedAt: string | null
  hasParticipation: boolean
  step: string | null
  done: number
  total: number
  error: string | null
  autoUpdate: boolean
  inSeason: boolean
}

export interface ImportLogEntry {
  id: number
  folder: string
  gameId: string | null
  team: string | null
  source: 'manual' | 'watch'
  state: 'done' | 'failed'
  clipCount: number
  playCount: number
  suspectClips: number
  error: string | null
  at: string
}

export interface WatchStatus {
  folder: string | null
  folderName: string | null
  state: 'off' | 'watching' | 'importing' | 'missing' | 'paused'
  lastChecked: string | null
  current: { title: string; done: number; total: number } | null
  justImported: number
  recent: ImportLogEntry[]
  unmatched: { folder: string; reason: string }[]
}

export interface SidebarBadges {
  newFilm: number
  teams: Record<string, number>
}

export type CutupKind = 'manual' | 'smart'
export interface CutupSummary {
  cutup: { id: string; name: string; kind: CutupKind; sort: number }
  playCount: number
  gameCount: number
  duration: number
  withoutFilm: number
}

export interface SearchIndex {
  season: number
  teams: { abbr: string; name: string; nickname: string; division: string; wins: number; losses: number; ties: number }[]
  players: { id: string; name: string; team: string; position: string; group: PositionGroup; jersey: string; headshot: string; season: number; graded: number }[]
  games: (Pick<GameInfo, 'gameId' | 'season' | 'week' | 'gameType' | 'gameday' | 'homeTeam' | 'awayTeam'> & {
    clipCount: number
    playCount: number
    gradedPlays: number
    studiedTeam: string | null
  })[]
  cutups: { id: string; name: string; kind: CutupKind; playCount: number }[]
}

export type DataKind = 'grades' | 'notes' | 'film' | 'cutups' | 'season' | 'settings'
export type ApiEvent =
  | { type: 'activity'; activity: Activity }
  | { type: 'dataStatus'; status: DataStatus }
  | { type: 'watchStatus'; status: WatchStatus }
  | { type: 'changed'; kinds: DataKind[] }

// ── Adapters ──────────────────────────────────────────────────────────────────

/** Sidebar footer data row. Fallback: derived from `seasons()`. */
export async function dataStatus(season: number): Promise<DataStatus> {
  if (has('dataStatus')) return call<DataStatus>('dataStatus', season)
  const all = await rawApi.seasons()
  const s = all.find((x) => x.season === season)
  return {
    season,
    state: s?.downloaded ? 'upToDate' : 'notDownloaded',
    downloadedAt: s?.downloadedAt ?? null,
    hasParticipation: s?.hasParticipation ?? false,
    step: null,
    done: 0,
    total: 0,
    error: null,
    autoUpdate: false,
    inSeason: false
  }
}

/** File › Update Season Data. Fallback: downloads the season again. */
export async function updateSeasonNow(season: number): Promise<void> {
  if (has('updateSeasonNow')) await call('updateSeasonNow', season)
  else await rawApi.downloadSeason(season)
}

/** Sidebar footer watch row. Fallback: no watch folder (the row stays hidden). */
export async function watchStatus(): Promise<WatchStatus | null> {
  if (!has('watchStatus')) return null
  return call<WatchStatus>('watchStatus')
}

export async function checkWatchFolder(): Promise<void> {
  if (has('checkWatchFolder')) await call('checkWatchFolder')
}

/**
 * Film and My Teams badges. Fallback: no Film badge (v1 has no "opened" flag), and per team the games of this
 * season with film that still have ungraded plays, from `teamOverview`.
 */
export async function sidebarBadges(season: number, myTeams: string[]): Promise<SidebarBadges> {
  if (has('sidebarBadges')) return call<SidebarBadges>('sidebarBadges', season)
  const teams: Record<string, number> = {}
  await Promise.all(
    myTeams.map(async (abbr) => {
      try {
        const o = await rawApi.teamOverview(season, abbr)
        teams[abbr] = o.games.filter((g) => g.clipCount > 0 && g.gradedPlays < g.playCount).length
      } catch {
        teams[abbr] = 0
      }
    })
  )
  return { newFilm: 0, teams }
}

/** Every cut-up in sidebar order. Fallback: none. */
export async function cutups(): Promise<CutupSummary[]> {
  if (!has('cutups')) return []
  return call<CutupSummary[]>('cutups')
}

export const cutupsAvailable = () => has('createCutup')

export async function createCutup(input: { name?: string; kind: CutupKind }): Promise<{ id: string; name: string } | null> {
  if (!has('createCutup')) return null
  return call<{ id: string; name: string }>('createCutup', input)
}

export async function updateCutup(id: string, patch: { name?: string }): Promise<void> {
  if (has('updateCutup')) await call('updateCutup', id, patch)
}

export async function deleteCutup(id: string): Promise<void> {
  if (has('deleteCutup')) await call('deleteCutup', id)
}

export async function duplicateCutup(id: string, asManual?: boolean): Promise<{ id: string } | null> {
  if (!has('duplicateCutup')) return null
  return call<{ id: string }>('duplicateCutup', id, asManual)
}

export async function addToCutup(id: string, plays: { gameId: string; playId: number }[]): Promise<{ added: number; already: number }> {
  if (!has('addToCutup')) return { added: 0, already: 0 }
  return call<{ added: number; already: number }>('addToCutup', id, plays)
}

export async function reorderCutups(ids: string[]): Promise<void> {
  if (has('reorderCutups')) await call('reorderCutups', ids)
}

/** Running activities, for the footer and Dock after a reload. Fallback: none. */
export async function activities(): Promise<Activity[]> {
  if (!has('activities')) return []
  return call<Activity[]>('activities')
}

export async function cancelActivity(id: string): Promise<void> {
  if (has('cancelActivity')) await call('cancelActivity', id)
}

/** Main → renderer push events. Fallback: nothing arrives (the shell polls instead). */
export function onApiEvent(cb: (e: ApiEvent) => void): () => void {
  const fn = (rawApi as unknown as { onApiEvent?: (cb: (e: ApiEvent) => void) => () => void }).onApiEvent
  return typeof fn === 'function' ? fn(cb) : () => {}
}

export const apiEventsAvailable = () => typeof (rawApi as unknown as { onApiEvent?: unknown }).onApiEvent === 'function'

/**
 * Quick Open's index (01 §6.24). Fallback: the 32 teams with their records, games from recent film, and the
 * rosters of My Teams (from `teamOverview`).
 */
export async function searchIndex(season: number, myTeams: string[]): Promise<SearchIndex> {
  if (has('searchIndex')) return call<SearchIndex>('searchIndex', season)
  const [summaries, recent, cuts] = await Promise.all([
    rawApi.teamSummaries(season).catch(() => []),
    rawApi.recentFilm().catch((): RecentFilm[] => []),
    cutups()
  ])
  const record = new Map(summaries.map((s) => [s.team, s]))
  const teams = TEAMS.map((t) => {
    const s = record.get(t.abbr)
    return { abbr: t.abbr, name: t.name, nickname: t.nickname, division: t.division, wins: s?.wins ?? 0, losses: s?.losses ?? 0, ties: s?.ties ?? 0 }
  })
  const players: SearchIndex['players'] = []
  for (const abbr of myTeams) {
    try {
      const o = await rawApi.teamOverview(season, abbr)
      for (const p of o.roster) {
        players.push({ id: p.id, name: p.name, team: p.team, position: p.position, group: p.group, jersey: p.jersey, headshot: p.headshot, season, graded: p.tally.graded })
      }
    } catch {
      // A season that is not downloaded has no rosters.
    }
  }
  const games = recent.map((r) => ({
    gameId: r.game.gameId,
    season: r.game.season,
    week: r.game.week,
    gameType: r.game.gameType,
    gameday: r.game.gameday,
    homeTeam: r.game.homeTeam,
    awayTeam: r.game.awayTeam,
    clipCount: r.clipCount,
    playCount: r.playCount,
    gradedPlays: r.gradedPlays,
    studiedTeam: r.team
  }))
  return { season, teams, players, games, cutups: cuts.map((c) => ({ id: c.cutup.id, name: c.cutup.name, kind: c.cutup.kind, playCount: c.playCount })) }
}

export type { SeasonStatus }
