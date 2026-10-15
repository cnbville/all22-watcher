import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** The width of an element, kept current with a ResizeObserver (charts draw at their real width so text stays crisp). */
export function useMeasure<T extends HTMLElement>(initial = 0): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState(initial)
  useLayoutEffect(() => {
    if (!el) return
    setWidth(Math.round(el.getBoundingClientRect().width))
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width]
}

function read<T>(store: () => Storage, key: string, fallback: T): T {
  try {
    const raw = store().getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(store: () => Storage, key: string, value: unknown) {
  try {
    store().setItem(key, JSON.stringify(value))
  } catch {
    // Not remembered; the screen still works.
  }
}

/** View state remembered per route for the session (01 §1.4.4): segmented tabs, sort, filters. */
export function useRouteState<T>(route: string, name: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  return useStored(() => sessionStorage, `ui.route.${route}.${name}`, fallback)
}

/** A preference kept in localStorage (`ui.reel.angle`, `ui.splits.hideSmall`, …). */
export function useLocalState<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  return useStored(() => localStorage, key, fallback)
}

function useStored<T>(store: () => Storage, key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(store, key, fallback))
  const keyRef = useRef(key)
  useEffect(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    setValue(read(store, key, fallback))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const set = useCallback(
    (v: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        write(store, key, next)
        return next
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  return [value, set]
}

export function readLocal<T>(key: string, fallback: T): T {
  return read(() => localStorage, key, fallback)
}

export function writeLocal(key: string, value: unknown) {
  write(() => localStorage, key, value)
}

export interface Loaded<T> {
  data: T | null
  error: unknown
  loading: boolean
  reload: () => void
}

/**
 * Loads data and keeps the old content visible while it reloads (01 §8.3); `busy` turns true when a reload
 * takes longer than a second, for the toolbar's small spinner.
 */
export function useLoaded<T>(load: () => Promise<T>, deps: unknown[]): Loaded<T> & { busy: boolean } {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true })
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const reload = useCallback(() => {
    const n = ++seq.current
    setState((s) => ({ ...s, loading: true }))
    const slow = setTimeout(() => n === seq.current && setBusy(true), 1000)
    loadRef
      .current()
      .then(
        (data) => n === seq.current && setState({ data, error: null, loading: false }),
        (error) => n === seq.current && setState((s) => ({ data: s.data, error, loading: false }))
      )
      .finally(() => {
        clearTimeout(slow)
        if (n === seq.current) setBusy(false)
      })
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps)
  return { ...state, reload, busy }
}

/** True while the user prefers reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
