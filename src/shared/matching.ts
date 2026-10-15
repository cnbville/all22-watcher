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

const isOvertime = (folder: string) => /^(ot|overtime)(?![a-z])/i.test(folder)

const NUMBER_WORDS: Record<string, string> = { first: '1', one: '1', second: '2', two: '2', third: '3', three: '3', fourth: '4', four: '4', fifth: '5', five: '5' }

/** A folder name as it sorts, so "Second Quarter" comes before "Third Quarter" and "Quarter Two" before "Quarter Three". */
const folderKey = (folder: string) => folder.toLowerCase().replace(/[a-z]+/g, (w) => NUMBER_WORDS[w] ?? w)

const VIDEO_SUFFIX = new RegExp(`(${VIDEO_EXTENSIONS.map((e) => `\\${e}`).join('|')})+$`, 'i')

/** A file name without its video extensions, so a converted "001.mkv.mp4" and "001.mp4" are both clip 001. */
const stem = (path: string) => baseName(path).replace(VIDEO_SUFFIX, '')

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
 * Each file's path from the folder holding everything the user picked down (for a picked file, from the folder it's in).
 * Angles are detected from these, so a "Side Projects" folder the film sits in isn't taken for the sideline. The holding
 * folder's own name counts, so picking "Sideline", or Q1..Q4 inside it, reads as the sideline, unless what's inside it
 * already names angles: then it only holds them, like "Eagles Wide Receivers" around All-22 and Sideline picked together.
 */
export function pickedPaths(picked: string[], files: string[]): Map<string, string> {
  const isFile = new Set(files)
  const [first = [], ...rest] = picked.map((p) => p.split(/[\\/]/).filter(Boolean).slice(0, isFile.has(p) ? -1 : undefined))
  let shared = 0
  while (shared < first.length && rest.every((r) => r[shared] === first[shared])) shared++
  const below = files.map((f): [string, string | null] => {
    const parts = f.split(/[\\/]/).filter(Boolean)
    return [f, parts.slice(0, shared).every((name, i) => name === first[i]) ? parts.slice(shared).join('/') : null]
  })
  const holder = below.some(([, p]) => p !== null && angleSource(p).depth >= 0) ? [] : first.slice(Math.max(0, shared - 1), shared)
  return new Map(below.map(([f, p]): [string, string] => [f, p === null ? f : [...holder, p].join('/')]))
}

/**
 * Puts one angle's clips in file name order. When numbering restarts in each folder (Q1/001, Q2/001…), clips are kept
 * together by folder, in folder order with overtime last. Only as many folders up as it takes to tell the restarts apart
 * are compared, so Q1/Sideline/001 and Sideline/Q1/001 both work.
 */
function sortClips(list: string[], nameOf: (path: string) => string) {
  const folders = new Map(list.map((p) => [p, nameOf(p).split(/[\\/]/).slice(0, -1)]))
  const lastFolders = (p: string, depth: number) => {
    const f = folders.get(p)!
    return [...Array<string>(Math.max(0, depth - f.length)).fill(''), ...f.slice(Math.max(0, f.length - depth))]
  }
  const restarts = (depth: number) => {
    const seen = new Map<string, string>()
    return list.some((p) => {
      const key = [...lastFolders(p, depth), stem(nameOf(p))].join('\0')
      const dir = folders.get(p)!.join('/')
      if ((seen.get(key) ?? dir) !== dir) return true
      seen.set(key, dir)
      return false
    })
  }
  const deepest = Math.max(0, ...[...folders.values()].map((f) => f.length))
  let depth = 0
  while (depth < deepest && restarts(depth)) depth++
  const folderOrder = (a: string, b: string) => {
    const [x, y] = [lastFolders(a, depth), lastFolders(b, depth)]
    return Number(x.some(isOvertime)) - Number(y.some(isOvertime)) || x.reduce((c, f, i) => c || naturalCompare(folderKey(f), folderKey(y[i])), 0)
  }
  list.sort(
    (a, b) => folderOrder(a, b) || naturalCompare(baseName(nameOf(a)), baseName(nameOf(b))) || naturalCompare(nameOf(a), nameOf(b)) || naturalCompare(a, b)
  )
}

/**
 * Pairs clips with plays in order, one angle at a time. When the caller doesn't say whether
 * special teams or no-plays were cut, picks whichever combination best matches the clip count.
 * `nameOf` gives the path angles and order are read from: by default the clip's own, but the caller
 * can pass the part inside the picked folder, or a converted copy's original.
 */
export function matchClips(
  paths: string[],
  plays: Play[],
  opts: { includeSpecialTeams?: boolean; includeNoPlays?: boolean } = {},
  nameOf: (path: string) => string = (p) => p
): MatchResult {
  const byAngle = new Map<Angle, string[]>()
  for (const p of paths) {
    const angle = detectAngle(nameOf(p))
    byAngle.set(angle, [...(byAngle.get(angle) ?? []), p])
  }
  for (const list of byAngle.values()) sortClips(list, nameOf)

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
