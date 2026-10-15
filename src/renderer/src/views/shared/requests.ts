import { useSyncExternalStore } from 'react'
import type { ExportSource } from '@shared/exportVideo'
import type { PlayRef } from '@shared/types'
import { api } from '../../api'
import { banner, errorBanner } from '../../shell/Banners'
import { action, type MenuAction, sep, showMenu } from '../../shell/contextMenus'

/**
 * Hand-offs from the browse screens to UI another part of the app owns: the Add to Cut-up popover (03 §9.5) and
 * the Export Video sheet (03 §11). The owner registers a handler; until one is registered, Add to Cut-up falls back
 * to a native menu of manual cut-ups and Export Video stays disabled.
 */

export interface AddToCutupRequest {
  plays: PlayRef[]
  /** Where the popover should point (a row, a button); null = the cursor or the screen's center. */
  anchor?: Element | DOMRect | null
}

type Handler<T> = (req: T) => void

/**
 * What the Export Video sheet opens with (03 §11.1). `choices` fills the Plays popup ("All Graded Plays (20)",
 * "Shown in the Reel (11)", "Selected Plays (3)"); the first one is the default unless `initial` names another.
 */
export interface ExportSheetRequest {
  source: ExportSource
  /** The sheet's subtitle ("Cooper DeJean · 2025 reel"). */
  title?: string
  choices?: { key: string; label: string; plays: PlayRef[] }[]
  initial?: string
  /** The burned-in player for cut-up and tape-room sources (the page's player always wins for player sources). */
  playerId?: string | null
  /** Default angle: the reel's or cut-up's current one. */
  angle?: 'sideline' | 'endzone' | 'main' | 'sideBySide'
}

let addHandler: Handler<AddToCutupRequest> | null = null
let exportHandler: Handler<ExportSheetRequest> | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

/** The cut-ups owner calls this once; returns an unregister function. */
export function onAddToCutupRequest(handler: Handler<AddToCutupRequest>): () => void {
  addHandler = handler
  changed()
  return () => {
    if (addHandler === handler) addHandler = null
    changed()
  }
}

/** The export owner calls this once; returns an unregister function. */
export function onExportVideoRequest(handler: Handler<ExportSheetRequest>): () => void {
  exportHandler = handler
  changed()
  return () => {
    if (exportHandler === handler) exportHandler = null
    changed()
  }
}

export function hasExportVideoHandler(): boolean {
  return exportHandler !== null
}

/** Whether Export Video can open (for enabling menu items and buttons). */
export function useExportVideoAvailable(): boolean {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => exportHandler !== null
  )
}

export function requestExportVideo(source: ExportSource, title?: string, opts: Omit<ExportSheetRequest, 'source' | 'title'> = {}): boolean {
  if (!exportHandler) return false
  exportHandler({ ...opts, source, title })
  return true
}

/** Add to Cut-up… (⌘D, the Play row menu): the owner's popover, else a native menu of manual cut-ups. */
export async function requestAddToCutup(plays: PlayRef[], anchor?: Element | DOMRect | null, e?: { preventDefault(): void } | null) {
  if (!plays.length) return
  if (addHandler) return addHandler({ plays, anchor: anchor ?? null })
  const items = await addToCutupMenu(plays)
  await showMenu(e ?? null, items)
}

/** The "Add to Cut-up ▸" submenu items: manual cut-ups by name, then "New Cut-up with This Play". */
export async function addToCutupMenu(plays: PlayRef[]): Promise<MenuAction[]> {
  const list = await api.cutups().catch(() => [])
  const manual = list.filter((c) => c.cutup.kind === 'manual')
  const one = plays.length === 1
  return [
    ...manual.map((c) => action(c.cutup.name, () => void addTo(c.cutup.id, c.cutup.name, plays))),
    ...(manual.length ? [sep()] : []),
    action(one ? 'New Cut-up with This Play' : 'New Cut-up with These Plays', () => void newWith(plays))
  ]
}

async function addTo(id: string, name: string, plays: PlayRef[]) {
  try {
    const r = await api.addToCutup(id, plays)
    banner({ title: r.added ? `Added to “${name}”` : `Already in “${name}”` })
  } catch (err) {
    errorBanner('Couldn’t add to the cut-up', err)
  }
}

async function newWith(plays: PlayRef[]) {
  try {
    const c = await api.createCutup({ kind: 'manual', plays })
    banner({ title: `Added to “${c.name}”` })
  } catch (err) {
    errorBanner('Couldn’t create the cut-up', err)
  }
}
