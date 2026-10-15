import { describe, expect, it } from 'vitest'
import type { Shape } from '@shared/drawing'
import type { ExportPart, ExportSegment } from '@shared/exportVideo'
import { drawingIntervals, wrap } from './overlays'

const part = (over: Partial<ExportPart> = {}): ExportPart => ({
  clipId: 1,
  path: '/clip.mp4',
  angle: 'sideline',
  in: 0,
  out: 10,
  rect: { x: 0, y: 0, w: 1920, h: 1080 },
  duration: 10,
  fps: 30,
  hasAudio: false,
  ...over
})
const seg = (parts: ExportPart[], duration = 10): ExportSegment => ({ index: 0, ref: { gameId: 'g', playId: 1 }, number: 1, parts, layout: 'single', duration, caption: '' })
const box = (id: string, start: number, duration: number | null): Shape => ({ id, kind: 'box', color: '#FFD60A', width: 4, start, duration, x: 0.1, y: 0.1, w: 0.2, h: 0.2 })

describe('drawingIntervals', () => {
  it('returns nothing without shapes', () => {
    expect(drawingIntervals(seg([part()]), null, 30)).toEqual([])
    expect(drawingIntervals(seg([part()]), { sideline: [] }, 30)).toEqual([])
  })

  it('cuts at shape starts and ends in segment-local time', () => {
    const out = drawingIntervals(seg([part({ in: 2, out: 12 })]), { sideline: [box('a', 4, 2), box('b', 5, null)] }, 30)
    expect(out.map((i) => [i.from, i.to, i.shapes[0].map((s) => s.id).join(',')])).toEqual([
      [2, 3, 'a'],
      [3, 4, 'a,b'],
      [4, 10, 'b']
    ])
  })

  it('merges the shortest intervals past the cap', () => {
    const shapes = Array.from({ length: 10 }, (_, i) => box(`s${i}`, i, 0.5))
    const out = drawingIntervals(seg([part()]), { sideline: shapes }, 30, 4)
    expect(out).toHaveLength(4)
    expect(out[0].from).toBe(0)
    for (let i = 1; i < out.length; i++) expect(out[i].from).toBeGreaterThanOrEqual(out[i - 1].to - 1e-9)
  })

  it('ignores shapes on angles not in the segment', () => {
    expect(drawingIntervals(seg([part()]), { endzone: [box('a', 1, 1)] }, 30)).toEqual([])
  })
})

describe('wrap', () => {
  const measure = (s: string) => s.length * 10
  it('wraps words into lines', () => {
    expect(wrap(measure, 'one two three four', 90, 3)).toEqual(['one two', 'three', 'four'])
  })
  it('ends a cut text with an ellipsis', () => {
    const out = wrap(measure, 'one two three four five six', 90, 2)
    expect(out).toHaveLength(2)
    expect(out[1].endsWith('…')).toBe(true)
    expect(measure(out[1])).toBeLessThanOrEqual(90)
  })
  it('shortens a single long word', () => {
    const out = wrap(measure, 'extraordinarily', 60, 1)
    expect(out[0].endsWith('…')).toBe(true)
    expect(measure(out[0])).toBeLessThanOrEqual(60)
  })
})
