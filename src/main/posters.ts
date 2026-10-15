import { existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { findFfmpeg, runTool } from './ffmpeg'

/**
 * Stills for poster tiles (`tape://poster/<clipId>?t=<sec>&w=<px>`, 03 §2.7): one JPEG frame from a clip, cached under
 * `<userData>/posters` by clip, time, size and the clip's modified time, at most 2 ffmpeg runs at once, pruned to 600.
 */

export const POSTER_WIDTH = 480
export const POSTER_LIMIT = 600
const CONCURRENCY = 2

export function posterFileName(clipId: number, at: number, width: number, mtimeMs: number): string {
  return `${clipId}-${Math.round(at * 1000)}-${width}-${Math.round(mtimeMs)}.jpg`
}

export function posterArgs(input: string, at: number, width: number, out: string): string[] {
  return ['-v', 'error', '-y', '-ss', at.toFixed(3), '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out]
}

/** Reads `t` and `w` from a poster URL's query: t ≥ 0 (seconds), w between 64 and 1920 (default 480). */
export function posterQuery(url: URL): { at: number; width: number } {
  const t = Number(url.searchParams.get('t') ?? 0)
  const w = Number(url.searchParams.get('w') ?? POSTER_WIDTH)
  return {
    at: Number.isFinite(t) && t > 0 ? t : 0,
    width: Number.isFinite(w) ? Math.min(1920, Math.max(64, Math.round(w / 2) * 2)) : POSTER_WIDTH
  }
}

export class PosterCache {
  private running = 0
  private queue: (() => void)[] = []
  private inflight = new Map<string, Promise<string | null>>()
  private writes = 0

  constructor(readonly dir: string) {}

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENCY) await new Promise<void>((r) => this.queue.push(r))
    this.running++
    try {
      return await fn()
    } finally {
      this.running--
      this.queue.shift()?.()
    }
  }

  /** The cached still's path, making it when needed; null when there's no ffmpeg or the frame can't be read. */
  async get(clipId: number, clipPath: string, at: number, width = POSTER_WIDTH): Promise<string | null> {
    let mtime: number
    try {
      mtime = (await stat(clipPath)).mtimeMs
    } catch {
      return null
    }
    const out = join(this.dir, posterFileName(clipId, at, width, mtime))
    if (existsSync(out)) return out
    const running = this.inflight.get(out)
    if (running) return running
    const job = this.slot(() => this.make(clipPath, at, width, out)).finally(() => this.inflight.delete(out))
    this.inflight.set(out, job)
    return job
  }

  private async make(input: string, at: number, width: number, out: string): Promise<string | null> {
    const ffmpeg = findFfmpeg()
    if (!ffmpeg) return null
    await mkdir(this.dir, { recursive: true })
    const tmp = `${out}.${process.pid}.tmp.jpg`
    let res = await runTool(ffmpeg, posterArgs(input, at, width, tmp))
    // Past the end of a short clip: take the first frame instead.
    if ((res.code !== 0 || !existsSync(tmp)) && at > 0) res = await runTool(ffmpeg, posterArgs(input, 0, width, tmp))
    if (res.code !== 0 || !existsSync(tmp)) {
      await rm(tmp, { force: true })
      return null
    }
    await rename(tmp, out)
    if (++this.writes % 50 === 0) void this.prune()
    return out
  }

  /** Keeps the newest POSTER_LIMIT stills. */
  async prune(limit = POSTER_LIMIT) {
    let names: string[]
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith('.jpg'))
    } catch {
      return
    }
    if (names.length <= limit) return
    const withTimes = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(this.dir, n)).catch(() => null))?.mtimeMs ?? 0 })))
    withTimes.sort((a, b) => b.t - a.t)
    await Promise.all(withTimes.slice(limit).map((x) => rm(join(this.dir, x.n), { force: true })))
  }
}
