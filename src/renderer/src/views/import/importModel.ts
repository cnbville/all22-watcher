import { checkAlignment } from '@shared/alignment'
import { matchGameName, parseGameName } from '@shared/gameMatch'
import { shortDesc } from '@shared/labels'
import { extensionOf } from '@shared/matching'
import type { AlignmentResult, AlignmentSuspect, Angle, ClipMatchRow, GameInfo, Play } from '@shared/types'

/**
 * Pure helpers behind the Import Film and Fix Clip Matches sheets: angle folders, the game a folder name points to,
 * clip lengths and the alignment check re-run on the rows as the user edits them.
 */

export const ANGLES: Angle[] = ['sideline', 'endzone', 'main']
export const ANGLE_LABEL: Record<Angle, string> = { sideline: 'Sideline', endzone: 'End Zone', main: 'Main' }

/** A row as the sheets keep it: Fix Clip Matches also knows the saved clip. */
export interface SheetRow extends ClipMatchRow {
  clipId?: number
  snapMs?: number | null
}

const parts = (path: string) => path.split(/[\\/]/).filter(Boolean)
export const dirOf = (path: string) => path.slice(0, Math.max(0, path.length - (parts(path).pop()?.length ?? 0) - 1))
export const nameOf = (path: string) => parts(path).pop() ?? path

/** MP4 copies the converter made sit under `<data>/converted/<game>/<hash>/…` (main/convert.ts). */
const COPY = /[\\/]converted[\\/][^\\/]+[\\/][0-9a-f]{6,}(?=[\\/])/i
export const isConvertedCopy = (path: string) => COPY.test(path)

/** The name to show for a clip: a converted copy shows its original's name ("Play 1.mkv"). */
export function clipName(row: Pick<ClipMatchRow, 'path' | 'fileName'>): string {
  return isConvertedCopy(row.path) ? row.fileName.replace(/\.mp4$/i, '') : row.fileName
}

/** One folder of clips as the Angles group lists it. */
export interface AngleFolder {
  dir: string
  /** The folder name, or "Sideline › Q1" when two folders share a name. */
  label: string
  angle: Angle
  count: number
  paths: string[]
}

/**
 * Groups rows by the folder their clips sit in, with the angle each folder was matched as. A folder whose clips were
 * read as different angles (angle named in the file names) shows its most common one. Converted copies count with
 * the folder of the same name they came from.
 */
