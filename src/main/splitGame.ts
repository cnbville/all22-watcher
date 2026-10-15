import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseShowinfo, planPlays, type PlannedShot, type SplitResult } from '@shared/splitPlan'
import { CancelledError, errorTail, ffmpegStatus, probe } from './ffmpeg'
import { pickEncoder } from './exportVideo'

/**
 * Splits a full game's film into one clip per play and angle (shared/splitPlan.ts explains how plays are found).
 * Two ffmpeg passes: one finds the camera cuts on a small copy of each frame, one cuts the film at them in a single
 * encode. The clips land in `<outDir>/<hash>/Sideline/001.mp4` and `End Zone/001.mp4` (or `Plays/001.mp4` for
 * film with one angle), so the usual import reads their angles and order from the names.
 */

/** How different two frames must be to count as a camera cut (ffmpeg's scene score, 0–1). */
const SCENE_THRESHOLD = 0.3
export interface SplitProgress {
  stage: 'finding' | 'cutting'
  /** 0–1 within the stage. */
  fraction: number
}

/** Runs ffmpeg, reporting progress from `-progress pipe:1`, and resolves with stderr. */
function runFfmpeg(bin: string, args: string[], duration: number, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const errChunks: string[] = []
    let buf = ''
    const abort = () => child.kill('SIGKILL')
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = /^out_time_(?:ms|us)=(\d+)/.exec(buf.slice(0, i).trim())
        buf = buf.slice(i + 1)
        if (m && duration > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration))
      }
    })
    // showinfo writes a line per selected frame; only those and the tail are kept.
    let tail = ''
    child.stderr.on('data', (d: Buffer) => {
      const text = tail + d.toString()
      const lines = text.split('\n')
      tail = lines.pop() ?? ''
      for (const line of lines) if (line.includes('Parsed_showinfo') || errChunks.length < 400) errChunks.push(line)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      const stderr = [...errChunks, tail].join('\n')
      if (signal.aborted) reject(new CancelledError())
      else if (code === 0) resolve(stderr)
      else reject(new Error(errorTail(stderr, `ffmpeg exited with code ${code}`)))
    })
  })
}

/** The camera cuts in a film, in seconds. */
export async function findCuts(ffmpeg: string, input: string, duration: number, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<number[]> {
  const filter = `scale=320:-2,select='gt(scene\\,${SCENE_THRESHOLD})',showinfo`
  const stderr = await runFfmpeg(ffmpeg, ['-i', input, '-map', '0:v:0', '-an', '-sn', '-vf', filter, '-f', 'null', '-'], duration, onProgress, signal)
  return parseShowinfo(stderr)
}

const FOLDER: Record<PlannedShot['angle'], string> = { sideline: 'Sideline', endzone: 'End Zone', main: 'Plays' }

/** Where a film's clips go: one folder per source file, named for it. */
export function splitDir(input: string, outDir: string): string {
  const hash = createHash('sha1').update(input).digest('hex').slice(0, 8)
  return join(outDir, `${basename(input).replace(/\.[^.]+$/, '')} ${hash}`)
}

/** Finds the plays in a full game's film and writes a clip for each play and angle. */
export async function splitGame(ffmpeg: string, input: string, outDir: string, onProgress: (p: SplitProgress) => void, signal: AbortSignal): Promise<SplitResult> {
  const info = await probe(input, ffmpeg)
  if (!info?.duration) throw new Error('This film’s length couldn’t be read.')
  const duration = info.duration
  const cuts = await findCuts(ffmpeg, input, duration, (fraction) => onProgress({ stage: 'finding', fraction }), signal)
  const shots = planPlays(cuts, duration)
  if (shots.length < 2) throw new Error('No camera cuts were found, so the plays couldn’t be told apart.')

  const status = await ffmpegStatus()
  const encoder = pickEncoder(status.encoders)
  const video = encoder ? encoder.args(info.height ?? 720) : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
  const folder = splitDir(input, outDir)
  const work = `${folder}.partial`
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  try {
    // One encode, cut into segments at every shot boundary. Forced keyframes make the cuts exact; the segmenter splits
    // at the first keyframe from a time on, so it is asked a moment early in case the frame's time rounds down.
    const keys = shots.slice(1).map((s) => s.start.toFixed(3)).join(',')
    const times = shots.slice(1).map((s) => Math.max(0, s.start - 0.02).toFixed(3)).join(',')
    await runFfmpeg(
      ffmpeg,
      [
        '-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-an', '-sn', ...video, '-pix_fmt', 'yuv420p',
        '-force_key_frames', keys, '-f', 'segment', '-segment_times', times, '-reset_timestamps', '1',
        '-segment_format', 'mp4', '-segment_format_options', 'movflags=+faststart', join(work, 'shot%05d.mp4')
      ],
      duration,
      (fraction) => onProgress({ stage: 'cutting', fraction }),
      signal
    )
    const made = (await readdir(work)).filter((f) => /^shot\d+\.mp4$/.test(f)).sort()
    if (made.length !== shots.length) throw new Error(`The film was cut into ${made.length} pieces instead of ${shots.length}, so the plays can’t be trusted.`)
    const width = String(Math.max(3, String(shots[shots.length - 1].play).length))
    for (const [i, shot] of shots.entries()) {
      const dir = join(work, FOLDER[shot.angle])
      await mkdir(dir, { recursive: true })
      await rename(join(work, made[i]), join(dir, `${String(shot.play).padStart(Number(width), '0')}.mp4`))
    }
    await rm(folder, { recursive: true, force: true })
    await rename(work, folder)
  } catch (e) {
    await rm(work, { recursive: true, force: true })
    throw e
  }
  return {
    folder,
    plays: shots[shots.length - 1].play,
    clips: shots.length,
    angles: new Set(shots.map((s) => s.angle)).size
  }
}
