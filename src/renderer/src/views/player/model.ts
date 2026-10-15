import { gameLabel, playCaption, shortDesc, weekName } from '@shared/labels'
import { type FilterToken, matchRule, type PlayContext, tokensToRules } from '@shared/playQuery'
import { clipStartTime } from '@shared/snap'
import type { SplitPlay } from '@shared/splits'
import { TEAM_BY_ABBR } from '@shared/teams'
import { emptyTally, gradeScore, mergeTally, teamEpa } from '@shared/stats'
import type { ChartField, GameInfo, GradeEntry, GradeTally, PlayerGameLine, PlayerProfile, PlayNote, PositionGroup, ReelItem, Settings, TagDef, TeamSummary } from '@shared/types'
import { statColumns } from '../../format'
import type { EpaPoint, GameBar, OpponentGame, ReelEntry } from '../shared'

/**
 * Player data shaped for the screen and the PDF report (03 §6, §12): reel entries with their games, split plays,
 * grade-by-game bars, opponent strength, grade vs EPA and the season stat strip. Pure, so both share it.
 */

export type PlayerSection = 'overview' | 'film' | 'splits' | 'log' | 'career'
export const PLAYER_SECTIONS: { value: PlayerSection; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'film', label: 'Film' },
  { value: 'splits', label: 'Splits' },
  { value: 'log', label: 'Game log' },
  { value: 'career', label: 'Career' }
]

/** A game from a reel item when the profile has no line for it (shouldn't happen, but plays must still show). */
function fallbackGame(r: ReelItem, season: number): GameInfo {
  return { gameId: r.gameId, season, week: r.week, gameType: 'REG', gameday: '', homeTeam: r.team, awayTeam: r.opponent, homeScore: null, awayScore: null }
}

export function gameMap(p: PlayerProfile): Map<string, GameInfo> {
  return new Map(p.games.map((g) => [g.game.gameId, g.game]))
}

/** Reel entries in game order (oldest game first, play order within). */
export function reelEntries(p: PlayerProfile): ReelEntry[] {
  const games = gameMap(p)
  const order = new Map(p.games.map((g, i) => [g.game.gameId, i]))
  return [...p.reel]
    .sort((a, b) => (order.get(a.gameId) ?? 0) - (order.get(b.gameId) ?? 0) || a.playId - b.playId)
    .map((r) => ({
      ref: { gameId: r.gameId, playId: r.playId },
      game: games.get(r.gameId) ?? fallbackGame(r, p.season),
      team: r.team,
      play: r.play,
      clips: r.clips,
      drawing: r.drawing,
      grade: r.grade,
      critical: r.critical,
      tags: r.tags,
      note: r.note,
      playNote: r.playNote,
      flagged: r.flagged,
      teamEpa: r.teamEpa
    }))
}