export function angleFolders(rows: ClipMatchRow[]): AngleFolder[] {
  const byDir = new Map<string, ClipMatchRow[]>()
  const copies: ClipMatchRow[] = []
  for (const r of rows) {
    if (isConvertedCopy(r.path)) {
      copies.push(r)
      continue
    }
    const d = dirOf(r.path)
    byDir.set(d, [...(byDir.get(d) ?? []), r])
  }
  for (const r of copies) {
    const name = nameOf(dirOf(r.path))
    const home = [...byDir.keys()].find((d) => !isConvertedCopy(`${d}/x`) && nameOf(d) === name) ?? dirOf(r.path)
    byDir.set(home, [...(byDir.get(home) ?? []), r])
  }
  const names = new Map<string, number>()
  for (const d of byDir.keys()) names.set(nameOf(d), (names.get(nameOf(d)) ?? 0) + 1)
  return [...byDir.entries()]
    .map(([dir, list]) => {
      const counts = new Map<Angle, number>()
      for (const r of list) counts.set(r.angle, (counts.get(r.angle) ?? 0) + 1)
      const angle = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const name = nameOf(dir)
      const label = isConvertedCopy(`${dir}/x`) ? `${name} (converted)` : (names.get(name) ?? 0) > 1 ? `${nameOf(dirOf(dir))} › ${name}` : name
      return { dir, label, angle, count: list.length, paths: list.map((r) => r.path) }
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

/** Clip counts per angle when they differ from the number of plays to match (the sheet's "counts differ" notice). */
export function countMismatch(rows: ClipMatchRow[], plays: number): { angle: Angle; clips: number }[] | null {
  const per = ANGLES.map((angle) => ({ angle, clips: rows.filter((r) => r.angle === angle).length })).filter((x) => x.clips > 0)
  return per.some((x) => x.clips !== plays) ? per : null
}

/** Every row's angle, with one folder's clips set to `angle` (the `angles` option of previewMatch). */
export function anglesWithFolder(rows: ClipMatchRow[], folder: AngleFolder, angle: Angle): Record<string, Angle> {
  const inFolder = new Set(folder.paths)
  return Object.fromEntries(rows.map((r) => [r.path, inFolder.has(r.path) ? angle : r.angle]))
}

/** Folder and file names, nearest first, that might name the game ("DAL at PHI", "2025 Wk 1 DAL @ PHI"). */
export function gameNameCandidates(paths: string[]): string[] {
  const out: string[] = []
  for (const p of paths) {
    const ps = parts(p)
    const isFile = !!extensionOf(p)
    for (const name of ps.slice(-4, isFile ? -1 : undefined).reverse()) if (!out.includes(name)) out.push(name)
    if (isFile && !out.includes(ps[ps.length - 1])) out.push(ps[ps.length - 1])
  }
  return out
}

/** The first candidate name that names two teams, parsed. */
export function parsedGameName(paths: string[]): { name: string; teams: string[]; season: number | null } | null {
  for (const name of gameNameCandidates(paths)) {
    const parsed = parseGameName(name)
    if (parsed.teams.length >= 2) return { name, teams: parsed.teams, season: parsed.season }
  }
  return null
}

/** Picks the game a folder name names among `games` (one team's schedule), preferring games without film. */
export function guessGame(name: string, games: (GameInfo & { clipCount?: number })[]): GameInfo | null {
  return matchGameName(name, games, { hasFilm: (id) => (games.find((g) => g.gameId === id)?.clipCount ?? 0) > 0 }).game
}

/** The alignment check on the rows as they stand, from lengths read once. */
export function alignRows(gameId: string, rows: SheetRow[], durations: Record<string, number | null>, plays: Play[]): AlignmentResult {
  return checkAlignment(
    gameId,
    rows.map((r) => ({ clipId: r.clipId ?? null, path: r.path, angle: r.angle, playId: r.playId, duration: durations[r.path] ?? null })),
    plays
  )
}

/** "5.4 s" */
export function lengthLabel(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return ''
  return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)} s`
}

/** "Q1 14:05" */
export function clockLabel(p: Play): string {
  return `${p.qtr >= 5 ? 'OT' : `Q${p.qtr}`} ${p.time}`.trim()
}

/** The one-line description used in the Play column and the play menu. */
export function playLine(p: Play): string {
  return shortDesc(p.desc.replace(/^\s*\(\d*:\d{2}\)\s*/, ''))
}

/** What the suggested fix does, for the inline button. */
export type SuspectFix = { kind: 'shift'; delta: 1 | -1; label: string } | { kind: 'move'; playId: number; label: string } | null

/**
 * A clip that fits the play one over is fixed by sliding from here (v1's fix for a missing or extra clip mid-game);
 * one that fits a play further away moves there.
 */
export function suspectFix(s: AlignmentSuspect, ordered: Play[]): SuspectFix {
  if (s.betterPlayId === null) return null
  const ids = ordered.map((p) => p.playId)
  const here = ids.indexOf(s.playId)
  const there = ids.indexOf(s.betterPlayId)
  if (here >= 0 && there >= 0 && Math.abs(there - here) === 1) {
    const delta = (there - here) as 1 | -1
    return { kind: 'shift', delta, label: delta < 0 ? 'Slide Earlier' : 'Slide Later' }
  }
  return { kind: 'move', playId: s.betterPlayId, label: 'Move' }
}

/** "120 clips · 2 angles · 60 plays" */
export function summaryLine(rows: ClipMatchRow[]): string {
  const angles = new Set(rows.map((r) => r.angle)).size
  const plays = new Set(rows.filter((r) => r.playId !== null).map((r) => r.playId)).size
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  return [n(rows.length, 'clip'), angles > 1 ? n(angles, 'angle') : null, n(plays, 'play')].filter(Boolean).join(' · ')
}

/** Rows ordered for the table: by angle (sideline, end zone, main), then as matched. */
export function orderedRows<R extends ClipMatchRow>(rows: R[]): R[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ANGLES.indexOf(a.r.angle) - ANGLES.indexOf(b.r.angle) || a.i - b.i)
    .map((x) => x.r)
}
