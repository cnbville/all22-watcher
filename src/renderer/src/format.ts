import { TEAM_BY_ABBR } from '@shared/teams'
import type { GameInfo, Grade, Play, PositionGroup } from '@shared/types'

export function ordinalDown(down: number | null): string {
  return down ? ['1st', '2nd', '3rd', '4th'][down - 1] ?? `${down}th` : ''
}

export function downDistance(p: Play): string {
  if (!p.down) return playTypeLabel(p.playType)
  const goal = p.yardline100 !== null && p.ydstogo !== null && p.yardline100 <= p.ydstogo
  return `${ordinalDown(p.down)} & ${goal ? 'Goal' : p.ydstogo}`
}

export function quarterLabel(q: number): string {
  return q >= 5 ? 'OT' : `Q${q}`
}

const PLAY_TYPES: Record<string, string> = {
  pass: 'Pass',
  run: 'Run',
  no_play: 'No play',
  kickoff: 'Kickoff',
  punt: 'Punt',
  field_goal: 'Field goal',
  extra_point: 'Extra point',
  qb_kneel: 'Kneel',
  qb_spike: 'Spike'
}

export function playTypeLabel(t: string): string {
  return PLAY_TYPES[t] ?? t
}

export function playKind(p: Play): 'pass' | 'run' | 'special' | 'other' {
  if (p.special) return 'special'
  if (p.isPass) return 'pass'
  if (p.isRush) return 'run'
  return 'other'
}

export function resultLabel(p: Play): string {
  if (p.touchdown) return 'TD'
  if (p.turnover) return 'TO'
  if (p.sack) return 'Sack'
  if (p.penalty && p.playType === 'no_play') return 'Penalty'
  if (p.yardsGained === null) return ''
  return `${p.yardsGained > 0 ? '+' : ''}${p.yardsGained}`
}

export function shortDesc(desc: string): string {
  return desc.replace(/^\(\d+:\d+\)\s*/, '').replace(/\((Shotgun|No Huddle|No Huddle, Shotgun)\)\s*/g, '')
}

export function opponentLabel(game: GameInfo, team: string): string {
  return team === game.homeTeam ? `vs ${game.awayTeam}` : `@ ${game.homeTeam}`
}

export function gameResult(game: GameInfo, team: string): string {
  if (game.homeScore === null || game.awayScore === null) return game.gameday
  const us = team === game.homeTeam ? game.homeScore : game.awayScore
  const them = team === game.homeTeam ? game.awayScore : game.homeScore
  return `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}–${them}`
}

export function weekLabel(game: GameInfo): string {
  if (game.gameType === 'REG') return `Wk ${game.week}`
  return { WC: 'Wild Card', DIV: 'Divisional', CON: 'Conf. Champ', SB: 'Super Bowl' }[game.gameType] ?? game.gameType
}

export function teamColor(abbr: string): string {
  return TEAM_BY_ABBR[abbr]?.color ?? '#444'
}

export function gradeSymbol(g: Grade | null): string {
  return g === null ? '·' : g > 0 ? '+' : g < 0 ? '–' : '0'
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

export function prettyEnum(v: string | null): string {
  if (!v) return '—'
  return v
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bCover (\d)/, 'Cover $1')
}

export interface StatColumn {
  key: string
  label: string
  value: (s: Record<string, number>) => string
}

const n = (k: string) => (s: Record<string, number>) => String(Math.round(s[k] ?? 0))
const dec = (k: string, d = 1) => (s: Record<string, number>) => (s[k] ?? 0).toFixed(d)

/** The stat columns that matter for each position group. */
export function statColumns(group: PositionGroup): StatColumn[] {
  switch (group) {
    case 'QB':
      return [
        { key: 'cmp', label: 'Cmp/Att', value: (s) => `${s.completions ?? 0}/${s.attempts ?? 0}` },
        { key: 'passing_yards', label: 'Pass Yds', value: n('passing_yards') },
        { key: 'passing_tds', label: 'TD', value: n('passing_tds') },
        { key: 'passing_interceptions', label: 'INT', value: n('passing_interceptions') },
        { key: 'sacks_suffered', label: 'Sacked', value: n('sacks_suffered') },
        { key: 'passing_epa', label: 'Pass EPA', value: dec('passing_epa') },
        { key: 'carries', label: 'Rush', value: (s) => `${s.carries ?? 0}-${s.rushing_yards ?? 0}` }
      ]
    case 'RB':
      return [
        { key: 'carries', label: 'Car', value: n('carries') },
        { key: 'rushing_yards', label: 'Rush Yds', value: n('rushing_yards') },
        { key: 'ypc', label: 'YPC', value: (s) => (s.carries ? (s.rushing_yards ?? 0) / s.carries : 0).toFixed(1) },
        { key: 'rushing_tds', label: 'TD', value: n('rushing_tds') },
        { key: 'targets', label: 'Tgt', value: n('targets') },
        { key: 'receptions', label: 'Rec', value: n('receptions') },
        { key: 'receiving_yards', label: 'Rec Yds', value: n('receiving_yards') }
      ]
    case 'WR':
    case 'TE':
      return [
        { key: 'targets', label: 'Tgt', value: n('targets') },
        { key: 'receptions', label: 'Rec', value: n('receptions') },
        { key: 'receiving_yards', label: 'Yds', value: n('receiving_yards') },
        { key: 'receiving_tds', label: 'TD', value: n('receiving_tds') },
        { key: 'receiving_yards_after_catch', label: 'YAC', value: n('receiving_yards_after_catch') },
        { key: 'receiving_air_yards', label: 'Air Yds', value: n('receiving_air_yards') },
        { key: 'receiving_epa', label: 'EPA', value: dec('receiving_epa') }
      ]
    case 'DL':
    case 'LB':
    case 'DB':
      return [
        { key: 'tackles', label: 'Tkl', value: (s) => String((s.def_tackles_solo ?? 0) + (s.def_tackle_assists ?? 0)) },
        { key: 'def_tackles_for_loss', label: 'TFL', value: n('def_tackles_for_loss') },
        { key: 'def_sacks', label: 'Sacks', value: dec('def_sacks') },
        { key: 'def_qb_hits', label: 'QB Hits', value: n('def_qb_hits') },
        { key: 'def_interceptions', label: 'INT', value: n('def_interceptions') },
        { key: 'def_pass_defended', label: 'PD', value: n('def_pass_defended') },
        { key: 'def_fumbles_forced', label: 'FF', value: n('def_fumbles_forced') }
      ]
    case 'ST':
      return [
        { key: 'fg', label: 'FG', value: (s) => `${s.fg_made ?? 0}/${s.fg_att ?? 0}` },
        { key: 'fg_long', label: 'Long', value: n('fg_long') },
        { key: 'pat', label: 'XP', value: (s) => `${s.pat_made ?? 0}/${s.pat_att ?? 0}` },
        { key: 'pt_att', label: 'Punts', value: n('pt_att') },
        { key: 'pt_avg', label: 'Avg', value: (s) => (s.pt_att ? (s.pt_yards ?? 0) / s.pt_att : 0).toFixed(1) },
        { key: 'pt_inside_20', label: 'In 20', value: n('pt_inside_20') }
      ]
    case 'OL':
      return [
        { key: 'penalties', label: 'Penalties', value: n('penalties') },
        { key: 'penalty_yards', label: 'Pen Yds', value: n('penalty_yards') }
      ]
  }
}

/** "Michael Carter II" → "Carter". */
export function lastName(name: string): string {
  const parts = name.split(/\s+/).filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w))
  return parts[parts.length - 1] ?? name
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}