/** What token rules see for one reel play: this player's entry and the play note. */
export function reelContext(e: ReelEntry, playerId: string, chartFields: ChartField[], chart: Record<string, string>): PlayContext {
  const entry: GradeEntry = {
    gameId: e.ref.gameId,
    playId: e.ref.playId,
    playerId,
    team: e.team,
    grade: e.grade ?? null,
    tags: e.tags ?? [],
    note: e.note ?? '',
    critical: !!e.critical,
    offField: false
  }
  const note: PlayNote = { gameId: e.ref.gameId, playId: e.ref.playId, note: e.playNote ?? '', chart, drawing: e.drawing ?? {}, flagged: !!e.flagged }
  return { game: e.game, team: e.team, entries: [entry], note, chartFields }
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Filters reel entries by tokens (keys AND, values OR) and free text (description, notes and tags). */
export function filterEntries(entries: ReelEntry[], tokens: FilterToken[], text: string, playerId: string, chartFields: ChartField[], charts: Map<string, Record<string, string>>): ReelEntry[] {
  const rules = tokensToRules(tokens, { player: playerId })
  const needle = fold(text.trim())
  return entries.filter((e) => {
    if (needle) {
      const hay = fold([e.play?.desc ?? '', e.note ?? '', e.playNote ?? '', ...(e.tags ?? [])].join(' \u0001 '))
      if (!hay.includes(needle)) return false
    }
    if (!rules.length) return true
    if (!e.play) return false
    const ctx = reelContext(e, playerId, chartFields, charts.get(`${e.ref.gameId}:${e.ref.playId}`) ?? {})
    return rules.every((r) => matchRule(r, e.play!, ctx))
  })
}

export type ReelSort = 'game' | 'epaBest' | 'epaWorst' | 'grade'

export function sortEntries(entries: ReelEntry[], sort: ReelSort): ReelEntry[] {
  if (sort === 'game') return entries
  const idx = new Map(entries.map((e, i) => [e, i]))
  const epa = (e: ReelEntry) => e.teamEpa ?? null
  return [...entries].sort((a, b) => {
    if (sort === 'grade') return (b.grade ?? -2) - (a.grade ?? -2) || idx.get(a)! - idx.get(b)!
    const ea = epa(a)
    const eb = epa(b)
    if (ea === null && eb === null) return idx.get(a)! - idx.get(b)!
    if (ea === null) return 1
    if (eb === null) return -1
    return (sort === 'epaBest' ? eb - ea : ea - eb) || idx.get(a)! - idx.get(b)!
  })
}

/** Seconds of the shown plays, each from its start point to its clip's end (the angle a reel would choose). */
export function reelDuration(entries: ReelEntry[], settings: Pick<Settings, 'startAtSnap' | 'preRoll'>): number {
  let total = 0
  for (const e of entries) {
    const mine = e.clips.filter((c) => c.playId === e.ref.playId)
    const clip = mine.find((c) => c.angle === 'sideline') ?? mine.find((c) => c.angle === 'main') ?? mine[0]
    if (clip?.duration) total += Math.max(0, clip.duration - clipStartTime(clip, settings))
  }
  return total
}

export function splitPlays(p: PlayerProfile): SplitPlay[] {
  return p.reel.filter((r) => r.play).map((r) => ({ play: r.play!, team: r.team, grade: r.grade, critical: r.critical, chart: r.chart ?? {} }))
}

const graded = (g: PlayerGameLine) => g.tally.graded > 0

export function gameBars(p: PlayerProfile, labelBy: 'opp' | 'week' = 'opp'): GameBar[] {
  return p.games.filter(graded).map((g) => ({
    key: g.game.gameId,
    label: labelBy === 'week' ? (g.game.gameType === 'REG' ? `Wk ${g.game.week}` : g.game.gameType) : g.opponent,
    title: `${weekName(g.game)} ${g.team === g.game.homeTeam ? 'vs' : '@'} ${g.opponent}`,
    rowLabel: gameLabel(g.game, g.team),
    tally: g.tally,
    score: gradeScore(g.tally)
  }))
}

/** Mean team EPA of the player's graded scrimmage plays, per game. */
export function epaByGame(p: PlayerProfile): Map<string, number | null> {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const r of p.reel) {
    if (r.grade === null || !r.play) continue
    const e = teamEpa(r.play, r.team)
    if (e === null) continue
    const a = acc.get(r.gameId) ?? { sum: 0, n: 0 }
    a.sum += e
    a.n++
    acc.set(r.gameId, a)
  }
  return new Map([...acc].map(([k, v]) => [k, v.n ? v.sum / v.n : null]))
}

export function meanEpa(p: PlayerProfile): number | null {
  let sum = 0
  let n = 0
  for (const r of p.reel) {
    if (r.grade === null || !r.play) continue
    const e = teamEpa(r.play, r.team)
    if (e === null) continue
    sum += e
    n++
  }
  return n ? sum / n : null
}

// ── Opponent strength (§6.4.2) ───────────────────────────────────────────────

