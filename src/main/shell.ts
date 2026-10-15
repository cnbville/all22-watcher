import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  shell,
  systemPreferences,
  type MenuItemConstructorOptions
} from 'electron'
import type { CommandId, CommandStateMap } from '@shared/commands'
import { EMPTY_DYNAMIC_MENUS, SHELL_CHANNELS, type ContextMenuItem, type DynamicMenus, type NotifyRequest, type SettingsPane } from '@shared/shell'
import type { RecentFilm } from '@shared/types'
import { buildMenu, menuSignature, updateMenuInPlace, type MenuState, type RecentItem } from './menu'
import {
  getMainWindow,
  getSettingsWindow,
  onWindowsChanged,
  openSettingsWindow,
  setSettingsHeight,
  showMainWindow,
  windowKind
} from './windows'

export interface ShellDeps {
  recentFilm(): Promise<RecentFilm[]>
}

const NFLVERSE_URL = 'https://github.com/nflverse/nflverse-data'

/**
 * The window-chrome side of the app (01 §3): the application menu built from the command registry, the
 * `shell` IPC bridge, context menus, notifications, the Dock, and the Settings window.
 */
export function registerShell(deps: ShellDeps) {
  const state: MenuState = { commands: {}, dynamic: EMPTY_DYNAMIC_MENUS, textFocus: false, focused: 'main', recent: [] }
  let signature = ''
  let rebuildTimer: NodeJS.Timeout | null = null
  let recentFilm: RecentFilm[] = []

  app.setAboutPanelOptions({
    applicationName: 'All-22 Watcher',
    applicationVersion: app.getVersion(),
    credits: 'Play-by-play, rosters and stats from nflverse.'
  })

  const send = (win: BrowserWindow | null, id: CommandId, arg?: string) => win?.webContents.send(SHELL_CHANNELS.menu, id, arg)

  /** Menu clicks: a few ids act in main; edit.* go to the focused window; everything else to the main window. */
  const run = (id: CommandId, arg?: string) => {
    switch (id) {
      case 'app.settings':
        openSettingsWindow()
        return
      case 'window.main':
        showMainWindow()
        return
      case 'help.nflverse':
        void shell.openExternal(NFLVERSE_URL)
        return
      case 'file.showDataFolder':
        void shell.openPath(app.getPath('userData'))
        return
      case 'view.reload':
        BrowserWindow.getFocusedWindow()?.webContents.reload()
        return
    }
    if (id.startsWith('edit.')) {
      send(BrowserWindow.getFocusedWindow() ?? getMainWindow(), id, arg)
      return
    }
    const main = getMainWindow()
    if (!main || !main.isFocused()) showMainWindow()
    const target = getMainWindow()
    if (target?.webContents.isLoading()) target.webContents.once('did-finish-load', () => send(target, id, arg))
    else send(target, id, arg)
  }

  const apply = (force = false) => {
    const next = menuSignature(state)
    const current = Menu.getApplicationMenu()
    if (!force && current && next === signature) {
      updateMenuInPlace(current, state)
      return
    }
    if (rebuildTimer) clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null
      signature = menuSignature(state)
      Menu.setApplicationMenu(buildMenu(state, run))
    }, force ? 0 : 30)
  }

  const refreshRecent = async () => {
    try {
      recentFilm = (await deps.recentFilm()).slice(0, 10)
    } catch {
      recentFilm = []
    }
    const items: RecentItem[] = recentFilm.map((r) => ({
      label: `${r.game.awayTeam} @ ${r.game.homeTeam} — ${r.game.gameType === 'REG' ? `Week ${r.game.week}` : r.game.gameType}, ${r.game.season} (${r.team})`,
      arg: `${r.game.gameId}|${r.team}`
    }))
    if (JSON.stringify(items) !== JSON.stringify(state.recent)) {
      state.recent = items
      apply()
      updateDockMenu()
    }
  }

  const updateDockMenu = () => {
    if (!app.dock) return
    const template: MenuItemConstructorOptions[] = [
      { label: 'Import Film…', click: () => run('file.importFilm') },
      ...(state.recent.length ? [{ type: 'separator' } as MenuItemConstructorOptions] : []),
      ...state.recent.slice(0, 5).map((r) => ({ label: r.label, click: () => run('file.openRecent', r.arg) }))
    ]
    app.dock.setMenu(Menu.buildFromTemplate(template))
  }

  onWindowsChanged(() => {
    const focused = BrowserWindow.getFocusedWindow()
    const kind = windowKind(focused) ?? (getMainWindow() ? 'main' : null)
    if (kind !== state.focused) {
      state.focused = kind
      apply()
    }
    if (focused && focused === getMainWindow()) void refreshRecent()
  })

  const fromMain = (e: Electron.IpcMainEvent) => e.sender === getMainWindow()?.webContents

  ipcMain.on(SHELL_CHANNELS.commands, (e, commands: CommandStateMap) => {
    if (!fromMain(e)) return
    state.commands = commands
    apply()
  })
  ipcMain.on(SHELL_CHANNELS.dynamicMenus, (e, menus: DynamicMenus) => {
    if (!fromMain(e)) return
    state.dynamic = { ...EMPTY_DYNAMIC_MENUS, ...menus }
    apply()
    void refreshRecent()
  })
  ipcMain.on(SHELL_CHANNELS.textFocus, (e, focused: boolean) => {
    if (!fromMain(e)) return
    state.textFocus = focused
    apply()
  })
  ipcMain.on(SHELL_CHANNELS.broadcastSettings, () => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(SHELL_CHANNELS.settingsChanged)
  })
  ipcMain.on(SHELL_CHANNELS.trafficLights, (e, visible: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win && process.platform === 'darwin') win.setWindowButtonVisibility(visible)
  })
  ipcMain.on(SHELL_CHANNELS.zoom, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const action = process.platform === 'darwin' ? systemDoubleClickAction() : 'Maximize'
    if (action === 'Minimize') win.minimize()
    else if (action !== 'None') win.isMaximized() ? win.unmaximize() : win.maximize()
  })

  // Dock progress is the mean of the fractions every window reports (01 §3.7).
  const progress = new Map<number, number>()
  ipcMain.on(SHELL_CHANNELS.dockProgress, (e, fraction: number) => {
    if (fraction < 0) progress.delete(e.sender.id)
    else progress.set(e.sender.id, Math.max(0, Math.min(1, fraction)))
    const values = [...progress.values()]
    getMainWindow()?.setProgressBar(values.length ? values.reduce((a, b) => a + b, 0) / values.length : -1)
  })
  ipcMain.on(SHELL_CHANNELS.dockBadge, (_e, count: number) => {
    if (app.dock) app.dock.setBadge(count > 0 ? String(count) : '')
  })
  ipcMain.on(SHELL_CHANNELS.copyImage, (_e, dataUrl: string) => {
    const png = nativeImage.createFromDataURL(dataUrl).toPNG()
    void clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  })
  ipcMain.on(SHELL_CHANNELS.contentHeight, (e, height: number) => {
    const win = getSettingsWindow()
    if (win && e.sender === win.webContents) setSettingsHeight(win, height)
  })

  // Keeps the display awake while any window plays film (02 §19.6).
  const playing = new Set<number>()
  let blocker: number | null = null
  const updateBlocker = () => {
    if (playing.size && blocker === null) blocker = powerSaveBlocker.start('prevent-display-sleep')
    else if (!playing.size && blocker !== null) {
      powerSaveBlocker.stop(blocker)
      blocker = null
    }
  }
  ipcMain.on(SHELL_CHANNELS.playback, (e, active: boolean) => {
    const id = e.sender.id
    if (active) {
      if (!playing.has(id)) e.sender.once('destroyed', () => (playing.delete(id), updateBlocker()))
      playing.add(id)
    } else playing.delete(id)
    updateBlocker()
  })
  powerMonitor.on('suspend', () => {
    playing.clear()
    updateBlocker()
  })
  ipcMain.on(SHELL_CHANNELS.beep, () => shell.beep())

  ipcMain.handle(SHELL_CHANNELS.invoke, async (e, method: string, ...args: unknown[]) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    switch (method) {
      case 'contextMenu':
        return showContextMenu(win, args[0] as ContextMenuItem[])
      case 'openSettings':
        openSettingsWindow(args[0] as SettingsPane | undefined)
        return
      case 'notify':
        return notify(args[0] as NotifyRequest)
      case 'confirm': {
        const c = args[0] as { message: string; detail?: string; confirmLabel: string }
        const opts = { type: 'warning' as const, message: c.message, detail: c.detail, buttons: [c.confirmLabel, 'Cancel'], defaultId: 1, cancelId: 1 }
        const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
        return res.response === 0
      }
      case 'showInMain':
        showMainWindow().webContents.send(SHELL_CHANNELS.navigate, String(args[0]))
        return
      case 'showItemInFolder':
        shell.showItemInFolder(args[0] as string)
        return
      case 'openExternal': {
        const url = String(args[0])
        if (url.startsWith('https://')) await shell.openExternal(url)
        return
      }
    }
    throw new Error(`Unknown shell method ${method}`)
  })

  function notify(n: NotifyRequest): 'native' | 'in-app' {
    const main = getMainWindow()
    const inApp = main && main.isVisible() && main.isFocused() && !main.isMinimized()
    if (inApp || !Notification.isSupported()) return 'in-app'
    const note = new Notification({ title: n.title, body: n.body ?? '', silent: false })
    note.on('click', () => {
      const win = showMainWindow()
      if (n.revealPath) shell.showItemInFolder(n.revealPath)
      else if (n.route) win.webContents.send(SHELL_CHANNELS.navigate, n.route)
    })
    note.show()
    return 'native'
  }

  apply(true)
  void refreshRecent()
  updateDockMenu()

  return {
    /** Re-reads Open Recent (after an import or opening film). */
    refreshRecent,
    openSettings: (pane?: SettingsPane) => openSettingsWindow(pane)
  }
}

