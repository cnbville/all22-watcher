import { type Shape, shapeVisibleAt } from '@shared/drawing'

/**
 * Read-only drawings for the reel players (03 §2.6): draws the shapes visible at clip time `t` over the video's
 * letterboxed rect. Coordinates are 0–1 of the picture. The tape room's full renderer (02 §11.6) can replace this
 * once it lands in a shared folder; the signature is kept small on purpose.
 */

export interface VideoRect {
  x: number
  y: number
  w: number
  h: number
}

/** The picture's rect inside a box, letterboxed (object-fit: contain). */
export function letterbox(boxW: number, boxH: number, videoW: number, videoH: number): VideoRect {
  if (!videoW || !videoH) return { x: 0, y: 0, w: boxW, h: boxH }
  const scale = Math.min(boxW / videoW, boxH / videoH)
  const w = videoW * scale
  const h = videoH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

function arrowHead(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], size: number) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  ctx.beginPath()
  ctx.moveTo(to[0], to[1])
  ctx.lineTo(to[0] - size * Math.cos(angle - 0.45), to[1] - size * Math.sin(angle - 0.45))
  ctx.moveTo(to[0], to[1])
  ctx.lineTo(to[0] - size * Math.cos(angle + 0.45), to[1] - size * Math.sin(angle + 0.45))
  ctx.stroke()
}

function blockEnd(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number], size: number) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]) + Math.PI / 2
  ctx.beginPath()
  ctx.moveTo(to[0] - size * Math.cos(angle), to[1] - size * Math.sin(angle))
  ctx.lineTo(to[0] + size * Math.cos(angle), to[1] + size * Math.sin(angle))
  ctx.stroke()
}

/** Draws `shapes` visible at `t` into a canvas whose CSS size is the stage box. */
export function drawShapes(canvas: HTMLCanvasElement, shapes: Shape[], t: number, rect: VideoRect, frame = 1 / 30) {
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  const scale = Math.max(0.6, rect.h / 540)
  const P = ([x, y]: [number, number]): [number, number] => [rect.x + x * rect.w, rect.y + y * rect.h]
  const visible = shapes.filter((s) => shapeVisibleAt(s, t, frame))
  // Spotlights dim everything outside them first.
  const spots = visible.filter((s) => s.kind === 'spotlight')
  if (spots.length) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(rect.x, rect.y, rect.w, rect.h)
    for (const s of spots) {
      if (s.kind !== 'spotlight') continue
      const [x, y] = P([s.x + s.w / 2, s.y + s.h / 2])
      ctx.moveTo(x + (s.w * rect.w) / 2, y)
      ctx.ellipse(x, y, Math.abs((s.w * rect.w) / 2), Math.abs((s.h * rect.h) / 2), 0, 0, Math.PI * 2, true)
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fill('evenodd')
    ctx.restore()
  }
  for (const s of visible) {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width * scale
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    switch (s.kind) {
      case 'pen': {
        if (s.points.length < 2) break
        const pts = s.points.map(P)
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1])
        ctx.stroke()
        if (s.end === 'arrow') arrowHead(ctx, pts[Math.max(0, pts.length - 4)], pts[pts.length - 1], 10 * scale + s.width * 2)
        break
      }
      case 'line': {
        const a = P(s.from)
        const b = P(s.to)
        ctx.beginPath()
        ctx.moveTo(a[0], a[1])
        ctx.lineTo(b[0], b[1])
        ctx.stroke()
        if (s.end === 'arrow') arrowHead(ctx, a, b, 10 * scale + s.width * 2)
        if (s.end === 'block') blockEnd(ctx, a, b, 6 * scale + s.width)
        break
      }
      case 'ellipse': {
        const [x, y] = P([s.x + s.w / 2, s.y + s.h / 2])
        ctx.beginPath()
        ctx.ellipse(x, y, Math.abs((s.w * rect.w) / 2), Math.abs((s.h * rect.h) / 2), 0, 0, Math.PI * 2)
        ctx.stroke()
        break
      }
      case 'box': {
        const [x, y] = P([s.x, s.y])
        ctx.strokeRect(x, y, s.w * rect.w, s.h * rect.h)
        break
      }
      case 'spotlight': {
        const [x, y] = P([s.x + s.w / 2, s.y + s.h / 2])
        ctx.beginPath()
        ctx.ellipse(x, y, Math.abs((s.w * rect.w) / 2), Math.abs((s.h * rect.h) / 2), 0, 0, Math.PI * 2)
        ctx.stroke()
        break
      }
      case 'text': {
        const [x, y] = P([s.x, s.y])
        ctx.font = `600 ${Math.round(s.size * scale)}px -apple-system, BlinkMacSystemFont, 'Inter Variable', sans-serif`
        ctx.textBaseline = 'top'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'
        ctx.strokeText(s.text, x, y)
        ctx.fillText(s.text, x, y)
        break
      }
    }
  }
}
