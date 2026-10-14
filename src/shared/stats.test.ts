import { describe, expect, it } from 'vitest'
import { addToTally, emptyTally, gradeScore, summarizeTeams } from './stats'
import type { GameInfo, Play } from './types'

const game = (home: string, away: string, hs: number, as: number): GameInfo => ({
  gameId: `2025_01_${away}_${home}`, season: 2025, week: 1, gameType: 'REG', gameday: '', homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as
})

const p = (posteam: string, defteam: string, epa: number, isPass: boolean, extra: Partial<Play> = {}): Play =>
  ({ posteam, defteam, epa, isPass, isRush: !isPass, success: epa > 0, yardsGained: 5, playType: isPass ? 'pass' : 'run', turnover: false, sack: false, ...extra }) as Play

describe('summarizeTeams', () => {
  it('computes records and ranks offense and defense', () => {
    const games = [game('PHI', 'DAL', 24, 20), game('NYG', 'WAS', 10, 10)]
    const plays = [
      p('PHI', 'DAL', 0.5, true), p('PHI', 'DAL', 0.1, false), p('DAL', 'PHI', -0.4, true, { turnover: true }),
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
