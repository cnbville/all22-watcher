import { createReadStream, existsSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { type Api, CLIP_SCHEME } from '@shared/api'
import { VIDEO_EXTENSIONS } from '@shared/matching'
import { convertClips, findFfmpeg } from './convert'
import { Store } from './db'
import { Library } from './library'
import { mirrorFetcher, webFetcher } from './nflverse'

// Lets tests and power users keep data somewhere other than ~/Library/Application Support.
if (process.env.ALL22_USER_DATA) app.setPath('userData', process.env.ALL22_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: CLIP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])

let library: Library
let mainWindow: BrowserWindow | null = null

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

function rendererUrl(hash = ''): { url?: string; file?: string; hash: string } {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) return { url: `${process.env.ELECTRON_RENDERER_URL}#${hash}`, hash }
  return { file: join(__dirname, '../renderer/index.html'), hash }
}

function load(win: BrowserWindow, hash = '') {
  const target = rendererUrl(hash)
  return target.url ? win.loadURL(target.url) : win.loadFile(target.file!, { hash })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d1014',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => (mainWindow = null))
  load(mainWindow)
}

async function renderPlayerReport(season: number, playerId: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1300,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  try {
    await load(win, `/report/${season}/${encodeURIComponent(playerId)}`)
    for (let i = 0; i < 100; i++) {
      if (await win.webContents.executeJavaScript('document.body.dataset.ready === "1"')) break
      await new Promise((r) => setTimeout(r, 100))
    }
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' })
  } finally {
    win.destroy()
  }
}

type Handlers = Omit<Api, 'onDataProgress' | 'onConvertProgress'>

function handlers(): Handlers {
  return {
    seasons: () => library.seasonStatuses(),
    downloadSeason: (season) =>
      library.downloadSeason(season, (p) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('data-progress', p)
      }),
    teamSummaries: (season) => library.teamSummaries(season),
    teamOverview: (season, team) => library.teamOverview(season, team),
    gameFilm: (gameId) => library.gameFilm(gameId),
    openedFilm: async (gameId, team) => library.store.touchFilm(gameId, team, true),
    recentFilm: () => library.recentFilm(),
    pickClips: async () => {
      const res = await dialog.showOpenDialog(mainWindow!, {
        title: 'Choose the clips (or the folder of clips) for this game',
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        filters: [{ name: 'Video', extensions: VIDEO_EXTENSIONS.map((e) => e.slice(1)) }]
      })
      return res.canceled ? null : res.filePaths
    },
    previewMatch: (gameId, paths, options) => library.previewMatch(gameId, paths, options),
    importClips: async (gameId, team, rows) => library.importClips(gameId, team, rows),
    canConvert: async () => !!findFfmpeg(),
    convertClips: async (gameId, paths) => {
      const ffmpeg = findFfmpeg()
      if (!ffmpeg) throw new Error('ffmpeg isn’t installed. Install it with Homebrew: brew install ffmpeg')
      return convertClips(ffmpeg, paths, library.convertedDir(gameId), (done, total) => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('convert-progress', { done, total })
      })
    },
    relinkClip: async (clipId, playId) => library.store.relinkClip(clipId, playId),
    removeFilm: async (gameId) => library.store.removeClips(gameId),
    revealClip: async (path) => shell.showItemInFolder(path),
    saveGrade: async (entry) => library.saveGrade(entry),
    savePlayNote: async (note) => library.savePlayNote(note),
    playerProfile: (season, playerId) => library.playerProfile(season, playerId),
    tags: async () => library.store.tags(),
    saveTags: async (tags) => library.store.saveTags(tags),
    chartFields: async () => library.store.chartFields(),
    saveChartFields: async (fields) => library.store.saveChartFields(fields),
    settings: async () => library.store.settings(),
    saveSettings: async (patch) => library.store.saveSettings(patch),
    exportGradesCsv: async (season, team) => {
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export grades',
        defaultPath: `${team}-${season}-grades.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (res.canceled || !res.filePath) return null
      await writeFile(res.filePath, await library.gradesCsv(season, team))
      return res.filePath
    },
    exportPlayerReport: async (season, playerId) => {
      const profile = await library.playerProfile(season, playerId)
      const res = await dialog.showSaveDialog(mainWindow!, {
        title: 'Save scouting report',
        defaultPath: `${(profile?.player.name ?? playerId).replace(/[^\w .-]/g, '')} ${season}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (res.canceled || !res.filePath) return null
      await writeFile(res.filePath, await renderPlayerReport(season, playerId))
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
  const store = await Store.open(join(userData, 'grades.sqlite'))
  const mirror = process.env.ALL22_NFLVERSE_MIRROR
  library = new Library(store, cacheDir, mirror ? mirrorFetcher(mirror) : webFetcher((url) => net.fetch(url)))

  protocol.handle(CLIP_SCHEME, async (req) => {
    const url = new URL(req.url)
    const clip = url.hostname === 'clip' ? library.store.clipById(Number(url.pathname.slice(1))) : null
    if (!clip || !existsSync(clip.path)) return new Response('Clip not found', { status: 404 })
    return serveVideo(clip.path, req.headers.get('range'))
  })

  const impl = handlers() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  ipcMain.handle('api', async (_e, method: string, ...args: unknown[]) => {
    const fn = impl[method]
    if (!fn) throw new Error(`Unknown API method ${method}`)
    return fn(...args)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => library?.store.flush())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
