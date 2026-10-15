import { useEffect, useRef, useSyncExternalStore } from 'react'

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

/** True when keys are going into a text field (01 §7.3 step 4). A focused switch, slider or checkbox is not typing. */
export function isTyping(target: EventTarget | KeyboardEvent | null): boolean {
  const t = (target instanceof KeyboardEvent ? target.target : target) as HTMLElement | null
  if (!t || !(t instanceof HTMLElement)) return false
  if (t instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(t.type)
  return t.tagName === 'TEXTAREA' || t.isContentEditable
}

/** A mouse click never moves focus to a button, segment, switch or checkbox (macOS behavior, 01 §6.0). */
export const noMouseFocus = (e: React.MouseEvent) => e.preventDefault()

// Transient UI layers (01 §7.3 step 3): menus, popovers, Quick Open, the preview panel, sheets, the welcome.

export type LayerKind = 'menu' | 'popover' | 'quickOpen' | 'preview' | 'sheet' | 'welcome' | 'drop'

export interface Layer {
  kind: LayerKind
  /** Gets every key while this layer is on top. Return true when handled (the router prevents the default). */
  onKey?: (e: KeyboardEvent) => boolean
  /** esc on the topmost layer, when its onKey left esc alone. */
  close?: () => void
}

let stack: Layer[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function pushLayer(layer: Layer): () => void {
  stack = [...stack, layer]
  emit()
  return () => {
    stack = stack.filter((l) => l !== layer)
    emit()
  }
}

export function topLayer(): Layer | undefined {
  return stack[stack.length - 1]
}

export function layers(): readonly Layer[] {
  return stack
}

export function subscribeLayers(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Re-renders when layers open or close; returns the kinds currently open. */
export function useOpenLayers(): readonly Layer[] {
  return useSyncExternalStore(subscribeLayers, layers)
}

/** Registers a layer while `open` is true. Handlers are read through a ref so they can change every render. */
export function useLayer(open: boolean, layer: Layer) {
  const ref = useRef(layer)
  ref.current = layer
  useEffect(() => {
    if (!open) return
    return pushLayer({
      kind: layer.kind,
      onKey: (e) => ref.current.onKey?.(e) ?? false,
      close: () => ref.current.close?.()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, layer.kind])
}
