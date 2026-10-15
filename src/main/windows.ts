import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeTheme, screen, shell, type Rectangle } from 'electron'
import { SHELL_ARG_PREFIX, SHELL_CHANNELS, type SettingsPane, type ShellInitial } from '@shared/shell'

const isMac = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
const listeners = new Set<() => void>()

/** Called whenever a window opens, closes or changes focus, so the menu can follow. */
export function onWindowsChanged(cb: () => void) {
  listeners.add(cb)
}
const changed = () => listeners.forEach((l) => l())

export const getMainWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
export const getSettingsWindow = () => (settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : null)

export function windowKind(win: BrowserWindow | null | undefined): 'main' | 'settings' | 'report' | null {
  if (!win) return null
  if (win === getMainWindow()) return 'main'
  if (win === getSettingsWindow()) return 'settings'
  return 'report'
}

export function initialShellState(kind: ShellInitial['windowKind']): ShellInitial {
  const reduceTransparency = nativeTheme.prefersReducedTransparency
  return {
    platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    vibrancy: isMac && !reduceTransparency,
    reduceTransparency,
    fullScreen: false,
    windowKind: kind
  }
}

function rendererTarget(hash: string): { url?: string; file?: string } {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) return { url: `${process.env.ELECTRON_RENDERER_URL}#${hash}` }
  return { file: join(__dirname, '../renderer/index.html') }
}

export function loadRenderer(win: BrowserWindow, hash = '') {
  const target = rendererTarget(hash)
  return target.url ? win.loadURL(target.url) : win.loadFile(target.file!, { hash })
}

function webPreferences(kind: ShellInitial['windowKind']): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    spellcheck: true,
    additionalArguments: [`${SHELL_ARG_PREFIX}${JSON.stringify(initialShellState(kind))}`]
  }
}

/** Shared guards: external links open in the browser, and the window never navigates to a dropped file (01 §1.4.5). */
function guard(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const ours = url.startsWith('file://') ? url.includes('/renderer/index.html') : !!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)
    if (!ours) e.preventDefault()
  })
  // Editable fields get the standard edit menu with spelling suggestions (01 §3.6).
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.isEditable) return
    const items: Electron.MenuItemConstructorOptions[] = []
    for (const s of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) })
    }
    if (params.misspelledWord && !params.dictionarySuggestions.length) items.push({ label: 'No Guesses Found', enabled: false })
    if (items.length) items.push({ type: 'separator' })
    items.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    )
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  win.on('focus', changed)
  win.on('blur', changed)
}

// Window state (01 §2.11)

interface SavedBounds extends Partial<Rectangle> {
  maximized?: boolean
}

function stateFile(name: string) {
  return join(app.getPath('userData'), name)
}

function readState(name: string): SavedBounds | null {
  try {
    const file = stateFile(name)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8')) as SavedBounds
  } catch {
    return null
  }
}

function writeState(name: string, state: SavedBounds) {
  try {
    writeFileSync(stateFile(name), JSON.stringify(state))
  } catch {
    // The window just opens at its default place next time.
  }
}

/** A saved rectangle, if it still lands on a connected display. */
function onScreen(s: SavedBounds | null): Rectangle | null {
  if (!s || s.x === undefined || s.y === undefined || !s.width || !s.height) return null
  const rect = { x: s.x, y: s.y, width: s.width, height: s.height }
  const display = screen.getDisplayMatching(rect)
  const a = display.workArea
  const overlaps = rect.x < a.x + a.width && rect.x + rect.width > a.x && rect.y < a.y + a.height && rect.y + rect.height > a.y
  return overlaps ? rect : null
}

