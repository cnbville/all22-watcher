import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectAngle } from '@shared/matching'
import { convertClips, convertedFrom, convertedPath, findConverted, findFfmpeg } from './convert'

/** Stands in for ffmpeg: writes an empty file at the output path, its last argument. */
async function fakeFfmpeg(dir: string): Promise<string> {
  const bin = join(dir, 'ffmpeg')
  await writeFile(bin, '#!/bin/sh\nfor out; do :; done\n: > "$out"\n', { mode: 0o755 })
  return bin
}

describe('convertedPath', () => {
  it('keeps the angle folder so angle detection still works', () => {
    const out = convertedPath('/film/DAL at PHI/End Zone/Play 7.mkv', '/data/converted/g')
    expect(out).toMatch(/^\/data\/converted\/g\/[0-9a-f]{8}\/End Zone\/Play 7\.mkv\.mp4$/)
    expect(detectAngle(out)).toBe('endzone')
  })

  it('keeps folders up to the one that names the angle, so copies are detected like their originals', () => {
    expect(convertedPath('/film/DAL at PHI/Sideline/Q1/Play 7.mkv', '/out')).toMatch(/^\/out\/[0-9a-f]{8}\/Sideline\/Q1\/Play 7\.mkv\.mp4$/)
    const sources = [
      '/film/DAL at PHI/Sideline/Q1/Play 7.mkv',
      '/film/DAL at PHI/End Zone/1st Half/Q2/Play 7.mkv',
      '/film/DAL at PHI/Q1_0412_EZ.mkv',
      '/Users/sl/Movies/DAL at PHI/Play 7.mkv',
      '/film/DAL at PHI/Play 7.mkv'
    ]
    for (const p of sources) expect(detectAngle(convertedPath(p, '/data/converted/2025_01_DAL_PHI'))).toBe(detectAngle(p))
  })

  it('never maps two source clips to the same copy', () => {
    const outs = ['/a/Sideline/Play 1.mkv', '/a/Sideline/Play 1.avi', '/b/Sideline/Play 1.mkv'].map((p) => convertedPath(p, '/out'))
    expect(new Set(outs).size).toBe(3)
  })
})

describe('findConverted', () => {
  it('finds a copy made before the angle folder was kept, and leaves the old path working', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-find-'))
    const out = join(dir, 'out')
    const input = join(dir, 'Film', 'Sideline', 'DAL at PHI', '001.mkv')
    expect(await findConverted(input, out)).toBeNull()

    // Where earlier versions put it: <hash of source folder>/<source folder name>/<file>.mp4
    const hash = createHash('sha1').update(dirname(input)).digest('hex').slice(0, 8)
    const old = join(out, hash, 'DAL at PHI', '001.mkv.mp4')
    await mkdir(dirname(old), { recursive: true })
    await writeFile(old, 'video')
    const found = await findConverted(input, out)
    expect(found).toBe(convertedPath(input, out))
    expect(found).toBe(join(out, hash, 'Sideline', 'DAL at PHI', '001.mkv.mp4'))
    expect(detectAngle(found!)).toBe('sideline')
    expect(readFileSync(found!, 'utf8')).toBe('video')
    expect(existsSync(old)).toBe(true)
    expect(await findConverted(input, out)).toBe(found)

    expect(await findConverted(join(dir, 'Film', 'Sideline', 'DAL at PHI', '002.mkv'), out)).toBeNull()
  })

  it('finds a copy made by a build that kept more of the source folders', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-find-'))
    const out = join(dir, 'out')
    const input = join(dir, 'Film', 'Sideline', 'Wide Angle', 'Q1', '001.mkv')
    // The previous build didn't count "Wide Angle" as an angle name, so it kept every folder up to "Sideline".
    const hash = createHash('sha1').update(dirname(input)).digest('hex').slice(0, 8)
    const old = join(out, hash, 'Sideline', 'Wide Angle', 'Q1', '001.mkv.mp4')
    await mkdir(dirname(old), { recursive: true })
    await writeFile(old, 'video')
    const found = await findConverted(input, out)
    expect(found).toBe(convertedPath(input, out))
    expect(readFileSync(found!, 'utf8')).toBe('video')
    expect(existsSync(old)).toBe(true)

    // A copy of a same-named clip from another folder never stands in.
    expect(await findConverted(join(dir, 'Film', 'End Zone', 'Wide Angle', 'Q1', '001.mkv'), out)).toBeNull()
  })
})