export type Measure = 'def-epa' | 'def-pass' | 'def-run' | 'def-score' | 'def-sacks' | 'off-epa' | 'off-pass' | 'off-run' | 'off-score'

export const MEASURES: Record<Measure, { label: string; column: string; side: 'offense' | 'defense'; key: string; noun: string }> = {
  'def-epa': { label: 'Defense (EPA/play allowed)', column: 'Opp. defense', side: 'defense', key: 'epa', noun: 'defense EPA per play allowed' },
  'def-pass': { label: 'Pass defense', column: 'Opp. pass D', side: 'defense', key: 'passEpa', noun: 'pass defense' },
  'def-run': { label: 'Run defense', column: 'Opp. run D', side: 'defense', key: 'rushEpa', noun: 'run defense' },
  'def-score': { label: 'Scoring defense', column: 'Opp. scoring D', side: 'defense', key: 'ppg', noun: 'scoring defense' },
  'def-sacks': { label: 'Sacks', column: 'Opp. sacks', side: 'defense', key: 'sacks', noun: 'sacks per game' },
  'off-epa': { label: 'Offense (EPA/play)', column: 'Opp. offense', side: 'offense', key: 'epa', noun: 'offense EPA per play' },
  'off-pass': { label: 'Pass offense', column: 'Opp. pass O', side: 'offense', key: 'passEpa', noun: 'pass offense' },
  'off-run': { label: 'Run offense', column: 'Opp. run O', side: 'offense', key: 'rushEpa', noun: 'run offense' },
  'off-score': { label: 'Scoring offense', column: 'Opp. scoring O', side: 'offense', key: 'ppg', noun: 'scoring offense' }
}

export const MEASURE_CHOICES: Record<PositionGroup, Measure[]> = {
  QB: ['def-pass', 'def-epa', 'def-run', 'def-score'],
  WR: ['def-pass', 'def-epa', 'def-run', 'def-score'],
  TE: ['def-pass', 'def-epa', 'def-run', 'def-score'],
  RB: ['def-run', 'def-epa', 'def-pass', 'def-score'],
  OL: ['def-epa', 'def-pass', 'def-run', 'def-sacks'],
  DL: ['off-epa', 'off-pass', 'off-run', 'off-score'],
  LB: ['off-epa', 'off-pass', 'off-run', 'off-score'],
  DB: ['off-pass', 'off-epa', 'off-run', 'off-score'],
  ST: ['off-epa', 'off-score']
}

const ORD = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function opponentGames(p: PlayerProfile, summaries: TeamSummary[], measure: Measure): OpponentGame[] {
  const m = MEASURES[measure]
  const by = new Map(summaries.map((s) => [s.team, s]))
  return p.games.filter(graded).map((g) => {
    const stat = by.get(g.opponent)?.[m.side].find((x) => x.key === m.key)
    const rank = stat && by.get(g.opponent)?.games ? stat.rank : null
    const name = m.label.replace(/ \(.*\)$/, '').toLowerCase()
    return {
      key: g.game.gameId,
      rank,
      tally: g.tally,
      score: gradeScore(g.tally),
      opp: g.opponent,
      title: `${weekName(g.game)} ${g.team === g.game.homeTeam ? 'vs' : '@'} ${g.opponent}`,
      rowLabel: gameLabel(g.game, g.team),
      rankLine: rank ? `${g.opponent} ${name}: ${ORD(rank)}` : `${g.opponent} ${name}: not ranked`,
      rankShort: rank ? `${ORD(rank)} ${name}` : ''
    }
  })
}

// ── Grade vs EPA (§6.4.3) ────────────────────────────────────────────────────

export function epaPoints(entries: ReelEntry[]): EpaPoint[] {
  return entries
    .filter((e) => e.grade !== null && e.grade !== undefined && e.teamEpa !== null && e.teamEpa !== undefined && e.play)
    .map((e) => ({
      key: `${e.ref.gameId}:${e.ref.playId}`,
      grade: e.grade!,
      epa: e.teamEpa!,
      critical: !!e.critical,
      caption: playCaption(e.game, e.team, e.play),
      desc: shortDesc(e.play!.desc),
      tags: e.tags?.length ? e.tags.join(' · ') : undefined
    }))
}

