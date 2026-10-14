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

  it('finds the angle in a folder further up, nearest name first, matching whole words', () => {
    expect(detectAngle('/g/Sideline/Q1/001.mp4')).toBe('sideline')
    expect(detectAngle('/g/End Zone/1st Half/Q2/001.mp4')).toBe('endzone')
    expect(detectAngle('/Users/ez/Film/Sideline/001.mp4')).toBe('sideline')
    expect(detectAngle('/g/Wide/001.mp4')).toBe('sideline')
    expect(detectAngle('/g/Endzone2/001.mp4')).toBe('endzone')
    expect(detectAngle('/g/Inside Linebackers/001.mp4')).toBe('main')
    expect(detectAngle('/g/Game/FG 47 No Good, Wide Right.mp4')).toBe('main')
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

  it('keeps nested angle folders apart', () => {
    const files = ['Sideline', 'End Zone'].flatMap((a) => ['1st Half', '2nd Half'].map((h) => `/g/${a}/${h}/001.mp4`))
    const r = matchClips(files, plays, { includeSpecialTeams: false, includeNoPlays: false })
    expect(r.rows.map((x) => [x.path.slice(3), x.angle, x.playId])).toEqual([
      ['Sideline/1st Half/001.mp4', 'sideline', 71],
      ['Sideline/2nd Half/001.mp4', 'sideline', 112],
      ['End Zone/1st Half/001.mp4', 'endzone', 71],
      ['End Zone/2nd Half/001.mp4', 'endzone', 112]
    ])
  })

  it('keeps folders together when each one restarts its numbering', () => {
    const files = ['Q2', 'Q1'].flatMap((q) => ['2.mp4', '1.mp4'].map((f) => `/g/${q}/${f}`))
    const r = matchClips(files, plays, { includeSpecialTeams: false, includeNoPlays: false })
    expect(r.rows.map((x) => [x.path.slice(3), x.playId])).toEqual([['Q1/1.mp4', 71], ['Q1/2.mp4', 112], ['Q2/1.mp4', 166], ['Q2/2.mp4', 188]])
    expect(r.warnings).toEqual([])

    // A converted copy (kept under its source folder's name) sorts next to its original's neighbours.
    const mixed = matchClips(['/g/Q1/1.mp4', '/conv/ab12cd34/Q1/2.mkv.mp4', '/g/Q1/3.mp4', '/g/Q2/1.mp4'], plays, { includeSpecialTeams: false, includeNoPlays: false })
    expect(mixed.rows.map((x) => x.fileName)).toEqual(['1.mp4', '2.mkv.mp4', '3.mp4', '1.mp4'])
  })

  it('shifts later clips when one is missing', () => {
    const ordered = filmablePlays(plays, false, false)
    const r = matchClips(['/1.mp4', '/2.mp4', '/3.mp4'], plays, { includeSpecialTeams: false, includeNoPlays: false })
    const shifted = shiftMatches(r.rows, 1, 1, ordered)
    expect(shifted.map((x) => x.playId)).toEqual([71, 166, 188])
  })

  it('brings clips that ran off the end back when sliding earlier', () => {
    const ordered = filmablePlays(plays, false, false)
    const five = matchClips(['/1.mp4', '/2.mp4', '/3.mp4', '/4.mp4', '/5.mp4'], plays, { includeSpecialTeams: false, includeNoPlays: false })
    expect(five.rows.map((x) => x.playId)).toEqual([71, 112, 166, 188, null])
    // Clip 2 is extra: sliding from there links the last clip to the last play.
    expect(shiftMatches(five.rows, 1, -1, ordered).map((x) => x.playId)).toEqual([71, 71, 112, 166, 188])

    const four = matchClips(['/1.mp4', '/2.mp4', '/3.mp4', '/4.mp4'], plays, { includeSpecialTeams: false, includeNoPlays: false }).rows
    const down = shiftMatches(four, 0, 1, ordered)
    expect(down.map((x) => x.playId)).toEqual([112, 166, 188, null])
    expect(shiftMatches(down, 0, -1, ordered)).toEqual(four)

    // A clip marked "skip" mid-list stays skipped.
    const skipped = four.map((x, i) => (i === 2 ? { ...x, playId: null } : x))
    expect(shiftMatches(skipped, 0, -1, ordered).map((x) => x.playId)).toEqual([null, 71, null, 166])
  })
})
