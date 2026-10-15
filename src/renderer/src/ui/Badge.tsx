import type { CSSProperties, ReactNode } from 'react'
import { heatVars, rankScore } from './heat'

/** Attention count (sidebar Film, My Teams), hidden at 0 by the caller (spec 01 §6.30). */
export function CountBadge({ count, title }: { count: number; title?: string }) {
  return (
    <span className="count-badge" title={title}>
      {count}
    </span>
  )
}

/** A plain tabular count with no shape. */
export function PlainCount({ count }: { count: number | string }) {
  return <span className="plain-count">{count}</span>
}

export type TextBadgeVariant = 'neutral' | 'flag' | 'danger' | 'heat'

/** "NEW", "SMART", "FLAGGED". Heat badges take a score. */
export function TextBadge({
  children,
  variant = 'neutral',
  score,
  title
}: {
  children: ReactNode
  variant?: TextBadgeVariant
  score?: number
  title?: string
}) {
  return (
    <span className={`text-badge text-badge--${variant}`} style={variant === 'heat' && score !== undefined ? (heatVars(score) as CSSProperties) : undefined} title={title}>
      {children}
    </span>
  )
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** A league rank colored on the heat scale by percentile; neutral stats stay grey. */
export function RankBadge({ rank, of = 32, neutral, title }: { rank: number; of?: number; neutral?: boolean; title?: string }) {
  return (
    <span
      className={`rank-badge${neutral ? ' rank-badge--neutral' : ''}`}
      style={neutral ? undefined : (heatVars(rankScore(rank, of)) as CSSProperties)}
      title={title}
    >
      {ordinal(rank)}
    </span>
  )
}
