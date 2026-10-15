import { type ReactNode, useEffect, useRef, useSyncExternalStore } from 'react'
import { COMMAND_IDS, type CommandId, type CommandState, type CommandStateMap } from '@shared/commands'
import { type DynamicMenus, EMPTY_DYNAMIC_MENUS } from '@shared/shell'
import { useInSheet } from '../ui/Sheet'
import { isTyping, layers, subscribeLayers } from '../ui/keyboard'

/**
 * Renderer side of the command registry (01 §3.1). Every registration is a stack per id: the most recently
 * mounted one wins (a sheet's edit.undo beats the screen's) and unmounting pops it. The effective state of every
 * command goes to main once per animation frame so the menu bar enables, checks and relabels its items.
 */

export interface CommandOptions {
  enabled?: boolean
  checked?: boolean
  label?: string
}

interface Registration {
  run: (arg?: string) => void
  opts: CommandOptions
  sheet: boolean
}

/** Enabled without any registration (01 §3.5); main handles most of them itself. */
const ALWAYS_ON = new Set<CommandId>(['app.settings', 'edit.find', 'file.openRecent', 'file.showDataFolder', 'window.main', 'help.shortcuts', 'help.welcome', 'help.nflverse', 'view.reload'])
/** While a sheet is open, these report disabled unless the sheet registered them itself (01 §3.1). */
const SHEET_SCOPED = /^(file|view|go|play|grade|draw|cutup)\./

const regs = new Map<CommandId, Registration[]>()
const listeners = new Set<() => void>()
let version = 0

function changed() {
  version++
  listeners.forEach((l) => l())
  schedulePush()
}

const sheetOpen = () => layers().some((l) => l.kind === 'sheet' || l.kind === 'welcome')

export function commandState(id: CommandId): CommandState {
  const stack = regs.get(id)
  const top = stack?.[stack.length - 1]
  if (!top) return { enabled: ALWAYS_ON.has(id) }
  if (sheetOpen() && SHEET_SCOPED.test(id) && !top.sheet) return { enabled: false, checked: top.opts.checked, label: top.opts.label }
  return { enabled: top.opts.enabled ?? true, checked: top.opts.checked, label: top.opts.label }
}

/** Runs a command if it is enabled. Returns whether something ran. */
export function runCommand(id: CommandId, arg?: string): boolean {
  const stack = regs.get(id)
  const top = stack?.[stack.length - 1]
  if (!top || !commandState(id).enabled) return false
  top.run(arg)
  return true
}

/** Registers a handler for a command while the component is mounted. */
export function useCommand(id: CommandId, run: (arg?: string) => void, opts: CommandOptions = {}) {
  const inSheet = useInSheet()
  const runRef = useRef(run)
  runRef.current = run
  const reg = useRef<Registration | null>(null)
  useEffect(() => {
    const r: Registration = { run: (arg) => runRef.current(arg), opts: {}, sheet: inSheet }
    reg.current = r
    regs.set(id, [...(regs.get(id) ?? []), r])
    changed()
    return () => {
      const rest = (regs.get(id) ?? []).filter((x) => x !== r)
      if (rest.length) regs.set(id, rest)
      else regs.delete(id)
      reg.current = null
      changed()
    }
  }, [id, inSheet])
  const { enabled, checked, label } = opts
  useEffect(() => {
    const r = reg.current
    if (!r) return
    if (r.opts.enabled === enabled && r.opts.checked === checked && r.opts.label === label) return
    r.opts = { enabled, checked, label }
    changed()
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Re-renders when any command's state changes; returns this command's effective state. */
export function useCommandState(id: CommandId): CommandState {
  useSyncExternalStore(subscribe, () => version)
  useSyncExternalStore(subscribeLayers, layers)
  return commandState(id)
}

// Batched pushes to main.

let frame = 0
let lastSent = ''
function schedulePush() {
  if (frame || typeof window === 'undefined' || !window.shell) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const map: CommandStateMap = {}
    for (const id of COMMAND_IDS) {
      const s = commandState(id)
      if (s.enabled || s.checked !== undefined || s.label) map[id] = s
    }
    const json = JSON.stringify(map)
    if (json !== lastSent) {
      lastSent = json
      window.shell.setCommandState(map)
    }
    flushMenus()
  })
}

// Dynamic menus: the shell owns seasons, My Teams and cut-ups; screens add tags, speed, angles and sections.

let menus: DynamicMenus = { ...EMPTY_DYNAMIC_MENUS }
let menusSent = ''

export function setDynamicMenus(patch: Partial<DynamicMenus>) {
  menus = { ...menus, ...patch }
  schedulePush()
}

function flushMenus() {
  const json = JSON.stringify(menus)
  if (json === menusSent) return
  menusSent = json
  window.shell.setDynamicMenus(menus)
}

/** A screen's part of the dynamic menus, reset to empty when it unmounts. */
export function useDynamicMenus(patch: Partial<DynamicMenus>) {
  const json = JSON.stringify(patch)
  useEffect(() => {
    setDynamicMenus(JSON.parse(json) as Partial<DynamicMenus>)
  }, [json])
  useEffect(
    () => () => {
      const reset: Partial<DynamicMenus> = {}
      for (const k of Object.keys(JSON.parse(json) as object) as (keyof DynamicMenus)[]) {
        ;(reset as Record<string, unknown>)[k] = EMPTY_DYNAMIC_MENUS[k]
      }
      setDynamicMenus(reset)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
}

/** Mounted once at the root: routes menu clicks to commands and reports text focus to main (01 §3.3). */
export function CommandProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!window.shell) return
    const offMenu = window.shell.onMenu((id, arg) => {
      runCommand(id, arg)
    })
    const offLayers = subscribeLayers(changed)
    let typing = false
    const report = () => {
      const now = isTyping(document.activeElement)
      if (now !== typing) {
        typing = now
        window.shell.setTextFocus(now)
      }
    }
    const onFocusOut = () => setTimeout(report, 0)
    document.addEventListener('focusin', report)
    document.addEventListener('focusout', onFocusOut)
    changed()
    return () => {
      offMenu()
      offLayers()
      document.removeEventListener('focusin', report)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])
  return <>{children}</>
}
