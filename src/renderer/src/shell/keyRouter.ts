import { useEffect, useRef } from 'react'
import { KEYMAP, bindingMatches } from '@shared/commands'
import { isTyping, topLayer } from '../ui/keyboard'
import { commandState, runCommand } from './commands'

/**
 * The one keydown listener (01 §7.3), on window in the capture phase:
 * IME → transient layers → ⌘/⌃ → text fields → focused controls → KEYMAP → the screen's esc chain → default.
 */

type EscapeHandler = () => boolean
const escapeChain: { current: EscapeHandler }[] = []

/** Adds a step to the screen's esc chain (exit Film Only → exit Player Focus → clear the selection). Return true when handled. */
export function useEscape(handler: EscapeHandler, active = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    const entry = { current: () => ref.current() }
    escapeChain.push(entry)
    return () => {
      const i = escapeChain.indexOf(entry)
      if (i >= 0) escapeChain.splice(i, 1)
    }
  }, [active])
}

const CONTROL_ROLES = new Set(['slider', 'radio', 'tab', 'switch', 'checkbox', 'spinbutton', 'option'])
const CONTROL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Home', 'End', 'PageUp', 'PageDown'])

function isFocusedControl(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement) || t === document.body) return false
  if (t instanceof HTMLSelectElement) return true
  if (t instanceof HTMLInputElement) return true
  const role = t.getAttribute('role')
  return !!role && CONTROL_ROLES.has(role)
}

function onKeyDown(e: KeyboardEvent) {
  // 1. IME composition.
  if (e.isComposing || e.keyCode === 229) return

  // 3. A transient layer gets every key (⌘. included, for sheets); esc closes it. Nothing below sees the key.
  const top = topLayer()
  if (top) {
    if (top.onKey?.(e)) {
      e.preventDefault()
      e.stopPropagation()
    } else if (e.key === 'Escape' && !isTyping(e)) {
      top.close?.()
      e.preventDefault()
      e.stopPropagation()
    } else if (e.key === 'Escape') {
      // In a field inside a sheet or popover: the field reverts and blurs first; a second esc closes the layer.
      const field = e.target as HTMLElement
      setTimeout(() => {
        if (!e.defaultPrevented) field.blur()
      }, 0)
    }
    return
  }

  // 2. ⌘ and ⌃ combinations belong to the menu bar (and to native editing in text fields).
  if (e.metaKey || e.ctrlKey) return

  // 4. Text fields: everything types; esc reverts (the field's own handler) and blurs.
  if (isTyping(e)) {
    if (e.key === 'Escape') {
      const field = e.target as HTMLElement
      setTimeout(() => {
        if (!e.defaultPrevented) field.blur()
      }, 0)
    }
    return
  }

  // 5. A focused non-text control keeps its own keys.
  if (isFocusedControl(e.target) && CONTROL_KEYS.has(e.key)) return

  // 6. Plain-key bindings of the current screen.
  for (const b of KEYMAP) {
    if (!bindingMatches(b, e)) continue
    if (!commandState(b.command).enabled) continue
    e.preventDefault()
    e.stopPropagation()
    runCommand(b.command, b.arg)
    return
  }

  // 7. The screen's esc chain; esc never navigates.
  if (e.key === 'Escape') {
    for (let i = escapeChain.length - 1; i >= 0; i--) {
      if (escapeChain[i].current()) {
        e.preventDefault()
        return
      }
    }
  }
  // 8. Default browser behavior.
}

export function installKeyRouter(): () => void {
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
