import { type Shape, shapeEnd, shapeVisibleAt } from '@shared/drawing'
import type { ExportItemData, ExportOverlay, ExportPlan, ExportSegment, ExportVideoRequest } from '@shared/exportVideo'
import type { Angle } from '@shared/types'
import { ink } from '../../ui/heat'
import { teamMarkFor } from '../../ui/teamMark'
import { paintShapes } from '../shared/reel/drawShapes'

/**
 * Burn-ins for Export Video (03 §11.4–§11.5), drawn here with the app's fonts into transparent PNGs the size of the
 * output frame. Main overlays them with ffmpeg. The sheet's preview calls the same painters on a small canvas, so
 * what the preview shows is what the file gets. Geometry is for 1080p and scales by k = H / 1080.
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const FONT = "-apple-system, BlinkMacSystemFont, 'Inter Variable', system-ui, sans-serif"
const PLATE = 'rgba(18, 18, 20, 0.72)'
const WHITE = '#FFFFFF'
const SECONDARY = 'rgba(255, 255, 255, 0.72)'
const DESCRIPTION = 'rgba(255, 255, 255, 0.80)'
const TERTIARY = 'rgba(255, 255, 255, 0.56)'
const CARD_BG = '#121214'
/** Lucide `zap` on a 24 grid. */
const ZAP = 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'
const ANGLE_LABEL: Record<Angle, string> = { sideline: 'Sideline', endzone: 'End Zone', main: 'Main' }
/** At most this many drawing PNGs per segment; more intervals merge (03 §11.5). */
export const MAX_DRAWING_OVERLAYS = 48

const font = (weight: number, px: number) => `${weight} ${px}px ${FONT}`

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2))
}

function plate(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, r)
  ctx.fillStyle = PLATE
  ctx.fill()
}

