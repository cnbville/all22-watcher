import { describe, expect, it } from 'vitest'
import { makeEntry, makeGame, makeNote, makePlay } from './fixtures'
import {
  distanceBucket,
  type FilterToken,
  gameMayMatch,
  matchRule,
  matchRules,
  type PlayContext,
  ruleComplete,
  rulesToTokens,
  situations,
  textContains,
  tokensToRules
} from './playQuery'
import type { PlayRule } from './types'

const game = makeGame()
const ctx = (o: Partial<PlayContext> = {}): PlayContext => ({ game, team: 'PHI', entries: [], note: null, ...o })
const rule = (field: PlayRule['field'], op: PlayRule['op'], value: PlayRule['value'], player?: string): PlayRule => ({ field, op, value, ...(player ? { player } : {}) })
const m = (r: PlayRule, play = makePlay(), c = ctx()) => matchRule(r, play, c)

describe('matchRule: game fields', () => {
  it('season is / is not / between', () => {
    expect(m(rule('season', 'is', ['2025']))).toBe(true)
    expect(m(rule('season', 'is', ['2024']))).toBe(false)
    expect(m(rule('season', 'isNot', ['2024']))).toBe(true)
    expect(m(rule('season', 'between', [2023, 2025]))).toBe(true)
    // Ends in either order.
    expect(m(rule('season', 'between', [2026, 2024]))).toBe(true)
    expect(m(rule('season', 'between', [2026, 2027]))).toBe(false)
  })
  it('team studied / offense / defense', () => {
    expect(m(rule('team', 'studied', ['PHI']))).toBe(true)
    expect(m(rule('team', 'studied', ['DAL']))).toBe(false)
    expect(m(rule('team', 'offense', ['PHI']))).toBe(true)
    expect(m(rule('team', 'defense', ['PHI']))).toBe(false)
    expect(m(rule('team', 'defense', ['DAL']))).toBe(true)
  })
  it('opponent is seen from the perspective team', () => {
    expect(m(rule('opponent', 'is', ['DAL']))).toBe(true)
    expect(m(rule('opponent', 'is', ['DAL']), makePlay(), ctx({ team: 'DAL' }))).toBe(false)
    expect(m(rule('opponent', 'isNot', ['DAL']))).toBe(false)
  })
  it('game and week', () => {
    expect(m(rule('game', 'is', ['2025_01_DAL_PHI']))).toBe(true)
    expect(m(rule('game', 'isNot', ['2025_01_DAL_PHI']))).toBe(false)
    expect(m(rule('week', 'is', 1))).toBe(true)
    expect(m(rule('week', 'is', [1, 2]))).toBe(true)
    expect(m(rule('week', 'between', [2, 5]))).toBe(false)
    expect(m(rule('week', 'gte', 1))).toBe(true)
    expect(m(rule('week', 'lte', 0))).toBe(false)
  })
})

describe('matchRule: situation fields', () => {
  it('side from the perspective team', () => {
    expect(m(rule('side', 'is', ['offense']))).toBe(true)
    expect(m(rule('side', 'is', ['defense']), makePlay(), ctx({ team: 'DAL' }))).toBe(true)
  })
  it('type', () => {
    expect(m(rule('type', 'is', ['pass']))).toBe(true)
    expect(m(rule('type', 'is', ['run', 'special']))).toBe(false)
    expect(m(rule('type', 'isNot', ['pass']))).toBe(false)
    expect(m(rule('type', 'is', ['special']), makePlay({ special: true, isPass: false }))).toBe(true)
  })
  it('down, distance buckets and yards', () => {
    const p = makePlay({ down: 3, ydstogo: 7 })
    expect(m(rule('down', 'is', ['3', '4']), p)).toBe(true)
    expect(m(rule('down', 'isNot', ['3']), p)).toBe(false)
    expect(m(rule('distance', 'is', ['7-10']), p)).toBe(true)
    expect(m(rule('distance', 'gte', 8), p)).toBe(false)
    expect(m(rule('distance', 'lte', 7), p)).toBe(true)
    // Plays without a down never match down or distance.
    expect(m(rule('distance', 'is', ['1-3']), makePlay({ down: null, ydstogo: 2 }))).toBe(false)
    expect(m(rule('down', 'isNot', ['1']), makePlay({ down: null }))).toBe(false)
    expect([1, 3, 4, 6, 7, 10, 11, 25].map(distanceBucket)).toEqual(['1-3', '1-3', '4-6', '4-6', '7-10', '7-10', '11+', '11+'])
  })
  it('quarter with OT', () => {
    expect(m(rule('quarter', 'is', ['1']))).toBe(true)
    expect(m(rule('quarter', 'is', ['OT']), makePlay({ qtr: 5 }))).toBe(true)
    expect(m(rule('quarter', 'isNot', ['OT']), makePlay({ qtr: 6 }))).toBe(false)
  })
  it('situations overlap', () => {
    const p = makePlay({ yardline100: 4, ydstogo: 4, qtr: 4, time: '01:30' })
    expect(situations(p)).toEqual(['redZone', 'goalToGo', 'twoMinute'])
    expect(m(rule('situation', 'is', ['goalToGo']), p)).toBe(true)
    expect(m(rule('situation', 'isNot', ['redZone']), p)).toBe(false)
    expect(situations(makePlay({ qtr: 1, time: '01:00' }))).toEqual([])
  })
  it('field position from the offense side', () => {
    const p = makePlay({ yardline100: 18 })
    expect(m(rule('yardline', 'insideOpp', 20), p)).toBe(true)
    expect(m(rule('yardline', 'insideOpp', 10), p)).toBe(false)
    expect(m(rule('yardline', 'insideOwn', 20), makePlay({ yardline100: 85 }))).toBe(true)
    expect(m(rule('yardline', 'insideOwn', 10), makePlay({ yardline100: 85 }))).toBe(false)
  })
})

