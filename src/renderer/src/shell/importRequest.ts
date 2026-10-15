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
  /** Fix Clip Matches: the saved rows. */
  existing?: ClipMatchRow[]
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
export function setImportContext(c: { game: GameInfo; team: string } | null) {
  context = c
}
export function importContext() {
  return context
}
