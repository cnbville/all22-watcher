import { useEffect, useRef, useState } from 'react'
import { quantize } from './frameLength'
import { elapsedLabel, formatSeconds } from './time'

/**
 * The transport's scrubber (02 §5.4): frame-accurate seeks, a snap marker that can be dragged, the pre-roll region,
 * a hover hairline with a time tooltip, and two-finger horizontal scroll for frame stepping. Not focusable; the
 * keys are global.
 */
export interface ScrubberProps {
  time: number
  duration: number
  frame: number
  /** The clip's snap point in seconds, or null. */
  snap: number | null
  /** End of the pre-roll region (the start point), shown only with a snap point and Start Clips at Snap on. */
  startPoint: number | null
  timeMode: 'snap' | 'clip'
  disabled?: boolean
  /** A click on the track: seek, keep play state. */
  onSeek(t: number): void
  /** A drag on the track: pauses first; `onScrub` seeks while dragging; `onScrubEnd` resumes if it was playing. */
  onScrubStart(): void
  onScrub(t: number): void
  onScrubEnd(): void
  onSnapClick?(): void
  /** Live while dragging the snap marker (the picture follows). */
  onSnapDrag?(t: number): void
  onSnapCommit?(t: number): void
  onSnapCancel?(): void
  onSnapContextMenu?(e: React.MouseEvent): void
  /** Two-finger horizontal scroll: frames to step (6px each). */
  onFrameStep?(n: number): void
  /** Reports the track's horizontal range (the drawing lane aligns to it). */
  onTrackRect?(r: { left: number; width: number }): void
}

const SNAP_PX = 6

export function Scrubber(p: ScrubberProps) {
  const track = useRef<HTMLDivElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [width, setWidth] = useState(0)
  const drag = useRef<{ kind: 'track' | 'snap'; startX: number; moved: boolean; shift: boolean } | null>(null)
  const wheel = useRef(0)
  const d = p.duration > 0 ? p.duration : 1

  useEffect(() => {
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      p.onTrackRect?.({ left: el.offsetLeft, width: el.clientWidth })
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const xOf = (t: number) => (Math.max(0, Math.min(t, d)) / d) * width
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return (Math.max(0, Math.min(clientX - r.left, r.width)) / Math.max(1, r.width)) * d
  }
  const playheadX = xOf(p.time)

  const snapTime = (clientX: number, shift: boolean) => {
    const r = track.current!.getBoundingClientRect()
    const x = clientX - r.left
    if (!shift && Math.abs(x - playheadX) <= SNAP_PX) return quantize(p.time, p.frame, p.duration)
    return quantize(timeAt(clientX), p.frame, p.duration)
  }

  // esc cancels a snap drag (02 §14.6 step 3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || drag.current?.kind !== 'snap') return
      e.preventDefault()
      e.stopPropagation()
      drag.current = null
      p.onSnapCancel?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const onPointerDown = (e: React.PointerEvent) => {
    if (p.disabled || e.button !== 0) return
    e.preventDefault()
    const onSnap = (e.target as HTMLElement).closest('[data-test="snap-marker"]')
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind: onSnap ? 'snap' : 'track', startX: e.clientX, moved: false, shift: e.shiftKey }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const r = track.current?.getBoundingClientRect()
    if (r) setHoverX(Math.max(0, Math.min(e.clientX - r.left, r.width)))
    const g = drag.current
    if (!g) return
    if (!g.moved && Math.abs(e.clientX - g.startX) < 3) return
    if (!g.moved) {
      g.moved = true
      if (g.kind === 'track') p.onScrubStart()
    }
    if (g.kind === 'track') p.onScrub(quantize(timeAt(e.clientX), p.frame, p.duration))
    else p.onSnapDrag?.(snapTime(e.clientX, e.shiftKey))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const g = drag.current
    drag.current = null
    if (!g) return
    if (g.kind === 'track') {
      if (g.moved) p.onScrubEnd()
      else p.onSeek(quantize(timeAt(e.clientX), p.frame, p.duration))
    } else if (g.moved) p.onSnapCommit?.(snapTime(e.clientX, e.shiftKey))
    else p.onSnapClick?.()
  }

  const hoverTime = hoverX !== null ? (hoverX / Math.max(1, width)) * d : null
  const showPreroll = p.snap !== null && p.startPoint !== null && p.startPoint > 0
  return (
    <div
      className="scrubber"
      data-test="scrubber"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={p.duration}
      aria-valuenow={p.time}
      aria-valuetext={elapsedLabel(p.time, p.snap, p.timeMode, p.frame)}
      aria-disabled={p.disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={() => setHoverX(null)}
      onWheel={(e) => {
        if (!p.onFrameStep || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
        wheel.current += e.deltaX
        const n = Math.trunc(wheel.current / 6)
        if (n) {
          wheel.current -= n * 6
          p.onFrameStep(n)
        }
      }}
    >
      <div
        ref={track}
        className="scrubber__track"
        style={
          showPreroll
            ? { background: `linear-gradient(to right, var(--scrub-preroll) ${xOf(p.startPoint!)}px, var(--scrub-track) ${xOf(p.startPoint!)}px)` }
            : undefined
        }
      >
        <div className="scrubber__played" style={{ width: playheadX }} />
      </div>
      {hoverX !== null && !drag.current && !p.disabled && (
        <>
          <div className="scrubber__hover" style={{ left: (track.current?.offsetLeft ?? 0) + hoverX }} />
          <div className="scrubber__tip" style={{ left: (track.current?.offsetLeft ?? 0) + hoverX }}>
            {hoverTime !== null && (p.timeMode === 'snap' && p.snap !== null ? elapsedLabel(hoverTime, p.snap, 'snap', p.frame) : formatSeconds(hoverTime))}
          </div>
        </>
      )}
      {!p.disabled && <div className="scrubber__playhead" style={{ left: (track.current?.offsetLeft ?? 0) + playheadX }} />}
      {p.snap !== null && !p.disabled && (
        <div
          className="scrubber__snap"
          data-test="snap-marker"
          title={`Snap at ${p.snap.toFixed(2)} s · Drag to adjust`}
          style={{ left: (track.current?.offsetLeft ?? 0) + xOf(p.snap) }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            p.onSnapContextMenu?.(e)
          }}
        >
          <span className="scrubber__snap-tri" />
          <span className="scrubber__snap-bar" />
        </div>
      )}
    </div>
  )
}
