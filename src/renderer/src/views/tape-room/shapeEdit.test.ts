import { describe, expect, it } from 'vitest'
import type { Shape } from '@shared/drawing'
import { bigEnough, dragBox, hitTest, resizeShape, simplify, snap45 } from './shapeEdit'

const px = { w: 800, h: 450 }
const base = { color: '#FFD60A', width: 4, start: 0, duration: null }

describe('drawing geometry (02 §11.3–§11.5)', () => {
  it('drag boxes: ⇧ squares in pixels, ⌥ draws from the center', () => {
    const b = dragBox([0.5, 0.5], [0.6, 0.6], px, {})
    expect(b.x).toBeCloseTo(0.5)
    expect(b.w).toBeCloseTo(0.1)
    const sq = dragBox([0.5, 0.5], [0.6, 0.55], px, { shift: true })
    expect(Math.round(sq.w * px.w)).toBe(Math.round(sq.h * px.h))
    const c = dragBox([0.5, 0.5], [0.6, 0.6], px, { alt: true })
    expect(c.x).toBeCloseTo(0.4)
    expect(c.w).toBeCloseTo(0.2)
  })
  it('snaps line ends to 45°', () => {
    const [x, y] = snap45([0, 0], [0.1, 0.01], px)
    expect(y).toBeCloseTo(0)
    expect(x).toBeGreaterThan(0)
  })
  it('enforces the minimums', () => {
    expect(bigEnough({ ...base, id: 'a', kind: 'box', x: 0, y: 0, w: 5 / 800, h: 0.1 }, px)).toBe(false)
    expect(bigEnough({ ...base, id: 'a', kind: 'box', x: 0, y: 0, w: 7 / 800, h: 7 / 450 }, px)).toBe(true)
    expect(bigEnough({ ...base, id: 'a', kind: 'spotlight', x: 0, y: 0, w: 10 / 800, h: 0.1 }, px)).toBe(false)
    expect(bigEnough({ ...base, id: 'a', kind: 'line', from: [0, 0], to: [5 / 800, 0], end: 'none' }, px)).toBe(false)
  })
  it('hit tests topmost first: box outlines, filled spotlights', () => {
    const shapes: Shape[] = [
      { ...base, id: 'spot', kind: 'spotlight', x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
      { ...base, id: 'box', kind: 'box', x: 0.45, y: 0.45, w: 0.1, h: 0.1 }
    ]
    expect(hitTest(shapes, [0.45, 0.5], px)?.id).toBe('box')
    expect(hitTest(shapes, [0.5, 0.5], px)?.id).toBe('spot')
    expect(hitTest(shapes, [0.1, 0.1], px)).toBeNull()
  })
  it('resizes from a corner and keeps proportions with ⇧', () => {
    const b: Shape = { ...base, id: 'b', kind: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
    expect(resizeShape(b, 'se', [0.4, 0.5], px, {})).toMatchObject({ x: 0.1, y: 0.1 })
    const r = resizeShape(b, 'se', [0.5, 0.35], px, { shift: true }) as Extract<Shape, { x: number; w: number }>
    expect((r.w * px.w) / (r.h * px.h)).toBeCloseTo((0.2 * px.w) / (0.2 * px.h))
  })
  it('simplifies pen points', () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.5, 0.0005],
      [1, 0]
    ]
    expect(simplify(pts)).toEqual([
      [0, 0],
      [1, 0]
    ])
  })
})
