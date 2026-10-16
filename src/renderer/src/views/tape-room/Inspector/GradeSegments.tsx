import type { CSSProperties } from 'react'
import type { Grade } from '@shared/types'
import { GRADE_GLYPH } from '../../../ui/Grade'
import { gradeGlyphScore, heatVars } from '../../../ui/heat'
import { noMouseFocus } from '../../../ui/keyboard'

/**
 * The tape room's Minus / Even / Plus control: a quiet segmented track whose selected segment takes the grade's muted
 * heat tint. `full` shows the words with their keys (−, 0, =) under them; `compact` shows only the glyphs, for
 * collapsed grading rows. Keys, tests and pressed state match the shared grade control.
 */

const ORDER: { grade: Grade; test: string; label: string; key: string }[] = [
  { grade: -1, test: 'grade-minus', label: 'Minus', key: '−' },
  { grade: 0, test: 'grade-zero', label: 'Even', key: '0' },
  { grade: 1, test: 'grade-plus', label: 'Plus', key: '=' }
]

export function GradeSegments({
  value,
  onChange,
  variant = 'full',
  tone = 'panel'
}: {
  value: Grade | null
  onChange: (g: Grade) => void
  variant?: 'full' | 'compact' | 'large'
  /** `glass` is the version drawn over video. */
  tone?: 'panel' | 'glass'
}) {
  return (
    <div className={`grade-seg grade-seg--${variant} grade-seg--${tone}`} role="group" aria-label="Grade">
      {ORDER.map((o) => (
        <button
          key={o.grade}
          type="button"
          className="grade-seg__item"
          aria-pressed={value === o.grade}
          aria-label={o.label}
          title={`${o.label} (${o.key})`}
          data-test={o.test}
          style={heatVars(gradeGlyphScore(o.grade)) as CSSProperties}
          onMouseDown={noMouseFocus}
          onClick={() => onChange(o.grade)}
        >
          {variant === 'compact' ? (
            <span className="grade-seg__glyph">{GRADE_GLYPH[o.grade]}</span>
          ) : (
            <>
              <span className="grade-seg__label">{o.label}</span>
              <span className="grade-seg__key">{o.key}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

/** A 6px grade mark: filled in the grade's muted ink, a hollow ring when ungraded or partly graded. */
export function GradeMark({ color, hollow, title, test, state }: { color: string | null; hollow?: boolean; title?: string; test?: string; state?: string }) {
  return (
    <span
      className="grade-mark"
      data-hollow={hollow || color === null || undefined}
      data-test={test}
      data-state={state}
      title={title}
      style={color ? ({ '--mark': color } as CSSProperties) : undefined}
    />
  )
}
