import type { Shape } from '@shared/drawing'
import { drawShapes as drawFilmShapes } from '../../../ui/video/drawShapes'

/**
 * Read-only drawings for the reel players (03 §2.6): draws the shapes visible at clip time `t` over the video's
 * letterboxed rect. Coordinates are 0–1 of the picture.
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
  paintShapes(ctx, shapes, t, rect, frame)
}

/**
 * Paints the shapes visible at clip time `t` into any 2D context (an on-screen canvas or the export's
 * OffscreenCanvas, 03 §11.5), inside the picture rect. The caller sets the transform and clears. Drawn by the tape
 * room's renderer (02 §11.6, §20), so the reel, the cut-up and exported video show drawings exactly as they were made.
 */
export function paintShapes(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, shapes: Shape[], t: number, rect: VideoRect, frame = 1 / 30) {
  drawFilmShapes(ctx, shapes, rect, t, frame)
}
