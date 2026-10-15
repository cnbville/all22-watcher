import { useEffect, useRef } from 'react'

/**
 * Renderer-side refresh bus (03 §2.2.6). The api wrapper emits after successful writes; activities that finish in
 * main emit from the shell's activity handler. Screens refetch what they show, keeping the old content visible.
 */
export type DataEventKind = 'grades' | 'notes' | 'film' | 'cutups' | 'season' | 'settings'

const listeners = new Map<DataEventKind, Set<() => void>>()

export function emit(...kinds: DataEventKind[]) {
  const fired = new Set<() => void>()
  for (const kind of kinds) {
    for (const cb of listeners.get(kind) ?? []) {
      if (fired.has(cb)) continue
      fired.add(cb)
      cb()
    }
  }
}

export function onDataEvent(kinds: DataEventKind | DataEventKind[], cb: () => void): () => void {
  const list = Array.isArray(kinds) ? kinds : [kinds]
  for (const k of list) {
    if (!listeners.has(k)) listeners.set(k, new Set())
    listeners.get(k)!.add(cb)
  }
  return () => list.forEach((k) => listeners.get(k)?.delete(cb))
}

/** Calls `cb` whenever one of `kinds` fires, while mounted. */
export function useDataEvent(kinds: DataEventKind | DataEventKind[], cb: () => void) {
  const ref = useRef(cb)
  ref.current = cb
  const key = Array.isArray(kinds) ? kinds.join(',') : kinds
  useEffect(() => onDataEvent(key.split(',') as DataEventKind[], () => ref.current()), [key])
}
