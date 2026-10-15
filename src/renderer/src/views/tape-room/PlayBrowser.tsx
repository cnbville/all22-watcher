import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Clip, Play } from '@shared/types'
import { quarterLabel, resultLabel, shortDesc } from '../../format'
import { setUi, ui } from '../../shell/uiState'
import { Avatar } from '../../ui/Avatar'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { gradeGlyphScore, ink } from '../../ui/heat'
import { Icon } from '../../ui/Icon'
import { noMouseFocus } from '../../ui/keyboard'
import { PopupButton } from '../../ui/PopupButton'
import { ProgressBar } from '../../ui/Progress'
import { Poster } from '../shared/Poster'
import { FilterPopover } from './FilterPopover'
import { setTokenValues, type TapeKey, tokenValues } from './filters'
import { GradeMark } from './Inspector/GradeSegments'
import { situationText } from './Inspector/PlaySummary'
import type { GroupBy, Room } from './model'
import { readPref, writePref } from './prefs'

/**
 * The play browser (02 §4): header, grouped and windowed rows with progress pies and markers, multi-selection,
 * dragging plays to cut-ups, empty states, the resize handle and the narrow-window overlay. In Player Focus the
 * header becomes the focus header (§9.4) and the rows show the focus player's grade.
 */

const ROW_H = 56
const HEAD_H = 34
const LIST_MIN = 240
const LIST_MAX = 420
const LIST_DEFAULT = 300
const VIEWER_MIN = 480

interface Group {
  key: string
  label: string
  plays: Play[]
}

type Item = { kind: 'header'; group: Group; top: number } | { kind: 'row'; play: Play; group: Group; top: number }

const QUARTER_NAMES = ['1st quarter', '2nd quarter', '3rd quarter', '4th quarter']

/** Quick filters shown as pills under the header; each toggles one value of a filter key (the popover has the rest). */
const QUICK: { key: TapeKey; value: string; label: string }[] = [
  { key: 'status', value: 'ungraded', label: 'Ungraded' },
  { key: 'down', value: '3', label: '3rd down' },
  { key: 'situation', value: 'redZone', label: 'Red zone' }
]

/** The angle a play's thumbnail is taken from, in order of preference (matches the library's posters). */
const POSTER_ANGLES: Clip['angle'][] = ['sideline', 'main', 'endzone']
function posterOf(clips: Clip[] | undefined): { clipId: number; at: number } | null {
  if (!clips?.length) return null
  const clip = POSTER_ANGLES.map((a) => clips.find((c) => c.angle === a)).find(Boolean) ?? clips[0]
  return { clipId: clip.id, at: (clip.snapMs ?? 0) / 1000 }
}

