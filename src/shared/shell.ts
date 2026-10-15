import type { CommandId, CommandStateMap } from './commands'
import type { Activity } from './types'

export type { Activity }

/**
 * The window-chrome bridge (01 §3.2): menus, context menus, the Settings window, notifications and the Dock.
 * Data stays on the generic `api` channel; this is exposed by the preload as `window.shell`.
 */
export interface ShellBridge {
  initial: ShellInitial
  onMenu(cb: (id: CommandId, arg?: string) => void): () => void
  setCommandState(state: CommandStateMap): void
  setDynamicMenus(menus: DynamicMenus): void
  setTextFocus(focused: boolean): void
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>
  openSettings(pane?: SettingsPane): Promise<void>
  /** Tells every window that settings, tags or chart fields changed (the sender included). */
  broadcastSettingsChanged(): void
  onSettingsChanged(cb: () => void): () => void
  onWindowState(cb: (s: WindowState) => void): () => void
  setTrafficLightsVisible(visible: boolean): void
  zoomWindow(): void
  notify(n: NotifyRequest): Promise<'native' | 'in-app'>
  onNavigate(cb: (route: string) => void): () => void
  onActivity(cb: (a: Activity) => void): () => void
  setDockProgress(fraction: number): void
  setDockBadge(count: number): void
  pathForFile(file: File): string
  copyImage(dataUrl: string): void
  /** Settings window only: the pane's natural height, so the window can fit it (01 §4). */
  setContentHeight(height: number): void
  /** Native confirmation alert for destructive actions (01 §3.6). Resolves true when confirmed. */
  confirm(c: { message: string; detail?: string; confirmLabel: string }): Promise<boolean>
  showItemInFolder(path: string): void
  /** Brings the main window forward on `route` (Settings › Film & Import's recent imports). */
  showInMain(route: string): void
  openExternal(url: string): void
  /** 02 §19.6: keeps the display awake while film plays. */
  setPlaybackActive(active: boolean): void
  beep(): void
}

export interface ShellInitial {
  platform: 'darwin' | 'linux' | 'win32'
  vibrancy: boolean
  reduceTransparency: boolean
  fullScreen: boolean
  windowKind: 'main' | 'settings' | 'report'
}

export interface WindowState {
  fullScreen: boolean
  reduceTransparency: boolean
}

export interface NotifyRequest {
  title: string
  body?: string
  route?: string
  revealPath?: string
}

export type SettingsPane = 'general' | 'grading' | 'charting' | 'film' | 'data'
export const SETTINGS_PANES: SettingsPane[] = ['general', 'grading', 'charting', 'film', 'data']

export interface DynamicMenus {
  seasons: { season: number; downloaded: boolean; checked: boolean }[]
  myTeams: { abbr: string; label: string }[]
  cutups: { id: string; label: string; smart: boolean }[]
  /** The selected player's tags in the tape room, else []. */
  tags: { index: number; label: string; checked: boolean }[]
  /** Checked item in Playback › Speed. */
  speed: number | null
  drawTool: string | null
  /** 02 §15.3 */
  angles: { angle: string; label: string; enabled: boolean; checked: boolean }[]
  secondAngle: { angle: string; label: string; checked: boolean }[]
  layout: 'single' | 'sideBySide' | 'pip' | null
  /** 03 §17 A5: the View menu's section items for the current screen. `index` is 1-based: the ⌥⌘ digit and the command's arg. */
  sections: { index: number; label: string; checked: boolean }[]
  /** The global season, for "Update 2025 Season Data". */
  season: number | null
}

export const EMPTY_DYNAMIC_MENUS: DynamicMenus = {
  seasons: [], myTeams: [], cutups: [], tags: [], speed: null, drawTool: null, angles: [], secondAngle: [], layout: null,
  sections: [], season: null
}

export interface ContextMenuItem {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu' | 'header'
  /** Shown only; context menus never register accelerators. */
  accelerator?: string
  enabled?: boolean
  checked?: boolean
  submenu?: ContextMenuItem[]
}

/** IPC channel names shared by main and preload. */
export const SHELL_CHANNELS = {
  menu: 'menu',
  commands: 'shell:commands',
  dynamicMenus: 'shell:dynamic-menus',
  textFocus: 'shell:text-focus',
  invoke: 'shell',
  settingsChanged: 'settings-changed',
  broadcastSettings: 'shell:settings-changed',
  windowState: 'window-state',
  trafficLights: 'shell:traffic-lights',
  zoom: 'shell:zoom',
  navigate: 'navigate',
  activity: 'activity',
  dockProgress: 'shell:dock-progress',
  dockBadge: 'shell:dock-badge',
  copyImage: 'shell:copy-image',
  contentHeight: 'shell:content-height',
  playback: 'shell:playback',
  beep: 'shell:beep'
} as const

export const SHELL_ARG_PREFIX = '--all22-shell='
