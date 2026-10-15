import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiEvent } from '@shared/api'
import { makeGame } from '@shared/fixtures'
import { Store } from './db'
import { addEventSink } from './events'
import { Library } from './library'
import { mirrorFetcher } from './nflverse'
import { inSeasonWindow, needsUpdate, newlyScored, SeasonUpdater, windowSeason } from './seasonUpdate'
import { snapshotFolder, WatchFolder } from './watch'

const csv = (rows: Record<string, string | number>[]) => {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return [cols.join(','), ...rows.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n') + '\n'
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const OLD = new Date('2025-01-01T00:00:00Z')

async function library(): Promise<{ lib: Library; dir: string; mirror: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'all22-watch-'))
  const mirror = join(dir, 'mirror')
  await mkdir(mirror)
  const game = (game_id: string, week: number, away_team: string, home_team: string, gameday: string) =>
    ({ game_id, season: 2025, week, game_type: 'REG', gameday, away_team, home_team, away_score: 20, home_score: 24 })
  await writeFile(join(mirror, 'games.csv'), csv([game('2025_01_DAL_PHI', 1, 'DAL', 'PHI', '2025-09-04'), game('2025_09_PHI_DAL', 9, 'PHI', 'DAL', '2025-11-02')]))
  const plays = [1, 2, 3].map((n) => ({ game_id: '2025_01_DAL_PHI', play_id: n * 10, posteam: 'PHI', defteam: 'DAL', play_type: 'run', rush: 1, qtr: 1, time: '10:00', down: 1, ydstogo: 10 }))
  await writeFile(join(mirror, 'play_by_play_2025.csv.gz'), gzipSync(csv(plays)))
  const store = await Store.open(join(dir, 'grades.sqlite'))
  const lib = new Library(store, join(dir, 'cache'), mirrorFetcher(mirror))
  await lib.downloadSeason(2025, () => {})
  return { lib, dir, mirror }
}

/** A game folder of fake clips, written long ago so they read as settled. */
async function gameFolder(root: string, name: string, clips: number, old = true) {
  for (const angle of ['Sideline', 'End Zone']) {
    await mkdir(join(root, name, angle), { recursive: true })
    for (let i = 1; i <= clips; i++) {
      const p = join(root, name, angle, `Play ${i}.mp4`)
      await writeFile(p, `clip ${angle} ${i}`)
      if (old) await utimes(p, OLD, OLD)
    }
  }
}

let stops: (() => void)[] = []
afterEach(() => {
  for (const s of stops) s()
  stops = []
})

describe('snapshotFolder', () => {
  it('changes signature when clips change and notices files still being written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'all22-snap-'))
    await gameFolder(root, 'DAL at PHI', 2)
    const a = await snapshotFolder(join(root, 'DAL at PHI'))
    expect(a).toMatchObject({ videos: 4, busy: false })
    expect(await snapshotFolder(join(root, 'DAL at PHI'))).toEqual(a)
    await writeFile(join(root, 'DAL at PHI', 'Sideline', 'Play 3.mp4.crdownload'), 'x')
    const b = await snapshotFolder(join(root, 'DAL at PHI'))
    expect(b.busy).toBe(true)
    await writeFile(join(root, 'DAL at PHI', 'Sideline', 'Play 3.mp4'), 'x')
    const c = await snapshotFolder(join(root, 'DAL at PHI'))
    expect(c.signature).not.toBe(a.signature)
    expect(c.busy).toBe(true)
    expect((await snapshotFolder(join(root, 'nothing'))).signature).toBe('')
  })
})

