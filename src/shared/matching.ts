import type { Angle, ClipMatchRow, Play } from './types'

export const PLAYABLE_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm']
export const VIDEO_EXTENSIONS = [...PLAYABLE_EXTENSIONS, '.mkv', '.avi', '.wmv', '.mpg', '.mpeg', '.ts', '.mts', '.flv']

const SPECIAL_TYPES = new Set(['kickoff', 'punt', 'field_goal', 'extra_point'])

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Sorts "play 2.mp4" before "play 10.mp4". */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b)
}

export function extensionOf(path: string): string {
  const m = /\.[^./\\]+$/.exec(path)
  return m ? m[0].toLowerCase() : ''
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * Guesses the camera angle from the file name or its folder, e.g.
 * "Q1_0412_EZ.mp4", "endzone/clip 3.mp4", "SL - play 12.mov".
 */
export function detectAngle(path: string): Angle {
  const parts = path.split(/[\\/]/).slice(-2).join(' ').toLowerCase()
  const tokens = parts.split(/[^a-z0-9]+/).filter(Boolean)
  const joined = parts.replace(/[^a-z]/g, '')
  if (tokens.includes('ez') || joined.includes('endzone') || tokens.includes('end') && tokens.includes('zone')) return 'endzone'
  if (tokens.includes('sl') || joined.includes('sideline') || tokens.includes('wide') || tokens.includes('side')) return 'sideline'
  return 'main'
}

/** Plays that get their own clip in a typical one-clip-per-play cut-up, in game order. */
export function filmablePlays(plays: Play[], includeSpecialTeams: boolean, includeNoPlays: boolean): Play[] {
  return plays
    .filter((p) => p.playType !== '')
    .filter((p) => includeSpecialTeams || !SPECIAL_TYPES.has(p.playType))
    .filter((p) => includeNoPlays || p.playType !== 'no_play')
    .sort((a, b) => a.playId - b.playId)
}

export interface MatchResult {
  rows: ClipMatchRow[]
  includeSpecialTeams: boolean
  includeNoPlays: boolean
  warnings: string[]
}

/**
 * Pairs clips with plays in order, one angle at a time. When the caller doesn't say whether
 * special teams or no-plays were cut, picks whichever combination best matches the clip count.
 */
export function matchClips(
  paths: string[],
  plays: Play[],
  opts: { includeSpecialTeams?: boolean; includeNoPlays?: boolean } = {}
): MatchResult {
  const byAngle = new Map<Angle, string[]>()
  for (const p of paths) {
    const angle = detectAngle(p)
    byAngle.set(angle, [...(byAngle.get(angle) ?? []), p])
  }
  for (const list of byAngle.values()) list.sort((a, b) => naturalCompare(baseName(a), baseName(b)) || naturalCompare(a, b))

  const largest = Math.max(0, ...[...byAngle.values()].map((l) => l.length))
  const stOptions = opts.includeSpecialTeams === undefined ? [true, false] : [opts.includeSpecialTeams]
  const npOptions = opts.includeNoPlays === undefined ? [true, false] : [opts.includeNoPlays]
  let best = { st: stOptions[0], np: npOptions[0], diff: Infinity }
  for (const st of stOptions) {
    for (const np of npOptions) {
      const diff = Math.abs(filmablePlays(plays, st, np).length - largest)
      if (diff < best.diff) best = { st, np, diff }
    }
  }

  const ordered = filmablePlays(plays, best.st, best.np)
  const rows: ClipMatchRow[] = []
  const warnings: string[] = []
  for (const [angle, list] of byAngle) {
    list.forEach((path, i) => {
      rows.push({ path, fileName: baseName(path), angle, playId: ordered[i]?.playId ?? null })
    })
    const label = angle === 'main' ? '' : ` ${angle}`
    if (list.length > ordered.length) {
      warnings.push(`${list.length}${label} clips but only ${ordered.length} plays; the last ${list.length - ordered.length} are unlinked.`)
    } else if (list.length < ordered.length) {
      warnings.push(`${list.length}${label} clips for ${ordered.length} plays; check the matches and shift any that are off.`)
    }
  }
  return { rows, includeSpecialTeams: best.st, includeNoPlays: best.np, warnings }
}

/**
 * Moves every clip from `index` onward (within the same angle) by `delta` plays,
 * for when one clip is missing or extra in the middle of a game.
 */
export function shiftMatches(rows: ClipMatchRow[], index: number, delta: number, ordered: Play[]): ClipMatchRow[] {
  const angle = rows[index]?.angle
  const ids = ordered.map((p) => p.playId)
  return rows.map((row, i) => {
    if (i < index || row.angle !== angle) return row
    const pos = row.playId === null ? -1 : ids.indexOf(row.playId)
    if (pos === -1) return row
    const next = pos + delta
    return { ...row, playId: next >= 0 && next < ids.length ? ids[next] : null }
  })
}
