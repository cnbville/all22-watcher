import { useMemo, useState } from 'react'
import type { Grade } from '@shared/types'
import { EmptyState } from '../../../ui/EmptyState'
import { gradeGlyphScore, heatFor } from '../../../ui/heat'
import { useMeasure } from '../hooks'
import { axisNumber, type ChartBaseProps, Tip, TipLine, TipTitle, useDrawIn } from './base'

export interface EpaPoint {
  key: string
  grade: Exclude<Grade, never>
  /** Team EPA on the play. */
  epa: number
  critical: boolean
  /** playCaption */
  caption: string
  /** Short description. */
  desc: string
  /** "Tight coverage · Run support" (tags), optional. */
  tags?: string
}

const LANES: Grade[] = [1, 0, -1]
const GLYPH: Record<string, string> = { '1': '+', '0': '0', '-1': '−' }
const MINUS = '−'

/** EPA with two decimals and a true minus, for the lane means and tooltips. */
function epaText(v: number): string {
  const r = Math.round(v * 100) / 100
  return r === 0 ? '0.00' : `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(2)}`
}

/** A deterministic beeswarm: offsets 0, +7, −7, … ±21 so close points don't hide each other (03 §2.8.3). */
export function beeswarm(xs: number[], gap = 7, maxSteps = 3): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x || a.i - b.i)
  const placed: { x: number; dy: number }[] = []
  const out = new Array<number>(xs.length).fill(0)
  const offsets = [0]
  for (let s = 1; s <= maxSteps; s++) offsets.push(s * gap, -s * gap)
  for (const { x, i } of order) {
    let chosen = offsets[offsets.length - 1]
    for (const dy of offsets) {
      if (!placed.some((p) => Math.abs(p.x - x) < gap && Math.hypot(p.x - x, p.dy - dy) < gap)) {
        chosen = dy
        break
      }
    }
    placed.push({ x, dy: chosen })
    out[i] = chosen
  }
  return out
}

/**
 * Grade vs EPA (03 §2.8.3, improvement 8): three lanes (+, 0, −) of plays placed by team EPA, with lane means.
 * Fewer than 5 points shows a small empty state instead.
 */
