import type { GameInfo, Grade, GradeTally, Play, TeamRankedStat, TeamSummary } from './types'

interface Acc {
  games: number
  points: number
  plays: number
  epa: number
  success: number
  yards: number
  passPlays: number
  passEpa: number
  rushPlays: number
  rushEpa: number
  turnovers: number
  sacks: number
}

const emptyAcc = (): Acc => ({
  games: 0, points: 0, plays: 0, epa: 0, success: 0, yards: 0,
  passPlays: 0, passEpa: 0, rushPlays: 0, rushEpa: 0, turnovers: 0, sacks: 0
})

const div = (a: number, b: number) => (b > 0 ? a / b : 0)

type StatDef = {
  neutral?: boolean
  key: string
  label: string
  format: TeamRankedStat['format']
  higherIsBetter: boolean
  value: (a: Acc) => number
}

const OFFENSE: StatDef[] = [
  { key: 'ppg', label: 'Points / game', format: 'dec1', higherIsBetter: true, value: (a) => div(a.points, a.games) },
  { key: 'epa', label: 'EPA / play', format: 'dec2', higherIsBetter: true, value: (a) => div(a.epa, a.plays) },
  { key: 'success', label: 'Success rate', format: 'pct', higherIsBetter: true, value: (a) => div(a.success, a.plays) },
  { key: 'ypp', label: 'Yards / play', format: 'dec1', higherIsBetter: true, value: (a) => div(a.yards, a.plays) },
  { key: 'passEpa', label: 'Pass EPA / play', format: 'dec2', higherIsBetter: true, value: (a) => div(a.passEpa, a.passPlays) },
  { key: 'rushEpa', label: 'Rush EPA / play', format: 'dec2', higherIsBetter: true, value: (a) => div(a.rushEpa, a.rushPlays) },
  { key: 'passRate', label: 'Pass rate', format: 'pct', higherIsBetter: true, neutral: true, value: (a) => div(a.passPlays, a.plays) },
  { key: 'to', label: 'Turnovers / game', format: 'dec1', higherIsBetter: false, value: (a) => div(a.turnovers, a.games) },
  { key: 'sacks', label: 'Sacks taken / game', format: 'dec1', higherIsBetter: false, value: (a) => div(a.sacks, a.games) }
]

const DEFENSE: StatDef[] = [
  { key: 'ppg', label: 'Points allowed / game', format: 'dec1', higherIsBetter: false, value: (a) => div(a.points, a.games) },
  { key: 'epa', label: 'EPA / play allowed', format: 'dec2', higherIsBetter: false, value: (a) => div(a.epa, a.plays) },
  { key: 'success', label: 'Success rate allowed', format: 'pct', higherIsBetter: false, value: (a) => div(a.success, a.plays) },
  { key: 'ypp', label: 'Yards / play allowed', format: 'dec1', higherIsBetter: false, value: (a) => div(a.yards, a.plays) },
  { key: 'passEpa', label: 'Pass EPA allowed', format: 'dec2', higherIsBetter: false, value: (a) => div(a.passEpa, a.passPlays) },
  { key: 'rushEpa', label: 'Rush EPA allowed', format: 'dec2', higherIsBetter: false, value: (a) => div(a.rushEpa, a.rushPlays) },
  { key: 'to', label: 'Takeaways / game', format: 'dec1', higherIsBetter: true, value: (a) => div(a.turnovers, a.games) },
  { key: 'sacks', label: 'Sacks / game', format: 'dec1', higherIsBetter: true, value: (a) => div(a.sacks, a.games) }
]

/** Regular-season record plus offense/defense efficiency for every team, each stat ranked 1–N across the league. */
export function summarizeTeams(games: GameInfo[], plays: Iterable<Play>): TeamSummary[] {
  const off = new Map<string, Acc>()
  const def = new Map<string, Acc>()
  const record = new Map<string, { w: number; l: number; t: number }>()
  const acc = (m: Map<string, Acc>, team: string) => {
    let a = m.get(team)
    if (!a) m.set(team, (a = emptyAcc()))
    return a
  }
  const rec = (team: string) => {
    let r = record.get(team)
    if (!r) record.set(team, (r = { w: 0, l: 0, t: 0 }))
    return r
  }

  const playoffGames = new Set(games.filter((g) => g.gameType !== 'REG').map((g) => g.gameId))
  for (const g of games) {
    if (g.gameType !== 'REG' || g.homeScore === null || g.awayScore === null) continue
    for (const [team, pf, pa] of [
      [g.homeTeam, g.homeScore, g.awayScore],
      [g.awayTeam, g.awayScore, g.homeScore]
    ] as const) {
      const o = acc(off, team)
      const d = acc(def, team)
      o.games++
      d.games++
      o.points += pf
      d.points += pa
      const r = rec(team)
      if (pf > pa) r.w++
      else if (pf < pa) r.l++
      else r.t++
    }
  }

  for (const p of plays) {
    if (!p.posteam || !p.defteam || playoffGames.has(p.gameId)) continue
    const o = acc(off, p.posteam)
    const d = acc(def, p.defteam)
    // Usually the offense, but a muffed punt or a fumbled interception return is lost by the other side.
    for (const giver of p.giveaways) {
      acc(off, giver).turnovers++
      acc(def, giver === p.posteam ? p.defteam : p.posteam).turnovers++
    }
    if (p.sack) {
      o.sacks++
      d.sacks++
    }
    if (!(p.isPass || p.isRush) || p.epa === null || p.playType === 'no_play') continue
    for (const a of [o, d]) {
      a.plays++
      a.epa += p.epa
      a.success += p.success ? 1 : 0
      a.yards += p.yardsGained ?? 0
      if (p.isPass) {
        a.passPlays++
        a.passEpa += p.epa
      } else {
        a.rushPlays++
        a.rushEpa += p.epa
      }
    }
  }

  const teams = [...new Set([...off.keys(), ...def.keys()])].filter((t) => (off.get(t)?.games ?? 0) > 0)
  const ranked = (defs: StatDef[], m: Map<string, Acc>) => {
    const out = new Map<string, TeamRankedStat[]>()
    for (const t of teams) out.set(t, [])
    for (const s of defs) {
      const values = teams.map((t) => ({ t, v: s.value(m.get(t) ?? emptyAcc()) }))
      const sorted = [...values].sort((a, b) => (s.higherIsBetter ? b.v - a.v : a.v - b.v))
      for (const { t, v } of values) {
        const rank = sorted.findIndex((x) => x.v === v) + 1
        out.get(t)!.push({ key: s.key, label: s.label, value: v, rank, format: s.format, ...(s.neutral ? { neutral: true } : {}) })
      }
    }
    return out
  }
  const offRanks = ranked(OFFENSE, off)
  const defRanks = ranked(DEFENSE, def)

  return teams.map((team) => {
    const r = record.get(team) ?? { w: 0, l: 0, t: 0 }
    const o = off.get(team)!
    const d = def.get(team) ?? emptyAcc()
    return {
      team,
      wins: r.w,
      losses: r.l,
      ties: r.t,
      pointsFor: o.points,
      pointsAgainst: d.points,
      games: o.games,
      offense: offRanks.get(team)!,
      defense: defRanks.get(team)!
    }
  })
}

