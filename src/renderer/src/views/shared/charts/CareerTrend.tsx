import { useState } from 'react'
import { heatFor } from '../../../ui/heat'
import { useMeasure } from '../hooks'
import { type ChartBaseProps, Tip, TipLine, TipTitle, useDrawIn } from './base'

export interface CareerGamePoint {
  key: string
  gameId: string
  /** "Week 5 vs NYG" */
  title: string
  score: number
  plays: number
}

export interface CareerSeason {
  season: number
  games: CareerGamePoint[]
  /** The season grade (all graded plays through gradeScore). */
  mean: number | null
}

/**
 * Career Trend (03 §2.8.5, improvement 12): every graded game across seasons at equal spacing, season bands, game
 * grades joined within a season and each season's mean as a dashed segment.
 */
export function CareerTrend({
  seasons,
  height = 180,
  width: fixedWidth,
  palette = 'screen',
  animate = true,
  selected,
  onSelect,
  onOpen,
  test
}: ChartBaseProps & {
  seasons: CareerSeason[]
  height?: number
  width?: number
  selected?: string | null
  onSelect?: (key: string, season: number) => void
  onOpen?: (key: string, season: number) => void
  test?: string
}) {
  const [ref, measured] = useMeasure<HTMLDivElement>(fixedWidth ?? 749)
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null)
  const drawIn = useDrawIn(test ?? 'career-trend', animate && palette === 'screen')
  const heat = heatFor(palette)
  const width = fixedWidth ?? measured
  const list = [...seasons].filter((s) => s.games.length).sort((a, b) => a.season - b.season)
  const total = list.reduce((n, s) => n + s.games.length, 0)
  const pad = { t: 24, r: 8, b: 16, l: 28 }
  const innerW = Math.max(1, width - pad.l - pad.r)
  const innerH = height - pad.t - pad.b
  const step = innerW / Math.max(1, total)
  const sy = (v: number) => pad.t + innerH * (1 - v / 100)

  let idx = 0
  const bands = list.map((s, si) => {
    const from = pad.l + idx * step
    const pts = s.games.map((g) => {
      const x = pad.l + (idx++ + 0.5) * step
      return { ...g, x, y: sy(g.score), season: s.season }
    })
    return { ...s, from, to: pad.l + idx * step, pts, odd: si % 2 === 0 }
  })
  const all = bands.flatMap((b) => b.pts)
  const hovered = all.find((p) => p.key === hover?.key)

  return (
    <div
      ref={ref}
      className="ch ch-career"
      data-test={test}
      data-draw={drawIn || undefined}
      role="img"
      aria-label={`Career trend: ${list.map((s) => `${s.season} grade ${s.mean ?? 'none'}`).join(', ')}`}
    >
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {bands.map((b) => (
            <g key={b.season}>
              {b.odd && <rect className="ch-band" x={b.from} y={pad.t - 20} width={b.to - b.from} height={innerH + 20} />}
              <text className="ch-season-label" x={b.from + 6} y={pad.t - 20 + 15}>
                {b.season}
              </text>
            </g>
          ))}
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line className={v === 50 ? 'ch-grid ch-grid--solid' : 'ch-grid'} x1={pad.l} x2={width - pad.r} y1={sy(v)} y2={sy(v)} />
              <text className="ch-axis-label" x={pad.l - 6} y={sy(v) + 3.5} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {bands.map((b) => (
            <g key={`s${b.season}`}>
              {b.mean !== null && (
                <>
                  <line className="ch-season-mean" x1={b.from + 4} x2={b.to - 4} y1={sy(b.mean)} y2={sy(b.mean)} />
                  <text className="ch-season-mean__value" x={b.to - 4} y={sy(b.mean) - 5} textAnchor="end" style={{ fill: heat.ink(b.mean) }}>
                    {b.mean}
                  </text>
                </>
              )}
              {b.pts.length > 1 && <polyline className="ch-career__line" points={b.pts.map((p) => `${p.x},${p.y}`).join(' ')} />}
              {b.pts.map((p) => (
                <g
                  key={p.key}
                  className="ch-point"
                  data-clickable={onSelect ? true : undefined}
                  onMouseMove={(e) => {
                    if (palette !== 'screen') return
                    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                    setHover({ key: p.key, x: e.clientX - rect.left, y: e.clientY - rect.top })
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelect?.(p.key, p.season)}
                  onDoubleClick={() => onOpen?.(p.key, p.season)}
                >
                  <rect x={p.x - step / 2} y={pad.t} width={step} height={innerH} fill="transparent" />
                  {selected === p.key && <circle className="ch-point__ring" cx={p.x} cy={p.y} r={7} />}
                  <circle className="ch-career__dot" cx={p.x} cy={p.y} r={hover?.key === p.key || selected === p.key ? 4.5 : 3} style={{ fill: heat.ink(p.score) }} />
                </g>
              ))}
            </g>
          ))}
        </svg>
      )}
      {palette === 'screen' && hovered && hover && (
        <Tip x={hover.x} y={hover.y} width={width}>
          <TipTitle>
            {hovered.season} · {hovered.title}
          </TipTitle>
          <TipLine>
            Grade {hovered.score} · {hovered.plays} {hovered.plays === 1 ? 'play' : 'plays'}
          </TipLine>
        </Tip>
      )}
    </div>
  )
}
