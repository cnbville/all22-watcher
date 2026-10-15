import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLayer } from './keyboard'

type Placement = 'bottom' | 'top' | 'left' | 'right'

/**
 * Transient panel anchored to a control (spec 01 §6.18). Closes on esc, an outside click, a second click on the
 * anchor or window blur; flips to stay in the window; focus moves in and returns to the anchor.
 */
export function Popover({
  anchor,
  open,
  onClose,
  placement = 'bottom',
  width = 300,
  arrow = true,
  padding = 'content',
  test,
  children
}: {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  placement?: Placement
  width?: number
  arrow?: boolean
  padding?: 'content' | 'list'
  test?: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; side: Placement; arrowAt: number } | null>(null)

  useLayer(open, { kind: 'popover', close: onClose })

  useLayoutEffect(() => {
    if (!open) return setPos(null)
    const place = () => {
      const a = anchor.current?.getBoundingClientRect()
      const el = panel.current
      if (!a || !el) return
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const gap = arrow ? 12 : 6
      const fits: Record<Placement, boolean> = {
        bottom: a.bottom + gap + h <= vh - 8,
        top: a.top - gap - h >= 8,
        right: a.right + gap + w <= vw - 8,
        left: a.left - gap - w >= 8
      }
      const order: Placement[] = [placement, placement === 'bottom' ? 'top' : 'bottom', 'right', 'left']
      const side = order.find((p) => fits[p]) ?? placement
      let left: number
      let top: number
      if (side === 'bottom' || side === 'top') {
        left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, vw - w - 8))
        top = side === 'bottom' ? a.bottom + gap : a.top - gap - h
      } else {
        top = Math.max(8, Math.min(a.top + a.height / 2 - h / 2, vh - h - 8))
        left = side === 'right' ? a.right + gap : a.left - gap - w
      }
      const arrowAt = side === 'bottom' || side === 'top' ? a.left + a.width / 2 - left : a.top + a.height / 2 - top
      setPos({ left, top, side, arrowAt })
    }
    place()
    const ro = new ResizeObserver(place)
    if (panel.current) ro.observe(panel.current)
    return () => ro.disconnect()
  }, [open, placement, anchor, arrow])

  // Focus in, back to the anchor on close; outside clicks and window blur close.
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, [contenteditable]')
    ;(first ?? panel.current)?.focus({ preventScroll: true })
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t)) return
      // The menu layer (a popup inside the popover) lives outside the panel.
      if ((t as Element).closest?.('.menu')) return
      if (anchor.current?.contains(t)) {
        // A second click on the anchor closes; stop the anchor's own click from reopening.
        e.stopPropagation()
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation()
          ev.preventDefault()
        }
        anchor.current.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => anchor.current?.removeEventListener('click', swallow, { capture: true }), 400)
      }
      onClose()
    }
    const onBlur = () => onClose()
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      if (prev && document.contains(prev) && anchor.current?.contains(prev)) prev.focus({ preventScroll: true })
    }
  }, [open, onClose, anchor])

  if (!open) return null
  const layer = document.getElementById('layer-popover') ?? document.body
  return createPortal(
    <div
      ref={panel}
      className={`popover popover--${padding}`}
      data-side={pos?.side ?? placement}
      data-test={test}
      tabIndex={-1}
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      {arrow && pos && (
        <span
          className="popover__arrow"
          style={pos.side === 'bottom' || pos.side === 'top' ? { left: pos.arrowAt - 8 } : { top: pos.arrowAt - 8 }}
        />
      )}
      <div className="popover__body">{children}</div>
    </div>,
    layer
  )
}
