import { useEffect, useRef } from 'react'
import { DEFAULT_FRAME } from './frameLength'

/**
 * Synced angles (02 §8.4–§8.6). One clock: the active pane's <video> plays natively and every other angle (a
 * follower) is mapped onto it through the snap points and held within a frame by trimming its playback rate, with a
 * hard re-seek when it drifts too far. Pure parts are exported for tests; `SyncController` wires real elements and
 * `useSyncedPlayback` is the React form for players that don't use the full engine.
 */

export const HARD_RESYNC_S = 0.25
export const SOFT_TOLERANCE_S = 0.02
export const GAIN = 2
export const MAX_RATE_ADJUST = 0.1

/** The parts of HTMLMediaElement sync touches; tests pass plain objects. */
export interface SyncMedia {
  currentTime: number
  readonly paused: boolean
  playbackRate: number
  readonly duration: number
  play(): unknown
  pause(): void
}

/** At most one seek in flight per element; the newest target waits and is applied on `seeked` (02 §8.5). */
export class CoalescedSeeker {
  inFlight = false
  pending: number | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  constructor(
    private media: SyncMedia,
    private frame: () => number = () => DEFAULT_FRAME
  ) {}

  seek(t: number) {
    if (this.inFlight) {
      this.pending = t
      return
    }
    this.inFlight = true
    this.media.currentTime = t
    // A seek to the time already shown may never report back; don't let it block the next one.
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.seeked(), 600)
  }

  /** Call from the element's `seeked` event. */
  seeked() {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = null
    this.inFlight = false
    const p = this.pending
    this.pending = null
    if (p !== null && Math.abs(this.media.currentTime - p) > this.frame() / 2) this.seek(p)
  }

  /** Where the element is headed: the pending target, else its current time. */
  target(): number {
    return this.pending ?? this.media.currentTime
  }

  dispose() {
    if (this.watchdog) clearTimeout(this.watchdog)
  }
}

/**
 * Offsets that map every pane onto play time (02 §8.4 step 1): each pane's snap point when every playable pane has
 * one, otherwise 0 for all (aligned on clip start). `aligned` is false in the fallback.
 */
export function syncOffsets(panes: { id: string; snap: number | null; playable: boolean }[]): { offsets: Record<string, number>; aligned: boolean } {
  const playable = panes.filter((p) => p.playable)
  const aligned = playable.length > 0 && playable.every((p) => p.snap !== null)
  const offsets: Record<string, number> = {}
  for (const p of panes) offsets[p.id] = aligned && p.snap !== null ? p.snap : 0
  return { offsets, aligned }
}

export interface Follower {
  media: SyncMedia
  /** o_f: this pane's offset in seconds. */
  offset: number
  /** d_f: clip duration. */
  duration: number
  /** This clip's frame length. */
  frame: number
  seeker: CoalescedSeeker
}

/** Maps play time onto a follower's clip time. */
export const followerTarget = (tau: number, f: Pick<Follower, 'offset'>) => f.offset + tau

/**
 * One sync pass (02 §8.5): `tau` is play time (clock media time − clock offset). Followers outside their clip, or
 * while the clock is paused, pause on their exact mapped frame; otherwise they play at the speed, trimmed by up to
 * ±10% while within the hard-resync limit, re-seeked beyond it.
 */
export function syncFollowers(tau: number, clockPaused: boolean, speed: number, followers: Follower[]) {
  for (const f of followers) {
    const d = Number.isFinite(f.duration) && f.duration > 0 ? f.duration : Infinity
    const target = followerTarget(tau, f)
    if (clockPaused || target <= 0 || target >= d) {
      if (!f.media.paused) f.media.pause()
      const want = Math.min(Math.max(target, 0), Number.isFinite(d) ? d - f.frame / 2 : Math.max(target, 0))
      if (Math.abs(f.seeker.target() - want) > f.frame / 2) f.seeker.seek(want)
      if (f.media.playbackRate !== speed) f.media.playbackRate = speed
      continue
    }
    const drift = f.media.currentTime - target
    if (Math.abs(drift) > HARD_RESYNC_S) {
      if (!f.seeker.inFlight) f.seeker.seek(target)
      f.media.playbackRate = speed
    } else if (Math.abs(drift) > SOFT_TOLERANCE_S) {
      f.media.playbackRate = speed * (1 - Math.max(-MAX_RATE_ADJUST, Math.min(MAX_RATE_ADJUST, drift * GAIN)))
    } else if (f.media.playbackRate !== speed) {
      f.media.playbackRate = speed
    }
    if (f.media.paused) void Promise.resolve(f.media.play()).catch(() => {})
  }
}

interface LiveFollower extends Follower {
  el: HTMLVideoElement
  off: () => void
}

/**
 * Keeps follower <video> elements in step with a clock element. Listens to the clock's frames and events; the
 * owner swaps clock and followers as panes change.
 */
