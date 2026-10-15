import { useEffect, useMemo, useRef, useState } from 'react'
import { clipUrl } from '@shared/api'
import { clipStartTime } from '@shared/snap'
import type { Clip } from '@shared/types'
import { DEFAULT_FRAME, learnFrameLength, quantize, stepTime } from './frameLength'
import { CoalescedSeeker, SyncController, syncOffsets } from './sync'

/**
 * The shared playback engine (02 §5.10, §8, §20). One engine per player surface (the tape room, a cut-up player, a
 * reel, the preview panel). It owns the <video> elements, so it can:
 *
 * - start every clip at its start point (snap − pre-roll) without frame 0 ever flashing;
 * - swap clips without black flashes: the old element stays on screen until the new one has painted;
 * - preload the clips of the next and previous plays in detached elements and reuse them;
 * - play one or two angles in sync (`SyncController`, 02 §8.4–§8.6), with one active pane as the clock;
 * - frame-step and seek frame-accurately (seeks land in the middle of the target frame).
 *
 * Usage (React):
 *
 *   const video = useVideoController({ panes: [{ id: 'sideline', clip }], active: 'sideline', speed, loop, sound,
 *                                      startAtSnap, preRoll, autoplay: true, preload: nextAndPrevClips })
 *   <AnglePane engine={video.engine} id="sideline" … />   // attaches the pane's <video> into the DOM
 *   const time = useVideoState(video, (s) => s.time)      // subscribe to a slice; re-renders only when it changes
 *   video.toggle(); video.stepFrames(1); video.replay(); video.onEnded(() => next())
 *
 * `VideoController` (below) is the only surface other screens should use.
 */

/** Playback speeds offered everywhere (v1). `[` and `]` step through them and stop at the ends. */
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const

export type PaneError = 'missing' | 'unplayable'

export interface EnginePane {
  /** Stable id, usually the angle ('sideline'). */
  id: string
  clip: Clip | null
}

export interface PaneState {
  id: string
  clipId: number | null
  /** The pane shows a frame of its current clip. */
  ready: boolean
  /** A new clip is loading (show a spinner after 200ms). */
  loading: boolean
  error: PaneError | null
  /** Clip time and duration in seconds. */
  time: number
  duration: number
  /** Frame length, learned while playing (1/30 s until then). */
  frame: number
  /** Natural video size; 16×9 until metadata arrives. */
  width: number
  height: number
  playing: boolean
}

export interface VideoState {
  /** The clock pane is playing. */
  playing: boolean
  /** The clock pane's clip time, duration and frame length. */
  time: number
  duration: number
  frame: number
  speed: number
  loop: boolean
  sound: boolean
  ready: boolean
  error: PaneError | null
  /** The pane driving time (the active pane, or another one when the active pane has no playable clip). */
  clock: string | null
  active: string | null
  /** Two or more panes are aligned on their snap points (false: aligned on clip start). */
  aligned: boolean
  /** Each pane's offset onto play time, in seconds. */
  offsets: Record<string, number>
  panes: Record<string, PaneState>
}

export interface EngineConfig {
  startAtSnap: boolean
  preRoll: number
  speed: number
  loop: boolean
  sound: boolean
  /** New clips play once they reach their start point (off in Draw mode: they wait paused on the start frame). */
  autoplay: boolean
}

/** The API every player screen uses (02 §20). */
export interface VideoController {
  /** The latest state (not reactive; use `useVideoState` to subscribe). */
  readonly state: VideoState
  toggle(): void
  play(): void
  pause(): void
  /** Pauses, then moves by `n` frames of the clock clip. */
  stepFrames(n: number): void
  /** Moves by seconds, keeping play state. */
  seekBy(seconds: number): void
  /** Seeks the clock to clip time `t` (frame-quantized); followers are mapped. */
  seekClip(t: number): void
  /** The clock's start point, then play. */
  replay(): void
  setSpeed(s: number): void
  setLoop(on: boolean): void
  setSound(on: boolean): void
  /** Fires when the clock clip ends with loop off. Returns an unsubscribe function. */
  onEnded(cb: () => void): () => void
  readonly engine: VideoEngine
}

interface Media {
  el: HTMLVideoElement
  clip: Clip
  seeker: CoalescedSeeker
  frame: number
  /** Waiting to reach its start target, after which it may autoplay and be promoted on screen. */
  pendingStart: boolean
  startTarget: number | null
  error: PaneError | null
  pooled: boolean
  off: () => void
}

