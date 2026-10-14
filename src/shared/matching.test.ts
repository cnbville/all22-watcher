import { describe, expect, it } from 'vitest'
import { detectAngle, filmablePlays, matchClips, naturalCompare, shiftMatches } from './matching'
import type { Play } from './types'

const play = (playId: number, playType: string): Play =>
  ({ playId, playType, gameId: 'g' }) as Play

const plays = [
  play(1, ''), play(40, 'kickoff'), play(71, 'run'), play(112, 'pass'), play(141, 'no_play'),
  play(166, 'run'), play(188, 'pass'), play(200, 'extra_point'), play(210, 'punt')
]

describe('matching', () => {
  it('sorts file names the way people number them', () => {
    expect(['play 10.mp4', 'play 2.mp4', 'play 1.mp4'].sort(naturalCompare)).toEqual(['play 1.mp4', 'play 2.mp4', 'play 10.mp4'])
  })

  it('detects camera angles from names and folders', () => {
    expect(detectAngle('/film/Q1_0412_EZ.mp4')).toBe('endzone')
    expect(detectAngle('/film/End Zone/001.mp4')).toBe('endzone')
    expect(detectAngle('/film/sideline/001.mp4')).toBe('sideline')
    expect(detectAngle('/film/SL - 12.mov')).toBe('sideline')
    expect(detectAngle('/film/week1/001.mp4')).toBe('main')
  })

  it('filters plays that get clips', () => {
    expect(filmablePlays(plays, false, false).map((p) => p.playId)).toEqual([71, 112, 166, 188])
    expect(filmablePlays(plays, true, true)).toHaveLength(8)
  })

  it('guesses whether special teams were cut from the clip count', () => {
    const fourClips = ['4.mp4', '1.mp4', '3.mp4', '2.mp4'].map((f) => `/x/${f}`)
    const r = matchClips(fourClips, plays)
    expect(r.includeSpecialTeams).toBe(false)
    expect(r.includeNoPlays).toBe(false)
    expect(r.rows.map((x) => [x.fileName, x.playId])).toEqual([['1.mp4', 71], ['2.mp4', 112], ['3.mp4', 166], ['4.mp4', 188]])
    expect(r.warnings).toEqual([])

    const eight = Array.from({ length: 8 }, (_, i) => `/x/${i + 1}.mp4`)
    expect(matchClips(eight, plays).includeSpecialTeams).toBe(true)
  })

  it('matches each angle separately', () => {
    const files = ['/g/EZ/1.mp4', '/g/EZ/2.mp4', '/g/SL/1.mp4', '/g/SL/2.mp4']
    const r = matchClips(files, plays, { includeSpecialTeams: false, includeNoPlays: false })
    expect(r.rows.filter((x) => x.angle === 'endzone').map((x) => x.playId)).toEqual([71, 112])
    expect(r.rows.filter((x) => x.angle === 'sideline').map((x) => x.playId)).toEqual([71, 112])
    expect(r.warnings).toHaveLength(2)
  })

  it('shifts later clips when one is missing', () => {
    const ordered = filmablePlays(plays, false, false)
    const r = matchClips(['/1.mp4', '/2.mp4', '/3.mp4'], plays, { includeSpecialTeams: false, includeNoPlays: false })
    const shifted = shiftMatches(r.rows, 1, 1, ordered)
    expect(shifted.map((x) => x.playId)).toEqual([71, 166, 188])
  })
})