export class SyncController {
  private clock: HTMLVideoElement | null = null
  private clockOffset = 0
  private followers: LiveFollower[] = []
  private speed = 1
  private rvfc = 0
  private clockOff: (() => void) | null = null
  private clockSeeker: CoalescedSeeker | null = null

  setSpeed(speed: number) {
    this.speed = speed
    this.sync()
  }

  /** The clock and its offset; `seeker` is the clock's own coalesced seeker so scrubbing never queues seeks. */
  setClock(el: HTMLVideoElement | null, offset: number, seeker: CoalescedSeeker | null = null) {
    if (el !== this.clock) {
      this.clockOff?.()
      this.clockOff = null
      this.clock = el
      if (el) this.listenClock(el)
    }
    this.clockOffset = offset
    this.clockSeeker = seeker
    this.sync()
  }

  setFollowers(list: { el: HTMLVideoElement; offset: number; frame: number; seeker?: CoalescedSeeker }[]) {
    const keep: LiveFollower[] = []
    for (const f of list) {
      const existing = this.followers.find((x) => x.el === f.el)
      if (existing) {
        existing.offset = f.offset
        existing.frame = f.frame
        existing.duration = f.el.duration
        keep.push(existing)
        continue
      }
      const seeker = f.seeker ?? new CoalescedSeeker(f.el, () => live.frame)
      const onSeeked = () => {
        if (!f.seeker) seeker.seeked()
      }
      const onMeta = () => (live.duration = f.el.duration)
      f.el.addEventListener('seeked', onSeeked)
      f.el.addEventListener('loadedmetadata', onMeta)
      const live: LiveFollower = {
        el: f.el,
        media: f.el,
        offset: f.offset,
        duration: f.el.duration,
        frame: f.frame,
        seeker,
        off: () => {
          f.el.removeEventListener('seeked', onSeeked)
          f.el.removeEventListener('loadedmetadata', onMeta)
          if (!f.seeker) seeker.dispose()
        }
      }
      keep.push(live)
    }
    for (const f of this.followers) if (!keep.includes(f)) f.off()
    this.followers = keep
    this.sync()
  }

  /** Play time on the clock (clip time minus its offset). */
  tau(): number {
    if (!this.clock) return 0
    const t = this.clockSeeker?.pending ?? this.clock.currentTime
    return t - this.clockOffset
  }

  /** One pass now (after a seek, a snap change, a layout change). */
  sync(mediaTime?: number) {
    const c = this.clock
    if (!c || !this.followers.length) return
    const tau = (mediaTime ?? this.clockSeeker?.pending ?? c.currentTime) - this.clockOffset
    syncFollowers(tau, c.paused || c.seeking, this.speed, this.followers)
  }

  private listenClock(el: HTMLVideoElement) {
    const frame: VideoFrameRequestCallback = (_now, meta) => {
      if (!el.paused) this.sync(meta.mediaTime)
      this.rvfc = el.requestVideoFrameCallback(frame)
    }
    if (typeof el.requestVideoFrameCallback === 'function') this.rvfc = el.requestVideoFrameCallback(frame)
    const onEvent = () => this.sync()
    const onWaiting = () => this.followers.forEach((f) => f.media.pause())
    const onPlaying = () => {
      for (const f of this.followers) f.seeker.seek(Math.max(0, followerTarget(this.tau(), f)))
      this.sync()
    }
    const events: [string, () => void][] = [
      ['play', onEvent],
      ['pause', onEvent],
      ['seeked', onEvent],
      ['seeking', onEvent],
      ['ratechange', onEvent],
      ['waiting', onWaiting],
      ['playing', onPlaying]
    ]
    for (const [name, fn] of events) el.addEventListener(name, fn)
    this.clockOff = () => {
      for (const [name, fn] of events) el.removeEventListener(name, fn)
      if (typeof el.cancelVideoFrameCallback === 'function') el.cancelVideoFrameCallback(this.rvfc)
    }
  }

  dispose() {
    this.clockOff?.()
    this.clockOff = null
    for (const f of this.followers) f.off()
    this.followers = []
    this.clock = null
  }
}

/**
 * React form for simple players (reel, cut-up, preview): `clock` plays, every follower follows it at its offset.
 * The tape room's engine uses `SyncController` directly.
 */
export function useSyncedPlayback(
  clock: HTMLVideoElement | null,
  clockOffset: number,
  followers: { el: HTMLVideoElement; offset: number; frame?: number }[],
  speed: number
) {
  const ctl = useRef<SyncController | null>(null)
  if (!ctl.current) ctl.current = new SyncController()
  useEffect(() => () => ctl.current?.dispose(), [])
  useEffect(() => ctl.current!.setClock(clock, clockOffset), [clock, clockOffset])
  const key = followers.map((f) => `${f.offset}:${f.frame ?? ''}`).join('|')
  useEffect(() => {
    ctl.current!.setFollowers(followers.map((f) => ({ el: f.el, offset: f.offset, frame: f.frame ?? DEFAULT_FRAME })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...followers.map((f) => f.el)])
  useEffect(() => ctl.current!.setSpeed(speed), [speed])
  return ctl.current
}
