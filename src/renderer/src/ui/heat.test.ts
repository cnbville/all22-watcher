import { describe, expect, it } from 'vitest'
import { fill, heatPrint, ink, rankScore, tint } from './heat'

describe('heat scale', () => {
  it('matches the reference ink values', () => {
    expect(ink(0)).toBe('#CF8A80')
    expect(ink(20)).toBe('#BF8C85')
    expect(ink(50)).toBe('#8E8E93')
    expect(ink(70)).toBe('#8AA595')
    expect(ink(100)).toBe('#86B596')
  })

  it('matches the reference fill values', () => {
    expect(fill(0)).toBe('#6E4440')
    expect(fill(40)).toBe('#564648')
    expect(fill(50)).toBe('#46464C')
    expect(fill(80)).toBe('#40584A')
    expect(fill(100)).toBe('#3D5F49')
  })

  it('tints at 14% and ranks 1st of 32 at the top', () => {
    expect(tint(100)).toBe('rgba(134, 181, 150, 0.14)')
    expect(rankScore(1)).toBe(100)
    expect(rankScore(32)).toBe(0)
  })

  it('matches the print reference table (03 §12.2)', () => {
    const scores = [0, 10, 20, 30, 40, 45, 50, 55, 60, 70, 80, 90, 100]
    const inks = ['#C2272F', '#B83739', '#AD4343', '#9F4E4D', '#8E5859', '#815D60', '#66666E', '#596C66', '#526E61', '#45725A', '#387554', '#2A784F', '#167A4A']
    const fills = ['#F0B4B6', '#EDB8BA', '#E9BDBF', '#E5C2C5', '#E0C8CC', '#DCCCD0', '#D4D4D9', '#C7D5D1', '#C1D6CD', '#B6D7C7', '#ADD7C2', '#A5D8BD', '#9ED8B9']
    expect(scores.map((s) => heatPrint.ink(s))).toEqual(inks)
    expect(scores.map((s) => heatPrint.fill(s))).toEqual(fills)
    expect(heatPrint.tint(100)).toBe('rgba(22, 122, 74, 0.12)')
  })
})