interface Slot {
  id: string
  container: HTMLElement | null
  clip: Clip | null
  shown: Media | null
  incoming: Media | null
}

const POOL_MAX = 4

export class VideoEngine {
  private slots = new Map<string, Slot>()
  private order: string[] = []
  private activeId: string | null = null
  private clockId: string | null = null
  private pool = new Map<number, Media>()
  private wanted = new Set<number>()
  private cfg: EngineConfig
  /** What the user asked for while a clip loads: play, pause, or the default (autoplay unless Draw mode). */
  private intent: 'auto' | 'play' | 'pause' = 'auto'
  private sync = new SyncController()
  private offsets: Record<string, number> = {}
  private aligned = false
  private listeners = new Set<() => void>()
  private endedCbs = new Set<() => void>()
  private snapshot: VideoState
  private raf = 0
  private disposed = false

  constructor(cfg: EngineConfig) {
    this.cfg = { ...cfg }
    this.sync.setSpeed(cfg.speed)
    this.snapshot = this.build()
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getState(): VideoState {
    return this.snapshot
  }

  onEnded(cb: () => void): () => void {
    this.endedCbs.add(cb)
    return () => this.endedCbs.delete(cb)
  }

  private emit() {
    if (this.disposed) return
    this.snapshot = this.build()
    this.listeners.forEach((l) => l())
  }

  private tick = () => {
    this.raf = 0
    this.emit()
    if (this.anyPlaying()) this.raf = requestAnimationFrame(this.tick)
  }

  private kick() {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.tick)
  }

  private anyPlaying() {
    for (const s of this.slots.values()) {
      const m = this.current(s)
      if (m && !m.el.paused) return true
    }
    return false
  }

  private build(): VideoState {
    const panes: Record<string, PaneState> = {}
    for (const s of this.slots.values()) {
      const m = this.current(s)
      const el = m?.el
      panes[s.id] = {
        id: s.id,
        clipId: s.clip?.id ?? null,
        ready: !!s.shown && s.shown.clip.id === s.clip?.id && !s.shown.error,
        loading: !!s.incoming && s.incoming.pendingStart && !s.incoming.error,
        error: m?.error ?? null,
        time: el ? (m!.seeker.pending ?? el.currentTime) : 0,
        duration: el && Number.isFinite(el.duration) ? el.duration : (s.clip?.duration ?? 0),
        frame: m?.frame ?? DEFAULT_FRAME,
        width: el?.videoWidth || 16,
        height: el?.videoHeight || 9,
        playing: !!el && !el.paused
      }
    }
    const clock = this.clockId ? panes[this.clockId] : undefined
    return {
      playing: !!clock?.playing,
      time: clock?.time ?? 0,
      duration: clock?.duration ?? 0,
      frame: clock?.frame ?? DEFAULT_FRAME,
      speed: this.cfg.speed,
      loop: this.cfg.loop,
      sound: this.cfg.sound,
      ready: !!clock?.ready,
      error: this.activeId ? (panes[this.activeId]?.error ?? null) : null,
      clock: this.clockId,
      active: this.activeId,
      aligned: this.aligned,
      offsets: { ...this.offsets },
      panes
    }
  }

  // ── Panes ────────────────────────────────────────────────────────────────

  /** The pane's container (the picture box). The pane's current <video> is moved into it. */
  attach(id: string, container: HTMLElement | null) {
    const s = this.slot(id)
    s.container = container
    for (const m of [s.shown, s.incoming]) {
      if (m && container && m.el.parentElement !== container) container.appendChild(m.el)
    }
  }

  /** The panes to show, in order, and the active one. Clips that changed load; others keep playing. */
  setPanes(panes: EnginePane[], active: string | null) {
    const ids = panes.map((p) => p.id)
    for (const [id, s] of this.slots) {
      if (ids.includes(id)) continue
      this.clearSlot(s)
      this.slots.delete(id)
    }
    this.order = ids
    this.activeId = active && ids.includes(active) ? active : (ids[0] ?? null)
    for (const p of panes) {
      const s = this.slot(p.id)
      if ((s.clip?.id ?? null) !== (p.clip?.id ?? null)) this.load(s, p.clip)
      else s.clip = p.clip
    }
    this.rewire()
  }

  setActive(id: string) {
    if (this.activeId === id || !this.slots.has(id)) return
    this.activeId = id
    this.rewire()
  }