describe('matchRule: lineup fields', () => {
  it('formation, personnel and coverage', () => {
    expect(m(rule('formation', 'is', ['SHOTGUN']))).toBe(true)
    expect(m(rule('formation', 'isNot', ['SHOTGUN']))).toBe(false)
    expect(m(rule('personnel', 'is', ['1 RB, 1 TE, 3 WR']))).toBe(true)
    expect(m(rule('personnel', 'is', ['4 DL, 2 LB, 5 DB']))).toBe(true)
    expect(m(rule('coverage', 'is', ['COVER_1']))).toBe(false)
    expect(m(rule('coverage', 'isNot', ['COVER_1']))).toBe(true)
  })
  it('without participation data nothing matches, not even "is not"', () => {
    const bare = makePlay({ formation: null, coverage: null, offPersonnel: null, defPersonnel: null, manZone: null, wasPressure: null, passRushers: null, defendersInBox: null })
    for (const r of [
      rule('formation', 'isNot', ['SHOTGUN']),
      rule('coverage', 'isNot', ['COVER_1']),
      rule('personnel', 'isNot', ['x']),
      rule('manZone', 'is', ['zone']),
      rule('pressure', 'is', ['notPressured']),
      rule('passRushers', 'gte', 0),
      rule('box', 'lte', 11)
    ]) {
      expect(m(r, bare)).toBe(false)
    }
  })
  it('man or zone, pressure, rushers and box', () => {
    expect(m(rule('manZone', 'is', ['zone']))).toBe(true)
    expect(m(rule('manZone', 'is', ['man']), makePlay({ manZone: 'MAN_COVERAGE' }))).toBe(true)
    expect(m(rule('pressure', 'is', ['notPressured']))).toBe(true)
    expect(m(rule('pressure', 'is', ['pressured']), makePlay({ wasPressure: true }))).toBe(true)
    // Run plays never match pressure.
    expect(m(rule('pressure', 'is', ['notPressured']), makePlay({ isPass: false, isRush: true }))).toBe(false)
    expect(m(rule('passRushers', 'is', 4))).toBe(true)
    expect(m(rule('passRushers', 'gte', 5))).toBe(false)
    expect(m(rule('box', 'lte', 6))).toBe(true)
    expect(m(rule('box', 'is', [7, 8]))).toBe(false)
    expect(m(rule('box', 'isNot', [7, 8]))).toBe(true)
  })
})

describe('matchRule: result fields', () => {
  it('result flags and explosive', () => {
    expect(m(rule('result', 'is', ['td']), makePlay({ touchdown: true }))).toBe(true)
    expect(m(rule('result', 'is', ['explosive']), makePlay({ yardsGained: 20 }))).toBe(true)
    expect(m(rule('result', 'is', ['explosive']), makePlay({ yardsGained: 19 }))).toBe(false)
    expect(m(rule('result', 'is', ['explosive']), makePlay({ isPass: false, isRush: true, yardsGained: 10 }))).toBe(true)
    expect(m(rule('result', 'isNot', ['sack', 'turnover']))).toBe(true)
    expect(m(rule('result', 'is', ['penalty', 'sack']), makePlay({ sack: true }))).toBe(true)
  })
  it('success and EPA for the perspective team', () => {
    const p = makePlay({ epa: 0.8, success: true })
    expect(m(rule('success', 'is', ['successful']), p)).toBe(true)
    expect(m(rule('success', 'is', ['unsuccessful']), p, ctx({ team: 'DAL' }))).toBe(true)
    expect(m(rule('epa', 'gte', 0.5), p)).toBe(true)
    expect(m(rule('epa', 'lte', -0.5), p, ctx({ team: 'DAL' }))).toBe(true)
    expect(m(rule('epa', 'between', [-1, 0]), p)).toBe(false)
    // Special teams have no team EPA.
    expect(m(rule('epa', 'gte', -10), makePlay({ special: true }))).toBe(false)
  })
  it('yards and description', () => {
    expect(m(rule('yards', 'gte', 8))).toBe(true)
    expect(m(rule('yards', 'lte', 7))).toBe(false)
    expect(m(rule('text', 'contains', 'a.BROWN'))).toBe(true)
    expect(m(rule('text', 'contains', 'Kelce'))).toBe(false)
    expect(textContains('Pass to J.Peñá', 'pena')).toBe(true)
    expect(m(rule('text', 'contains', '  '))).toBe(false)
  })
})

