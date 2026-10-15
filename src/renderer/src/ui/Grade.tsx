import type { CSSProperties } from 'react'
import type { Grade, GradeTally } from '@shared/types'
import { fill, gradeGlyphScore, heatVars, ink } from './heat'
import { Icon } from './Icon'
import { noMouseFocus } from './keyboard'

export const GRADE_GLYPH = { 1: '+', 0: '0', [-1]: '−' } as Record<Grade, string>

/** "+", "0" or "−" in its heat ink; "—" when ungraded (spec 01 §6.29). */
export function GradeGlyph({ grade }: { grade: Grade | null }) {
  if (grade === null) return <span className="grade-glyph grade-glyph--none">—</span>
  return (
    <span className="grade-glyph" style={{ color: ink(gradeGlyphScore(grade)) }}>
      {GRADE_GLYPH[grade]}
    </span>
  )
}

const ORDER: { grade: Grade; test: string; label: string }[] = [
  { grade: -1, test: 'grade-minus', label: 'Minus' },
  { grade: 0, test: 'grade-zero', label: 'Zero' },
  { grade: 1, test: 'grade-plus', label: 'Plus' }
]

/** Three joined segments (−, 0, +); the selected one is a heat tint with its ink glyph and border. */
export function GradeControl({ value, onChange, size = 'md' }: { value: Grade | null; onChange: (g: Grade) => void; size?: 'md' | 'hud' }) {
  return (
    <div className={`grade-control grade-control--${size}`} role="group" aria-label="Grade">
      {ORDER.map((o) => (
        <button
          key={o.grade}
          type="button"
          className="grade-control__segment"
          aria-pressed={value === o.grade}
          aria-label={o.label}
          title={`${o.label} (${o.grade > 0 ? '=' : o.grade < 0 ? '−' : '0'})`}
          data-test={o.test}
          style={heatVars(gradeGlyphScore(o.grade)) as CSSProperties}
          onMouseDown={noMouseFocus}
          onClick={() => onChange(o.grade)}
        >
          {GRADE_GLYPH[o.grade]}
        </button>
      ))}
    </div>
  )
}

/** The critical-play mark, in its grade's ink. */
export function CriticalMark({ grade }: { grade: Grade | null }) {
  return <Icon name="zap" size={12} style={{ color: grade === null ? 'var(--label-3)' : ink(gradeGlyphScore(grade)) }} />
}

export function FlagMark({ on = true }: { on?: boolean }) {
  return <Icon name="flag" size={12} filled={on} className="flag-mark" />
}

/** 3px +/0/− tally bar; nothing when ungraded. */
export function TallyBar({ tally, width }: { tally: GradeTally; width?: number | string }) {
  if (!tally.graded) return null
  const parts = [
    { n: tally.plus, c: fill(100) },
    { n: tally.zero, c: fill(50) },
    { n: tally.minus, c: fill(0) }
  ].filter((p) => p.n > 0)
  return (
    <span className="tally-bar" style={{ width }} title={`${tally.plus} plus · ${tally.zero} zero · ${tally.minus} minus`}>
      {parts.map((p, i) => (
        <span key={i} style={{ flex: p.n, background: p.c }} />
      ))}
    </span>
  )
}

/** An integer grade in its ink, or "—". */
export function GradeValue({ score }: { score: number | null }) {
  if (score === null) return <span className="missing">—</span>
  return (
    <span className="grade-value" style={{ color: ink(score) }}>
      {Math.round(score)}
    </span>
  )
}

/** 20-tall tinted badge with the grade. */
export function GradeBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="missing">—</span>
  return (
    <span className="grade-badge" style={heatVars(score) as CSSProperties}>
      {Math.round(score)}
    </span>
  )
}
