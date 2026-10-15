import { describe, expect, it } from 'vitest'
import { fill, ink, rankScore, tint } from './heat'

describe('heat scale', () => {
  it('matches the reference ink values', () => {
    expect(ink(0)).toBe('#EF5A5F')
    expect(ink(20)).toBe('#DC7072')
    expect(ink(50)).toBe('#9B9BA4')
    expect(ink(70)).toBe('#79B697')
    expect(ink(100)).toBe('#4FC98C')
  })

  it('matches the reference fill values', () => {
    expect(fill(0)).toBe('#8A3A3E')
    expect(fill(40)).toBe('#64464B')
    expect(fill(50)).toBe('#4A4A52')
    expect(fill(80)).toBe('#396D55')
    expect(fill(100)).toBe('#2C7A55')
  })

  it('tints at 14% and ranks 1st of 32 at the top', () => {
    expect(tint(100)).toBe('rgba(79, 201, 140, 0.14)')
    expect(rankScore(1)).toBe(100)
    expect(rankScore(32)).toBe(0)
  })
})
