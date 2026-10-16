import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { TEAM_BY_ABBR } from '@shared/teams'
import { FILES, type Fetcher, parseCsv, team } from './nflverse'

/**
 * Team logos (`tape://logo/<abbr>`): nflverse's team list names each team's logo image; the first request for a team
 * downloads it into `<userData>/logos/<abbr>.png` and later requests read the file. A failed download is retried on the
 * next app launch, not on every request.
 */
export class LogoCache {
  private urls: Promise<Map<string, string>> | null = null
  private inflight = new Map<string, Promise<string | null>>()
  private failed = new Set<string>()

  constructor(
    readonly dir: string,
    private readonly fetcher: Fetcher
  ) {}

  /** Path to the team's logo on disk, downloading it first if needed; null when it can't be had. */
  async get(abbr: string): Promise<string | null> {
    if (!TEAM_BY_ABBR[abbr]) return null
    const file = join(this.dir, `${abbr}.png`)
    if (existsSync(file)) return file
    if (this.failed.has(abbr)) return null
    let job = this.inflight.get(abbr)
    if (!job) {
      job = this.download(abbr, file)
        .catch(() => null)
        .then((path) => {
          if (!path) this.failed.add(abbr)
          this.inflight.delete(abbr)
          return path
        })
      this.inflight.set(abbr, job)
    }
    return job
  }

  async read(abbr: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const file = await this.get(abbr)
    return file ? new Uint8Array(await readFile(file)) : null
  }

  private logoUrls(): Promise<Map<string, string>> {
    if (!this.urls) {
      this.urls = (async () => {
        const map = new Map<string, string>()
        const stream = await this.fetcher(FILES.teams())
        if (!stream) return map
        await parseCsv(stream, false, (r) => {
          const abbr = team(r.team_abbr)
          const url = r.team_logo_espn || r.team_logo_wikipedia
          if (abbr && url && !map.has(abbr)) map.set(abbr, url)
        })
        return map
      })()
      this.urls.catch(() => (this.urls = null))
    }
    return this.urls
  }

  private async download(abbr: string, file: string): Promise<string | null> {
    const url = (await this.logoUrls()).get(abbr)
    if (!url) return null
    const stream = await this.fetcher(url)
    if (!stream) return null
    const bytes = await readAll(stream)
    if (!isPng(bytes)) return null
    await mkdir(this.dir, { recursive: true })
    const tmp = `${file}.partial`
    await writeFile(tmp, bytes)
    await rename(tmp, file)
    return file
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks)
}

const PNG = [0x89, 0x50, 0x4e, 0x47]
export const isPng = (b: Uint8Array): boolean => b.length > 8 && PNG.every((v, i) => b[i] === v)
