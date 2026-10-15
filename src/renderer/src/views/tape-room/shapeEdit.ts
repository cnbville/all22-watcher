import type { BoxShape, LineShape, PenShape, Shape } from '@shared/drawing'

/**
 * Pure geometry for the drawing tools (02 §11.3–§11.5): building shapes from a drag, minimum sizes, ⇧/⌥ modifiers,
 * hit testing, handles, moving and resizing, and pen simplification. Points are picture units (0–1); thresholds are
 * pixels, so callers pass the picture size.
 */

export type Pt = [number, number]
export interface Size {
  w: number
  h: number
}
export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'from' | 'to'

const dist = (a: Pt, b: Pt, px: Size) => Math.hypot((a[0] - b[0]) * px.w, (a[1] - b[1]) * px.h)

/** Distance in px from p to the segment ab. */
export function segmentDistance(p: Pt, a: Pt, b: Pt, px: Size): number {
  const ax = a[0] * px.w
  const ay = a[1] * px.h
  const bx = b[0] * px.w
  const by = b[1] * px.h
  const x = p[0] * px.w
  const y = p[1] * px.h
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

/** ⇧ with Arrow and Line: the end snaps to 45° steps (in screen space). */
export function snap45(from: Pt, to: Pt, px: Size): Pt {
  const dx = (to[0] - from[0]) * px.w
  const dy = (to[1] - from[1]) * px.h
  const len = Math.hypot(dx, dy)
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return [from[0] + (Math.cos(a) * len) / px.w, from[1] + (Math.sin(a) * len) / px.h]
}

/** The box dragged from `a` to `b`: ⇧ makes it square (a circle in px), ⌥ draws from the center. */
export function dragBox(a: Pt, b: Pt, px: Size, mods: { shift?: boolean; alt?: boolean }): Box {
  let dx = (b[0] - a[0]) * px.w
  let dy = (b[1] - a[1]) * px.h
  if (mods.shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * m
    dy = Math.sign(dy || 1) * m
  }
  if (mods.alt) {
    return { x: a[0] - Math.abs(dx) / px.w, y: a[1] - Math.abs(dy) / px.h, w: (2 * Math.abs(dx)) / px.w, h: (2 * Math.abs(dy)) / px.h }
  }
  const x2 = a[0] + dx / px.w
  const y2 = a[1] + dy / px.h
  return { x: Math.min(a[0], x2), y: Math.min(a[1], y2), w: Math.abs(x2 - a[0]), h: Math.abs(y2 - a[1]) }
}

/** Ramer–Douglas–Peucker in picture units (epsilon 0.002, 02 §11.3). */
export function simplify(points: Pt[], epsilon = 0.002): Pt[] {
  if (points.length < 3) return points
  const unit = { w: 1, h: 1 }
  let max = 0
  let idx = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points[points.length - 1], unit)
    if (d > max) {
      max = d
      idx = i
    }
  }
  if (max <= epsilon) return [points[0], points[points.length - 1]]
  const left = simplify(points.slice(0, idx + 1), epsilon)
  const right = simplify(points.slice(idx), epsilon)
  return [...left.slice(0, -1), ...right]
}

export function penLength(points: Pt[], px: Size): number {
  let n = 0
  for (let i = 1; i < points.length; i++) n += dist(points[i - 1], points[i], px)
  return n
}

/** Whether a finished gesture is big enough to make a shape (02 §11.3 minimums). */
export function bigEnough(s: Shape, px: Size): boolean {
  switch (s.kind) {
    case 'pen':
      return s.points.length >= 2 && penLength(s.points, px) >= 4
    case 'line':
      return dist(s.from, s.to, px) >= 6
    case 'spotlight':
      return s.w * px.w >= 12 && s.h * px.h >= 12
    case 'ellipse':
    case 'box':
      return s.w * px.w >= 6 && s.h * px.h >= 6
    case 'text':
      return s.text.trim().length > 0
  }
}

/** Bounding box of a shape in picture units; text needs its measured box. */
export function shapeBounds(s: Shape, text?: (s: Extract<Shape, { kind: 'text' }>) => Box): Box {
  switch (s.kind) {
    case 'pen': {
      const xs = s.points.map((p) => p[0])
      const ys = s.points.map((p) => p[1])
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
    }
    case 'line': {
      const x = Math.min(s.from[0], s.to[0])
      const y = Math.min(s.from[1], s.to[1])
      return { x, y, w: Math.abs(s.to[0] - s.from[0]), h: Math.abs(s.to[1] - s.from[1]) }
    }
    case 'text':
      return text ? text(s) : { x: s.x, y: s.y, w: 0.1, h: 0.05 }
    default:
      return { x: s.x, y: s.y, w: s.w, h: s.h }
  }
}