export interface EpaFigures {
  lanes: { grade: 1 | 0 | -1; mean: number | null; plays: number }[]
  /** Share of + and − plays where EPA agrees, null under 5 such plays. */
  agreement: number | null
  agreementPlays: number
}

export function epaFigures(points: EpaPoint[]): EpaFigures {
  const lanes = ([1, 0, -1] as const).map((g) => {
    const list = points.filter((p) => p.grade === g)
    return { grade: g, plays: list.length, mean: list.length ? list.reduce((s, p) => s + p.epa, 0) / list.length : null }
  })
  const decided = points.filter((p) => p.grade !== 0 && p.epa !== 0)
  const agree = decided.filter((p) => (p.grade === 1 ? p.epa > 0 : p.epa < 0)).length
  return { lanes, agreement: decided.length >= 5 ? agree / decided.length : null, agreementPlays: decided.length }
}

/** Plays where grade and EPA point opposite ways: + with EPA ≤ −1, − with EPA ≥ +1; biggest |EPA| first. */
export function secondLook(entries: ReelEntry[], limit = 5): ReelEntry[] {
  return entries
    .filter((e) => e.teamEpa !== null && e.teamEpa !== undefined && ((e.grade === 1 && e.teamEpa <= -1) || (e.grade === -1 && e.teamEpa >= 1)))
    .sort((a, b) => Math.abs(b.teamEpa!) - Math.abs(a.teamEpa!))
    .slice(0, limit)
}

/** Plays with a grade note (else a play note), newest game first. */
export function notesFromFilm(entries: ReelEntry[], limit = 5): ReelEntry[] {
  return entries
    .filter((e) => (e.note ?? '').trim() || (e.playNote ?? '').trim())
    .slice()
    .reverse()
    .slice(0, limit)
}

// ── Overview stat strip (§6.2) ───────────────────────────────────────────────

export function seasonCells(p: PlayerProfile): { key: string; label: string; value: string }[] {
  const cols = statColumns(p.player.group)
  return [
    ...(p.totals.snaps ? [{ key: 'snaps', label: 'Snaps', value: String(p.totals.snaps) }] : []),
    { key: 'games', label: 'Games', value: String(p.games.filter((g) => Object.keys(g.stats).length || g.snaps).length) },
    ...cols.map((c) => ({ key: c.key, label: c.label, value: c.value(p.totals) }))
  ].slice(0, 9)
}

export function tagPolarity(tags: TagDef[], group: PositionGroup): Map<string, TagDef['kind']> {
  const out = new Map<string, TagDef['kind']>()
  for (const t of tags) if (t.group === group) out.set(t.label, t.kind)
  for (const t of tags) if (!out.has(t.label)) out.set(t.label, t.kind)
  return out
}

export function tallyOf(lines: { tally: GradeTally }[]): GradeTally {
  return lines.reduce((t, l) => mergeTally(t, l.tally), emptyTally())
}

/** "Joined from Dallas in Week 9" (with DAL to link) / "Played for DAL, NYG and PHI this season" / null. */
export function teamsLine(p: PlayerProfile): { before: string; link?: { abbr: string; text: string }; after: string } | null {
  if (p.teams.length < 2) return null
  if (p.teams.length === 2) {
    const [a, b] = p.teams
    const t = TEAM_BY_ABBR[a.team]
    const city = t ? t.name.replace(` ${t.nickname}`, '') : a.team
    return { before: 'Joined from ', link: { abbr: a.team, text: city }, after: ` in Week ${b.firstWeek}` }
  }
  const list = p.teams.map((t) => t.team)
  return { before: `Played for ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]} this season`, after: '' }
}

