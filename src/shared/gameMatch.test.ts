import { describe, expect, it } from 'vitest'
import { makeGame } from './fixtures'
import { matchGameName, parseGameName, teamsInName } from './gameMatch'

const g = (gameId: string, gameday: string, homeScore: number | null = 20) => {
  const [season, week, away, home] = gameId.split('_')
  return makeGame({ gameId, season: Number(season), week: Number(week), awayTeam: away, homeTeam: home, gameday, homeScore, awayScore: homeScore })
}

const games = [
  g('2024_01_DAL_PHI', '2024-09-08'),
  g('2024_10_PHI_DAL', '2024-11-10'),
  g('2025_01_DAL_PHI', '2025-09-04'),
  g('2025_08_PHI_DAL', '2025-10-26'),
  g('2025_17_DAL_PHI', '2025-12-28', null)
]
const today = '2025-11-01'

describe('parseGameName', () => {
  it('reads teams, order, season and week', () => {
    expect(parseGameName('DAL at PHI')).toEqual({ teams: ['DAL', 'PHI'], order: 'away-home', season: null, week: null })
    expect(parseGameName('2025 Wk 1 DAL @ PHI')).toEqual({ teams: ['DAL', 'PHI'], order: 'away-home', season: 2025, week: 1 })
    expect(parseGameName('DAL@PHI')).toMatchObject({ teams: ['DAL', 'PHI'], order: 'away-home' })
    expect(parseGameName('PHI vs DAL week 3')).toEqual({ teams: ['PHI', 'DAL'], order: 'home-away', season: null, week: 3 })
    expect(parseGameName('Cowboys-Eagles_W8')).toMatchObject({ teams: ['DAL', 'PHI'], order: null, week: 8 })
    expect(parseGameName('2024 Wild Card Packers at Eagles')).toMatchObject({ teams: ['GB', 'PHI'], season: 2024, week: 19 })
  })
  it('knows nicknames, full names, unique cities and old codes', () => {
    expect(teamsInName('Philadelphia Eagles vs Dallas').map((t) => t.team)).toEqual(['PHI', 'DAL'])
    expect(teamsInName('OAK at JAC').map((t) => t.team)).toEqual(['LV', 'JAX'])
    expect(teamsInName('Commanders @ Giants').map((t) => t.team)).toEqual(['WAS', 'NYG'])
    // "New York" names two teams, so it identifies neither.
    expect(teamsInName('New York at Dallas').map((t) => t.team)).toEqual(['DAL'])
  })
})

describe('matchGameName', () => {
  it('takes the newest played game between the teams, honoring at/@', () => {
    const r = matchGameName('DAL at PHI', games, { today })
    expect(r.game?.gameId).toBe('2025_01_DAL_PHI')
    expect(matchGameName('PHI @ DAL', games, { today }).game?.gameId).toBe('2025_08_PHI_DAL')
    // "vs" with no other hint: home team first.
    expect(matchGameName('PHI vs DAL', games, { today }).game?.gameId).toBe('2025_01_DAL_PHI')
  })
  it('narrows by season and week', () => {
    expect(matchGameName('2024 DAL @ PHI', games, { today }).game?.gameId).toBe('2024_01_DAL_PHI')
    expect(matchGameName('Wk 10 Eagles at Cowboys', games, { today }).game?.gameId).toBe('2024_10_PHI_DAL')
  })
  it('prefers a game without film', () => {
    const r = matchGameName('Cowboys Eagles', games, { today, hasFilm: (id) => id === '2025_08_PHI_DAL' })
    expect(r.game?.gameId).toBe('2025_01_DAL_PHI')
    expect(r.candidates.length).toBe(5)
  })
  it('takes a game not played yet only when nothing else fits', () => {
    expect(matchGameName('2025 Wk 17 DAL at PHI', games, { today }).game?.gameId).toBe('2025_17_DAL_PHI')
  })
  it('explains folders it can’t match', () => {
    expect(matchGameName('Practice film', games)).toMatchObject({ game: null, reason: 'No teams are named in the folder name.' })
    expect(matchGameName('PHI install', games).reason).toMatch(/Only one team \(PHI\)/)
    expect(matchGameName('KC at BUF', games).reason).toMatch(/No downloaded schedule has a game between KC and BUF/)
    expect(matchGameName('2023 DAL at PHI', games).game).toBeNull()
  })
})
