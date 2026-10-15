import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, powerSaveBlocker, protocol, shell } from 'electron'
import { API_EVENT_CHANNEL, type Api, type ApiMethod, CLIP_SCHEME } from '@shared/api'
import type { ExportPlan } from '@shared/exportVideo'
import { VIDEO_EXTENSIONS } from '@shared/matching'
import { convertClips, findFfmpeg } from './convert'
import { Store } from './db'
import { addEventSink, broadcast, cancelActivity, changed, listActivities, runningActivities, startActivity } from './events'
import { planExport } from './exportPlan'
import { exportsRunning, pickEncoder, queueExport, setExportKeepAwake } from './exportVideo'
import { ffmpegStatus } from './ffmpeg'
import { KnownPaths } from './knownPaths'
import { Library } from './library'
import { mirrorFetcher, webFetcher } from './nflverse'
import { CutupEngine } from './playQuery'
import { PosterCache, posterQuery } from './posters'
import { SeasonUpdater } from './seasonUpdate'
import { WatchFolder } from './watch'
import { registerShell } from './shell'
import { createMainWindow, getMainWindow, initialShellState, showMainWindow } from './windows'
import { SHELL_ARG_PREFIX } from '@shared/shell'

// Lets tests and power users keep data somewhere other than ~/Library/Application Support.
if (process.env.ALL22_USER_DATA) app.setPath('userData', process.env.ALL22_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: CLIP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])

let library: Library
let cutupEngine: CutupEngine
let watcher: WatchFolder
let updater: SeasonUpdater
let posters: PosterCache
let known: KnownPaths
let lastExportFolder: string | null = null

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

/** Streams a local video with HTTP range support so the player can seek. */
async function serveVideo(path: string, range: string | null): Promise<Response> {
  const { size } = await stat(path)
  const type = MIME[path.slice(path.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream'
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  if (m) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2])
    let end = m[1] && m[2] ? Number(m[2]) : size - 1
    start = Math.max(0, start)
    end = Math.min(end, size - 1)
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
  })
}