export function emptyTally(): GradeTally {
  return { graded: 0, plus: 0, zero: 0, minus: 0, critical: 0, critPlus: 0, critMinus: 0 }
}

/** Counts one entry. A null grade changes nothing (critical only counts once the entry has a grade). */
export function addToTally(t: GradeTally, grade: Grade | null, critical = false): GradeTally {
  if (grade === null) return t
  t.graded++
  if (grade === 1) t.plus++
  else if (grade === -1) t.minus++
  else t.zero++
  if (critical) {
    t.critical++
    if (grade === 1) t.critPlus++
    else if (grade === -1) t.critMinus++
  }
  return t
}

/** Adds every count of `b` into `a`. */
export function mergeTally(a: GradeTally, b: GradeTally): GradeTally {
  a.graded += b.graded
  a.plus += b.plus
  a.zero += b.zero
  a.minus += b.minus
  a.critical += b.critical
  a.critPlus += b.critPlus
  a.critMinus += b.critMinus
  return a
}

/** A tally of entries (grade + critical flag). */
export function tallyOf(entries: Iterable<{ grade: Grade | null; critical?: boolean }>): GradeTally {
  const t = emptyTally()
  for (const e of entries) addToTally(t, e.grade, !!e.critical)
  return t
}

/** Graded entries marked critical. */
export function critCount(entries: Iterable<{ grade: Grade | null; critical?: boolean }>): number {
  let n = 0
  for (const e of entries) if (e.grade !== null && e.critical) n++
  return n
}

/** Net plays (plus minus minus), raw counts. */
export function netScore(t: GradeTally): number {
  return t.plus - t.minus
}

/** Share of graded plays that were positive, 0–1, raw counts. */
export function plusRate(t: GradeTally): number {
  return t.graded ? t.plus / t.graded : 0
}

/**
 * A 0–100 grade: 50 is a neutral player, every + pushes toward 100 and every − toward 0, 0 grades pull toward 50.
 * A critical grade counts double: score = round(50 + 50 × Σ(w·g) / Σw) with w = 2 for critical entries.
 */
export function gradeScore(t: GradeTally): number | null {
  if (!t.graded) return null
  const num = t.plus - t.minus + t.critPlus - t.critMinus
  const den = t.graded + t.critical
  return Math.round(50 + (50 * num) / den)
}

/**
 * EPA from `team`'s side: nflverse EPA is the offense's, so it is negated for the defense. Special teams plays,
 * no-plays and plays without EPA have none.
 */
export function teamEpa(play: Play, team: string): number | null {
  if (play.special || play.playType === 'no_play' || play.epa === null) return null
  if (play.posteam === team) return play.epa
  if (play.defteam === team) return play.epa === 0 ? 0 : -play.epa
  return null
}

/** Offensive success from `team`'s side (negated for the defense); null when unknown or special teams. */
export function teamSuccess(play: Play, team: string): boolean | null {
  if (play.special || play.playType === 'no_play' || play.success === null) return null
  if (play.posteam === team) return play.success
  if (play.defteam === team) return !play.success
  return null
}

/** Mean team EPA over the plays that have one; null when none does. */
export function meanTeamEpa(plays: Play[], team: string): number | null {
  let sum = 0
  let n = 0
  for (const p of plays) {
    const v = teamEpa(p, team)
    if (v === null) continue
    sum += v
    n++
  }
  return n ? sum / n : null
}

export function formatStat(value: number, format: TeamRankedStat['format']): string {
  switch (format) {
    case 'int':
      return Math.round(value).toString()
    case 'dec1':
      return value.toFixed(1)
    case 'dec2':
      return (value >= 0 ? '+' : '') + value.toFixed(2)
    case 'pct':
      return `${(value * 100).toFixed(1)}%`
  }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
