import { useState } from 'react'
import { useUi } from '../../../shell/uiState'
import { Button } from '../../../ui/Button'
import { EmptyState } from '../../../ui/EmptyState'
import { Icon } from '../../../ui/Icon'
import { Keycap } from '../../../ui/Keycap'
import { PulldownButton } from '../../../ui/PopupButton'
import { TeamLogo } from '../../../ui/TeamChip'
import type { Room } from '../model'
import { readPref, writePref } from '../prefs'
import { GradingRow } from './GradingRow'

/** The Grade tab (02 §6.3): header, lineup notice, grading rows, footer and empty states. */
export function GradeTab({ room }: { room: Room }) {
  const { current, team, listed, selected } = room
  const ui = useUi()
  const narrow = ui.inspectorWidth < 320
  const noticeKey = `ui.tape.lineupNotice.${room.game.gameId}`
  const [noticeHidden, setNoticeHidden] = useState(() => readPref(noticeKey, false))
  if (!current) return null
  const side = current.special ? 'Special teams' : current.posteam === team ? 'Offense' : 'Defense'
  const sideLower = current.special ? 'special teams' : current.posteam === team ? 'offense' : 'defense'
  const anyLeft = listed.some((p) => {
    const e = room.data.entryOf(current.playId, p.id)
    return !e || (e.grade === null && !e.offField)
  })
  const gradedCount = listed.filter((p) => {
    const e = room.data.entryOf(current.playId, p.id)
    return !!e && (e.grade !== null || e.offField)
  }).length
  const playMarked = room.listed.some((p) => {
    const e = room.data.entryOf(current.playId, p.id)
    return !!e && (e.grade !== null || e.critical || e.offField)
  })
  const addBtn = (anchorTest?: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    void anchorTest
    room.openAddPlayer(e.currentTarget)
  }

  const header = (
    <div className="grade-header" data-test="grade-header">
      <TeamLogo abbr={team} size={18} />
      <span className="grade-header__side">{side}</span>
      <span className="grade-header__count">{listed.length ? `${gradedCount} of ${listed.length} graded` : '0'}</span>
      <span className="grade-header__spacer" />
      <Button
        variant="borderless"
        size="sm"
        icon="star"
        iconOnly
        label="Show Starred Players Only"
        title="Show Starred Players Only"
        pressed={room.starredOnly}
        className="grade-header__starred"
        test="starred-only"
        onClick={() => room.setStarredOnly(!room.starredOnly)}
      />
      <PulldownButton
        label="More"
        icon="ellipsis"
        iconOnly
        size="sm"
        variant="borderless"
        items={() => [
          { label: 'Add Player…', run: () => room.openAddPlayer(null) },
          { label: 'Grade Everyone Left 0', shortcut: '⇧0', disabled: !anyLeft, run: room.fillZeros },
          { label: 'Clear Grades on This Play', disabled: !playMarked, run: room.clearPlay },
          { kind: 'separator' },
          { label: 'Edit Tags…', run: () => void window.shell.openSettings('grading') }
        ]}
      />
    </div>
  )

  const notice = !room.film.hasParticipation && !noticeHidden && (
    <div className="lineup-notice" data-test="lineup-notice">
      <Icon name="info" size={14} className="lineup-notice__icon" />
      <div className="lineup-notice__text">
        Lineups for this game aren’t published yet, so the list shows your starred players and anyone named in the play. Star the players you’re studying to see them on every snap.
        <div>
          <Button variant="borderless" size="sm" label="Add Player…" onClick={addBtn()} />
        </div>
      </div>
      <Button
        variant="borderless"
        size="sm"
        icon="x"
        iconOnly
        label="Dismiss"
        className="lineup-notice__close"
        onClick={() => {
          writePref(noticeKey, true)
          setNoticeHidden(true)
        }}
      />
    </div>
  )

  let body: React.ReactNode
  if (!listed.length && room.starredOnly && room.pinned.length) {
    body = (
      <EmptyState
        icon="star"
        title="No starred players on the field"
        body="Turn off Show Starred Players Only to grade everyone on this snap."
        primary={{ label: 'Show All Players', run: () => room.setStarredOnly(false) }}
      />
    )
  } else if (!listed.length) {
    body = (
      <EmptyState
        icon="users-round"
        title="No players listed for this play"
        body={`Lineups for this game aren’t published yet. Add the players you’re studying and they’ll be listed on every ${team} ${sideLower} snap.`}
        primary={{ label: 'Add Player…', run: () => room.openAddPlayer(null) }}
      />
    )
  } else {
    body = (
      <>
        <div className="grading-list" role="listbox" aria-label="Players">
          {listed.map((p, i) => (
            <GradingRow
              key={p.id}
              room={room}
              player={p}
              index={i}
              selected={selected?.id === p.id}
              entry={room.data.entryOf(current.playId, p.id)}
              narrow={narrow}
            />
          ))}
        </div>
        <div className="grade-footer">
          <Button variant="borderless" size="sm" icon="plus" label="Add Player…" test="add-player" onClick={addBtn()} />
          <span className="grade-footer__spacer" />
          <Button variant="borderless" size="sm" test="fill-zeros" disabled={!anyLeft} onClick={room.fillZeros} title="Grade Everyone Left 0 (⇧0)">
            Grade Everyone Left 0 <Keycap small>⇧0</Keycap>
          </Button>
        </div>
      </>
    )
  }

  return (
    <div className="grade-tab">
      {header}
      {notice}
      {body}
    </div>
  )
}
