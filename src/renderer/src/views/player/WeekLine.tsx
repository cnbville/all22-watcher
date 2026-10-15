import { useState } from 'react'
import { useMeasure } from '../shared'
import type { GameBar } from '../shared'

/**
 * Grade by week as one thin line in the label color (Theater): three faint guides with their values on the right,
 * hollow points with the latest one filled, week labels underneath. A click on a point opens that game's plays.
 */
export function WeekLine({ games, height = 160, onSelect, test }: { games: GameBar[]; height?: number; onSelect?: (key: string) => void; test?: string }) {
  const [ref, width] = useMeasure<HTMLDivElement>(520)
  const [hover, setHover] = useState<number | null>(null)
  const pts = games.filter((g) => g.score !== null) as (GameBar & { score: number })[]
  const aria = `Grade by week: ${pts.map((g) => `${g.label} ${Math.round(g.score)}`).join(', ')}`
  if (!pts.length) return null

  const pad = { t: 14, b: 26, l: 8, r: 34 }
  const lo0 = Math.min(...pts.map((g) => g.score))
  const hi0 = Math.max(...pts.map((g) => g.score))
  let lo = Math.max(0, Math.floor((lo0 - 5) / 10) * 10)
  let hi = Math.min(100, Math.ceil((hi0 + 5) / 10) * 10)
  if (hi - lo < 30) {
    const mid = (hi + lo) / 2
    lo = Math.max(0, Math.round(mid - 15))
    hi = Math.min(100, lo + 30)
  }
  const innerW = Math.max(1, width - pad.l - pad.r)
  const innerH = height - pad.t - pad.b
  const x = (i: number) => pad.l + (pts.length === 1 ? innerW / 2 : (i * innerW) / (pts.length - 1))
  const y = (v: number) => pad.t + innerH * (1 - (v - lo) / (hi - lo))
  const guides = [hi, Math.round((hi + lo) / 2), lo]
  const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(innerW / 64))))
  const last = pts.length - 1
  const line = pts.map((g, i) => `${x(i)},${y(g.score)}`).join(' ')
  const area = pts.length > 1 ? `M${x(0)},${y(lo)} L${pts.map((g, i) => `${x(i)},${y(g.score)}`).join(' L')} L${x(last)},${y(lo)} Z` : ''

  return (
    <div ref={ref} className="week-line" data-test={test}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={aria}>
        <g className="week-line__guides">
          {guides.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + innerW} y1={y(v)} y2={y(v)} />
              <text x={width - pad.r + 10} y={y(v) + 3.5}>
                {v}
              </text>
            </g>
          ))}
        </g>
        {area && <path className="week-line__area" d={area} />}
        {pts.length > 1 && <polyline className="week-line__line" points={line} fill="none" />}
        {pts.map((g, i) => {
          const on = hover === i
          return (
            <g
              key={g.key}
              className="week-line__point"
              data-last={i === last || undefined}
              data-on={on || undefined}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={`${g.title}: ${Math.round(g.score)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(g.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect?.(g.key)
                }
              }}
            >
              <title>{`${g.title}: ${Math.round(g.score)} · ${g.tally.graded} ${g.tally.graded === 1 ? 'play' : 'plays'}`}</title>
              <rect className="week-line__hit" x={x(i) - 12} y={pad.t - 8} width={24} height={innerH + 16} />
              <circle cx={x(i)} cy={y(g.score)} r={i === last || on ? 4 : 3} />
              {on && (
                <text className="week-line__value" x={x(i)} y={y(g.score) - 10} textAnchor="middle">
                  {Math.round(g.score)}
                </text>
              )}
            </g>
          )
        })}
        <g className="week-line__weeks">
          {pts.map((g, i) =>
            (i % step === 0 && (last - i >= step || step === 1)) || i === last ? (
              <text key={g.key} x={x(i)} y={height - 6} textAnchor={pts.length === 1 ? 'middle' : i === 0 ? 'start' : i === last ? 'end' : 'middle'}>
                {g.label}
              </text>
            ) : null
          )}
        </g>
      </svg>
    </div>
  )
}
