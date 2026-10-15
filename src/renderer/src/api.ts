import type { Api } from '@shared/api'
import type { ShellBridge } from '@shared/shell'
import { type DataEventKind, emit } from './shell/dataEvents'

declare global {
  interface Window {
    api: Api
    shell: ShellBridge
  }
}

/** The unwrapped bridge, for code that must not emit events (the shell's own stores). */
export const rawApi: Api = window.api

/** Writes that refresh screens through the data event bus (03 §2.2.6). */
const EMITS: Record<string, DataEventKind[]> = {
  saveGrade: ['grades'],
  savePlayNote: ['notes'],
  importClips: ['film'],
  relinkClip: ['film'],
  removeFilm: ['film'],
  setClipSnap: ['film'],
  convertClips: [],
  downloadSeason: ['season'],
  createCutup: ['cutups'],
  updateCutup: ['cutups'],
  deleteCutup: ['cutups'],
  duplicateCutup: ['cutups'],
  addToCutup: ['cutups'],
  removeFromCutup: ['cutups'],
  reorderCutup: ['cutups'],
  reorderCutups: ['cutups']
}

/** Writes that every window must hear about (01 §4: changes apply immediately, the main window reloads them). */
const SETTINGS_WRITES = new Set(['saveSettings', 'saveTags', 'saveChartFields'])

type AfterHook = (args: unknown[]) => void
const afterHooks = new Map<string, AfterHook[]>()

/** Runs `hook` after a successful call of `method` (the shell uses it to add My Teams automatically). */
export function afterApi(method: keyof Api | string, hook: AfterHook) {
  afterHooks.set(method, [...(afterHooks.get(method) ?? []), hook])
}

/**
 * window.api with the shell's side effects: data events after writes, a settings broadcast after settings writes.
 * Methods added to the bridge later pass straight through. The bridged object is frozen, so the proxy
 * wraps an empty target and reads window.api per access (a proxy over a frozen object may not wrap its values).
 */
export const api: Api = new Proxy({} as Api, {
  get(_, prop: string) {
    const target = window.api
    const value = (target as unknown as Record<string, unknown> | undefined)?.[prop]
    if (typeof value !== 'function') return value
    const kinds = EMITS[prop]
    const settings = SETTINGS_WRITES.has(prop)
    const hooks = afterHooks.get(prop)
    if (!kinds && !settings && !hooks) return value.bind(target)
    return (...args: unknown[]) => {
      const result = (value as (...a: unknown[]) => unknown).apply(target, args)
      return Promise.resolve(result).then((res) => {
        if (kinds?.length) emit(...kinds)
        if (settings) window.shell?.broadcastSettingsChanged()
        afterHooks.get(prop)?.forEach((h) => h(args))
        return res
      })
    }
  }
})
