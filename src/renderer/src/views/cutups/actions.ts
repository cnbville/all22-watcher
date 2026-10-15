import { useSyncExternalStore } from 'react'
import type { Cutup, CutupFocus, CutupSummary, PlayRef, PlayRule } from '@shared/types'
import { api } from '../../api'
import { banner, errorBanner } from '../../shell/Banners'
import { action, type MenuAction, sep } from '../../shell/contextMenus'
import { back, historyState, links, navigate, routeNow } from '../../shell/router'
import { readLocal } from '../shared/hooks'
import { requestExportVideo } from '../shared/requests'

/**
 * Cut-up actions shared by the sidebar, the Cut-ups screen, Home and the cut-up screen (03 §9.7, §10.3): the rules
 * sheet request, the context menu, delete, duplicate, export and adding plays with an undoable banner.
 */

// ── The rules sheet (one at a time, mounted by the analysis host) ──────────

export interface RulesSheetRequest {
  /** new: "New Smart Cut-up"; edit: "Edit Rules"; filters: "Save as Cut-up" (with the Keep radios). */
  mode: 'new' | 'edit' | 'filters'
  cutup?: Cutup
  /** A template id to apply first (Cut-ups screen tiles). */
  template?: string
  name?: string
  rules?: PlayRule[]
  focus?: CutupFocus | null
  /** filters: the listed plays, for "Fixed: just these 23 plays". */
  fixedPlays?: PlayRef[]
}

let sheet: RulesSheetRequest | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

export function openRulesSheet(req: RulesSheetRequest) {
  sheet = req
  changed()
}

export function closeRulesSheet() {
  sheet = null
  changed()
}

export function useRulesSheet(): RulesSheetRequest | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => sheet
  )
}

/** ⌥⌘N, ⌥-click on New, a template tile. */
export function newSmartCutup(template?: string) {
  openRulesSheet({ mode: 'new', template })
}

export async function editRules(id: string) {
  const c = (await api.cutups().catch(() => [])).find((x) => x.cutup.id === id)?.cutup
  if (c?.kind === 'smart') openRulesSheet({ mode: 'edit', cutup: c })
}

// ── Plays in and out ──────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const keyOf = (r: PlayRef) => `${r.gameId}:${r.playId}`

/** Adds plays to a manual cut-up with the §9.5 banners and Undo. */
export async function addPlaysTo(id: string, name: string, plays: PlayRef[]) {
  try {
    const before = await api.cutup(id)
    const had = new Set((before?.items ?? []).map((i) => keyOf(i.ref)))
    const fresh = plays.filter((p) => !had.has(keyOf(p)))
    const r = await api.addToCutup(id, plays)
    if (!r.added) {
      banner({ title: `Already in “${name}”` })
      return
    }
    banner({
      title: `Added ${plural(r.added, 'play')} to “${name}”`,
      body: r.already ? `${r.already} ${r.already === 1 ? 'was' : 'were'} already in it.` : undefined,
      action: { label: 'Undo', run: () => void api.removeFromCutup(id, fresh).catch((e) => errorBanner('Couldn’t undo', e)) }
    })
  } catch (e) {
    errorBanner('Couldn’t add to the cut-up', e)
  }
}

/** "New Cut-up…" in the popover, "New Cut-up with This Play" in the menu. */
export async function newCutupWith(plays: PlayRef[], name?: string) {
  try {
    const c = await api.createCutup({ kind: 'manual', name: name?.trim().slice(0, 80) || undefined, plays })
    banner({
      title: `Added ${plural(plays.length, 'play')} to new cut-up “${c.name}”`,
      action: { label: 'Open', run: () => navigate(links.cutup(c.id)) }
    })
    return c
  } catch (e) {
    errorBanner('Couldn’t create the cut-up', e)
    return null
  }
}

// ── Manage ────────────────────────────────────────────────────────────────

export async function confirmDeleteCutup(c: Pick<CutupSummary, 'cutup'>) {
  const ok = await window.shell.confirm({
    message: `Delete “${c.cutup.name}”?`,
    detail: 'The plays and their grades stay in your film. This can’t be undone.',
    confirmLabel: 'Delete'
  })
  if (!ok) return
  try {
    await api.deleteCutup(c.cutup.id)
    // The cut-up on screen goes away: Back, or Home without history (03 §9.7).
    const r = routeNow()
    if (r.path[0] === 'cutup' && r.path[1] === c.cutup.id) {
      if (historyState().index > 0) back()
      else navigate(links.home(), { replace: true })
    }
  } catch (e) {
    errorBanner('Couldn’t delete the cut-up', e)
  }
}

export async function duplicateCutup(id: string, asManual = false) {
  try {
    await api.duplicateCutup(id, asManual)
  } catch (e) {
    errorBanner('Couldn’t duplicate the cut-up', e)
  }
}

/** Export Video for a whole cut-up (context menus, tiles). The cut-up screen passes its own choices. */
export async function exportCutup(id: string) {
  try {
    const d = await api.cutup(id)
    if (!d) return
    const plays = d.items.map((i) => i.ref)
    requestExportVideo({ kind: 'cutup', cutupId: id, plays }, d.cutup.name, {
      choices: [{ key: 'whole', label: `Whole Cut-up (${plays.length})`, plays }],
      playerId: d.cutup.focus?.playerId ?? null,
      angle: readLocal(`ui.cutup.${id}.angle`, 'sideline')
    })
  } catch (e) {
    errorBanner('Couldn’t open Export Video', e)
  }
}

/** The Cut-up context menu (03 §10.3). */
export function cutupMenu(c: Pick<CutupSummary, 'cutup'>, rename: () => void): MenuAction[] {
  const smart = c.cutup.kind === 'smart'
  const id = c.cutup.id
  return [
    action('Play', () => navigate(`${links.cutup(id)}?play=1`)),
    sep(),
    action('Rename', rename, { accelerator: 'Enter' }),
    action('Duplicate', () => void duplicateCutup(id)),
    ...(smart ? [action('Duplicate as Fixed Cut-up', () => void duplicateCutup(id, true)), action('Edit Rules…', () => openRulesSheet({ mode: 'edit', cutup: c.cutup }))] : []),
    sep(),
    action('Export Video…', () => void exportCutup(id), { accelerator: 'CmdOrCtrl+E' }),
    sep(),
    action('Delete Cut-up…', () => void confirmDeleteCutup(c), { accelerator: 'Backspace' })
  ]
}

export { plural }
