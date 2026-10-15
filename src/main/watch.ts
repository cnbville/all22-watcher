import { createHash } from 'node:crypto'
import { existsSync, type FSWatcher, watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { matchGameName } from '@shared/gameMatch'
import { gameTitle, weekName } from '@shared/labels'
import { extensionOf, VIDEO_EXTENSIONS } from '@shared/matching'
import type { GameInfo, ImportLogEntry, WatchStatus } from '@shared/types'
import { convertClips } from './convert'
import { broadcast, changed, startActivity } from './events'
import { findFfmpeg } from './ffmpeg'
import type { Library } from './library'

/**
 * Watch-folder auto-import (improvement 13). Each subfolder of the watch folder is one game ("DAL at PHI",
 * "2025 Wk 1 DAL @ PHI"). A folder is imported once its contents have stopped changing for the settle delay, through
 * the same matching path as Import Film; it is imported again when its contents change. Folders are found by
 * fs.watch and by a rescan every minute (fs.watch misses changes on some network and external drives).
 */

export const SETTLE_MS = 10_000

const isInside = (path: string, dir: string) => path.startsWith(dir.endsWith(sep) ? dir : dir + sep)
export const RESCAN_MS = 60_000
/** Files a copy or download is still writing. */
const PARTIAL = /\.(part|partial|crdownload|download|tmp)$/i

export interface FolderSnapshot {
  /** Hash of every video's relative path, size and modified time; '' when the folder holds no videos. */
  signature: string
  videos: number
  /** A file is still being written (partial download, or a file modified within the settle delay). */
  busy: boolean
}

/** Reads a game folder's videos (any depth) into a signature that changes whenever a clip is added, removed or rewritten. */
export async function snapshotFolder(dir: string, now = Date.now(), settleMs = SETTLE_MS): Promise<FolderSnapshot> {
  const parts: string[] = []
  let busy = false
  const walk = async (d: string) => {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (PARTIAL.test(e.name)) busy = true
      else if (VIDEO_EXTENSIONS.includes(extensionOf(p))) {
        try {
          const s = await stat(p)
          if (now - s.mtimeMs < settleMs) busy = true
          parts.push(`${relative(dir, p)}\t${s.size}\t${Math.round(s.mtimeMs)}`)
        } catch {
          busy = true
        }
      }
    }
  }
  await walk(dir)
  parts.sort()
  return {
    signature: parts.length ? createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16) : '',
    videos: parts.length,
    busy
  }
}

export interface WatchOptions {
  settleMs?: number
  rescanMs?: number
  /** Whether to use fs.watch (tests turn it off and call scan()). */
  fsWatch?: boolean
  today?: () => string
}

interface Pending {
  signature: string
  since: number
}

export class WatchFolder {
  private folder: string | null = null
  private paused = false
  private watcher: FSWatcher | null = null
  private rescan: ReturnType<typeof setInterval> | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private pending = new Map<string, Pending>()
  private unmatched = new Map<string, { signature: string; reason: string }>()
  private lastChecked: string | null = null
  private current: WatchStatus['current'] = null
  private scanning: Promise<void> | null = null
  private rescanAgain = false
  private cancelCurrent: (() => void) | null = null
  private readonly settleMs: number

  constructor(
    private library: Library,
    private opts: WatchOptions = {}
  ) {
    this.settleMs = opts.settleMs ?? SETTLE_MS
  }

  /** Reads the watch-folder settings and (re)starts or stops watching. Call after settings change. */
  configure() {
    const s = this.library.store.settings()
    const folder = s.watchFolder || null
    const changedFolder = folder !== this.folder
    this.folder = folder
    this.paused = s.watchPaused
    if (changedFolder) {
      this.pending.clear()
      this.unmatched.clear()
    }
    this.stopWatching()
    if (folder && !this.paused) {
      this.startWatching(folder)
      void this.scan()
    }
    this.push()
  }

  stop() {
    this.stopWatching()
    this.cancelCurrent?.()
  }