/** A still from a clip (03 §2.7): ffmpeg into the poster cache, else a macOS thumbnail, else 404. */
async function servePoster(url: URL): Promise<Response> {
  const clip = library.store.clipById(Number(url.pathname.slice(1)))
  if (!clip || !existsSync(clip.path)) return new Response('Clip not found', { status: 404 })
  const { at, width } = posterQuery(url)
  const file = await posters.get(clip.id, clip.path, at, width).catch(() => null)
  if (file) return new Response(new Uint8Array(await readFile(file)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000' } })
  if (process.platform === 'darwin') {
    const thumb = await nativeImage.createThumbnailFromPath(clip.path, { width, height: Math.round((width * 9) / 16) }).catch(() => null)
    if (thumb && !thumb.isEmpty()) return new Response(new Uint8Array(thumb.toJPEG(80)), { headers: { 'Content-Type': 'image/jpeg' } })
  }
  return new Response('No poster', { status: 404 })
}

function rendererUrl(hash = ''): { url?: string; file?: string; hash: string } {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) return { url: `${process.env.ELECTRON_RENDERER_URL}#${hash}`, hash }
  return { file: join(__dirname, '../renderer/index.html'), hash }
}

function load(win: BrowserWindow, hash = '') {
  const target = rendererUrl(hash)
  return target.url ? win.loadURL(target.url) : win.loadFile(target.file!, { hash })
}

async function renderPlayerReport(season: number, playerId: string, name: string): Promise<Buffer> {
  // Letter at 96 dpi, never shown; the page sets body[data-ready] once charts, the headshot and Career are in (03 §12).
  const win = new BrowserWindow({
    show: false,
    width: 816,
    height: 1056,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      additionalArguments: [`${SHELL_ARG_PREFIX}${JSON.stringify(initialShellState('report'))}`]
    }
  })
  try {
    await load(win, `/report/${season}/${encodeURIComponent(playerId)}`)
    for (let i = 0; i < 100; i++) {
      if (await win.webContents.executeJavaScript('document.body.dataset.ready === "1"')) break
      await new Promise((r) => setTimeout(r, 100))
    }
    return await win.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      margins: { top: 0.5, bottom: 0.6, left: 0.5, right: 0.5 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: reportFooter(`${name} · ${season} scouting report`),
      generateDocumentOutline: true
    })
  } finally {
    win.destroy()
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The PDF footer (03 §12.1): "Name · 2025 scouting report" left, "Page X of Y" right. */
function reportFooter(left: string): string {
  return (
    '<div style="font: 8px -apple-system, sans-serif; color: #6E6E76; width: 100%; padding: 0 0.5in; display: flex; justify-content: space-between">' +
    `<span>${escapeHtml(left)}</span>` +
    '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
  )
}

function sendAll(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

/** The window a dialog should sit on: the focused one, else the main window, else any. */
function dialogWindow(): BrowserWindow | undefined {
  const win = BrowserWindow.getFocusedWindow() ?? getMainWindow() ?? BrowserWindow.getAllWindows()[0]
  return win && !win.isDestroyed() ? win : undefined
}

function openDialog(options: Electron.OpenDialogOptions) {
  const win = dialogWindow()
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}

function saveDialog(options: Electron.SaveDialogOptions) {
  const win = dialogWindow()
  return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options)
}

const EXPORT_ERRORS: Record<NonNullable<ExportPlan['error']>, string> = {
  noFfmpeg: 'Video export needs ffmpeg, and it couldn’t be found.',
  noEncoder: 'This copy of ffmpeg can’t encode H.264 video.',
  nothingToExport: 'None of these plays have film.',
  tooMany: 'Export up to 300 plays at a time.'
}

type Handlers = Pick<Api, ApiMethod>

function handlers(): Handlers {
  const store = () => library.store
  const cutupsChanged = () => changed('cutups')
  return {
    seasons: () => library.seasonStatuses(),
    downloadSeason: (season) => updater.download(season, { quiet: false }),
    dataStatus: (season) => updater.status(season),
    updateSeasonNow: (season) => updater.updateNow(season),
    seasonStorage: () => library.seasonStorage(),
    removeSeason: async (season) => {
      await library.removeSeason(season)
      changed('season')
      broadcast({ type: 'dataStatus', status: await updater.status(season) })
    },
    teamSummaries: (season) => library.teamSummaries(season),
    teamOverview: (season, team) => library.teamOverview(season, team),
    teamCards: (season, abbrs) => library.teamCards(season, abbrs),
    teamFilmStats: (season) => library.teamFilmStats(season),
    gameFilm: (gameId) => library.gameFilm(gameId),
    openedFilm: async (gameId, team) => {
      const fromWatch = store().filmGames().some((f) => f.gameId === gameId && f.source === 'watch' && !f.openedAt)
      store().touchFilm(gameId, team, true)
      // The watch folder's "just imported" count drops once a game is opened.
      if (fromWatch) broadcast({ type: 'watchStatus', status: watcher.status() })
    },
    recentFilm: () => library.recentFilm(),
    filmLibrary: () => library.filmLibrary(),
    recentlyGraded: (limit) => library.recentlyGraded(limit),
    playerProfile: (season, playerId) => library.playerProfile(season, playerId),
    playerSeasonLine: (season, playerId, hint) => library.playerSeasonLine(season, playerId, hint),
    leaderboard: (season, group) => library.leaderboard(season, group),
    matchup: (season, left, right) => library.matchup(season, left, right),
    searchIndex: async (season) => {
      const cutups = (await cutupEngine.summaries()).map((c) => ({ id: c.cutup.id, name: c.cutup.name, kind: c.cutup.kind, playCount: c.playCount }))
      return library.searchIndex(season, cutups)
    },
    sidebarBadges: (season) => library.sidebarBadges(season),
    pickClips: async () => {
      const res = await openDialog({
        title: 'Choose the clips (or the folder of clips) for this game',
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS.map((e) => e.slice(1)) }]
      })
      return res.canceled ? null : res.filePaths
    },
    previewMatch: (gameId, paths, options) => library.previewMatch(gameId, paths, options),
    importClips: async (gameId, team, rows) => {
      const result = await library.importClips(gameId, team, rows, 'manual')
      const matched = rows.filter((r) => r.playId !== null)
      store().logImport({
        folder: rows[0]?.path ?? '',
        gameId,
        team,
        source: 'manual',
        state: 'done',
        clipCount: matched.length,
        playCount: new Set(matched.map((r) => r.playId)).size,
        suspectClips: result?.suspects.length ?? 0,
        error: null
      })
      changed('film')
    },
    canConvert: async () => !!findFfmpeg(),
    convertClips: async (gameId, paths) => {
      const ffmpeg = findFfmpeg()
      if (!ffmpeg) throw new Error('ffmpeg couldn’t be found, so these clips can’t be converted.')
      let cancelled = false
      const noun = (n: number) => `${n} ${n === 1 ? 'clip' : 'clips'}`
      const activity = startActivity({ kind: 'convert', title: `Converting ${noun(paths.length)}`, detail: `0 of ${paths.length}`, total: paths.length }, () => {
        cancelled = true
      })
      try {
        const res = await convertClips(
          ffmpeg,
          paths,
          library.convertedDir(gameId),
          (done, total) => {
            sendAll('convert-progress', { done, total })
            activity.update({ detail: `${done} of ${total}`, done, total })
          },
          () => cancelled
        )
        if (cancelled) activity.cancelled()
        else if (res.failed.length && !res.converted.length) activity.fail(res.failed[0].error)
        else activity.done({ detail: noun(res.converted.length) })
        return res
      } catch (e) {
        activity.fail(e instanceof Error ? e.message : String(e))
        throw e
      }
    },
    relinkClip: async (clipId, playId) => {
      store().relinkClip(clipId, playId)
      changed('film')
    },
    removeFilm: async (gameId) => {
      store().removeClips(gameId)
      changed('film')
    },
    revealClip: async (path) => {
      if (known.canReveal(path)) shell.showItemInFolder(path)
    },
    setClipSnap: async (clipId, snapMs) => store().setClipSnap(clipId, snapMs),
    checkAlignment: (gameId) => library.checkAlignment(gameId),
    alignment: async (gameId) => store().alignment(gameId),
    checkAlignmentRows: (gameId, rows) => library.checkAlignmentRows(gameId, rows),
    importLog: async (limit) => store().importLog(limit ?? 5),
    ffmpegStatus: () => ffmpegStatus(),
    watchStatus: async () => watcher.status(),
    checkWatchFolder: () => watcher.scan(),
    chooseWatchFolder: async () => {
      const res = await openDialog({ title: 'Choose a Watch Folder', properties: ['openDirectory', 'createDirectory'] })
      if (res.canceled || !res.filePaths[0]) return null
      store().saveSettings({ watchFolder: res.filePaths[0], watchPaused: false })
      watcher.configure()
      changed('settings')
      return res.filePaths[0]
    },
    saveGrade: async (entry) => library.saveGrade(entry),
    savePlayNote: async (note) => library.savePlayNote(note),
    cutups: () => cutupEngine.summaries(),
    cutup: (id) => cutupEngine.detail(id),
    createCutup: async (input) => {
      const c = store().createCutup(input)
      cutupsChanged()
      return c
    },
    updateCutup: async (id, patch) => {
      const c = store().updateCutup(id, patch)
      cutupsChanged()
      return c
    },
    deleteCutup: async (id) => {
      store().deleteCutup(id)
      cutupEngine.forget(id)
      cutupsChanged()
    },
    duplicateCutup: async (id, asManual) => {
      const c = store().duplicateCutup(id, asManual ? await cutupEngine.refs(id) : undefined)
      cutupsChanged()
      return c
    },
    addToCutup: async (id, plays) => {
      const r = store().addToCutup(id, plays)
      cutupsChanged()
      return r
    },
    removeFromCutup: async (id, plays) => {
      store().removeFromCutup(id, plays)
      cutupsChanged()
    },
    reorderCutup: async (id, plays) => {
      store().reorderCutup(id, plays)
      cutupsChanged()
    },
    reorderCutups: async (ids) => {
      store().reorderCutups(ids)
      cutupsChanged()
    },
    previewCutupRules: (rules, focus) => cutupEngine.preview(rules, focus ?? null),
    cutupRuleOptions: () => cutupEngine.ruleOptions(),
    exportVideoPlan: (req) => planExport(library, cutupEngine, req),
    startExportVideo: async (req, overlays) => {
      const plan = await planExport(library, cutupEngine, req)
      if (plan.error) throw new Error(EXPORT_ERRORS[plan.error])
      const status = await ffmpegStatus()
      const encoder = pickEncoder(status.encoders)
      if (!status.path || !encoder) throw new Error(EXPORT_ERRORS.noEncoder)
      lastExportFolder = req.folder
      const src = req.source
      const route = src.kind === 'player' ? `/player/${src.season}/${encodeURIComponent(src.playerId)}` : src.kind === 'cutup' ? `/cutup/${src.cutupId}` : undefined
      return { activityId: queueExport({ req, plan, overlays, ffmpeg: status.path, encoder, route }) }
    },
    exportFolders: async () => ({
      last: lastExportFolder,
      desktop: app.getPath('desktop'),
      documents: app.getPath('documents'),
      downloads: app.getPath('downloads'),
      movies: process.env.ALL22_EXPORT_DIR || app.getPath('videos')
    }),
    chooseFolder: async () => {
      const res = await openDialog({ title: 'Choose a Folder for the Video', properties: ['openDirectory', 'createDirectory'] })
      return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
    },
    revealPath: async (path) => {
      if (known.canReveal(path)) shell.showItemInFolder(path)
    },
    openPath: async (path) => {
      if (!known.canOpen(path)) throw new Error('That file isn’t one All-22 Watcher saved.')
      const err = await shell.openPath(path)
      if (err) throw new Error(err)
    },
    activities: async () => listActivities(),
    cancelActivity: async (id) => {
      cancelActivity(id)
    },
    tags: async () => store().tags(),
    saveTags: async (tags) => {
      const r = store().saveTags(tags)
      changed('grades')
      return r
    },
    chartFields: async () => store().chartFields(),
    saveChartFields: async (fields) => {
      const r = store().saveChartFields(fields)
      changed('notes')
      return r
    },
    settings: async () => store().settings(),
    saveSettings: async (patch) => {
      const before = store().settings()
      const next = store().saveSettings(patch)
      if (before.watchFolder !== next.watchFolder || before.watchPaused !== next.watchPaused) watcher.configure()
      if (!before.autoUpdateSeasons && next.autoUpdateSeasons) void updater.check()
      changed('settings')
      return next
    },
    exportGradesCsv: async (season, team) => {
      const res = await saveDialog({
        title: 'Export grades',
        defaultPath: `${team}-${season}-grades.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (res.canceled || !res.filePath) return null
      await writeFile(res.filePath, await library.gradesCsv(season, team))
      known.remember(res.filePath)
      return res.filePath
    },
    exportPlayerReport: async (season, playerId) => {
      const profile = await library.playerProfile(season, playerId)
      const res = await saveDialog({
        title: 'Save Scouting Report',
        defaultPath: `${(profile?.player.name ?? playerId).replace(/[^\w .-]/g, '')} ${season}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return null
      await writeFile(res.filePath, await renderPlayerReport(season, playerId, profile?.player.name ?? playerId))
      known.remember(res.filePath)
      return res.filePath
    },
    saveCsv: async (defaultName, csv) => {
      const res = await saveDialog({
        title: 'Export',
        defaultPath: defaultName.toLowerCase().endsWith('.csv') ? defaultName : `${defaultName}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (res.canceled || !res.filePath) return null
      await writeFile(res.filePath, csv)
      known.remember(res.filePath)
      return res.filePath
    },
    dataFolder: async () => app.getPath('userData'),
    openDataFolder: async () => {
      await shell.openPath(app.getPath('userData'))
    }
  }
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  const cacheDir = join(userData, 'nflverse')
  await mkdir(cacheDir, { recursive: true })
  const { store, movedTo } = await Store.openOrRecover(join(userData, 'grades.sqlite'))
  if (movedTo) {
    dialog.showErrorBox(
      'Couldn’t open your grades',
      `Your grades file couldn’t be read (it may be damaged), so All-22 Watcher moved it aside and started a new, empty one. The old file is here:\n\n${movedTo}`
    )
  }
  const mirror = process.env.ALL22_NFLVERSE_MIRROR
  library = new Library(store, cacheDir, mirror ? mirrorFetcher(mirror) : webFetcher((url) => net.fetch(url)))
  cutupEngine = new CutupEngine(library)
  watcher = new WatchFolder(library)
  updater = new SeasonUpdater(library)
  posters = new PosterCache(join(userData, 'posters'))
  known = new KnownPaths({
    isClip: (path) => store.hasClipPath(path),
    folders: () => [userData, store.settings().watchFolder]
  })

  // Every push event goes to every window over one channel; v1's progress channels stay for the v1 views.
  addEventSink((event) => sendAll(API_EVENT_CHANNEL, event))
  // A finished export may be revealed or played from its banner or notification.
  addEventSink((event) => {
    if (event.type === 'activity') known.remember(event.activity.resultPath)
  })
  addEventSink((event) => {
    if (event.type === 'dataStatus' && event.status.state === 'updating') {
      sendAll('data-progress', { season: event.status.season, step: event.status.step ?? '', done: event.status.done, total: event.status.total })
    }
  })
  let blocker: number | null = null
  setExportKeepAwake({
    start: () => {
      if (blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension')
    },
    stop: () => {
      if (blocker !== null) powerSaveBlocker.stop(blocker)
      blocker = null
    }
  })

  protocol.handle(CLIP_SCHEME, async (req) => {
    const url = new URL(req.url)
    if (url.hostname === 'poster') return servePoster(url)
    const clip = url.hostname === 'clip' ? library.store.clipById(Number(url.pathname.slice(1))) : null
    if (!clip || !existsSync(clip.path)) return new Response('Clip not found', { status: 404 })
    return serveVideo(clip.path, req.headers.get('range'))
  })

  const impl = handlers() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  ipcMain.handle('api', async (_e, method: string, ...args: unknown[]) => {
    const fn = Object.hasOwn(impl, method) ? impl[method] : undefined
    if (typeof fn !== 'function') throw new Error(`Unknown API method ${method}`)
    return fn(...args)
  })

  registerShell({ recentFilm: () => library.recentFilm(), canReveal: (path) => known.canReveal(path) })
  createMainWindow()
  watcher.configure()
  updater.start()
  app.on('activate', () => {
    if (!getMainWindow()) showMainWindow()
  })
}).catch((e) => {
  // Otherwise a failed start leaves the app running with no window and no explanation.
  dialog.showErrorBox('All-22 Watcher couldn’t start', e instanceof Error ? e.message : String(e))
  app.quit()
})

let quitConfirmed = false
app.on('before-quit', (e) => {
  const running = exportsRunning()
  if (running.length && !quitConfirmed) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      message: `Quit while “${running[0]}” is exporting?`,
      detail: 'The export will stop and the unfinished file will be deleted.',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    e.preventDefault()
    if (choice !== 0) return
    quitConfirmed = true
    // Cancel, give the pipeline a moment to delete its temp folder and unfinished file, then quit for real.
    for (const a of runningActivities('export')) cancelActivity(a.id)
    const started = Date.now()
    const wait = setInterval(() => {
      if (exportsRunning().length && Date.now() - started < 3000) return
      clearInterval(wait)
      app.quit()
    }, 100)
    return
  }
  watcher?.stop()
  updater?.stop()
  library?.store.flush()
})
// A note still being typed is saved by the closing window, after before-quit, so write once more on the way out.
app.on('will-quit', () => library?.store.flush())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
