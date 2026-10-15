import { describe, expect, it } from 'vitest'
import { makeEntry, makeGame, makePlay } from './fixtures'
import { focusProgress, focusSnaps } from './focus'
import { defPersonnelLabel, defPersonnelShape, downDistance, durationLabel, enumLabel, gameLabel, personnelLabel, playCaption, shortDesc, weekName } from './labels'

const plays = [
  makePlay({ playId: 1, involved: [], offensePlayers: ['wr1'], defensePlayers: ['cb1'] }),
  makePlay({ playId: 2, offensePlayers: ['wr2'], defensePlayers: ['cb1'], involved: ['wr1'] }),
  makePlay({ playId: 3, involved: [], posteam: 'DAL', defteam: 'PHI', offensePlayers: ['x'], defensePlayers: ['lb1'] }),
  makePlay({ playId: 4, involved: [], special: true, isPass: false, playType: 'punt', offensePlayers: ['p1'], defensePlayers: ['r1'] }),
  makePlay({ playId: 5, involved: [], offensePlayers: [], defensePlayers: [] })
]

describe('focusSnaps', () => {
  it('uses lineups, plus credited plays and plays with an entry', () => {
    const wr = { id: 'wr1', group: 'WR' as const }
    expect(focusSnaps(wr, 'PHI', plays, [], true).map((p) => p.playId)).toEqual([1, 2])
    const entries = [makeEntry({ playId: 5, playerId: 'wr1' })]
    expect(focusSnaps(wr, 'PHI', [...plays].reverse(), entries, true).map((p) => p.playId)).toEqual([1, 2, 5])
  })
  it('falls back to every snap of the player’s side without lineups', () => {
    expect(focusSnaps({ id: 'wr1', group: 'WR' }, 'PHI', plays, [], false).map((p) => p.playId)).toEqual([1, 2, 5])
    expect(focusSnaps({ id: 'lb1', group: 'LB' }, 'PHI', plays, [], false).map((p) => p.playId)).toEqual([3])
    expect(focusSnaps({ id: 'k1', group: 'ST' }, 'PHI', plays, [], false).map((p) => p.playId)).toEqual([4])
  })
  it('leaves Not on Field snaps out of the progress total', () => {
    const snaps = plays.slice(0, 3)
    const entries = [makeEntry({ playId: 1, playerId: 'wr1', grade: 1 }), makeEntry({ playId: 2, playerId: 'wr1', grade: null, offField: true }), makeEntry({ playId: 9, playerId: 'wr1' })]
    expect(focusProgress('wr1', snaps, entries)).toEqual({ graded: 1, total: 2, offField: 1 })
  })
})

describe('labels', () => {
  it('personnel', () => {
    expect(personnelLabel('1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR')).toBe('11 personnel')
    expect(personnelLabel('6 OL, 1 RB, 2 TE, 1 WR')).toBe('12 personnel (6 OL)')
    expect(personnelLabel('weird')).toBe('weird')
    expect(defPersonnelLabel('4 DL, 2 LB, 5 DB')).toBe('Nickel')
    expect(defPersonnelLabel('2 CB, 2 S, 4 DL, 3 LB')).toBe('Base')
    expect(defPersonnelLabel('3 DL, 1 LB, 7 DB')).toBe('Quarter')
    expect(defPersonnelLabel('5 DL, 3 LB, 3 DB')).toBe('Heavy')
    expect(defPersonnelShape('4 DL, 2 LB, 5 DB')).toBe('4–2–5')
  })
  it('enums, weeks and captions', () => {
    expect(enumLabel('COVER_3')).toBe('Cover 3')
    expect(enumLabel('MAN_COVERAGE')).toBe('Man')
    expect(enumLabel('UNDER CENTER')).toBe('Under center')
    expect(weekName({ week: 20, gameType: 'DIV' })).toBe('Divisional')
    const game = makeGame()
    expect(gameLabel(game, 'PHI')).toBe('Wk 1 vs DAL')
    expect(gameLabel(game, 'DAL')).toBe('Wk 1 @ PHI')
    expect(downDistance(makePlay({ down: 1, ydstogo: 4, yardline100: 4 }))).toBe('1st & Goal')
    expect(playCaption(game, 'PHI', makePlay({ qtr: 1, time: '06:41', down: 3, ydstogo: 7 }))).toBe('Wk 1 vs DAL · Q1 06:41 · 3rd & 7')
    expect(playCaption(game, 'PHI', makePlay({ qtr: 5, time: '08:00', down: null }))).toBe('Wk 1 vs DAL · OT 08:00')
    expect(shortDesc('(6:41) (Shotgun) D.Prescott pass short right')).toBe('D.Prescott pass short right')
    expect([9, 192, 3725].map(durationLabel)).toEqual(['0:09', '3:12', '1:02:05'])
  })
})
