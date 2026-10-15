import { describe, expect, it, vi } from 'vitest'
import { migrateDrawing, packLane, type Shape, shapeVisibleAt, visibilityBreaks } from './drawing'

const box = (id: string, start: number, duration: number | null): Shape => ({
  id, kind: 'box', color: '#FFD60A', width: 4, start, duration, x: 0.1, y: 0.1, w: 0.2, h: 0.2
})

describe('migrateDrawing', () => {
  it('turns v1 strokes into arrowed pen shapes shown for the whole clip', () => {
    const out = migrateDrawing({ sideline: [{ color: '#FF4D4D', width: 3, points: [[0.1, 0.2], [0.3, 0.4]] }] })
    expect(out.sideline).toEqual([
      { id: 'v1-0', kind: 'pen', color: '#FF4D4D', width: 3, points: [[0.1, 0.2], [0.3, 0.4]], end: 'arrow', start: 0, duration: null }
    ])
  })

  it('reads JSON text and keeps current shapes as they are', () => {
    const shape = box('ab12cd34', 1.5, 2)
    expect(migrateDrawing(JSON.stringify({ endzone: [shape] }))).toEqual({ endzone: [shape] })
  })

  it('drops unknown kinds and malformed shapes without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = migrateDrawing({
      main: [{ kind: 'hologram', color: '#fff', width: 2, start: 0, duration: null }, { kind: 'box', color: '#fff', width: 2, x: 'a' }, box('ok', 0, null)],
      sideline: 'nonsense'
    })
    expect(out).toEqual({ main: [box('ok', 0, null)] })
    expect(migrateDrawing('not json')).toEqual({})
    expect(migrateDrawing(null)).toEqual({})
    warn.mockRestore()
  })
})

describe('shapeVisibleAt', () => {
  it.each([30, 30000 / 1001 * 2])('shows a This Frame Only shape on exactly one frame at %d fps', (fps) => {
    const frame = 1 / fps
    const start = 37 * frame
    const s = box('f', start, frame)
    expect(shapeVisibleAt(s, start, frame)).toBe(true)
    expect(shapeVisibleAt(s, start - frame, frame)).toBe(false)
    expect(shapeVisibleAt(s, start + frame, frame)).toBe(false)
    // Slightly off the frame time still counts as that frame.
    expect(shapeVisibleAt(s, start - frame * 0.4, frame)).toBe(true)
  })

  it('keeps an until-end shape visible to the end', () => {
    expect(shapeVisibleAt(box('e', 2, null), 100, 1 / 30)).toBe(true)
    expect(shapeVisibleAt(box('e', 2, null), 1.9, 1 / 30)).toBe(false)
  })
})

describe('packLane', () => {
  it('packs spans into the first free row in start order', () => {
    const out = packLane([box('c', 3, 1), box('a', 0, 2), box('b', 1, 1), box('d', 2.5, null)], 6, 3)
    expect(out.map((r) => [r.shape.id, r.row, !!r.hidden])).toEqual([
      ['a', 0, false],
      ['b', 1, false],
      ['d', 0, false],
      ['c', 1, false]
    ])
  })

  it('puts overflow in the last row, marked hidden', () => {
    const out = packLane([box('a', 0, null), box('b', 0, null), box('c', 0, null)], 5, 2)
    expect(out.map((r) => [r.row, !!r.hidden])).toEqual([[0, false], [1, false], [1, true]])
  })
})

describe('visibilityBreaks', () => {
  it('cuts a range at shape starts and ends', () => {
    expect(visibilityBreaks([box('a', 1, 2), box('b', 0, null)], 0.5, 4, 6)).toEqual([0.5, 1, 3])
  })
})