export function createMainWindow(): BrowserWindow {
  nativeTheme.themeSource = 'dark'
  const saved = readState('window-state.json')
  const bounds = onScreen(saved)
  const work = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: bounds?.width ?? Math.min(1440, work.width),
    height: bounds?.height ?? Math.min(900, work.height),
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'All-22 Watcher',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 20, y: 18 },
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    ...(isMac ? {} : { backgroundColor: '#121214' }),
    autoHideMenuBar: !isMac,
    webPreferences: webPreferences('main')
  })
  mainWindow = win
  if (saved?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  guard(win)

  const sendState = () =>
    win.webContents.send(SHELL_CHANNELS.windowState, { fullScreen: win.isFullScreen(), reduceTransparency: nativeTheme.prefersReducedTransparency })
  win.on('enter-full-screen', sendState)
  win.on('leave-full-screen', sendState)
  nativeTheme.on('updated', () => !win.isDestroyed() && sendState())
  // Three-finger swipe goes back and forward (01 §1.4.1).
  win.on('swipe', (_e, direction) => {
    if (direction === 'left') win.webContents.send(SHELL_CHANNELS.menu, 'go.back')
    if (direction === 'right') win.webContents.send(SHELL_CHANNELS.menu, 'go.forward')
  })
  win.on('close', () => writeState('window-state.json', { ...win.getNormalBounds(), maximized: win.isMaximized() }))
  win.on('closed', () => {
    mainWindow = null
    changed()
  })
  void loadRenderer(win)
  changed()
  return win
}

/** Shows the main window, creating it again if it was closed (Window › Main Window, Dock click). */
export function showMainWindow(): BrowserWindow {
  const win = getMainWindow() ?? createMainWindow()
  if (win.isMinimized()) win.restore()
  if (win.isVisible()) win.focus()
  else win.once('ready-to-show', () => win.focus())
  return win
}

const SETTINGS_TOP = 84

export function openSettingsWindow(pane?: SettingsPane): BrowserWindow {
  const existing = getSettingsWindow()
  if (existing) {
    if (pane) existing.webContents.send(SHELL_CHANNELS.navigate, `/settings/${pane}`)
    existing.show()
    existing.focus()
    return existing
  }
  const saved = onScreen(readState('settings-window-state.json'))
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    useContentSize: true,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'General',
    titleBarStyle: isMac ? 'hidden' : 'default',
    trafficLightPosition: { x: 12, y: 8 },
    backgroundColor: '#1C1C1F',
    autoHideMenuBar: !isMac,
    webPreferences: webPreferences('settings')
  })
  settingsWindow = win
  guard(win)
  if (saved) win.setPosition(saved.x, saved.y)
  else {
    // First open: centered on the main window.
    const main = getMainWindow()
    if (main) {
      const m = main.getBounds()
      win.setPosition(Math.round(m.x + (m.width - 720) / 2), Math.round(m.y + Math.max(40, (m.height - 480) / 3)))
    }
  }
  let shown = false
  const show = () => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  // Shown once the pane reports its height (setSettingsHeight), with a fallback in case it never does.
  win.once('ready-to-show', () => setTimeout(show, 400))
  win.on('close', () => {
    const [x, y] = win.getPosition()
    writeState('settings-window-state.json', { x, y, width: 720, height: 480 })
  })
  win.on('closed', () => {
    settingsWindow = null
    changed()
  })
  ;(win as BrowserWindow & { showWhenSized?: () => void }).showWhenSized = show
  void loadRenderer(win, `/settings/${pane ?? ''}`)
  changed()
  return win
}

/** Fits the Settings window to its pane: 84 + pane height, clamped to the display (01 §4). */
export function setSettingsHeight(win: BrowserWindow, paneHeight: number) {
  const area = screen.getDisplayMatching(win.getBounds()).workArea
  const h = Math.round(Math.max(360, Math.min(area.height - 80, SETTINGS_TOP + paneHeight)))
  const [, current] = win.getContentSize()
  if (current !== h) win.setContentSize(720, h, isMac)
  ;(win as BrowserWindow & { showWhenSized?: () => void }).showWhenSized?.()
}