function groupPlays(plays: Play[], by: GroupBy): Group[] {
  if (by === 'none') return [{ key: 'all', label: '', plays }]
  const groups: Group[] = []
  const byKey = new Map<string, Group>()
  const other: Group = { key: 'other', label: 'Other plays', plays: [] }
  for (const p of plays) {
    let key: string
    let label: string
    if (by === 'quarter') {
      key = `q${Math.min(p.qtr, 5)}`
      label = p.qtr >= 5 ? 'Overtime' : QUARTER_NAMES[p.qtr - 1]
    } else {
      if (p.drive === null) {
        other.plays.push(p)
        continue
      }
      key = `d${p.drive}`
      label = [`Drive ${p.drive}`, p.posteam, p.driveResult].filter(Boolean).join(' · ')
    }
    let g = byKey.get(key)
    if (!g) {
      g = { key, label, plays: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.plays.push(p)
  }
  if (other.plays.length) groups.push(other)
  return groups
}

export function PlayBrowser({
  room,
  visible,
  overlay,
  width,
  onWidth,
  onHide
}: {
  room: Room
  visible: boolean
  overlay: boolean
  width: number
  onWidth: (w: number) => void
  onHide: () => void
}) {
  const { focus, game, team } = room
  const groups = useMemo(() => groupPlays(room.visible, room.group), [room.visible, room.group])

  // Collapsed groups, per game, for this launch.
  const collapsedKey = `ui.tape.collapsed.${game.gameId}`
  const [collapsed, setCollapsedState] = useState<string[]>(() => readPref(collapsedKey, [], 'session'))
  const setCollapsed = (next: string[]) => {
    setCollapsedState(next)
    writePref(collapsedKey, next, 'session')
  }
  // Reaching a play in a collapsed group expands it.
  const currentGroup = groups.find((g) => g.plays.some((p) => p.playId === room.current?.playId))?.key
  useEffect(() => {
    if (currentGroup && collapsed.includes(currentGroup)) setCollapsed(collapsed.filter((k) => k !== currentGroup))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGroup])

  const { items, height } = useMemo(() => {
    const out: Item[] = []
    let y = 0
    for (const g of groups) {
      if (room.group !== 'none') {
        out.push({ kind: 'header', group: g, top: y })
        y += HEAD_H
      }
      if (collapsed.includes(g.key)) continue
      for (const p of g.plays) {
        out.push({ kind: 'row', play: p, group: g, top: y })
        y += ROW_H
      }
    }
    return { items: out, height: y }
  }, [groups, collapsed, room.group])

  // Windowing.
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 600, offset: 0 })
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight, offset: el.offsetTop })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [visible])

  // The current row scrolls into view (block: nearest), never animated.
  useLayoutEffect(() => {
    const el = scroller.current
    const it = items.find((i) => i.kind === 'row' && i.play.playId === room.current?.playId)
    if (!el || !it) return
    const headerPad = room.group === 'none' ? 0 : HEAD_H
    if (it.top - headerPad < el.scrollTop) el.scrollTop = Math.max(0, it.top - headerPad)
    else if (it.top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = it.top + ROW_H - el.clientHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.current?.playId, visible, items.length])

  const over = 6 * ROW_H
  const shown = items.filter((i) => i.top + ROW_H >= view.top - over && i.top <= view.top + view.height + over)

  // The sticky header: the group the top row belongs to, pushed up by the next header.
  let sticky: { group: Group; offset: number } | null = null
  if (room.group !== 'none') {
    const headers = items.filter((i): i is Extract<Item, { kind: 'header' }> => i.kind === 'header')
    let idx = -1
    for (let i = 0; i < headers.length; i++) if (headers[i].top <= view.top) idx = i
    if (idx >= 0 && view.top > 0) {
      const next = headers[idx + 1]
      const offset = next ? Math.min(0, next.top - view.top - HEAD_H) : 0
      sticky = { group: headers[idx].group, offset }
    }
  }

  // Multi-selection and clicks (02 §4.7).
  const order = room.visible
  const onRowClick = (e: React.MouseEvent, p: Play) => {
    if (e.metaKey) {
      const next = new Set(room.multi)
      if (next.has(p.playId)) next.delete(p.playId)
      else next.add(p.playId)
      room.setMulti(next)
      return
    }
    if (e.shiftKey && room.current) {
      const a = order.findIndex((x) => x.playId === room.current!.playId)
      const b = order.findIndex((x) => x.playId === p.playId)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        room.setMulti(new Set(order.slice(lo, hi + 1).map((x) => x.playId)))
        return
      }
    }
    room.goTo(p.playId, { mouse: true })
  }

  // Dragging plays to a cut-up; holding near the leading edge springs the sidebar open (02 §4.7).
  const spring = useRef<{ timer: ReturnType<typeof setTimeout> | null; opened: boolean }>({ timer: null, opened: false })
  const [dragging, setDragging] = useState<Set<number> | null>(null)
  useEffect(() => {
    if (!dragging) return
    const onOver = (e: DragEvent) => {
      const near = e.clientX <= 24
      const s = spring.current
      if (near && !s.timer && !s.opened && ui().tapeRoomSidebar === 'hidden') {
        s.timer = setTimeout(() => {
          s.timer = null
          s.opened = true
          setUi({ tapeRoomSidebar: 'shown' })
        }, 600)
      } else if (!near && s.timer) {
        clearTimeout(s.timer)
        s.timer = null
      }
    }
    document.addEventListener('dragover', onOver)
    return () => document.removeEventListener('dragover', onOver)
  }, [dragging])
  const endDrag = () => {
    const s = spring.current
    if (s.timer) clearTimeout(s.timer)
    s.timer = null
    if (s.opened) setUi({ tapeRoomSidebar: 'hidden' })
    s.opened = false
    setDragging(null)
  }
  const onDragStart = (e: React.DragEvent, p: Play) => {
    const ids = room.multi.has(p.playId) || (room.multi.size && p.playId === room.current?.playId) ? new Set([...room.multi, ...(room.current ? [room.current.playId] : [])]) : new Set([p.playId])
    const plays = room.plays.filter((x) => ids.has(x.playId)).map((x) => ({ gameId: game.gameId, playId: x.playId }))
    e.dataTransfer.setData('text/x-all22-play', JSON.stringify(plays))
    e.dataTransfer.setData('text/plain', room.plays.filter((x) => ids.has(x.playId)).map((x) => x.desc).join('\n'))
    e.dataTransfer.effectAllowed = 'copy'
    setDragging(ids)
  }

  // Resize handle (02 §2.2).
  const drag = useRef<{ x: number; w: number } | null>(null)
  const self = useRef<HTMLDivElement>(null)
  const maxWidth = () => {
    const parent = self.current?.parentElement
    return parent ? Math.max(LIST_MIN, Math.min(LIST_MAX, parent.clientWidth - VIEWER_MIN)) : LIST_MAX
  }

  const filtered = room.tokens.length > 0 || room.text.trim().length > 0
  const total = room.baseList.length
  const countText = filtered ? `${room.visible.length} of ${total} plays` : `${total} plays`
  const filterBtn = useRef<HTMLButtonElement>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const anyPopoverFilter = room.tokens.length > 0

  const groupOptions = [
    { value: 'quarter' as GroupBy, label: 'Quarter' },
    { value: 'drive' as GroupBy, label: room.drivesAvailable ? 'Drive' : 'Drive — update season data', disabled: !room.drivesAvailable },
    { value: 'none' as GroupBy, label: 'None' }
  ]
  const tokens = room.tokens
  const quick = (
    <div className="play-browser__pills" role="group" aria-label="Quick filters" data-test="quick-filters">
      <button
        type="button"
        className="play-pill"
        aria-pressed={tokens.length === 0}
        onMouseDown={noMouseFocus}
        onClick={() => room.setTokens([])}
      >
        All
      </button>
      {QUICK.map((q) => {
        const values = tokenValues(tokens, q.key)
        const on = values.includes(q.value)
        return (
          <button
            key={q.key + q.value}
            type="button"
            className="play-pill"
            aria-pressed={on}
            data-test={`quick-filter-${q.value}`}
            onMouseDown={noMouseFocus}
            onClick={() => room.setTokens(setTokenValues(tokens, q.key, on ? values.filter((v) => v !== q.value) : [...values, q.value]))}
          >
            {q.label}
          </button>
        )
      })}
    </div>
  )
  const controls = (
    <div className="play-browser__controls">
      <span data-test="group-popup">
        <PopupButton size="sm" variant="inline" value={room.group} options={groupOptions} label={groupOptions.find((o) => o.value === room.group)?.label.split(' —')[0]} onChange={(g) => room.setGroup(g)} />
      </span>
      <Button
        ref={filterBtn}
        variant="borderless"
        size="sm"
        icon="funnel"
        iconOnly
        label="Filter Plays"
        title="Filter Plays"
        pressed={anyPopoverFilter}
        className="play-browser__filter"
        test="filter-button"
        onClick={() => setFilterOpen((o) => !o)}
      />
    </div>
  )

  const focusProgress = focus ? focus.progress : null
  const header = focus ? (
    <div className="play-browser__header play-browser__focus-header" data-test="focus-header">
      <div className="play-browser__focus-top">
        <Avatar url={focus.player.headshot} name={focus.player.name} size={24} />
        <div className="play-browser__focus-who">
          <span className="play-browser__focus-name">{focus.player.name}</span>
          <span className="play-browser__focus-count">
            {focusProgress!.graded} of {focusProgress!.total} graded
          </span>
        </div>
        <Button variant="borderless" size="sm" icon="x" iconOnly label="Exit Player Focus" title="Exit Player Focus (⇧G)" test="focus-exit" onClick={room.exitFocus} />
      </div>
      <ProgressBar mini value={focusProgress!.total ? focusProgress!.graded / focusProgress!.total : 0} label="Graded snaps" />
      <div className="play-browser__title-row">
        <span className="play-browser__count">{filtered ? `${room.visible.length} of ${total} snaps` : `${total} snaps`}</span>
        {controls}
      </div>
      {quick}
    </div>
  ) : (
    <div className="play-browser__header">
      <div className="play-browser__title-row">
        <span className="play-browser__title">Plays</span>
        <span className="play-browser__count">{countText}</span>
        {controls}
      </div>
      {quick}
    </div>
  )

  const focusSide = focus ? (focus.player.group === 'ST' ? 'special teams' : ['QB', 'RB', 'WR', 'TE', 'OL'].includes(focus.player.group) ? 'offense' : 'defense') : ''
  const fallback = focus && !room.film.hasParticipation && focus.snaps.length > 0 && (
    <div className="lineup-notice lineup-notice--list" data-test="focus-fallback-notice">
      <Icon name="info" size={14} className="lineup-notice__icon" />
      <span className="lineup-notice__text">
        Lineups aren’t published for this game, so every {team} {focusSide} snap is listed. Press X on the snaps {focus.player.name} wasn’t on the field for.
      </span>
    </div>
  )

  let empty: React.ReactNode = null
  if (focus && !focus.snaps.length) {
    empty = (
      <EmptyState
        icon="scan-eye"
        title={`${focus.player.name} didn’t play in this game`}
        body={`The lineups don’t list ${focus.player.name} on any ${team} snap.`}
        primary={{ label: 'Exit Player Focus', run: room.exitFocus }}
      />
    )
  } else if (!room.visible.length && room.tokens.length) {
    empty = (
      <EmptyState
        icon="funnel"
        title="No plays match these filters"
        primary={{
          label: 'Clear Filters',
          run: () => {
            room.setTokens([])
            room.setText('')
          }
        }}
      />
    )
  } else if (!room.visible.length && room.text.trim()) {
    empty = <EmptyState icon="search" title={`No Results for “${room.text.trim()}”`} body="Try a last name, or a word from the play like “sack” or “deep”." />
  }

  const groupCount = (g: Group) => {
    const graded = focus
      ? g.plays.filter((p) => room.data.entryOf(p.playId, focus.player.id)?.grade != null).length
      : g.plays.filter((p) => room.playGradeCounts(p).graded > 0).length
    return `${graded} of ${g.plays.length} graded`
  }
  const toggleGroup = (e: React.MouseEvent, g: Group) => {
    const isCollapsed = collapsed.includes(g.key)
    if (e.altKey) setCollapsed(isCollapsed ? [] : groups.map((x) => x.key))
    else setCollapsed(isCollapsed ? collapsed.filter((k) => k !== g.key) : [...collapsed, g.key])
  }
  const headerEl = (g: Group, style: CSSProperties, sticky = false) => (
    <div
      key={(sticky ? 'sticky-' : '') + g.key}
      className={`play-group${sticky ? ' play-group--sticky' : ''}`}
      style={style}
      data-collapsed={collapsed.includes(g.key) || undefined}
      onMouseDown={noMouseFocus}
      onClick={(e) => toggleGroup(e, g)}
    >
      <span className="play-group__label">{g.label}</span>
      <span className="play-group__count">{groupCount(g)}</span>
      <Icon name="chevron-down" size={12} className="play-group__chevron" />
    </div>
  )

  return (
    <div
      ref={self}
      className="play-browser"
      data-overlay={overlay || undefined}
      data-shown={visible ? 'true' : 'false'}
      style={{ '--list-w': `${width}px` } as CSSProperties}
      aria-hidden={!visible || undefined}
    >
      <div className="play-browser__inner">
        {header}
        {fallback}
        <div ref={scroller} className="play-browser__scroll" data-test="play-list" role="listbox" aria-label="Plays" aria-multiselectable>
          {empty ?? (
            <div className="play-browser__canvas" style={{ height }}>
              {shown.map((it) =>
                it.kind === 'header' ? (
                  headerEl(it.group, { top: it.top })
                ) : (
                  <PlayRow
                    key={it.play.playId}
                    room={room}
                    play={it.play}
                    top={it.top}
                    current={it.play.playId === room.current?.playId}
                    multi={room.multi.has(it.play.playId)}
                    dragSource={!!dragging?.has(it.play.playId)}
                    onClick={onRowClick}
                    onDragStart={onDragStart}
                    onDragEnd={endDrag}
                  />
                )
              )}
            </div>
          )}
        </div>
        {sticky && !empty && headerEl(sticky.group, { top: view.offset + sticky.offset }, true)}
      </div>
      {filterOpen && <FilterPopover room={room} anchor={filterBtn} onClose={() => (setFilterOpen(false), room.refocus())} />}
      {!overlay && visible && (
        <div
          className="pane-resize pane-resize--trailing"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, w: width }
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            const raw = drag.current.w + (e.clientX - drag.current.x)
            if (raw < 200) return
            onWidth(Math.round(Math.max(LIST_MIN, Math.min(maxWidth(), raw))))
          }}
          onPointerUp={(e) => {
            if (drag.current && drag.current.w + (e.clientX - drag.current.x) < 200) {
              onWidth(drag.current.w)
              onHide()
            }
            drag.current = null
          }}
          onDoubleClick={() => onWidth(LIST_DEFAULT)}
        />
      )}
    </div>
  )
}

