import { describe, expect, it } from 'vitest'
import { addToTally, emptyTally, gradeScore, summarizeTeams } from './stats'
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
    expect(t).toEqual({ graded: 4, plus: 2, zero: 1, minus: 1 })
    expect(gradeScore(t)).toBe(63)
  })
})
