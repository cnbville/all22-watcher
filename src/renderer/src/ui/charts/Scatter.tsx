import { type ReactNode, useState } from 'react'
import { ink } from '../heat'
import { ChartTooltip } from './Tooltip'

export interface ScatterPoint {
  key: string
  x: number
  y: number
  /** Heat score for the point's color; null draws it ungraded. */
  score: number | null
  label?: string
  highlight?: boolean
  tooltip?: ReactNode
}

function ticks(min: number, max: number, n = 5): number[] {
  const span = max - min || 1
  const step = Math.pow(10, Math.floor(Math.log10(span / n)))
  const nice = [1, 2, 5, 10].map((m) => m * step).find((s) => span / s <= n) ?? step * 10
  const out: number[] = []
  for (let v = Math.ceil(min / nice) * nice; v <= max + 1e-9; v += nice) out.push(Number(v.toFixed(6)))
  return out
}

/** Scatter with left and bottom axes, median lines and direct labels (spec 01 §6.34). */
export function Scatter({
  points,
  width = 520,
  height = 280,
  xLabel,
  yLabel,
  selected,
  onSelect,
  medians = true,
  formatX = (v: number) => String(v),
  formatY = (v: number) => String(v)
}: {
  points: ScatterPoint[]
  width?: number
  height?: number
  xLabel?: string
  yLabel?: string
  selected?: string | null
  onSelect?: (key: string) => void
  medians?: boolean
  formatX?: (v: number) => string
  formatY?: (v: number) => string
}) {
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null)
  const pad = { t: 12, r: 12, b: 32, l: 40 }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const [x0, x1] = [Math.min(...xs, 0), Math.max(...xs, 1)]
  const [y0, y1] = [Math.min(...ys, 0), Math.max(...ys, 1)]
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r)
  const sy = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (height - pad.t - pad.b)
  const median = (a: number[]) => {
    const s = [...a].sort((p, q) => p - q)
    return s.length ? s[Math.floor(s.length / 2)] : 0
  }
  const placed: { x: number; y: number; w: number }[] = []
  const hovered = points.find((p) => p.key === hover?.key)
  return (
    <div className="scatter" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img">
        <line className="chart-axis" x1={pad.l} x2={pad.l} y1={pad.t} y2={height - pad.b} />
        <line className="chart-axis" x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} />
        {ticks(x0, x1).map((v) => (
          <g key={`x${v}`}>
            <line className="chart-axis" x1={sx(v)} x2={sx(v)} y1={height - pad.b} y2={height - pad.b + 4} />
            <text className="chart-axis-label" x={sx(v)} y={height - pad.b + 15} textAnchor="middle">
              {formatX(v)}
            </text>
          </g>
        ))}
        {ticks(y0, y1).map((v) => (
          <g key={`y${v}`}>
            <line className="chart-axis" x1={pad.l - 4} x2={pad.l} y1={sy(v)} y2={sy(v)} />
            <text className="chart-axis-label" x={pad.l - 7} y={sy(v) + 3.5} textAnchor="end">
              {formatY(v)}
            </text>
          </g>
        ))}
        {xLabel && (
          <text className="chart-axis-label" x={width - pad.r} y={height - 4} textAnchor="end">
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text className="chart-axis-label" x={pad.l + 4} y={pad.t + 8}>
            {yLabel}
          </text>
        )}
        {medians && points.length > 2 && (
          <>
            <line className="chart-grid chart-grid--dashed" x1={sx(median(xs))} x2={sx(median(xs))} y1={pad.t} y2={height - pad.b} />
            <line className="chart-grid chart-grid--dashed" x1={pad.l} x2={width - pad.r} y1={sy(median(ys))} y2={sy(median(ys))} />
          </>
        )}
        {points.map((p) => {
          const big = hover?.key === p.key || selected === p.key
          return (
            <g key={p.key} onMouseMove={(e) => setHover({ key: p.key, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(p.key)}>
              {selected === p.key && <circle className="scatter__ring" cx={sx(p.x)} cy={sy(p.y)} r={9} />}
              <circle className="scatter__point" cx={sx(p.x)} cy={sy(p.y)} r={big ? 5 : 3.5} fill={p.score === null ? 'var(--label-3)' : ink(p.score)} />
            </g>
          )
        })}
        {points
          .filter((p) => p.highlight && p.label)
          .slice(0, 8)
          .map((p) => {
            const x = sx(p.x) + 6
            const y = sy(p.y) + 4
            const w = p.label!.length * 6
            if (placed.some((q) => Math.abs(q.y - y) < 12 && x < q.x + q.w && q.x < x + w)) return null
            placed.push({ x, y, w })
            return (
              <text key={`l${p.key}`} className="scatter__label" x={x} y={y}>
                {p.label}
              </text>
            )
          })}
      </svg>
      {hover && hovered?.tooltip && (
        <ChartTooltip x={hover.x} y={hover.y}>
          {hovered.tooltip}
        </ChartTooltip>
      )}
    </div>
  )
}
