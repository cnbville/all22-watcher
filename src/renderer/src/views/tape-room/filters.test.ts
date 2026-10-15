import { describe, expect, it } from 'vitest'
import type { FilterToken } from '@shared/playQuery'
import type { GradeEntry, Play, PlayNote } from '@shared/types'
import { addTokenValue, buildSuggestions, fromSearchTokens, lineupOptions, matchPlay, setTokenValues, suggestFilters, toSearchToken } from './filters'
import { entry, GAME, note, play } from './testPlays'

const ctx = (p: Play, extra: { entries?: GradeEntry[]; note?: PlayNote | null; player?: string } = {}) => ({
  game: GAME,
  team: 'PHI',
  entries: extra.entries ?? [],
  note: extra.note ?? null,
  player: extra.player
})
const m = (p: Play, tokens: FilterToken[], text = '', extra = {}) => matchPlay(p, tokens, text, ctx(p, extra))

describe('matchPlay: every token key (02 §4.3)', () => {
  it('side follows the studied team', () => {
    expect(m(play({ playId: 1 }), [{ key: 'side', values: ['offense'] }])).toBe(true)
    expect(m(play({ playId: 1, posteam: 'DAL', defteam: 'PHI' }), [{ key: 'side', values: ['offense'] }])).toBe(false)
    expect(m(play({ playId: 1, posteam: 'DAL', defteam: 'PHI' }), [{ key: 'side', values: ['defense'] }])).toBe(true)
  })
  it('type', () => {
    expect(m(play({ playId: 1 }), [{ key: 'type', values: ['pass'] }])).toBe(true)
    expect(m(play({ playId: 1, isPass: false, isRush: true }), [{ key: 'type', values: ['pass'] }])).toBe(false)
    expect(m(play({ playId: 1, special: true }), [{ key: 'type', values: ['special'] }])).toBe(true)
  })
  it('down and distance (plays with no down never match distance)', () => {
    expect(m(play({ playId: 1, down: 3 }), [{ key: 'down', values: ['3', '4'] }])).toBe(true)
    expect(m(play({ playId: 1, down: 2 }), [{ key: 'down', values: ['3', '4'] }])).toBe(false)
    expect(m(play({ playId: 1, ydstogo: 2 }), [{ key: 'distance', values: ['1-3'] }])).toBe(true)
    expect(m(play({ playId: 1, ydstogo: 12 }), [{ key: 'distance', values: ['11+'] }])).toBe(true)
    expect(m(play({ playId: 1, down: null, ydstogo: 2 }), [{ key: 'distance', values: ['1-3'] }])).toBe(false)
  })
  it('quarter, with overtime as OT', () => {
    expect(m(play({ playId: 1, qtr: 2 }), [{ key: 'quarter', values: ['2'] }])).toBe(true)
    expect(m(play({ playId: 1, qtr: 5 }), [{ key: 'quarter', values: ['OT'] }])).toBe(true)
  })
  it('situation', () => {
    expect(m(play({ playId: 1, yardline100: 15 }), [{ key: 'situation', values: ['redZone'] }])).toBe(true)
    expect(m(play({ playId: 1, yardline100: 15, down: null }), [{ key: 'situation', values: ['redZone'] }])).toBe(false)
    expect(m(play({ playId: 1, yardline100: 3, ydstogo: 3 }), [{ key: 'situation', values: ['goalToGo'] }])).toBe(true)
    expect(m(play({ playId: 1, qtr: 4, time: '01:59' }), [{ key: 'situation', values: ['twoMinute'] }])).toBe(true)
    expect(m(play({ playId: 1, qtr: 3, time: '01:59' }), [{ key: 'situation', values: ['twoMinute'] }])).toBe(false)
  })
  it('status: the studied team’s grades, or the focus player’s', () => {
    const p = play({ playId: 1 })
    const graded = [entry(1, 'qb', { grade: 1 })]
    expect(m(p, [{ key: 'status', values: ['ungraded'] }])).toBe(true)
    expect(m(p, [{ key: 'status', values: ['graded'] }], '', { entries: graded })).toBe(true)
    expect(m(p, [{ key: 'status', values: ['graded'] }], '', { entries: [entry(1, 'qb', { grade: 1, team: 'DAL' })] })).toBe(false)
    expect(m(p, [{ key: 'status', values: ['critical'] }], '', { entries: [entry(1, 'qb', { grade: 0, critical: true })] })).toBe(true)
    expect(m(p, [{ key: 'status', values: ['ungraded'] }], '', { entries: graded, player: 'wr' })).toBe(true)
    expect(m(p, [{ key: 'status', values: ['graded'] }], '', { entries: graded, player: 'qb' })).toBe(true)
  })
  it('marked', () => {
    const p = play({ playId: 1 })
    expect(m(p, [{ key: 'marked', values: ['flagged'] }], '', { note: note(1, { flagged: true }) })).toBe(true)
    expect(m(p, [{ key: 'marked', values: ['notes'] }], '', { entries: [entry(1, 'qb', { note: 'late' })] })).toBe(true)
    expect(m(p, [{ key: 'marked', values: ['notes'] }], '', { note: note(1, { note: '  ' }) })).toBe(false)
    const shape = { id: 'a', kind: 'box' as const, color: '#FFD60A', width: 4, start: 0, duration: null, x: 0, y: 0, w: 0.1, h: 0.1 }
    expect(m(p, [{ key: 'marked', values: ['drawings'] }], '', { note: note(1, { drawing: { endzone: [shape] } }) })).toBe(true)
  })
  it('result', () => {
    expect(m(play({ playId: 1, touchdown: true }), [{ key: 'result', values: ['td'] }])).toBe(true)
    expect(m(play({ playId: 1, sack: true }), [{ key: 'result', values: ['td', 'sack'] }])).toBe(true)
    expect(m(play({ playId: 1 }), [{ key: 'result', values: ['turnover', 'penalty'] }])).toBe(false)
  })
  it('formation, personnel (the studied team’s side) and coverage', () => {
    const p = play({ playId: 1, formation: 'SHOTGUN', offPersonnel: '1 RB, 1 TE, 3 WR', defPersonnel: '4 DL, 2 LB, 5 DB', coverage: 'COVER_3' })
    expect(m(p, [{ key: 'formation', values: ['SHOTGUN'] }])).toBe(true)
    expect(m(p, [{ key: 'personnel', values: ['1 RB, 1 TE, 3 WR'] }])).toBe(true)
    expect(m(p, [{ key: 'personnel', values: ['4 DL, 2 LB, 5 DB'] }])).toBe(false)
    expect(m({ ...p, posteam: 'DAL', defteam: 'PHI' }, [{ key: 'personnel', values: ['4 DL, 2 LB, 5 DB'] }])).toBe(true)
    expect(m(p, [{ key: 'coverage', values: ['COVER_1'] }])).toBe(false)
  })
})