export function GradeEpaStrip({
  points,
  teamName,
  height = 236,
  width: fixedWidth,
  palette = 'screen',
  animate = true,
  selected,
  onSelect,
  onPreview,
  onOpen,
  test
}: ChartBaseProps & {
  points: EpaPoint[]
  /** The player's team nickname: "EPA for the Eagles on the play". */
  teamName: string
  height?: number
  width?: number
  selected?: string | null
  onSelect?: (key: string) => void
  /** Space on the focused chart. */
  onPreview?: (key: string) => void
  /** Double-click: the tape room at the play. */
  onOpen?: (key: string) => void
  test?: string
}) {
  const [ref, measured] = useMeasure<HTMLDivElement>(fixedWidth ?? 1136)
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null)
  const drawIn = useDrawIn(test ?? 'epa-strip', animate && palette === 'screen')
  const heat = heatFor(palette)
  const width = fixedWidth ?? measured
  const interactive = palette === 'screen'

  const pad = { t: 28, r: 16, b: 40, l: 56 }
  const laneH = (height - pad.t - pad.b) / 3
  const innerW = Math.max(1, width - pad.l - pad.r)
  const maxAbs = Math.max(0, ...points.map((p) => Math.abs(p.epa)))
  const D = Math.max(2, Math.min(6, Math.ceil(maxAbs)))
  const sx = (v: number) => pad.l + ((Math.max(-D, Math.min(D, v)) + D) / (2 * D)) * innerW

  const layout = useMemo(() => {
    const out = new Map<string, { x: number; y: number; out: -1 | 0 | 1 }>()
    LANES.forEach((g, li) => {
      const lane = points.filter((p) => p.grade === g)
      const xs = lane.map((p) => sx(p.epa))
      const dys = beeswarm(xs, 7, Math.max(1, Math.min(3, Math.floor((laneH / 2 - 6) / 7))))
      const cy = pad.t + laneH * (li + 0.5)
      lane.forEach((p, i) => out.set(p.key, { x: xs[i], y: cy + dys[i], out: p.epa > D ? 1 : p.epa < -D ? -1 : 0 }))
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width, height])

  if (points.length < 5) {
    return (
      <div data-test={test}>
        <EmptyState small title="Not enough plays yet" body="Grade at least 5 scrimmage plays to compare your grades with EPA." />
      </div>
    )
  }

  const xOrder = [...points].sort((a, b) => a.epa - b.epa)
  const ticks = [-D, -D / 2, 0, D / 2, D]
  const hovered = points.find((p) => p.key === hover?.key)
  const focusSel = !hover && selected ? points.find((p) => p.key === selected) : undefined
  const tipPoint = hovered ?? focusSel
  const tipPos = hover ?? (focusSel ? { x: layout.get(focusSel.key)!.x, y: layout.get(focusSel.key)!.y } : null)
  const aria = `Grade versus EPA: ${LANES.map((g) => {
    const lane = points.filter((p) => p.grade === g)
    const mean = lane.length ? lane.reduce((s, p) => s + p.epa, 0) / lane.length : null
    return `${lane.length} ${GLYPH[String(g)]} plays${mean !== null ? ` averaging ${epaText(mean)} EPA` : ''}`
  }).join(', ')}`

  return (
    <div
      ref={ref}
      className="ch ch-strip"
      data-test={test}
      data-draw={drawIn || undefined}
      tabIndex={interactive ? 0 : -1}
      role="img"
      aria-label={aria}
      onKeyDown={(e) => {
        if (!interactive) return
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          e.stopPropagation()
          const i = xOrder.findIndex((p) => p.key === selected)
          const next = xOrder[Math.max(0, Math.min(xOrder.length - 1, i + (e.key === 'ArrowRight' ? 1 : i < 0 ? 0 : -1)))]
          if (next) onSelect?.(next.key)
        } else if (e.key === ' ' && selected) {
          e.preventDefault()
          e.stopPropagation()
          onPreview?.(selected)
        } else if (e.key === 'Enter' && selected) {
          e.preventDefault()
          e.stopPropagation()
          onOpen?.(selected)
        }
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* Lane separators and labels */}
          {LANES.map((g, li) => {
            const y0 = pad.t + laneH * li
            const lane = points.filter((p) => p.grade === g)
            const glyphScore = gradeGlyphScore(g as -1 | 0 | 1)
            return (
              <g key={`lane${g}`}>
                {li > 0 && <line className="ch-grid ch-grid--solid" x1={pad.l} x2={width - pad.r} y1={y0} y2={y0} />}
                <text className="ch-lane-glyph" x={16} y={y0 + laneH / 2 - 1} style={{ fill: heat.ink(glyphScore) }}>
                  {GLYPH[String(g)]}
                </text>
                <text className="ch-lane-count" x={16} y={y0 + laneH / 2 + 13}>
                  {lane.length}
                </text>
              </g>
            )
          })}
          {/* Zero line through every lane */}
          <line className="ch-zero" x1={sx(0)} x2={sx(0)} y1={pad.t} y2={pad.t + laneH * 3} />
          {/* Axis */}
          <line className="ch-axis" x1={pad.l} x2={width - pad.r} y1={pad.t + laneH * 3} y2={pad.t + laneH * 3} />
          {ticks.map((t) => (
            <g key={`t${t}`}>
              <line className="ch-axis" x1={sx(t)} x2={sx(t)} y1={pad.t + laneH * 3} y2={pad.t + laneH * 3 + 4} />
              <text className="ch-axis-label" x={sx(t)} y={pad.t + laneH * 3 + 16} textAnchor="middle">
                {axisNumber(t)}
              </text>
            </g>
          ))}
          <text className="ch-axis-title" x={pad.l + innerW / 2} y={height - 6} textAnchor="middle">
            EPA for the {teamName} on the play
          </text>
          {/* Lane means */}
          {LANES.map((g, li) => {
            const lane = points.filter((p) => p.grade === g)
            if (lane.length < 2) return null
            const mean = lane.reduce((s, p) => s + p.epa, 0) / lane.length
            const x = sx(mean)
            const cy = pad.t + laneH * (li + 0.5)
            const half = Math.min(20, laneH / 2 - 2)
            const flip = x > width - pad.r - 64
            return (
              <g key={`mean${g}`} className="ch-mean">
                <rect className="ch-mean__tick" x={x - 1} y={cy - half} width={2} height={half * 2} rx={1} />
                <text className="ch-mean__label" x={flip ? x - 5 : x + 5} y={cy - half + 8} textAnchor={flip ? 'end' : 'start'}>
                  avg {epaText(mean)}
                </text>
              </g>
            )
          })}
          {/* Points */}
          {points.map((p, i) => {
            const pos = layout.get(p.key)
            if (!pos) return null
            const ink = heat.ink(gradeGlyphScore(p.grade as -1 | 0 | 1))
            const isHover = hover?.key === p.key
            const isSel = selected === p.key
            const r = (p.critical ? 5 : 3.5) + (isHover ? 1.5 : 0)
            return (
              <g
                key={p.key}
                className="ch-point"
                data-clickable={interactive || undefined}
                style={{ animationDelay: drawIn ? `${Math.min(i, 40) * 10}ms` : undefined }}
                onMouseMove={(e) => {
                  if (!interactive) return
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setHover({ key: p.key, x: e.clientX - rect.left, y: e.clientY - rect.top })
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => interactive && onSelect?.(p.key)}
                onDoubleClick={() => interactive && onOpen?.(p.key)}
              >
                {isSel && <circle className="ch-point__ring" cx={pos.x} cy={pos.y} r={(p.critical ? 5 : 5) + 4} />}
                {pos.out === 0 ? (
                  <circle className="ch-point__dot" cx={pos.x} cy={pos.y} r={isSel ? Math.max(r, 5) : r} style={{ fill: ink }} />
                ) : (
                  <path
                    className="ch-point__dot"
                    d={pos.out > 0 ? `M${pos.x + 4},${pos.y} L${pos.x - 2},${pos.y - 4} L${pos.x - 2},${pos.y + 4} Z` : `M${pos.x - 4},${pos.y} L${pos.x + 2},${pos.y - 4} L${pos.x + 2},${pos.y + 4} Z`}
                    style={{ fill: ink }}
                  />
                )}
              </g>
            )
          })}
        </svg>
      )}
      {interactive && tipPoint && tipPos && (
        <Tip x={tipPos.x} y={tipPos.y} width={width}>
          <TipLine muted>{tipPoint.caption}</TipLine>
          <TipTitle>
            <span className="ch-tip__desc">{tipPoint.desc}</span>
          </TipTitle>
          <TipLine muted>
            Grade {GLYPH[String(tipPoint.grade)]} · EPA {epaText(tipPoint.epa)}
            {tipPoint.tags ? ` · ${tipPoint.tags}` : ''}
          </TipLine>
        </Tip>
      )}
    </div>
  )
}