describe('matchRule: your grading', () => {
  const entries = [
    makeEntry({ playerId: 'qb1', grade: 1, critical: true, tags: ['Good read'], note: 'Late but on time' }),
    makeEntry({ playerId: 'ol1', grade: -1, tags: ['Beat inside'] }),
    makeEntry({ playerId: 'cb1', team: 'DAL', grade: 0 })
  ]
  const c = ctx({ entries })
  it('player on field, credited, graded', () => {
    expect(m(rule('player', 'onField', ['ol1']), makePlay(), c)).toBe(true)
    expect(m(rule('player', 'onField', ['zz']), makePlay(), c)).toBe(false)
    expect(m(rule('player', 'credited', ['wr1']), makePlay(), c)).toBe(true)
    expect(m(rule('player', 'credited', ['ol1']), makePlay(), c)).toBe(false)
    expect(m(rule('player', 'graded', ['cb1']), makePlay(), c)).toBe(true)
    expect(m(rule('player', 'graded', ['wr1']), makePlay(), c)).toBe(false)
  })
  it('grade for the perspective team, or a scoped player', () => {
    expect(m(rule('grade', 'is', ['-']), makePlay(), c)).toBe(true)
    expect(m(rule('grade', 'is', ['0']), makePlay(), c)).toBe(false)
    expect(m(rule('grade', 'is', ['0']), makePlay(), ctx({ entries, team: 'DAL' }))).toBe(true)
    expect(m(rule('grade', 'is', ['-'], 'qb1'), makePlay(), c)).toBe(false)
    expect(m(rule('grade', 'is', ['+'], 'qb1'), makePlay(), c)).toBe(true)
  })
  it('status', () => {
    expect(m(rule('status', 'is', ['critical']), makePlay(), c)).toBe(true)
    expect(m(rule('status', 'is', ['critical'], 'ol1'), makePlay(), c)).toBe(false)
    expect(m(rule('status', 'is', ['ungraded']), makePlay(), ctx())).toBe(true)
    expect(m(rule('status', 'isNot', ['graded']), makePlay(), c)).toBe(false)
    // A critical mark without a grade doesn't make the play critical.
    expect(m(rule('status', 'is', ['critical']), makePlay(), ctx({ entries: [makeEntry({ grade: null, critical: true })] }))).toBe(false)
  })
  it('tag includes / excludes', () => {
    expect(m(rule('tag', 'includes', ['Beat inside']), makePlay(), c)).toBe(true)
    expect(m(rule('tag', 'excludes', ['Beat inside']), makePlay(), c)).toBe(false)
    expect(m(rule('tag', 'includes', ['Beat inside'], 'qb1'), makePlay(), c)).toBe(false)
  })
  it('marked and note', () => {
    const note = makeNote({ flagged: true, note: 'Watch the boundary', drawing: { sideline: [{ id: 'a', kind: 'box', color: '#FFD60A', width: 4, start: 0, duration: null, x: 0, y: 0, w: 0.1, h: 0.1 }] } })
    const cn = ctx({ entries, note })
    expect(m(rule('marked', 'is', ['flagged']), makePlay(), cn)).toBe(true)
    expect(m(rule('marked', 'is', ['drawings']), makePlay(), cn)).toBe(true)
    expect(m(rule('marked', 'is', ['notes']), makePlay(), ctx({ entries }))).toBe(true)
    expect(m(rule('marked', 'isNot', ['flagged']), makePlay(), ctx())).toBe(true)
    expect(m(rule('note', 'contains', 'boundary'), makePlay(), cn)).toBe(true)
    expect(m(rule('note', 'contains', 'on time'), makePlay(), cn)).toBe(true)
    expect(m(rule('note', 'contains', 'nothing'), makePlay(), cn)).toBe(false)
  })
  it('chart fields by id', () => {
    const cn = ctx({ note: makeNote({ chart: { Concept: 'Mesh' } }), chartFields: [{ id: 4, name: 'Concept', options: ['Mesh', 'Smash'] }] })
    expect(m(rule('chart:4', 'is', ['Mesh']), makePlay(), cn)).toBe(true)
    expect(m(rule('chart:4', 'isNot', ['Mesh']), makePlay(), cn)).toBe(false)
    expect(m(rule('chart:4', 'isNot', ['Smash']), makePlay(), cn)).toBe(true)
    expect(m(rule('chart:9', 'is', ['Mesh']), makePlay(), cn)).toBe(false)
  })
  it('incomplete rules match nothing', () => {
    expect(m(rule('down', 'is', []))).toBe(false)
    expect(ruleComplete(rule('down', 'is', []))).toBe(false)
    expect(ruleComplete(rule('epa', 'gte', 0))).toBe(true)
    expect(ruleComplete(rule('text', 'contains', ' '))).toBe(false)
  })
})

