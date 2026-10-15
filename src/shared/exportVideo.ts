import type { Drawing } from './drawing'
import { clipStartTime } from './snap'
import type { Angle, Clip, GameInfo, Grade, Play, PlayRef } from './types'

/** Export Video (improvement 17, 03 §11.6): request, plan and overlay types, and the pure plan builder. */

export type ExportAngle = 'sideline' | 'endzone' | 'main' | 'sideBySide' | 'eachAngle'

export type ExportSource =
  | { kind: 'player'; season: number; playerId: string; plays: PlayRef[] } // reel order
  | { kind: 'cutup'; cutupId: string; plays: PlayRef[] } // shown order
  | { kind: 'plays'; label: string; team: string; plays: PlayRef[] } // tape room

export interface ExportBurnIn {
  grade: boolean
  name: boolean
  caption: boolean
  description: boolean
  drawings: boolean
  number: boolean
  titleCard: boolean
}

export interface ExportVideoRequest {
  source: ExportSource
  /** Whose grade and name are burned in. */
  playerId: string | null
  angle: ExportAngle
  startAtSnap: boolean
  /** Seconds. */
  preRoll: number
  /** 'clip' or seconds after the snap. */
  end: 'clip' | 6 | 8 | 10
  between: 'none' | 'black0.5' | 'black1' | 'hold1'
  burnIn: ExportBurnIn
  height: 720 | 1080 | 'source'
  audio: boolean
  folder: string
  /** Without ".mp4". */
  fileName: string
}

export interface ExportPart {
  clipId: number
  path: string
  angle: Angle
  /** Clip seconds. A negative in-point (Side by Side right pane) holds the first frame that long. */
  in: number
  out: number
  /** Where the picture sits in the output frame (fit inside its pane, letterboxed). */
  rect: { x: number; y: number; w: number; h: number }
  /** Probed clip facts. */
  duration: number
  fps: number | null
  hasAudio: boolean
}

export interface ExportSegment {
  index: number
  ref: PlayRef
  /** The play's number in the export (Each Angle in Turn segments share it). */
  number: number
  parts: ExportPart[]
  layout: 'single' | 'sideBySide'
  /** Seconds of output, without a held last frame. */
  duration: number
  caption: string
}

/** Per-play data the renderer draws overlays from (03 §11.5). */
export interface ExportItemData {
  ref: PlayRef
  game: GameInfo
  /** The perspective team. */
  team: string
  play: Play | null
  number: number
  caption: string
  description: string
  player: { id: string; name: string; jersey: string; position: string; team: string; color: string } | null
  /** The chosen player's grade on this play (null: no plate). */
  grade: Grade | null
  critical: boolean
  drawing: Drawing | null
}

export interface ExportPlan {
  segments: ExportSegment[]
  skipped: { ref: PlayRef; reason: 'noFilm' | 'missingFile' }[]
  width: number
  height: number
  fps: 30 | 60
  /** Seconds, including title card and gaps. */
  duration: number
  estimateBytes: number
  outputPath: string
  exists: boolean
  /** Plays whose clips have no snap point. */
  noSnap: number
  playCount: number
  gameCount: number
  error: 'noFfmpeg' | 'noEncoder' | 'nothingToExport' | 'tooMany' | null
  items: ExportItemData[]
  /** Title card text (the renderer draws it when Title card is on). */
  titleCard: { title: string; line2: string; line3: string; color: string | null }
  /** Tallest clip height in the source (for "Same as Source ({h}p)"). */
  sourceHeight: number | null
}

/** segment −1 = title card. Times are segment-local seconds. */
export interface ExportOverlay {
  segment: number
  from: number
  to: number
  png: ArrayBuffer
}

export const MAX_EXPORT_PLAYS = 300
export const TITLE_CARD_SECONDS = 2.5
const ANGLE_ORDER: Angle[] = ['sideline', 'endzone', 'main']
/** v1's preference when the chosen angle is missing. */
const FALLBACK_ORDER: Angle[] = ['sideline', 'main', 'endzone']

/** A clip with what probing found (or null when its file is missing or unreadable). */
export interface PlanClip extends Clip {
  probe: { duration: number | null; width: number | null; height: number | null; fps: number | null; hasAudio: boolean } | null
}

export interface PlanInput {
  ref: PlayRef
  game: GameInfo
  clips: PlanClip[]
  caption: string
}

