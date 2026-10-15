import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Palette } from '../../../ui/heat'

/**
 * Shared bits of the browse charts (03 §2.8) on top of 01 §6.34's rules: a tooltip that stays inside the chart,
 * the draw-in-once flag and the U+2212 tick formatter. Chart colors other than the heat scale are CSS variables
 * (`--ch-*`, set in shared.css and overridden by the print palette in report.css), so the same SVG renders on
 * screen and in the PDF.
 */

export interface ChartBaseProps {
  palette?: Palette
  /** Draw-in animation the first time the chart appears (off in print and with reduced motion, via CSS). */
  animate?: boolean
}

/** A chart hover tooltip in popover material, 12 from the pointer, flipped to stay inside the chart. */
export function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(180)
  useEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth)
  })
  const left = x + 12 + w > width ? Math.max(0, x - 12 - w) : x + 12
  return (
    <div ref={ref} className="ch-tip" style={{ left, top: y + 12 }} role="tooltip">
      {children}
    </div>
  )
}

export function TipTitle({ children }: { children: ReactNode }) {
  return <div className="ch-tip__title">{children}</div>
}

export function TipLine({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <div className={muted ? 'ch-tip__line ch-tip__line--muted' : 'ch-tip__line'}>{children}</div>
}

/** Signed axis labels with a true minus: "−4", "−2", "0", "+2", "+4". */
export function axisNumber(v: number): string {
  const r = Math.round(v * 100) / 100
  if (r === 0) return '0'
  const s = String(Math.abs(r))
  return r < 0 ? `−${s}` : `+${s}`
}

/** A bar path rounded (r) on its value end only; the end on the baseline stays square. */
export function valueEndBar(x: number, y: number, w: number, h: number, up: boolean, radius = 3): string {
  const r = Math.max(0, Math.min(radius, h / 2, w / 2))
  if (up) return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
  return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`
}

/** Keeps a chart's draw-in to its first appearance on a screen (01 §5.8). */
const drawn = new Set<string>()
export function useDrawIn(id: string | undefined, enabled = true): boolean {
  const [first] = useState(() => {
    if (!enabled || !id) return false
    const key = `${location.hash.split('?')[0]}|${id}`
    if (drawn.has(key)) return false
    drawn.add(key)
    return true
  })
  return first
}

/** Approximate text width for label collision checks (11px system text ≈ 6.2px per character). */
export function textWidth(s: string, size = 11): number {
  return s.length * size * 0.58
}
