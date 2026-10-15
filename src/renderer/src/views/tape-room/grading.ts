import { POSITION_GROUPS, sideOfGroup } from '@shared/teams'
import type { Grade, GradeEntry, Play, PositionGroup, RosterPlayer, TagDef } from '@shared/types'

/** Who is graded on a play, who is selected first, and how far along a play is (02 §7.1, §7.2, §4.6.2). */

export const entryKey = (playId: number, playerId: string) => `${playId}|${playerId}`

export function emptyEntry(gameId: string, playId: number, playerId: string, team: string): GradeEntry {
  return { gameId, playId, playerId, team, grade: null, tags: [], note: '', critical: false, offField: false }
}

/** An entry that would be deleted on save (v1 rule plus the two flags). */
export function isEmptyEntry(e: GradeEntry): boolean {
  return e.grade === null && !e.tags.length && !e.note.trim() && !e.critical && !e.offField
}

/** Position group, then jersey, then name (v1 `byPosition`). */
export function byPosition(a: RosterPlayer, b: RosterPlayer): number {
  return (
    POSITION_GROUPS.indexOf(a.group) - POSITION_GROUPS.indexOf(b.group) ||
    (Number(a.jersey) || 99) - (Number(b.jersey) || 99) ||
    a.name.localeCompare(b.name)
  )
}

/** A row for a player id the roster doesn't know (v1 `stubPlayer`). */
export function stubPlayer(id: string, team: string): RosterPlayer {
  return {
    id, name: id, team, position: '', depthPos: '', group: 'ST' as PositionGroup, jersey: '', status: '',
    headshot: '', college: '', height: '', weight: '', yearsExp: ''
  }
}

/**
 * The listed players for a play and studied team (02 §7.1, v1 rule written out): the 11 on the field when nflverse
 * has lineups (only the starred ones with Show Starred Players Only); otherwise the starred players of the play's side
 * plus the players credited in the play-by-play; plus everyone with an entry on the play. Sorted by position.
 */
export function listedPlayers(
  play: Play,
  team: string,
  pinned: readonly string[],
  starredOnly: boolean,
  entries: readonly GradeEntry[],
  players: Record<string, RosterPlayer>
): RosterPlayer[] {
  const onOffense = play.posteam === team
  const onField = onOffense ? play.offensePlayers : play.defensePlayers
  let ids: string[] = []
  if (onField.length) {
    ids = [...onField]
    if (starredOnly && pinned.length) ids = onField.filter((id) => pinned.includes(id))
  } else {
    const side = play.special ? 'special' : onOffense ? 'offense' : 'defense'
    ids.push(
      ...pinned.filter((id) => {
        const p = players[id]
        return !p || play.special || sideOfGroup(p.group) === side
      })
    )
    if (!starredOnly) ids.push(...play.involved.filter((id) => players[id]?.team === team))
  }
  for (const e of entries) if (e.playId === play.playId && e.team === team && !isEmptyEntry(e)) ids.push(e.playerId)
  return [...new Set(ids)].map((id) => players[id] ?? stubPlayer(id, team)).sort(byPosition)
}

/** On entering a play: the first listed player with no grade who isn't Not on Field, else the first (02 §7.2). */
export function firstToGrade(list: readonly RosterPlayer[], entryOf: (playerId: string) => GradeEntry | undefined): string | null {
  const open = list.find((p) => {
    const e = entryOf(p.id)
    return !e || (e.grade === null && !e.offField)
  })
  return (open ?? list[0])?.id ?? null
}

export type ProgressState = 'none' | 'partial' | 'done'

/** "Done" counts grades and Not on Field marks over the listed players (02 §4.6.2). */
export function playProgress(list: readonly RosterPlayer[], entryOf: (playerId: string) => GradeEntry | undefined): { done: number; listed: number; state: ProgressState } {
  let done = 0
  for (const p of list) {
    const e = entryOf(p.id)
    if (e && (e.grade !== null || e.offField)) done++
  }
  const state: ProgressState = !list.length || done === 0 ? 'none' : done >= list.length ? 'done' : 'partial'
  return { done, listed: list.length, state }
}

/** A play is ungraded while some listed player has no grade and isn't Not on Field (02 §13.1). */
export function playIsUngraded(list: readonly RosterPlayer[], entryOf: (playerId: string) => GradeEntry | undefined): boolean {
  return list.some((p) => {
    const e = entryOf(p.id)
    return !e || (e.grade === null && !e.offField)
  })
}

/** A player's tag set: their position group's tags (ST when unknown), in Settings order (v1 `tagsFor`). */
export function tagsFor(tags: readonly TagDef[], player: Pick<RosterPlayer, 'group'> | undefined): TagDef[] {
  return tags.filter((t) => t.group === (player?.group ?? 'ST'))
}

/** "+3 −1": plus and minus counts on a play (zeros aren't counted; the pie shows completeness). */
export function gradeCounts(entries: readonly GradeEntry[]): { plus: number; minus: number; critical: boolean } {
  let plus = 0
  let minus = 0
  let critical = false
  for (const e of entries) {
    if (e.grade === 1) plus++
    if (e.grade === -1) minus++
    if (e.critical && e.grade !== null) critical = true
  }
  return { plus, minus, critical }
}

const ENTRY_FIELDS = ['grade', 'tags', 'note', 'critical', 'offField'] as const

/**
 * Re-applies one change (`from` → `to`) onto an entry as it is now, touching only the fields that change changed.
 * Undo and redo use it so that undoing a grade never reverts a player note or tag edited since (02 §7.7).
 */
export function applyEntryChange(now: GradeEntry, from: GradeEntry, to: GradeEntry): GradeEntry {
  const out: GradeEntry = { ...now }
  for (const k of ENTRY_FIELDS) {
    const changed = k === 'tags' ? from.tags.join('\u0000') !== to.tags.join('\u0000') : from[k] !== to[k]
    if (changed) (out as unknown as Record<string, unknown>)[k] = to[k]
  }
  return out
}

/** Applies a grade key (02 §7.3): sets the grade, Not on Field off. */
export function withGrade(e: GradeEntry, grade: Grade | null): GradeEntry {
  return grade === null ? { ...e, grade: null, critical: false } : { ...e, grade, offField: false }
}

/** Toggles a tag; with no grade yet a positive tag sets +, a negative one − (v1). */
export function withTag(e: GradeEntry, tag: TagDef): GradeEntry {
  const has = e.tags.includes(tag.label)
  const tags = has ? e.tags.filter((t) => t !== tag.label) : [...e.tags, tag.label]
  const grade = e.grade ?? (has ? null : tag.kind === 'pos' ? 1 : tag.kind === 'neg' ? -1 : null)
  return { ...e, tags, grade, offField: grade !== null ? false : e.offField }
}

/** Not on Field on: grade cleared, critical off; off: back to ungraded. */
export function withOffField(e: GradeEntry, on: boolean): GradeEntry {
  return on ? { ...e, offField: true, grade: null, critical: false } : { ...e, offField: false }
}