/** Cuts text to fit `max` pixels with an ellipsis. */
function fit(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= max) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, lo).trimEnd()}…`
}

/** Word-wraps into at most `lines` lines, the last one with an ellipsis when cut. */
export function wrap(measure: (s: string) => number, text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let cur = ''
  let i = 0
  for (; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]
    if (measure(next) <= max || !cur) cur = next
    else {
      out.push(cur)
      cur = words[i]
      if (out.length === lines) break
    }
  }
  if (out.length < lines && cur) {
    out.push(cur)
    i = words.length
  }
  if (i < words.length || (out.length && measure(out[out.length - 1]) > max)) {
    let last = out[out.length - 1]
    while (last && measure(`${last}…`) > max) last = last.slice(0, -1)
    out[out.length - 1] = `${last.trimEnd()}…`
  }
  return out
}

const gradeScore = (g: -1 | 0 | 1) => (g === 1 ? 100 : g === 0 ? 50 : 0)
const glyph = (g: -1 | 0 | 1) => (g === 1 ? '+' : g === 0 ? '0' : '−')

export interface StaticInput {
  W: number
  H: number
  seg: ExportSegment
  item: ExportItemData | undefined
  total: number
  burnIn: ExportVideoRequest['burnIn']
  /** Whether a player is chosen (the grade and name need one). */
  player: boolean
}

/** Whether a segment gets a static overlay at all. */
export function hasStatic(i: StaticInput): boolean {
  const b = i.burnIn
  return (
    (b.name && i.player && !!i.item?.player) ||
    (b.grade && i.player && i.item?.grade != null) ||
    b.number ||
    (b.caption && !!i.item?.caption) ||
    i.seg.layout === 'sideBySide'
  )
}

/** Player name, grade, play number, caption and Side by Side angle labels. */
export function paintStatic(ctx: Ctx, i: StaticInput) {
  const { W, H, seg, item, burnIn: b } = i
  const k = H / 1080
  const m = 48 * k
  ctx.textBaseline = 'middle'

  // Player name, top-left.
  if (b.name && i.player && item?.player) {
    const p = item.player
    const h = 56 * k
    ctx.font = font(600, 30 * k)
    const nameW = ctx.measureText(p.name).width
    const meta = [p.jersey ? `#${p.jersey}` : '', [p.position, p.team].filter(Boolean).join(' · ')].filter(Boolean).join(' ')
    ctx.font = font(400, 24 * k)
    const metaW = meta ? ctx.measureText(meta).width : 0
    const w = Math.min(W - 2 * m - 120 * k, 24 * k + nameW + (meta ? 12 * k + metaW : 0) + 20 * k)
    ctx.save()
    roundRect(ctx, m, m, w, h, 12 * k)
    ctx.fillStyle = PLATE
    ctx.fill()
    ctx.clip()
    ctx.fillStyle = teamMarkFor(p.team) || p.color || WHITE
    ctx.fillRect(m, m, 4 * k, h)
    ctx.restore()
    ctx.textAlign = 'left'
    ctx.fillStyle = WHITE
    ctx.font = font(600, 30 * k)
    ctx.fillText(fit(ctx, p.name, w - 44 * k), m + 24 * k, m + h / 2)
    if (meta && 24 * k + nameW + 12 * k + metaW + 20 * k <= w + 0.5) {
      ctx.fillStyle = SECONDARY
      ctx.font = font(400, 24 * k)
      ctx.fillText(meta, m + 24 * k + nameW + 12 * k, m + h / 2 + 1 * k)
    }
  }

  // Grade, top-right.
  const gradeSlot = b.grade && i.player
  const gx = W - m - 80 * k
  if (gradeSlot && item && item.grade !== null) {
    const color = ink(gradeScore(item.grade))
    plate(ctx, gx, m, 80 * k, 80 * k, 18 * k)
    roundRect(ctx, gx + 1.5 * k, m + 1.5 * k, 77 * k, 77 * k, 16.5 * k)
    ctx.strokeStyle = color
    ctx.lineWidth = 3 * k
    ctx.stroke()
    ctx.fillStyle = color
    ctx.font = font(700, 52 * k)
    ctx.textAlign = 'center'
    ctx.fillText(glyph(item.grade), gx + 40 * k, m + 40 * k + 2 * k)
    if (item.critical) {
      const s = (22 * k) / 24
      ctx.save()
      ctx.translate(gx + 80 * k - 8 * k - 22 * k, m + 80 * k - 8 * k - 22 * k)
      ctx.scale(s, s)
      ctx.fill(new Path2D(ZAP))
      ctx.restore()
    }
  }

  // Play number, under the grade (or in its place).
  if (b.number) {
    const text = `${seg.number} / ${i.total}`
    ctx.font = font(500, 24 * k)
    const w = ctx.measureText(text).width + 28 * k
    const h = 40 * k
    const y = gradeSlot ? m + 80 * k + 12 * k : m
    plate(ctx, W - m - w, y, w, h, 12 * k)
    ctx.fillStyle = SECONDARY
    ctx.textAlign = 'center'
    ctx.fillText(text, W - m - w / 2, y + h / 2 + 1 * k)
  }

  // Caption, bottom-left.
  if (b.caption && item?.caption) {
    const maxW = Math.min(1200 * k, W - 2 * m)
    const inner = maxW - 48 * k
    ctx.font = font(600, 30 * k)
    const line1 = fit(ctx, item.caption, inner)
    let w = ctx.measureText(line1).width
    let lines: string[] = []
    if (b.description && item.description) {
      ctx.font = font(400, 24 * k)
      lines = wrap((s) => ctx.measureText(s).width, item.description, inner, 2)
      w = Math.max(w, ...lines.map((l) => ctx.measureText(l).width))
    }
    const h = 32 * k + 38 * k + (lines.length ? 6 * k + lines.length * 32 * k : 0)
    const pw = Math.min(maxW, w + 48 * k)
    const y = H - m - h
    plate(ctx, m, y, pw, h, 12 * k)
    ctx.textAlign = 'left'
    ctx.fillStyle = WHITE
    ctx.font = font(600, 30 * k)
    ctx.fillText(line1, m + 24 * k, y + 16 * k + 19 * k)
    ctx.fillStyle = DESCRIPTION
    ctx.font = font(400, 24 * k)
    lines.forEach((l, n) => ctx.fillText(l, m + 24 * k, y + 16 * k + 38 * k + 6 * k + n * 32 * k + 16 * k))
  }

  // Angle labels, Side by Side.
  if (seg.layout === 'sideBySide') {
    for (const p of seg.parts) {
      const text = ANGLE_LABEL[p.angle]
      ctx.font = font(500, 20 * k)
      const w = ctx.measureText(text).width + 20 * k
      const h = 32 * k
      plate(ctx, p.rect.x + 12 * k, p.rect.y + 12 * k, w, h, 8 * k)
      ctx.fillStyle = SECONDARY
      ctx.textAlign = 'left'
      ctx.fillText(text, p.rect.x + 22 * k, p.rect.y + 12 * k + h / 2 + 1 * k)
    }
  }
}

