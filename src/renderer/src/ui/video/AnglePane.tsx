import './video.css'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Shape } from '@shared/drawing'
import { Icon, type IconName } from '../Icon'
import { noMouseFocus } from '../keyboard'
import { Spinner } from '../Spinner'
import { drawShapes } from './drawShapes'
import type { VideoEngine } from './engine'

/**
 * One angle of a player surface (02 §5.1, §5.2, §5.11): the engine's <video> for this pane, a drawing canvas exactly
 * over the displayed picture, the angle pill, the active ring and the pane's state overlay. The owner computes the
 * pane and picture rectangles (`fitPicture`, or its own layout) so it can place HUDs against them.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The largest rectangle with the video's aspect ratio centered in `pane` (16:9 until metadata arrives). */
export function fitPicture(pane: Rect, aspect = 16 / 9): Rect {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9
  let w = pane.w
  let h = w / a
  if (h > pane.h) {
    h = pane.h
    w = h * a
  }
  return { x: pane.x + (pane.w - w) / 2, y: pane.y + (pane.h - h) / 2, w, h }
}

export interface AnglePaneProps {
  engine: VideoEngine
  /** The engine pane id (usually the angle). */
  id: string
  /** Pane and picture rectangles in the container's coordinates. */
  pane: Rect
  picture: Rect
  /** Pill text ("Sideline"); no pill when absent. */
  label?: string
  /** The inactive pane's pill is dimmer; the active pane gets a ring in two-pane layouts. */
  active?: boolean
  ring?: boolean
  /** Shows the `unlink` icon in the pill (angles not aligned on the snap). */
  unlinked?: boolean
  /** Pill fades with the transport HUD. */
  chromeHidden?: boolean
  /** Shapes of this angle, drawn at the pane's clip time; `ghost` is drawn at 35% when not visible; `draft` always. */
  shapes?: readonly Shape[]
  ghost?: string | null
  draft?: Shape | null
  /** A state message over the pane (no clip, missing file…); see `PaneMessage`. */
  message?: ReactNode
  /** Over the picture (drawing editor). */
  children?: ReactNode
  /** Picture-in-picture inset look. */
  inset?: boolean
  className?: string
  test?: string
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void
}

export function AnglePane(p: AnglePaneProps) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const { engine, id } = p

  useLayoutEffect(() => {
    engine.attach(id, box.current)
    return () => engine.attach(id, null)
  }, [engine, id])

  // Draw the shapes whenever the engine moves (no React render per frame).
  const shapes = p.shapes ?? NONE
  const drawRef = useRef<() => void>(() => {})
  drawRef.current = () => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(p.picture.w * dpr))
    const h = Math.max(1, Math.round(p.picture.h * dpr))
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    if (!shapes.length && !p.draft) return
    const st = engine.getState().panes[id]
    drawShapes(ctx, shapes, { x: 0, y: 0, w, h }, st?.time ?? 0, st?.frame ?? 1 / 30, { ghost: p.ghost, draft: p.draft })
  }
  useEffect(() => {
    drawRef.current()
  })
  useEffect(() => engine.subscribe(() => drawRef.current()), [engine])

  const st = useLoading(engine, id)
  const pic = { left: p.picture.x - p.pane.x, top: p.picture.y - p.pane.y, width: p.picture.w, height: p.picture.h }
  return (
    <div
      className={`angle-pane${p.inset ? ' angle-pane--inset' : ''}${p.className ? ` ${p.className}` : ''}`}
      data-test={p.test ?? `angle-pane-${id}`}
      data-active={p.active ? 'true' : 'false'}
      style={{ left: p.pane.x, top: p.pane.y, width: p.pane.w, height: p.pane.h }}
      onPointerDown={p.onPointerDown}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      onContextMenu={p.onContextMenu}
      onWheel={p.onWheel}
    >
      <div ref={box} className="angle-pane__picture" style={pic} />
      <canvas ref={canvas} className="angle-pane__canvas" style={pic} />
      {p.ring && p.active && <div className="angle-pane__ring" style={pic} />}
      {p.label && (
        <div
          className="angle-pane__pill"
          data-dim={p.active ? undefined : true}
          data-hidden={p.chromeHidden || undefined}
          style={{ left: pic.left + 12, top: pic.top + 12 }}
        >
          {p.label}
          {p.unlinked && (
            <span className="angle-pane__unlink" title="Not synced on the snap. Set the snap on both angles to sync them exactly.">
              <Icon name="unlink" size={10} />
            </span>
          )}
        </div>
      )}
      {p.children && (
        <div className="angle-pane__overlay" style={pic}>
          {p.children}
        </div>
      )}
      {p.message ??
        (st && (
          <div className="pane-message" data-test="clip-loading">
            <Spinner size={20} />
          </div>
        ))}
    </div>
  )
}

const NONE: readonly Shape[] = []

/** True once the pane has been loading a clip for more than 200ms (02 §5.11). */
function useLoading(engine: VideoEngine, id: string): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let loading = false
    const check = () => {
      const now = !!engine.getState().panes[id]?.loading
      if (now === loading) return
      loading = now
      if (timer) clearTimeout(timer)
      timer = null
      if (now) timer = setTimeout(() => setSlow(true), 200)
      else setSlow(false)
    }
    check()
    const off = engine.subscribe(check)
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [engine, id])
  return slow
}

/**
 * The white-on-black empty state inside a pane (02 §5.11): icon (dropped below 240 tall), title, body and one HUD
 * push button.
 */
export function PaneMessage({
  icon,
  title,
  body,
  action,
  test,
  compact
}: {
  icon?: IconName
  title: ReactNode
  body?: ReactNode
  action?: { label: string; run: () => void; primary?: boolean; borderless?: boolean }
  test?: string
  /** The pane is shorter than 240: no icon. */
  compact?: boolean
}) {
  return (
    <div className="pane-message" data-test={test} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="pane-message__inner">
        {icon && !compact && <Icon name={icon} size={32} className="pane-message__icon" />}
        <div className="pane-message__title">{title}</div>
        {body && <div className="pane-message__body">{body}</div>}
        {action && (
          <button
            type="button"
            className={`pane-message__button${action.primary ? ' pane-message__button--primary' : ''}${action.borderless ? ' pane-message__button--borderless' : ''}`}
            onMouseDown={noMouseFocus}
            onClick={action.run}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}
