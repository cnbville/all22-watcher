import { randomBytes } from 'node:crypto'
import type { ApiEvent, DataKind } from '@shared/api'
import { API_EVENT_CHANNEL } from '@shared/api'
import type { Activity } from '@shared/types'

type Sink = (event: ApiEvent) => void

/**
 * Where events go. In the app, index.ts points this at every window's webContents; tests and scripts can listen
 * directly. Kept free of Electron imports so the services that emit events stay testable.
 */
const sinks = new Set<Sink>()

export function addEventSink(sink: Sink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

/** Sends one event to every window over the `api-event` channel. */
export function broadcast(event: ApiEvent) {
  for (const sink of sinks) {
    try {
      sink(event)
    } catch {
      // A window that went away mid-send.
    }
  }
}

export function changed(...kinds: DataKind[]) {
  if (kinds.length) broadcast({ type: 'changed', kinds })
}

export { API_EVENT_CHANNEL }

// Activities

const activities = new Map<string, Activity>()
const cancellers = new Map<string, () => void>()
const ENDED_KEEP_MS = 10 * 60 * 1000

/** A long-running job shown in the sidebar footer, toolbar and Dock. Every change is broadcast. */
export class ActivityHandle {
  constructor(readonly id: string) {}

  get value(): Activity {
    return activities.get(this.id)!
  }

  update(patch: Partial<Omit<Activity, 'id' | 'kind'>>) {
    const cur = activities.get(this.id)
    if (!cur || cur.state !== 'running') return
    const next = { ...cur, ...patch }
    activities.set(this.id, next)
    broadcast({ type: 'activity', activity: next })
  }

  private end(patch: Partial<Activity>) {
    const cur = activities.get(this.id)
    if (!cur || cur.state !== 'running') return
    const next = { ...cur, ...patch, cancellable: false }
    activities.set(this.id, next)
    cancellers.delete(this.id)
    broadcast({ type: 'activity', activity: next })
    setTimeout(() => activities.get(this.id) === next && activities.delete(this.id), ENDED_KEEP_MS).unref?.()
  }

  done(patch: Partial<Activity> = {}) {
    this.end({ done: this.value?.total ?? 0, ...patch, state: 'done' })
  }

  fail(error: string, patch: Partial<Activity> = {}) {
    this.end({ ...patch, state: 'failed', error })
  }

  cancelled() {
    this.end({ state: 'cancelled', notification: undefined })
  }
}

export function startActivity(a: Omit<Activity, 'id' | 'state' | 'done' | 'total'> & { done?: number; total?: number; id?: string }, cancel?: () => void): ActivityHandle {
  const id = a.id ?? `${a.kind}-${randomBytes(4).toString('hex')}`
  const activity: Activity = { done: 0, total: 0, ...a, id, state: 'running', cancellable: !!cancel }
  activities.set(id, activity)
  if (cancel) cancellers.set(id, cancel)
  broadcast({ type: 'activity', activity })
  return new ActivityHandle(id)
}

/** Running activities and ones that ended in the last 10 minutes, oldest first. */
export function listActivities(): Activity[] {
  return [...activities.values()]
}

export function cancelActivity(id: string): boolean {
  const cancel = cancellers.get(id)
  if (!cancel) return false
  cancel()
  return true
}

export function runningActivities(kind?: Activity['kind']): Activity[] {
  return [...activities.values()].filter((a) => a.state === 'running' && (!kind || a.kind === kind))
}
