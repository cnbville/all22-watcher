import { useState } from 'react'
import { emptyTally, gradeScore, mergeTally } from '@shared/stats'
import { SMALL_SAMPLE } from '@shared/splits'
import type { GradeTally } from '@shared/types'
import { heatFor } from '../../../ui/heat'
import { useMeasure } from '../hooks'
import { type ChartBaseProps, textWidth, Tip, TipLine, TipTitle, useDrawIn } from './base'
import { CompactList } from './CompactList'

export interface OpponentGame {
  key: string
  /** The opponent unit's league rank, 1 best; null when not ranked yet. */
  rank: number | null
  tally: GradeTally
  score: number | null
  /** "LA" */
  opp: string
  /** "Week 3 vs LA" */
  title: string
  /** "Wk 3 vs LA" (compact list) */
  rowLabel: string
  /** "LA pass offense: 5th" */
  rankLine: string
  /** "5th pass offense" (compact list detail) */
  rankShort: string
}

export type Tier = 'top' | 'middle' | 'bottom'

/** Ranks 1–10 top, 11–22 middle, 23–32 bottom (03 §2.8.4). */
export function tierOf(rank: number): Tier {
  return rank <= 10 ? 'top' : rank <= 22 ? 'middle' : 'bottom'
}

export const TIER_LABEL: Record<Tier, string> = { top: 'vs top 10', middle: 'vs middle 12', bottom: 'vs bottom 10' }

export interface TierSummary {
  tier: Tier
  label: string
  games: number
  tally: GradeTally
  score: number | null
}

/** The three tier rows: every graded play in that tier's games, through gradeScore. */
export function tierSummaries(games: Pick<OpponentGame, 'rank' | 'tally'>[]): TierSummary[] {
  return (['top', 'middle', 'bottom'] as Tier[]).map((tier) => {
    const inTier = games.filter((g) => g.rank !== null && tierOf(g.rank) === tier && g.tally.graded > 0)
    const tally = inTier.reduce((t, g) => mergeTally(t, g.tally), emptyTally())
    return { tier, label: TIER_LABEL[tier], games: inTier.length, tally, score: gradeScore(tally) }
  })
}

const X_TICKS = [32, 24, 16, 8, 1]
const ORD = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/**
 * Grade vs Opponent Strength (03 §2.8.4, improvement 9): x the opponent unit's rank (32nd left, 1st right), y the
 * game grade, tier bands with their averages. Fewer than 4 games → compact list with the rank in the detail.
 */
