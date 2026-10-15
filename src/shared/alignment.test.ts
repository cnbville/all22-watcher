import { describe, expect, it } from 'vitest'
import { type AlignmentClip, checkAlignment, expectedDuration } from './alignment'
import { makePlay } from './fixtures'
import type { Angle, Play } from './types'

// A game's plays: mostly runs and passes of varied length, with a punt and a kickoff return TD among them.
const kinds: Partial<Play>[] = [
  { playType: 'kickoff', special: true, isPass: false, yardsGained: 25 },
  { playType: 'run', isPass: false, isRush: true, yardsGained: 2 },
  { playType: 'pass', yardsGained: 45 },
  { playType: 'run', isPass: false, isRush: true, yardsGained: 1 },
  { playType: 'pass', yardsGained: 0, sack: true },
  { playType: 'punt', special: true, isPass: false, yardsGained: 0 },
  { playType: 'run', isPass: false, isRush: true, yardsGained: 4 },
  { playType: 'pass', yardsGained: 12 },
  { playType: 'qb_spike', isPass: false, yardsGained: 0 },
  { playType: 'pass', yardsGained: 30 },
  { playType: 'run', isPass: false, isRush: true, yardsGained: 3 },
  { playType: 'qb_kneel', isPass: false, isRush: true, yardsGained: -1 },
  { playType: 'kickoff', special: true, isPass: false, yardsGained: 100, touchdown: true },
  { playType: 'run', isPass: false, isRush: true, yardsGained: 6 }
]
const plays = kinds.map((k, i) => makePlay({ playId: (i + 1) * 10, ...k }))

const clipsFor = (angle: Angle, durations: number[], playIds = plays.map((p) => p.playId)): AlignmentClip[] =>
  durations.map((d, i) => ({ clipId: null, path: `/${angle}/Play ${i + 1}.mp4`, angle, playId: playIds[i] ?? null, duration: d }))
const exact = plays.map(expectedDuration)

describe('expectedDuration', () => {
  it('follows the kind of play', () => {
    expect(expectedDuration(makePlay({ playType: 'qb_kneel' }))).toBeLessThan(expectedDuration(makePlay({ playType: 'run', yardsGained: 2 })))
    expect(expectedDuration(makePlay({ playType: 'pass', yardsGained: 50 }))).toBeGreaterThan(expectedDuration(makePlay({ playType: 'pass', yardsGained: 0 })))
    expect(expectedDuration(makePlay({ playType: 'punt', touchdown: true }))).toBeGreaterThan(expectedDuration(makePlay({ playType: 'punt' })))
  })
})

describe('checkAlignment', () => {
  it('passes a well-matched game', () => {
    const r = checkAlignment('g', [...clipsFor('sideline', exact), ...clipsFor('endzone', exact.map((d) => d + 0.3))], plays)
    expect(r).toMatchObject({ gameId: 'g', checked: 28, unknown: 0, suspects: [] })
  })

  it('finds a clip on the wrong play from the other angle', () => {
    const ez = exact.map((d) => d + 0.2)
    // The end zone clip of play 30 (a 45-yard pass) was matched to play 40 (a 1-yard run), and vice versa.
    ;[ez[2], ez[3]] = [ez[3], ez[2]]
    const r = checkAlignment('g', [...clipsFor('sideline', exact), ...clipsFor('endzone', ez)], plays)
    const bad = r.suspects.filter((s) => s.reason === 'angleMismatch')
    expect(bad.map((s) => [s.angle, s.playId])).toEqual([
      ['endzone', 30],
      ['endzone', 40]
    ])
    expect(bad[0].betterPlayId).toBe(40)
    expect(bad[0].message).toMatch(/Check the match\.$/)
  })

  it('finds a shifted run after a missing clip', () => {
    // Clip for play 60 is missing, so every later clip sits one play early.
    const durations = [...exact.slice(0, 5), ...exact.slice(6)]
    const ids = plays.map((p) => p.playId).slice(0, durations.length)
    const r = checkAlignment('g', clipsFor('sideline', durations, ids), plays)
    const shifted = r.suspects.filter((s) => s.reason === 'shifted')
    expect(shifted.length).toBeGreaterThan(0)
    expect(shifted.every((s) => s.playId >= 50)).toBe(true)
    expect(shifted[0].message).toMatch(/next play better/)
  })

  it('flags clips far too short or long on their own', () => {
    const d = [...exact]
    d[12] = 2 // the kickoff return TD
    d[11] = 16 // the kneel
    const r = checkAlignment('g', clipsFor('sideline', d), plays)
    expect(r.suspects.map((s) => [s.playId, s.reason])).toEqual([
      [120, 'tooLong'],
      [130, 'tooShort']
    ])
    expect(r.suspects[1]).toMatchObject({ clipDuration: 2, expected: expectedDuration(plays[12]) })
  })

  it('counts clips whose length couldn’t be read and skips unmatched clips', () => {
    const clips = clipsFor('sideline', exact)
    clips[0].duration = null
    clips[1].playId = null
    const r = checkAlignment('g', clips, plays)
    expect(r.unknown).toBe(1)
    expect(r.checked).toBe(12)
  })
})
