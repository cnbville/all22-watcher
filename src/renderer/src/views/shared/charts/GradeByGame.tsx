import { useState } from 'react'
import type { GradeTally } from '@shared/types'
import { SMALL_SAMPLE } from '@shared/splits'
import { heatFor } from '../../../ui/heat'
import { useMeasure } from '../hooks'
import { type ChartBaseProps, Tip, TipLine, TipTitle, useDrawIn, valueEndBar } from './base'
import { CompactList } from './CompactList'

export interface GameBar {
  key: string
  /** Category label under the bar: "DAL" (or "Wk 1" in a long report chart). */
  label: string
  /** Tooltip title: "Week 1 vs DAL". */
  title: string
  /** Compact list label: "Wk 1 vs DAL". */
  rowLabel: string
  tally: GradeTally
  score: number | null
}

/**
 * Grade by Game (03 §2.8.1): one bar per graded game in date order, diverging from the 50 line in the heat fill.
 * Under `compactBelow` games (4) it becomes the compact list (§2.8.2).
 */
export function GradeByGameChart({
  games,
  height = 200,
  width: fixedWidth,
  palette = 'screen',
  animate = true,
  valueLabelMax = 10,
  compactBelow = 4,
  onSelect,
  test
}: ChartBaseProps & {
  games: GameBar[]
  height?: number
  /** Fixed width (print); otherwise the chart fills its container. */
  width?: number
  /** Value labels on every bar up to this many bars, else only on the hovered one. */
  valueLabelMax?: number
  compactBelow?: number
  onSelect?: (key: string) => void
  test?: string
}) {
  const [ref, measured] = useMeasure<HTMLDivElement>(fixedWidth ?? 556)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const [focusIdx, setFocusIdx] = useState<number | null>(null)
  const drawIn = useDrawIn(test ?? 'grade-by-game', animate && palette === 'screen')
  const heat = heatFor(palette)
  const width = fixedWidth ?? measured
  const aria = `Grade by game: ${games.map((g) => `${g.score ?? 'no grade'} against ${g.label}`).join(', ')}`

  if (games.length < compactBelow) {
    return (
      <div aria-label={aria} data-test={test}>
        <CompactList
          palette={palette}
          onSelect={onSelect}
          rows={games.map((g) => ({
            key: g.key,
            label: g.rowLabel,
            detail: `${g.tally.graded} ${g.tally.graded === 1 ? 'play' : 'plays'}`,
            tally: g.tally,
            score: g.score,
            title: `${g.title}: ${g.score ?? '—'}`
          }))}
        />
      </div>
    )
  }

  const pad = { t: 16, b: 22, l: 28, r: 8 }
  const innerH = height - pad.t - pad.b
  const innerW = Math.max(1, width - pad.l - pad.r)
  const y = (v: number) => pad.t + innerH * (1 - v / 100)
  const slot = innerW / games.length
  const bw = Math.max(3, Math.min(20, slot - 4))
  const everyOther = slot < 26
  const active = hover?.i ?? focusIdx
  const allValues = games.length <= valueLabelMax

  return (
    <div
      ref={ref}
      className="ch ch-bars"
      data-test={test}
      data-draw={drawIn || undefined}
      tabIndex={palette === 'screen' ? 0 : -1}
      role="img"
      aria-label={aria}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          e.stopPropagation()
          setFocusIdx((i) => Math.max(0, Math.min(games.length - 1, (i ?? -1) + (e.key === 'ArrowRight' ? 1 : -1))))
        } else if (e.key === 'Enter' && focusIdx !== null) {
          e.preventDefault()
          e.stopPropagation()
          onSelect?.(games[focusIdx].key)
        }
      }}
      onBlur={() => setFocusIdx(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line className={v === 50 ? 'ch-grid ch-grid--solid' : 'ch-grid'} x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
              <text className="ch-axis-label" x={pad.l - 6} y={y(v) + 3.5} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {games.map((g, i) => {
            const cx = pad.l + slot * (i + 0.5)
            const score = g.score ?? 50
            const small = g.tally.graded < SMALL_SAMPLE
            const up = score >= 50
            const top = Math.min(y(score), y(50))
            const h = Math.max(2, Math.abs(y(score) - y(50)))
            const hot = active === i
            const color = small ? (hot ? 'var(--ch-label-3)' : 'var(--ch-neutral)') : hot ? heat.ink(score) : heat.fill(score)
            const showValue = g.score !== null && (allValues || hot)
            const labelY = up ? top - 4 : top + h + 11
            return (
              <g
                key={g.key}
                className="ch-bar"
                data-dim={active !== null && !hot ? true : undefined}
                onMouseMove={(e) => {
                  const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top })
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(g.key)}
                data-clickable={onSelect ? true : undefined}
              >
                <rect x={cx - slot / 2} y={pad.t} width={slot} height={innerH} fill="transparent" />
                <path
                  className={`ch-bar__fill${up ? ' ch-bar__fill--up' : ' ch-bar__fill--down'}`}
                  d={valueEndBar(cx - bw / 2, top, bw, h, up)}
                  style={{ fill: color, animationDelay: drawIn ? `${i * 18}ms` : undefined }}
                />
                {showValue && (
                  <text className="ch-value-label" x={cx} y={labelY} textAnchor="middle">
                    {Math.round(score)}
                  </text>
                )}
                {(!everyOther || i % 2 === 0) && (
                  <text className="ch-category-label" x={cx} y={height - 6} textAnchor="middle">
                    {g.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {palette === 'screen' && active !== null && games[active] && (
        <Tip x={hover?.x ?? pad.l + slot * (active + 0.5)} y={hover?.y ?? pad.t} width={width}>
          <TipTitle>{games[active].title}</TipTitle>
          <TipLine muted>
            {games[active].score ?? '—'} · {games[active].tally.graded} {games[active].tally.graded === 1 ? 'play' : 'plays'} · {games[active].tally.plus} / {games[active].tally.zero} /{' '}
            {games[active].tally.minus}
          </TipLine>
          {games[active].tally.critical > 0 && <TipLine muted>{games[active].tally.critical} critical</TipLine>}
        </Tip>
      )}
    </div>
  )
}
