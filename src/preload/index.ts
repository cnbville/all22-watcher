import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_EVENT_CHANNEL, API_METHODS, type Api, type ApiEvent, type ApiMethod } from '@shared/api'
import type { CommandId } from '@shared/commands'
import { type Activity, SHELL_ARG_PREFIX, SHELL_CHANNELS, type ShellBridge, type ShellInitial, type WindowState } from '@shared/shell'
import type { DataProgress } from '@shared/types'

const api = Object.fromEntries(
  API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke('api', m, ...args)])
) as unknown as Pick<Api, ApiMethod>

const full: Api = {
  ...api,
  onDataProgress(cb) {
    const listener = (_e: unknown, p: DataProgress) => cb(p)
    ipcRenderer.on('data-progress', listener)
    return () => ipcRenderer.removeListener('data-progress', listener)
  },
  onConvertProgress(cb) {
    const listener = (_e: unknown, p: { done: number; total: number }) => cb(p)
    ipcRenderer.on('convert-progress', listener)
    return () => ipcRenderer.removeListener('convert-progress', listener)
  },
  onApiEvent(cb) {
    const listener = (_e: unknown, event: ApiEvent) => cb(event)
    ipcRenderer.on(API_EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(API_EVENT_CHANNEL, listener)
  }
}

contextBridge.exposeInMainWorld('api', full)

// The window-chrome bridge (spec 01 §3.2).
const sub = <T extends unknown[]>(channel: string, cb: (...args: T) => void) => {
  const listener = (_e: unknown, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

function initialShell(): ShellInitial {
  const arg = process.argv.find((a) => a.startsWith(SHELL_ARG_PREFIX))
  const fallback: ShellInitial = {
    platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    vibrancy: false,
    reduceTransparency: false,
    fullScreen: false,
    windowKind: 'report'
  }
  try {
    return arg ? { ...fallback, ...JSON.parse(arg.slice(SHELL_ARG_PREFIX.length)) } : fallback
  } catch {
    return fallback
  }
}

const C = SHELL_CHANNELS
const shellBridge: ShellBridge = {
  initial: initialShell(),
  onMenu: (cb) => sub<[CommandId, string | undefined]>(C.menu, cb),
  setCommandState: (state) => ipcRenderer.send(C.commands, state),
  setDynamicMenus: (menus) => ipcRenderer.send(C.dynamicMenus, menus),
  setTextFocus: (focused) => ipcRenderer.send(C.textFocus, focused),
  showContextMenu: (items) => ipcRenderer.invoke(C.invoke, 'contextMenu', items),
  openSettings: (pane) => ipcRenderer.invoke(C.invoke, 'openSettings', pane),
  broadcastSettingsChanged: () => ipcRenderer.send(C.broadcastSettings),
  onSettingsChanged: (cb) => sub(C.settingsChanged, cb),
  onWindowState: (cb) => sub<[WindowState]>(C.windowState, cb),
  setTrafficLightsVisible: (visible) => ipcRenderer.send(C.trafficLights, visible),
  zoomWindow: () => ipcRenderer.send(C.zoom),
  notify: (n) => ipcRenderer.invoke(C.invoke, 'notify', n),
  onNavigate: (cb) => sub<[string]>(C.navigate, cb),
  onActivity(cb) {
    // Activities arrive on the data layer's event channel; a plain 'activity' channel is accepted too.
    const a = sub<[Activity]>(C.activity, cb)
    const b = sub<[{ type: string; activity?: Activity }]>('api-event', (e) => {
      if (e?.type === 'activity' && e.activity) cb(e.activity)
    })
    return () => {
      a()
      b()
    }
  },
  setDockProgress: (fraction) => ipcRenderer.send(C.dockProgress, fraction),
  setDockBadge: (count) => ipcRenderer.send(C.dockBadge, count),
  pathForFile: (file) => webUtils.getPathForFile(file),
  copyImage: (dataUrl) => ipcRenderer.send(C.copyImage, dataUrl),
  setContentHeight: (height) => ipcRenderer.send(C.contentHeight, height),
  confirm: (c) => ipcRenderer.invoke(C.invoke, 'confirm', c),
  showItemInFolder: (path) => void ipcRenderer.invoke(C.invoke, 'showItemInFolder', path),
  showInMain: (route) => void ipcRenderer.invoke(C.invoke, 'showInMain', route),
  openExternal: (url) => void ipcRenderer.invoke(C.invoke, 'openExternal', url),
  setPlaybackActive: (active) => ipcRenderer.send(C.playback, active),
  beep: () => ipcRenderer.send(C.beep)
}

contextBridge.exposeInMainWorld('shell', shellBridge)
