import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { angleSource } from '@shared/matching'
import { probe } from './ffmpeg'

/** Video codecs Chromium on macOS can play from an MP4, so they can be copied without re-encoding. */
const COPYABLE = new Set(['h264', 'hevc'])

/** Finds ffmpeg: ALL22_FFMPEG, then the bundled binary, then Homebrew or the system's. */
export { findFfmpeg } from './ffmpeg'

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
  if (!existsSync(ffprobe)) {
    // The bundled build has no ffprobe; ffmpeg's own banner names the codec.
    return (await probe(input, ffmpeg))?.codec ?? null
  }
  try {
    const out = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', input])
    return out.trim().split('\n')[0] || null
  } catch {
    return null
  }
}

const folderHash = (dir: string) => createHash('sha1').update(dir).digest('hex').slice(0, 8)

/** The file in each hash folder that names the source folder its copies came from. */
const SOURCE_RECORD = '.source'

async function recordSource(source: string, outDir: string) {
  const record = join(outDir, folderHash(source), SOURCE_RECORD)
  if ((await readFile(record, 'utf8').catch(() => '')) !== source) await writeFile(record, source)
}

/**
 * Where a converted copy of `input` goes. A hash of the source folder keeps copies of
 * same-named clips from different folders apart. The clip's own folder name, and any folders
 * up to the one that names its camera angle, are kept so the copy is detected and sorted like the original.
 */
export function convertedPath(input: string, outDir: string): string {
  const source = dirname(input)
  const folders = source.split(sep).filter(Boolean).slice(-Math.max(1, angleSource(input).depth))
  return join(outDir, folderHash(source), ...folders, `${basename(input)}.mp4`)
}

/**
 * The converted copy of `input`, or null when there isn't one. Earlier versions kept more or fewer of the source
 * folders under the same hash (only the clip's own folder, or up to an angle folder they detected differently); a copy
 * found there is hard-linked into place rather than moved, so clips already saved with the old path keep playing.
 */
export async function findConverted(input: string, outDir: string): Promise<string | null> {
  const copy = convertedPath(input, outDir)
  const source = dirname(input)
  let found = copy
  if (!existsSync(copy)) {
    const folders = source.split(sep).filter(Boolean)
    // Everything under the hash came from this clip's folder, however many folder names were kept.
    const old = folders.map((_, i) => join(outDir, folderHash(source), ...folders.slice(-1 - i), basename(copy))).find((p) => existsSync(p))
    if (!old) return null
    await mkdir(dirname(copy), { recursive: true })
    await link(old, copy).catch(() => {})
    found = existsSync(copy) ? copy : old
  }
  // Copies made before the source folder was recorded get it now, so they can be traced back once saved.
  await recordSource(source, outDir).catch(() => {})
  return found
}

/**
 * The clip a converted copy was made from, or null when that can't be told. Each hash folder records its source folder;
 * for copies made before that, the folders of `near` (the game's other clips) and the ones above them are tried.
 */
export async function convertedFrom(copy: string, outDir: string, near: string[] = []): Promise<string | null> {
  const [hash, ...folders] = relative(outDir, copy).split(sep)
  const name = folders.pop()
  if (!name?.endsWith('.mp4')) return null
  const recorded = await readFile(join(outDir, hash, SOURCE_RECORD), 'utf8').catch(() => '')
  const above = (dir: string): string[] => (dirname(dir) === dir ? [dir] : [dir, ...above(dirname(dir))])
  const guesses = [...new Set(near.map(dirname))].flatMap(above).map((dir) => join(dir, ...folders))
  const source = [recorded, ...guesses].find((s) => s && folderHash(s) === hash)
  return source ? join(source, name.slice(0, -'.mp4'.length)) : null
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
    await recordSource(dirname(input), outDir)
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
