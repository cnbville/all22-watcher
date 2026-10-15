import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * The tape room's one undo stack (02 §7.7, §11.12): grades, tags, flags, snaps, chart fields and drawings. Edit ›
 * Undo shows "Undo Grade" etc. Entries say where they apply so an undo can bring that play (and player or angle)
 * back into view first. Cleared when the room unmounts.
 */

export interface UndoTarget {
  playId: number
  playerId?: string
  angle?: string
}

export interface UndoEntry {
  label: string
  undo(): void
  redo(): void
  target?: UndoTarget
  /** Entries with the same key pushed less than `mergeWithin` ms apart merge into one (snap nudges). */
  mergeKey?: string
  mergeWithin?: number
}

interface Stored extends UndoEntry {
  at: number
}

export class UndoStack {
  private done: Stored[] = []
  private undone: Stored[] = []
  private listeners = new Set<() => void>()
  private version = 0

  push(e: UndoEntry) {
    const now = performance.now()
    const last = this.done[this.done.length - 1]
    if (e.mergeKey && last?.mergeKey === e.mergeKey && now - last.at < (e.mergeWithin ?? 1000)) {
      // Keep the first entry's undo; take the newest redo.
      this.done[this.done.length - 1] = { ...last, redo: e.redo, at: now }
    } else {
      this.done.push({ ...e, at: now })
      if (this.done.length > 200) this.done.shift()
    }
    this.undone = []
    this.changed()
  }

  undo(): UndoEntry | null {
    const e = this.done.pop()
    if (!e) return null
    e.undo()
    this.undone.push(e)
    this.changed()
    return e
  }

  redo(): UndoEntry | null {
    const e = this.undone.pop()
    if (!e) return null
    e.redo()
    this.done.push({ ...e, at: 0 })
    this.changed()
    return e
  }

  peekUndo(): UndoEntry | undefined {
    return this.done[this.done.length - 1]
  }

  peekRedo(): UndoEntry | undefined {
    return this.undone[this.undone.length - 1]
  }

  clear() {
    this.done = []
    this.undone = []
    this.changed()
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getVersion = () => this.version

  private changed() {
    this.version++
    this.listeners.forEach((l) => l())
  }
}

/** One stack per mounted tape room; re-renders on every change. */
export function useUndoStack(): UndoStack {
  const ref = useRef<UndoStack | null>(null)
  if (!ref.current) ref.current = new UndoStack()
  const stack = ref.current
  useSyncExternalStore(stack.subscribe, stack.getVersion)
  useEffect(() => () => stack.clear(), [stack])
  return stack
}
