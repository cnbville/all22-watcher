import { describe, expect, it } from 'vitest'
import { makePlay } from './fixtures'
import { computeSplits, SMALL_SAMPLE, type SplitPlay } from './splits'
import type { Grade, Play } from './types'

let id = 0
const sp = (o: Partial<Play>, grade: Grade | null = 1, extra: Partial<SplitPlay> = {}): SplitPlay => ({
  play: makePlay({ playId: ++id, ...o }),
  team: 'PHI',
  grade,
  critical: false,
  chart: {},
  ...extra
})
const opts = { type: 'all' as const, hasParticipation: true, chartFields: [] }
const group = (groups: ReturnType<typeof computeSplits>, key: string) => groups.find((g) => g.key === key)!

describe('computeSplits', () => {
  it('buckets distance and leaves plays without a down out', () => {
    const plays = [sp({ ydstogo: 1 }), sp({ ydstogo: 3 }), sp({ ydstogo: 4 }), sp({ ydstogo: 10 }), sp({ ydstogo: 11 }), sp({ down: null, ydstogo: 2 })]
    const rows = group(computeSplits(plays, opts), 'distance').rows
    expect(rows.map((r) => r.label)).toEqual(['1–3 to go', '4–6 to go', '7–10 to go', '11+ to go'])
    expect(rows.map((r) => r.tally.graded)).toEqual([2, 1, 1, 1])
    expect(rows[0].rule).toEqual({ field: 'distance', op: 'is', value: ['1-3'] })
  })

  it('shows OT only when there are overtime plays', () => {
    expect(group(computeSplits([sp({ qtr: 1 })], opts), 'quarter').rows.map((r) => r.key)).toEqual(['1', '2', '3', '4'])
    const q = group(computeSplits([sp({ qtr: 5 }), sp({ qtr: 6 })], opts), 'quarter').rows
    expect(q.at(-1)).toMatchObject({ key: 'OT', label: 'OT' })
    expect(q.at(-1)!.tally.graded).toBe(2)
  })

  it('counts a play in every situation it is in, and hides empty ones', () => {
    const plays = [sp({ yardline100: 3, ydstogo: 3, qtr: 2, time: '00:40' }), sp({ yardline100: 15, ydstogo: 10 })]
    const rows = group(computeSplits(plays, opts), 'situation').rows
    expect(rows.map((r) => [r.key, r.tally.graded])).toEqual([
      ['redZone', 2],
      ['goalToGo', 1],
      ['twoMinute', 1]
    ])
    expect(group(computeSplits([sp({})], opts), 'situation').rows).toEqual([])
  })

  it('folds values past the top five into Other', () => {
    const covers = ['COVER_0', 'COVER_1', 'COVER_2', 'COVER_3', 'COVER_4', 'COVER_6', 'COVER_9']
    const plays = covers.flatMap((c, i) => Array.from({ length: 7 - i }, () => sp({ coverage: c })))
    const rows = group(computeSplits(plays, opts), 'coverage').rows
    expect(rows.map((r) => r.label)).toEqual(['Cover 0', 'Cover 1', 'Cover 2', 'Cover 3', 'Cover 4', 'Other'])
    expect(rows.at(-1)!.tally.graded).toBe(3)
    expect(rows.at(-1)!.rule).toBeNull()
    // Six values stay as they are.
    const six = covers.slice(0, 6).map((c) => sp({ coverage: c }))
    expect(group(computeSplits(six, opts), 'coverage').rows).toHaveLength(6)
  })

  it('merges defensive groupings under one label with their raw counts', () => {
    const plays = [sp({ defPersonnel: '4 DL, 2 LB, 5 DB' }), sp({ defPersonnel: '3 DL, 3 LB, 5 DB' }), sp({ defPersonnel: '2 DL, 3 LB, 6 DB' })]
    const rows = group(computeSplits(plays, opts), 'defPersonnel').rows
    expect(rows[0]).toMatchObject({ label: 'Nickel', rule: { field: 'personnel', op: 'is', value: ['4 DL, 2 LB, 5 DB', '3 DL, 3 LB, 5 DB'] } })
    expect(rows[0].detail).toHaveLength(2)
    expect(rows[1].label).toBe('Dime')
    expect(group(computeSplits(plays, opts), 'offPersonnel').rows[0].label).toBe('11 personnel')
  })

  it('flags small samples and leaves empty rows unflagged', () => {
    const few = Array.from({ length: SMALL_SAMPLE - 1 }, () => sp({ down: 3 }))
    const enough = Array.from({ length: SMALL_SAMPLE }, () => sp({ down: 1 }))
    const rows = group(computeSplits([...few, ...enough], opts), 'down').rows
    expect(rows[2].small).toBe(true)
    expect(rows[0].small).toBe(false)
    expect(rows[1]).toMatchObject({ small: false, grade: null })
  })

  it('restricts every split to the chosen play type and hides the type group', () => {
    const plays = [sp({ isPass: true }), sp({ isPass: false, isRush: true }), sp({ isPass: false, isRush: true })]
    const runs = computeSplits(plays, { ...opts, type: 'run' })
    expect(runs.some((g) => g.key === 'type')).toBe(false)
    expect(group(runs, 'down').rows[0].tally.graded).toBe(2)
    const all = group(computeSplits(plays, opts), 'type').rows
    expect(all.map((r) => [r.key, r.tally.graded])).toEqual([
      ['run', 2],
      ['pass', 1]
    ])
  })

  it('counts only graded plays, with critical counting double', () => {
    const plays = [sp({}, 1, { critical: true }), sp({}, -1), sp({}, null)]
    const row = group(computeSplits(plays, opts), 'down').rows[0]
    expect(row.tally).toMatchObject({ graded: 2, plus: 1, minus: 1, critical: 1, critPlus: 1 })
    // 50 + 50 * (1 - 1 + 1) / (2 + 1)
    expect(row.grade).toBe(67)
  })

  it('reports team EPA and success from the player’s side', () => {
    const plays = [sp({ epa: 1, success: true }), sp({ epa: -0.5, success: false })]
    const def = plays.map((p) => ({ ...p, team: 'DAL' }))
    expect(group(computeSplits(plays, opts), 'down').rows[0]).toMatchObject({ epa: 0.25, success: 0.5 })
    expect(group(computeSplits(def, opts), 'down').rows[0]).toMatchObject({ epa: -0.25, success: 0.5 })
  })

  it('marks lineup groups as not published without participation', () => {
    const g = computeSplits([sp({})], { ...opts, hasParticipation: false })
    for (const key of ['pressure', 'coverage', 'manZone', 'formation', 'offPersonnel', 'defPersonnel']) expect(group(g, key)).toMatchObject({ notPublished: true, rows: [] })
  })

  it('adds one group per chart field', () => {
    const fields = [{ id: 4, name: 'Concept', options: ['Mesh', 'Smash'] }]
    const g = computeSplits([sp({}, 1, { chart: { Concept: 'Mesh' } })], { ...opts, chartFields: fields })
    expect(group(g, 'chart:4')).toMatchObject({ label: 'Concept', suffix: 'your charting' })
    expect(group(g, 'chart:4').rows.map((r) => r.tally.graded)).toEqual([1, 0])
  })
})
