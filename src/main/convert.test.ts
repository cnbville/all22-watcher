import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectAngle } from '@shared/matching'
import { convertClips, convertedPath, findFfmpeg } from './convert'

describe('convertedPath', () => {
  it('keeps the angle folder and swaps the extension', () => {
    const out = convertedPath('/film/DAL at PHI/End Zone/Play 7.mkv', '/data/converted/g')
    expect(out).toBe('/data/converted/g/End Zone/Play 7.mp4')
    expect(detectAngle(out)).toBe('endzone')
  })
})

const ffmpeg = findFfmpeg()

describe.skipIf(!ffmpeg)('convertClips', () => {
  it('remuxes an MKV into a playable MP4', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-conv-'))
    await mkdir(join(dir, 'Sideline'))
    const input = join(dir, 'Sideline', 'Play 1.mkv')
    execFileSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=1', '-c:v', 'libx264', input])
    const { converted, failed } = await convertClips(ffmpeg!, [input, join(dir, 'missing.avi')], join(dir, 'out'))
    expect(converted).toEqual([join(dir, 'out', 'Sideline', 'Play 1.mp4')])
    expect(existsSync(converted[0])).toBe(true)
    expect(failed.map((f) => f.path)).toEqual([join(dir, 'missing.avi')])
  })
})