function systemDoubleClickAction(): string {
  try {
    return systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string') || 'Maximize'
  } catch {
    return 'Maximize'
  }
}

/** Pops a native menu at the cursor and resolves with the chosen item's id, or null (01 §3.6). */
function showContextMenu(win: BrowserWindow | null, items: ContextMenuItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    let chosen: string | null = null
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve(chosen)
    }
    const toTemplate = (list: ContextMenuItem[]): MenuItemConstructorOptions[] =>
      list.map((it): MenuItemConstructorOptions => {
        if (it.type === 'separator') return { type: 'separator' }
        if (it.type === 'header') return { label: it.label, type: 'header' as MenuItemConstructorOptions['type'], enabled: false }
        if (it.type === 'submenu' || it.submenu) return { label: it.label, enabled: it.enabled ?? true, submenu: toTemplate(it.submenu ?? []) }
        return {
          label: it.label,
          type: it.type === 'checkbox' || it.type === 'radio' ? it.type : 'normal',
          checked: it.checked,
          enabled: it.enabled ?? true,
          accelerator: it.accelerator,
          registerAccelerator: false,
          click: () => {
            chosen = it.id ?? null
            finish()
          }
        }
      })
    const menu = Menu.buildFromTemplate(toTemplate(items))
    // A click can arrive after the close callback; give it a turn to win.
    menu.popup({ window: win ?? undefined, callback: () => setTimeout(finish, 0) })
  })
}
