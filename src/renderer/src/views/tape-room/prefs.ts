import { useCallback, useState } from 'react'

/**
 * The tape room's renderer storage (02 §19.5): `localStorage` for preferences that survive restarts, `sessionStorage`
 * for this launch only. Every read and write is wrapped, falling back to the default.
 */

type Store = 'local' | 'session'
const area = (s: Store): Storage | null => {
  try {
    return s === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function readPref<T>(key: string, fallback: T, store: Store = 'local'): T {
  try {
    const raw = area(store)?.getItem(key)
    if (raw === null || raw === undefined) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown, store: Store = 'local') {
  try {
    if (value === undefined) area(store)?.removeItem(key)
    else area(store)?.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

/** useState backed by storage; `validate` rejects stored values that no longer make sense. */
export function usePref<T>(key: string, fallback: T, opts: { store?: Store; validate?: (v: T) => boolean } = {}): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const v = readPref(key, fallback, opts.store)
    return opts.validate && !opts.validate(v) ? fallback : v
  })
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        writePref(key, next, opts.store)
        return next
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, opts.store]
  )
  return [value, set]
}
