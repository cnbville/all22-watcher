import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseShowinfo, planPlays, shotsFromCuts } from '@shared/splitPlan'
import { findFfmpeg, probe } from './ffmpeg'
import { splitGame } from './splitGame'

describe('split plan', () => {
  it('merges flashes into the shot before them', () => {
    expect(shotsFromCuts([5, 5.3, 11], 16)).toEqual([
      { start: 0, end: 5.3 },
      { start: 5.3, end: 11 },
      { start: 11, end: 16 }
    ])
    expect(shotsFromCuts([0.4, 6], 12)).toEqual([
      { start: 0, end: 6 },
      { start: 6, end: 12 }
    ])
  })

  it('pairs a play’s sideline and end zone shots by length', () => {
    // A title card, then three plays shown twice each.
    const lengths = [3, 6, 6.3, 11, 10.6, 4.8, 5]
    const cuts = lengths.slice(0, -1).reduce<number[]>((acc, l) => [...acc, (acc.at(-1) ?? 0) + l], [])
    const total = lengths.reduce((a, b) => a + b)
    const plan = planPlays(cuts, total)
    expect(plan.map((s) => [s.play, s.angle])).toEqual([
      [1, 'sideline'],
      [2, 'sideline'], [2, 'endzone'],
      [3, 'sideline'], [3, 'endzone'],
      [4, 'sideline'], [4, 'endzone']
    ])
  })

  it('numbers shots one per play when the film has one angle', () => {
    const plan = planPlays([5, 14, 17, 30], 36)
    expect(plan.map((s) => [s.play, s.angle])).toEqual([[1, 'main'], [2, 'main'], [3, 'main'], [4, 'main'], [5, 'main']])
  })

  it('reads cut times from showinfo lines', () => {
    const text = '[Parsed_showinfo_2 @ 0x6000] n:   0 pts:  61440 pts_time:4.8     duration:512\n[Parsed_showinfo_2 @ 0x6000] n:   1 pts: 140800 pts_time:11.0 x\nframe=  1'
    expect(parseShowinfo(text)).toEqual([4.8, 11])
  })
})

const ffmpeg = findFfmpeg()

describe.skipIf(!ffmpeg)('splitting a film', () => {
  const dir = mkdtempSync(join(tmpdir(), 'all22-split-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('cuts a film into one clip per play and angle', async () => {
    // Two plays, each shown from two "angles" (two different test patterns), with a hard cut between shots.
    const shots: [string, number][] = [['testsrc2', 4], ['smptebars', 4.2], ['testsrc2', 6], ['smptebars', 5.8]]
    const input = join(dir, 'DAL at PHI.mp4')
    const inputs = shots.flatMap(([src, d]) => ['-f', 'lavfi', '-i', `${src}=size=320x180:rate=30:duration=${d}`])
    const concat = shots.map((_, i) => `[${i}:v]`).join('') + `concat=n=${shots.length}:v=1:a=0[v]`
    execFileSync(ffmpeg!, ['-y', '-v', 'error', ...inputs, '-filter_complex', concat, '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input])

    const res = await splitGame(ffmpeg!, input, join(dir, 'split'), () => {}, new AbortController().signal)
    expect(res).toMatchObject({ plays: 2, clips: 4, angles: 2 })
    expect(readdirSync(join(res.folder, 'Sideline')).sort()).toEqual(['001.mp4', '002.mp4'])
    expect(readdirSync(join(res.folder, 'End Zone')).sort()).toEqual(['001.mp4', '002.mp4'])
    expect(existsSync(`${res.folder}.partial`)).toBe(false)
    const second = await probe(join(res.folder, 'Sideline', '002.mp4'), ffmpeg)
    expect(second?.duration).toBeGreaterThan(5.5)
    expect(second?.duration).toBeLessThan(6.5)
  }, 60_000)
})
