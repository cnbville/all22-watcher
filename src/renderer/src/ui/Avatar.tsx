import { type CSSProperties, useState } from 'react'
import { teamMarkFor } from './teamMark'

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/** Player headshot with an initials fallback; hero sizes get a team ring (spec 01 §6.33). */
export function Avatar({ url, name, size = 32, team }: { url?: string; name: string; size?: 16 | 24 | 32 | 44 | 48 | 96 | 128; team?: string }) {
  const [failed, setFailed] = useState(false)
  const hero = size >= 96
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.38),
    ...(hero && team ? { '--team': teamMarkFor(team) } : {})
  } as CSSProperties
  return (
    <span className={`avatar${hero ? ' avatar--hero' : ''}`} style={style}>
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} draggable={false} /> : <span className="avatar__initials">{initials(name)}</span>}
    </span>
  )
}
