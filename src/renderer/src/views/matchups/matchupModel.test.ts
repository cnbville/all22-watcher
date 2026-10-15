import { describe, expect, it } from 'vitest'
import type { GameInfo, GradeTally, MatchupSide, PositionGroup, RosterPlayer, TeamSummary } from '@shared/types'
import {
  better,
  centerLines,
  defaultWeek,
  gradeSide,
  type IndexGame,
  matchupSubtitle,
  orient,
  playersToWatch,
  pushRecent,
  rankSide,
  resultLine,
  unitTally,
  weekGames
} from './matchupModel'

const tally = (plus: number, zero: number, minus: number): GradeTally => ({ plus, zero, minus, graded: plus + zero + minus, critical: 0, critPlus: 0, critMinus: 0 })
const player = (id: string, group: PositionGroup): RosterPlayer => ({
  id,
  name: id,
  team: 'PHI',
  position: group,
  depthPos: group,
  group,
  jersey: '',
  status: '',
  headshot: '',
  college: '',
  height: '',
  weight: '',
  yearsExp: ''
})
const game = (week: number, gameday: string, home: string, away: string, hs: number | null = null, as: number | null = null): GameInfo => ({
  gameId: `2025_${week}_${away}_${home}`,
  season: 2025,
  week,
  gameType: 'REG',
  gameday,
  homeTeam: home,
  awayTeam: away,
  homeScore: hs,
  awayScore: as
})
const idx = (g: GameInfo): IndexGame => ({ ...g, clipCount: 0, playCount: 0, gradedPlays: 0, studiedTeam: null })

describe('versus rows', () => {
  const summary: TeamSummary = {
    team: 'PHI',
    wins: 1,
    losses: 0,
    ties: 0,
    pointsFor: 24,
    pointsAgainst: 20,
    games: 1,
    offense: [{ key: 'epa', label: 'EPA / play', value: -0.05, rank: 1, format: 'dec2' }],
    defense: []
  }
  it('uses each side’s own rank score and a minus sign', () => {
    expect(rankSide(summary, 'offense', 'epa')).toEqual({ value: '−0.05', score: 100, rank: 1, neutral: undefined })
    expect(rankSide(summary, 'defense', 'epa')).toEqual({ value: null, score: null })
    expect(rankSide({ ...summary, games: 0 }, 'offense', 'epa').value).toBeNull()
  })
  it('adds unit tallies and shows grades with graded snaps', () => {
    const t = unitTally({ WR: tally(1, 1, 0), TE: tally(1, 0, 1) }, ['WR', 'TE'])
    expect(t.graded).toBe(4)
    expect(gradeSide(t)).toEqual({ value: '63', score: 63, note: '4' })
    expect(gradeSide(tally(0, 0, 0)).value).toBeNull()
  })
  it('picks the better side', () => {
    expect(better(60, 50)).toBe('left')
    expect(better(50, 50)).toBe('equal')
    expect(better(null, 50)).toBeNull()
  })
})

describe('playersToWatch', () => {
  it('keeps 4 strengths of 60+ and 2 weak spots of 45 or less with 10+ snaps, on the right unit', () => {
    const players: MatchupSide['players'] = [
      { player: player('qb', 'QB'), tally: tally(10, 0, 0) },
      { player: player('wr1', 'WR'), tally: tally(8, 2, 0) },
      { player: player('wr2', 'WR'), tally: tally(6, 4, 0) },
      { player: player('rb', 'RB'), tally: tally(5, 5, 0) },
      { player: player('te', 'TE'), tally: tally(4, 6, 0) },
      { player: player('ol', 'OL'), tally: tally(0, 4, 6) },
      { player: player('ol2', 'OL'), tally: tally(0, 2, 8) },
      { player: player('ol3', 'OL'), tally: tally(0, 6, 4) },
      { player: player('small', 'WR'), tally: tally(5, 0, 0) },
      { player: player('db', 'DB'), tally: tally(10, 0, 0) }
    ]
    const { strengths, weak } = playersToWatch(players, 'offense')
    expect(strengths.map((p) => p.player.id)).toEqual(['qb', 'wr1', 'wr2', 'rb'])
    expect(weak.map((p) => p.player.id)).toEqual(['ol2', 'ol'])
    expect(playersToWatch(players, 'defense').strengths.map((p) => p.player.id)).toEqual(['db'])
  })
})

describe('meetings', () => {
  const played = { game: game(1, '2025-09-04', 'PHI', 'DAL', 24, 20), clipCount: 3, gradedPlays: 10, studiedTeam: 'PHI' }
  const next = { game: game(12, '2025-11-23', 'DAL', 'PHI'), clipCount: 0, gradedPlays: 0, studiedTeam: null }
  it('prefers the next meeting this season', () => {
    expect(matchupSubtitle({ season: 2025, meetings: [next, played] })).toBe('Week 12 · Sun, Nov 23')
    expect(centerLines({ season: 2025, meetings: [next, played] })).toEqual(['Week 12 · Sun, Nov 23', 'at Dallas'])
  })
  it('falls back to the latest result, then to no game', () => {
    expect(matchupSubtitle({ season: 2025, meetings: [played] })).toBe('Week 1 · PHI won 24–20')
    expect(centerLines({ season: 2025, meetings: [played] })).toEqual(['Week 1 · Final', 'PHI 24–20'])
    expect(matchupSubtitle({ season: 2025, meetings: [] })).toBe('No game in 2025')
    expect(resultLine(game(3, '2025-09-20', 'NYG', 'DAL', 20, 20))).toBe('Tied 20–20')
  })
})

describe('picker', () => {
  const games = [game(1, '2025-09-04', 'PHI', 'DAL'), game(1, '2025-09-07', 'NYG', 'WAS'), game(2, '2025-09-14', 'DAL', 'NYG')].map(idx)
  it('defaults to the week of the earliest unplayed game, else the last week', () => {
    expect(defaultWeek(games, '2025-09-10')).toBe(2)
    expect(defaultWeek(games, '2026-01-01')).toBe(2)
    expect(defaultWeek(games, '2025-01-01')).toBe(1)
    expect(defaultWeek([], '2025-01-01')).toBeNull()
  })
  it('lists My Teams games first and puts my team on the left', () => {
    expect(weekGames(games, 1, ['WAS']).map((g) => g.homeTeam)).toEqual(['NYG', 'PHI'])
    expect(orient(games[0], ['DAL'])).toEqual(['DAL', 'PHI'])
    expect(orient(games[0], [])).toEqual(['PHI', 'DAL'])
  })
  it('keeps six recent matchups without duplicates', () => {
    let list = [] as ReturnType<typeof pushRecent>
    for (const t of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) list = pushRecent(list, { left: t, right: 'Z', season: 2025 })
    list = pushRecent(list, { left: 'D', right: 'Z', season: 2025 })
    expect(list.map((r) => r.left)).toEqual(['D', 'G', 'F', 'E', 'C', 'B'])
  })
})
