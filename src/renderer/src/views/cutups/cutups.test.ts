import { describe, expect, it } from 'vitest'
import type { CutupSummary } from '@shared/types'
import { reorderKeys, sortCutups, updatedLabel } from './cutupModel'
import { isTemplateName, nameFromTokens, newRule, opsFor, ruleSentence, rulesSummary, studiedTeam, TEMPLATES, templateRules, withOp } from './rules'

describe('rule sentences', () => {
  it('writes the summary line with · for all and or for any', () => {
    const rules = TEMPLATES[0].rules
    expect(rulesSummary({ match: 'all', rules, limit: null, order: 'game' })).toBe('Down is 3rd · Pressure is Pressured')
    expect(rulesSummary({ match: 'any', rules, limit: null, order: 'game' })).toBe('Down is 3rd or Pressure is Pressured')
  })
  it('names the player of a scoped rule and team nicknames', () => {
    expect(ruleSentence({ field: 'grade', op: 'is', value: ['-'], player: 'p1' }, { players: { p1: 'Cooper DeJean' } })).toBe('Grade is − for Cooper DeJean')
    expect(ruleSentence({ field: 'opponent', op: 'is', value: ['DAL'] })).toBe('Opponent is Cowboys')
  })
  it('gives each field a valid first operator and keeps values when the operator changes', () => {
    const r = newRule('down')
    expect(opsFor('down')).toContain(r.op)
    const changed = withOp({ ...r, value: ['3'] }, opsFor('down').find((o) => o !== r.op) ?? r.op)
    expect(changed.field).toBe('down')
  })
})

describe('templates and names', () => {
  it('fills the player into "Minus plays for a Player…"', () => {
    const t = TEMPLATES.find((x) => x.needsPlayer)!
    const out = templateRules(t, { id: 'p1', name: 'Cooper DeJean' })
    expect(out.name).toBe('Minus plays: Cooper DeJean')
    expect(out.rules[0].player).toBe('p1')
    expect(isTemplateName(out.name)).toBe(true)
    expect(isTemplateName('Blitz pickups')).toBe(false)
    expect(isTemplateName('')).toBe(true)
  })
  it('names a cut-up from search tokens with the team last', () => {
    expect(
      nameFromTokens(
        [
          { key: 'down', values: ['3'] },
          { key: 'pressure', values: ['pressured'] }
        ],
        'PHI'
      )
    ).toBe('3rd · Pressured · PHI')
  })
  it('reads the studied team from a "Team is studied" rule', () => {
    expect(studiedTeam([{ field: 'team', op: 'studied', value: ['PHI'] }])).toBe('PHI')
    expect(studiedTeam([{ field: 'down', op: 'is', value: ['3'] }])).toBeUndefined()
  })
})

describe('reorderKeys', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  it('moves a block before or after the target, keeping its order', () => {
    expect(reorderKeys(order, ['d', 'b'], 'a', false)).toEqual(['b', 'd', 'a', 'c', 'e'])
    expect(reorderKeys(order, ['a'], 'e', true)).toEqual(['b', 'c', 'd', 'e', 'a'])
  })
  it('does nothing when the target is in the block or missing', () => {
    expect(reorderKeys(order, ['b', 'c'], 'c', true)).toBe(order)
    expect(reorderKeys(order, ['b'], 'z', true)).toBe(order)
  })
})

describe('the Cut-ups screen', () => {
  const summary = (id: string, name: string, sort: number, updatedAt: string, playCount: number): CutupSummary => ({
    cutup: { id, name, kind: 'manual', rules: null, focus: null, sort, createdAt: updatedAt, updatedAt },
    playCount,
    gameCount: 1,
    duration: 0,
    withoutFilm: 0,
    poster: null
  })
  const list = [summary('1', 'Zebra', 2, '2025-10-01T00:00:00Z', 4), summary('2', 'Alpha', 1, '2025-10-03T00:00:00Z', 4), summary('3', 'Mid', 0, '2025-10-02T00:00:00Z', 9)]
  it('sorts manually, by name, by date and by plays', () => {
    expect(sortCutups(list, 'manual').map((c) => c.cutup.id)).toEqual(['3', '2', '1'])
    expect(sortCutups(list, 'name').map((c) => c.cutup.id)).toEqual(['2', '3', '1'])
    expect(sortCutups(list, 'updated').map((c) => c.cutup.id)).toEqual(['2', '3', '1'])
    expect(sortCutups(list, 'plays').map((c) => c.cutup.id)).toEqual(['3', '2', '1'])
  })
  it('labels the update day', () => {
    const now = new Date(2025, 9, 15, 12)
    expect(updatedLabel(new Date(2025, 9, 15, 8).toISOString(), now)).toBe('Updated today')
    expect(updatedLabel(new Date(2025, 9, 14, 8).toISOString(), now)).toBe('Updated yesterday')
    expect(updatedLabel(new Date(2025, 9, 2, 8).toISOString(), now)).toBe('Updated Oct 2')
    expect(updatedLabel(new Date(2024, 9, 2, 8).toISOString(), now)).toBe('Updated Oct 2, 2024')
  })
})
