import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { durationLabel } from '@shared/labels'
import type { CutupSummary } from '@shared/types'
import { rawApi } from '../../api'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { PopupButton } from '../../ui/PopupButton'
import { TextBadge } from '../../ui/Badge'
import { errorBanner } from '../../shell/Banners'
import { runCommand, useCommand } from '../../shell/commands'
import { showMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { links, navigate } from '../../shell/router'
import { LargeTitle, LoadError, Loading, Screen, useScrollRestore } from '../../shell/Screen'
import { Toolbar } from '../../shell/Toolbar'
import { Poster, useLocalState, useMeasure } from '../shared'
import { confirmDeleteCutup, cutupMenu, exportCutup, newSmartCutup, openRulesSheet, plural } from './actions'
import { type CutupsSort, sortCutups, updatedLabel } from './cutupModel'
import { CutupScreen } from './CutupScreen'
import { TEMPLATES } from './rules'
import './cutups.css'

/** The Cut-ups screen (03 §10.1): every cut-up as a poster tile, sorting, drag to reorder and the templates. */

const SORTS: { value: CutupsSort; label: string }[] = [
  { value: 'manual', label: 'Manual Order' },
  { value: 'name', label: 'Name' },
  { value: 'updated', label: 'Recently Updated' },
  { value: 'plays', label: 'Most Plays' }
]

function useCutupList() {
  const [list, setList] = useState<CutupSummary[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const load = useCallback(() => {
    rawApi.cutups().then(
      (l) => {
        setList(l)
        setError(null)
      },
      (e) => setError(e)
    )
  }, [])
  useEffect(load, [load])
  useDataEvent(['cutups', 'grades', 'notes', 'film', 'season'], load)
  return { list, error, reload: load }
}

export function Cutups() {
  const { list, error, reload } = useCutupList()
  const [q, setQ] = useState('')
  const [sort, setSort] = useLocalState<CutupsSort>('ui.cutups.sort', 'manual')
  const [measure, width] = useMeasure<HTMLDivElement>(1136)
  const n = Math.max(3, Math.floor((width + 24) / 264))
  const [focused, setFocused] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null)
  useScrollRestore(!!list)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sortCutups(list ?? [], sort).filter((c) => !needle || c.cutup.name.toLowerCase().includes(needle))
  }, [list, sort, q])
  const total = (list ?? []).reduce((s, c) => s + c.playCount, 0)
  const focusedCutup = shown.find((c) => c.cutup.id === focused) ?? null
  useCommand('file.exportVideo', () => focusedCutup && void exportCutup(focusedCutup.cutup.id), { enabled: !!focusedCutup && focusedCutup.playCount > focusedCutup.withoutFilm, label: 'Export Cut-up Video…' })

  const reorder = (id: string, target: string, after: boolean) => {
    const ids = sortCutups(list ?? [], 'manual').map((c) => c.cutup.id)
    const rest = ids.filter((x) => x !== id)
    const at = rest.indexOf(target)
    if (at < 0) return
    rest.splice(after ? at + 1 : at, 0, id)
    if (rest.join() === ids.join()) return
    void rawApi
      .reorderCutups(rest)
      .then(reload)
      .catch((e) => errorBanner('Couldn’t move the cut-up', e))
  }

  const subtitle = list ? (list.length ? `${plural(list.length, 'cut-up')} · ${plural(total, 'play')}` : 'No cut-ups yet') : undefined
  const toolbar = (
    <Toolbar
      title="Cut-ups"
      subtitle={subtitle}
      collapsesLargeTitle
      trailing={[
        {
          kind: 'custom',
          width: 36,
          node: <NewButton />
        }
      ]}
      search={list?.length ? { placeholder: 'Search cut-ups', value: q, onChange: setQ } : undefined}
    />
  )

  return (
    <Screen name="cutups">
      {toolbar}
      <div ref={measure} className="cutups" style={{ '--tiles': n } as CSSProperties}>
        <LargeTitle>Cut-ups</LargeTitle>
        <p className="cutups__intro">Saved groups of plays from any games, ready to replay or export.</p>
        {error && !list ? (
          <LoadError what="your cut-ups" error={error} retry={reload} />
        ) : !list ? (
          <Loading />
        ) : !list.length ? (
          <div className="cutups__empty" data-test="cutups-empty">
            <EmptyState
              icon="list-video"
              title="No cut-ups yet"
              body="A cut-up collects plays from any games so you can replay or export them together. Add plays from the tape room with ⌘D, or let a smart cut-up gather them by down, pressure, coverage and more."
              primary={{ label: 'New Smart Cut-up…', run: () => newSmartCutup() }}
              secondary={
                <button type="button" className="button button--borderless button--md" onClick={() => runCommand('file.newCutup')}>
                  <span className="button__label">New Cut-up</span>
                </button>
              }
            />
          </div>
        ) : (
          <>
            <div className="cutups__sort">
              <PopupButton size="sm" variant="inline" value={sort} onChange={setSort} options={SORTS} label={`Sort: ${SORTS.find((s) => s.value === sort)?.label}`} test="cutups-sort" />
            </div>
            {!shown.length ? (
              <EmptyState icon="search" title="No Results" body={`No cut-ups match “${q.trim()}”.`} primary={{ label: 'Clear Search', run: () => setQ('') }} />
            ) : (
              <div
                className="cutups__grid"
                role="grid"
                onKeyDown={(e) => {
                  const i = shown.findIndex((c) => c.cutup.id === focused)
                  const move = (d: number) => {
                    const next = shown[Math.max(0, Math.min(shown.length - 1, (i < 0 ? 0 : i) + d))]
                    if (!next) return
                    e.preventDefault()
                    document.querySelector<HTMLElement>(`[data-cutup-tile="${next.cutup.id}"]`)?.focus()
                  }
                  if (e.key === 'ArrowRight') move(1)
                  else if (e.key === 'ArrowLeft') move(-1)
                  else if (e.key === 'ArrowDown') move(n)
                  else if (e.key === 'ArrowUp') move(-n)
                  else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
                    const hit = shown.find((c) => c.cutup.name.toLowerCase().startsWith(e.key.toLowerCase()))
                    if (hit) document.querySelector<HTMLElement>(`[data-cutup-tile="${hit.cutup.id}"]`)?.focus()
                  }
                }}
              >
                {shown.map((c) => (
                  <CutupTile
                    key={c.cutup.id}
                    c={c}
                    draggable={sort === 'manual' && !q.trim()}
                    dropSide={drag?.over === c.cutup.id ? (drag.after ? 'after' : 'before') : null}
                    onFocus={() => setFocused(c.cutup.id)}
                    onDragStart={() => setDrag({ id: c.cutup.id, over: null, after: false })}
                    onDragOver={(after) => drag && drag.id !== c.cutup.id && (drag.over !== c.cutup.id || drag.after !== after) && setDrag({ ...drag, over: c.cutup.id, after })}
                    onDrop={() => {
                      if (drag && drag.id !== c.cutup.id) reorder(drag.id, c.cutup.id, drag.after)
                      setDrag(null)
                    }}
                    onDragEnd={() => setDrag(null)}
                  />
                ))}
              </div>
            )}
          </>
        )}
        <section className="cutups__templates">
          <h2 className="cutups__section-title">Start from a Template</h2>
          <div className="cutups__template-row">
            {TEMPLATES.slice(0, 4).map((t) => (
              <button key={t.id} type="button" className="cutups-template" data-test="cutups-template" onMouseDown={(e) => e.preventDefault()} onClick={() => openRulesSheet({ mode: 'new', template: t.id })}>
                <Icon name="list-filter" size={16} className="cutups-template__icon" />
                <span className="cutups-template__text">
                  <span className="cutups-template__name">{t.label.replace(/…$/, '')}</span>
                  <span className="cutups-template__sub">Smart cut-up</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </Screen>
  )
}

function NewButton() {
  return (
    <button
      type="button"
      className="button button--toolbar button--toolbar button--icon"
      aria-label="New Cut-up"
      title="New Cut-up (⌥-click for Smart)"
      data-test="cutups-new"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => (e.altKey ? newSmartCutup() : runCommand('file.newCutup'))}
    >
      <Icon name="list-plus" size={16} />
    </button>
  )
}