// ── Presentation: key art, the clip shelf and the season trend note ─────────

/** A still for one reel play: its own clip (sideline, else main, else any), a moment after the snap. */
export function entryPoster(e: Pick<ReelEntry, 'clips' | 'ref'>): { clipId: number; at: number } | null {
  const mine = e.clips.filter((c) => c.playId === e.ref.playId)
  const clip = mine.find((c) => c.angle === 'sideline') ?? mine.find((c) => c.angle === 'main') ?? mine[0]
  if (!clip) return null
  const snap = clip.snapMs !== null ? clip.snapMs / 1000 : 0
  const at = snap + 1
  return { clipId: clip.id, at: clip.duration ? Math.min(at, Math.max(0, clip.duration - 0.2)) : at }
}

const bestRank = (e: ReelEntry) => (e.grade ?? -2) * 10 + (e.critical && e.grade === 1 ? 5 : 0) + Math.max(-4, Math.min(4, e.teamEpa ?? 0))

/** His best-graded plays with film, best first (+ before 0 before −; critical and EPA break ties). */
export function bestClips(entries: ReelEntry[], limit = 12): ReelEntry[] {
  return entries
    .filter((e) => e.grade !== null && e.grade !== undefined && entryPoster(e))
    .map((e, i) => ({ e, i, r: bestRank(e) }))
    .sort((a, b) => b.r - a.r || b.i - a.i)
    .slice(0, limit)
    .map((x) => x.e)
}

/** The key-art still: the best-graded play with film (a plus play only), or null for a quiet surface. */
export function heroPoster(entries: ReelEntry[]): { clipId: number; at: number } | null {
  const best = bestClips(entries, 1)[0]
  return best && best.grade === 1 ? entryPoster(best) : null
}

/** "Up 6 over his last three games" / "Down 4 …" / "Steady …"; null under four graded games. */
export function trendNote(p: PlayerProfile): string | null {
  const scores = p.games.filter(graded).map((g) => gradeScore(g.tally)).filter((s): s is number => s !== null)
  if (scores.length < 4) return null
  const recent = scores.slice(-3)
  const before = scores.slice(0, -3)
  const mean = (l: number[]) => l.reduce((s, v) => s + v, 0) / l.length
  const d = Math.round(mean(recent) - mean(before))
  if (Math.abs(d) < 2) return 'Steady over the last three games'
  return `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)} over the last three games`
}

const POSITION_NAMES: Record<string, string> = {
  QB: 'Quarterback', RB: 'Running back', HB: 'Running back', FB: 'Fullback', WR: 'Wide receiver', TE: 'Tight end',
  LT: 'Left tackle', LG: 'Left guard', C: 'Center', RG: 'Right guard', RT: 'Right tackle', T: 'Tackle', OT: 'Offensive tackle',
  G: 'Guard', OG: 'Guard', OL: 'Offensive line', DE: 'Defensive end', DT: 'Defensive tackle', NT: 'Nose tackle', DL: 'Defensive line',
  EDGE: 'Edge', LB: 'Linebacker', ILB: 'Inside linebacker', MLB: 'Middle linebacker', OLB: 'Outside linebacker', LILB: 'Inside linebacker',
  RILB: 'Inside linebacker', LOLB: 'Outside linebacker', ROLB: 'Outside linebacker', WILL: 'Linebacker', MIKE: 'Linebacker', SAM: 'Linebacker',
  CB: 'Cornerback', LCB: 'Cornerback', RCB: 'Cornerback', NB: 'Nickel back', DB: 'Defensive back', S: 'Safety', FS: 'Free safety',
  SS: 'Strong safety', K: 'Kicker', PK: 'Kicker', P: 'Punter', LS: 'Long snapper', KR: 'Returner', PR: 'Returner'
}

/** "LT" → "Left tackle"; unknown codes stay as they are. */
export function positionName(code: string): string {
  return POSITION_NAMES[code.toUpperCase()] ?? code
}
