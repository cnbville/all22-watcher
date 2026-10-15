import { useSyncExternalStore } from 'react'
import type { ClipMatchRow, GameInfo } from '@shared/types'

/**
 * Requests for the Import Film sheet, from File › Import Film…, a team's game row, a Finder drop or the tape room's
 * Fix Clip Matches. The shell renders the sheet; `game` is chosen in the sheet when absent.
 */
export interface ImportRequest {
  game?: GameInfo
  team?: string
  paths?: string[]
  /** Fix Clip Matches: the saved rows (02 §18 passes clipId and snapMs too). */
  existing?: (ClipMatchRow & { clipId?: number; snapMs?: number | null })[]
  /** Fix Clip Matches: scroll to and highlight this play's clip rows. */
  focusPlayId?: number
  /** Fix Clip Matches opened from "Review…": show only the clips the alignment check flagged. */
  onlySuspects?: boolean
  onImported?: () => void
}

let current: ImportRequest | null = null
const listeners = new Set<() => void>()

export function openImport(req: ImportRequest = {}) {
  current = req
  listeners.forEach((l) => l())
}

export function closeImport() {
  current = null
  listeners.forEach((l) => l())
}

export function useImportRequest(): ImportRequest | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current
  )
}

/** Screens with a game in context (a team's game row, the tape room) offer it to drops and File › Import Film…. */
let context: { game: GameInfo; team: string } | null = null
const contextListeners = new Set<() => void>()
export function setImportContext(c: { game: GameInfo; team: string } | null) {
  context = c
  contextListeners.forEach((l) => l())
}
/** The game in context, reactively (File › Check Clip Alignment enables on it). */
export function useImportContext(): { game: GameInfo; team: string } | null {
  return useSyncExternalStore(
    (cb) => (contextListeners.add(cb), () => contextListeners.delete(cb)),
    () => context
  )
}
export function importContext() {
  return context
}

/** While the Import Film sheet is open it takes Finder drops itself instead of opening a new sheet. */
let sheetDrop: ((paths: string[]) => void) | null = null
export function setSheetDropHandler(fn: ((paths: string[]) => void) | null) {
  sheetDrop = fn
}
export function sheetDropHandler() {
  return sheetDrop
}
