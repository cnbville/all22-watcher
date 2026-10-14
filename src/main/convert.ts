import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { angleSource } from '@shared/matching'

const CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']

/** Video codecs Chromium on macOS can play from an MP4, so they can be copied without re-encoding. */
const COPYABLE = new Set(['h264', 'hevc'])

/** Finds an ffmpeg install (Homebrew or system), or null when there isn't one. */
export function findFfmpeg(): string | null {
  const override = process.env.ALL22_FFMPEG
  if (override && existsSync(override)) return override
  return CANDIDATES.find((p) => existsSync(p)) ?? null
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.split('\n').filter(Boolean).slice(-2).join(' ') || err.message))
      else resolve(stdout)
    })
  })
}

/** The first video stream's codec name, or null when it can't be read (no ffprobe, odd file). */
async function videoCodec(ffmpeg: string, input: string): Promise<string | null> {
  const ffprobe = join(dirname(ffmpeg), 'ffprobe')
  if (!existsSync(ffprobe)) return null
  try {
    const out = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', input])
    return out.trim().split('\n')[0] || null
  } catch {
    return null
  }
}

/**
 * Where a converted copy of `input` goes. A hash of the source folder keeps copies of
 * same-named clips from different folders apart. The clip's own folder name, and any folders
 * up to the one that names its camera angle, are kept so the copy is detected and sorted like the original.
 */
export function convertedPath(input: string, outDir: string): string {
  const source = dirname(input)
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 8)
  const folders = source.split(sep).filter(Boolean).slice(-Math.max(1, angleSource(input).depth))
  return join(outDir, hash, ...folders, `${basename(input)}.mp4`)
}

/**
 * Turns clips the player can't open (MKV, AVI, TS…) into MP4s under `outDir`. H.264/HEVC video is
 * copied into the new container as-is (fast); anything else is re-encoded to H.264.
 */
export async function convertClips(
  ffmpeg: string,
  inputs: string[],
  outDir: string,
  onProgress: (done: number, total: number) => void = () => {}
): Promise<{ converted: string[]; failed: { path: string; error: string }[] }> {
  const converted: string[] = []
  const failed: { path: string; error: string }[] = []
  for (const [i, input] of inputs.entries()) {
    const out = convertedPath(input, outDir)
    // Write under a temporary name so a failed or interrupted conversion never looks finished, unique
    // so two runs over the same clip can't write into each other's file.
    const tmp = `${out}.${randomBytes(4).toString('hex')}.partial.mp4`
    await mkdir(dirname(out), { recursive: true })
    try {
      const codec = await videoCodec(ffmpeg, input)
      const video =
        codec && COPYABLE.has(codec)
          ? ['-c:v', 'copy', ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : [])]
          : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']
      await run(ffmpeg, ['-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a?', ...video, '-c:a', 'aac', '-movflags', '+faststart', tmp])
      await rename(tmp, out)
      converted.push(out)
    } catch (e) {
      await rm(tmp, { force: true })
      failed.push({ path: input, error: e instanceof Error ? e.message : String(e) })
    }
    onProgress(i + 1, inputs.length)
  }
  return { converted, failed }
}
