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

const parentName = (path: string) => path.split(/[\\/]/).slice(-2, -1)[0] ?? ''

const isOvertime = (path: string) => /^(ot|overtime)(?![a-z])/i.test(parentName(path))

/** How many folders above a clip are searched for an angle name. */
const ANGLE_FOLDER_DEPTH = 3

/** The angle one file or folder name points to, matching whole words only ("Inside Linebackers" isn't "side", "Wide Right" isn't "wide"). */
function nameAngle(name: string): Angle | null {
  const words = (name.toLowerCase().match(/[a-z]+/g) ?? []).join(' ')
  if (/\b(ez|end zone)\b|endzone/.test(words)) return 'endzone'
  if (/\b(sl|side)\b|sideline|\bwide\b(?! (right|left)\b)/.test(words)) return 'sideline'
  return null
}

/**
 * Guesses the camera angle from the file name or the nearest folder that names one, e.g.
 * "Q1_0412_EZ.mp4", "endzone/clip 3.mp4", "Sideline/1st Half/12.mov". `depth` is where it was
 * found: 0 for the file name, 1 for its folder, 2 for the one above, or -1 when nothing names an angle.
 */
export function angleSource(path: string): { angle: Angle; depth: number } {
  const names = path.split(/[\\/]/).filter(Boolean).reverse().slice(0, ANGLE_FOLDER_DEPTH + 1)
  for (const [depth, name] of names.entries()) {
    const angle = nameAngle(name)
    if (angle) return { angle, depth }
  }
  return { angle: 'main', depth: -1 }
}

export function detectAngle(path: string): Angle {
  return angleSource(path).angle
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
  for (const list of byAngle.values()) {
    // Folders that each restart their numbering (Q1/001, Q2/001…) are kept together, in folder order with overtime last.
    const byFolder = new Set(list.map(baseName)).size < list.length
    const folderOrder = (a: string, b: string) => Number(isOvertime(a)) - Number(isOvertime(b)) || naturalCompare(parentName(a), parentName(b))
    list.sort((a, b) => (byFolder ? folderOrder(a, b) : 0) || naturalCompare(baseName(a), baseName(b)) || naturalCompare(a, b))
  }

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
  // Unlinked clips right after one on the last play ran off the end of the list, so they carry on past it
  // (and come back when slid earlier). Other unlinked clips were skipped on purpose and stay put.
  let pastEnd = -1
  const positions = rows.map((row) => {
    if (row.angle !== angle) return -1
    if (row.playId === null) return pastEnd === -1 ? -1 : ++pastEnd
    const pos = ids.indexOf(row.playId)
    pastEnd = pos === ids.length - 1 ? pos : -1
    return pos
  })
  return rows.map((row, i) => {
    const pos = positions[i]
    if (i < index || pos === -1) return row
    const next = pos + delta
    return { ...row, playId: next >= 0 && next < ids.length ? ids[next] : null }
  })
}
