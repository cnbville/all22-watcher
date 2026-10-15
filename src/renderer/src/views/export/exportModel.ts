import { useEffect, useSyncExternalStore } from 'react'
import type { ExportVideoRequest } from '@shared/exportVideo'
import type { Activity } from '@shared/types'
import { rawApi } from '../../api'
import { banner } from '../../shell/Banners'
import { navigate, routeNow } from '../../shell/router'
import { readLocal } from '../shared/hooks'
import { requestExportVideo, type ExportSheetRequest } from '../shared/requests'

/**
 * Export runs in the background (03 §11.7): this store follows main's `export` activities for the sidebar footer
 * row, its popover and the toolbar buttons, keeps finished ones for 10 minutes, and posts the completion banner.
 */

export interface ExportRun {
  activity: Activity
  startedAt: number
  /** When it ended (done, failed or cancelled). */
  endedAt: number | null
  /** What started it, for Try Again. */
  sheet: ExportSheetRequest | null
  request: ExportVideoRequest | null
}

const KEEP_MS = 10 * 60 * 1000
let runs: ExportRun[] = []
let snapshot: ExportRun[] = []
const listeners = new Set<() => void>()
const changed = () => {
  snapshot = [...runs]
  listeners.forEach((l) => l())
}
const pending = new Map<string, { sheet: ExportSheetRequest; request: ExportVideoRequest }>()

/** The sheet calls this right after `startExportVideo` so Try Again can reopen it. */
export function rememberExport(activityId: string, sheet: ExportSheetRequest, request: ExportVideoRequest) {
  const run = runs.find((r) => r.activity.id === activityId)
  if (run) {
    run.sheet = sheet
    run.request = request
    changed()
  } else pending.set(activityId, { sheet, request })
}

function onActivity(a: Activity) {
  if (a.kind !== 'export') return
  const now = Date.now()
  let run = runs.find((r) => r.activity.id === a.id)
  const wasRunning = run ? run.activity.state === 'running' : false
  if (!run) {
    const p = pending.get(a.id)
    pending.delete(a.id)
    run = { activity: a, startedAt: now, endedAt: null, sheet: p?.sheet ?? null, request: p?.request ?? null }
    runs = [...runs, run]
  }
  run.activity = a
  if (a.state !== 'running' && run.endedAt === null) run.endedAt = now
  prune()
  changed()
  if ((wasRunning || run.endedAt === now) && a.state !== 'running') notifyEnd(run)
}

function prune() {
  const now = Date.now()
  // Cancelled runs leave at once; finished ones after 10 minutes.
  runs = runs.filter((r) => r.endedAt === null || (r.activity.state !== 'cancelled' && now - r.endedAt < KEEP_MS))
}

/** "Cooper DeJean reel.mp4" from the activity's title or result. */
export function exportFileName(run: ExportRun): string {
  if (run.activity.resultPath) return run.activity.resultPath.split(/[\\/]/).pop() ?? ''
  const m = /“(.+)”/.exec(run.activity.title)
  return m ? `${m[1]}.mp4` : run.activity.title
}

const notified = new Set<string>()
function notifyEnd(run: ExportRun) {
  const a = run.activity
  if (notified.has(a.id) || !a.notification || a.state === 'cancelled') return
  notified.add(a.id)
  const n = a.notification
  void window.shell.notify(n).then((where) => {
    if (where !== 'in-app') return
    const file = exportFileName(run)
    if (a.state === 'done') {
      const partial = n.body && n.body.startsWith('Exported ')
      banner({
        title: `Exported ${file}`,
        body: partial ? n.body : a.detail,
        kind: 'success',
        action: a.resultPath ? { label: 'Show in Finder', run: () => void rawApi.revealPath(a.resultPath!) } : undefined
      })
    } else {
      banner({ title: `Couldn’t export ${file}`, body: a.error, kind: 'error', action: run.sheet ? { label: 'Try Again', run: () => tryAgain(run) } : undefined })
    }
  })
}

let restore: ExportVideoRequest | null = null
/** The options the next sheet opens with (Try Again), then forgotten. */
export function takeRestore(): ExportVideoRequest | null {
  const r = restore
  restore = null
  return r
}

export function tryAgain(run: ExportRun) {
  if (!run.sheet) return
  if (run.activity.route) navigate(run.activity.route)
  restore = run.request
  const sheet = run.sheet
  setTimeout(() => requestExportVideo(sheet.source, sheet.title, sheet), 0)
}

export function cancelExport(id: string) {
  void rawApi.cancelActivity(id).catch(() => {})
}

/** Every export the footer row should show: running and queued first, then the ones that ended lately. */
export function useExports(): ExportRun[] {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => snapshot
  )
}

let localSeq = 0
/** While the sheet renders the burn-ins, before main has an activity: a placeholder run. */
export function addPreparing(fileName: string): string {
  const id = `local-${++localSeq}`
  const activity: Activity = { id, kind: 'export', title: `Exporting “${fileName}”`, detail: 'Preparing…', done: 0, total: 1, state: 'running', route: routeNow().raw.split('?')[0] }
  runs = [...runs, { activity, startedAt: Date.now(), endedAt: null, sheet: null, request: null }]
  changed()
  return id
}

export function removePreparing(id: string) {
  runs = runs.filter((r) => r.activity.id !== id)
  changed()
}

/** Hide a finished run (clicking its row). */
export function dismissExport(id: string) {
  runs = runs.filter((r) => r.activity.id !== id)
  changed()
}

/** The running export started from `route`, for the toolbar button's progress ring. */
export function useRunningExportFor(route: string | null): ExportRun | null {
  const list = useExports()
  if (!route) return null
  return list.find((r) => r.activity.state === 'running' && r.activity.route === route && r.activity.detail !== 'Waiting…') ?? list.find((r) => r.activity.state === 'running' && r.activity.route === route) ?? null
}

export const progressOf = (a: Activity) => (a.total ? Math.max(0, Math.min(1, a.done / a.total)) : 0)

let installed = 0
/** Mounted once by the analysis host. */
export function useExportTracking() {
  useEffect(() => {
    if (installed++) return () => void installed--
    const off = window.shell.onActivity(onActivity)
    void rawApi.activities().then((list) => list.filter((a) => a.kind === 'export').forEach(onActivity), () => {})
    const t = setInterval(() => {
      const before = runs.length
      prune()
      if (runs.length !== before) changed()
    }, 30_000)
    return () => {
      installed--
      off()
      clearInterval(t)
    }
  }, [])
}

// ── Remembered options (03 §11.3) ─────────────────────────────────────────

export interface RememberedOptions {
  angle?: ExportVideoRequest['angle']
  startAtSnap?: boolean
  preRoll?: number
  end?: ExportVideoRequest['end']
  between?: ExportVideoRequest['between']
  burnIn?: Partial<ExportVideoRequest['burnIn']>
  height?: ExportVideoRequest['height']
  audio?: boolean
}

export const readOptions = (): RememberedOptions => readLocal<RememberedOptions>('ui.export.options', {})
