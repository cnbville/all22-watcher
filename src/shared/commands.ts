import type { IconName } from './icons'

/**
 * The command registry: one list drives the menu bar, renderer shortcuts, toolbar tooltips, Quick Open's
 * Commands section and the Keyboard Shortcuts sheet (spec 01 §3.1, with 02 §15 and 03 §13 additions).
 */
export const COMMAND_IDS = [
  'app.settings',
  // File
  'file.newCutup', 'file.newSmartCutup', 'file.editCutupRules', 'file.importFilm', 'file.fixMatches', 'file.checkAlignment',
  'file.openRecent', 'file.exportVideo', 'file.exportCsv', 'file.exportReport', 'file.updateData', 'file.showDataFolder',
  // Edit
  'edit.undo', 'edit.redo', 'cutup.removeSelected', 'edit.find',
  // View
  'view.section', 'view.sidebar', 'view.playList', 'view.inspector', 'view.filters', 'view.swapTeams', 'view.controls',
  'view.filmOnly', 'view.reload',
  // Go
  'go.back', 'go.forward', 'go.home', 'go.film', 'go.teams', 'go.leaderboards', 'go.matchups', 'go.quickOpen', 'go.season',
  'go.manageSeasons', 'go.team', 'go.cutups', 'go.cutup',
  // Playback
  'play.playAll', 'play.toggle', 'play.prevPlay', 'play.nextPlay', 'play.prevUngraded', 'play.nextUngraded', 'play.frameBack',
  'play.frameForward', 'play.secondBack', 'play.secondForward', 'play.toSnap', 'play.setSnap', 'play.snapEarlier',
  'play.snapLater', 'play.clearSnap', 'play.startAtSnap', 'play.slower', 'play.faster', 'play.speed', 'play.loop', 'play.sound',
  'play.angle', 'play.nextAngle', 'play.sideBySide', 'play.pip', 'play.secondAngle', 'play.swapAngles', 'play.autoAdvance',
  // Grade
  'grade.plus', 'grade.zero', 'grade.minus', 'grade.clear', 'grade.fillZeros', 'grade.clearPlay', 'grade.critical',
  'grade.offField', 'grade.toggleTag', 'grade.nextPlayer', 'grade.prevPlayer', 'grade.addPlayer', 'grade.star',
  'grade.playerNote', 'grade.focus', 'grade.exitFocus', 'grade.flag', 'grade.note', 'grade.addToCutup', 'grade.selectPlayer',
  // Drawing
  'draw.toggle', 'draw.tool', 'draw.deleteShape', 'draw.undo', 'draw.clear', 'draw.duplicate', 'draw.bringToFront',
  'draw.sendToBack',
  // Window and Help
  'window.main', 'help.shortcuts', 'help.welcome', 'help.nflverse'
] as const

export type CommandId = (typeof COMMAND_IDS)[number]

export type MenuName = 'app' | 'file' | 'edit' | 'view' | 'go' | 'playback' | 'grade' | 'window' | 'help' | 'none'

export interface CommandDef {
  id: CommandId
  /** Menu label, Title Case. */
  label: string
  /** Label when the command's state is "on": 'Hide Sidebar', 'Unflag Play'. */
  altLabel?: string
  /** Electron accelerator, e.g. 'CmdOrCtrl+Shift+E', 'Space', 'Shift+Left'. */
  accelerator?: string
  /** True when the accelerator has no ⌘/⌃ (01 §3.3): attached to the menu only while enabled and not typing. */
  plain?: boolean
  menu: MenuName
  icon?: IconName
  type?: 'normal' | 'checkbox' | 'radio'
  /** Listed under Commands in Quick Open. */
  quickOpen?: boolean
}

const c = (def: CommandDef): CommandDef => def