describe('combining', () => {
  const p = play({ playId: 1, down: 3, qtr: 2, desc: 'J.Hurts sacked at PHI 20 (Micah Parsons)', sack: true })
  it('OR within a key, AND across keys and with the text', () => {
    expect(m(p, [{ key: 'down', values: ['1', '3'] }, { key: 'quarter', values: ['2'] }])).toBe(true)
    expect(m(p, [{ key: 'down', values: ['1', '3'] }, { key: 'quarter', values: ['1'] }])).toBe(false)
    expect(m(p, [{ key: 'down', values: ['3'] }], 'parsons')).toBe(true)
    expect(m(p, [{ key: 'down', values: ['3'] }], 'lamb')).toBe(false)
  })
  it('free text is case- and accent-insensitive', () => {
    expect(m(play({ playId: 1, desc: 'pass to A.St. Brown' }), [], 'st. BROWN')).toBe(true)
    expect(m(play({ playId: 1, desc: 'tackle by J.Bérubé' }), [], 'berube')).toBe(true)
  })
})

describe('tokens', () => {
  it('round-trips through search tokens with labels', () => {
    const t: FilterToken[] = [{ key: 'down', values: ['3', '4'] }, { key: 'side', values: ['offense'] }, { key: 'result', values: ['td'] }]
    const st = t.map((x) => toSearchToken(x, 'PHI'))
    expect(st.map((x) => `${x.keyLabel} ${x.label}`)).toEqual(['Down: 3rd, 4th', 'Side: PHI Offense', 'Result: Touchdown'])
    expect(fromSearchTokens(st)).toEqual(t)
  })
  it('merges a second token of the same key; single-value keys replace', () => {
    let t = addTokenValue([], 'down', '3')
    t = addTokenValue(t, 'down', '4')
    t = addTokenValue(t, 'side', 'offense')
    t = addTokenValue(t, 'side', 'defense')
    expect(t).toEqual([{ key: 'down', values: ['3', '4'] }, { key: 'side', values: ['defense'] }])
    expect(setTokenValues(t, 'down', [])).toEqual([{ key: 'side', values: ['defense'] }])
  })
})

