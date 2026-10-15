import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CutupSummary, PlayRef } from '@shared/types'
import { rawApi } from '../../api'
import { Icon } from '../../ui/Icon'
import { Popover } from '../../ui/Popover'
import { SearchField } from '../../ui/SearchField'
import { TextField } from '../../ui/TextField'
import { addPlaysTo, newCutupWith } from './actions'

/**
 * The Add to Cut-up popover (03 §9.5): manual cut-ups in sidebar order with a check when every play is already in
 * one and a dash when some are, a search field, and "New Cut-up…" which turns into a name field.
 */

const keyOf = (r: PlayRef) => `${r.gameId}:${r.playId}`

/** Where to point: the trailing edge of the row, or the toolbar title when the row isn't on screen. */
export function anchorRect(anchor: Element | DOMRect | null | undefined): DOMRect {
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor
  const visible = rect && rect.width > 0 && rect.bottom > 52 && rect.top < window.innerHeight
  if (visible && rect) {
    const x = rect.right - 28
    return new DOMRect(x, rect.top, 1, rect.height)
  }
  const title = document.querySelector('.shell-toolbar__title')?.getBoundingClientRect()
  if (title) return new DOMRect(title.left + title.width / 2, title.top, 1, title.height)
  return new DOMRect(window.innerWidth / 2, 60, 1, 1)
}

export function AddToCutupPopover({ plays, anchor, onClose }: { plays: PlayRef[]; anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [list, setList] = useState<CutupSummary[] | null>(null)
  const [members, setMembers] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const [naming, setNaming] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    const wanted = new Set(plays.map(keyOf))
    rawApi.cutups().then(
      async (all) => {
        const manual = all.filter((c) => c.cutup.kind === 'manual')
        if (!live) return
        setList(manual)
        // How many of the plays each cut-up already holds.
        const counts = await Promise.all(
          manual.map((c) =>
            rawApi
              .cutup(c.cutup.id)
              .then((d) => (d?.items ?? []).filter((i) => wanted.has(keyOf(i.ref))).length)
              .catch(() => 0)
          )
        )
        if (live) setMembers(Object.fromEntries(manual.map((c, i) => [c.cutup.id, counts[i]])))
      },
      () => live && setList([])
    )
    return () => {
      live = false
    }
  }, [plays])

  const hits = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (list ?? []).filter((c) => !n || c.cutup.name.toLowerCase().includes(n))
  }, [list, q])
  useEffect(() => setHi(0), [q])

  useLayoutEffect(() => {
    if (naming !== null) {
      nameRef.current?.focus()
      nameRef.current?.select()
    }
  }, [naming !== null])

  const pick = (c: CutupSummary) => {
    onClose()
    void addPlaysTo(c.cutup.id, c.cutup.name, plays)
  }
  const create = (name: string) => {
    onClose()
    void newCutupWith(plays, name.trim() || 'Untitled Cut-up')
  }

  const anchorEl = useRef<HTMLDivElement>(null)
  const n = plays.length
  return (
    <>
      <div ref={anchorEl} aria-hidden style={{ position: 'fixed', left: anchor.left, top: anchor.top, width: Math.max(1, anchor.width), height: Math.max(1, anchor.height), pointerEvents: 'none' }} />
      <Popover anchor={anchorEl} open onClose={onClose} width={280} padding="list" test="add-to-cutup">
        <div
          ref={ref}
          className="screen-add-to-cutup"
          onKeyDown={(e) => {
            if (naming !== null) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setHi((h) => Math.max(0, Math.min(hits.length, h + (e.key === 'ArrowDown' ? 1 : -1))))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              if (hi < hits.length) pick(hits[hi])
              else setNaming(q.trim() || 'Untitled Cut-up')
            }
          }}
        >
          <div className="add-to-cutup__title">{n === 1 ? 'Add Play to Cut-up' : `Add ${n} Plays to Cut-up`}</div>
          <div className="add-to-cutup__search">
            <SearchField size="md" value={q} onChange={setQ} placeholder="Find a cut-up" autoFocus />
          </div>
          <div className="add-to-cutup__list" role="listbox">
            {list && !list.length ? (
              <div className="add-to-cutup__empty">No cut-ups yet</div>
            ) : list && !hits.length ? (
              <div className="add-to-cutup__empty">No cut-ups match “{q.trim()}”</div>
            ) : (
              hits.map((c, i) => {
                const have = members[c.cutup.id] ?? 0
                return (
                  <button
                    key={c.cutup.id}
                    type="button"
                    role="option"
                    aria-selected={i === hi}
                    className="add-to-cutup__row"
                    data-test="add-to-cutup-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(c)}
                  >
                    <span className="add-to-cutup__mark">{have >= n ? <Icon name="check" size={12} /> : have > 0 ? <span className="add-to-cutup__dash" /> : null}</span>
                    <Icon name="list-video" size={14} className="add-to-cutup__icon" />
                    <span className="ellipsis">{c.cutup.name}</span>
                    <span className="add-to-cutup__count">{c.playCount}</span>
                  </button>
                )
              })
            )}
          </div>
          <div className="add-to-cutup__sep" />
          {naming === null ? (
            <button
              type="button"
              role="option"
              aria-selected={hi === hits.length}
              className="add-to-cutup__row"
              data-test="add-to-cutup-new"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(hits.length)}
              onClick={() => setNaming(q.trim() || 'Untitled Cut-up')}
            >
              <span className="add-to-cutup__mark">
                <Icon name="circle-plus" size={14} />
              </span>
              <span style={{ gridColumn: '2 / 4' }}>New Cut-up…</span>
            </button>
          ) : (
            <div className="add-to-cutup__new">
              <TextField ref={nameRef} size="lg" value={naming} onChange={setNaming} onCommit={create} test="add-to-cutup-name" ariaLabel="Cut-up name" />
            </div>
          )}
        </div>
      </Popover>
    </>
  )
}
