import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

const CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']

/** Finds an ffmpeg install (Homebrew or system), or null when there isn't one. */
export function findFfmpeg(): string | null {
  const override = process.env.ALL22_FFMPEG
  if (override && existsSync(override)) return override
  return CANDIDATES.find((p) => existsSync(p)) ?? null
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(stderr.split('\n').filter(Boolean).slice(-2).join(' ') || err.message))
      else resolve()
    })
  })
}

/** Where a converted copy of `input` goes: keeps the clip's folder name so angle detection still works. */
export function convertedPath(input: string, outDir: string): string {
  const folder = basename(dirname(input))
  return join(outDir, folder, basename(input).replace(/\.[^.]+$/, '') + '.mp4')
}

/**
 * Turns clips the player can't open (MKV, AVI, TS…) into MP4s under `outDir`. Tries a fast
 * remux first, which works when the video is already H.264, and re-encodes only when that fails.
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
    await mkdir(dirname(out), { recursive: true })
    try {
      try {
        await run(ffmpeg, ['-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', out])
      } catch {
        await rm(out, { force: true })
        await run(ffmpeg, [
          '-y', '-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a?',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-movflags', '+faststart', out
        ])
      }
      converted.push(out)
    } catch (e) {
      failed.push({ path: input, error: e instanceof Error ? e.message : String(e) })
    }
    onProgress(i + 1, inputs.length)
  }
  return { converted, failed }
}
