import type { CSSProperties, ReactNode } from 'react'
import type { GradeTally } from '@shared/types'
import { SMALL_SAMPLE } from '@shared/splits'
import { heatFor, type Palette, rankScore } from '../../../ui/heat'
import { RankBadge } from '../../../ui/Badge'

/**
 * Split bar (03 §2.8.8): a diverging bar for grades in tables. Track 160 × 6 with a tick at 50; the bar runs from
 * the center to the grade, in the heat fill (neutral under 5 plays). No value text.
 */
export function SplitBar({ score, plays, width = 160, palette = 'screen' }: { score: number | null; plays: number; width?: number; palette?: Palette }) {
  const heat = heatFor(palette)
  const small = plays < SMALL_SAMPLE
  const s = score === null ? 50 : Math.max(0, Math.min(100, score))
  const half = width / 2
  const len = (Math.abs(s - 50) / 50) * half
  const style: CSSProperties = {
    width: len,
    left: s >= 50 ? half : half - len,
    background: small ? 'var(--ch-neutral)' : heat.fill(s),
    borderRadius: s >= 50 ? '0 3px 3px 0' : '3px 0 0 3px'
  }
  return (
    <span className="split-bar" style={{ width }} aria-hidden>
      {score !== null && plays > 0 && len > 0 && <span className="split-bar__fill" style={style} />}
      <span className="split-bar__tick" />
    </span>
  )
}

/** Large tally bar (03 §2.8.9): the 6px version of the +/0/− bar, 2px gaps, for wide contexts. */
export function LargeTallyBar({ tally, palette = 'screen', height = 6 }: { tally: GradeTally; palette?: Palette; height?: number }) {
  if (!tally.graded) return null
  const heat = heatFor(palette)
  const parts = [
    { n: tally.plus, c: heat.fill(100), label: 'plus' },
    { n: tally.zero, c: heat.fill(50), label: 'zero' },
    { n: tally.minus, c: heat.fill(0), label: 'minus' }
  ].filter((p) => p.n > 0)
  return (
    <span className="large-tally" style={{ height }} title={`${tally.plus} plus · ${tally.zero} zero · ${tally.minus} minus`}>
      {parts.map((p) => (
        <span key={p.label} style={{ flex: p.n, background: p.c }} />
      ))}
    </span>
  )
}

export interface VersusSide {
  /** Display value ("+0.03", "68"); null shows "—". */
  value: string | null
  /** 0–100: the rank score or the grade, for the bar and color. */
  score: number | null
  /** League rank for a rank badge. */
  rank?: number | null
  /** Instead of a rank badge (grade rows): "81" graded snaps. */
  note?: string
  /** Neutral rank badge (pass rate). */
  neutral?: boolean
}

/**
 * Versus row (03 §2.8.6, improvement 11): an Apple Sports-style head-to-head line. `better` decides which value is
 * semibold; bars grow away from the center label in each side's heat fill.
 */
export function VersusRow({
  label,
  sublabel,
  left,
  right,
  better,
  test
}: {
  label: ReactNode
  sublabel?: ReactNode
  left: VersusSide
  right: VersusSide
  better: 'left' | 'right' | 'equal' | null
  test?: string
}) {
  const side = (s: VersusSide, dir: 'left' | 'right') => {
    const weight = better === 'equal' ? 'equal' : better === dir ? 'better' : 'worse'
    const value = s.value === null ? <span className="versus-row__value versus-row__value--none">—</span> : <span className={`versus-row__value versus-row__value--${weight}`}>{s.value}</span>
    const badge =
      s.value === null ? <span /> : s.note !== undefined ? <span className="versus-row__note">{s.note}</span> : s.rank ? <RankBadge rank={s.rank} neutral={s.neutral} /> : <span />
    const bar =
      s.value === null || s.score === null ? (
        <span className="versus-row__bar" />
      ) : (
        <span className={`versus-row__bar versus-row__bar--${dir}`}>
          <span
            className="versus-row__fill"
            style={{ width: `${Math.max(2, Math.min(100, s.score))}%`, '--fill': heatFor('screen').fill(s.score), '--ink': heatFor('screen').ink(s.score) } as CSSProperties}
          />
        </span>
      )
    return dir === 'left' ? (
      <>
        {value}
        {badge}
        {bar}
      </>
    ) : (
      <>
        {bar}
        {badge}
        {value}
      </>
    )
  }
  return (
    <div className="versus-row" data-test={test}>
      {side(left, 'left')}
      <span className="versus-row__label">
        <span className="versus-row__title">{label}</span>
        {sublabel && <span className="versus-row__sub">{sublabel}</span>}
      </span>
      {side(right, 'right')}
    </div>
  )
}

/** Rank → the 0–100 score bars use (01 §5.2). */
export { rankScore }
