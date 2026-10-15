import { describe, expect, it } from 'vitest'
import {
  buildExportPlan,
  estimateBytes,
  type ExportVideoRequest,
  fitRect,
  inOut,
  MAX_EXPORT_PLAYS,
  outputSize,
  type PlanClip,
  type PlanInput,
  sanitizeFileName,
  sizeLabel
} from './exportVideo'
import { makeClip, makeGame } from './fixtures'
import type { Angle } from './types'

const req = (o: Partial<ExportVideoRequest> = {}): ExportVideoRequest => ({
  source: { kind: 'plays', label: 'Test', team: 'PHI', plays: [] },
  playerId: null,
  angle: 'sideline',
  startAtSnap: true,
  preRoll: 1,
  end: 'clip',
  between: 'none',
  burnIn: { grade: true, name: true, caption: true, description: false, drawings: true, number: true, titleCard: false },
  height: 1080,
  audio: false,
  folder: '/out/',
  fileName: 'Reel',
  ...o
})

let nextId = 1
const clip = (playId: number, angle: Angle, o: Partial<PlanClip> = {}, probe: Partial<NonNullable<PlanClip['probe']>> | null = {}): PlanClip => ({
  ...makeClip({ id: nextId++, playId, angle, path: `/clips/${angle}/${playId}.mp4`, snapMs: 2000, duration: 8 }),
  probe: probe === null ? null : { duration: 8, width: 1280, height: 720, fps: 30, hasAudio: false, ...probe },
  ...o
})
const input = (playId: number, clips: PlanClip[], gameId = '2025_01_DAL_PHI'): PlanInput => ({ ref: { gameId, playId }, game: makeGame({ gameId }), clips, caption: `Play ${playId}` })
const opts = { ffmpeg: true, encoder: true, exists: () => false }
const plays = (n: number) => Array.from({ length: n }, (_, i) => ({ gameId: 'g', playId: i }))

describe('inOut', () => {
  it('starts at the snap minus the pre-roll, or at 0', () => {
    expect(inOut(clip(1, 'sideline'), req())).toEqual({ in: 1, out: 8 })
    expect(inOut(clip(1, 'sideline', { snapMs: null }), req())).toEqual({ in: 0, out: 8 })
    expect(inOut(clip(1, 'sideline'), req({ startAtSnap: false }))).toEqual({ in: 0, out: 8 })
    expect(inOut(clip(1, 'sideline', { snapMs: 400 }), req())).toEqual({ in: 0, out: 8 })
  })
  it('ends a set time after the snap, capped at the clip end', () => {
    expect(inOut(clip(1, 'sideline'), req({ end: 6 }))).toEqual({ in: 1, out: 8 })
    expect(inOut(clip(1, 'sideline', { snapMs: 1000 }), req({ end: 6 }))).toEqual({ in: 0, out: 7 })
    // No snap point: the end of the clip.
    expect(inOut(clip(1, 'sideline', { snapMs: null }), req({ end: 6 }))).toEqual({ in: 0, out: 8 })
  })
})