/** File names: `/`, `:` and `\` become "-", trimmed, at most 120 characters. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[/:\\]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120).trim()
}

export function outputSize(height: number): { width: number; height: number } {
  const h = Math.max(2, Math.floor(height / 2) * 2)
  return { width: Math.round((h * 16) / 9 / 2) * 2, height: h }
}

/** Video bitrate in bits per second by output height. */
export function videoBitrate(height: number): number {
  return height <= 720 ? 5e6 : height <= 1080 ? 10e6 : 35e6
}

export function estimateBytes(duration: number, height: number, audio: boolean): number {
  return Math.round(((videoBitrate(height) + (audio ? 160e3 : 0)) * duration) / 8)
}

/** "About 104 MB", "Less than 1 MB" (MB = 10^6 bytes). */
export function sizeLabel(bytes: number): string {
  return bytes < 1e6 ? 'Less than 1 MB' : `About ${Math.round(bytes / 1e6)} MB`
}

/** Fits a w×h picture inside a box, centered. */
export function fitRect(w: number, h: number, box: { x: number; y: number; w: number; h: number }) {
  if (!w || !h) return { ...box }
  const s = Math.min(box.w / w, box.h / h)
  const fw = Math.round(w * s)
  const fh = Math.round(h * s)
  return { x: box.x + Math.round((box.w - fw) / 2), y: box.y + Math.round((box.h - fh) / 2), w: fw, h: fh }
}

const usable = (c: PlanClip) => !!c.probe && c.probe.duration !== null && c.probe.duration > 0

function pickClip(clips: PlanClip[], angle: Angle): PlanClip | null {
  const by = (a: Angle) => clips.filter((c) => c.angle === a).sort((x, y) => x.sortIndex - y.sortIndex)[0] ?? null
  return by(angle) ?? FALLBACK_ORDER.map(by).find(Boolean) ?? null
}

