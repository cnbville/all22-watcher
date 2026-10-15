import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { COMMAND_BY_ID, DRAW_TOOLS, type CommandId, type CommandStateMap } from '@shared/commands'
import type { DynamicMenus } from '@shared/shell'

export interface RecentItem {
  label: string
  arg: string
}

export interface MenuState {
  commands: CommandStateMap
  dynamic: DynamicMenus
  textFocus: boolean
  /** Which kind of window is focused: the Settings window disables the screen menus (01 §3.2). */
  focused: 'main' | 'settings' | 'report' | null
  recent: RecentItem[]
}

/** Runs a menu command: main-handled ids act here, the rest go to the renderer (01 §3.2). */
export type MenuRunner = (id: CommandId, arg?: string) => void

const isMac = process.platform === 'darwin'

/** Always enabled, needing no registration (01 §3.5). */
const ALWAYS_ON = new Set<CommandId>([
  'app.settings', 'edit.find', 'file.openRecent', 'file.showDataFolder', 'window.main', 'help.shortcuts', 'help.welcome',
  'help.nflverse', 'view.reload'
])

const SCREEN_MENU = /^(view|play|grade|draw)\./

export function isEnabled(state: MenuState, id: CommandId): boolean {
  if (ALWAYS_ON.has(id)) return true
  if (state.focused === 'settings') {
    if (SCREEN_MENU.test(id) || id.startsWith('cutup.')) return false
    if (id === 'edit.undo' || id === 'edit.redo') return true
  }
  return state.commands[id]?.enabled ?? false
}

function labelOf(state: MenuState, id: CommandId): string {
  const def = COMMAND_BY_ID[id]
  const s = state.commands[id]
  if (s?.label) return s.label
  if (def.altLabel && s?.checked) return def.altLabel
  if (id === 'file.updateData' && state.dynamic.season) return `Update ${state.dynamic.season} Season Data`
  return def.label
}

/** Plain-key accelerators are attached only while the command is enabled and no text field has focus (01 §3.3). */
function accel(state: MenuState, id: CommandId, accelerator: string | undefined, plain: boolean): Partial<MenuItemConstructorOptions> {
  if (!accelerator) return {}
  if (plain) {
    if (!isEnabled(state, id) || state.textFocus || state.focused !== 'main') return {}
    return isMac ? { accelerator } : { accelerator, registerAccelerator: false }
  }
  return { accelerator }
}

/** The set of things that need a full rebuild when they change; everything else updates in place. */
export function menuSignature(state: MenuState): string {
  const labels = Object.entries(state.commands)
    .filter(([id, s]) => s?.label || (COMMAND_BY_ID[id as CommandId]?.altLabel && s?.checked))
    .map(([id, s]) => `${id}=${s?.label ?? 'alt'}`)
  const plain = Object.keys(COMMAND_BY_ID).filter((id) => COMMAND_BY_ID[id as CommandId].plain && isEnabled(state, id as CommandId))
  return JSON.stringify([labels, state.dynamic, state.textFocus, state.focused, state.recent, state.textFocus ? [] : plain])
}

