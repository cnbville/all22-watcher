import { describe, expect, it } from 'vitest'
import { clipStartTime } from './snap'

describe('clipStartTime', () => {
  const on = { startAtSnap: true, preRoll: 1 }
  it('starts at 0 without a snap point', () => expect(clipStartTime({ snapMs: null }, on)).toBe(0))
  it('starts a pre-roll before the snap', () => expect(clipStartTime({ snapMs: 1800 }, on)).toBeCloseTo(0.8))
  it('never starts before the clip', () => expect(clipStartTime({ snapMs: 400 }, on)).toBe(0))
  it('starts at 0 when start at snap is off', () => expect(clipStartTime({ snapMs: 1800 }, { ...on, startAtSnap: false })).toBe(0))
})
