#!/usr/bin/env node
// Downloads the static macOS ffmpeg builds bundled with the app into resources/ffmpeg/<arch>/ffmpeg (gitignored).
// electron-builder copies resources/ffmpeg/${arch} into each dmg, so every build carries only its own binary.
//
//   node scripts/fetch-ffmpeg.mjs            both arm64 and x64
//   node scripts/fetch-ffmpeg.mjs arm64      one architecture
//   FORCE=1 node scripts/fetch-ffmpeg.mjs    download again even when present
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const RELEASE = 'b6.1.1'
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`
const ARCHES = ['arm64', 'x64']
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const wanted = process.argv.slice(2).filter((a) => ARCHES.includes(a))
const arches = wanted.length ? wanted : ARCHES

async function fetchOne(arch) {
  const out = join(root, 'resources', 'ffmpeg', arch, 'ffmpeg')
  if (!process.env.FORCE && existsSync(out) && statSync(out).size > 1_000_000) {
    console.log(`ffmpeg ${arch}: already present`)
    return
  }
  const url = `${BASE}/ffmpeg-darwin-${arch}.gz`
  console.log(`ffmpeg ${arch}: downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`ffmpeg ${arch}: download failed (${res.status} ${res.statusText})`)
  const binary = gunzipSync(Buffer.from(await res.arrayBuffer()))
  // Mach-O magic numbers (64-bit, either byte order) so a proxy error page never ships as the binary.
  const magic = binary.readUInt32LE(0)
  if (magic !== 0xfeedfacf && magic !== 0xcffaedfe) throw new Error(`ffmpeg ${arch}: the download isn’t a macOS executable`)
  mkdirSync(dirname(out), { recursive: true })
  const tmp = `${out}.partial`
  writeFileSync(tmp, binary)
  chmodSync(tmp, 0o755)
  rmSync(out, { force: true })
  renameSync(tmp, out)
  console.log(`ffmpeg ${arch}: ${(binary.length / 1e6).toFixed(1)} MB → ${out}`)
}

for (const arch of arches) {
  try {
    await fetchOne(arch)
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
