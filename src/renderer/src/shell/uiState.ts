import { useSyncExternalStore } from 'react'

/**
 * Shell layout state (01 §1.2, §1.5, §2.4, §2.7): sidebar width and visibility, the current screen's inspector,
 * the toolbar separator and large-title collapse, Film Only, focus and full screen.
 */

export interface ShellUi {
  sidebarWidth: number
  /** The user's choice for library screens. */
  sidebarVisible: boolean
  /** Below 1100 the sidebar overlays the content while shown. */
  narrow: boolean
  overlayOpen: boolean
  /** The current screen's tape-room takeover state (null when not in the tape room). */
  tapeRoomSidebar: 'shown' | 'hidden' | null
  screen: string
  /** The screen declares an inspector. */
  hasInspector: boolean
  inspectorVisible: boolean
  inspectorWidth: number
  scrolled: boolean
  largeTitleVisible: boolean
  filmOnly: boolean
  windowFocused: boolean
  fullScreen: boolean
  quickOpen: boolean
  shortcuts: { open: boolean; filter?: string }
  welcome: boolean
}

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable; layout just won't be remembered.
  }
}

let state: ShellUi = {
  sidebarWidth: clamp(Number(read('ui.sidebar.width', '240')) || 240, 200, 320),
  sidebarVisible: read('ui.sidebar.visible', 'true') !== 'false',
  narrow: typeof window !== 'undefined' && window.innerWidth < 1100,
  overlayOpen: false,
  tapeRoomSidebar: null,
  screen: '',
  hasInspector: false,
  inspectorVisible: true,
  inspectorWidth: 320,
  scrolled: false,
  largeTitleVisible: true,
  filmOnly: false,
  windowFocused: typeof document !== 'undefined' ? document.hasFocus() : true,
  fullScreen: false,
  quickOpen: false,
  shortcuts: { open: false },
  welcome: false
}

const listeners = new Set<() => void>()

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

export function ui(): ShellUi {
  return state
}

export function setUi(patch: Partial<ShellUi>) {
  let changed = false
  for (const k of Object.keys(patch) as (keyof ShellUi)[]) {
    if (state[k] !== patch[k]) changed = true
  }
  if (!changed) return
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function subscribeUi(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useUi(): ShellUi {
  return useSyncExternalStore(subscribeUi, ui)
}

/** Whether the sidebar is showing right now, all rules applied. */
export function sidebarShown(s: ShellUi = state): boolean {
  if (s.filmOnly) return false
  if (s.tapeRoomSidebar) return s.tapeRoomSidebar === 'shown'
  if (s.narrow) return s.overlayOpen
  return s.sidebarVisible
}

export function toggleSidebar() {
  const s = state
  if (s.tapeRoomSidebar) {
    const next = s.tapeRoomSidebar === 'shown' ? 'hidden' : 'shown'
    persist('ui.tapeRoom.sidebar', next)
    setUi({ tapeRoomSidebar: next })
  } else if (s.narrow) {
    setUi({ overlayOpen: !s.overlayOpen })
  } else {
    persist('ui.sidebar.visible', String(!s.sidebarVisible))
    setUi({ sidebarVisible: !s.sidebarVisible })
  }
}

export function setSidebarWidth(w: number) {
  const width = clamp(Math.round(w), 200, 320)
  persist('ui.sidebar.width', String(width))
  setUi({ sidebarWidth: width })
}

/** Inspector visibility and width persist per screen (01 §2.7). */
export function loadInspector(screen: string, defaultWidth = 320, min = 260) {
  const width = clamp(Number(read(`ui.inspector.${screen}.width`, String(defaultWidth))) || defaultWidth, min, 420)
  const visible = read(`ui.inspector.${screen}.visible`, 'true') !== 'false'
  setUi({ inspectorWidth: width, inspectorVisible: visible })
}

export function toggleInspector() {
  const visible = !state.inspectorVisible
  persist(`ui.inspector.${state.screen}.visible`, String(visible))
  setUi({ inspectorVisible: visible })
}

export function setInspectorWidth(w: number, min = 260) {
  const width = clamp(Math.round(w), min, 420)
  persist(`ui.inspector.${state.screen}.width`, String(width))
  setUi({ inspectorWidth: width })
}

export function readTapeRoomSidebar(): 'shown' | 'hidden' {
  return read('ui.tapeRoom.sidebar', 'hidden') === 'shown' ? 'shown' : 'hidden'
}
