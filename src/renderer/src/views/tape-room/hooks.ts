import type { PlayRef } from '@shared/types'

/**
 * Entry points the tape room calls into screens that live elsewhere. The Export Video sheet (03) registers itself
 * here when it mounts; until it does, File › Export Play Video… tells the user it isn't available.
 */
export interface ExportVideoRequest {
  source: { kind: 'plays'; label: string; team: string; plays: PlayRef[] }
  /** The Player Focus player, so the export can spotlight them. */
  playerId: string | null
}

export const tapeRoomHooks: {
  exportVideo?: (req: ExportVideoRequest) => void
} = {}
