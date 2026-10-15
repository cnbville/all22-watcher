import { describe, expect, it } from 'vitest'
import { emptyTally } from '@shared/stats'
import type { GradeTally } from '@shared/types'
import { axisNumber } from './charts/base'
import { beeswarm } from './charts/GradeEpaStrip'
import { tierOf, tierSummaries } from './charts/OpponentScatter'
import { letterbox } from './reel/drawShapes'
import { sampleTone, smallSampleTip } from './SampleGrade'

const tally = (plus: number, zero: number, minus: number): GradeTally => ({ ...emptyTally(), graded: plus + zero + minus, plus, zero, minus })

describe('sample sizes (03 §2.4)', () => {
  it('greys grades from fewer than 5 plays', () => {
    expect(sampleTone(0)).toBe('none')
    expect(sampleTone(1)).toBe('small')
    expect(sampleTone(4)).toBe('small')
    expect(sampleTone(5)).toBe('full')
    expect(smallSampleTip(3)).toBe('Only 3 graded plays, too few to read much into.')
    expect(smallSampleTip(1)).toBe('Only 1 graded play, too few to read much into.')
  })
})

describe('opponent tiers (03 §2.8.4)', () => {
  it('splits ranks 1–10, 11–22, 23–32', () => {
    expect([1, 10, 11, 22, 23, 32].map(tierOf)).toEqual(['top', 'top', 'middle', 'middle', 'bottom', 'bottom'])
  })
  it('pools every graded play in a tier through the grade', () => {
    const rows = tierSummaries([
      { rank: 3, tally: tally(4, 0, 0) },
      { rank: 8, tally: tally(0, 0, 4) },
      { rank: 15, tally: tally(2, 2, 0) },
      { rank: null, tally: tally(9, 0, 0) }
    ])
    expect(rows.map((r) => [r.tier, r.games, r.tally.graded])).toEqual([
      ['top', 2, 8],
      ['middle', 1, 4],
      ['bottom', 0, 0]
    ])
    expect(rows[0].score).toBe(50)
    expect(rows[2].score).toBeNull()
  })
})

describe('chart helpers', () => {
  it('writes signed ticks with a true minus', () => {
    expect([-4, -0.5, 0, 2].map(axisNumber)).toEqual(['−4', '−0.5', '0', '+2'])
  })
  it('spreads close points and leaves lone points on the lane line', () => {
    expect(beeswarm([0, 100])).toEqual([0, 0])
    const offsets = beeswarm([10, 11, 12])
    expect(new Set(offsets).size).toBe(3)
    expect(offsets.every((o) => Math.abs(o) <= 21)).toBe(true)
  })
  it('letterboxes the picture inside the stage', () => {
    expect(letterbox(800, 450, 1280, 720)).toEqual({ x: 0, y: 0, w: 800, h: 450 })
    expect(letterbox(800, 600, 1280, 720)).toEqual({ x: 0, y: 75, w: 800, h: 450 })
    expect(letterbox(400, 300, 0, 0)).toEqual({ x: 0, y: 0, w: 400, h: 300 })
  })
})