export function buildMenu(state: MenuState, run: MenuRunner): Menu {
  const item = (id: CommandId, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions => {
    const def = COMMAND_BY_ID[id]
    const s = state.commands[id]
    return {
      id,
      label: labelOf(state, id),
      enabled: isEnabled(state, id),
      ...(def.type === 'checkbox' ? { type: 'checkbox', checked: !!s?.checked } : {}),
      ...accel(state, id, def.accelerator, !!def.plain),
      click: () => run(id),
      ...extra
    }
  }
  const sep: MenuItemConstructorOptions = { type: 'separator' }
  const header = (label: string): MenuItemConstructorOptions =>
    // Section headers in macOS menus; Linux shows them as disabled items.
    ({ label, type: 'header' as MenuItemConstructorOptions['type'], enabled: false })
  const disabled = (label: string): MenuItemConstructorOptions => ({ label, enabled: false })
  const d = state.dynamic

  const seasonItems: MenuItemConstructorOptions[] = [
    header('Downloaded'),
    ...d.seasons.filter((s) => s.downloaded).map((s) => radio('go.season', String(s.season), String(s.season), s.checked)),
    sep,
    header('Not Downloaded'),
    ...d.seasons.filter((s) => !s.downloaded).map((s) => radio('go.season', String(s.season), String(s.season), s.checked)),
    sep,
    item('go.manageSeasons', { enabled: true })
  ]
  function radio(id: CommandId, label: string, arg: string, checked: boolean, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions {
    return { label, type: 'radio', checked, enabled: isEnabled(state, id), click: () => run(id, arg), ...extra }
  }

  const speedItems = [0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => radio('play.speed', `${v}×`, String(v), d.speed === v))
  const tagItems: MenuItemConstructorOptions[] = d.tags.length
    ? d.tags.map((t) => ({
        label: t.label,
        type: 'checkbox',
        checked: t.checked,
        enabled: isEnabled(state, 'grade.toggleTag'),
        ...accel(state, 'grade.toggleTag', 'QWERTYUIOP'[t.index], true),
        click: () => run('grade.toggleTag', String(t.index))
      }))
    : [disabled('No Tags')]
  const toolLabels: Record<string, string> = {
    select: 'Select', pen: 'Pen', arrow: 'Arrow', line: 'Line', circle: 'Circle', box: 'Box', text: 'Text', spotlight: 'Spotlight'
  }
  const toolItems = DRAW_TOOLS.map((tool, i) =>
    radio('draw.tool', toolLabels[tool], tool, d.drawTool === tool, accel(state, 'draw.tool', String(i + 1), true))
  )
  const sectionItems: MenuItemConstructorOptions[] = d.sections.length
    ? [
        ...d.sections.map((s) =>
          radio('view.section', s.label, String(s.index), s.checked, s.index <= 8 ? { accelerator: `Alt+CmdOrCtrl+${s.index}` } : {})
        ),
        sep
      ]
    : []
  const angleItems: MenuItemConstructorOptions[] = d.angles.length
    ? d.angles.map((a) => radio('play.angle', a.label, a.angle, a.checked, { enabled: isEnabled(state, 'play.angle') && a.enabled }))
    : [disabled('No Angles')]

  const template: MenuItemConstructorOptions[] = []
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        sep,
        item('app.settings'),
        sep,
        { role: 'services' },
        sep,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { role: 'quit' }
      ]
    })
  }
  template.push({
    label: 'File',
    submenu: [
      item('file.newCutup'),
      item('file.newSmartCutup'),
      item('file.editCutupRules'),
      sep,
      item('file.importFilm'),
      item('file.fixMatches'),
      item('file.checkAlignment'),
      sep,
      {
        id: 'file.openRecent',
        label: 'Open Recent',
        submenu: state.recent.length
          ? state.recent.map((r) => ({ label: r.label, click: () => run('file.openRecent', r.arg) }))
          : [disabled('No Recent Film')]
      },
      sep,
      item('file.exportVideo'),
      item('file.exportCsv'),
      item('file.exportReport'),
      sep,
      item('file.updateData'),
      item('file.showDataFolder'),
      sep,
      // Settings lives in the app menu on the Mac and here elsewhere.
      ...(isMac ? [] : [item('app.settings'), sep]),
      { role: 'close', accelerator: 'CmdOrCtrl+W' },
      ...(isMac ? [] : [{ role: 'quit' } as MenuItemConstructorOptions])
    ]
  })
  template.push({
    label: 'Edit',
    submenu: [
      item('edit.undo'),
      item('edit.redo'),
      sep,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'delete' },
      item('cutup.removeSelected'),
      { role: 'selectAll' },
      sep,
      item('edit.find')
    ]
  })
  template.push({
    label: 'View',
    submenu: [
      ...sectionItems,
      item('view.sidebar'),
      item('view.playList'),
      item('view.inspector'),
      item('view.filters'),
      item('view.swapTeams'),
      sep,
      item('view.controls'),
      item('view.filmOnly'),
      { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [sep, item('view.reload'), { role: 'toggleDevTools', accelerator: 'Alt+CmdOrCtrl+J' } as MenuItemConstructorOptions])
    ]
  })
  template.push({
    label: 'Go',
    submenu: [
      item('go.back'),
      item('go.forward'),
      sep,
      item('go.home'),
      item('go.film'),
      item('go.teams'),
      item('go.leaderboards'),
      item('go.matchups'),
      sep,
      item('go.quickOpen'),
      sep,
      { id: 'go.season', label: 'Season', submenu: seasonItems },
      {
        id: 'go.team',
        label: 'My Teams',
        submenu: d.myTeams.length
          ? d.myTeams.map((t) => ({ label: t.label, enabled: isEnabled(state, 'go.team'), click: () => run('go.team', t.abbr) }))
          : [disabled('No Teams')]
      },
      {
        id: 'go.cutup',
        label: 'Cut-ups',
        submenu: [
          item('go.cutups'),
          sep,
          ...(d.cutups.length
            ? d.cutups.map((cu) => ({ label: cu.label, enabled: isEnabled(state, 'go.cutup'), click: () => run('go.cutup', cu.id) }))
            : [disabled('No Cut-ups')])
        ]
      }
    ]
  })
  template.push({
    label: 'Playback',
    submenu: [
      item('play.playAll'),
      sep,
      item('play.toggle'),
      sep,
      item('play.prevPlay'),
      item('play.nextPlay'),
      item('play.prevUngraded'),
      item('play.nextUngraded'),
      sep,
      item('play.frameBack'),
      item('play.frameForward'),
      item('play.secondBack'),
      item('play.secondForward'),
      sep,
      item('play.toSnap'),
      item('play.setSnap'),
      item('play.snapEarlier'),
      item('play.snapLater'),
      item('play.clearSnap'),
      item('play.startAtSnap'),
      sep,
      item('play.slower'),
      item('play.faster'),
      { id: 'play.speed', label: 'Speed', submenu: speedItems },
      item('play.loop'),
      item('play.sound'),
      sep,
      { id: 'play.angle', label: 'Angle', submenu: angleItems },
      item('play.nextAngle'),
      item('play.sideBySide'),
      item('play.pip'),
      ...(d.secondAngle.length
        ? [{ id: 'play.secondAngle', label: 'Second Angle', submenu: d.secondAngle.map((a) => radio('play.secondAngle', a.label, a.angle, a.checked)) }]
        : []),
      item('play.swapAngles'),
      sep,
      item('play.autoAdvance')
    ]
  })
  template.push({
    label: 'Grade',
    submenu: [
      item('grade.plus'),
      item('grade.zero'),
      item('grade.minus', { label: 'Minus' }),
      item('grade.clear'),
      item('grade.fillZeros'),
      item('grade.clearPlay'),
      sep,
      item('grade.critical'),
      item('grade.offField'),
      { id: 'grade.toggleTag', label: 'Tags', submenu: tagItems },
      sep,
      item('grade.nextPlayer'),
      item('grade.prevPlayer'),
      item('grade.addPlayer'),
      item('grade.star'),
      item('grade.playerNote'),
      sep,
      item('grade.focus'),
      item('grade.exitFocus'),
      sep,
      item('grade.flag'),
      item('grade.note'),
      item('grade.addToCutup'),
      sep,
      {
        label: 'Drawing',
        submenu: [item('draw.toggle'), sep, ...toolItems, sep, item('draw.deleteShape'), item('draw.undo'), item('draw.clear')]
      }
    ]
  })
  template.push({
    role: 'window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, sep, item('window.main'), ...(isMac ? [sep, { role: 'front' } as MenuItemConstructorOptions] : [])]
  })
  template.push({
    role: 'help',
    submenu: [item('help.shortcuts'), item('help.welcome'), sep, item('help.nflverse')]
  })
  return Menu.buildFromTemplate(template)
}

/** Updates enabled/checked in place, for changes that don't need a rebuild. */
export function updateMenuInPlace(menu: Menu, state: MenuState) {
  for (const id of Object.keys(COMMAND_BY_ID) as CommandId[]) {
    const mi = menu.getMenuItemById(id)
    if (!mi || mi.submenu) continue
    mi.enabled = isEnabled(state, id)
    if (COMMAND_BY_ID[id].type === 'checkbox') mi.checked = !!state.commands[id]?.checked
  }
}
