import { type CSSProperties, useState } from 'react'
import { gradeScore } from '@shared/stats'
import { SMALL_SAMPLE } from '@shared/splits'
import type { GradeTally } from '@shared/types'
import { heatFor } from '../../../ui/heat'
import { Tip, TipLine, TipTitle } from './base'

export interface HeatColumn {
  key: string
  /** "Wk 1" */
  top: string
  /** "DAL" */
  bottom: string
  /** For tooltips: "vs DAL, Week 1" */
  title: string
}

export interface HeatRow {
  key: string
  /** "Wide receivers" */
  label: string
  /** Total rows ("Offense", "Defense") are semibold. */
  total?: boolean
  cells: Record<string, GradeTally | undefined>
  season?: GradeTally
}

/**
 * Unit heat grid (03 §2.8.7): unit rows by game columns, cells tinted by grade, a Season column after an 8px gap.
 * Scrolls horizontally inside its section with the row labels sticky.
 */
export function UnitHeatGrid({
  rows,
  columns,
  onCellClick,
  test
}: {
  rows: HeatRow[]
  columns: HeatColumn[]
  onCellClick?: (rowKey: string, columnKey: string) => void
  test?: string
}) {
  const [hover, setHover] = useState<{ row: HeatRow; col: HeatColumn | null; tally: GradeTally; x: number; y: number; width: number } | null>(null)
  const heat = heatFor('screen')
  const cell = (row: HeatRow, col: HeatColumn | null, tally: GradeTally | undefined) => {
    const score = tally ? gradeScore(tally) : null
    const small = !!tally && tally.graded > 0 && tally.graded < SMALL_SAMPLE
    const style: CSSProperties | undefined = score !== null && !small ? { background: heat.tint(score), color: heat.ink(score) } : undefined
    return (
      <div
        key={col?.key ?? 'season'}
        className={`heat-grid__cell${score === null ? ' heat-grid__cell--none' : small ? ' heat-grid__cell--small' : ''}${col ? '' : ' heat-grid__cell--season'}`}
        style={style}
        data-clickable={col && onCellClick && score !== null ? true : undefined}
        onClick={() => col && score !== null && onCellClick?.(row.key, col.key)}
        onMouseMove={(e) => {
          if (!tally || !tally.graded) return setHover(null)
          const host = (e.currentTarget.closest('.heat-grid') as HTMLElement).getBoundingClientRect()
          setHover({ row, col, tally, x: e.clientX - host.left, y: e.clientY - host.top, width: host.width })
        }}
        onMouseLeave={() => setHover(null)}
      >
        {score === null ? '—' : score}
      </div>
    )
  }
  const hScore = hover ? gradeScore(hover.tally) : null
  return (
    <div className="heat-grid" data-test={test}>
      <div className="heat-grid__scroll">
        <div className="heat-grid__table" style={{ '--cols': columns.length } as CSSProperties}>
          <div className="heat-grid__row heat-grid__row--head">
            <div className="heat-grid__label" />
            {columns.map((c) => (
              <div key={c.key} className="heat-grid__head">
                <span>{c.top}</span>
                <span className="heat-grid__opp">{c.bottom}</span>
              </div>
            ))}
            <div className="heat-grid__head heat-grid__head--season">
              <span>&nbsp;</span>
              <span className="heat-grid__opp">Season</span>
            </div>
          </div>
          {rows.map((r) => (
            <div key={r.key} className={`heat-grid__row${r.total ? ' heat-grid__row--total' : ''}`}>
              <div className="heat-grid__label">{r.label}</div>
              {columns.map((c) => cell(r, c, r.cells[c.key]))}
              {cell(r, null, r.season)}
            </div>
          ))}
        </div>
      </div>
      {hover && (
        <Tip x={hover.x} y={hover.y} width={hover.width}>
          <TipTitle>
            {hover.row.label}
            {hover.col ? ` ${hover.col.title}` : ', season'}
          </TipTitle>
          <TipLine>
            {hScore ?? '—'} · {hover.tally.graded} graded {hover.tally.graded === 1 ? 'snap' : 'snaps'} · {hover.tally.plus} / {hover.tally.zero} / {hover.tally.minus}
          </TipLine>
        </Tip>
      )}
    </div>
  )
}
