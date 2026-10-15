import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  type ExportOverlay,
  type ExportPlan,
  type ExportSegment,
  type ExportVideoRequest,
  gapSeconds,
  holdSeconds,
  TITLE_CARD_SECONDS,
  videoBitrate
} from '@shared/exportVideo'
import { durationLabel } from '@shared/labels'
import { type ActivityHandle, startActivity } from './events'
import { CancelledError, spawnFfmpeg } from './ffmpeg'

/** ffmpeg argument building and the export pipeline (03 §11.6). */

export interface Encoder {
  name: 'h264_videotoolbox' | 'libx264'
  args: (height: number) => string[]
}

/** h264_videotoolbox (macOS hardware) when the build lists it, else libx264; null when neither. */
export function pickEncoder(encoders: { h264_videotoolbox: boolean; libx264: boolean }): Encoder | null {
  if (encoders.h264_videotoolbox) {
    return {
      name: 'h264_videotoolbox',
      args: (h) => ['-c:v', 'h264_videotoolbox', '-b:v', String(videoBitrate(h)), '-allow_sw', '1', '-profile:v', 'high']
    }
  }
  if (encoders.libx264) return { name: 'libx264', args: () => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high'] }
  return null
}

const AUDIO_OUT = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2']
const n3 = (x: number) => String(Math.round(x * 1000) / 1000)

export interface SegmentFiles {
  /** Overlay PNG paths for this segment, with their segment-local time range. */
  overlays: { path: string; from: number; to: number }[]
  out: string
}

/** Arguments that encode one play segment (single angle or Side by Side) with its overlays burned in. */
export function segmentArgs(seg: ExportSegment, plan: Pick<ExportPlan, 'width' | 'height' | 'fps'>, req: Pick<ExportVideoRequest, 'audio' | 'between'>, encoder: Encoder, files: SegmentFiles): string[] {
  const { width: W, height: H, fps } = plan
  const dur = seg.duration
  const hold = holdSeconds(req.between)
  const total = dur + hold
  const args = ['-v', 'error', '-y', '-progress', 'pipe:1', '-nostats']
  // Video inputs.
  for (const p of seg.parts) {
    args.push('-ss', n3(Math.max(0, p.in)), '-t', n3(Math.max(0.05, p.out - Math.max(0, p.in))), '-i', p.path)
  }
  let next = seg.parts.length
  const overlayInputs: number[] = []
  for (const o of files.overlays) {
    args.push('-loop', '1', '-t', n3(total), '-i', o.path)
    overlayInputs.push(next++)
  }
  let silence = -1
  if (req.audio && !seg.parts[0].hasAudio) {
    args.push('-f', 'lavfi', '-t', n3(total), '-i', 'anullsrc=r=48000:cl=stereo')
    silence = next++
  }

  const chains: string[] = []
  const fit = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
  if (seg.layout === 'sideBySide' && seg.parts.length === 2) {
    const pw = Math.round(W / 2)
    const ph = Math.round(H / 2)
    const [, right] = seg.parts
    const lead = right.in < 0 ? -right.in : 0
    const rightLen = right.out - Math.max(0, right.in)
    const tail = Math.max(0, dur - lead - rightLen)
    chains.push(`[0:v]fps=${fps},${fit(pw, ph)},trim=duration=${n3(dur)},setpts=PTS-STARTPTS[l]`)
    const pads = [lead > 0 ? `tpad=start_mode=clone:start_duration=${n3(lead)}` : '', `tpad=stop_mode=clone:stop_duration=${n3(tail + 0.5)}`].filter(Boolean).join(',')
    chains.push(`[1:v]fps=${fps},${fit(W - pw, ph)},${pads},trim=duration=${n3(dur)},setpts=PTS-STARTPTS[r]`)
    chains.push(`[l][r]hstack=inputs=2,pad=${W}:${H}:0:(oh-ih)/2:color=black,setsar=1[base0]`)
  } else {
    chains.push(`[0:v]fps=${fps},${fit(W, H)},trim=duration=${n3(dur)},setpts=PTS-STARTPTS[base0]`)
  }
  let cur = 'base0'
  if (hold) {
    chains.push(`[${cur}]tpad=stop_mode=clone:stop_duration=${n3(hold)}[held]`)
    cur = 'held'
  }
  files.overlays.forEach((o, i) => {
    const label = `o${i + 1}`
    chains.push(`[${cur}][${overlayInputs[i]}:v]overlay=0:0:enable='between(t,${n3(o.from)},${n3(o.to)})'[${label}]`)
    cur = label
  })
  chains.push(`[${cur}]format=yuv420p[v]`)
  if (req.audio && silence === -1) {
    chains.push(`[0:a]aresample=48000,atrim=duration=${n3(dur)},asetpts=PTS-STARTPTS${hold ? `,apad=pad_dur=${n3(hold)}` : ''}[a]`)
  }
  args.push('-filter_complex', chains.join(';'), '-map', '[v]')
  if (req.audio) args.push('-map', silence === -1 ? '[a]' : `${silence}:a`, ...AUDIO_OUT)
  else args.push('-an')
  args.push(...encoder.args(H), '-pix_fmt', 'yuv420p', '-r', String(fps), '-t', n3(total), files.out)
  return args
}

/** A black gap between segments (with silence when audio is on). */
export function gapArgs(seconds: number, plan: Pick<ExportPlan, 'width' | 'height' | 'fps'>, audio: boolean, encoder: Encoder, out: string): string[] {
  const args = ['-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-f', 'lavfi', '-t', n3(seconds), '-i', `color=c=black:s=${plan.width}x${plan.height}:r=${plan.fps}`]
  if (audio) args.push('-f', 'lavfi', '-t', n3(seconds), '-i', 'anullsrc=r=48000:cl=stereo')
  args.push('-map', '0:v')
  if (audio) args.push('-map', '1:a', ...AUDIO_OUT)
  else args.push('-an')
  args.push(...encoder.args(plan.height), '-pix_fmt', 'yuv420p', '-r', String(plan.fps), '-t', n3(seconds), out)
  return args
}

/** The title card: the rendered PNG for 2.5 s, fading in and out over 0.3 s. */
export function titleArgs(png: string, plan: Pick<ExportPlan, 'width' | 'height' | 'fps'>, audio: boolean, encoder: Encoder, out: string): string[] {
  const t = TITLE_CARD_SECONDS
  const args = ['-v', 'error', '-y', '-progress', 'pipe:1', '-nostats', '-loop', '1', '-t', n3(t), '-i', png]
  if (audio) args.push('-f', 'lavfi', '-t', n3(t), '-i', 'anullsrc=r=48000:cl=stereo')
  args.push(
    '-filter_complex',
    `[0:v]fps=${plan.fps},scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2:color=0x121214,setsar=1,fade=t=in:st=0:d=0.3,fade=t=out:st=${n3(t - 0.3)}:d=0.3,format=yuv420p[v]`,
    '-map',
    '[v]'
  )
  if (audio) args.push('-map', '1:a', ...AUDIO_OUT)
  else args.push('-an')
  args.push(...encoder.args(plan.height), '-pix_fmt', 'yuv420p', '-r', String(plan.fps), '-t', n3(t), out)
  return args
}

/** The concat list file: one `file '<path>'` line per part, quotes escaped. */
export function concatList(files: string[]): string {
  return files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
}

const metaEscape = (s: string) => s.replace(/[=;#\\\n]/g, (c) => (c === '\n' ? ' ' : `\\${c}`))

/** ffmetadata chapters: one per play (Each Angle in Turn segments of a play share it), "Title" for the title card. */
export function chaptersText(plan: Pick<ExportPlan, 'segments'>, req: Pick<ExportVideoRequest, 'between' | 'burnIn'>): string {
  const lines = [';FFMETADATA1']
  let t = 0
  const add = (start: number, end: number, title: string) =>
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(start * 1000)}`, `END=${Math.round(end * 1000)}`, `title=${metaEscape(title)}`)
  if (req.burnIn.titleCard && plan.segments.length) {
    add(0, TITLE_CARD_SECONDS, 'Title')
    t = TITLE_CARD_SECONDS
  }
  const gap = gapSeconds(req.between)
  const hold = holdSeconds(req.between)
  let open: { start: number; end: number; number: number; title: string } | null = null
  plan.segments.forEach((s, i) => {
    if (i > 0) t += gap
    const end = t + s.duration + hold
    if (open && open.number === s.number) open.end = end
    else {
      if (open) add(open.start, open.end, open.title)
      open = { start: t, end, number: s.number, title: s.caption }
    }
    t = end
  })
  if (open) add((open as { start: number }).start, (open as { end: number }).end, (open as { title: string }).title)
  return lines.join('\n') + '\n'
}

/** The final join: concat the parts, add chapters and metadata, fast start. */
export function joinArgs(listFile: string, chaptersFile: string, title: string, out: string): string[] {
  return [
    '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', chaptersFile,
    '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movflags', '+faststart',
    '-metadata', `title=${title}`, '-metadata', 'comment=Exported from All-22 Watcher', out
  ]
}

// Pipeline and queue

export interface ExportJob {
  id: string
  req: ExportVideoRequest
  plan: ExportPlan
  overlays: ExportOverlay[]
  ffmpeg: string
  encoder: Encoder
  route?: string
}

export interface ExportResult {
  path: string
  segments: number
  failedSegments: number
  bytes: number
}

const queue: { job: ExportJob; handle: ActivityHandle; abort: AbortController }[] = []
let running = false
let keepAwake: { start: () => void; stop: () => void } = { start: () => {}, stop: () => {} }

/** index.ts hands in the power save blocker so the pipeline stays free of Electron imports. */
export function setExportKeepAwake(k: { start: () => void; stop: () => void }) {
  keepAwake = k
}

export function exportsRunning(): string[] {
  return queue.map((q) => q.job.req.fileName)
}

/** Queues an export; returns its activity id at once. One export runs at a time; later ones wait. */
export function queueExport(job: Omit<ExportJob, 'id'>, onFinished?: (r: ExportResult | null, error: string | null) => void): string {
  const abort = new AbortController()
  const handle = startActivity(
    {
      kind: 'export',
      title: `Exporting “${job.req.fileName}”`,
      detail: queue.length ? 'Waiting…' : `Play 1 of ${job.plan.playCount}`,
      total: Math.max(1, Math.round(job.plan.duration * 10)),
      route: job.route
    },
    () => abort.abort()
  )
  queue.push({ job: { ...job, id: handle.id }, handle, abort })
  void pump(onFinished)
  return handle.id
}

async function pump(onFinished: ((r: ExportResult | null, error: string | null) => void) | undefined) {
  if (running) return
  running = true
  keepAwake.start()
  try {
    while (queue.length) {
      const { job, handle, abort } = queue[0]
      if (abort.signal.aborted) {
        handle.cancelled()
        queue.shift()
        continue
      }
      try {
        const r = await runExport(job, handle, abort.signal)
        const plays = job.plan.playCount
        const left = r.failedSegments
        handle.done({
          detail: `${plays} plays · ${durationLabel(job.plan.duration)} · ${Math.max(1, Math.round(r.bytes / 1e6))} MB`,
          resultPath: r.path,
          notification: {
            title: 'Export finished',
            body: left ? `Exported ${plays - left} of ${plays} plays. ${left} clip${left === 1 ? '' : 's'} couldn’t be read.` : basename(r.path),
            revealPath: r.path
          }
        })
        onFinished?.(r, null)
      } catch (e) {
        if (e instanceof CancelledError || abort.signal.aborted) handle.cancelled()
        else {
          const msg = e instanceof Error ? e.message : String(e)
          handle.fail(msg, { notification: { title: 'Export failed', body: `${basename(job.plan.outputPath)}: ${msg}`, route: job.route } })
          onFinished?.(null, msg)
        }
      }
      queue.shift()
      if (queue[0]) queue[0].handle.update({ detail: `Play 1 of ${queue[0].job.plan.playCount}` })
    }
  } finally {
    running = false
    keepAwake.stop()
  }
}

/** Runs one export: overlays to disk, segments two at a time, chapters, join, rename into place, clean up. */
export async function runExport(job: ExportJob, handle: ActivityHandle | null, signal: AbortSignal): Promise<ExportResult> {
  const { plan, req, encoder, ffmpeg } = job
  const dir = join(tmpdir(), `all22-export-${job.id || randomBytes(4).toString('hex')}`)
  const partial = `${plan.outputPath}.part.mp4`
  await mkdir(dir, { recursive: true })
  try {
    // 1. Overlay PNGs.
    const bySegment = new Map<number, { path: string; from: number; to: number }[]>()
    let titlePng: string | null = null
    for (const [i, o] of job.overlays.entries()) {
      const path = join(dir, o.segment < 0 ? 'title.png' : `ov-${o.segment}-${i}.png`)
      await writeFile(path, Buffer.from(o.png))
      if (o.segment < 0) titlePng = path
      else bySegment.set(o.segment, [...(bySegment.get(o.segment) ?? []), { path, from: o.from, to: o.to }])
    }

    // 2. Encode segments (and gaps), two at a time.
    const totalTenths = Math.max(1, plan.duration * 10)
    const doneBy = new Map<string, number>()
    const report = (key: string, seconds: number, playNumber?: number) => {
      doneBy.set(key, seconds)
      const done = [...doneBy.values()].reduce((a, b) => a + b, 0)
      handle?.update({ done: Math.min(totalTenths * 0.95, Math.round(done * 10 * 0.95)), ...(playNumber ? { detail: `Play ${playNumber} of ${plan.playCount}` } : {}) })
    }
    const order: string[] = []
    const tasks: (() => Promise<boolean>)[] = []
    const audio = req.audio
    if (req.burnIn.titleCard && titlePng && plan.segments.length) {
      const out = join(dir, 'title.mp4')
      order.push(out)
      tasks.push(async () => {
        await spawnFfmpeg(ffmpeg, titleArgs(titlePng!, plan, audio, encoder, out), { signal, onProgress: (s) => report('title', s) })
        return true
      })
    }
    const gap = gapSeconds(req.between)
    let gapFile: string | null = null
    if (gap > 0 && plan.segments.length > 1) {
      gapFile = join(dir, 'gap.mp4')
      const g = gapFile
      tasks.push(async () => {
        await spawnFfmpeg(ffmpeg, gapArgs(gap, plan, audio, encoder, g), { signal })
        return true
      })
    }
    const segOk = new Map<number, boolean>()
    for (const seg of plan.segments) {
      const out = join(dir, `seg-${seg.index}.mp4`)
      tasks.push(async () => {
        try {
          await spawnFfmpeg(ffmpeg, segmentArgs(seg, plan, req, encoder, { overlays: bySegment.get(seg.index) ?? [], out }), {
            signal,
            onProgress: (s) => report(`seg-${seg.index}`, s, seg.number)
          })
          segOk.set(seg.index, true)
        } catch (e) {
          if (signal.aborted || e instanceof CancelledError) throw e
          // A clip that can't be read is left out; the export carries on.
          segOk.set(seg.index, false)
        }
        return true
      })
    }
    let next = 0
    const worker = async () => {
      while (next < tasks.length) {
        if (signal.aborted) throw new CancelledError()
        await tasks[next++]()
      }
    }
    await Promise.all([worker(), worker()])
    if (signal.aborted) throw new CancelledError()

    const kept = plan.segments.filter((s) => segOk.get(s.index))
    if (!kept.length) throw new Error('None of the clips could be read.')
    kept.forEach((s, i) => {
      if (i > 0 && gapFile) order.push(gapFile)
      order.push(join(dir, `seg-${s.index}.mp4`))
    })

    // 3–4. Chapters and join.
    const listFile = join(dir, 'list.txt')
    const chaptersFile = join(dir, 'chapters.txt')
    await writeFile(listFile, concatList(order))
    await writeFile(chaptersFile, chaptersText({ segments: kept }, req))
    await spawnFfmpeg(ffmpeg, joinArgs(listFile, chaptersFile, req.fileName, partial), { signal })
    await rename(partial, plan.outputPath)
    handle?.update({ done: Math.round(totalTenths) })
    const { size } = await stat(plan.outputPath)
    return { path: plan.outputPath, segments: kept.length, failedSegments: plan.segments.length - kept.length, bytes: size }
  } catch (e) {
    await rm(partial, { force: true }).catch(() => {})
    throw e
  } finally {
    // 5. The temp folder goes on success, failure and cancel.
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
