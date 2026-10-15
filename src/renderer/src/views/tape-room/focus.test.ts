import { describe, expect, it } from 'vitest'
import { focusProgress, focusSnaps } from './focus'
import { entry, play } from './testPlays'

const cb = { id: 'cb', group: 'DB' as const }
const wr = { id: 'wr', group: 'WR' as const }
const k = { id: 'k', group: 'ST' as const }

const plays = [
  play({ playId: 1, posteam: 'PHI', defteam: 'DAL', offensePlayers: ['wr'] }),
  play({ playId: 2, posteam: 'DAL', defteam: 'PHI', defensePlayers: ['cb'] }),
  play({ playId: 3, posteam: 'DAL', defteam: 'PHI', defensePlayers: ['x'] }),
  play({ playId: 4, posteam: 'PHI', defteam: 'DAL', special: true, playType: 'punt' }),
  play({ playId: 5, posteam: 'PHI', defteam: 'DAL', involved: ['cb'] })
]

describe('focusSnaps (02 §9.3)', () => {
  it('with lineups: the plays the player is listed on, plus credited plays', () => {
    expect(focusSnaps(cb, 'PHI', plays, [], true).map((p) => p.playId)).toEqual([2, 5])
    expect(focusSnaps(wr, 'PHI', plays, [], true).map((p) => p.playId)).toEqual([1])
  })

  it('without lineups: every snap of the player’s side', () => {
    const bare = plays.map((p) => ({ ...p, offensePlayers: [], defensePlayers: [] }))
    expect(focusSnaps(cb, 'PHI', bare, [], false).map((p) => p.playId)).toEqual([2, 3, 5])
    expect(focusSnaps(wr, 'PHI', bare, [], false).map((p) => p.playId)).toEqual([1, 5])
  })

  it('special teams players get special teams snaps', () => {
    expect(focusSnaps(k, 'PHI', plays, [], false).map((p) => p.playId)).toEqual([4])
  })

  it('adds plays where the player has an entry, in game order', () => {
    expect(focusSnaps(wr, 'PHI', plays, [entry(3, 'wr', { note: 'motion' })], true).map((p) => p.playId)).toEqual([1, 3])
  })
})

describe('focusProgress', () => {
  it('leaves Not on Field snaps out of the total', () => {
    const snaps = plays.slice(0, 4)
    const entries = [entry(1, 'cb', { grade: 1 }), entry(2, 'cb', { offField: true }), entry(3, 'cb', { grade: 0 }), entry(9, 'cb', { grade: 1 })]
    expect(focusProgress('cb', snaps, entries)).toEqual({ graded: 2, total: 3, offField: 1 })
  })
})
