import { sideOfGroup } from './teams'
import type { GradeEntry, Play, PositionGroup } from './types'

/**
 * Player Focus (02 §9.3): the snaps one player played in a game, in game order. With lineups, the plays he is listed on;
 * without, every snap of his side (offense, defense or special teams by position group). Either way, plays he is
 * credited on or has an entry for are added. The tape room's `focus.ts` re-exports these.
 */
export function focusSnaps(
  player: { id: string; group: PositionGroup },
  team: string,
  plays: Play[],
  entries: GradeEntry[],
  hasLineups: boolean
): Play[] {
  const withEntry = new Set(entries.filter((e) => e.playerId === player.id).map((e) => e.playId))
  const side = sideOfGroup(player.group)
  const on = (p: Play) => {
    if (hasLineups) return p.offensePlayers.includes(player.id) || p.defensePlayers.includes(player.id)
    if (side === 'special') return p.special
    return !p.special && (p.posteam === team) === (side === 'offense')
  }
  return plays.filter((p) => on(p) || p.involved.includes(player.id) || withEntry.has(p.playId)).sort((a, b) => a.playId - b.playId)
}

/** Progress through a player's snaps: Not on Field snaps are left out of the total. */
export function focusProgress(playerId: string, snaps: Play[], entries: GradeEntry[]): { graded: number; total: number; offField: number } {
  const ids = new Set(snaps.map((p) => p.playId))
  const mine = entries.filter((e) => e.playerId === playerId && ids.has(e.playId))
  const offField = mine.filter((e) => e.offField).length
  return { graded: mine.filter((e) => e.grade !== null).length, total: snaps.length - offField, offField }
}
