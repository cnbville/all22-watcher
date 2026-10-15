import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { LogoCache } from './logos'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const CSV = 'team_abbr,team_logo_espn,team_logo_wikipedia\nKC,https://img.test/kc.png,\nLAR,https://img.test/lar.png,\n'

function fetcher(files: Record<string, Buffer | string>, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url)
    const hit = Object.entries(files).find(([k]) => url.endsWith(k))
    return hit ? Readable.from([Buffer.from(hit[1])]) : null
  }
}

describe('LogoCache', () => {
  it('downloads a logo once and serves it from disk after', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'logos-'))
    const calls: string[] = []
    const cache = new LogoCache(dir, fetcher({ 'teams_colors_logos.csv': CSV, 'kc.png': PNG_BYTES }, calls))
    expect(await cache.get('KC')).toBe(join(dir, 'KC.png'))
    expect(await cache.read('KC')).toEqual(new Uint8Array(PNG_BYTES))
    await cache.get('KC')
    expect(calls.filter((c) => c.endsWith('kc.png'))).toHaveLength(1)
  })

  it('maps old team codes to current ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'logos-'))
    const cache = new LogoCache(dir, fetcher({ 'teams_colors_logos.csv': CSV, 'lar.png': PNG_BYTES }))
    expect(await cache.get('LA')).toBe(join(dir, 'LA.png'))
  })

  it('returns null for unknown teams, missing logos and non-images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'logos-'))
    const cache = new LogoCache(dir, fetcher({ 'teams_colors_logos.csv': CSV, 'kc.png': '<html>' }))
    expect(await cache.get('XYZ')).toBeNull()
    expect(await cache.get('KC')).toBeNull()
    expect(await cache.get('BUF')).toBeNull()
  })

  it('uses a logo already on disk without touching the network', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'logos-'))
    await writeFile(join(dir, 'SF.png'), PNG_BYTES)
    const calls: string[] = []
    const cache = new LogoCache(dir, fetcher({}, calls))
    expect(await cache.get('SF')).toBe(join(dir, 'SF.png'))
    expect(calls).toHaveLength(0)
  })
})