/** The title card: a team bar (player sources), the title and two lines, centered on the app's dark background. */
export function paintTitleCard(ctx: Ctx, W: number, H: number, card: ExportPlan['titleCard'], barColor: string | null) {
  const k = H / 1080
  ctx.fillStyle = CARD_BG
  ctx.fillRect(0, 0, W, H)
  const rows: { h: number; draw: (y: number) => void }[] = []
  if (barColor) {
    rows.push({
      h: 120 * k + 24 * k,
      draw: (y) => {
        ctx.fillStyle = barColor
        ctx.beginPath()
        ctx.roundRect(W / 2 - 3 * k, y, 6 * k, 120 * k, 3 * k)
        ctx.fill()
      }
    })
  }
  const text = (s: string, weight: number, px: number, color: string, lh: number, after: number) =>
    s &&
    rows.push({
      h: lh + after,
      draw: (y) => {
        ctx.font = font(weight, px)
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(fit(ctx, s, W - 192 * k), W / 2, y + lh / 2)
      }
    })
  text(card.title, 700, 64 * k, WHITE, 76 * k, 12 * k)
  text(card.line2, 400, 32 * k, SECONDARY, 40 * k, 8 * k)
  text(card.line3, 400, 28 * k, TERTIARY, 34 * k, 0)
  const total = rows.reduce((s, r) => s + r.h, 0)
  let y = (H - total) / 2
  for (const r of rows) {
    r.draw(y)
    y += r.h
  }
}

// ── Drawings ─────────────────────────────────────────────────────────────

export interface DrawingInterval {
  from: number
  to: number
  /** Per part index, the shapes visible in this interval. */
  shapes: Shape[][]
}

/**
 * Cuts a segment's local time [0, duration) at every shape start and end of every pane and returns the intervals
 * with at least one visible shape; neighbours with the same visible set merge, and past `max` the shortest merge
 * into a neighbour.
 */
export function drawingIntervals(seg: ExportSegment, drawing: ExportItemData['drawing'], fps: number, max = MAX_DRAWING_OVERLAYS): DrawingInterval[] {
  if (!drawing) return []
  const frame = 1 / fps
  const panes = seg.parts.map((p) => ({ part: p, shapes: drawing[p.angle] ?? [] }))
  if (!panes.some((p) => p.shapes.length)) return []
  const cuts = new Set<number>([0, seg.duration])
  for (const { part, shapes } of panes) {
    for (const s of shapes) {
      for (const t of [s.start, shapeEnd(s, part.duration)]) {
        const local = t - part.in
        if (local > 0 && local < seg.duration) cuts.add(Math.round(local * 1000) / 1000)
      }
    }
  }
  const points = [...cuts].sort((a, b) => a - b)
  const out: (DrawingInterval & { key: string })[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    if (to - from < 1e-6) continue
    const mid = (from + to) / 2
    const shapes = panes.map(({ part, shapes: list }) => list.filter((s) => shapeVisibleAt(s, part.in + mid, frame)))
    const key = shapes.map((l) => l.map((s) => s.id).join(',')).join('|')
    if (!shapes.some((l) => l.length)) continue
    const prev = out[out.length - 1]
    if (prev && prev.key === key && Math.abs(prev.to - from) < 1e-6) prev.to = to
    else out.push({ from, to, shapes, key })
  }
  while (out.length > max) {
    let shortest = 0
    for (let i = 1; i < out.length; i++) if (out[i].to - out[i].from < out[shortest].to - out[shortest].from) shortest = i
    const into = shortest + 1 < out.length ? shortest + 1 : shortest - 1
    const a = out[Math.min(shortest, into)]
    const b = out[Math.max(shortest, into)]
    const keep = into > shortest ? b : a
    const merged = { ...keep, from: a.from, to: b.to }
    out.splice(Math.min(shortest, into), 2, merged)
  }
  return out.map(({ from, to, shapes }) => ({ from, to, shapes }))
}

