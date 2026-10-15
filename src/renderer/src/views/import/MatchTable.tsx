import { useMemo } from 'react'
import type { AlignmentSuspect, Play } from '@shared/types'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { type MenuItemSpec, openMenu } from '../../ui/Menu'
import { type Column, Table } from '../../ui/Table'
import { downDistance } from '../../format'
import { ANGLE_LABEL, clipName, clockLabel, lengthLabel, playLine, type SheetRow, type SuspectFix, suspectFix } from './importModel'

/**
 * The match table (`data-test="match-table"`): every clip with its length, the play it is matched to, and the
 * alignment check's verdict inline. ↑/↓ select, ⇧↑/⇧↓ slide the selected clip and every later clip of its angle by
 * one play, ↩ opens the play menu, ⌫ unlinks.
 */

const REASON_SHORT: Record<AlignmentSuspect['reason'], string> = {
  tooShort: 'Too short',
  tooLong: 'Too long',
  angleMismatch: 'Angles disagree',
  shifted: 'Off by one'
}

export interface MatchTableRow {
  row: SheetRow
  /** Index in the sheet's master row list (what shiftMatches works on). */
  index: number
  /** Position within its angle, 1-based. */
  n: number
  duration: number | null | undefined
  suspect: AlignmentSuspect | undefined
}

export function MatchTable({
  items,
  plays,
  ordered,
  showAngle,
  showCheck,
  selection,
  onSelect,
  onShift,
  onLink,
  disabled
}: {
  items: MatchTableRow[]
  /** Every play of the game, in game order (for the play menu). */
  plays: Play[]
  /** Plays clips are matched against, in order (for neighbours and fixes). */
  ordered: Play[]
  showAngle: boolean
  /** The Alignment column, shown while the check flags something. */
  showCheck: boolean
  selection: string | null
  onSelect: (path: string) => void
  onShift: (index: number, delta: 1 | -1) => void
  onLink: (index: number, playId: number | null) => void
  disabled?: boolean
}) {
  const playById = useMemo(() => new Map(plays.map((p) => [p.playId, p])), [plays])

  const openPlayMenu = (item: MatchTableRow, anchor: Element) => {
    if (disabled) return
    openMenu({ anchor, items: playMenu(item, plays, ordered, (id) => onLink(item.index, id)), placement: 'below', width: 520 })
  }

  const applyFix = (item: MatchTableRow, fix: SuspectFix) => {
    if (!fix) return
    if (fix.kind === 'shift') onShift(item.index, fix.delta)
    else onLink(item.index, fix.playId)
  }

  const columns: Column<MatchTableRow>[] = [
    { id: 'n', label: '#', width: 44, numeric: true, render: (it) => <span className="c-label-3">{it.n}</span> },
    {
      id: 'clip',
      label: 'Clip',
      width: 176,
      render: (it) => (
        <span className="match-clip" title={it.row.path}>
          {clipName(it.row)}
        </span>
      )
    },
    ...(showAngle ? [{ id: 'angle', label: 'Angle', width: 84, render: (it: MatchTableRow) => <span className="c-label-2">{ANGLE_LABEL[it.row.angle]}</span> }] : []),
    {
      id: 'length',
      label: 'Length',
      width: 64,
      numeric: true,
      title: 'Clip length',
      render: (it) =>
        it.duration === undefined ? (
          <span className="c-label-4">—</span>
        ) : it.duration === null ? (
          <span className="c-label-4" title="This clip’s length couldn’t be read">
            ?
          </span>
        ) : (
          <span className={it.suspect ? 'c-warning' : undefined} title={it.suspect ? `This play usually runs about ${lengthLabel(it.suspect.expected)}.` : undefined}>
            {lengthLabel(it.duration)}
          </span>
        )
    },
    {
      id: 'play',
      label: 'Play',
      flex: 1,
      minWidth: 260,
      render: (it) => {
        const p = it.row.playId !== null ? playById.get(it.row.playId) : undefined
        return (
          <button
            type="button"
            className="match-play"
            disabled={disabled}
            aria-haspopup="menu"
            title={p ? p.desc : 'Choose the play this clip shows'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              onSelect(it.row.path)
              openPlayMenu(it, e.currentTarget)
            }}
          >
            {p ? (
              <>
                <span className="match-play__clock">{clockLabel(p)}</span>
                <span className="match-play__down">{downDistance(p)}</span>
                <span className="match-play__desc">{playLine(p)}</span>
              </>
            ) : (
              <span className="match-play__none">Not linked to a play</span>
            )}
            <Icon name="chevrons-up-down" size={12} className="match-play__chevrons" />
          </button>
        )
      }
    },
    ...(!showCheck ? [] : [{
      id: 'check',
      label: 'Alignment',
      width: 196,
      render: (it) => {
        if (!it.suspect) return null
        const fix = suspectFix(it.suspect, ordered)
        const better = it.suspect.betterPlayId !== null ? playById.get(it.suspect.betterPlayId) : undefined
        return (
          <span className="match-check" data-test="alignment-suspect">
            <Icon name="triangle-alert" size={12} className="c-warning" />
            <span className="match-check__text" title={`${it.suspect.message}${better ? ` It fits ${clockLabel(better)} better.` : ''}`}>
              {REASON_SHORT[it.suspect.reason]}
            </span>
            {fix && (
              <Button
                size="sm"
                variant="borderless"
                className="match-check__fix"
                label={fix.label}
                title={fix.kind === 'shift' ? 'Slide this clip and every later clip of this angle one play' : better ? `Link this clip to ${clockLabel(better)}: ${playLine(better)}` : undefined}
                disabled={disabled}
                onClick={() => applyFix(it, fix)}
              />
            )}
          </span>
        )
      }
    } satisfies Column<MatchTableRow>]),
    {
      id: 'shift',
      label: '',
      width: 60,
      render: (it) => (
        <span className="match-shift">
          <Button
            variant="borderless"
            size="sm"
            iconOnly
            icon="chevron-up"
            label="Slide Earlier"
            title="Slide this and later clips one play earlier (⇧↑)"
            disabled={disabled}
            onClick={() => onShift(it.index, -1)}
          />
          <Button
            variant="borderless"
            size="sm"
            iconOnly
            icon="chevron-down"
            label="Slide Later"
            title="Slide this and later clips one play later (⇧↓)"
            disabled={disabled}
            onClick={() => onShift(it.index, 1)}
          />
        </span>
      )
    }
  ]

  const selected = items.find((it) => it.row.path === selection)

  return (
    <div
      className="match-table-scroll"
      onKeyDownCapture={(e) => {
        if (!selected || disabled) return
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          e.stopPropagation()
          onShift(selected.index, e.key === 'ArrowUp' ? -1 : 1)
        } else if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey) {
          e.preventDefault()
          e.stopPropagation()
          onLink(selected.index, null)
        }
      }}
    >
      <Table
        columns={columns}
        rows={items}
        rowKey={(it) => it.row.path}
        selection={selection}
        onSelect={(key) => onSelect(key)}
        onOpen={(it) => {
          const el = document.querySelector(`[data-row-key="${CSS.escape(it.row.path)}"] .match-play`)
          if (el) openPlayMenu(it, el)
        }}
        stickyTop={0}
        test="match-table"
        rowTest="match-row"
        typeSelect={(it) => it.row.fileName}
        className="match-table"
      />
    </div>
  )
}

