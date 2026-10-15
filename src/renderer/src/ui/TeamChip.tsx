import { type CSSProperties, useState } from 'react'
import { logoUrl } from '@shared/api'
import { TEAM_BY_ABBR } from '@shared/teams'
import { badgeTextColor, teamMarkFor } from './teamMark'

const teamStyle = (abbr: string) => ({ '--team': teamMarkFor(abbr) }) as CSSProperties

/** Logos that failed to load this session, so every later mark for that team goes straight to the fallback. */
const missing = new Set<string>()

/**
 * The team's logo from nflverse (cached on disk by the main process). Until it loads, and if it can't be had, a
 * circle in the team's color with its abbreviation stands in.
 */
export function TeamLogo({ abbr, size = 20, className }: { abbr: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(missing.has(abbr))
  const [loaded, setLoaded] = useState(false)
  const name = TEAM_BY_ABBR[abbr]?.name ?? abbr
  const color = TEAM_BY_ABBR[abbr]?.color ?? '#333338'
  return (
    <span
      className={`team-logo${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, ...(failed || !loaded ? { background: color, color: badgeTextColor(color) } : null) }}
      data-fallback={failed || !loaded || undefined}
      title={name}
      role="img"
      aria-label={name}
    >
      {(failed || !loaded) && size >= 18 && <span className="team-logo__abbr" style={{ fontSize: Math.max(8, Math.round(size * 0.32)) }}>{abbr}</span>}
      {!failed && (
        <img
          src={logoUrl(abbr)}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => {
            missing.add(abbr)
            setFailed(true)
          }}
        />
      )}
    </span>
  )
}

/** Small team logo, for rows and lists (spec 01 §6.32; was a 10px color dot). */
export function TeamDot({ abbr, size = 10 }: { abbr: string; size?: number }) {
  return <TeamLogo abbr={abbr} size={Math.max(14, size + 4)} className="team-logo--inline" />
}

/** Logo and abbreviation, for tables and rows. */
export function TeamChip({ abbr, size = 'sm' }: { abbr: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`team-chip team-chip--${size}`} style={teamStyle(abbr)} title={TEAM_BY_ABBR[abbr]?.name ?? abbr}>
      <TeamLogo abbr={abbr} size={size === 'md' ? 18 : 15} />
      {abbr}
    </span>
  )
}

/** The large logo in team and player headers. */
export function TeamBadge({ abbr, size = 56 }: { abbr: string; size?: number }) {
  return <TeamLogo abbr={abbr} size={size} className="team-logo--badge" />
}

export { teamStyle }