/** Draws one interval's shapes into each pane's picture rectangle. */
export function paintDrawings(ctx: Ctx, seg: ExportSegment, interval: DrawingInterval, fps: number) {
  const mid = (interval.from + interval.to) / 2
  seg.parts.forEach((p, i) => {
    const shapes = interval.shapes[i]
    if (!shapes?.length) return
    ctx.save()
    ctx.beginPath()
    ctx.rect(p.rect.x, p.rect.y, p.rect.w, p.rect.h)
    ctx.clip()
    paintShapes(ctx, shapes, p.in + mid, p.rect, 1 / fps)
    ctx.restore()
  })
}

// ── The whole set ────────────────────────────────────────────────────────

/** Fonts used on the plates are loaded before the first draw (a cold canvas would fall back silently). */
async function fontsReady() {
  try {
    await Promise.all([font(400, 24), font(500, 24), font(600, 30), font(700, 52)].map((f) => document.fonts.load(f)))
  } catch {
    // Drawing with the fallback font is still correct.
  }
}

async function toPng(canvas: OffscreenCanvas): Promise<ArrayBuffer> {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blob.arrayBuffer()
}

/** Every overlay PNG for an export: per segment one static plate layer and the drawing intervals; segment −1 is the title card. */
export async function renderOverlays(plan: ExportPlan, req: ExportVideoRequest, data: ExportItemData[] = plan.items): Promise<ExportOverlay[]> {
  await fontsReady()
  const W = plan.width
  const H = plan.height
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Couldn’t draw the overlays.')
  const byRef = new Map(data.map((d) => [`${d.ref.gameId}:${d.ref.playId}`, d]))
  const hold = req.between === 'hold1' ? 1 : 0
  const out: ExportOverlay[] = []

  if (req.burnIn.titleCard && plan.segments.length) {
    ctx.clearRect(0, 0, W, H)
    paintTitleCard(ctx, W, H, plan.titleCard, req.source.kind === 'player' ? titleBar(plan) : null)
    out.push({ segment: -1, from: 0, to: 2.5, png: await toPng(canvas) })
  }

  for (const seg of plan.segments) {
    const item = byRef.get(`${seg.ref.gameId}:${seg.ref.playId}`)
    const input: StaticInput = { W, H, seg, item, total: plan.playCount, burnIn: req.burnIn, player: !!req.playerId }
    if (hasStatic(input)) {
      ctx.clearRect(0, 0, W, H)
      paintStatic(ctx, input)
      out.push({ segment: seg.index, from: 0, to: seg.duration + hold, png: await toPng(canvas) })
    }
    if (req.burnIn.drawings && item?.drawing) {
      for (const iv of drawingIntervals(seg, item.drawing, plan.fps)) {
        ctx.clearRect(0, 0, W, H)
        paintDrawings(ctx, seg, iv, plan.fps)
        // The last interval of a held segment stays through the hold.
        const to = iv.to >= seg.duration - 1e-6 ? iv.to + hold : iv.to
        out.push({ segment: seg.index, from: iv.from, to, png: await toPng(canvas) })
      }
    }
  }
  return out
}

/** The team mark color for a player source's title card bar. */
export function titleBar(plan: ExportPlan): string | null {
  const team = plan.items.find((i) => i.player)?.player?.team
  return team ? teamMarkFor(team) : plan.titleCard.color
}