export function OpponentScatter({
  games,
  height = 220,
  width: fixedWidth,
  palette = 'screen',
  animate = true,
  onSelect,
  test
}: ChartBaseProps & {
  games: OpponentGame[]
  height?: number
  width?: number
  onSelect?: (key: string) => void
  test?: string
}) {
  const [ref, measured] = useMeasure<HTMLDivElement>(fixedWidth ?? 749)
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null)
  const drawIn = useDrawIn(test ?? 'opp-scatter', animate && palette === 'screen')
  const heat = heatFor(palette)
  const width = fixedWidth ?? measured
  const ranked = games.filter((g) => g.rank !== null && g.score !== null)

  if (ranked.length < 4) {
    return (
      <div data-test={test}>
        <CompactList
          palette={palette}
          onSelect={onSelect}
          rows={games.map((g) => ({
            key: g.key,
            label: g.rowLabel,
            detail: `${g.rank !== null ? `${g.rankShort} · ` : ''}${g.tally.graded} ${g.tally.graded === 1 ? 'play' : 'plays'}`,
            tally: g.tally,
            score: g.score,
            title: `${g.title} · ${g.rankLine}`
          }))}
        />
      </div>
    )
  }

  const pad = { t: 24, r: 16, b: 40, l: 36 }
  const innerW = Math.max(1, width - pad.l - pad.r)
  const innerH = height - pad.t - pad.b
  const sx = (rank: number) => pad.l + ((32 - rank) / 31) * innerW
  const sy = (v: number) => pad.t + innerH * (1 - v / 100)
  const bands: { tier: Tier; from: number; to: number; name: string }[] = [
    { tier: 'bottom', from: pad.l, to: sx(22.5), name: 'Bottom 10' },
    { tier: 'middle', from: sx(22.5), to: sx(10.5), name: 'Middle' },
    { tier: 'top', from: sx(10.5), to: width - pad.r, name: 'Top 10' }
  ]
  const tiers = tierSummaries(ranked)
  const hovered = ranked.find((g) => g.key === hover?.key)

  // Direct labels, skipped when they would overlap another label or point.
  const placed: { x: number; y: number; w: number }[] = ranked.map((g) => ({ x: sx(g.rank!) - 4, y: sy(g.score!) - 4, w: 8 }))
  const labels: { key: string; x: number; y: number; text: string }[] = []
  for (const g of [...ranked].sort((a, b) => b.tally.graded - a.tally.graded)) {
    const x = sx(g.rank!) + 6
    const y = sy(g.score!) + 3.5
    const w = textWidth(g.opp, 10)
    if (x + w > width - 2) continue
    const box = { x, y: y - 9, w }
    const hit = placed.some((p) => box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + 10 && p.y < box.y + 10)
    if (hit) continue
    placed.push(box)
    labels.push({ key: g.key, x, y, text: g.opp })
  }

  return (
    <div ref={ref} className="ch ch-scatter" data-test={test} data-draw={drawIn || undefined} role="img" aria-label={`Grade by opponent strength: ${ranked.map((g) => `${g.score} against ${g.opp} (${ORD(g.rank!)})`).join(', ')}`}>
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* Grid */}
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line className={v === 50 ? 'ch-grid ch-grid--solid' : 'ch-grid'} x1={pad.l} x2={width - pad.r} y1={sy(v)} y2={sy(v)} />
              <text className="ch-axis-label" x={pad.l - 6} y={sy(v) + 3.5} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {/* Tier bands */}
          {[sx(22.5), sx(10.5)].map((x) => (
            <line key={x} className="ch-grid" x1={x} x2={x} y1={pad.t - 6} y2={pad.t + innerH} />
          ))}
          {bands.map((b) => (
            <text key={b.tier} className="ch-band-label" x={(b.from + b.to) / 2} y={pad.t - 10} textAnchor="middle">
              {b.name}
            </text>
          ))}
          {/* Tier averages */}
          {bands.map((b) => {
            const t = tiers.find((x) => x.tier === b.tier)!
            if (t.score === null) return null
            const y = sy(t.score)
            return (
              <g key={`avg${b.tier}`} className="ch-tier-avg">
                <line x1={b.from + 8} x2={b.to - 8} y1={y} y2={y} />
                <text x={b.to - 8} y={y - 5} textAnchor="end">
                  {t.score}
                </text>
              </g>
            )
          })}
          {/* Axis */}
          <line className="ch-axis" x1={pad.l} x2={width - pad.r} y1={pad.t + innerH} y2={pad.t + innerH} />
          {X_TICKS.map((r) => (
            <g key={r}>
              <line className="ch-axis" x1={sx(r)} x2={sx(r)} y1={pad.t + innerH} y2={pad.t + innerH + 4} />
              <text className="ch-axis-label" x={sx(r)} y={pad.t + innerH + 16} textAnchor="middle">
                {ORD(r)}
              </text>
            </g>
          ))}
          {/* Points */}
          {ranked.map((g, i) => {
            const small = g.tally.graded < SMALL_SAMPLE
            const isHover = hover?.key === g.key
            return (
              <g
                key={g.key}
                className="ch-point"
                data-clickable={onSelect ? true : undefined}
                style={{ animationDelay: drawIn ? `${i * 20}ms` : undefined }}
                onMouseMove={(e) => {
                  if (palette !== 'screen') return
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setHover({ key: g.key, x: e.clientX - rect.left, y: e.clientY - rect.top })
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(g.key)}
              >
                <circle className="ch-point__dot" cx={sx(g.rank!)} cy={sy(g.score!)} r={isHover ? 5.5 : 4} style={{ fill: small ? 'var(--ch-label-3)' : heat.ink(g.score!) }} />
              </g>
            )
          })}
          {labels.map((l) => (
            <text key={`l${l.key}`} className="ch-point-label" x={l.x} y={l.y}>
              {l.text}
            </text>
          ))}
        </svg>
      )}
      {palette === 'screen' && hovered && hover && (
        <Tip x={hover.x} y={hover.y} width={width}>
          <TipTitle>{hovered.title}</TipTitle>
          <TipLine>
            Grade {hovered.score} · {hovered.tally.graded} {hovered.tally.graded === 1 ? 'play' : 'plays'}
          </TipLine>
          <TipLine muted>{hovered.rankLine}</TipLine>
        </Tip>
      )}
    </div>
  )
}
