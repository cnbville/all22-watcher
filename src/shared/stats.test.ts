import { describe, expect, it } from 'vitest'
import {
  addToTally,
  critCount,
  emptyTally,
  gradeScore,
  meanTeamEpa,
  netScore,
  plusRate,
  summarizeTeams,
  tallyOf,
  teamEpa,
  teamSuccess
} from './stats'
import type { GameInfo, Play } from './types'

const game = (home: string, away: string, hs: number, as: number): GameInfo => ({
  gameId: `2025_01_${away}_${home}`, season: 2025, week: 1, gameType: 'REG', gameday: '', homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as
})

const p = (posteam: string, defteam: string, epa: number, isPass: boolean, extra: Partial<Play> = {}): Play =>
  ({ posteam, defteam, epa, isPass, isRush: !isPass, success: epa > 0, yardsGained: 5, playType: isPass ? 'pass' : 'run', turnover: false, giveaways: [], sack: false, ...extra }) as Play

describe('summarizeTeams', () => {
  it('computes records and ranks offense and defense', () => {
    const games = [game('PHI', 'DAL', 24, 20), game('NYG', 'WAS', 10, 10)]
    const plays = [
      p('PHI', 'DAL', 0.5, true), p('PHI', 'DAL', 0.1, false), p('DAL', 'PHI', -0.4, true, { turnover: true, giveaways: ['DAL'] }),
      p('NYG', 'WAS', 0, false), p('WAS', 'NYG', 0.2, true)
    ]
    const out = summarizeTeams(games, plays)
    const phi = out.find((t) => t.team === 'PHI')!
    const dal = out.find((t) => t.team === 'DAL')!
    expect([phi.wins, phi.losses, dal.losses]).toEqual([1, 0, 1])
    expect(out.find((t) => t.team === 'NYG')!.ties).toBe(1)
    expect(phi.offense.find((s) => s.key === 'epa')).toMatchObject({ value: 0.3, rank: 1 })
    expect(phi.defense.find((s) => s.key === 'epa')).toMatchObject({ value: -0.4, rank: 1 })
    expect(phi.defense.find((s) => s.key === 'to')).toMatchObject({ value: 1, rank: 1 })
  })

  it('charges a turnover to the team that lost the ball, like the returner on a muffed punt', () => {
    const games = [game('DEN', 'TEN', 20, 12), game('LAC', 'PHI', 17, 20)]
    const plays = [
      p('TEN', 'DEN', 0, false, { playType: 'punt', isRush: false, turnover: true, giveaways: ['DEN'] }),
      // Intercepted, fumbled back on the return, then fumbled away again.
      p('PHI', 'LAC', -3, true, { turnover: true, giveaways: ['PHI', 'LAC', 'PHI'] })
    ]
    const out = summarizeTeams(games, plays)
    const to = (team: string, side: 'offense' | 'defense') => out.find((t) => t.team === team)![side].find((s) => s.key === 'to')!.value
    expect([to('DEN', 'offense'), to('DEN', 'defense'), to('TEN', 'offense'), to('TEN', 'defense')]).toEqual([1, 0, 0, 1])
    expect([to('PHI', 'offense'), to('PHI', 'defense'), to('LAC', 'offense'), to('LAC', 'defense')]).toEqual([2, 1, 1, 2])
  })

  it('leaves playoff games out of the record, points and ranks', () => {
    const playoff = { ...game('PHI', 'DAL', 30, 0), gameId: '2025_19_DAL_PHI', week: 19, gameType: 'WC' }
    const games = [game('PHI', 'DAL', 24, 20), playoff]
    const plays = [
      p('PHI', 'DAL', 0.5, true, { gameId: games[0].gameId }),
      p('PHI', 'DAL', -1, true, { gameId: playoff.gameId, sack: true, turnover: true, giveaways: ['PHI'] })
    ]
    const phi = summarizeTeams(games, plays).find((t) => t.team === 'PHI')!
    expect([phi.wins, phi.losses, phi.games, phi.pointsFor, phi.pointsAgainst]).toEqual([1, 0, 1, 24, 20])
    expect(phi.offense.find((s) => s.key === 'epa')!.value).toBe(0.5)
    expect(phi.offense.find((s) => s.key === 'to')!.value).toBe(0)
    expect(phi.offense.find((s) => s.key === 'sacks')!.value).toBe(0)
  })
})

describe('grade tallies', () => {
  it('scores 50 for neutral and moves with plus/minus', () => {
    const t = emptyTally()
    expect(gradeScore(t)).toBeNull()
    addToTally(t, 1)
    addToTally(t, 1)
    addToTally(t, 0)
    addToTally(t, -1)
    expect(t).toEqual({ graded: 4, plus: 2, zero: 1, minus: 1, critical: 0, critPlus: 0, critMinus: 0 })
    expect(gradeScore(t)).toBe(63)
  })

  type G = [1 | 0 | -1 | null, boolean]
  const score = (grades: G[]) => gradeScore(tallyOf(grades.map(([grade, critical]) => ({ grade, critical }))))
  // 02 §12.4 reference values.
  it.each([
    ['+, +, 0, −', [[1, false], [1, false], [0, false], [-1, false]], 63],
    ['+c, +, 0, −', [[1, true], [1, false], [0, false], [-1, false]], 70],
    ['+, +, +, −c', [[1, false], [1, false], [1, false], [-1, true]], 60],
    ['+c', [[1, true]], 100],
    ['0c, +', [[0, true], [1, false]], 67],
    ['−c, 0, 0', [[-1, true], [0, false], [0, false]], 25],
    ['critical set, grade null', [[null, true]], null]
  ] as [string, G[], number | null][])('weights critical grades double: %s', (_label, grades, expected) => {
    expect(score(grades)).toBe(expected)
  })

  it('ignores critical on an ungraded entry and keeps displayed counts raw', () => {
    const t = addToTally(emptyTally(), null, true)
    expect(t).toEqual(emptyTally())
    addToTally(t, 1, true)
    addToTally(t, -1)
    expect([t.plus, t.minus, t.critical, t.critPlus, netScore(t), plusRate(t)]).toEqual([1, 1, 1, 1, 0, 0.5])
    expect(critCount([{ grade: 1, critical: true }, { grade: null, critical: true }, { grade: 0, critical: false }])).toBe(1)
  })
})

describe('team EPA and success', () => {
  const play = (extra: Partial<Play>): Play => p('PHI', 'DAL', 0.5, true, { special: false, ...extra })
  it('negates EPA and success for the defense', () => {
    expect(teamEpa(play({}), 'PHI')).toBe(0.5)
    expect(teamEpa(play({}), 'DAL')).toBe(-0.5)
    expect(teamEpa(play({}), 'NYG')).toBeNull()
    expect(teamSuccess(play({ success: true }), 'PHI')).toBe(true)
    expect(teamSuccess(play({ success: true }), 'DAL')).toBe(false)
  })
  it('has no team EPA on special teams, no-plays or missing EPA', () => {
    expect(teamEpa(play({ special: true }), 'PHI')).toBeNull()
    expect(teamEpa(play({ playType: 'no_play' }), 'PHI')).toBeNull()
    expect(teamEpa(play({ epa: null }), 'PHI')).toBeNull()
    expect(teamSuccess(play({ special: true }), 'PHI')).toBeNull()
  })
  it('averages team EPA over plays that have one', () => {
    expect(meanTeamEpa([play({ epa: 1 }), play({ epa: -0.5 }), play({ special: true })], 'DAL')).toBeCloseTo(-0.25)
    expect(meanTeamEpa([play({ special: true })], 'PHI')).toBeNull()
  })
})
