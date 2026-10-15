import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PositionGroup, RosterPlayer } from '@shared/types'
import { Icon } from '../../../ui/Icon'
import { noMouseFocus } from '../../../ui/keyboard'
import { byPosition } from '../grading'

/**
 * The searchable, sectioned player list in the Add Player popover (02 §6.4) and the Focus picker (§9.2): a search
 * field, section headers, 28px rows, ↑/↓ and ↩.
 */

export const GROUP_TITLE: Record<PositionGroup, string> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
  OL: 'Offensive line',
  DL: 'Defensive line',
  LB: 'Linebackers',
  DB: 'Defensive backs',
  ST: 'Special teams'
}

export interface PickRow {
  player: RosterPlayer
  trailing?: string
  disabled?: boolean
  checked?: boolean
  dim?: boolean
}
export interface PickSection {
  title: string
  rows: PickRow[]
}

/** Groups players by position (in position order) into sections. */
export function byGroup(rows: PickRow[]): PickSection[] {
  const order: PositionGroup[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'ST']
  const sorted = [...rows].sort((a, b) => byPosition(a.player, b.player))
  return order.map((g) => ({ title: GROUP_TITLE[g], rows: sorted.filter((r) => r.player.group === g) })).filter((s) => s.rows.length)
}

const matches = (p: RosterPlayer, q: string) => {
  if (!q) return true
  const s = q.toLowerCase()
  return p.name.toLowerCase().includes(s) || p.jersey === s || (p.depthPos || p.position).toLowerCase() === s
}

export function PlayerList({
  placeholder,
  sections,
  onChoose,
  test
}: {
  placeholder: string
  sections: PickSection[]
  onChoose: (p: RosterPlayer) => void
  test?: string
}) {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const shown = sections.map((s) => ({ ...s, rows: s.rows.filter((r) => matches(r.player, q.trim())) })).filter((s) => s.rows.length)
  const flat = shown.flatMap((s) => s.rows.map((r, i) => ({ r, key: `${s.title}:${r.player.id}:${i}` })))
  const enabled = flat.filter((x) => !x.r.disabled)
  const [hi, setHi] = useState<string | null>(null)
  const current = enabled.find((x) => x.key === hi) ?? enabled[0]
  useEffect(() => setHi(null), [q])
  // After the popover has placed itself and moved focus in.
  useEffect(() => {
    input.current?.focus()
    const id = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  useLayoutEffect(() => {
    list.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current?.key])

  return (
    <div className="player-list" data-test={test}>
      <div className="player-list__search">
        <Icon name="search" size={12} className="player-list__search-icon" />
        <input
          ref={input}
          className="text-field text-field--md player-list__input"
          placeholder={placeholder}
          aria-label={placeholder}
          spellCheck={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              e.stopPropagation()
              const i = enabled.findIndex((x) => x.key === current?.key)
              const next = enabled[Math.max(0, Math.min(enabled.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
              if (next) setHi(next.key)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              if (current) onChoose(current.r.player)
            }
          }}
        />
      </div>
      <div ref={list} className="player-list__rows" role="listbox">
        {shown.map((s) => (
          <div key={s.title} className="player-list__section">
            <div className="player-list__header">{s.title}</div>
            {s.rows.map((r, i) => {
              const key = `${s.title}:${r.player.id}:${i}`
              return (
                <div
                  key={key}
                  role="option"
                  className="player-list__row"
                  aria-selected={current?.key === key}
                  aria-disabled={r.disabled || undefined}
                  data-highlighted={current?.key === key ? 'true' : undefined}
                  data-dim={r.dim || undefined}
                  onMouseDown={noMouseFocus}
                  onMouseMove={() => !r.disabled && setHi(key)}
                  onClick={() => !r.disabled && onChoose(r.player)}
                >
                  <span className="player-list__jersey">{r.player.jersey}</span>
                  <span className="player-list__name">{r.player.name}</span>
                  <span className="player-list__pos">{r.player.depthPos || r.player.position}</span>
                  {r.trailing && <span className="player-list__trailing">{r.trailing}</span>}
                  {r.checked && <Icon name="check" size={12} className="player-list__check" />}
                </div>
              )
            })}
          </div>
        ))}
        {!shown.length && <div className="player-list__empty">No Results</div>}
      </div>
    </div>
  )
}
