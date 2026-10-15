import { execFile, spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { FfmpegStatus } from '@shared/types'

/** Homebrew (Apple silicon, Intel) and system installs, checked after the bundled binary. */
const SYSTEM_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']

export interface FfmpegLocation {
  path: string
  source: 'env' | 'bundled' | 'system'
}

/**
 * Where the bundled binary sits: `<resources>/ffmpeg/ffmpeg` in the packaged app (electron-builder copies
 * `resources/ffmpeg/<arch>` there), or `resources/ffmpeg/<arch>/ffmpeg` in the repo during development.
 */
export function bundledFfmpegCandidates(resourcesPath = (process as { resourcesPath?: string }).resourcesPath, arch = process.arch): string[] {
  const out: string[] = []
  if (resourcesPath) out.push(join(resourcesPath, 'ffmpeg', 'ffmpeg'))
  // out/main/index.js → repo root
  out.push(join(__dirname, '..', '..', 'resources', 'ffmpeg', arch, 'ffmpeg'))
  return out
}

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

/** Resolution order: ALL22_FFMPEG → the bundled binary → Homebrew/system/PATH (v1 behaviour). */
export function locateFfmpeg(): FfmpegLocation | null {
  const override = process.env.ALL22_FFMPEG
  if (override && existsSync(override)) return { path: override, source: 'env' }
  const bundled = bundledFfmpegCandidates().find((p) => isFile(p))
  if (bundled) return { path: bundled, source: 'bundled' }
  const system = SYSTEM_CANDIDATES.find((p) => existsSync(p)) ?? onPath('ffmpeg')
  return system ? { path: system, source: 'system' } : null
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

export function findFfmpeg(): string | null {
  return locateFfmpeg()?.path ?? null
}

/** ffprobe next to ffmpeg (Homebrew ships both), or null: the bundled build has only ffmpeg. */
export function findFfprobe(ffmpeg: string | null = findFfmpeg()): string | null {
  if (!ffmpeg) return null
  const next = join(dirname(ffmpeg), 'ffprobe')
  return existsSync(next) ? next : null
}

/** Runs a tool and resolves with stdout and stderr, whatever the exit code. */
export function runTool(bin: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0
      resolve({ code: typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/** The last two non-empty stderr lines, as v1 reported ffmpeg errors. */
export function errorTail(stderr: string, fallback = 'ffmpeg failed'): string {
  return stderr.split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' ') || fallback
}

let statusCache: { key: string; value: FfmpegStatus } | null = null

/** "ffmpeg version 6.1.1-3ubuntu5 Copyright…" → "6.1.1-3ubuntu5" */
export function parseVersion(text: string): string | null {
  return /ffmpeg version (\S+)/.exec(text)?.[1] ?? null
}

/** Which H.264 encoders an `ffmpeg -encoders` listing has. */
export function parseEncoders(listing: string): FfmpegStatus['encoders'] {
  const has = (name: string) => new RegExp(`^\\s*V\\S*\\s+${name}\\b`, 'm').test(listing)
  return { h264_videotoolbox: has('h264_videotoolbox'), libx264: has('libx264') }
}

/** Path, version and encoders of the ffmpeg in use, for Settings › Film & Import and the export plan. Cached per path. */
export async function ffmpegStatus(): Promise<FfmpegStatus> {
  const loc = locateFfmpeg()
  const key = loc?.path ?? ''
  if (statusCache?.key === key) return statusCache.value
  let value: FfmpegStatus = {
    path: null,
    version: null,
    source: null,
    bundled: false,
    ffprobe: null,
    encoders: { h264_videotoolbox: false, libx264: false }
  }
  if (loc) {
    const [ver, enc] = await Promise.all([runTool(loc.path, ['-hide_banner', '-version']), runTool(loc.path, ['-hide_banner', '-encoders'])])
    value = {
      path: loc.path,
      version: parseVersion(ver.stdout) ?? parseVersion(`ffmpeg ${ver.stdout}`),
      source: loc.source,
      bundled: loc.source === 'bundled',
      ffprobe: findFfprobe(loc.path),
      encoders: parseEncoders(enc.stdout)
    }
  }
  statusCache = { key, value }
  return value
}

export interface ProbeInfo {
  /** Seconds, null when unknown. */
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  hasAudio: boolean
  codec: string | null
}

/** Reads `ffmpeg -hide_banner -i <file>` stderr: duration, the first video stream's size, rate and codec, and whether audio exists. */
export function parseFfmpegInfo(stderr: string): ProbeInfo {
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const video = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video: ([^\n]*)/.exec(stderr)?.[1] ?? null
  const size = video ? /(?:^|[ ,])(\d{2,5})x(\d{2,5})(?:[ ,\[]|$)/.exec(video) : null
  const fps = video ? /([\d.]+) fps/.exec(video) ?? /([\d.]+) tbr/.exec(video) : null
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    fps: fps ? Number(fps[1]) : null,
    hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(stderr),
    codec: video ? (/^(\w+)/.exec(video)?.[1] ?? null) : null
  }
}

/** Reads ffprobe's JSON (`-show_streams -show_format`). */
export function parseFfprobeJson(json: string): ProbeInfo {
  const data = JSON.parse(json) as {
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string }[]
    format?: { duration?: string }
  }
  const v = data.streams?.find((s) => s.codec_type === 'video')
  const rate = (r?: string) => {
    if (!r) return null
    const [a, b] = r.split('/').map(Number)
    return b ? a / b : a || null
  }
  const duration = Number(data.format?.duration ?? v?.duration)
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: rate(v?.avg_frame_rate) || rate(v?.r_frame_rate),
    hasAudio: !!data.streams?.some((s) => s.codec_type === 'audio'),
    codec: v?.codec_name ?? null
  }
}

const probeCache = new Map<string, ProbeInfo>()

/** Probes a clip (cached per path + size + mtime). ffprobe when there is one, else ffmpeg's banner. */
export async function probe(path: string, ffmpeg: string | null = findFfmpeg()): Promise<ProbeInfo | null> {
  let key: string
  try {
    const s = statSync(path)
    key = `${path}|${s.size}|${s.mtimeMs}`
  } catch {
    return null
  }
  const hit = probeCache.get(key)
  if (hit) return hit
  if (!ffmpeg) return null
  const ffprobe = findFfprobe(ffmpeg)
  let info: ProbeInfo | null = null
  if (ffprobe) {
    const r = await runTool(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path])
    if (r.code === 0) {
      try {
        info = parseFfprobeJson(r.stdout)
      } catch {
        info = null
      }
    }
  }
  if (!info) {
    const r = await runTool(ffmpeg, ['-hide_banner', '-i', path])
    info = parseFfmpegInfo(r.stderr)
    if (info.duration === null && info.width === null) return null
  }
  probeCache.set(key, info)
  if (probeCache.size > 5000) probeCache.delete(probeCache.keys().next().value!)
  return info
}

/** Probes many files, `limit` at a time. */
export async function probeAll(paths: string[], limit = 4, ffmpeg: string | null = findFfmpeg()): Promise<Map<string, ProbeInfo | null>> {
  const out = new Map<string, ProbeInfo | null>()
  let next = 0
  const worker = async () => {
    while (next < paths.length) {
      const p = paths[next++]
      out.set(p, await probe(p, ffmpeg).catch(() => null))
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, paths.length) }, worker))
  return out
}

/** A running ffmpeg that can be killed (export cancel). Resolves with stderr; rejects with the error tail. */
export function spawnFfmpeg(
  bin: string,
  args: string[],
  opts: { onProgress?: (outTimeSeconds: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let buf = ''
    const abort = () => child.kill('SIGKILL')
    opts.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        const m = /^out_time_(?:ms|us)=(\d+)/.exec(line)
        if (m && opts.onProgress) opts.onProgress(Number(m[1]) / 1e6)
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024)
    })
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', abort)
      if (opts.signal?.aborted) reject(new CancelledError())
      else if (code === 0) resolve()
      else reject(new Error(errorTail(stderr, `ffmpeg exited with code ${code}`)))
    })
  })
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
  }
}
