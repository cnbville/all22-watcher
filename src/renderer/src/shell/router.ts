import { useSyncExternalStore } from 'react'
import type { PositionGroup } from '@shared/types'
import type { SettingsPane } from '@shared/shell'

/**
 * The hash router with its own history stack (01 §1.4.2), so the toolbar and Go menu always know whether
 * Back/Forward are possible. location.hash mirrors the current entry through history.replaceState.
 */

export interface Route {
  path: string[]
  query: URLSearchParams
  /** The route string, e.g. '/team/2025/PHI'. */
  raw: string
}

export interface HistoryEntry {
  route: string
  title: string
  sidebarKey: string
  scrollTop: number
  selection?: string
}

interface HistoryState {
  entries: HistoryEntry[]
  index: number
  /** How the current entry was reached: screens restore scroll and selection only on 'back'/'forward'. */
  via: 'push' | 'replace' | 'back' | 'forward' | 'load'
}

const MAX = 100
const SESSION_KEY = 'ui.history'
const LAST_ROUTE = 'ui.lastRoute'

const listeners = new Set<() => void>()
let state: HistoryState = load()

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function safeSet(store: Storage, key: string, value: string) {
  try {
    store.setItem(key, value)
  } catch {
    // Storage can be unavailable; history just won't survive a reload.
  }
}

function currentHash(): string {
  return window.location.hash.replace(/^#/, '') || '/'
}

/** Routes the main window can show on launch (not the report or the settings window's own routes). */
export function resolves(route: string): boolean {
  const [head] = route.replace(/^\//, '').split(/[/?]/)
  return ['', 'film', 'teams', 'team', 'player', 'leaders', 'matchup', 'cutup', 'cutups'].includes(head)
}

function load(): HistoryState {
  if (typeof window === 'undefined') return { entries: [], index: 0, via: 'load' }
  const hash = currentHash()
  try {
    const saved = JSON.parse(safeGet(sessionStorage, SESSION_KEY) ?? 'null') as { entries: HistoryEntry[]; index: number } | null
    if (saved && saved.entries.length && saved.entries[saved.index]?.route === hash) return { ...saved, via: 'load' }
  } catch {
    // A corrupt mirror starts a fresh stack.
  }
  let start = hash
  if (hash === '/' && !window.location.hash) {
    const last = safeGet(localStorage, LAST_ROUTE)
    if (last && resolves(last)) start = last
  }
  if (start !== hash) window.history.replaceState(null, '', `#${start}`)
  return { entries: [entry(start, undefined)], index: 0, via: 'load' }
}

/** The sidebar item a route highlights (01 §1.1). Player routes inherit from the entry they were opened from. */
export function sidebarKeyFor(route: string, from: string | undefined): string {
  const [path] = route.split('?')
  const parts = path.split('/').filter(Boolean)
  switch (parts[0]) {
    case undefined:
      return 'home'
    case 'film':
      return 'film'
    case 'teams':
      return 'teams'
    case 'team':
      return `team:${parts[2]}`
    case 'leaders':
      return 'leaderboards'
    case 'matchup':
      return 'matchups'
    case 'cutup':
      return `cutup:${parts[1]}`
    case 'cutups':
      return 'cutups'
    default:
      return from ?? 'home'
  }
}

function entry(route: string, from: HistoryEntry | undefined): HistoryEntry {
  return { route, title: '', sidebarKey: sidebarKeyFor(route, from?.sidebarKey), scrollTop: 0 }
}

function commit(next: HistoryState) {
  state = next
  const route = next.entries[next.index].route
  if (currentHash() !== route) window.history.replaceState(null, '', `#${route}`)
  safeSet(sessionStorage, SESSION_KEY, JSON.stringify({ entries: next.entries, index: next.index }))
  if (resolves(route)) safeSet(localStorage, LAST_ROUTE, route)
  listeners.forEach((l) => l())
}

/** Saves the current scroll position on the entry being left. */
function rememberScroll(entries: HistoryEntry[], index: number): HistoryEntry[] {
  const content = document.getElementById('content')
  if (!content || !entries[index]) return entries
  const copy = [...entries]
  copy[index] = { ...copy[index], scrollTop: content.scrollTop }
  return copy
}

let settingsOpener: ((pane: SettingsPane) => void) | null = null
/** The shell routes '/settings…' to the Settings window (01 §1.1). */
export function setSettingsOpener(fn: (pane: SettingsPane) => void) {
  settingsOpener = fn
}

export function navigate(to: string, opts?: { replace?: boolean }) {
  if (to.startsWith('/settings') && settingsOpener) {
    settingsOpener((to.split('/')[2] as SettingsPane) || 'general')
    return
  }
  const cur = state.entries[state.index]
  if (cur?.route === to) return
  if (opts?.replace) {
    const entries = [...state.entries]
    entries[state.index] = entry(to, cur)
    commit({ entries, index: state.index, via: 'replace' })
    return
  }
  const kept = rememberScroll(state.entries, state.index).slice(0, state.index + 1)
  kept.push(entry(to, cur))
  const entries = kept.slice(-MAX)
  commit({ entries, index: entries.length - 1, via: 'push' })
}

export function back() {
  go(state.index - 1, 'back')
}

export function forward() {
  go(state.index + 1, 'forward')
}

/** Jumps to an entry (the Back/Forward history menus). */
export function go(index: number, via: 'back' | 'forward' = index < state.index ? 'back' : 'forward') {
  if (index < 0 || index >= state.entries.length || index === state.index) return
  commit({ entries: rememberScroll(state.entries, state.index), index, via })
}

/** Records the toolbar title on the current entry, for the Back/Forward menus. */
export function setEntryTitle(title: string) {
  const cur = state.entries[state.index]
  if (!cur || cur.title === title) return
  const entries = [...state.entries]
  entries[state.index] = { ...cur, title }
  state = { ...state, entries }
  safeSet(sessionStorage, SESSION_KEY, JSON.stringify({ entries, index: state.index }))
}

/** Records the selected row on the current entry, restored on Back/Forward (01 §1.4.4). */
export function setEntrySelection(selection: string | undefined) {
  const cur = state.entries[state.index]
  if (!cur || cur.selection === selection) return
  const entries = [...state.entries]
  entries[state.index] = { ...cur, selection }
  state = { ...state, entries }
  safeSet(sessionStorage, SESSION_KEY, JSON.stringify({ entries, index: state.index }))
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function historyState(): HistoryState {
  return state
}

export function useHistory(): { canGoBack: boolean; canGoForward: boolean; entries: HistoryEntry[]; index: number; via: HistoryState['via'] } {
  const s = useSyncExternalStore(subscribe, historyState)
  return { canGoBack: s.index > 0, canGoForward: s.index < s.entries.length - 1, entries: s.entries, index: s.index, via: s.via }
}

export function parseRoute(raw: string): Route {
  const [path, qs] = raw.split('?')
  return { path: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs ?? ''), raw }
}

let cachedRaw = ''
let cachedRoute: Route = parseRoute('/')
function currentRoute(): Route {
  const raw = state.entries[state.index]?.route ?? '/'
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedRoute = parseRoute(raw)
  }
  return cachedRoute
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute)
}

