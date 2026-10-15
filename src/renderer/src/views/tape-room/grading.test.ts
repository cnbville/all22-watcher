import { describe, expect, it } from 'vitest'
import { emptyEntry, firstToGrade, listedPlayers, playIsUngraded, playProgress, withGrade, withOffField, withTag } from './grading'
import { entry, play, player } from './testPlays'

const players = {
  qb: player('qb', { group: 'QB', position: 'QB', jersey: '1', name: 'Jalen Hurts' }),
  rb: player('rb', { group: 'RB', position: 'RB', jersey: '26', name: 'Saquon Barkley' }),
  wr: player('wr', { group: 'WR', jersey: '11', name: 'A.J. Brown' }),
  wr2: player('wr2', { group: 'WR', jersey: '6', name: 'DeVonta Smith' }),
  cb: player('cb', { group: 'DB', position: 'CB', jersey: '33', name: 'Cooper DeJean' }),
  k: player('k', { group: 'ST', position: 'K', jersey: '4', name: 'Jake Elliott' }),
  dal: player('dal', { team: 'DAL', group: 'DB', name: 'Trevon Diggs' })
}

describe('listedPlayers (02 §7.1)', () => {
  it('lists the 11 on the field when lineups exist, sorted by position, jersey, name', () => {
    const p = play({ playId: 1, offensePlayers: ['wr', 'qb', 'wr2', 'rb'] })
    expect(listedPlayers(p, 'PHI', [], false, [], players).map((x) => x.id)).toEqual(['qb', 'rb', 'wr2', 'wr'])
  })

  it('narrows the field to starred players with Show Starred Players Only', () => {
    const p = play({ playId: 1, offensePlayers: ['wr', 'qb', 'rb'] })
    expect(listedPlayers(p, 'PHI', ['wr'], true, [], players).map((x) => x.id)).toEqual(['wr'])
    // Nobody starred: the filter has nothing to narrow to, so everyone stays.
    expect(listedPlayers(p, 'PHI', [], true, [], players)).toHaveLength(3)
  })

  it('uses the defense lineup when the studied team is on defense', () => {
    const p = play({ playId: 1, posteam: 'DAL', defteam: 'PHI', offensePlayers: ['dal'], defensePlayers: ['cb'] })
    expect(listedPlayers(p, 'PHI', [], false, [], players).map((x) => x.id)).toEqual(['cb'])
  })

  it('without lineups: starred players of the side plus credited players of the team', () => {
    const p = play({ playId: 1, involved: ['rb', 'dal', 'wr'] })
    // cb is starred but plays defense; k is special teams.
    expect(listedPlayers(p, 'PHI', ['qb', 'cb', 'k'], false, [], players).map((x) => x.id)).toEqual(['qb', 'rb', 'wr'])
    expect(listedPlayers(p, 'PHI', ['qb'], true, [], players).map((x) => x.id)).toEqual(['qb'])
  })

  it('without lineups on special teams: every starred player', () => {
    const p = play({ playId: 1, special: true, playType: 'punt' })
    expect(listedPlayers(p, 'PHI', ['k', 'cb'], false, [], players).map((x) => x.id)).toEqual(['cb', 'k'])
  })

  it('adds anyone with an entry on the play for the team, and a stub for unknown ids', () => {
    const p = play({ playId: 1, offensePlayers: ['qb'] })
    const entries = [
      entry(1, 'wr', { grade: 1 }),
      entry(1, 'ghost', { offField: true }),
      entry(1, 'rb', {}), // empty entries don't list anyone
      entry(1, 'cb', { team: 'DAL', grade: 0 }),
      entry(2, 'wr2', { grade: 0 })
    ]
    const list = listedPlayers(p, 'PHI', [], false, entries, players)
    expect(list.map((x) => x.id)).toEqual(['qb', 'wr', 'ghost'])
    expect(list[2]).toMatchObject({ id: 'ghost', name: 'ghost', group: 'ST', team: 'PHI' })
  })
})

describe('firstToGrade (02 §7.2)', () => {
  const list = [players.qb, players.rb, players.wr]
  it('picks the first listed player with no grade who is on the field', () => {
    const entries = new Map([
      ['qb', entry(1, 'qb', { grade: 1 })],
      ['rb', entry(1, 'rb', { offField: true })]
    ])
    expect(firstToGrade(list, (id) => entries.get(id))).toBe('wr')
  })
  it('falls back to the first listed player when everyone is done', () => {
    const entries = new Map(list.map((p) => [p.id, entry(1, p.id, { grade: 0 })]))
    expect(firstToGrade(list, (id) => entries.get(id))).toBe('qb')
  })
  it('is null with nobody listed', () => {
    expect(firstToGrade([], () => undefined)).toBeNull()
  })
})

describe('progress', () => {
  const list = [players.qb, players.rb, players.wr]
  it('counts grades and Not on Field marks as done', () => {
    const entries = new Map([
      ['qb', entry(1, 'qb', { grade: 1 })],
      ['rb', entry(1, 'rb', { offField: true })]
    ])
    expect(playProgress(list, (id) => entries.get(id))).toEqual({ done: 2, listed: 3, state: 'partial' })
    expect(playIsUngraded(list, (id) => entries.get(id))).toBe(true)
    entries.set('wr', entry(1, 'wr', { grade: -1 }))
    expect(playProgress(list, (id) => entries.get(id)).state).toBe('done')
    expect(playIsUngraded(list, (id) => entries.get(id))).toBe(false)
    expect(playProgress([], () => undefined).state).toBe('none')
  })
})

describe('entry changes (02 §7.3)', () => {
  const e = emptyEntry('g', 1, 'qb', 'PHI')
  it('a grade turns Not on Field off; clearing turns critical off', () => {
    expect(withGrade({ ...e, offField: true }, 1)).toMatchObject({ grade: 1, offField: false })
    expect(withGrade({ ...e, grade: 1, critical: true }, null)).toMatchObject({ grade: null, critical: false })
  })
  it('a tag implies + or − when no grade is set (v1)', () => {
    expect(withTag(e, { id: 1, group: 'QB', label: 'Accurate', kind: 'pos' })).toMatchObject({ tags: ['Accurate'], grade: 1 })
    expect(withTag(e, { id: 2, group: 'QB', label: 'Bad read', kind: 'neg' })).toMatchObject({ grade: -1 })
    expect(withTag({ ...e, grade: 0 }, { id: 2, group: 'QB', label: 'Bad read', kind: 'neg' })).toMatchObject({ grade: 0 })
    expect(withTag(e, { id: 3, group: 'QB', label: 'Scramble', kind: 'neutral' })).toMatchObject({ grade: null })
    expect(withTag({ ...e, tags: ['Accurate'], grade: 1 }, { id: 1, group: 'QB', label: 'Accurate', kind: 'pos' })).toMatchObject({ tags: [], grade: 1 })
  })
  it('Not on Field clears the grade and critical', () => {
    expect(withOffField({ ...e, grade: 1, critical: true }, true)).toMatchObject({ offField: true, grade: null, critical: false })
    expect(withOffField({ ...e, offField: true }, false)).toMatchObject({ offField: false, grade: null })
  })
})
