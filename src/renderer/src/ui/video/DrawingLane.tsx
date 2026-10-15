import { useEffect, useRef, useState } from 'react'
import { packLane, type Shape, shapeEnd } from '@shared/drawing'
import { quantize } from './frameLength'
import { elapsedLabel, formatSeconds } from './time'

/**
 * The drawing lane under the scrubber (02 §11.7): one span per shape of the active angle, packed into up to three
 * rows. Click selects (and seeks to a shape that isn't showing), dragging moves or trims a span in time, edges snap to
 * the playhead and the snap marker.
 */
export interface DrawingLaneProps {
  shapes: Shape[]
  duration: number
  frame: number
  time: number
  snap: number | null
  timeMode: 'snap' | 'clip'
  selectedId: string | null
  onSelect(shape: Shape): void
  /** Live while dragging. */
  onTimeChange(id: string, start: number, duration: number | null): void
  onTimeCommit(id: string): void
  onTimeCancel(): void
  onContextMenu(e: React.MouseEvent, shape: Shape): void
  /** The "+N" pill: shapes that fit in no row. */
  onHiddenMenu(anchor: Element, shapes: Shape[]): void
}

export const LANE_ROWS = 3
const SNAP_PX = 6

export function shapeName(s: Shape): string {
  switch (s.kind) {
    case 'pen':
      return 'Pen'
    case 'line':
      return s.end === 'arrow' ? 'Arrow' : 'Line'
    case 'ellipse':
      return 'Circle'
    case 'box':
      return 'Box'
    case 'spotlight':
      return 'Spotlight'
    case 'text':
      return `Text “${s.text.split('\n')[0].slice(0, 24)}”`
  }
}

/** "Arrow · 1.80–3.20 s", "Box · 1.80 s to end", "Text “Mug” · 1 frame" (times in the time mode). */
export function spanLabel(s: Shape, frame: number, snap: number | null, mode: 'snap' | 'clip'): string {
  const t = (v: number) => (mode === 'snap' && snap !== null ? elapsedLabel(v, snap, 'snap', frame) : formatSeconds(v))
  if (s.duration !== null && Math.abs(s.duration - frame) < frame / 4) return `${shapeName(s)} · 1 frame`
  if (s.duration === null) return `${shapeName(s)} · ${t(s.start)} s to end`
  return `${shapeName(s)} · ${t(s.start)}–${t(s.start + s.duration)} s`
}

export function laneRows(shapes: Shape[], duration: number): number {
  if (!shapes.length) return 1
  return Math.min(LANE_ROWS, Math.max(1, ...packLane(shapes, duration, LANE_ROWS).map((p) => p.row + 1)))
}

export function DrawingLane(p: DrawingLaneProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const drag = useRef<{ id: string; mode: 'move' | 'left' | 'right'; x0: number; start: number; duration: number | null; moved: boolean } | null>(null)
  const d = p.duration > 0 ? p.duration : 1

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.current) return
      e.preventDefault()
      e.stopPropagation()
      drag.current = null
      p.onTimeCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const packed = packLane(p.shapes, d, LANE_ROWS)
  const rows = laneRows(p.shapes, d)
  const hidden = packed.filter((x) => x.hidden).map((x) => x.shape)
  const px = (t: number) => (t / d) * width
  const snapEdge = (t: number, shift: boolean) => {
    if (shift) return t
    for (const target of [p.time, p.snap]) {
      if (target !== null && Math.abs(px(t) - px(target)) <= SNAP_PX) return target
    }
    return t
  }

  const onDown = (e: React.PointerEvent, s: Shape) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const mode = x < 6 ? 'left' : x > r.width - 6 ? 'right' : 'move'
    el.setPointerCapture(e.pointerId)
    drag.current = { id: s.id, mode, x0: e.clientX, start: s.start, duration: s.duration, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    if (!g.moved && Math.abs(e.clientX - g.x0) < 3) return
    g.moved = true
    const dt = ((e.clientX - g.x0) / Math.max(1, width)) * d
    const end = g.duration === null ? d : g.start + g.duration
    const q = (t: number) => quantize(t, p.frame, p.duration) - p.frame / 2
    if (g.mode === 'move') {
      const len = end - g.start
      let start = snapEdge(Math.max(0, g.start + dt), e.shiftKey)
      if (g.duration !== null) start = Math.min(start, d - len)
      else start = Math.min(start, d - p.frame)
      p.onTimeChange(g.id, Math.max(0, q(start)), g.duration)
    } else if (g.mode === 'left') {
      const start = Math.max(0, Math.min(q(snapEdge(g.start + dt, e.shiftKey)), end - p.frame))
      p.onTimeChange(g.id, start, g.duration === null ? null : end - start)
    } else {
      const raw = end + dt
      if (px(raw) >= width - SNAP_PX) p.onTimeChange(g.id, g.start, null)
      else {
        const newEnd = Math.max(g.start + p.frame, q(snapEdge(raw, e.shiftKey)))
        p.onTimeChange(g.id, g.start, newEnd - g.start)
      }
    }
  }
  const onUp = (s: Shape) => {
    const g = drag.current
    drag.current = null
    if (!g) return
    if (g.moved) p.onTimeCommit(g.id)
    else p.onSelect(s)
  }

  return (
    <div ref={ref} className="drawing-lane" data-test="drawing-lane" style={{ height: rows * 8 + (rows - 1) * 2 }}>
      {packed
        .filter((x) => !x.hidden || x.shape.id === p.selectedId)
        .map(({ row, shape }) => {
          const left = px(shape.start)
          const right = px(shapeEnd(shape, d))
          const toEnd = shape.duration === null
          return (
            <div
              key={shape.id}
              className="drawing-lane__span"
              data-test="drawing-span"
              data-shape-id={shape.id}
              data-selected={shape.id === p.selectedId || undefined}
              data-to-end={toEnd || undefined}
              title={spanLabel(shape, p.frame, p.snap, p.timeMode)}
              style={{ left, width: Math.max(6, right - left), top: row * 10, '--shape': shape.color } as React.CSSProperties}
              onPointerDown={(e) => onDown(e, shape)}
              onPointerMove={onMove}
              onPointerUp={() => onUp(shape)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                p.onContextMenu(e, shape)
              }}
            />
          )
        })}
      {hidden.length > 0 && (
        <button
          type="button"
          className="drawing-lane__more"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => p.onHiddenMenu(e.currentTarget, hidden)}
        >
          +{hidden.length}
        </button>
      )}
    </div>
  )
}
