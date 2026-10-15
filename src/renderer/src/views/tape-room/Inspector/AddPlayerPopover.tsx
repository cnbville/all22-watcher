import type { RefObject } from 'react'
import { Popover } from '../../../ui/Popover'
import type { Room } from '../model'
import { byGroup, PlayerList } from './PlayerList'

/** Add Player (02 §6.4): stars a player of the studied team for grading. */
export function AddPlayerPopover({ room, anchor, open, onClose }: { room: Room; anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void }) {
  if (!open) return null
  const { team } = room
  const roster = Object.values(room.players).filter((p) => p.team === team)
  const sections = byGroup(roster.map((p) => ({ player: p, disabled: room.pinned.includes(p.id), checked: room.pinned.includes(p.id) })))
  return (
    <Popover anchor={anchor} open onClose={onClose} width={300} test="add-player-popover">
      <div className="picker">
        <div className="picker__title">Add Player</div>
        <PlayerList
          placeholder={`Search ${team} roster`}
          sections={sections}
          onChoose={(p) => {
            if (!room.pinned.includes(p.id)) room.toggleStar(p.id)
            onClose()
            if (room.listed.some((x) => x.id === p.id)) room.select(p.id)
          }}
        />
        <div className="picker__footnote">
          Starred players are listed on every snap when lineups aren’t published. When they are, Show Starred Players Only narrows the list to them.
        </div>
      </div>
    </Popover>
  )
}