describe('buildExportPlan', () => {
  it('plans one segment per play at the chosen angle, falling back in v1 order', () => {
    const plan = buildExportPlan(req(), [input(1, [clip(1, 'sideline'), clip(1, 'endzone')]), input(2, [clip(2, 'endzone'), clip(2, 'main')])], opts)
    expect(plan.segments.map((s) => [s.number, s.parts[0].angle, s.layout])).toEqual([
      [1, 'sideline', 'single'],
      [2, 'main', 'single']
    ])
    expect(plan.segments[0].parts[0]).toMatchObject({ in: 1, out: 8, rect: { x: 0, y: 0, w: 1920, h: 1080 } })
    expect(plan).toMatchObject({ width: 1920, height: 1080, fps: 30, duration: 14, playCount: 2, gameCount: 1, error: null, outputPath: '/out/Reel.mp4' })
  })

  it('offsets the right pane by the snap points in Side by Side, holding when negative', () => {
    const L = clip(1, 'sideline', { snapMs: 2000 })
    const R = clip(1, 'endzone', { snapMs: 500 })
    const plan = buildExportPlan(req({ angle: 'sideBySide' }), [input(1, [R, L])], opts)
    const [seg] = plan.segments
    expect(seg.layout).toBe('sideBySide')
    expect(seg.parts.map((p) => [p.angle, p.in, p.out])).toEqual([
      ['sideline', 1, 8],
      ['endzone', -0.5, 6.5]
    ])
    expect(seg.parts[0].rect).toEqual({ x: 0, y: 270, w: 960, h: 540 })
    expect(seg.parts[1].rect).toEqual({ x: 960, y: 270, w: 960, h: 540 })
    // Without both snaps the right pane uses the left's in-point.
    const plain = buildExportPlan(req({ angle: 'sideBySide' }), [input(1, [clip(1, 'sideline'), clip(1, 'endzone', { snapMs: null })])], opts)
    expect(plain.segments[0].parts[1].in).toBe(1)
    // One angle only: full frame.
    expect(buildExportPlan(req({ angle: 'sideBySide' }), [input(2, [clip(2, 'main')])], opts).segments[0].layout).toBe('single')
  })

  it('plays every angle in turn under one number', () => {
    const plan = buildExportPlan(req({ angle: 'eachAngle' }), [input(1, [clip(1, 'main'), clip(1, 'endzone'), clip(1, 'sideline')]), input(2, [clip(2, 'sideline')])], opts)
    expect(plan.segments.map((s) => [s.number, s.parts[0].angle])).toEqual([
      [1, 'sideline'],
      [1, 'endzone'],
      [1, 'main'],
      [2, 'sideline']
    ])
    expect(plan.playCount).toBe(2)
  })

  it('skips plays without film or with unreadable clips, and counts missing snaps', () => {
    const plan = buildExportPlan(req(), [input(1, []), input(2, [clip(2, 'sideline', {}, null)]), input(3, [clip(3, 'sideline', { snapMs: null })])], opts)
    expect(plan.skipped).toEqual([
      { ref: { gameId: '2025_01_DAL_PHI', playId: 1 }, reason: 'noFilm' },
      { ref: { gameId: '2025_01_DAL_PHI', playId: 2 }, reason: 'missingFile' }
    ])
    expect(plan.noSnap).toBe(1)
    expect(plan.segments[0].number).toBe(1)
  })

  it('uses 60 fps only when most parts are 50 fps or faster', () => {
    const fast = (id: number) => clip(id, 'sideline', {}, { fps: 59.94 })
    expect(buildExportPlan(req(), [input(1, [fast(1)]), input(2, [fast(2)]), input(3, [clip(3, 'sideline')])], opts).fps).toBe(60)
    expect(buildExportPlan(req(), [input(1, [fast(1)]), input(3, [clip(3, 'sideline')])], opts).fps).toBe(30)
  })

  it('adds the title card, gaps and holds to the duration and estimate', () => {
    const inputs = [input(1, [clip(1, 'sideline')]), input(2, [clip(2, 'sideline')], '2025_02_PHI_KC')]
    const plan = buildExportPlan(req({ between: 'black1', burnIn: { ...req().burnIn, titleCard: true }, height: 720, audio: true }), inputs, opts)
    // 2.5 title + 7 + 1 gap + 7
    expect(plan.duration).toBe(17.5)
    expect(plan.gameCount).toBe(2)
    expect(plan.estimateBytes).toBe(estimateBytes(17.5, 720, true))
    expect(buildExportPlan(req({ between: 'hold1' }), inputs, opts).duration).toBe(16)
  })

  it('sizes the output, including Same as Source', () => {
    expect(outputSize(720)).toEqual({ width: 1280, height: 720 })
    const tall = buildExportPlan(req({ height: 'source' }), [input(1, [clip(1, 'sideline', {}, { width: 3840, height: 2161 })])], opts)
    expect([tall.sourceHeight, tall.width, tall.height]).toEqual([2160, 3840, 2160])
    expect(fitRect(640, 480, { x: 0, y: 0, w: 1920, h: 1080 })).toEqual({ x: 240, y: 0, w: 1440, h: 1080 })
  })

  it('estimates and labels sizes', () => {
    // 10 Mb/s for 100 s at 1080p = 125 MB.
    expect(estimateBytes(100, 1080, false)).toBe(125e6)
    expect(estimateBytes(100, 720, true)).toBe(Math.round((5.16e6 * 100) / 8))
    expect(estimateBytes(10, 2160, false)).toBe(Math.round((35e6 * 10) / 8))
    expect(sizeLabel(104.4e6)).toBe('About 104 MB')
    expect(sizeLabel(900e3)).toBe('Less than 1 MB')
  })

  it('sanitizes file names', () => {
    expect(sanitizeFileName(' DAL @ PHI: Wk 1/Q1\\x ')).toBe('DAL @ PHI- Wk 1-Q1-x')
    expect(sanitizeFileName('a'.repeat(200))).toHaveLength(120)
    expect(buildExportPlan(req({ fileName: '  ' }), [input(1, [clip(1, 'sideline')])], opts).outputPath).toBe('/out/Untitled.mp4')
  })

  it('reports errors in order: ffmpeg, encoder, too many, nothing', () => {
    const none: PlanInput[] = []
    const many = req({ source: { kind: 'plays', label: 'x', team: 'PHI', plays: plays(MAX_EXPORT_PLAYS + 1) } })
    expect(buildExportPlan(many, none, { ...opts, ffmpeg: false, encoder: false }).error).toBe('noFfmpeg')
    expect(buildExportPlan(many, none, { ...opts, encoder: false }).error).toBe('noEncoder')
    expect(buildExportPlan(many, none, opts).error).toBe('tooMany')
    expect(buildExportPlan(req({ source: { kind: 'plays', label: 'x', team: 'PHI', plays: plays(MAX_EXPORT_PLAYS) } }), none, opts).error).toBe('nothingToExport')
    expect(buildExportPlan(req(), [input(1, [clip(1, 'sideline')])], { ...opts, exists: () => true }).exists).toBe(true)
  })
})
