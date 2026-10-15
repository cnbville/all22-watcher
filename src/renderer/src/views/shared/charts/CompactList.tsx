import type { GradeTally } from '@shared/types'
import type { Palette } from '../../../ui/heat'
import { SampleBadge } from '../SampleGrade'

export interface CompactRow {
  key: string
  /** "Wk 1 vs DAL" */
  label: string
  /** "20 plays" */
  detail?: string
  tally?: GradeTally | null
  score: number | null
  /** Graded plays behind the score (§2.4 grey under 5); defaults to the tally's graded count. */
  plays?: number
  /** The tooltip of the mark this row replaces. */
  title?: string
}

/**
 * Replaces a bar chart or scatter with fewer than 4 marks (03 §2.8.2): rows 32 tall, label and detail, the tally
 * right-aligned and a grade badge. Rows behave like the marks they replace.
 */
export function CompactList({
  rows,
  palette = 'screen',
  onSelect,
  onOpen,
  test,
  rowTest
}: {
  rows: CompactRow[]
  palette?: Palette
  onSelect?: (key: string) => void
  onOpen?: (key: string) => void
  test?: string
  rowTest?: string
}) {
  return (
    <div className="compact-list" data-test={test} role="list">
      {rows.map((r) => {
        const plays = r.plays ?? r.tally?.graded ?? 0
        return (
          <div
            key={r.key}
            className="compact-list__row"
            role="listitem"
            data-test={rowTest}
            data-clickable={onSelect ? true : undefined}
            title={r.title}
            onClick={() => onSelect?.(r.key)}
            onDoubleClick={() => onOpen?.(r.key)}
          >
            <span className="compact-list__label ellipsis">{r.label}</span>
            {r.detail && <span className="compact-list__detail ellipsis">{r.detail}</span>}
            <span className="compact-list__tally">{r.tally && r.tally.graded ? `${r.tally.plus} / ${r.tally.zero} / ${r.tally.minus}` : ''}</span>
            <span className="compact-list__badge">
              <SampleBadge score={r.score} plays={plays} palette={palette} />
            </span>
          </div>
        )
      })}
    </div>
  )
}