describe('WatchFolder', () => {
  it('imports a settled game folder once, again when it changes, and reports what it couldn’t match', async () => {
    const { lib, dir } = await library()
    const root = join(dir, 'watch')
    await mkdir(root)
    await gameFolder(root, '2025 Wk 1 DAL @ PHI', 3)
    await gameFolder(root, 'Practice', 1)
    lib.store.saveSettings({ watchFolder: root, myTeams: ['DAL'] })
    const events: ApiEvent[] = []
    stops.push(addEventSink((e) => events.push(e)))
    const watch = new WatchFolder(lib, { settleMs: 40, fsWatch: false, rescanMs: 60_000 })
    stops.push(() => watch.stop())
    watch.configure()
    await watch.scan()
    // First sight only starts the settle clock.
    expect(lib.store.filmGames()).toEqual([])
    await sleep(60)
    let status = await watch.scan()
    const films = lib.store.filmGames()
    expect(films).toMatchObject([{ gameId: '2025_01_DAL_PHI', team: 'DAL', source: 'watch', clipCount: 6 }])
    expect(status).toMatchObject({ state: 'watching', folderName: 'watch', justImported: 1, recent: [{ gameId: '2025_01_DAL_PHI', state: 'done', clipCount: 6, playCount: 3 }] })
    expect(status.unmatched).toEqual([{ folder: 'Practice', reason: 'No teams are named in the folder name.' }])
    const done = events.filter((e) => e.type === 'activity' && e.activity.state === 'done').map((e) => (e as { activity: { notification?: { title: string; body?: string } } }).activity.notification)
    expect(done).toEqual([{ title: 'Imported DAL @ PHI', body: 'Week 1 · 6 clips matched to 3 plays', route: '/film/2025_01_DAL_PHI?team=DAL' }])
    expect(events.some((e) => e.type === 'changed' && e.kinds.includes('film'))).toBe(true)

    // Unchanged: nothing more.
    await sleep(60)
    await watch.scan()
    expect(lib.store.importLog(10, 'watch')).toHaveLength(1)

    // A clip added later re-imports into the same game.
    await mkdir(join(root, '2025 Wk 1 DAL @ PHI', 'Sideline'), { recursive: true })
    const extra = join(root, '2025 Wk 1 DAL @ PHI', 'End Zone', 'Play 4.mp4')
    await writeFile(extra, 'clip 4')
    await utimes(extra, OLD, OLD)
    await watch.scan()
    await sleep(60)
    status = await watch.scan()
    // The game has three plays, so the fourth end zone clip is saved without a play.
    expect(lib.store.importLog(10, 'watch').map((e) => e.clipCount)).toEqual([6, 6])
    expect(lib.store.filmGames()[0].clipCount).toBe(7)

    // Opening the game clears "just imported".
    lib.store.touchFilm('2025_01_DAL_PHI', 'DAL', true)
    expect(watch.status().justImported).toBe(0)
  })

  it('leaves a game that already has film alone and logs failures once', async () => {
    const { lib, dir } = await library()
    const root = join(dir, 'watch')
    await mkdir(root)
    lib.store.replaceClips('2025_01_DAL_PHI', [{ path: '/elsewhere/1.mp4', fileName: '1.mp4', angle: 'sideline', playId: 10 }])
    lib.store.touchFilm('2025_01_DAL_PHI', 'PHI', false)
    await gameFolder(root, '2025 Wk 1 DAL at PHI', 1)
    // A played game with no plays published: matched, but nothing to match clips to.
    await gameFolder(root, 'PHI @ DAL', 1)
    lib.store.saveSettings({ watchFolder: root })
    const watch = new WatchFolder(lib, { settleMs: 20, fsWatch: false })
    stops.push(() => watch.stop())
    watch.configure()
    await watch.scan()
    await sleep(40)
    const status = await watch.scan()
    expect(status.unmatched).toEqual([{ folder: '2025 Wk 1 DAL at PHI', reason: expect.stringMatching(/^DAL @ PHI \(Week 1, 2025\) already has film/) }])
    expect(status.recent).toMatchObject([{ gameId: '2025_09_PHI_DAL', state: 'failed', error: expect.stringMatching(/play-by-play/) }])
    await sleep(40)
    await watch.scan()
    expect(lib.store.importLog(10, 'watch')).toHaveLength(1)
  })

  it('finishes an import the app quit in the middle of instead of calling the folder a duplicate', async () => {
    const { lib, dir } = await library()
    const root = join(dir, 'watch')
    await mkdir(root)
    await gameFolder(root, 'DAL at PHI', 2)
    // The clips were saved, then the app quit before the import was logged.
    const folder = join(root, 'DAL at PHI')
    lib.store.replaceClips('2025_01_DAL_PHI', [{ path: join(folder, 'Sideline', 'Play 1.mp4'), fileName: 'Play 1.mp4', angle: 'sideline', playId: 10 }])
    lib.store.touchFilm('2025_01_DAL_PHI', 'PHI', false, 'watch')
    lib.store.saveSettings({ watchFolder: root })
    const watch = new WatchFolder(lib, { settleMs: 20, fsWatch: false })
    stops.push(() => watch.stop())
    watch.configure()
    await watch.scan()
    await sleep(40)
    const status = await watch.scan()
    expect(status.unmatched).toEqual([])
    expect(status.recent).toMatchObject([{ gameId: '2025_01_DAL_PHI', state: 'done', clipCount: 4 }])
    expect(lib.store.filmGames()[0].clipCount).toBe(4)
  })

  it('starts watching a folder that was missing once it is back', async () => {
    const { lib, dir } = await library()
    const root = join(dir, 'watch')
    lib.store.saveSettings({ watchFolder: root })
    const watch = new WatchFolder(lib, { settleMs: 40, rescanMs: 60_000 })
    stops.push(() => watch.stop())
    watch.configure()
    expect(watch.status().state).toBe('missing')
    await mkdir(root)
    // The minute rescan finds it again; from then on fs.watch sees new game folders by itself.
    await watch.scan()
    await gameFolder(root, 'DAL at PHI', 1)
    for (let i = 0; i < 50 && !lib.store.filmGames().length; i++) await sleep(50)
    expect(lib.store.filmGames()).toMatchObject([{ gameId: '2025_01_DAL_PHI', source: 'watch' }])
  })

  it('reports a missing or paused folder', async () => {
    const { lib, dir } = await library()
    const watch = new WatchFolder(lib, { fsWatch: false })
    stops.push(() => watch.stop())
    expect(watch.status().state).toBe('off')
    lib.store.saveSettings({ watchFolder: join(dir, 'gone') })
    watch.configure()
    expect(watch.status().state).toBe('missing')
    lib.store.saveSettings({ watchPaused: true })
    watch.configure()
    expect(watch.status().state).toBe('paused')
  })
})