describe('matchRules and gameMayMatch', () => {
  const third = makePlay({ down: 3, ydstogo: 5 })
  it('all / any', () => {
    const rules = [rule('down', 'is', ['3']), rule('type', 'is', ['run'])]
    expect(matchRules({ match: 'all', rules }, third, ctx())).toBe(false)
    expect(matchRules({ match: 'any', rules }, third, ctx())).toBe(true)
    expect(matchRules({ match: 'all', rules: [] }, third, ctx())).toBe(false)
  })
  it('rules out games from their game rules alone', () => {
    const other = makeGame({ gameId: '2024_05_NYG_DAL', season: 2024, week: 5, homeTeam: 'DAL', awayTeam: 'NYG' })
    const rules = [rule('season', 'is', ['2025']), rule('down', 'is', ['3'])]
    expect(gameMayMatch({ match: 'all', rules }, game, 'PHI')).toBe(true)
    expect(gameMayMatch({ match: 'all', rules }, other, 'DAL')).toBe(false)
    // With "any", a play rule can still match.
    expect(gameMayMatch({ match: 'any', rules }, other, 'DAL')).toBe(true)
    expect(gameMayMatch({ match: 'all', rules: [rule('team', 'offense', ['NYJ'])] }, game, 'PHI')).toBe(false)
    expect(gameMayMatch({ match: 'all', rules: [rule('team', 'defense', ['DAL'])] }, game, 'PHI')).toBe(true)
    expect(gameMayMatch({ match: 'all', rules: [rule('opponent', 'is', ['DAL'])] }, game, 'PHI')).toBe(true)
  })
})

describe('tokens and rules', () => {
  const keys: FilterToken[] = [
    { key: 'side', values: ['offense'] },
    { key: 'type', values: ['pass', 'run'] },
    { key: 'down', values: ['3'] },
    { key: 'distance', values: ['7-10'] },
    { key: 'quarter', values: ['OT'] },
    { key: 'situation', values: ['redZone'] },
    { key: 'status', values: ['graded'] },
    { key: 'marked', values: ['flagged'] },
    { key: 'result', values: ['explosive'] },
    { key: 'formation', values: ['SHOTGUN'] },
    { key: 'personnel', values: ['1 RB, 1 TE, 3 WR'] },
    { key: 'coverage', values: ['COVER_3'] },
    { key: 'grade', values: ['+'] },
    { key: 'tag', values: ['Good read'] },
    { key: 'game', values: ['2025_01_DAL_PHI'] },
    { key: 'manZone', values: ['man'] },
    { key: 'pressure', values: ['pressured'] },
    { key: 'chart:4', values: ['Mesh'] }
  ]
  it('round trips every token key', () => {
    const rules = tokensToRules(keys, { text: 'deep' })
    expect(rules).toHaveLength(keys.length + 1)
    expect(rules.find((r) => r.field === 'tag')!.op).toBe('includes')
    expect(rules.at(-1)).toEqual({ field: 'text', op: 'contains', value: 'deep' })
    expect(rulesToTokens(rules)).toEqual({ tokens: keys, text: 'deep' })
  })
  it('scopes grade, status and tag to a player', () => {
    const rules = tokensToRules(keys, { player: 'qb1' })
    expect(rules.filter((r) => r.player === 'qb1').map((r) => r.field).sort()).toEqual(['grade', 'status', 'tag'])
  })
  it('rules without a token form give null', () => {
    expect(rulesToTokens([rule('epa', 'gte', 0)])).toBeNull()
    expect(rulesToTokens([rule('down', 'isNot', ['3'])])).toBeNull()
    expect(rulesToTokens([rule('season', 'is', ['2025'])])).toBeNull()
  })
  it('tokens give the same answer as the rules they become', () => {
    const play = makePlay({ down: 3, ydstogo: 8 })
    const rules = tokensToRules([{ key: 'down', values: ['3'] }, { key: 'distance', values: ['7-10'] }])
    expect(matchRules({ match: 'all', rules }, play, ctx())).toBe(true)
  })
})