  private startWatching(folder: string) {
    this.startFsWatch(folder)
    this.rescan = setInterval(() => void this.scan(), this.opts.rescanMs ?? RESCAN_MS)
    this.rescan.unref?.()
  }

  /** fs.watch on the folder, when it exists. A folder that was missing (an unplugged drive) gets one once it's back. */
  private startFsWatch(folder: string) {
    if (this.watcher || this.opts.fsWatch === false || !existsSync(folder)) return
    try {
      this.watcher = watch(folder, { recursive: true }, () => this.soon())
      this.watcher.on('error', () => this.stopFsWatch())
    } catch {
      // Recursive watching isn't available everywhere; the rescan still finds new folders.
      try {
        this.watcher = watch(folder, () => this.soon())
        this.watcher.on('error', () => this.stopFsWatch())
      } catch {
        this.watcher = null
      }
    }
  }

  private stopFsWatch() {
    this.watcher?.close()
    this.watcher = null
  }

  private stopWatching() {
    this.stopFsWatch()
    if (this.rescan) clearInterval(this.rescan)
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.rescan = null
    this.settleTimer = null
  }

  /** A change was seen: scan once things have had the settle delay to finish. */
  private soon(delay = this.settleMs + 250) {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.scan()
    }, delay)
    this.settleTimer.unref?.()
  }

  status(): WatchStatus {
    const folder = this.folder
    const films = this.library.store.filmGames()
    return {
      folder,
      folderName: folder ? basename(folder) : null,
      state: !folder ? 'off' : this.paused ? 'paused' : !existsSync(folder) ? 'missing' : this.current ? 'importing' : 'watching',
      lastChecked: this.lastChecked,
      current: this.current,
      justImported: films.filter((f) => f.source === 'watch' && !f.openedAt).length,
      recent: this.library.store.importLog(5, 'watch'),
      unmatched: [...this.unmatched.entries()].map(([f, u]) => ({ folder: basename(f), reason: u.reason }))
    }
  }

  private push() {
    broadcast({ type: 'watchStatus', status: this.status() })
  }

  /** Scans every game folder now ("Check Now"); a scan already running is followed by one more. */
  async scan(): Promise<WatchStatus> {
    if (this.scanning) {
      this.rescanAgain = true
      await this.scanning
      return this.status()
    }
    this.scanning = this.runScan().finally(() => (this.scanning = null))
    await this.scanning
    if (this.rescanAgain) {
      this.rescanAgain = false
      return this.scan()
    }
    return this.status()
  }

  private async runScan() {
    const folder = this.folder
    if (!folder || this.paused) return
    this.lastChecked = new Date().toISOString()
    if (!existsSync(folder)) {
      // A watcher on a folder that went away sees nothing when it comes back.
      this.stopFsWatch()
      this.push()
      return
    }
    this.startFsWatch(folder)
    let dirs: string[]
    try {
      dirs = (await readdir(folder, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => join(folder, e.name))
    } catch {
      this.push()
      return
    }
    const now = Date.now()
    let waiting = false
    for (const dir of dirs.sort()) {
      if (this.folder !== folder || this.paused) return
      const snap = await snapshotFolder(dir, now, this.settleMs)
      if (!snap.signature) {
        this.pending.delete(dir)
        continue
      }
      const last = this.library.store.lastWatchImport(dir)
      if (last?.signature === snap.signature) continue
      if (this.unmatched.get(dir)?.signature === snap.signature) continue
      const p = this.pending.get(dir)
      if (snap.busy || !p || p.signature !== snap.signature) {
        this.pending.set(dir, { signature: snap.signature, since: p?.signature === snap.signature ? p.since : now })
        waiting = true
        continue
      }
      if (now - p.since < this.settleMs) {
        waiting = true
        continue
      }
      this.pending.delete(dir)
      await this.importFolder(dir, snap.signature, last)
    }
    if (waiting) this.soon(this.settleMs)
    this.push()
  }

  /** Every game in downloaded seasons, for matching folder names. */
  private async schedule(): Promise<GameInfo[]> {
    const out: GameInfo[] = []
    for (const season of await this.library.downloadedSeasons()) {
      const data = await this.library.seasonOrNull(season)
      if (data) out.push(...data.games)
    }
    return out
  }

  private async importFolder(dir: string, signature: string, last: ImportLogEntry | null) {
    const name = basename(dir)
    const store = this.library.store
    const filmed = new Set(store.filmGames().map((f) => f.gameId))
    let game: GameInfo | null = null
    if (last?.gameId) {
      // A folder imported before keeps its game when its clips change.
      game = await this.library.gameInfo(last.gameId)
    } else {
      const match = matchGameName(name, await this.schedule(), { hasFilm: (id) => filmed.has(id), today: this.opts.today?.() })
      if (!match.game) {
        this.unmatched.set(dir, { signature, reason: match.reason ?? 'No game matches the folder name.' })
        return
      }
      // Film that came from this very folder is the same import again: the app quit before it was logged.
      const fromHere = filmed.has(match.game.gameId) && store.clipsForGame(match.game.gameId).some((c) => isInside(c.path, dir))
      if (filmed.has(match.game.gameId) && !fromHere) {
        this.unmatched.set(dir, { signature, reason: `${gameTitle(match.game)} (${weekName(match.game)}, ${match.game.season}) already has film. Import it from the Film screen to replace it.` })
        return
      }
      game = match.game
    }
    this.unmatched.delete(dir)
    const title = gameTitle(game)
    let cancelled = false
    const activity = startActivity({ kind: 'import', title: `Importing ${title}`, route: `/film/${game.gameId}` }, () => {
      cancelled = true
    })
    this.cancelCurrent = () => (cancelled = true)
    this.current = { title, done: 0, total: 0 }
    this.push()
    const fail = (error: string) => {
      store.logImport({ folder: dir, gameId: game!.gameId, team: null, source: 'watch', state: 'failed', clipCount: 0, playCount: 0, suspectClips: 0, error, signature })
      activity.fail(error, { notification: { title: 'Couldn’t import a game', body: `${name}: ${error}`, route: '/film' } })
    }
    try {
      let preview = await this.library.previewMatch(game.gameId, [dir])
      if (preview.unsupported.length) {
        const ffmpeg = findFfmpeg()
        if (ffmpeg) {
          activity.update({ detail: `Converting ${preview.unsupported.length} clips`, done: 0, total: preview.unsupported.length })
          await convertClips(
            ffmpeg,
            preview.unsupported,
            this.library.convertedDir(game.gameId),
            (done, total) => {
              this.current = { title, done, total }
              activity.update({ detail: `Converting ${done} of ${total}`, done, total })
              this.push()
            },
            () => cancelled
          )
          preview = await this.library.previewMatch(game.gameId, [dir])
        }
      }
      if (cancelled) {
        activity.cancelled()
        // Not logged: the next scan tries again.
        this.pending.delete(dir)
        return
      }
      const matched = preview.rows.filter((r) => r.playId !== null)
      if (!matched.length) {
        fail(preview.warnings[0] ?? 'None of the clips could be matched to plays.')
        return
      }
      const myTeams = store.settings().myTeams
      const team = myTeams.find((t) => t === game!.homeTeam || t === game!.awayTeam) ?? store.studiedTeams().get(game.gameId) ?? game.homeTeam
      const alignment = await this.library.importClips(game.gameId, team, preview.rows, 'watch')
      const plays = new Set(matched.map((r) => r.playId)).size
      const suspects = alignment?.suspects.length ?? 0
      store.logImport({ folder: dir, gameId: game.gameId, team, source: 'watch', state: 'done', clipCount: matched.length, playCount: plays, suspectClips: suspects, error: null, signature })
      activity.done({
        detail: `${matched.length} clips`,
        notification: {
          title: `Imported ${title}`,
          body: `${weekName(game)} · ${matched.length} clips matched to ${plays} plays${suspects ? ` · ${suspects} need a check` : ''}`,
          route: `/film/${game.gameId}?team=${team}`
        }
      })
      changed('film')
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    } finally {
      this.current = null
      this.cancelCurrent = null
      this.push()
    }
  }
}