describe('season auto-update', () => {
  it('runs between Aug 1 and the end of February', () => {
    expect(inSeasonWindow(new Date(2025, 7, 1))).toBe(true)
    expect(inSeasonWindow(new Date(2026, 1, 28))).toBe(true)
    expect(inSeasonWindow(new Date(2026, 2, 1))).toBe(false)
    expect(inSeasonWindow(new Date(2026, 6, 31))).toBe(false)
    expect(windowSeason(new Date(2025, 9, 15))).toBe(2025)
    expect(windowSeason(new Date(2026, 0, 20))).toBe(2025)
  })
  it('refreshes a cached season older than 12 hours', () => {
    const now = new Date('2025-10-15T12:00:00Z')
    expect(needsUpdate({ downloaded: true, downloadedAt: '2025-10-15T01:00:00Z' }, now)).toBe(false)
    expect(needsUpdate({ downloaded: true, downloadedAt: '2025-10-14T23:00:00Z' }, now)).toBe(true)
    expect(needsUpdate({ downloaded: false, downloadedAt: null }, now)).toBe(false)
  })
  it('finds games that gained a score', () => {
    const before = [makeGame({ gameId: 'a', homeScore: 20 }), makeGame({ gameId: 'b', homeScore: null })]
    const after = [makeGame({ gameId: 'a', homeScore: 20 }), makeGame({ gameId: 'b', homeScore: 17, week: 7 })]
    expect(newlyScored(before, after).map((g) => g.gameId)).toEqual(['b'])
  })
  it('updates quietly in season, reports failure, and leaves the off-season alone', async () => {
    const { lib, mirror } = await library()
    const events: ApiEvent[] = []
    stops.push(addEventSink((e) => events.push(e)))
    // The fixture is the 2025 season: pretend it's October 2025, with every cached copy stale.
    const upd = new SeasonUpdater(lib, { now: () => new Date(2025, 9, 15, 12), staleMs: Number.NEGATIVE_INFINITY })
    expect(await upd.status()).toMatchObject({ season: 2025, state: 'upToDate', autoUpdate: true, inSeason: true })
    // Out of the window: nothing.
    const summer = new SeasonUpdater(lib, { now: () => new Date(2026, 5, 1), staleMs: Number.NEGATIVE_INFINITY })
    expect(await summer.check()).toBe(false)
    expect(await upd.check()).toBe(true)
    expect(events.filter((e) => e.type === 'activity' && e.activity.state === 'done')).toHaveLength(1)
    expect(events.some((e) => e.type === 'changed' && e.kinds.includes('season'))).toBe(true)
    // A broken mirror: quiet failure.
    await writeFile(join(mirror, 'games.csv'), 'season\n')
    await upd.download(2025, { quiet: true }).catch(() => undefined)
    const failed = await upd.status(2025)
    expect(failed).toMatchObject({ state: 'failed', error: expect.stringMatching(/No 2025 schedule/) })
    const fail = events.filter((e) => e.type === 'activity' && e.activity.state === 'failed')
    expect(fail.length).toBe(1)
    expect((fail[0] as { activity: { notification?: unknown } }).activity.notification).toBeUndefined()
    lib.store.saveSettings({ autoUpdateSeasons: false })
    expect(await upd.check()).toBe(false)
  })
})
