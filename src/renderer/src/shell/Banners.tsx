import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '../ui/Button'
import { Icon, type IconName } from '../ui/Icon'

/** In-app banners (01 §6.22): replace v1 toast(). */

export interface BannerOptions {
  title: string
  body?: string
  kind?: 'info' | 'error' | 'success'
  action?: { label: string; run: () => void }
  /** ms; default 5s, errors 8s. */
  timeout?: number
}

interface Item extends BannerOptions {
  id: number
  leaving?: boolean
}

let items: Item[] = []
let seq = 0
const listeners = new Set<() => void>()
const emitChange = () => listeners.forEach((l) => l())

export function banner(opts: BannerOptions): () => void {
  const id = ++seq
  items = [{ ...opts, id }, ...items].slice(0, 3)
  emitChange()
  return () => dismiss(id)
}

/** v1 compatibility: `toast(msg)` is `banner({ title: msg })`. */
export function toast(msg: string) {
  banner({ title: msg })
}

/** An action failed (01 §8.4): "Couldn’t …" with the error text and an optional Try Again. */
export function errorBanner(title: string, error: unknown, retry?: () => void) {
  banner({ title, body: errorText(error), kind: 'error', action: retry ? { label: 'Try Again', run: retry } : undefined })
}

/** An error's message without Electron's IPC prefix. */
export function errorText(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function dismiss(id: number) {
  if (!items.some((i) => i.id === id)) return
  items = items.map((i) => (i.id === id ? { ...i, leaving: true } : i))
  emitChange()
  setTimeout(() => {
    items = items.filter((i) => i.id !== id)
    emitChange()
  }, 160)
}

const ICONS: Record<NonNullable<BannerOptions['kind']>, IconName> = { info: 'info', success: 'circle-check', error: 'circle-alert' }

function BannerView({ item }: { item: Item }) {
  const [hover, setHover] = useState(false)
  const remaining = useRef(item.timeout ?? (item.kind === 'error' ? 8000 : 5000))
  useEffect(() => {
    if (hover || item.leaving) return
    const start = performance.now()
    const t = setTimeout(() => dismiss(item.id), remaining.current)
    return () => {
      clearTimeout(t)
      remaining.current = Math.max(1000, remaining.current - (performance.now() - start))
    }
  }, [hover, item.id, item.leaving])
  const kind = item.kind ?? 'info'
  return (
    <div
      className={`banner${kind === 'error' ? ' banner--error' : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
      data-state={item.leaving ? 'leaving' : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Icon name={ICONS[kind]} size={16} className="banner__icon" />
      <div className="banner__text">
        <div className="banner__title">{item.title}</div>
        {item.body && <div className="banner__body">{item.body}</div>}
      </div>
      {item.action && (
        <Button
          variant="borderless"
          size="sm"
          onClick={() => {
            item.action!.run()
            dismiss(item.id)
          }}
        >
          {item.action.label}
        </Button>
      )}
      <button className="banner__close" aria-label="Close" onMouseDown={(e) => e.preventDefault()} onClick={() => dismiss(item.id)}>
        <Icon name="x" size={10} />
      </button>
    </div>
  )
}

export function BannerHost() {
  const list = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => items
  )
  if (!list.length) return null
  return (
    <div className="banner-stack">
      {list.map((i) => (
        <BannerView key={i.id} item={i} />
      ))}
    </div>
  )
}