  setConfig(patch: Partial<EngineConfig>) {
    const prev = this.cfg
    this.cfg = { ...this.cfg, ...patch }
    if (patch.speed !== undefined && patch.speed !== prev.speed) {
      for (const s of this.slots.values()) {
        const m = this.current(s)
        if (m) m.el.playbackRate = patch.speed
      }
      this.sync.setSpeed(patch.speed)
    }
    if (patch.sound !== undefined) this.applySound()
    this.emit()
  }

  /** Clips to keep ready in detached elements (the next and previous plays), at most 4. */
  preload(clips: Clip[]) {
    this.wanted = new Set(clips.slice(0, POOL_MAX).map((c) => c.id))
    for (const [id, m] of this.pool) {
      if (!this.wanted.has(id)) {
        this.destroy(m)
        this.pool.delete(id)
      }
    }
    for (const c of clips.slice(0, POOL_MAX)) {
      if (this.pool.has(c.id) || this.inUse(c.id)) continue
      const m = this.create(c)
      m.pooled = true
      this.pool.set(c.id, m)
    }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.sync.dispose()
    for (const s of this.slots.values()) this.clearSlot(s)
    for (const m of this.pool.values()) this.destroy(m)
    this.pool.clear()
    this.slots.clear()
    this.listeners.clear()
    this.endedCbs.clear()
  }

  /** The visible <video> of a pane (Copy Frame, drawing). */
  videoOf(id: string): HTMLVideoElement | null {
    const s = this.slots.get(id)
    return s?.shown?.el ?? null
  }

  // ── Controls ─────────────────────────────────────────────────────────────

  private clockMedia(): Media | null {
    const s = this.clockId ? this.slots.get(this.clockId) : undefined
    return s ? this.current(s) : null
  }

  play() {
    const m = this.clockMedia()
    if (m?.pendingStart) this.intent = 'play'
    if (!m || m.pendingStart || m.error) return this.emit()
    const end = m.el.duration
    if (Number.isFinite(end) && m.el.currentTime >= end - m.frame / 2) m.seeker.seek(this.startPoint(m.clip))
    void m.el.play().catch(() => {})
    this.kick()
  }

  pause() {
    const m = this.clockMedia()
    if (m?.pendingStart) this.intent = 'pause'
    m?.el.pause()
    this.sync.sync()
    this.emit()
  }

  toggle() {
    const m = this.clockMedia()
    if (!m) return
    const paused = m.pendingStart ? this.intent === 'pause' || (this.intent === 'auto' && !this.cfg.autoplay) : m.el.paused
    if (paused) this.play()
    else this.pause()
  }

  isPaused(): boolean {
    const m = this.clockMedia()
    return !m || m.el.paused
  }

  stepFrames(n: number) {
    const m = this.clockMedia()
    if (!m || m.error) return
    if (m.pendingStart) this.intent = 'pause'
    m.el.pause()
    m.seeker.seek(stepTime(m.seeker.target(), n, m.frame, m.el.duration))
    this.sync.sync()
    this.emit()
  }

  seekBy(seconds: number) {
    const m = this.clockMedia()
    if (!m || m.error) return
    const d = Number.isFinite(m.el.duration) ? m.el.duration : Infinity
    m.seeker.seek(Math.max(0, Math.min(m.seeker.target() + seconds, d - m.frame / 2)))
    this.sync.sync()
    this.emit()
  }

  seekClip(t: number) {
    const m = this.clockMedia()
    if (!m || m.error) return
    m.seeker.seek(quantize(t, m.frame, m.el.duration))
    this.sync.sync()
    this.emit()
  }

  /** Seeks a specific pane (dragging its snap marker moves that pane's picture). */
  seekPane(id: string, t: number) {
    const s = this.slots.get(id)
    const m = s && this.current(s)
    if (!m || m.error) return
    m.el.pause()
    m.seeker.seek(quantize(t, m.frame, m.el.duration))
    if (id === this.clockId) this.sync.sync()
    this.emit()
  }

  replay() {
    const m = this.clockMedia()
    if (!m || m.error) return
    if (m.pendingStart) this.intent = 'play'
    m.seeker.seek(this.startPoint(m.clip))
    void m.el.play().catch(() => {})
    this.sync.sync()
    this.kick()
  }

  setSpeed(s: number) {
    this.setConfig({ speed: s })
  }

  setLoop(on: boolean) {
    this.setConfig({ loop: on })
  }

  setSound(on: boolean) {
    this.setConfig({ sound: on })
  }

