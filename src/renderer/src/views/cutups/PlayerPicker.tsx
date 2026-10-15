import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchIndex } from '@shared/types'
import { rawApi } from '../../api'
import { Avatar } from '../../ui/Avatar'
import { Popover } from '../../ui/Popover'
import { SearchField } from '../../ui/SearchField'
import { Icon } from '../../ui/Icon'

/**
 * The player popover (03 §9.3): a search field and results from `searchIndex` across downloaded seasons
 * ("Cooper DeJean · CB · PHI · 2025"). Players are matched by id in every season, so one row per id.
 */

export interface PickedPlayer {
  id: string
  name: string
  position: string
  team: string
  headshot: string
}

let cache: Promise<PickedPlayer[]> | null = null
const names = new Map<string, PickedPlayer>()

/** Every player of the downloaded seasons, graded ones first, newest season first. */
export function allPlayers(): Promise<PickedPlayer[]> {
  if (!cache) {
    cache = rawApi
      .seasons()
      .then((seasons) => Promise.all(seasons.filter((s) => s.downloaded).map((s) => rawApi.searchIndex(s.season).catch(() => null))))
      .then((indexes) => {
        const out = new Map<string, PickedPlayer & { graded: number; season: number }>()
        for (const idx of indexes.filter((x): x is SearchIndex => !!x)) {
          for (const p of idx.players) {
            const cur = out.get(p.id)
            if (!cur || p.season > cur.season) out.set(p.id, { id: p.id, name: p.name, position: p.position, team: p.team, headshot: p.headshot, graded: (cur?.graded ?? 0) + p.graded, season: p.season })
          }
        }
        const list = [...out.values()].sort((a, b) => b.graded - a.graded || a.name.localeCompare(b.name))
        list.forEach((p) => names.set(p.id, p))
        return list
      })
      .catch(() => {
        cache = null
        return []
      })
  }
  return cache
}

/** A known player's name (after `allPlayers` resolved once). */
export function playerName(id: string): string | undefined {
  return names.get(id)?.name
}

/** Player names by id, for rule summaries; re-renders once the list loads. */
export function usePlayerNames(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries([...names.values()].map((p) => [p.id, p.name])))
  useEffect(() => {
    let live = true
    void allPlayers().then((list) => live && setMap(Object.fromEntries(list.map((p) => [p.id, p.name]))))
    return () => {
      live = false
    }
  }, [])
  return map
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function PlayerSearch({ onPick }: { onPick: (p: PickedPlayer) => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<PickedPlayer[] | null>(null)
  const [hi, setHi] = useState(0)
  useEffect(() => {
    void allPlayers().then(setList)
  }, [])
  const hits = useMemo(() => {
    if (!list) return []
    const n = fold(q.trim())
    if (!n) return list.slice(0, 40)
    return list.filter((p) => fold(p.name).split(/\s+/).some((w) => w.startsWith(n)) || fold(p.name).includes(n)).slice(0, 40)
  }, [list, q])
  useEffect(() => setHi(0), [q])
  return (
    <div
      className="screen-player-picker player-picker"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setHi((h) => Math.max(0, Math.min(hits.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1))))
        } else if (e.key === 'Enter' && hits[hi]) {
          e.preventDefault()
          onPick(hits[hi])
        }
      }}
    >
      <SearchField size="md" value={q} onChange={setQ} placeholder="Search players" autoFocus />
      <div className="player-picker__list" role="listbox">
        {!list ? null : !hits.length ? (
          <div className="player-picker__empty">No players match “{q}”</div>
        ) : (
          hits.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === hi}
              className="player-picker__row"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => onPick(p)}
            >
              <Avatar url={p.headshot} name={p.name} size={16} />
              <span className="player-picker__name ellipsis">{p.name}</span>
              <span className="player-picker__meta">
                {p.position} · {p.team}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/** The 200-wide button that shows a chosen player and opens the popover. */
export function PlayerField({ value, onChange, width = 200, invalid }: { value: string | null; onChange: (p: PickedPlayer) => void; width?: number; invalid?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [, force] = useState(0)
  useEffect(() => {
    if (value && !names.has(value)) void allPlayers().then(() => force((n) => n + 1))
  }, [value])
  const p = value ? names.get(value) : null
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="popup-button popup-button--md popup-button--default player-field"
        data-invalid={invalid || undefined}
        style={{ width }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {p ? <Avatar url={p.headshot} name={p.name} size={16} /> : <Icon name="user-round" size={14} />}
        <span className="popup-button__label">{p ? p.name : value ? 'Player' : 'Choose Player…'}</span>
        <Icon name="chevrons-up-down" size={12} className="popup-button__chevrons" />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={300} padding="list" test="player-popover">
        <PlayerSearch
          onPick={(pl) => {
            setOpen(false)
            onChange(pl)
          }}
        />
      </Popover>
    </>
  )
}
