import type { ReactNode } from 'react'
import { downDistance, gameLabel, shortDesc } from '@shared/labels'
import type { GameInfo, Grade, Play, PlayRef } from '@shared/types'
import { formatEpa } from '../../format'
import { CriticalMark, FlagMark, GradeGlyph } from '../../ui/Grade'
import { Icon } from '../../ui/Icon'

/** One play in a reel list, Notes from the Film, Worth a Second Look or a cut-up preview (03 §2.5). */
export interface PlayRowItem {
  ref: PlayRef
  game: GameInfo
  /** Whose side the caption and EPA use. */
  team: string
  play: Play | null
  /** The graded player's grade, when the list is about one player; undefined hides the leading column's glyph. */
  grade?: Grade | null
  critical?: boolean
  tags?: string[]
  flagged?: boolean
  hasNote?: boolean
  teamEpa?: number | null
}

/** Drag type for plays (01 §1.4.6): JSON `PlayRef[]`. */
export const PLAY_DRAG_TYPE = 'text/x-all22-play'

/** "Wk 1 vs DAL · Q1 06:41 · 3rd & 7" with the clock in the mono face. */
export function PlayCaption({ game, team, play }: { game: GameInfo; team: string; play: Play | null }) {
  if (!play) return <>{gameLabel(game, team)}</>
  const q = play.qtr >= 5 ? 'OT' : `Q${play.qtr}`
  const dd = downDistance(play)
  return (
    <>
      {gameLabel(game, team)} · {q} <span className="t-mono-sm">{play.time}</span>
      {dd ? ` · ${dd}` : ''}
    </>
  )
}

export function PlayRow({
  item,
  selected,
  current,
  onClick,
  onDoubleClick,
  onContextMenu,
  dragPlays,
  test,
  trailing
}: {
  item: PlayRowItem
  selected?: boolean
  current?: boolean
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** Plays to drag (the selection when this row is in it); defaults to this play. */
  dragPlays?: () => PlayRef[]
  test?: string
  /** Extra trailing meta after the EPA (cut-up lists). */
  trailing?: ReactNode
}) {
  const { play } = item
  const tags = item.tags?.filter(Boolean) ?? []
  const hasMeta = item.flagged || item.hasNote || (item.teamEpa !== undefined && item.teamEpa !== null) || !!trailing
  const tall = tags.length > 0 || hasMeta
  return (
    <div
      className={`play-row${tall ? ' play-row--tall' : ''}`}
      role="option"
      aria-selected={selected || undefined}
      aria-current={current || undefined}
      data-test={test}
      data-play={`${item.ref.gameId}:${item.ref.playId}`}
      draggable
      onDragStart={(e) => {
        const refs = dragPlays?.() ?? [item.ref]
        e.dataTransfer.setData(PLAY_DRAG_TYPE, JSON.stringify(refs))
        e.dataTransfer.setData('text/plain', play ? shortDesc(play.desc) : `Play ${item.ref.playId}`)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onMouseDown={(e) => e.button === 0 && e.preventDefault()}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="play-row__lead">
        {item.grade !== undefined && <GradeGlyph grade={item.grade} />}
        {item.critical && item.grade !== undefined && (
          <span className="play-row__crit">
            <CriticalMark grade={item.grade} />
          </span>
        )}
      </div>
      <div className="play-row__text">
        <div className="play-row__line1">
          <span className="play-row__caption ellipsis">
            <PlayCaption game={item.game} team={item.team} play={play} />
          </span>
          {hasMeta && (
            <span className="play-row__meta">
              {item.flagged && <FlagMark />}
              {item.hasNote && <Icon name="message-square-text" size={12} className="play-row__note" />}
              {item.teamEpa !== undefined && item.teamEpa !== null && <span className="play-row__epa num">{formatEpa(item.teamEpa)}</span>}
              {trailing}
            </span>
          )}
        </div>
        <div className="play-row__desc ellipsis">{play ? shortDesc(play.desc) : `Play ${item.ref.playId}`}</div>
        {tags.length > 0 && <div className="play-row__tags ellipsis">{tags.join(' · ')}</div>}
      </div>
    </div>
  )
}
