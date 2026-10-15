import type { GameInfo, Play } from './types'

/**
 * Labels for games, plays and nflverse lineup values, shared by splits (main and renderer) and the screens' formatters
 * (03 §2.3 `personnelLabel`, `defPersonnelLabel`, `enumLabel`; the renderer's format.ts can re-export these).
 */

const GROUPS: Record<string, 'RB' | 'TE' | 'WR' | 'OL' | 'QB' | 'DL' | 'LB' | 'DB'> = {
  RB: 'RB', HB: 'RB', FB: 'RB',
  TE: 'TE',
  WR: 'WR',
  OL: 'OL', C: 'OL', G: 'OL', T: 'OL', OT: 'OL', OG: 'OL',
  QB: 'QB',
  DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
  DB: 'DB', CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB'
}

/** "1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR" → { OL: 5, QB: 1, RB: 1, TE: 1, WR: 3 }; null when unreadable. */
export function personnelCounts(raw: string | null): Record<string, number> | null {
  if (!raw) return null
  const out: Record<string, number> = {}
  for (const part of raw.split(',')) {
    const m = /^\s*(\d+)\s+([A-Za-z]+)\s*$/.exec(part)
    if (!m) return null
    const g = GROUPS[m[2].toUpperCase()]
    if (!g) continue
    out[g] = (out[g] ?? 0) + Number(m[1])
  }
  return Object.keys(out).length ? out : null
}

/** "1 RB, 1 TE, 3 WR" → "11 personnel"; six offensive linemen → "12 personnel (6 OL)"; unreadable → raw. */
export function personnelLabel(raw: string | null): string {
  if (!raw) return ''
  const c = personnelCounts(raw)
  if (!c || (c.RB === undefined && c.TE === undefined && c.WR === undefined)) return raw
  const base = `${c.RB ?? 0}${c.TE ?? 0} personnel`
  return (c.OL ?? 0) >= 6 ? `${base} (${c.OL} OL)` : base
}

/** Defensive grouping by DB count: Base (4), Nickel (5), Dime (6), Quarter (7+), Heavy (3 or fewer). */
export function defPersonnelLabel(raw: string | null): string {
  if (!raw) return ''
  const c = personnelCounts(raw)
  if (!c || c.DB === undefined) return raw
  const db = c.DB
  return db >= 7 ? 'Quarter' : db === 6 ? 'Dime' : db === 5 ? 'Nickel' : db === 4 ? 'Base' : 'Heavy'
}

/** "4–2–5" (DL–LB–DB), for tooltips. */
export function defPersonnelShape(raw: string | null): string | null {
  const c = personnelCounts(raw)
  if (!c || c.DB === undefined) return null
  return `${c.DL ?? 0}–${c.LB ?? 0}–${c.DB}`
}

/** "Week 1", "Wild Card", "Divisional", "Conference", "Super Bowl". */
export function weekName(game: Pick<GameInfo, 'week' | 'gameType'>): string {
  switch (game.gameType) {
    case 'WC':
      return 'Wild Card'
    case 'DIV':
      return 'Divisional'
    case 'CON':
      return 'Conference'
    case 'SB':
      return 'Super Bowl'
    default:
      return `Week ${game.week}`
  }
}

/** "Wk 1", or the postseason round. */
export function weekShort(game: Pick<GameInfo, 'week' | 'gameType'>): string {
  return game.gameType === 'REG' || !game.gameType ? `Wk ${game.week}` : weekName(game)
}

/** "Wk 1 vs DAL", "Wk 2 @ KC" from `team`'s side. */
export function gameLabel(game: GameInfo, team: string): string {
  const home = game.homeTeam === team
  return `${weekShort(game)} ${home ? 'vs' : '@'} ${home ? game.awayTeam : game.homeTeam}`
}

/** "DAL @ PHI" */
export function gameTitle(game: Pick<GameInfo, 'homeTeam' | 'awayTeam'>): string {
  return `${game.awayTeam} @ ${game.homeTeam}`
}

const ORD = ['', '1st', '2nd', '3rd', '4th']

/** "3rd & 7", "1st & Goal"; '' without a down. */
export function downDistance(play: Pick<Play, 'down' | 'ydstogo' | 'yardline100'>): string {
  if (play.down === null || !ORD[play.down]) return ''
  const goal = play.yardline100 !== null && play.ydstogo !== null && play.yardline100 <= play.ydstogo
  return `${ORD[play.down]} & ${goal ? 'Goal' : (play.ydstogo ?? '')}`
}

/** "Wk 1 vs DAL · Q1 06:41 · 3rd & 7" */
export function playCaption(game: GameInfo, team: string, play: Play | null): string {
  if (!play) return gameLabel(game, team)
  const q = play.qtr >= 5 ? 'OT' : `Q${play.qtr}`
  return [gameLabel(game, team), `${q} ${play.time}`.trim(), downDistance(play)].filter(Boolean).join(' · ')
}

/** The play description without the leading clock and formation note: "(6:41) (Shotgun) D.Prescott pass…" → "D.Prescott pass…". */
export function shortDesc(desc: string): string {
  return desc.replace(/^\s*\(\d{1,2}:\d{2}\)\s*/, '').replace(/^\((Shotgun|No Huddle|No Huddle, Shotgun|Run formation|Punt formation|Field Goal formation)\)\s*/i, '').trim()
}

/** "0:09", "3:12", "1:02:05". */
export function durationLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const ENUMS: Record<string, string> = { MAN_COVERAGE: 'Man', ZONE_COVERAGE: 'Zone', '2_MAN': '2-Man' }

/** "SHOTGUN" → "Shotgun", "COVER_3" → "Cover 3", "2_MAN" → "2-Man", "UNDER CENTER" → "Under center". */
export function enumLabel(raw: string | null): string {
  if (!raw) return ''
  if (ENUMS[raw]) return ENUMS[raw]
  const s = raw.replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