export function routeNow(): Route {
  return currentRoute()
}

// Something outside the router changed the hash (a typed URL, a test): treat it as a navigation.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const hash = currentHash()
    if (hash !== state.entries[state.index]?.route) navigate(hash)
  })
}

const enc = encodeURIComponent

export const links = {
  home: () => '/',
  film: () => '/film',
  tape: (gameId: string, team: string, opts?: { play?: number; player?: string; focus?: boolean; angles?: 'both' }) => {
    const q = new URLSearchParams({ team })
    if (opts?.play !== undefined) q.set('play', String(opts.play))
    if (opts?.player) q.set('player', opts.player)
    if (opts?.focus) q.set('focus', '1')
    if (opts?.angles) q.set('angles', opts.angles)
    return `/film/${gameId}?${q.toString()}`
  },
  teams: (season: number) => `/teams/${season}`,
  team: (season: number, abbr: string) => `/team/${season}/${abbr}`,
  player: (season: number, playerId: string, opts?: { section?: string; tokens?: string }) => {
    const q = new URLSearchParams()
    if (opts?.section) q.set('section', opts.section)
    if (opts?.tokens) q.set('tokens', opts.tokens)
    const qs = q.toString()
    return `/player/${season}/${enc(playerId)}${qs ? `?${qs}` : ''}`
  },
  leaders: (season: number, pos: PositionGroup = 'QB') => `/leaders/${season}/${pos}`,
  matchup: (season: number, team?: string, opp?: string) =>
    team && opp ? `/matchup/${season}/${team}/${opp}` : team ? `/matchup/${season}?team=${team}` : `/matchup/${season}`,
  cutups: () => '/cutups',
  cutup: (id: string) => `/cutup/${enc(id)}`,
  report: (season: number, playerId: string) => `/report/${season}/${enc(playerId)}`
}
