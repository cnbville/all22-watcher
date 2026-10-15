import { describe, expect, it } from 'vitest'
import { teamMark } from './teamMark'

describe('teamMark', () => {
  it('lifts dark team colors until they read on graphite', () => {
    expect(teamMark('#00338D')).toBe('#2254B1') // BUF
    expect(teamMark('#004C54')).toBe('#1E6068') // PHI
    expect(teamMark('#000000')).toBe('#585858') // LV
  })

  it('keeps colors that already read', () => {
    expect(teamMark('#008E97')).toBe('#008E97') // MIA
  })
})
