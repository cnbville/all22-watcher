import type { RefObject } from 'react'
import type { RosterPlayer } from '@shared/types'
import { Popover } from '../../../ui/Popover'
import { stubPlayer } from '../grading'
import type { Room } from '../model'
import { byGroup, type PickRow, type PickSection, PlayerList } from './PlayerList'

/** The Player Focus picker (02 §9.2). G then ↩ focuses the player selected in the grading list. */
export function FocusPicker({ room, anchor, open, onClose }: { room: Room; anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void }) {
  if (!open) return null
  const { team, plays, players, film } = room
  const lineups = film.hasParticipation
  // Snaps and grades per player of the studied team.
  const snaps = new Map<string, number>()
  const ids = new Set<string>(Object.values(players).filter((p) => p.team === team).map((p) => p.id))
  for (const p of plays) {
    const onField = p.posteam === team ? p.offensePlayers : p.defensePlayers
    for (const id of onField) {
      ids.add(id)
      snaps.set(id, (snaps.get(id) ?? 0) + 1)
    }
    for (const id of p.involved) if (players[id]?.team === team) ids.add(id)
  }
  const graded = new Map<string, number>()
  for (const e of room.data.grades.values()) {
    if (e.team !== team || e.grade === null) continue
    ids.add(e.playerId)
    graded.set(e.playerId, (graded.get(e.playerId) ?? 0) + 1)
  }
  const rowOf = (pl: RosterPlayer): PickRow => {
    const n = snaps.get(pl.id) ?? 0
    const g = graded.get(pl.id) ?? 0
    const trailing = lineups ? (n ? `${n} snaps · ${g} graded` : undefined) : g ? `${g} graded` : undefined
    return { player: pl, trailing, dim: lineups && !n }
  }
  const all = [...ids].map((id) => players[id] ?? stubPlayer(id, team))
  const played = lineups ? all.filter((p) => snaps.get(p.id)) : all
  const didnt = lineups ? all.filter((p) => !snaps.get(p.id)) : []
  const sections: PickSection[] = []
  const sel = room.selected
  if (sel) sections.push({ title: 'Selected', rows: [rowOf(sel)] })
  sections.push(...byGroup(played.map(rowOf)))
  if (didnt.length) sections.push({ title: 'Didn’t play', rows: byGroup(didnt.map(rowOf)).flatMap((s) => s.rows) })

  return (
    <Popover anchor={anchor} open onClose={onClose} width={320} test="focus-picker">
      <div className="picker">
        <div className="picker__title">Player Focus</div>
        <div className="picker__subtitle">Grade one player through every snap they played.</div>
        <PlayerList placeholder={`Search ${team} players`} sections={sections} onChoose={(p) => room.enterFocus(p.id)} />
      </div>
    </Popover>
  )
}
