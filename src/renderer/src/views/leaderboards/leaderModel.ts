import { emptyTally, gradeScore, mergeTally, plusRate } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { GradeTally, LeaderRow, PositionGroup } from '@shared/types'

/** Leaderboards (03 §7): filters, ranking, sorting and the CSV, all in the renderer. */

export interface LeaderFilters {
  minSnaps: number
  /** 'all', 'mine' or a team abbreviation. */
  teams: string
  /** 0 = all games, else the last N graded games. */
  lastGames: 0 | 4 | 8
}

export const DEFAULT_FILTERS: LeaderFilters = { minSnaps: 10, teams: 'all', lastGames: 0 }

export const GROUPS: PositionGroup[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB']
export const GROUP_NAMES: Record<string, string> = {
  QB: 'Quarterbacks',
  RB: 'Running Backs',
  WR: 'Wide Receivers',
  TE: 'Tight Ends',
  OL: 'Offensive Line',
  DL: 'Defensive Line',
  LB: 'Linebackers',
  DB: 'Defensive Backs'
}
/** "quarterbacks" for "No quarterbacks graded yet". */
export const groupNoun = (g: string) => (GROUP_NAMES[g] === 'Offensive Line' ? 'offensive linemen' : GROUP_NAMES[g] === 'Defensive Line' ? 'defensive linemen' : (GROUP_NAMES[g] ?? g).toLowerCase())

export interface LeaderView {
  row: LeaderRow
  id: string
  name: string
  /** Latest team last. */
  teams: string[]
  position: string
  games: number
  snaps: number
  tally: GradeTally
  graded: number
  grade: number | null
  plusRate: number | null
  crit: number
  epa: number | null
  trend: number[]
  rank: number
  /** Shares its rank with another row. */
  tied: boolean
}

export function filtersOn(f: LeaderFilters): boolean {
  return f.minSnaps !== DEFAULT_FILTERS.minSnaps || f.teams !== DEFAULT_FILTERS.teams || f.lastGames !== DEFAULT_FILTERS.lastGames
}

/** "Min. 20 graded snaps · My Teams · Last 4 games" (non-default filters only). */
export function filterSummary(f: LeaderFilters): string {
  const parts: string[] = []
  if (f.minSnaps !== DEFAULT_FILTERS.minSnaps) parts.push(`Min. ${f.minSnaps} graded ${f.minSnaps === 1 ? 'snap' : 'snaps'}`)
  if (f.teams === 'mine') parts.push('My Teams')
  else if (f.teams !== 'all') parts.push(TEAM_BY_ABBR[f.teams]?.nickname ?? f.teams)
  if (f.lastGames) parts.push(`Last ${f.lastGames} games`)
  return parts.join(' · ')
}

/** One row's figures under the filters ("Last N Games" recomputes from those games only). */
export function viewOf(row: LeaderRow, f: LeaderFilters): Omit<LeaderView, 'rank' | 'tied'> {
  let tally = row.tally
  let epa = row.epa
  if (f.lastGames) {
    const recent = row.lastGames.slice(0, f.lastGames)
    tally = recent.reduce((t, g) => mergeTally(t, g.tally), emptyTally())
    const plays = recent.reduce((s, g) => s + g.epaPlays, 0)
    epa = plays ? recent.reduce((s, g) => s + g.epaSum, 0) / plays : null
  }
  const ids = new Set(f.lastGames ? row.lastGames.slice(0, f.lastGames).map((g) => g.gameId) : row.byGame.map((g) => g.gameId))
  return {
    row,
    id: row.player.id,
    name: row.player.name,
    teams: row.teams.length ? row.teams : [row.player.team],
    position: row.player.depthPos || row.player.position,
    games: row.games,
    snaps: row.snaps,
    tally,
    graded: tally.graded,
    grade: tally.graded ? gradeScore(tally) : null,
    plusRate: tally.graded ? plusRate(tally) : null,
    crit: tally.critical,
    epa,
    trend: row.byGame.filter((g) => ids.has(g.gameId)).map((g) => g.grade)
  }
}

/** Filters rows (min graded snaps, teams), then ranks by grade with competition ranking (1, 2, 2, 4). */
export function rankRows(rows: LeaderRow[], f: LeaderFilters, myTeams: string[]): LeaderView[] {
  const views = rows
    .map((r) => viewOf(r, f))
    .filter((v) => v.graded > 0 && v.graded >= f.minSnaps)
    .filter((v) => (f.teams === 'all' ? true : f.teams === 'mine' ? v.teams.some((t) => myTeams.includes(t)) : v.teams.includes(f.teams)))
  const byGrade = [...views].sort((a, b) => (b.grade ?? -1) - (a.grade ?? -1))
  const out: LeaderView[] = []
  byGrade.forEach((v, i) => {
    const prev = out[i - 1]
    const rank = prev && prev.grade === v.grade ? prev.rank : i + 1
    out.push({ ...v, rank, tied: false })
  })
  const counts = new Map<number, number>()
  out.forEach((v) => counts.set(v.rank, (counts.get(v.rank) ?? 0) + 1))
  out.forEach((v) => (v.tied = (counts.get(v.rank) ?? 0) > 1))
  return out
}

export type LeaderSortColumn = 'player' | 'team' | 'pos' | 'games' | 'snaps' | 'graded' | 'plusRate' | 'crit' | 'epa' | 'grade'
export interface LeaderSort {
  column: LeaderSortColumn
  dir: 'asc' | 'desc'
}
export const DEFAULT_SORT: LeaderSort = { column: 'grade', dir: 'desc' }

/** Sorts views; ties by Graded descending, then name. */
export function sortRows(rows: LeaderView[], s: LeaderSort): LeaderView[] {
  const val = (v: LeaderView): number | string => {
    switch (s.column) {
      case 'player':
        return v.name
      case 'team':
        return v.teams[v.teams.length - 1] ?? ''
      case 'pos':
        return v.position
      case 'games':
        return v.games
      case 'snaps':
        return v.snaps
      case 'graded':
        return v.graded
      case 'plusRate':
        return v.plusRate ?? -1
      case 'crit':
        return v.crit
      case 'epa':
        return v.epa ?? -99
      case 'grade':
        return v.grade ?? -1
    }
  }
  return [...rows].sort((a, b) => {
    const x = val(a)
    const y = val(b)
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
    return (s.dir === 'asc' ? c : -c) || b.graded - a.graded || a.name.localeCompare(b.name)
  })
}

/** Name, team abbreviation or nickname. */
export function searchRows(rows: LeaderView[], q: string): LeaderView[] {
  const n = q.trim().toLowerCase()
  if (!n) return rows
  return rows.filter((v) => v.name.toLowerCase().includes(n) || v.teams.some((t) => t.toLowerCase() === n || (TEAM_BY_ABBR[t]?.nickname ?? '').toLowerCase().includes(n) || (TEAM_BY_ABBR[t]?.name ?? '').toLowerCase().includes(n)))
}

const csvCell = (v: string | number | null) => {
  if (v === null) return ''
  const s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The CSV of the rows as filtered and sorted (03 §7.6). */
export function leaderCsv(rows: LeaderView[]): string {
  const head = ['rank', 'player', 'team', 'position', 'games', 'snaps', 'graded', 'plus', 'zero', 'minus', 'critical', 'plus_rate', 'grade', 'epa_per_play']
  const lines = rows.map((v) =>
    [v.rank, v.name, v.teams.join('/'), v.position, v.games, v.snaps, v.graded, v.tally.plus, v.tally.zero, v.tally.minus, v.crit, v.plusRate, v.grade, v.epa].map(csvCell).join(',')
  )
  return [head.join(','), ...lines].join('\n') + '\n'
}

/** Fixed column widths of the table (03 §7.4); Player is flexible with a 220 minimum. */
export const COLUMN_WIDTHS: Record<string, number> = { rank: 48, team: 64, pos: 48, games: 56, snaps: 64, graded: 64, tally: 88, plusRate: 56, crit: 48, epa: 72, grade: 56, trend: 76 }
/** Trend, Crit, Snaps go first (03 §7.2); narrower still, the least important of the rest. */
const DROP_ORDER = ['trend', 'crit', 'snaps', 'games', 'pos', 'epa', 'tally', 'plusRate']

/** The columns to hide so the table never scrolls sideways in a page column `width` wide (0 = not measured yet). */
export function dropped(width: number): Set<string> {
  const out = new Set<string>()
  if (!width) return out
  let need = 220 + Object.values(COLUMN_WIDTHS).reduce((a, b) => a + b, 0)
  for (const id of DROP_ORDER) {
    if (need <= width) break
    out.add(id)
    need -= COLUMN_WIDTHS[id]
  }
  return out
}

export const csvName = (group: string, season: number) => `Leaderboard ${group} ${season}.csv`
