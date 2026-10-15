import { type ReactNode, useState } from 'react'
import { fill, ink } from '../heat'
import { ChartTooltip } from './Tooltip'

export interface Bar {
  key: string
  label: string
  value: number
  tooltip?: ReactNode
}

/**
 * Vertical bars (spec 01 §6.34). `kind="grade"` diverges from the 50 line in the heat fill; `kind="count"` starts at 0
 * in --label-4. Bars max 20 wide, radius 3 on the value end only.
 */
export function BarChart({ bars, kind = 'grade', height = 170, width = 520, onSelect }: { bars: Bar[]; kind?: 'grade' | 'count'; height?: number; width?: number; onSelect?: (key: string) => void }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const pad = { t: 16, b: 22, l: 28, r: 8 }
  const max = kind === 'grade' ? 100 : Math.max(1, ...bars.map((b) => b.value))
  const innerH = height - pad.t - pad.b
  const y = (v: number) => pad.t + innerH * (1 - v / max)
  const slot = (width - pad.l - pad.r) / Math.max(1, bars.length)
  const bw = Math.min(20, Math.max(4, slot - 4))
  const base = kind === 'grade' ? 50 : 0
  const ticks = kind === 'grade' ? [0, 50, 100] : [0, Math.round(max / 2), max]
  return (
    <div className="bar-chart" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img">
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === base ? 'chart-grid chart-grid--solid' : 'chart-grid'} x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
            <text className="chart-axis-label" x={pad.l - 6} y={y(v) + 3.5} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = pad.l + slot * (i + 0.5)
          const top = Math.min(y(b.value), y(base))
          const h = Math.max(2, Math.abs(y(b.value) - y(base)))
          const up = b.value >= base
          const color = kind === 'grade' ? (hover?.i === i ? ink(b.value) : fill(b.value)) : undefined
          return (
            <g
              key={b.key}
              className="bar-chart__bar"
              data-kind={kind}
              data-dim={hover !== null && hover.i !== i ? true : undefined}
              onMouseMove={(e) => setHover({ i, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(b.key)}
            >
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={innerH} fill="transparent" />
              <path d={roundedBar(cx - bw / 2, top, bw, h, up)} style={color ? { fill: color } : undefined} />
              <text className="chart-category-label" x={cx} y={height - 6} textAnchor="middle">
                {b.label}
              </text>
            </g>
          )
        })}
      </svg>
      {hover && bars[hover.i]?.tooltip && (
        <ChartTooltip x={hover.x} y={hover.y}>
          {bars[hover.i].tooltip}
        </ChartTooltip>
      )}
    </div>
  )
}

/** A bar rounded only on its value end; the end on the baseline stays square. */
export function roundedBar(x: number, y: number, w: number, h: number, up: boolean) {
  const r = Math.min(3, h / 2, w / 2)
  if (up) return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
  return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`
}