export const COMMANDS: readonly CommandDef[] = [
  c({ id: 'app.settings', label: 'Settings…', accelerator: 'CmdOrCtrl+,', menu: 'app', icon: 'settings', quickOpen: true }),

  c({ id: 'file.newCutup', label: 'New Cut-up', accelerator: 'CmdOrCtrl+N', menu: 'file', icon: 'list-plus', quickOpen: true }),
  c({ id: 'file.newSmartCutup', label: 'New Smart Cut-up…', accelerator: 'Alt+CmdOrCtrl+N', menu: 'file', icon: 'list-filter', quickOpen: true }),
  c({ id: 'file.editCutupRules', label: 'Edit Smart Cut-up Rules…', menu: 'file', icon: 'list-filter' }),
  c({ id: 'file.importFilm', label: 'Import Film…', accelerator: 'CmdOrCtrl+I', menu: 'file', icon: 'folder-input', quickOpen: true }),
  c({ id: 'file.fixMatches', label: 'Fix Clip Matches…', accelerator: 'Shift+CmdOrCtrl+I', menu: 'file', icon: 'arrow-down-up', quickOpen: true }),
  c({ id: 'file.checkAlignment', label: 'Check Clip Alignment', menu: 'file', icon: 'timer', quickOpen: true }),
  c({ id: 'file.openRecent', label: 'Open Recent', menu: 'file' }),
  c({ id: 'file.exportVideo', label: 'Export Video…', accelerator: 'CmdOrCtrl+E', menu: 'file', icon: 'clapperboard', quickOpen: true }),
  c({ id: 'file.exportCsv', label: 'Export Grades as CSV…', accelerator: 'Shift+CmdOrCtrl+E', menu: 'file', icon: 'file-spreadsheet', quickOpen: true }),
  c({ id: 'file.exportReport', label: 'Export Scouting Report (PDF)…', accelerator: 'Alt+CmdOrCtrl+E', menu: 'file', icon: 'file-text', quickOpen: true }),
  c({ id: 'file.updateData', label: 'Update Season Data', accelerator: 'Alt+CmdOrCtrl+R', menu: 'file', icon: 'refresh-cw', quickOpen: true }),
  c({ id: 'file.showDataFolder', label: 'Show Data Folder in Finder', menu: 'file', icon: 'folder-open', quickOpen: true }),

  c({ id: 'edit.undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', menu: 'edit', icon: 'undo-2' }),
  c({ id: 'edit.redo', label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', menu: 'edit', icon: 'redo-2' }),
  c({ id: 'cutup.removeSelected', label: 'Remove from Cut-up', accelerator: 'Backspace', plain: true, menu: 'edit', icon: 'trash-2' }),
  c({ id: 'edit.find', label: 'Find…', accelerator: 'CmdOrCtrl+F', menu: 'edit', icon: 'search' }),

  c({ id: 'view.section', label: 'Section', menu: 'view', type: 'radio' }),
  c({ id: 'view.sidebar', label: 'Show Sidebar', altLabel: 'Hide Sidebar', accelerator: 'Ctrl+CmdOrCtrl+S', menu: 'view', icon: 'panel-left', quickOpen: true }),
  c({ id: 'view.playList', label: 'Show Play List', altLabel: 'Hide Play List', accelerator: 'Alt+CmdOrCtrl+L', menu: 'view', icon: 'layout-list' }),
  c({ id: 'view.inspector', label: 'Show Inspector', altLabel: 'Hide Inspector', accelerator: 'Alt+CmdOrCtrl+I', menu: 'view', icon: 'panel-right', quickOpen: true }),
  c({ id: 'view.filters', label: 'Show Filters', accelerator: 'Alt+CmdOrCtrl+F', menu: 'view', icon: 'funnel' }),
  c({ id: 'view.swapTeams', label: 'Swap Teams', menu: 'view', icon: 'arrow-left-right' }),
  c({ id: 'view.controls', label: 'Show Controls', altLabel: 'Hide Controls', accelerator: 'H', plain: true, menu: 'view' }),
  c({ id: 'view.filmOnly', label: 'Enter Film Only', altLabel: 'Exit Film Only', accelerator: 'Shift+CmdOrCtrl+F', menu: 'view', icon: 'maximize-2', quickOpen: true }),
  c({ id: 'view.reload', label: 'Reload', accelerator: 'CmdOrCtrl+R', menu: 'view' }),

  c({ id: 'go.back', label: 'Back', accelerator: 'CmdOrCtrl+[', menu: 'go', icon: 'chevron-left' }),
  c({ id: 'go.forward', label: 'Forward', accelerator: 'CmdOrCtrl+]', menu: 'go', icon: 'chevron-right' }),
  c({ id: 'go.home', label: 'Home', accelerator: 'CmdOrCtrl+1', menu: 'go', icon: 'house' }),
  c({ id: 'go.film', label: 'Film', accelerator: 'CmdOrCtrl+2', menu: 'go', icon: 'film' }),
  c({ id: 'go.teams', label: 'Teams', accelerator: 'CmdOrCtrl+3', menu: 'go', icon: 'shield' }),
  c({ id: 'go.leaderboards', label: 'Leaderboards', accelerator: 'CmdOrCtrl+4', menu: 'go', icon: 'trophy' }),
  c({ id: 'go.matchups', label: 'Matchups', accelerator: 'CmdOrCtrl+5', menu: 'go', icon: 'swords' }),
  c({ id: 'go.quickOpen', label: 'Quick Open…', accelerator: 'CmdOrCtrl+K', menu: 'go', icon: 'search' }),
  c({ id: 'go.season', label: 'Season', menu: 'go', type: 'radio' }),
  c({ id: 'go.manageSeasons', label: 'Manage Seasons…', menu: 'go', icon: 'database', quickOpen: true }),
  c({ id: 'go.team', label: 'My Teams', menu: 'go' }),
  c({ id: 'go.cutups', label: 'Show All Cut-ups', menu: 'go', icon: 'list-video', quickOpen: true }),
  c({ id: 'go.cutup', label: 'Cut-ups', menu: 'go' }),

  c({ id: 'play.playAll', label: 'Play All', accelerator: 'Alt+CmdOrCtrl+P', menu: 'playback', icon: 'play' }),
  c({ id: 'play.toggle', label: 'Play', altLabel: 'Pause', accelerator: 'Space', plain: true, menu: 'playback', icon: 'play' }),
  c({ id: 'play.prevPlay', label: 'Previous Play', accelerator: 'Up', plain: true, menu: 'playback', icon: 'skip-back' }),
  c({ id: 'play.nextPlay', label: 'Next Play', accelerator: 'Down', plain: true, menu: 'playback', icon: 'skip-forward' }),
  c({ id: 'play.prevUngraded', label: 'Previous Ungraded Play', accelerator: 'Alt+Up', plain: true, menu: 'playback' }),
  c({ id: 'play.nextUngraded', label: 'Next Ungraded Play', accelerator: 'Alt+Down', plain: true, menu: 'playback' }),
  c({ id: 'play.frameBack', label: 'Back One Frame', accelerator: 'Left', plain: true, menu: 'playback', icon: 'step-back' }),
  c({ id: 'play.frameForward', label: 'Forward One Frame', accelerator: 'Right', plain: true, menu: 'playback', icon: 'step-forward' }),
  c({ id: 'play.secondBack', label: 'Back One Second', accelerator: 'Shift+Left', plain: true, menu: 'playback' }),
  c({ id: 'play.secondForward', label: 'Forward One Second', accelerator: 'Shift+Right', plain: true, menu: 'playback' }),
  c({ id: 'play.toSnap', label: 'Replay from Snap', accelerator: 'B', plain: true, menu: 'playback', icon: 'rotate-ccw' }),
  c({ id: 'play.setSnap', label: 'Set Snap Here', accelerator: 'Shift+B', plain: true, menu: 'playback', icon: 'crosshair' }),
  c({ id: 'play.snapEarlier', label: 'Nudge Snap Earlier', accelerator: 'Alt+Left', plain: true, menu: 'playback' }),
  c({ id: 'play.snapLater', label: 'Nudge Snap Later', accelerator: 'Alt+Right', plain: true, menu: 'playback' }),
  c({ id: 'play.clearSnap', label: 'Clear Snap Point', menu: 'playback' }),
  c({ id: 'play.startAtSnap', label: 'Start Clips at Snap', menu: 'playback', type: 'checkbox' }),
  c({ id: 'play.slower', label: 'Slower', accelerator: '[', plain: true, menu: 'playback' }),
  c({ id: 'play.faster', label: 'Faster', accelerator: ']', plain: true, menu: 'playback' }),
  c({ id: 'play.speed', label: 'Speed', menu: 'playback', icon: 'gauge', type: 'radio' }),
  c({ id: 'play.loop', label: 'Loop', accelerator: 'L', plain: true, menu: 'playback', icon: 'repeat', type: 'checkbox' }),
  c({ id: 'play.sound', label: 'Sound', accelerator: 'M', plain: true, menu: 'playback', icon: 'volume-2', type: 'checkbox' }),
  c({ id: 'play.angle', label: 'Angle', menu: 'playback', icon: 'video', type: 'radio' }),
  c({ id: 'play.nextAngle', label: 'Next Angle', accelerator: 'A', plain: true, menu: 'playback', icon: 'video' }),
  c({ id: 'play.sideBySide', label: 'Side-by-Side Angles', accelerator: 'S', plain: true, menu: 'playback', icon: 'columns-2', type: 'checkbox' }),
  c({ id: 'play.pip', label: 'Picture in Picture', menu: 'playback', icon: 'picture-in-picture-2', type: 'checkbox' }),
  c({ id: 'play.secondAngle', label: 'Second Angle', menu: 'playback', type: 'radio' }),
  c({ id: 'play.swapAngles', label: 'Swap Angles', menu: 'playback', icon: 'arrow-left-right' }),
  c({ id: 'play.autoAdvance', label: 'Auto-Advance', menu: 'playback', type: 'checkbox' }),

  c({ id: 'grade.plus', label: 'Plus', accelerator: '=', plain: true, menu: 'grade' }),
  c({ id: 'grade.zero', label: 'Zero', accelerator: '0', plain: true, menu: 'grade' }),
  c({ id: 'grade.minus', label: 'Minus', accelerator: '-', plain: true, menu: 'grade' }),
  c({ id: 'grade.clear', label: 'Clear Grade', accelerator: 'Backspace', plain: true, menu: 'grade' }),
  c({ id: 'grade.fillZeros', label: 'Grade Everyone Left 0', accelerator: 'Shift+0', plain: true, menu: 'grade' }),
  c({ id: 'grade.clearPlay', label: 'Clear Grades on This Play', menu: 'grade' }),
  c({ id: 'grade.critical', label: 'Mark Critical', altLabel: 'Unmark Critical', accelerator: '!', plain: true, menu: 'grade', icon: 'zap' }),
  c({ id: 'grade.offField', label: 'Not on Field', accelerator: 'X', plain: true, menu: 'grade', icon: 'user-round-x', type: 'checkbox' }),
  c({ id: 'grade.toggleTag', label: 'Tags', menu: 'grade', icon: 'tags', type: 'checkbox' }),
  c({ id: 'grade.nextPlayer', label: 'Next Player', accelerator: 'Tab', plain: true, menu: 'grade' }),
  c({ id: 'grade.prevPlayer', label: 'Previous Player', accelerator: 'Shift+Tab', plain: true, menu: 'grade' }),
  c({ id: 'grade.addPlayer', label: 'Add Player…', menu: 'grade', icon: 'plus' }),
  c({ id: 'grade.star', label: 'Star Player', altLabel: 'Unstar Player', menu: 'grade', icon: 'star' }),
  c({ id: 'grade.playerNote', label: 'Add Player Note', accelerator: 'Shift+N', plain: true, menu: 'grade', icon: 'message-square-text' }),
  c({ id: 'grade.focus', label: 'Player Focus…', accelerator: 'G', plain: true, menu: 'grade', icon: 'scan-eye' }),
  c({ id: 'grade.exitFocus', label: 'Exit Player Focus', accelerator: 'Shift+G', plain: true, menu: 'grade' }),
  c({ id: 'grade.flag', label: 'Flag Play', altLabel: 'Unflag Play', accelerator: 'F', plain: true, menu: 'grade', icon: 'flag' }),
  c({ id: 'grade.note', label: 'Add Play Note', accelerator: 'N', plain: true, menu: 'grade', icon: 'message-square-text' }),
  c({ id: 'grade.addToCutup', label: 'Add Play to Cut-up…', accelerator: 'CmdOrCtrl+D', menu: 'grade', icon: 'bookmark-plus' }),
  c({ id: 'grade.selectPlayer', label: 'Select Player', menu: 'none' }),

  c({ id: 'draw.toggle', label: 'Draw', accelerator: 'D', plain: true, menu: 'grade', icon: 'pen-line', type: 'checkbox' }),
  c({ id: 'draw.tool', label: 'Tool', menu: 'grade', type: 'radio' }),
  c({ id: 'draw.deleteShape', label: 'Delete Drawing', accelerator: 'Backspace', plain: true, menu: 'grade', icon: 'trash-2' }),
  c({ id: 'draw.undo', label: 'Undo Last Drawing', accelerator: 'Z', plain: true, menu: 'grade', icon: 'undo-2' }),
  c({ id: 'draw.clear', label: 'Clear Drawings', accelerator: 'C', plain: true, menu: 'grade', icon: 'eraser' }),
  c({ id: 'draw.duplicate', label: 'Duplicate Drawing', menu: 'none', icon: 'copy' }),
  c({ id: 'draw.bringToFront', label: 'Bring to Front', menu: 'none', icon: 'bring-to-front' }),
  c({ id: 'draw.sendToBack', label: 'Send to Back', menu: 'none', icon: 'send-to-back' }),

  c({ id: 'window.main', label: 'Main Window', accelerator: 'CmdOrCtrl+0', menu: 'window' }),
  c({ id: 'help.shortcuts', label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', menu: 'help', icon: 'keyboard', quickOpen: true }),
  c({ id: 'help.welcome', label: 'Welcome to All-22 Watcher', menu: 'help', icon: 'circle-help', quickOpen: true }),
  c({ id: 'help.nflverse', label: 'nflverse Data on GitHub', menu: 'help' })
]

export const COMMAND_BY_ID = Object.fromEntries(COMMANDS.map((d) => [d.id, d])) as Record<CommandId, CommandDef>

export interface CommandState {
  enabled: boolean
  checked?: boolean
  label?: string
}
export type CommandStateMap = Partial<Record<CommandId, CommandState>>

/** A plain-key binding handled by the renderer's key router (01 §7.3 step 6), in priority order. */
export interface KeyBinding {
  /** `KeyboardEvent.key` ('Space' for ' '); letters match case-insensitively. */
  key: string
  /** Matched on `KeyboardEvent.code` instead of `key` (⇧0 on layouts where Shift+0 is not ")"). */
  code?: string
  shift?: boolean
  alt?: boolean
  command: CommandId
  arg?: string
}

const TAG_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']
export const DRAW_TOOLS = ['select', 'pen', 'arrow', 'line', 'circle', 'box', 'text', 'spotlight'] as const

export const KEYMAP: readonly KeyBinding[] = [
  { key: '0', code: 'Digit0', shift: true, command: 'grade.fillZeros' },
  { key: ')', command: 'grade.fillZeros' },
  { key: 'Space', command: 'play.toggle' },
  { key: 'ArrowLeft', command: 'play.frameBack' },
  { key: 'ArrowRight', command: 'play.frameForward' },
  { key: 'ArrowLeft', shift: true, command: 'play.secondBack' },
  { key: 'ArrowRight', shift: true, command: 'play.secondForward' },
  { key: 'ArrowLeft', alt: true, command: 'play.snapEarlier' },
  { key: 'ArrowRight', alt: true, command: 'play.snapLater' },
  { key: 'ArrowUp', command: 'play.prevPlay' },
  { key: 'ArrowDown', command: 'play.nextPlay' },
  { key: 'Enter', command: 'play.nextPlay' },
  { key: 'ArrowUp', alt: true, command: 'play.prevUngraded' },
  { key: 'ArrowDown', alt: true, command: 'play.nextUngraded' },
  { key: 'b', command: 'play.toSnap' },
  { key: 'b', shift: true, command: 'play.setSnap' },
  { key: '[', command: 'play.slower' },
  { key: ']', command: 'play.faster' },
  { key: 'l', command: 'play.loop' },
  { key: 'a', command: 'play.nextAngle' },
  { key: 's', command: 'play.sideBySide' },
  { key: 'm', command: 'play.sound' },
  { key: 'h', command: 'view.controls' },
  ...DRAW_TOOLS.map((tool, i): KeyBinding => ({ key: String(i + 1), command: 'draw.tool', arg: tool })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): KeyBinding => ({ key: String(n), command: 'grade.selectPlayer', arg: String(n) })),
  { key: 'Tab', command: 'grade.nextPlayer' },
  { key: 'Tab', shift: true, command: 'grade.prevPlayer' },
  { key: '=', command: 'grade.plus' },
  { key: '+', command: 'grade.plus' },
  { key: '0', command: 'grade.zero' },
  { key: '-', command: 'grade.minus' },
  { key: 'Backspace', command: 'cutup.removeSelected' },
  { key: 'Backspace', command: 'draw.deleteShape' },
  { key: 'Delete', command: 'draw.deleteShape' },
  { key: 'Backspace', command: 'grade.clear' },
  { key: 'Delete', command: 'grade.clear' },
  { key: '!', command: 'grade.critical' },
  { key: 'x', command: 'grade.offField' },
  ...TAG_KEYS.map((key, i): KeyBinding => ({ key, command: 'grade.toggleTag', arg: String(i) })),
  { key: 'n', shift: true, command: 'grade.playerNote' },
  { key: 'n', command: 'grade.note' },
  { key: 'f', command: 'grade.flag' },
  { key: 'g', command: 'grade.focus' },
  { key: 'g', shift: true, command: 'grade.exitFocus' },
  { key: 'd', command: 'draw.toggle' },
  { key: 'z', command: 'draw.undo' },
  { key: 'c', command: 'draw.clear' },
  { key: '?', command: 'help.shortcuts', arg: 'tape' }
]

/**
 * Commands that share keys because their enabled conditions never overlap (02 §23 A5): Draw mode versus
 * player selection, a selected shape versus a selected player, a cut-up list versus the tape room.
 */
export const EXCLUSIVE_BINDINGS: readonly (readonly [CommandId, CommandId])[] = [
  ['grade.selectPlayer', 'draw.tool'],
  ['grade.clear', 'draw.deleteShape'],
  ['grade.clear', 'cutup.removeSelected'],
  ['draw.deleteShape', 'cutup.removeSelected']
]

/** True when a binding matches a keydown (02 §15.4: letters ignore Caps Lock; shifted symbols ignore Shift). */
export function bindingMatches(b: KeyBinding, e: { key: string; code?: string; shiftKey: boolean; altKey: boolean }): boolean {
  if (b.code) return e.code === b.code && e.shiftKey === !!b.shift && e.altKey === !!b.alt
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (key !== (b.key.length === 1 ? b.key.toLowerCase() : b.key)) return false
  if (e.altKey !== !!b.alt) return false
  const symbol = b.key.length === 1 && !/[a-z0-9]/i.test(b.key)
  return symbol || e.shiftKey === !!b.shift
}

const IS_MAC = typeof navigator !== 'undefined' ? /Mac/.test(navigator.platform) : typeof process !== 'undefined' && process.platform === 'darwin'

const KEY_GLYPHS: Record<string, string> = {
  Up: '↑', Down: '↓', Left: '←', Right: '→', Space: 'Space', Backspace: '⌫', Delete: '⌦', Tab: '⇥', Enter: '↩',
  Return: '↩', Escape: 'esc', '-': '−'
}

/** 'Shift+CmdOrCtrl+E' → '⇧⌘E' (macOS modifier order ⌃⌥⇧⌘). */
export function acceleratorGlyphs(acc: string | undefined, mac = IS_MAC): string {
  if (!acc) return ''
  const parts = acc.split('+')
  // A '+' key itself splits into two empty parts.
  let key = parts.pop() ?? ''
  if (key === '' && acc.endsWith('+')) {
    key = '+'
    parts.pop()
  }
  const mods = new Set(parts.map((p) => p.toLowerCase()))
  let out = ''
  if (mac) {
    if (mods.has('ctrl') || mods.has('control')) out += '⌃'
    if (mods.has('alt') || mods.has('option')) out += '⌥'
    if (mods.has('shift')) out += '⇧'
    if (mods.has('cmdorctrl') || mods.has('cmd') || mods.has('command')) out += '⌘'
  } else {
    const names: string[] = []
    if (mods.has('ctrl') || mods.has('control') || mods.has('cmdorctrl')) names.push('Ctrl')
    if (mods.has('alt')) names.push('Alt')
    if (mods.has('shift')) names.push('Shift')
    return [...names, KEY_GLYPHS[key] ?? key].join('+')
  }
  return out + (KEY_GLYPHS[key] ?? key)
}

/** "Back (⌘[)" — a control's tooltip: its label, then its shortcut in parentheses (01 §6.0). */
export function commandTooltip(id: CommandId, label?: string): string {
  const def = COMMAND_BY_ID[id]
  const text = (label ?? def.label).replace(/…$/, '')
  const keys = acceleratorGlyphs(def.accelerator)
  return keys ? `${text} (${keys})` : text
}
