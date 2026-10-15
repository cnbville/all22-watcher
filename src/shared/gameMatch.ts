import { TEAMS } from './teams'
import type { GameInfo } from './types'

/** Older and alternate codes and names people use in folder names, mapped to today's abbreviations. */
const ALIASES: Record<string, string> = {
  OAK: 'LV', SD: 'LAC', STL: 'LA', LAR: 'LA', JAC: 'JAX', WSH: 'WAS', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB',
  RAIDERS: 'LV', CHARGERS: 'LAC', RAMS: 'LA', COMMANDERS: 'WAS', WASHINGTON: 'WAS', REDSKINS: 'WAS', 'FOOTBALL TEAM': 'WAS'
}

const CITY_BY_ABBR: Record<string, string[]> = Object.fromEntries(
  TEAMS.map((t) => {
    const city = t.name.slice(0, t.name.length - t.nickname.length).trim()
    // "New York" and "Los Angeles" name two teams each, so they don't identify one.
    return [t.abbr, ['New York', 'Los Angeles'].includes(city) ? [] : [city]]
  })
)

/** Normalizes for matching: uppercase letters, digits and single spaces. */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9@]+/g, ' ')
    .trim()

interface Token {
  team: string
  index: number
}

/** Teams named in a folder name, in the order they appear (abbreviation, nickname, unique city or alias). */
export function teamsInName(name: string): Token[] {
  const text = ` ${norm(name).replace(/@/g, ' @ ')} `
  const found: Token[] = []
  const add = (label: string, team: string) => {
    const re = new RegExp(`(?<=\\s)${norm(label).replace(/ /g, '\\s')}(?=\\s)`, 'g')
    for (const m of text.matchAll(re)) found.push({ team, index: m.index! })
  }
  for (const t of TEAMS) {
    add(t.abbr, t.abbr)
    add(t.nickname, t.abbr)
    add(t.name, t.abbr)
    for (const c of CITY_BY_ABBR[t.abbr]) add(c, t.abbr)
  }
  for (const [alias, team] of Object.entries(ALIASES)) add(alias, team)
  found.sort((a, b) => a.index - b.index)
  // One team named twice in a row ("Eagles PHI") counts once.
  return found.filter((t, i) => i === 0 || t.team !== found[i - 1].team || t.index - found[i - 1].index > 40)
}

export interface ParsedGameName {
  teams: string[]
  /** 'away-home' for "DAL at PHI" / "DAL @ PHI"; 'home-away' for "PHI vs DAL"; null when the separator is unclear. */
  order: 'away-home' | 'home-away' | null
  season: number | null
  week: number | null
}

const WEEK_WORDS: Record<string, number> = { 'WILD CARD': 19, WILDCARD: 19, WC: 19, DIVISIONAL: 20, DIV: 20, CONFERENCE: 21, CONF: 21, CHAMPIONSHIP: 21, 'SUPER BOWL': 22, SB: 22 }

/** Reads the teams, their order, the season and the week from a game folder name. */
export function parseGameName(name: string): ParsedGameName {
  const text = norm(name)
  const teams = teamsInName(name)
  const unique = [...new Set(teams.map((t) => t.team))]
  let order: ParsedGameName['order'] = null
  if (unique.length >= 2) {
    const first = teams.find((t) => t.team === unique[0])!
    const second = teams.find((t) => t.team === unique[1])!
    const between = ` ${norm(name).replace(/@/g, ' @ ')} `.slice(first.index, second.index)
    if (/\s(@|AT)\s/.test(between)) order = 'away-home'
    else if (/\s(VS|V|VERSUS)\s/.test(between)) order = 'home-away'
  }
  const season = /(?:^|\s)(20[0-4]\d|19[89]\d)(?=\s|$)/.exec(text)
  let week: number | null = null
  const w = /(?:^|\s)(?:WEEK|WK|W)\s?(\d{1,2})(?=\s|$)/.exec(text)
  if (w) week = Number(w[1])
  else {
    for (const [word, n] of Object.entries(WEEK_WORDS)) {
      if (new RegExp(`(?:^|\\s)${word}(?=\\s|$)`).test(text)) {
        week = n
        break
      }
    }
  }
  return { teams: unique.slice(0, 2), order, season: season ? Number(season[1]) : null, week }
}

export interface GameMatchResult {
  game: GameInfo | null
  /** Why nothing matched, or why the match is a guess. */
  reason: string | null
  candidates: GameInfo[]
}

/**
 * Finds the game a folder name refers to among the schedules of downloaded seasons: both teams (either order unless
 * "at"/"@" or "vs" says which is home), then the season and week when the name gives them. Among several, a game
 * that has no film yet wins, newest first; games not played yet are only taken when nothing else fits.
 */
export function matchGameName(
  name: string,
  games: GameInfo[],
  opts: { hasFilm?: (gameId: string) => boolean; today?: string } = {}
): GameMatchResult {
  const parsed = parseGameName(name)
  if (parsed.teams.length < 2) {
    return { game: null, reason: parsed.teams.length ? `Only one team (${parsed.teams[0]}) is named in the folder name.` : 'No teams are named in the folder name.', candidates: [] }
  }
  const [a, b] = parsed.teams
  let list = games.filter((g) => (g.homeTeam === a && g.awayTeam === b) || (g.homeTeam === b && g.awayTeam === a))
  if (parsed.order) {
    const [away, home] = parsed.order === 'away-home' ? [a, b] : [b, a]
    const oriented = list.filter((g) => g.homeTeam === home && g.awayTeam === away)
    // People write "vs" loosely, so the order only narrows when it leaves something.
    if (oriented.length) list = oriented
  }
  if (parsed.season !== null) list = list.filter((g) => g.season === parsed.season)
  if (parsed.week !== null) list = list.filter((g) => g.week === parsed.week)
  if (!list.length) {
    const what = `${a} and ${b}${parsed.season ? ` in ${parsed.season}` : ''}${parsed.week ? `, week ${parsed.week}` : ''}`
    return { game: null, reason: `No downloaded schedule has a game between ${what}.`, candidates: [] }
  }
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  const played = (g: GameInfo) => g.homeScore !== null || (!!g.gameday && g.gameday <= today)
  const newestFirst = [...list].sort((x, y) => y.gameday.localeCompare(x.gameday) || y.season - x.season || y.week - x.week)
  const hasFilm = opts.hasFilm ?? (() => false)
  const pick =
    newestFirst.find((g) => played(g) && !hasFilm(g.gameId)) ??
    newestFirst.find((g) => played(g)) ??
    newestFirst[0]
  return { game: pick, reason: null, candidates: newestFirst }
}