function CutupTile({
  c,
  draggable,
  dropSide,
  onFocus,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  c: CutupSummary
  draggable: boolean
  dropSide: 'before' | 'after' | null
  onFocus: () => void
  onDragStart: () => void
  onDragOver: (after: boolean) => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const id = c.cutup.id
  const smart = c.cutup.kind === 'smart'
  const noFilm = c.playCount > 0 && c.withoutFilm >= c.playCount
  const line2 = noFilm ? `${plural(c.playCount, 'play')} · no film yet` : `${plural(c.playCount, 'play')} · ${plural(c.gameCount, 'game')} · ${durationLabel(c.duration)}`
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="cutups-tile" data-drop={dropSide ?? undefined}>
      <div
        ref={ref}
        className="cutups-tile__hit"
        role="gridcell"
        tabIndex={0}
        data-test="cutups-tile"
        data-cutup-tile={id}
        title={draggable ? undefined : 'Choose Manual Order to rearrange'}
        draggable
        onFocus={onFocus}
        onMouseDown={(e) => e.button === 0 && e.preventDefault()}
        onClick={(e) => {
          ref.current?.focus({ preventScroll: true })
          const onCircle = (e.target as HTMLElement).closest('.cutups-tile__play')
          navigate(onCircle ? `${links.cutup(id)}?play=1` : links.cutup(id))
        }}
        onContextMenu={(e) => void showMenu(e, cutupMenu(c, () => navigate(links.cutup(id))))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            navigate(links.cutup(id))
          } else if (e.key === ' ') {
            e.preventDefault()
            navigate(`${links.cutup(id)}?play=1`)
          } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault()
            void confirmDeleteCutup(c)
          }
        }}
        onDragStart={(e) => {
          if (!draggable) {
            e.preventDefault()
            return
          }
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/x-all22-cutup', id)
          onDragStart()
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('text/x-all22-cutup')) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          onDragOver(e.clientX > r.left + r.width / 2)
        }}
        onDrop={(e) => {
          e.preventDefault()
          onDrop()
        }}
        onDragEnd={onDragEnd}
      >
        <Poster poster={c.poster} className="cutups-tile__poster">
          <span className="cutups-tile__play" aria-label="Play All">
            <Icon name="play" size={18} filled />
          </span>
        </Poster>
        <div className="cutups-tile__line1">
          <Icon name={smart ? 'list-filter' : 'list-video'} size={12} className="cutups-tile__kind" />
          <span className="cutups-tile__title ellipsis">{c.cutup.name}</span>
          {smart && <TextBadge>SMART</TextBadge>}
        </div>
        <div className="cutups-tile__line2">{line2}</div>
        <div className="cutups-tile__line3">{updatedLabel(c.cutup.updatedAt)}</div>
      </div>
    </div>
  )
}

/** One cut-up (03 §9.6). */
export function Cutup({ id }: { id: string }) {
  return <CutupScreen key={id} id={id} />
}

