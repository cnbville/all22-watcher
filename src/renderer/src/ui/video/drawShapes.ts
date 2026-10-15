import { type Shape, shapeVisibleAt } from '@shared/drawing'

/**
 * Renders drawing shapes onto a 2D context (02 §11.6). Uses only CanvasRenderingContext2D, so it also runs on an
 * OffscreenCanvas for Copy Frame and for burning drawings into exported video. Coordinates are fractions of the
 * picture rectangle; sizes scale with the picture (`k = height / 720`).
 */

export interface PictureRect {
  x: number
  y: number
  w: number
  h: number
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export const SPOTLIGHT_DIM = 'rgba(0,0,0,0.55)'
const SHADOW = 'rgba(0,0,0,0.6)'
const TEXT_PLATE = 'rgba(0,0,0,0.6)'
const TEXT_FONT = '-apple-system, BlinkMacSystemFont, "Inter Variable", system-ui, sans-serif'

export interface DrawOptions {
  /** Shapes drawn even when not visible at `t`, at 35% opacity (the selected shape in Draw mode). */
  ghost?: string | null
  /** Drawn on top as-is regardless of time (a shape being drawn). */
  draft?: Shape | null
}

/** Draws every shape visible at clip time `t` into `picture`. Spotlights dim the film first, then shapes in z-order. */
export function drawShapes(ctx: Ctx, shapes: readonly Shape[], picture: PictureRect, t: number, frame: number, opts: DrawOptions = {}) {
  const k = picture.h / 720
  const visible = shapes.filter((s) => shapeVisibleAt(s, t, frame) || s.id === opts.ghost)
  const all = opts.draft ? [...visible, opts.draft] : visible
  const isGhost = (s: Shape) => s.id === opts.ghost && !shapeVisibleAt(s, t, frame)

  const spots = all.filter((s) => s.kind === 'spotlight' && !isGhost(s))
  if (spots.length) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(picture.x, picture.y, picture.w, picture.h)
    for (const s of spots) {
      if (s.kind !== 'spotlight') continue
      const r = boxRect(s, picture)
      ctx.moveTo(r.cx + r.rx, r.cy)
      ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, Math.PI * 2)
    }
    ctx.fillStyle = SPOTLIGHT_DIM
    ctx.fill('evenodd')
    ctx.restore()
  }

  for (const s of all) {
    ctx.save()
    if (isGhost(s)) ctx.globalAlpha = 0.35
    drawOne(ctx, s, picture, k)
    ctx.restore()
  }
}

function boxRect(s: { x: number; y: number; w: number; h: number }, p: PictureRect) {
  const x = p.x + Math.min(s.x, s.x + s.w) * p.w
  const y = p.y + Math.min(s.y, s.y + s.h) * p.h
  const w = Math.abs(s.w) * p.w
  const h = Math.abs(s.h) * p.h
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, rx: Math.max(0.5, w / 2), ry: Math.max(0.5, h / 2) }
}

const pt = (p: PictureRect, [x, y]: [number, number]): [number, number] => [p.x + x * p.w, p.y + y * p.h]

function stroke(ctx: Ctx, s: Shape, k: number) {
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = Math.max(1.5, s.width * k)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = SHADOW
  ctx.shadowBlur = 3 * k
}

function drawEnd(ctx: Ctx, end: 'none' | 'arrow' | 'block', tip: [number, number], from: [number, number], width: number, k: number) {
  if (end === 'none') return
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0])
  if (end === 'arrow') {
    const size = (6 + 2 * width) * k
    ctx.beginPath()
    ctx.moveTo(tip[0], tip[1])
    ctx.lineTo(tip[0] - size * Math.cos(angle - 0.45), tip[1] - size * Math.sin(angle - 0.45))
    ctx.lineTo(tip[0] - size * Math.cos(angle + 0.45), tip[1] - size * Math.sin(angle + 0.45))
    ctx.closePath()
    ctx.fill()
  } else {
    const half = ((8 + 4 * width) * k) / 2
    const px = Math.cos(angle + Math.PI / 2)
    const py = Math.sin(angle + Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(tip[0] - px * half, tip[1] - py * half)
    ctx.lineTo(tip[0] + px * half, tip[1] + py * half)
    ctx.stroke()
  }
}

function drawOne(ctx: Ctx, s: Shape, p: PictureRect, k: number) {
  switch (s.kind) {
    case 'pen': {
      if (s.points.length < 2) return
      const pts = s.points.map((q) => pt(p, q))
      stroke(ctx, s, k)
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
      ctx.stroke()
      drawEnd(ctx, s.end, pts[pts.length - 1], pts[Math.max(0, pts.length - 6)], s.width, k)
      return
    }
    case 'line': {
      const a = pt(p, s.from)
      const b = pt(p, s.to)
      stroke(ctx, s, k)
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
      drawEnd(ctx, s.end, b, a, s.width, k)
      return
    }
    case 'ellipse':
    case 'spotlight': {
      const r = boxRect(s, p)
      stroke(ctx, s, k)
      ctx.beginPath()
      ctx.ellipse(r.cx, r.cy, r.rx, r.ry, 0, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    case 'box': {
      const r = boxRect(s, p)
      stroke(ctx, s, k)
      ctx.beginPath()
      roundRect(ctx, r.x, r.y, r.w, r.h, 2 * k)
      ctx.stroke()
      return
    }
    case 'text': {
      if (!s.text) return
      const size = s.size * k
      ctx.font = `600 ${size}px ${TEXT_FONT}`
      ctx.textBaseline = 'top'
      const lines = s.text.split('\n')
      const lineH = size * 1.2
      const padX = 8 * k
      const padY = 4 * k
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2
      const h = lines.length * lineH + padY * 2
      const [x, y] = pt(p, [s.x, s.y])
      ctx.fillStyle = TEXT_PLATE
      ctx.beginPath()
      roundRect(ctx, x, y, w, h, 4 * k)
      ctx.fill()
      ctx.fillStyle = s.color
      lines.forEach((l, i) => ctx.fillText(l, x + padX, y + padY + i * lineH + (lineH - size) / 2))
      return
    }
  }
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** The text plate's size in picture fractions, for hit testing and handles (needs a 2D context to measure). */
export function textBox(ctx: Ctx, s: Extract<Shape, { kind: 'text' }>, p: PictureRect): { x: number; y: number; w: number; h: number } {
  const k = p.h / 720
  const size = s.size * k
  ctx.font = `600 ${size}px ${TEXT_FONT}`
  const lines = (s.text || ' ').split('\n')
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16 * k
  const h = lines.length * size * 1.2 + 8 * k
  return { x: s.x, y: s.y, w: w / p.w, h: h / p.h }
}
