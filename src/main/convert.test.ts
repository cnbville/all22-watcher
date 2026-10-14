import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectAngle } from '@shared/matching'
import { convertClips, convertedPath, findFfmpeg } from './convert'

describe('convertedPath', () => {
  it('keeps the angle folder so angle detection still works', () => {
    const out = convertedPath('/film/DAL at PHI/End Zone/Play 7.mkv', '/data/converted/g')
    expect(out).toMatch(/^\/data\/converted\/g\/[0-9a-f]{8}\/End Zone\/Play 7\.mkv\.mp4$/)
    expect(detectAngle(out)).toBe('endzone')
  })

  it('never maps two source clips to the same copy', () => {
    const outs = ['/a/Sideline/Play 1.mkv', '/a/Sideline/Play 1.avi', '/b/Sideline/Play 1.mkv'].map((p) => convertedPath(p, '/out'))
    expect(new Set(outs).size).toBe(3)
  })
})

const ffmpeg = findFfmpeg()

describe.skipIf(!ffmpeg)('convertClips', () => {
  it('copies H.264 from an MKV and re-encodes other codecs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-conv-'))
    await mkdir(join(dir, 'Sideline'))
    const input = join(dir, 'Sideline', 'Play 1.mkv')
    const mpeg4 = join(dir, 'Sideline', 'Play 2.avi')
    execFileSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=1', '-c:v', 'libx264', input])
    execFileSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=1', '-c:v', 'mpeg4', mpeg4])
    const out = join(dir, 'out')
    const { converted, failed } = await convertClips(ffmpeg!, [input, mpeg4, join(dir, 'missing.avi')], out)
    expect(converted).toEqual([convertedPath(input, out), convertedPath(mpeg4, out)])
    expect(converted.every((f) => existsSync(f))).toBe(true)
    expect(failed.map((f) => f.path)).toEqual([join(dir, 'missing.avi')])
    expect(existsSync(`${convertedPath(join(dir, 'missing.avi'), out)}.partial.mp4`)).toBe(false)
    const codec = (f: string) =>
      execFileSync(ffmpeg!.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f]).toString().trim()
    expect(codec(converted[1])).toBe('h264')
  })
})