function PlayRow({
  room,
  play,
  top,
  current,
  multi,
  dragSource,
  onClick,
  onDragStart,
  onDragEnd
}: {
  room: Room
  play: Play
  top: number
  current: boolean
  multi: boolean
  dragSource: boolean
  onClick: (e: React.MouseEvent, p: Play) => void
  onDragStart: (e: React.DragEvent, p: Play) => void
  onDragEnd: () => void
}) {
  const { focus, data } = room
  const note = data.notes.get(play.playId)
  const clips = room.clipsByPlay.get(play.playId)
  const hasClip = (clips?.length ?? 0) > 0
  const counts = room.playGradeCounts(play)
  const focusEntry = focus ? data.entryOf(play.playId, focus.player.id) : undefined

  // Markers, in order; at most three.
  const entries = room.listedFor(play)
  const anyPlayerNote = entries.some((p) => !!data.entryOf(play.playId, p.id)?.note.trim())
  const markers: { icon: 'flag' | 'zap' | 'message-square-text' | 'pen-line' | 'triangle-alert'; cls: string; title: string }[] = []
  if (note?.flagged) markers.push({ icon: 'flag', cls: 'flag', title: 'Flagged' })
  if (focus ? focusEntry?.critical : counts.critical) markers.push({ icon: 'zap', cls: 'critical', title: 'Critical' })
  if (note?.note.trim() || anyPlayerNote) markers.push({ icon: 'message-square-text', cls: 'note', title: 'Notes' })
  if (note && Object.values(note.drawing).some((s) => s && s.length)) markers.push({ icon: 'pen-line', cls: 'drawing', title: 'Drawings' })
  const alignment = room.alignment.get(play.playId)
  if (alignment) markers.push({ icon: 'triangle-alert', cls: 'warning', title: alignment })

  // The grade mark: the focus player's grade, or the play's net grade (filled when every listed player is done).
  let mark: React.ReactNode
  if (focus) {
    if (focusEntry?.offField) mark = <GradeMark color={null} title="Not on field" test="focus-grade" state="off" />
    else if (focusEntry?.grade != null) mark = <GradeMark color={ink(gradeGlyphScore(focusEntry.grade))} title={focusEntry.grade > 0 ? 'Plus' : focusEntry.grade < 0 ? 'Minus' : 'Even'} test="focus-grade" state="graded" />
    else mark = <GradeMark color={null} title="Ungraded" test="focus-grade" state="none" />
  } else {
    const pr = room.progressOf(play)
    const zero = Math.max(0, counts.graded - counts.plus - counts.minus)
    const net = counts.plus - counts.minus
    const color = counts.graded > 0 ? ink(gradeGlyphScore(net > 0 ? 1 : net < 0 ? -1 : 0)) : null
    const tally = counts.graded > 0 ? ` · +${counts.plus} 0×${zero} −${counts.minus}` : ''
    mark = <GradeMark color={color} hollow={pr.state !== 'done'} title={`${pr.done} of ${pr.listed} graded${tally}`} test="play-progress" state={pr.state} />
  }

  const result = resultLabel(play).replace(/^-/, '−')
  const dimmed = focus && focusEntry?.offField
  return (
    <div
      className="tape-row"
      role="option"
      style={{ top }}
      data-test="play-row"
      data-play-id={play.playId}
      data-current={current ? 'true' : undefined}
      aria-current={current ? 'true' : undefined}
      aria-selected={current || multi}
      data-multi={multi && !current ? true : undefined}
      data-no-clip={!hasClip || undefined}
      data-dragging={dragSource || undefined}
      data-off={dimmed || undefined}
      draggable
      onMouseDown={noMouseFocus}
      onClick={(e) => onClick(e, play)}
      onDoubleClick={(e) => !e.metaKey && !e.shiftKey && room.goTo(play.playId, { mouse: true })}
      onContextMenu={(e) => {
        e.preventDefault()
        room.playMenu(e, play)
      }}
      onDragStart={(e) => onDragStart(e, play)}
      onDragEnd={onDragEnd}
      title={play.desc}
    >
      {hasClip ? (
        <Poster poster={posterOf(clips)} width={128} className="tape-row__thumb" />
      ) : (
        <span className="tape-row__thumb tape-row__thumb--none" title="No clip for this play">
          <Icon name="video-off" size={12} />
        </span>
      )}
      <span className="tape-row__text">
        <span className="tape-row__line1">
          <span className="tape-row__situation">{situationText(play)}</span>
          <span className="tape-row__spacer" />
          {markers.length > 0 && (
            <span className="tape-row__markers">
              {markers.slice(0, 3).map((m) => (
                <span key={m.icon} className={`tape-row__marker tape-row__marker--${m.cls}`} title={m.title}>
                  <Icon name={m.icon} size={11} filled={m.icon === 'flag'} />
                </span>
              ))}
            </span>
          )}
          {result && <span className="tape-row__result">{result}</span>}
        </span>
        <span className="tape-row__line2">
          <span className="tape-row__clock">{room.group === 'quarter' ? play.time : `${quarterLabel(play.qtr)} ${play.time}`}</span>
          <span className="tape-row__desc">{shortDesc(play.desc)}</span>
        </span>
      </span>
      <span className="tape-row__lead">{mark}</span>
    </div>
  )
}
