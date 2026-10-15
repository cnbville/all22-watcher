import type { DataProgress, DataStatus, GameInfo, SeasonStatus } from '@shared/types'
import { weekName } from '@shared/labels'
import { broadcast, changed, startActivity } from './events'
import { currentSeason, type Library } from './library'
import { seasonStatuses } from './nflverse'

/**
 * Season data auto-update (improvement 16): during the season (Aug 1 – Feb 28) the season's cached data is
 * re-downloaded on launch and every 6 hours once it is more than 12 hours old. Failures are quiet: the sidebar's data
 * row says "Couldn’t update" and the next check tries again.
 */

export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000

/** Whether `date` falls in a season's update window, Aug 1 through the end of February. */
export function inSeasonWindow(date: Date): boolean {
  const m = date.getMonth()
  return m >= 7 || m <= 1
}

/** The season the window around `date` belongs to: Aug–Dec of year N and Jan–Feb of N+1 are season N. */
export function windowSeason(date: Date): number {
  return date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1
}

/** Whether a cached season should be re-downloaded now. */
export function needsUpdate(status: Pick<SeasonStatus, 'downloaded' | 'downloadedAt'>, now: Date, staleMs = STALE_AFTER_MS): boolean {
  if (!status.downloaded) return false
  if (!status.downloadedAt) return true
  const at = Date.parse(status.downloadedAt)
  return !Number.isFinite(at) || now.getTime() - at > staleMs
}

/** Games that gained a final score between two copies of a schedule. */
export function newlyScored(before: GameInfo[], after: GameInfo[]): GameInfo[] {
  const had = new Set(before.filter((g) => g.homeScore !== null).map((g) => g.gameId))
  return after.filter((g) => g.homeScore !== null && !had.has(g.gameId))
}

export interface SeasonUpdaterOptions {
  now?: () => Date
  intervalMs?: number
  staleMs?: number
}

export class SeasonUpdater {
  private timer: ReturnType<typeof setInterval> | null = null
  private progress = new Map<number, DataProgress>()
  private errors = new Map<number, string>()
  private readonly now: () => Date

  constructor(
    private library: Library,
    private opts: SeasonUpdaterOptions = {}
  ) {
    this.now = opts.now ?? (() => new Date())
  }

  /** Checks now (on launch) and every 6 hours. */
  start() {
    this.stop()
    void this.check()
    this.timer = setInterval(() => void this.check(), this.opts.intervalMs ?? UPDATE_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** The season the sidebar row describes: the window's season when downloaded, else the app's current season. */
  async defaultSeason(): Promise<number> {
    const now = this.now()
    const ws = windowSeason(now)
    const downloaded = await this.library.downloadedSeasons()
    return downloaded.includes(ws) ? ws : currentSeason(now)
  }

  async status(season?: number): Promise<DataStatus> {
    const s = season ?? (await this.defaultSeason())
    const status = await this.statusOf(s)
    const p = this.progress.get(s)
    const updating = this.library.isDownloading(s)
    const error = this.errors.get(s) ?? null
    return {
      season: s,
      state: updating ? 'updating' : error ? 'failed' : status.downloaded ? 'upToDate' : 'notDownloaded',
      downloadedAt: status.downloadedAt,
      hasParticipation: status.hasParticipation,
      step: updating ? (p?.step ?? null) : null,
      done: updating ? (p?.done ?? 0) : 0,
      total: updating ? (p?.total ?? 0) : 0,
      error,
      autoUpdate: this.library.store.settings().autoUpdateSeasons,
      inSeason: inSeasonWindow(this.now()) && s === windowSeason(this.now())
    }
  }

  private async statusOf(season: number): Promise<SeasonStatus> {
    const [status] = await seasonStatuses(this.library.cacheDir, [season])
    return status
  }

  private async push(season: number) {
    broadcast({ type: 'dataStatus', status: await this.status(season) })
  }

  /** The automatic check: in the window, with auto-update on, the window's season when cached and stale. */
  async check(): Promise<boolean> {
    const now = this.now()
    if (!this.library.store.settings().autoUpdateSeasons || !inSeasonWindow(now)) return false
    const season = windowSeason(now)
    const status = await this.statusOf(season)
    if (!needsUpdate(status, now, this.opts.staleMs)) return false
    await this.download(season, { quiet: true }).catch(() => undefined)
    return true
  }

  /** "Update Now" in Settings and the data row: re-downloads whatever its age. */
  async updateNow(season?: number): Promise<DataStatus> {
    const s = season ?? (await this.defaultSeason())
    await this.download(s, { quiet: false }).catch(() => undefined)
    return this.status(s)
  }

  /**
   * Downloads a season as an activity, keeping the data row's progress. `quiet` (automatic updates) fails without a
   * notification; manual downloads reject with the error so the caller can show it.
   */
  async download(season: number, { quiet }: { quiet: boolean }): Promise<SeasonStatus> {
    const before = (await this.library.seasonOrNull(season))?.games ?? []
    const wasDownloaded = before.length > 0
    const joining = this.library.isDownloading(season)
    const activity = joining
      ? null
      : startActivity({ kind: 'download', title: wasDownloaded ? `Updating ${season} data` : `Downloading ${season} data` })
    this.errors.delete(season)
    try {
      const status = await this.library.downloadSeason(season, (p) => {
        this.progress.set(season, p)
        activity?.update({ detail: p.step, done: p.done, total: p.total })
        broadcast({ type: 'dataStatus', status: this.statusSync(season, p) })
      })
      this.progress.delete(season)
      const after = (await this.library.seasonOrNull(season))?.games ?? []
      const added = wasDownloaded ? newlyScored(before, after) : []
      const latest = added.sort((a, b) => b.week - a.week)[0]
      activity?.done({
        notification: latest ? { title: `${season} data updated`, body: `${weekName(latest)} games added` } : undefined
      })
      changed('season')
      await this.push(season)
      return status
    } catch (e) {
      this.progress.delete(season)
      const message = e instanceof Error ? e.message : String(e)
      this.errors.set(season, message)
      activity?.fail(message, quiet ? {} : { notification: { title: `Couldn’t download ${season} data`, body: message } })
      await this.push(season)
      throw e
    }
  }

  /** A status while a download reports progress (no disk reads). */
  private statusSync(season: number, p: DataProgress): DataStatus {
    const now = this.now()
    return {
      season,
      state: 'updating',
      downloadedAt: null,
      hasParticipation: false,
      step: p.step,
      done: p.done,
      total: p.total,
      error: null,
      autoUpdate: this.library.store.settings().autoUpdateSeasons,
      inSeason: inSeasonWindow(now) && season === windowSeason(now)
    }
  }
}