  /** The start point of a clip under the current settings. */
  startPoint(clip: Clip): number {
    return clipStartTime(clip, this.cfg)
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private slot(id: string): Slot {
    let s = this.slots.get(id)
    if (!s) {
      s = { id, container: null, clip: null, shown: null, incoming: null }
      this.slots.set(id, s)
    }
    return s
  }

  private current(s: Slot): Media | null {
    return s.incoming ?? s.shown
  }

  private inUse(clipId: number) {
    for (const s of this.slots.values()) if (s.shown?.clip.id === clipId || s.incoming?.clip.id === clipId) return true
    return false
  }

  private create(clip: Clip): Media {
    const el = document.createElement('video')
    el.muted = true
    el.playsInline = true
    el.preload = 'auto'
    el.disablePictureInPicture = true
    el.className = 'angle-pane__video'
    el.draggable = false
    const m: Media = {
      el,
      clip,
      seeker: null as unknown as CoalescedSeeker,
      frame: DEFAULT_FRAME,
      pendingStart: false,
      startTarget: null,
      error: null,
      pooled: false,
      off: () => {}
    }
    m.seeker = new CoalescedSeeker(el, () => m.frame)
    let learnOff: (() => void) | null = null
    const onMeta = () => this.onMeta(m)
    const onSeeked = () => {
      m.seeker.seeked()
      this.onSeeked(m)
    }
    const onPlaying = () => {
      if (!learnOff && m.frame === DEFAULT_FRAME) {
        learnOff = learnFrameLength(el, (f) => {
          m.frame = f
          this.emit()
        })
      }
      this.kick()
      this.emit()
    }
    const onState = () => {
      this.emit()
      this.kick()
    }
    const onEnded = () => this.onEndedMedia(m)
    const onError = () => void this.onError(m)
    const events: [string, () => void][] = [
      ['loadedmetadata', onMeta],
      ['seeked', onSeeked],
      ['playing', onPlaying],
      ['play', onState],
      ['pause', onState],
      ['ended', onEnded],
      ['error', onError],
      ['timeupdate', onState]
    ]
    for (const [name, fn] of events) el.addEventListener(name, fn)
    m.off = () => {
      for (const [name, fn] of events) el.removeEventListener(name, fn)
      learnOff?.()
      m.seeker.dispose()
    }
    el.src = clipUrl(clip.id)
    return m
  }

  private destroy(m: Media) {
    m.off()
    m.el.pause()
    m.el.removeAttribute('src')
    try {
      m.el.load()
    } catch {
      // Already torn down.
    }
    m.el.remove()
  }

  /** A clip leaves the screen: kept for later when it is one of the preloads, else destroyed. */
  private retire(m: Media) {
    m.el.pause()
    m.el.style.zIndex = ''
    if (this.wanted.has(m.clip.id) && !this.pool.has(m.clip.id) && this.pool.size < POOL_MAX && !m.error) {
      m.el.remove()
      m.pooled = true
      m.pendingStart = false
      m.seeker.seek(this.startPoint(m.clip))
      this.pool.set(m.clip.id, m)
    } else this.destroy(m)
  }

  private clearSlot(s: Slot) {
    if (s.incoming) this.retire(s.incoming)
    if (s.shown) this.retire(s.shown)
    s.incoming = null
    s.shown = null
    s.clip = null
  }

  private load(s: Slot, clip: Clip | null) {
    if (s.incoming) {
      this.retire(s.incoming)
      s.incoming = null
    }
    s.clip = clip
    if (!clip) {
      if (s.shown) this.retire(s.shown)
      s.shown = null
      return
    }
    s.shown?.el.pause()
    if (s.id === this.activeId) this.intent = 'auto'
    let m = this.pool.get(clip.id)
    if (m) this.pool.delete(clip.id)
    else m = this.create(clip)
    m.pooled = false
    m.clip = clip
    m.pendingStart = true
    m.startTarget = null
    m.el.style.zIndex = '0'
    s.incoming = m
    if (s.container) s.container.appendChild(m.el)
    if (m.error) return
    if (m.el.readyState >= 1) this.onMeta(m)
  }

  private slotOf(m: Media): Slot | undefined {
    for (const s of this.slots.values()) if (s.incoming === m || s.shown === m) return s
    return undefined
  }

  /** Where a pane's new clip starts: the clock's start point, or for followers the clock's start mapped across. */
  private startTarget(s: Slot, m: Media): number {
    const clockId = this.clockFor()
    if (s.id === clockId || !clockId) return this.startPoint(m.clip)
    const cs = this.slots.get(clockId)
    const cm = cs && this.current(cs)
    if (!cm) return this.startPoint(m.clip)
    const { offsets } = this.computeOffsets()
    const clockTime = cm.pendingStart ? (cm.startTarget ?? this.startPoint(cm.clip)) : cm.seeker.target()
    const tau = clockTime - (offsets[clockId] ?? 0)
    const d = Number.isFinite(m.el.duration) ? m.el.duration : Infinity
    return Math.max(0, Math.min((offsets[s.id] ?? 0) + tau, d - m.frame / 2))
  }

  private onMeta(m: Media) {
    if (this.disposed) return
    m.el.playbackRate = this.cfg.speed
    if (m.pooled) {
      m.seeker.seek(this.startPoint(m.clip))
      return
    }
    const s = this.slotOf(m)
    if (!s || !m.pendingStart) return this.emit()
    const target = this.startTarget(s, m)
    m.startTarget = target
    if (Math.abs(m.el.currentTime - target) < m.frame / 2 && m.el.readyState >= 2 && !m.el.seeking && !m.seeker.inFlight) this.onStartReady(s, m)
    else m.seeker.seek(target)
    this.emit()
  }

  private onSeeked(m: Media) {
    if (m.pooled) return
    const s = this.slotOf(m)
    if (s && m.pendingStart && !m.seeker.inFlight) this.onStartReady(s, m)
    this.emit()
  }

  private onStartReady(s: Slot, m: Media) {
    m.pendingStart = false
    this.rewire()
    const isClock = s.id === this.clockId
    if (isClock && (this.intent === 'play' || (this.intent === 'auto' && this.cfg.autoplay))) void m.el.play().catch(() => {})
    if (isClock) this.intent = 'auto'
    const promote = () => {
      if (s.incoming !== m) return
      const old = s.shown
      s.shown = m
      s.incoming = null
      m.el.style.zIndex = ''
      if (old && old !== m) this.retire(old)
      this.rewire()
    }
    // The old clip stays on screen until the new one has painted its first frame (no black flash).
    let done = false
    const once = () => {
      if (done) return
      done = true
      promote()
    }
    if (typeof m.el.requestVideoFrameCallback === 'function' && !m.el.paused) m.el.requestVideoFrameCallback(once)
    else requestAnimationFrame(() => requestAnimationFrame(once))
    setTimeout(once, 300)
  }

  private onEndedMedia(m: Media) {
    const s = this.slotOf(m)
    if (!s || s.id !== this.clockId || this.current(s) !== m) return this.emit()
    if (this.cfg.loop) {
      m.seeker.seek(this.startPoint(m.clip))
      void m.el.play().catch(() => {})
      this.sync.sync()
      this.kick()
      return
    }
    this.emit()
    this.endedCbs.forEach((cb) => cb())
  }

  private async onError(m: Media) {
    let kind: PaneError = 'unplayable'
    try {
      const res = await fetch(clipUrl(m.clip.id), { headers: { Range: 'bytes=0-0' } })
      if (res.status === 404) kind = 'missing'
    } catch {
      // The tape:// handler may not answer fetch() from this origin; treat it as unplayable.
    }
    m.error = kind
    if (m.pendingStart) {
      m.pendingStart = false
      const s = this.slotOf(m)
      if (s && s.incoming === m) {
        if (s.shown) this.retire(s.shown)
        s.shown = m
        s.incoming = null
        m.el.style.zIndex = ''
      }
    }
    this.rewire()
  }

  private computeOffsets() {
    return syncOffsets(
      this.order.map((id) => {
        const s = this.slots.get(id)!
        const m = this.current(s)
        return { id, snap: s.clip && s.clip.snapMs !== null ? s.clip.snapMs / 1000 : null, playable: !!s.clip && !m?.error }
      })
    )
  }

  /** The clock: the active pane when it has a playable clip, else the first pane that does (02 §8.4 step 5). */
  private clockFor(): string | null {
    const playable = (id: string | null) => {
      if (!id) return false
      const s = this.slots.get(id)
      const m = s && this.current(s)
      return !!m && !m.error
    }
    if (playable(this.activeId)) return this.activeId
    return this.order.find((id) => playable(id)) ?? null
  }

  private rewire() {
    if (this.disposed) return
    const prevClock = this.clockId
    this.clockId = this.clockFor()
    const { offsets, aligned } = this.computeOffsets()
    this.offsets = offsets
    this.aligned = aligned && this.order.filter((id) => this.slots.get(id)?.clip).length > 1
    const cm = this.clockMedia()
    // A follower that becomes the clock keeps the play state the old clock had.
    if (prevClock && prevClock !== this.clockId && cm && !cm.pendingStart) {
      const ps = this.slots.get(prevClock)
      const pm = ps && this.current(ps)
      if (pm && !pm.el.paused && cm.el.paused) void cm.el.play().catch(() => {})
    }
    this.sync.setClock(cm && !cm.pendingStart ? cm.el : null, cm ? (offsets[this.clockId!] ?? 0) : 0, cm?.seeker ?? null)
    const followers: { el: HTMLVideoElement; offset: number; frame: number; seeker: CoalescedSeeker }[] = []
    for (const id of this.order) {
      if (id === this.clockId) continue
      const s = this.slots.get(id)!
      const m = this.current(s)
      if (!m || m.error || m.pendingStart) continue
      followers.push({ el: m.el, offset: offsets[id] ?? 0, frame: m.frame, seeker: m.seeker })
    }
    this.sync.setFollowers(followers)
    this.applySound()
    this.emit()
    this.kick()
  }

  private applySound() {
    for (const s of this.slots.values()) {
      for (const m of [s.shown, s.incoming]) {
        if (!m) continue
        m.el.muted = !(this.cfg.sound && s.id === this.activeId)
      }
    }
  }

  /** Re-maps followers after an offset change (a snap moved). */
  resync() {
    this.rewire()
    this.sync.sync()
  }
}

/** One engine per player surface, kept in step with the props. */
export function useVideoController(opts: {
  panes: EnginePane[]
  active: string | null
  startAtSnap: boolean
  preRoll: number
  speed: number
  loop: boolean
  sound: boolean
  autoplay?: boolean
  preload?: Clip[]
}): VideoController {
  const ref = useRef<VideoEngine | null>(null)
  if (!ref.current) {
    ref.current = new VideoEngine({
      startAtSnap: opts.startAtSnap,
      preRoll: opts.preRoll,
      speed: opts.speed,
      loop: opts.loop,
      sound: opts.sound,
      autoplay: opts.autoplay ?? true
    })
  }
  const engine = ref.current
  useEffect(() => () => engine.dispose(), [engine])
  useEffect(() => {
    engine.setConfig({ startAtSnap: opts.startAtSnap, preRoll: opts.preRoll, speed: opts.speed, loop: opts.loop, sound: opts.sound, autoplay: opts.autoplay ?? true })
  }, [engine, opts.startAtSnap, opts.preRoll, opts.speed, opts.loop, opts.sound, opts.autoplay])
  const paneKey = opts.panes.map((p) => `${p.id}:${p.clip?.id ?? '-'}:${p.clip?.snapMs ?? '-'}`).join('|')
  useEffect(() => {
    engine.setPanes(opts.panes, opts.active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, paneKey, opts.active])
  const preloadKey = (opts.preload ?? []).map((c) => c.id).join(',')
  useEffect(() => {
    engine.preload(opts.preload ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, preloadKey])
  return useMemo<VideoController>(
    () => ({
      get state() {
        return engine.getState()
      },
      toggle: () => engine.toggle(),
      play: () => engine.play(),
      pause: () => engine.pause(),
      stepFrames: (n) => engine.stepFrames(n),
      seekBy: (s) => engine.seekBy(s),
      seekClip: (t) => engine.seekClip(t),
      replay: () => engine.replay(),
      setSpeed: (s) => engine.setSpeed(s),
      setLoop: (on) => engine.setLoop(on),
      setSound: (on) => engine.setSound(on),
      onEnded: (cb) => engine.onEnded(cb),
      engine
    }),
    [engine]
  )
}

/** Subscribes to a slice of the engine's state; re-renders only when the slice changes (shallow for objects). */
export function useVideoState<T>(ctl: VideoController | VideoEngine, select: (s: VideoState) => T): T {
  const engine = 'engine' in ctl ? ctl.engine : ctl
  const sel = useRef(select)
  sel.current = select
  const [value, setValue] = useState(() => select(engine.getState()))
  const last = useRef(value)
  useEffect(() => {
    const check = () => {
      const next = sel.current(engine.getState())
      if (!shallowEqual(next, last.current)) {
        last.current = next
        setValue(next)
      }
    }
    check()
    return engine.subscribe(check)
  }, [engine])
  return value
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
