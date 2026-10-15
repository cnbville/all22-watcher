import type { CSSProperties } from 'react'
import { TEAM_BY_ABBR } from '@shared/teams'
import { badgeTextColor, teamMarkFor } from './teamMark'

const teamStyle = (abbr: string) => ({ '--team': teamMarkFor(abbr) }) as CSSProperties

/** 10px circle in the team's mark color (spec 01 §6.32). */
export function TeamDot({ abbr, size = 10 }: { abbr: string; size?: number }) {
  return <span className="team-dot" style={{ ...teamStyle(abbr), width: size, height: size }} title={TEAM_BY_ABBR[abbr]?.name ?? abbr} />
}

/** Small chip with a 3px leading team edge, for tables and rows. */
export function TeamChip({ abbr, size = 'sm' }: { abbr: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`team-chip team-chip--${size}`} style={teamStyle(abbr)} title={TEAM_BY_ABBR[abbr]?.name ?? abbr}>
      {abbr}
    </span>
  )
}

/** The large solid badge in team and player headers, in the raw primary color. */
export function TeamBadge({ abbr }: { abbr: string }) {
  const color = TEAM_BY_ABBR[abbr]?.color ?? '#333338'
  return (
    <span className="team-badge" style={{ background: color, color: badgeTextColor(color) }} title={TEAM_BY_ABBR[abbr]?.name ?? abbr}>
      {abbr}
    </span>
  )
}

export { teamStyle }
