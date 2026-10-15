import type { Angle } from './types'

export type ShapeKind = 'pen' | 'line' | 'ellipse' | 'box' | 'text' | 'spotlight'
export type LineEnd = 'none' | 'arrow' | 'block'

interface ShapeBase {
  /** crypto.randomUUID().slice(0, 8); migrated v1 strokes get 'v1-<index>'. */
  id: string
  kind: ShapeKind
  /** One of DRAW_COLORS[].hex. */
  color: string
  /** 2 | 4 | 6 for new shapes; v1 strokes keep 3. */
  width: number
  /** Clip time in seconds. */
  start: number
  /** Seconds; null = until the end of the clip. */
  duration: number | null
}
export interface PenShape extends ShapeBase {
  kind: 'pen'
  points: [number, number][]
  end: 'none' | 'arrow'
}
export interface LineShape extends ShapeBase {
  kind: 'line'
  from: [number, number]
  to: [number, number]
  end: LineEnd
}
export interface BoxShape extends ShapeBase {
  kind: 'ellipse' | 'box' | 'spotlight'
  x: number
  y: number
  w: number
  h: number
}
export interface TextShape extends ShapeBase {
  kind: 'text'
  x: number
  y: number
  text: string
  size: 18 | 24 | 32
}
export type Shape = PenShape | LineShape | BoxShape | TextShape

/** A v1 telestrator line: an arrowed freehand stroke shown for the whole clip. Only read by the migration. */
export interface LegacyStroke {
  color: string
  width: number
  points: [number, number][]
}

export type Drawing = Partial<Record<Angle, Shape[]>>

/** Film ink colors. Content on the picture (also burned into exported video), so they live here rather than in CSS. */
export const DRAW_COLORS: readonly { id: string; label: string; hex: string }[] = [
  { id: 'yellow', label: 'Yellow', hex: '#FFD60A' },
  { id: 'red', label: 'Red', hex: '#FF4D4D' },
  { id: 'blue', label: 'Blue', hex: '#4DD2FF' },
  { id: 'white', label: 'White', hex: '#FFFFFF' },
  { id: 'green', label: 'Green', hex: '#7CFC7C' }
]

const ANGLES: Angle[] = ['sideline', 'endzone', 'main']

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])

function base(o: Record<string, unknown>, fallbackId: string): Omit<ShapeBase, 'kind'> | null {
  if (typeof o.color !== 'string' || !isNum(o.width)) return null
  const start = o.start === undefined ? 0 : o.start
  const duration = o.duration === undefined ? null : o.duration
  if (!isNum(start) || (duration !== null && (!isNum(duration) || duration <= 0))) return null
  return { id: typeof o.id === 'string' && o.id ? o.id : fallbackId, color: o.color, width: o.width, start: Math.max(0, start), duration }
}

/** One stored shape (or v1 stroke) in the current form; null when it can't be read or its kind is unknown. */
export function migrateShape(raw: unknown, index: number): Shape | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.kind === undefined) {
    // A v1 Stroke: an arrowed pen line visible for the whole clip, exactly as v1 drew it.
    if (!Array.isArray(o.points) || !o.points.every(isPoint) || typeof o.color !== 'string' || !isNum(o.width)) return null
    return { id: `v1-${index}`, kind: 'pen', color: o.color, width: o.width, points: o.points, end: 'arrow', start: 0, duration: null }
  }
  const b = base(o, `s-${index}`)
  if (!b) return null
  switch (o.kind) {
    case 'pen':
      if (!Array.isArray(o.points) || !o.points.every(isPoint)) return null
      return { ...b, kind: 'pen', points: o.points, end: o.end === 'none' ? 'none' : 'arrow' }
    case 'line':
      if (!isPoint(o.from) || !isPoint(o.to)) return null
      return { ...b, kind: 'line', from: o.from, to: o.to, end: o.end === 'arrow' || o.end === 'block' ? o.end : 'none' }
    case 'ellipse':
    case 'box':
    case 'spotlight':
      if (![o.x, o.y, o.w, o.h].every(isNum)) return null
      return { ...b, kind: o.kind as 'ellipse' | 'box' | 'spotlight', x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number }
    case 'text':
      if (!isNum(o.x) || !isNum(o.y) || typeof o.text !== 'string') return null
      return { ...b, kind: 'text', x: o.x, y: o.y, text: o.text, size: o.size === 18 || o.size === 32 ? o.size : 24 }
    default:
      // A kind from a newer version: dropped quietly.
      return null
  }
}

/**
 * Reads a stored drawing (any version) into the current form. v1 strokes become arrowed pen shapes shown for the
 * whole clip; unknown kinds and malformed shapes are dropped, never a crash.
 */
export function migrateDrawing(raw: unknown): Drawing {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  const out: Drawing = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const angle of ANGLES) {
    const list = (value as Record<string, unknown>)[angle]
    if (!Array.isArray(list)) continue
    const shapes: Shape[] = []
    list.forEach((item, i) => {
      const s = migrateShape(item, i)
      if (s) shapes.push(s)
      else if (item && typeof item === 'object' && 'kind' in item && isKnownKind((item as { kind: unknown }).kind)) {
        console.warn('Dropped a drawing shape that could not be read', item)
      }
    })
    if (shapes.length) out[angle] = shapes
  }
  return out
}

const KINDS = new Set<string>(['pen', 'line', 'ellipse', 'box', 'text', 'spotlight'])
const isKnownKind = (k: unknown) => typeof k === 'string' && KINDS.has(k)

/** The end of a shape's time range in clip seconds (the clip's end for "until end of clip"). */
export function shapeEnd(shape: Shape, clipDuration: number): number {
  return shape.duration === null ? clipDuration : shape.start + shape.duration
}

/**
 * Whether a shape shows at clip time `t`. With ε half a frame, visible when t ≥ start − ε and (no duration or
 * t < start + duration − ε), so "This Frame Only" (duration = one frame) covers exactly the frame it was drawn on.
 */
export function shapeVisibleAt(shape: Shape, t: number, frame: number): boolean {
  const e = frame / 2
  if (t < shape.start - e) return false
  return shape.duration === null || t < shape.start + shape.duration - e
}

/**
 * Packs time spans into lane rows: greedily in start order into the first row where they don't overlap. Spans that
 * fit nowhere go into the last row anyway and are marked `hidden` (the lane's "+N" menu lists them).
 */
export function packLane(shapes: Shape[], clipDuration: number, maxRows: number): { row: number; shape: Shape; hidden?: boolean }[] {
  const rows: number[] = [] // end time of the last span in each row
  const sorted = [...shapes].sort((a, b) => a.start - b.start)
  return sorted.map((shape) => {
    const end = Math.max(shapeEnd(shape, clipDuration), shape.start)
    let row = rows.findIndex((last) => last <= shape.start)
    if (row === -1 && rows.length < maxRows) row = rows.push(end) - 1
    else if (row !== -1) rows[row] = end
    if (row === -1) return { row: Math.max(0, maxRows - 1), shape, hidden: true }
    return { row, shape }
  })
}

/**
 * Time points where the visible set of shapes may change within [from, to): every shape's start and end. Used to cut
 * an exported segment into overlay intervals.
 */
export function visibilityBreaks(shapes: Shape[], from: number, to: number, clipDuration: number): number[] {
  const out = new Set<number>([from])
  for (const s of shapes) {
    for (const t of [s.start, shapeEnd(s, clipDuration)]) if (t > from && t < to) out.add(t)
  }
  return [...out].sort((a, b) => a - b)
}