describe('convertedFrom', () => {
  it('traces a copy back to the clip it was made from, whatever folders it sits in', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-from-'))
    const out = join(dir, 'out')
    const inputs = ['All-22', 'Sideline'].map((a) => join(dir, 'Side Projects', 'DAL at PHI', a, '001.mkv'))
    for (const f of inputs) {
      await mkdir(dirname(f), { recursive: true })
      await writeFile(f, '')
    }
    const { converted } = await convertClips(await fakeFfmpeg(dir), inputs, out)
    expect(converted).toEqual(inputs.map((f) => convertedPath(f, out)))
    expect(await Promise.all(converted.map((c) => convertedFrom(c, out)))).toEqual(inputs)
  })

  it('traces copies made before their source was recorded by the clips around them, or once the original is picked again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-from-'))
    const out = join(dir, 'out')
    const game = join(dir, 'Film', 'DAL at PHI')
    const hash = (input: string) => createHash('sha1').update(dirname(input)).digest('hex').slice(0, 8)
    const secondHalf = join(game, 'Sideline', '2nd Half', '1.mkv')
    const endZone = join(game, 'End Zone', '1st Half', '1.mkv')
    // One kept only the clip's own folder, the other every folder up to the angle's.
    const copies = [join(out, hash(secondHalf), '2nd Half', '1.mkv.mp4'), join(out, hash(endZone), 'End Zone', '1st Half', '1.mkv.mp4')]
    for (const c of copies) {
      await mkdir(dirname(c), { recursive: true })
      await writeFile(c, 'video')
    }
    const near = [join(game, 'Sideline', '1st Half', '1.mp4')]
    expect(await Promise.all(copies.map((c) => convertedFrom(c, out, near)))).toEqual([secondHalf, endZone])

    expect(await convertedFrom(copies[0], out)).toBeNull()
    expect(await convertedFrom(copies[1], out, [join(dir, 'Elsewhere', '1.mp4')])).toBeNull()
    expect(await findConverted(secondHalf, out)).toBe(convertedPath(secondHalf, out))
    expect(await findConverted(endZone, out)).toBe(copies[1])
    expect(await Promise.all(copies.map((c) => convertedFrom(c, out)))).toEqual([secondHalf, endZone])
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
    expect(readdirSync(out, { recursive: true }).filter((f) => String(f).includes('.partial'))).toEqual([])
    const codec = (f: string) =>
      execFileSync(ffmpeg!.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f]).toString().trim()
    expect(codec(converted[1])).toBe('h264')
  })

  it('lets two runs over the same clips both finish with a playable copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-conv-'))
    const inputs = [1, 2].map((n) => join(dir, `Play ${n}.avi`))
    for (const f of inputs) execFileSync(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=3', '-c:v', 'mpeg4', f])
    const out = join(dir, 'out')
    const runs = await Promise.all([convertClips(ffmpeg!, inputs, out), convertClips(ffmpeg!, inputs, out)])
    expect(runs.flatMap((r) => r.failed)).toEqual([])
    const duration = (f: string) =>
      Number(execFileSync(ffmpeg!.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString())
    for (const f of inputs) expect(duration(convertedPath(f, out))).toBeCloseTo(3, 0)
    expect(readdirSync(out, { recursive: true }).filter((f) => String(f).includes('.partial'))).toEqual([])
  })
})
