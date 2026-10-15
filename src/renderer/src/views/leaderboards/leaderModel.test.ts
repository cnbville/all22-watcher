import { describe, expect, it } from 'vitest'
import type { GradeTally, LeaderRow, PositionGroup } from '@shared/types'
import { csvName, DEFAULT_FILTERS, dropped, filterSummary, filtersOn, leaderCsv, rankRows, searchRows, sortRows } from './leaderModel'

const tally = (plus: number, zero: number, minus: number, critical = 0): GradeTally => ({
  plus,
  zero,
  minus,
  graded: plus + zero + minus,
  critical,
  critPlus: 0,
  critMinus: 0
})

const row = (id: string, name: string, t: GradeTally, extra: Partial<LeaderRow> = {}): LeaderRow => ({
  player: { id, name, team: 'PHI', position: 'QB', depthPos: 'QB', group: 'QB' as PositionGroup, jersey: '1', status: '', headshot: '', college: '', height: '', weight: '', yearsExp: '' },
  teams: ['PHI'],
  games: 2,
  snaps: 120,
  tally: t,
  epa: 0.1,
  byGame: [
    { gameId: 'g1', week: 1, grade: 60 },
    { gameId: 'g2', week: 2, grade: 70 }
  ],
  lastGames: [
    { gameId: 'g2', tally: t, epaSum: 1, epaPlays: 10 },
    { gameId: 'g1', tally: tally(0, 0, 0), epaSum: 0, epaPlays: 0 }
  ],
  topTags: [],
  ...extra
})

describe('rankRows', () => {
  const rows = [
    row('a', 'Alpha', tally(10, 10, 0)), // 75
    row('b', 'Bravo', tally(10, 10, 0)), // 75
    row('c', 'Charlie', tally(0, 20, 0)), // 50
    row('d', 'Delta', tally(2, 0, 0)) // 100 but under the minimum
  ]

  it('uses competition ranking and drops rows under the minimum', () => {
    const out = rankRows(rows, DEFAULT_FILTERS, [])
    expect(out.map((v) => [v.id, v.rank, v.tied])).toEqual([
      ['a', 1, true],
      ['b', 1, true],
      ['c', 3, false]
    ])
  })

  it('filters by team and My Teams', () => {
    const dal = row('e', 'Echo', tally(5, 10, 0), { teams: ['PHI', 'DAL'] })
    expect(rankRows([...rows, dal], { ...DEFAULT_FILTERS, teams: 'DAL' }, []).map((v) => v.id)).toEqual(['e'])
    expect(rankRows([...rows, dal], { ...DEFAULT_FILTERS, teams: 'mine' }, ['DAL']).map((v) => v.id)).toEqual(['e'])
  })

  it('recomputes from the last N games', () => {
    const r = row('f', 'Foxtrot', tally(20, 0, 0), { lastGames: [{ gameId: 'g2', tally: tally(0, 12, 0), epaSum: -2, epaPlays: 4 }] })
    const [v] = rankRows([r], { ...DEFAULT_FILTERS, lastGames: 4 }, [])
    expect(v.grade).toBe(50)
    expect(v.graded).toBe(12)
    expect(v.epa).toBe(-0.5)
    expect(v.trend).toEqual([70])
  })
})

describe('sortRows and searchRows', () => {
  const views = rankRows([row('a', 'Alpha', tally(10, 10, 0)), row('b', 'Bravo', tally(12, 10, 0)), row('c', 'Charlie', tally(0, 20, 0))], DEFAULT_FILTERS, [])
  it('sorts by grade, ties by graded then name', () => {
    expect(sortRows(views, { column: 'grade', dir: 'desc' }).map((v) => v.id)).toEqual(['b', 'a', 'c'])
    expect(sortRows(views, { column: 'player', dir: 'asc' }).map((v) => v.id)).toEqual(['a', 'b', 'c'])
  })
  it('searches names and teams', () => {
    expect(searchRows(views, 'char').map((v) => v.id)).toEqual(['c'])
    expect(searchRows(views, 'eagles')).toHaveLength(3)
    expect(searchRows(views, 'phi')).toHaveLength(3)
  })
})

describe('filters', () => {
  it('summarizes only the non-default filters', () => {
    expect(filtersOn(DEFAULT_FILTERS)).toBe(false)
    expect(filterSummary({ minSnaps: 20, teams: 'mine', lastGames: 4 })).toBe('Min. 20 graded snaps · My Teams · Last 4 games')
    expect(filterSummary({ ...DEFAULT_FILTERS, teams: 'PHI' })).toBe('Eagles')
  })
})

describe('CSV', () => {
  it('writes plain numbers and both teams', () => {
    const v = rankRows([row('a', 'Smith, "Al"', tally(1, 9, 0), { teams: ['PHI', 'DAL'], epa: -0.1234 })], DEFAULT_FILTERS, [])
    const lines = leaderCsv(v).trim().split('\n')
    expect(lines[0]).toBe('rank,player,team,position,games,snaps,graded,plus,zero,minus,critical,plus_rate,grade,epa_per_play')
    expect(lines[1]).toBe('1,"Smith, ""Al""",PHI/DAL,QB,2,120,10,1,9,0,0,0.1,55,-0.123')
    expect(csvName('QB', 2025)).toBe('Leaderboard QB 2025.csv')
  })
})

describe('dropped', () => {
  it('drops Trend, then Crit, then Snaps below 960', () => {
    expect([...dropped(0)]).toEqual([])
    expect([...dropped(960)]).toEqual([])
    expect([...dropped(900)]).toEqual(['trend'])
    expect([...dropped(860)]).toEqual(['trend', 'crit'])
    expect([...dropped(816)]).toEqual(['trend', 'crit', 'snaps'])
    expect(dropped(500).size).toBeGreaterThan(3)
  })
})