/** Whether `p` hits the shape (02 §11.5): strokes within max(6px, width), outlines within 6px, filled kinds inside. */
export function hitShape(s: Shape, p: Pt, px: Size, text?: (s: Extract<Shape, { kind: 'text' }>) => Box): boolean {
  const tol = Math.max(6, s.width)
  switch (s.kind) {
    case 'pen':
      if (s.points.length === 1) return dist(s.points[0], p, px) <= tol
      for (let i = 1; i < s.points.length; i++) if (segmentDistance(p, s.points[i - 1], s.points[i], px) <= tol) return true
      return false
    case 'line':
      return segmentDistance(p, s.from, s.to, px) <= tol
    case 'box': {
      const x = p[0] * px.w
      const y = p[1] * px.h
      const l = s.x * px.w
      const t = s.y * px.h
      const r = (s.x + s.w) * px.w
      const b = (s.y + s.h) * px.h
      const inOuter = x >= l - 6 && x <= r + 6 && y >= t - 6 && y <= b + 6
      const inInner = x > l + 6 && x < r - 6 && y > t + 6 && y < b - 6
      return inOuter && !inInner
    }
    case 'ellipse': {
      const rx = (s.w / 2) * px.w
      const ry = (s.h / 2) * px.h
      const cx = (s.x + s.w / 2) * px.w
      const cy = (s.y + s.h / 2) * px.h
      const x = p[0] * px.w - cx
      const y = p[1] * px.h - cy
      // Approximate distance to the outline by the normalized radius.
      const r = Math.hypot(x / Math.max(rx, 1), y / Math.max(ry, 1))
      return Math.abs(r - 1) * Math.max(1, Math.min(rx, ry)) <= 6
    }
    case 'spotlight': {
      const rx = s.w / 2
      const ry = s.h / 2
      const x = (p[0] - (s.x + rx)) / (rx || 1e-6)
      const y = (p[1] - (s.y + ry)) / (ry || 1e-6)
      return x * x + y * y <= 1
    }
    case 'text': {
      const b = shapeBounds(s, text)
      return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h
    }
  }
}

/** The topmost shape under `p` among those given (later shapes are on top). */
export function hitTest(shapes: readonly Shape[], p: Pt, px: Size, text?: (s: Extract<Shape, { kind: 'text' }>) => Box): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitShape(shapes[i], p, px, text)) return shapes[i]
  return null
}

/** The handles a selected shape shows: 8 for boxes, both ends for lines, none (move only) for pens and text. */
export function handlesOf(s: Shape): { id: Handle; at: Pt }[] {
  if (s.kind === 'line') {
    return [
      { id: 'from', at: s.from },
      { id: 'to', at: s.to }
    ]
  }
  if (s.kind === 'pen' || s.kind === 'text') return []
  const { x, y, w, h } = s
  return [
    { id: 'nw', at: [x, y] },
    { id: 'n', at: [x + w / 2, y] },
    { id: 'ne', at: [x + w, y] },
    { id: 'e', at: [x + w, y + h / 2] },
    { id: 'se', at: [x + w, y + h] },
    { id: 's', at: [x + w / 2, y + h] },
    { id: 'sw', at: [x, y + h] },
    { id: 'w', at: [x, y + h / 2] }
  ]
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  from: 'move',
  to: 'move'
}

export function moveShape<S extends Shape>(s: S, dx: number, dy: number): S {
  switch (s.kind) {
    case 'pen':
      return { ...s, points: (s as PenShape).points.map(([x, y]) => [x + dx, y + dy] as Pt) }
    case 'line':
      return { ...s, from: [(s as LineShape).from[0] + dx, (s as LineShape).from[1] + dy], to: [(s as LineShape).to[0] + dx, (s as LineShape).to[1] + dy] }
    default:
      return { ...s, x: (s as BoxShape).x + dx, y: (s as BoxShape).y + dy }
  }
}

/** Drags a handle of `orig` to `p` (⇧ keeps proportions, ⌥ resizes from the center; ⇧ snaps line ends to 45°). */
export function resizeShape(orig: Shape, handle: Handle, p: Pt, px: Size, mods: { shift?: boolean; alt?: boolean }): Shape {
  if (orig.kind === 'line') {
    if (handle === 'from') return { ...orig, from: mods.shift ? snap45(orig.to, p, px) : p }
    if (handle === 'to') return { ...orig, to: mods.shift ? snap45(orig.from, p, px) : p }
    return orig
  }
  if (orig.kind === 'pen' || orig.kind === 'text') return orig
  let l = orig.x
  let t = orig.y
  let r = orig.x + orig.w
  let b = orig.y + orig.h
  const cx = (l + r) / 2
  const cy = (t + b) / 2
  if (handle.includes('w')) l = p[0]
  if (handle.includes('e')) r = p[0]
  if (handle.includes('n')) t = p[1]
  if (handle.includes('s')) b = p[1]
  if (mods.alt) {
    if (handle.includes('w')) r = 2 * cx - l
    if (handle.includes('e')) l = 2 * cx - r
    if (handle.includes('n')) b = 2 * cy - t
    if (handle.includes('s')) t = 2 * cy - b
  }
  if (mods.shift && orig.w > 0 && orig.h > 0 && handle.length === 2) {
    const ratio = (orig.w * px.w) / (orig.h * px.h)
    const wpx = Math.abs(r - l) * px.w
    const hpx = Math.abs(b - t) * px.h
    if (wpx / hpx > ratio) {
      const nh = wpx / ratio / px.h
      if (handle.includes('n')) t = b - Math.sign(b - t || 1) * nh
      else b = t + Math.sign(b - t || 1) * nh
    } else {
      const nw = (hpx * ratio) / px.w
      if (handle.includes('w')) l = r - Math.sign(r - l || 1) * nw
      else r = l + Math.sign(r - l || 1) * nw
    }
  }
  return { ...orig, x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) }
}