describe('suggestFilters', () => {
  const s = (text: string, tokens: FilterToken[] = []) => suggestFilters(text, 'PHI', tokens).map((x) => `${x.key}:${x.value}`)
  it('maps the aliases', () => {
    expect(s('3rd')[0]).toBe('down:3')
    expect(s('third')[0]).toBe('down:3')
    expect(s('red')[0]).toBe('situation:redZone')
    expect(s('rz')[0]).toBe('situation:redZone')
    expect(s('goal')[0]).toBe('situation:goalToGo')
    expect(s('2 min')[0]).toBe('situation:twoMinute')
    expect(s('two')[0]).toBe('situation:twoMinute')
    expect(s('td')[0]).toBe('result:td')
    expect(s('touchdown')[0]).toBe('result:td')
    expect(s('int')[0]).toBe('result:turnover')
    expect(s('fumble')[0]).toBe('result:turnover')
    expect(s('sack')[0]).toBe('result:sack')
    expect(s('flag')).toContain('result:penalty')
    expect(s('flag')).toContain('marked:flagged')
    expect(s('punt')[0]).toBe('type:special')
    expect(s('kick')[0]).toBe('type:special')
    expect(s('q3')[0]).toBe('quarter:3')
    expect(s('ot')[0]).toBe('quarter:OT')
    expect(s('ungraded')[0]).toBe('status:ungraded')
    expect(s('critical')[0]).toBe('status:critical')
    expect(s('drawings')[0]).toBe('marked:drawings')
  })
  it('matches the game’s lineup values and skips values already filtered', () => {
    const lineup = lineupOptions([play({ playId: 1, formation: 'SHOTGUN', coverage: 'COVER_3' })], 'PHI')
    expect(suggestFilters('shot', 'PHI', [], lineup).map((x) => x.label)).toEqual(['Shotgun'])
    expect(suggestFilters('cover', 'PHI', [], lineup).map((x) => x.label)).toEqual(['Cover 3'])
    expect(s('3rd', [{ key: 'down', values: ['3'] }])).not.toContain('down:3')
    expect(s('')).toEqual([])
  })
})

describe('buildSuggestions', () => {
  it('starts with "Search descriptions for", then the filters under "Filter by"', () => {
    let kept = false
    const rows = buildSuggestions('sack', 'PHI', [], lineupOptions([], 'PHI'), () => (kept = true))
    expect(rows[0].token.label).toBe('Search descriptions for “sack”')
    expect(rows[0].section).toBeUndefined()
    rows[0].run?.()
    expect(kept).toBe(true)
    expect(rows[1]).toMatchObject({ section: 'Filter by', token: { keyLabel: 'Result:', label: 'Sack' } })
    expect(fromSearchTokens([rows[1].token])).toEqual([{ key: 'result', values: ['sack'] }])
  })
  it('offers nothing for empty text', () => {
    expect(buildSuggestions('  ', 'PHI', [], lineupOptions([], 'PHI'), () => {})).toEqual([])
  })
})