/** In and out points of a clip under the request's start and end rules. */
export function inOut(clip: PlanClip, req: Pick<ExportVideoRequest, 'startAtSnap' | 'preRoll' | 'end'>): { in: number; out: number } {
  const duration = clip.probe?.duration ?? clip.duration ?? 0
  const start = Math.min(clipStartTime(clip, req), Math.max(0, duration - 0.1))
  let out = duration
  if (req.end !== 'clip' && clip.snapMs !== null) out = Math.min(duration, clip.snapMs / 1000 + req.end)
  return { in: round3(start), out: round3(Math.max(out, start + 0.1)) }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

export interface PlanOptions {
  ffmpeg: boolean
  encoder: boolean
  /** Whether the output file already exists. */
  exists: (path: string) => boolean
  items?: ExportItemData[]
  titleCard?: ExportPlan['titleCard']
}

/** Gap length between segments for the chosen "Between". */
export function gapSeconds(between: ExportVideoRequest['between']): number {
  return between === 'black0.5' ? 0.5 : between === 'black1' ? 1 : 0
}

export const holdSeconds = (between: ExportVideoRequest['between']) => (between === 'hold1' ? 1 : 0)

/**
 * Builds the plan from resolved plays: segments with in/out points per part and their place in the frame, what was
 * skipped and why, the output size, frame rate, duration and size estimate.
 */
export function buildExportPlan(req: ExportVideoRequest, inputs: PlanInput[], opts: PlanOptions): ExportPlan {
  const tallest = Math.max(0, ...inputs.flatMap((i) => i.clips.map((c) => (usable(c) ? c.probe!.height ?? 0 : 0))))
  const sourceHeight = tallest ? Math.min(2160, Math.floor(tallest / 2) * 2) : null
  const { width: W, height: H } = outputSize(req.height === 'source' ? sourceHeight ?? 1080 : req.height)
  const segments: ExportSegment[] = []
  const skipped: ExportPlan['skipped'] = []
  let noSnap = 0
  let number = 0
  const full = { x: 0, y: 0, w: W, h: H }
  const paneL = { x: 0, y: Math.round(H / 4), w: Math.round(W / 2), h: Math.round(H / 2) }
  const paneR = { x: Math.round(W / 2), y: Math.round(H / 4), w: W - Math.round(W / 2), h: Math.round(H / 2) }

  const part = (c: PlanClip, box: typeof full, io: { in: number; out: number }): ExportPart => ({
    clipId: c.id,
    path: c.path,
    angle: c.angle,
    in: io.in,
    out: io.out,
    rect: fitRect(c.probe!.width ?? 16, c.probe!.height ?? 9, box),
    duration: c.probe!.duration!,
    fps: c.probe!.fps,
    hasAudio: c.probe!.hasAudio
  })

  for (const input of inputs) {
    const withFilm = input.clips
    if (!withFilm.length) {
      skipped.push({ ref: input.ref, reason: 'noFilm' })
      continue
    }
    const clips = withFilm.filter(usable)
    if (!clips.length) {
      skipped.push({ ref: input.ref, reason: 'missingFile' })
      continue
    }
    number++
    const n = number
    const push = (parts: ExportPart[], layout: ExportSegment['layout']) =>
      segments.push({ index: segments.length, ref: input.ref, number: n, parts, layout, duration: round3(parts[0].out - parts[0].in), caption: input.caption })
    const used: PlanClip[] = []

    if (req.angle === 'eachAngle') {
      for (const a of ANGLE_ORDER) {
        const c = clips.filter((x) => x.angle === a).sort((x, y) => x.sortIndex - y.sortIndex)[0]
        if (!c) continue
        used.push(c)
        push([part(c, full, inOut(c, req))], 'single')
      }
    } else if (req.angle === 'sideBySide') {
      const angles = ANGLE_ORDER.filter((a) => clips.some((c) => c.angle === a))
      const pick = (a: Angle) => clips.filter((c) => c.angle === a).sort((x, y) => x.sortIndex - y.sortIndex)[0]
      if (angles.length < 2) {
        const c = pick(angles[0])
        used.push(c)
        push([part(c, full, inOut(c, req))], 'single')
      } else {
        // Sideline left and end zone right, or the two angles the play has.
        const [la, ra] = angles.includes('sideline') && angles.includes('endzone') ? ['sideline', 'endzone'] as Angle[] : angles.slice(0, 2)
        const L = pick(la)
        const R = pick(ra)
        used.push(L, R)
        const l = inOut(L, req)
        const dur = l.out - l.in
        // Aligned on the snap when both clips have one (02 §8.4), else on clip start.
        const rIn = L.snapMs !== null && R.snapMs !== null ? R.snapMs / 1000 + (l.in - L.snapMs / 1000) : l.in
        push([part(L, paneL, l), part(R, paneR, { in: round3(rIn), out: round3(rIn + dur) })], 'sideBySide')
      }
    } else {
      const c = pickClip(clips, req.angle)!
      used.push(c)
      push([part(c, full, inOut(c, req))], 'single')
    }
    if (req.startAtSnap && used.some((c) => c.snapMs === null)) noSnap++
  }

  const parts = segments.flatMap((s) => s.parts)
  const fast = parts.filter((p) => (p.fps ?? 0) >= 50).length
  const fps: 30 | 60 = parts.length && fast > parts.length / 2 ? 60 : 30
  const gap = gapSeconds(req.between)
  const hold = holdSeconds(req.between)
  const duration = round3(
    (req.burnIn.titleCard && segments.length ? TITLE_CARD_SECONDS : 0) +
      segments.reduce((s, x) => s + x.duration + hold, 0) +
      Math.max(0, segments.length - 1) * gap
  )
  const playRefs = new Set(segments.map((s) => `${s.ref.gameId}#${s.ref.playId}`))
  const games = new Set(segments.map((s) => s.ref.gameId))
  const name = sanitizeFileName(req.fileName) || 'Untitled'
  const outputPath = `${req.folder.replace(/[/\\]+$/, '')}/${name}.mp4`
  let error: ExportPlan['error'] = null
  if (!opts.ffmpeg) error = 'noFfmpeg'
  else if (!opts.encoder) error = 'noEncoder'
  else if (req.source.plays.length > MAX_EXPORT_PLAYS) error = 'tooMany'
  else if (!segments.length) error = 'nothingToExport'
  return {
    segments,
    skipped,
    width: W,
    height: H,
    fps,
    duration,
    estimateBytes: estimateBytes(duration, H, req.audio),
    outputPath,
    exists: opts.exists(outputPath),
    noSnap,
    playCount: playRefs.size,
    gameCount: games.size,
    error,
    items: opts.items ?? [],
    titleCard: opts.titleCard ?? { title: name, line2: '', line3: '', color: null },
    sourceHeight
  }
}