const menuLabel = (p: Play) => {
  const text = `${clockLabel(p)}  ${downDistance(p)}${downDistance(p) ? ' · ' : ''}${playLine(p)}`
  return text.length > 84 ? `${text.slice(0, 83)}…` : text
}

/** Nearby plays first (where this clip most likely belongs), then every play by quarter, then "Not a Play". */
function playMenu(item: MatchTableRow, plays: Play[], ordered: Play[], pick: (playId: number | null) => void): MenuItemSpec[] {
  const current = item.row.playId
  const anchor = current ?? item.suspect?.betterPlayId ?? null
  const idx = anchor !== null ? ordered.findIndex((p) => p.playId === anchor) : -1
  const near = idx >= 0 ? ordered.slice(Math.max(0, idx - 4), idx + 5) : ordered.slice(Math.max(0, item.n - 5), item.n + 4)
  const quarters = [...new Set(plays.map((p) => p.qtr))].sort((a, b) => a - b)
  const qName = (q: number) => (q >= 5 ? 'Overtime' : `${['1st', '2nd', '3rd', '4th'][q - 1]} Quarter`)
  return [
    { kind: 'header', label: 'Nearby Plays' },
    ...near.map((p): MenuItemSpec => ({ label: menuLabel(p), checked: p.playId === current, run: () => pick(p.playId) })),
    { kind: 'separator' },
    ...quarters.map(
      (q): MenuItemSpec => ({
        kind: 'submenu',
        label: qName(q),
        items: plays.filter((p) => p.qtr === q).map((p): MenuItemSpec => ({ label: menuLabel(p), checked: p.playId === current, run: () => pick(p.playId) }))
      })
    ),
    { kind: 'separator' },
    { label: 'Not a Play (Skip This Clip)', checked: current === null, run: () => pick(null) }
  ]
}
