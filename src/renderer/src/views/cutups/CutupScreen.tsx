import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { defPersonnelLabel, durationLabel, enumLabel, personnelLabel, playCaption, shortDesc } from '@shared/labels'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { CutupDetail, CutupFocus, CutupItem, CutupSummary, PlayRef } from '@shared/types'
import { api, rawApi } from '../../api'
import { formatEpa } from '../../format'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { CriticalMark, GradeGlyph } from '../../ui/Grade'
import { ink } from '../../ui/heat'
import { Icon } from '../../ui/Icon'
import type { MenuItemSpec } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { PopupButton } from '../../ui/PopupButton'
import { TextField } from '../../ui/TextField'
import { errorBanner } from '../../shell/Banners'
import { runCommand, useCommand } from '../../shell/commands'
import { showMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { Inspector, InspectorSection } from '../../shell/Inspector'
import { links, navigate, useRoute } from '../../shell/router'
import { LoadError, Loading, Screen } from '../../shell/Screen'
import { useSettings } from '../../shell/store'
import { Toolbar } from '../../shell/Toolbar'
import { PLAY_DRAG_TYPE, playMenu, ReelPlayer, type ReelEntry, type ReelHandle, readLocal, requestAddToCutup, requestExportVideo, useMeasure, writeLocal } from '../shared'
import { ExportToolbarButton } from '../export/ExportToolbarButton'
import { editRules, exportCutup, newSmartCutup, plural } from './actions'
import { clockCell, filterItems, focusEntry, gameCell, hasNote, itemLength, keyOf, matchedRuleLabels, reorderKeys, situationLabel, sortItems, tagsOf, teamCounts, type CutupSortColumn } from './cutupModel'
import { PlayerSearch, playerName, usePlayerNames } from './PlayerPicker'
import { fieldDef, rulesSummary } from './rules'
import './cutups.css'

/** One cut-up (03 §9.6): the reel stage on top, the play list under it, the inspector at the right. */

interface Undo {
  label: string
  run: () => Promise<void>
}

function useCutup(id: string) {
  const [detail, setDetail] = useState<CutupDetail | null | undefined>(undefined)
  const [summary, setSummary] = useState<CutupSummary | null>(null)
  const [all, setAll] = useState<CutupSummary[]>([])
  const [error, setError] = useState<unknown>(null)
  const seq = useRef(0)
  const load = useCallback(() => {
    const at = ++seq.current
    Promise.all([rawApi.cutup(id), rawApi.cutups()]).then(
      ([d, list]) => {
        if (at !== seq.current) return
        setDetail(d)
        setAll(list)
        setSummary(list.find((c) => c.cutup.id === id) ?? null)
        setError(null)
      },
      (e) => at === seq.current && setError(e)
    )
  }, [id])
  useEffect(() => {
    setDetail(undefined)
    load()
  }, [load])
  useDataEvent(['cutups', 'grades', 'notes', 'film', 'season'], load)
  return { detail, summary, all, error, reload: load }
}

const COLS: { id: CutupSortColumn | 'n'; label: string; width?: number; min?: number; align?: 'right' }[] = [
  { id: 'n', label: '#', width: 40, align: 'right' },
  { id: 'game', label: 'Game', width: 120 },
  { id: 'clock', label: 'Clock', width: 72 },
  { id: 'situation', label: 'Situation', width: 128 },
  { id: 'play', label: 'Play', min: 240 },
  { id: 'grades', label: 'Grades', width: 88 },
  { id: 'epa', label: 'EPA', width: 64, align: 'right' },
  { id: 'tags', label: 'Tags', width: 140 },
  { id: 'markers', label: '', width: 40 },
  { id: 'length', label: 'Length', width: 56, align: 'right' }
]

export function CutupScreen({ id }: { id: string }) {
  const route = useRoute()
  const settings = useSettings()
  const startOpts = { startAtSnap: settings?.startAtSnap ?? true, preRoll: settings?.preRoll ?? 1 }
  const { detail, summary, all, error, reload } = useCutup(id)
  const [text, setText] = useState('')
  const [sort, setSort] = useState<{ column: CutupSortColumn; dir: 'asc' | 'desc' } | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [undo, setUndo] = useState<Undo[]>([])
  const [renaming, setRenaming] = useState(false)
  const reel = useRef<ReelHandle>(null)
  const players = usePlayerNames()

  const cutup = detail?.cutup ?? null
  const manual = cutup?.kind === 'manual'
  const focusPlayer = cutup?.focus?.playerId ?? null
  const items = detail?.items ?? []
  const multiSeason = new Set(items.map((i) => i.game.season)).size > 1
  const shown = useMemo(() => sortItems(filterItems(items, text, multiSeason), sort?.column ?? null, sort?.dir ?? 'asc', { playerId: focusPlayer, multiSeason, settings: startOpts }), [items, text, sort, focusPlayer, multiSeason, startOpts.startAtSnap, startOpts.preRoll])
  const entries: ReelEntry[] = useMemo(
    () =>
      shown.map((i) => {
        const fe = focusEntry(i, focusPlayer)
        return { ref: i.ref, game: i.game, team: i.team, play: i.play, clips: i.clips, drawing: i.drawing, grade: fe?.grade ?? null, critical: fe?.critical, tags: tagsOf(i), note: fe?.note, playNote: i.playNote, flagged: i.flagged, teamEpa: i.teamEpa }
      }),
    [shown, focusPlayer]
  )
  const cur = shown.some((i) => keyOf(i.ref) === current) ? current : shown[0] ? keyOf(shown[0].ref) : null
  const curItem = shown.find((i) => keyOf(i.ref) === cur) ?? null
  const sel = selection.filter((k) => shown.some((i) => keyOf(i.ref) === k))
  const selected = sel.length ? sel : cur ? [cur] : []
  const selectedRefs = shown.filter((i) => selected.includes(keyOf(i.ref))).map((i) => i.ref)
  const withFilm = items.filter((i) => i.clips.length)
  const noFilm = items.length - withFilm.length
  const duration = summary?.duration ?? withFilm.reduce((s, i) => s + (itemLength(i, startOpts) ?? 0), 0)
  const games = new Set(items.map((i) => i.ref.gameId)).size

  // ?play=1, ?rules=1, ?export=1 (context menus, tiles).
  const handled = useRef('')
  useEffect(() => {
    if (!detail || handled.current === route.raw) return
    handled.current = route.raw
    const q = route.query
    if (q.get('play') === '1') setTimeout(() => reel.current?.playAll(), 150)
    if (q.get('rules') === '1' && detail.cutup.kind === 'smart') void editRules(id)
    if (q.get('export') === '1') void exportCutup(id)
    if (q.has('play') || q.has('rules') || q.has('export')) navigate(links.cutup(id), { replace: true })
  }, [detail, route.raw, route.query, id])

  // ── Writes with undo ──
  const pushUndo = (u: Undo) => setUndo((list) => [...list.slice(-19), u])
  const remove = async (refs: PlayRef[]) => {
    if (!manual || !refs.length || !cutup) return
    const order = items.map((i) => i.ref)
    const removing = new Set(refs.map(keyOf))
    const after = shown.filter((i) => !removing.has(keyOf(i.ref)))
    const idx = shown.findIndex((i) => removing.has(keyOf(i.ref)))
    const next = after[Math.min(idx, after.length - 1)]
    try {
      await api.removeFromCutup(id, refs)
      setSelection([])
      if (next) setCurrent(keyOf(next.ref))
      pushUndo({
        label: 'Undo Remove from Cut-up',
        run: async () => {
          await api.addToCutup(id, refs)
          await api.reorderCutup(id, order)
        }
      })
    } catch (e) {
      errorBanner('Couldn’t remove the plays', e)
    }
  }
  const move = async (keys: string[], target: string, after: boolean) => {
    const order = items.map((i) => keyOf(i.ref))
    const next = reorderKeys(order, keys, target, after)
    if (next.join() === order.join()) return
    const byKey = new Map(items.map((i) => [keyOf(i.ref), i.ref]))
    const prev = items.map((i) => i.ref)
    try {
      await api.reorderCutup(id, next.map((k) => byKey.get(k)!))
      pushUndo({ label: 'Undo Move', run: () => api.reorderCutup(id, prev) })
    } catch (e) {
      errorBanner('Couldn’t move the plays', e)
    }
  }
  const setFocus = async (focus: CutupFocus | null) => {
    try {
      await api.updateCutup(id, { focus })
    } catch (e) {
      errorBanner('Couldn’t change whose grades show', e)
    }
  }
  const rename = async (name: string) => {
    setRenaming(false)
    const next = name.trim().slice(0, 80)
    if (!next || !cutup || next === cutup.name) return
    try {
      await api.updateCutup(id, { name: next })
    } catch (e) {
      errorBanner('Couldn’t rename the cut-up', e)
    }
  }

  const exportShown = () => {
    if (!cutup) return
    const whole = items.map((i) => i.ref)
    const choices = [{ key: 'whole', label: `Whole Cut-up (${whole.length})`, plays: whole }]
    if (text.trim()) choices.push({ key: 'shown', label: `Shown Plays (${shown.length})`, plays: shown.map((i) => i.ref) })
    if (sel.length >= 2) choices.push({ key: 'selected', label: `Selected Plays (${sel.length})`, plays: selectedRefs })
    requestExportVideo({ kind: 'cutup', cutupId: id, plays: whole }, cutup.name, {
      choices,
      initial: choices[choices.length - 1].key,
      playerId: focusPlayer,
      fileName: cutup.name,
      angle: readLocal(`ui.cutup.${id}.angle`, 'sideline')
    })
  }

  const exportable = withFilm.length > 0
  useCommand('file.exportVideo', exportShown, { enabled: !!cutup && exportable, label: 'Export Cut-up Video…' })
  useCommand('file.editCutupRules', () => void editRules(id), { enabled: cutup?.kind === 'smart' })
  useCommand('cutup.removeSelected', () => void remove(selectedRefs), { enabled: manual && selectedRefs.length > 0 })
  useCommand(
    'edit.undo',
    () => {
      const u = undo[undo.length - 1]
      if (!u) return
      setUndo((l) => l.slice(0, -1))
      void u.run().catch((e) => errorBanner('Couldn’t undo', e))
    },
    { enabled: undo.length > 0, label: undo[undo.length - 1]?.label }
  )

  // ── Layout: stage height from the splitter ──
  const rootRef = useRef<HTMLDivElement>(null)
  const [contentH, setContentH] = useState(800)
  const [measureRef, contentW] = useMeasure<HTMLDivElement>(1120)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContentH(el.clientHeight))
    ro.observe(el)
    setContentH(el.clientHeight)
    return () => ro.disconnect()
  }, [detail === undefined])
  const [split, setSplit] = useState<number | null>(() => readLocal<number | null>('ui.cutup.split', null))
  const auto = Math.min((contentW * 9) / 16, contentH * 0.58)
  const stageH = Math.round(Math.max(240, Math.min(contentH - 200, split !== null ? split * contentH : auto)))

  const titleMenu = (): MenuItemSpec[] => [
    { label: 'Rename…', run: () => setRenaming(true) },
    { kind: 'separator' },
    { kind: 'header', label: 'Cut-ups' },
    ...all.map((c) => ({ label: c.cutup.name, icon: c.cutup.kind === 'smart' ? ('list-filter' as const) : ('list-video' as const), checked: c.cutup.id === id, run: () => navigate(links.cutup(c.cutup.id)) })),
    { kind: 'separator' },
    { label: 'New Cut-up', shortcut: '⌘N', run: () => runCommand('file.newCutup') },
    { label: 'New Smart Cut-up…', shortcut: '⌥⌘N', run: () => newSmartCutup() }
  ]

  const subtitle = cutup ? `${plural(items.length, 'play')} · ${plural(games, 'game')} · ${durationLabel(duration)}${noFilm ? ' of film' : ''}` : undefined
  const inspector = cutup ? <CutupInspector detail={detail!} item={curItem} selectedRefs={sel.length > 1 ? selectedRefs : []} focusPlayer={focusPlayer} onRemove={(refs) => void remove(refs)} /> : <Inspector title="Play" />

  const toolbar = (
    <Toolbar
      title={cutup?.name ?? 'Cut-up'}
      subtitle={subtitle}
      windowTitle={cutup?.name ?? 'Cut-up'}
      titleMenu={cutup ? titleMenu : undefined}
      inspector
      trailing={
        cutup
          ? [
              { kind: 'button', command: 'play.playAll', icon: 'play', label: 'Play All', showLabel: true, test: 'cutup-play-all' },
              ...(cutup.kind === 'smart' ? [{ kind: 'button' as const, command: 'file.editCutupRules' as const, icon: 'list-filter' as const, label: 'Edit Rules', showLabel: true }] : []),
              { kind: 'custom', width: 36, node: <ExportToolbarButton route={links.cutup(id)} disabled={!exportable} onExport={exportShown} test="cutup-export" /> }
            ]
          : []
      }
      search={cutup && items.length ? { placeholder: 'Search plays', value: text, onChange: setText } : undefined}
    />
  )

  if (error && detail === undefined) {
    return (
      <Screen name="cutup" scroll="none" inspector={inspector}>
        {toolbar}
        <LoadError what="this cut-up" error={error} retry={reload} />
      </Screen>
    )
  }
  if (detail === undefined) {
    return (
      <Screen name="cutup" scroll="none" inspector={inspector}>
        {toolbar}
        <Loading />
      </Screen>
    )
  }
  if (!detail || !cutup) {
    return (
      <Screen name="cutup" scroll="none" inspector={inspector}>
        {toolbar}
        <EmptyState icon="list-video" title="Cut-up not found" body="It may have been deleted." primary={{ label: 'Go Home', run: () => navigate(links.home()) }} />
      </Screen>
    )
  }

  const empty = !items.length
  const notices = (
    <>
      {detail.skippedSeasons.map((s) => (
        <div key={s} className="cutup-notice">
          <Icon name="info" size={14} />
          <span>Plays from {s} aren’t included because that season isn’t downloaded.</span>
          <Button variant="borderless" size="sm" label={`Download ${s}`} onClick={() => void rawApi.downloadSeason(s).catch((e) => errorBanner(`Couldn’t download ${s}`, e))} />
        </div>
      ))}
      {cutup.kind === 'smart' && cutup.rules?.limit != null && items.length >= cutup.rules.limit && (
        <div className="cutup-notice">
          <Icon name="info" size={14} />
          <span>Showing the first {cutup.rules.limit} matching plays.</span>
          <Button variant="borderless" size="sm" label="Edit Rules…" onClick={() => void editRules(id)} />
        </div>
      )}
    </>
  )

  return (
    <Screen name="cutup" scroll="none" inspector={inspector}>
      {toolbar}
      <div className="cutup" ref={rootRef}>
        <div ref={measureRef} className="cutup__measure" />
        {empty ? (
          manual ? (
            <EmptyState
              icon="list-video"
              title="This cut-up is empty"
              body={`Add plays from the tape room with ⌘D, or drag plays onto “${cutup.name}” in the sidebar.`}
              primary={{ label: 'Open Film', run: () => runCommand('go.film') }}
            />
          ) : (
            <EmptyState
              icon="list-filter"
              title="No plays match yet"
              body="Plays appear here as you grade and import film that fits these rules."
              primary={{ label: 'Edit Rules…', run: () => void editRules(id) }}
              secondary={<span className="cutup__rules-line">{cutup.rules ? rulesSummary(cutup.rules, { players }) : ''}</span>}
            />
          )
        ) : (
          <>
            <div className="cutup__stage" style={{ height: stageH }}>
              <ReelPlayer
                handle={reel}
                entries={entries}
                current={cur}
                onCurrentChange={(k) => {
                  setCurrent(k)
                  setSelection([k])
                }}
                selection={selected}
                onSelectionChange={setSelection}
                playerId={focusPlayer ?? undefined}
                layout="stack"
                angleKey={`ui.cutup.${id}.angle`}
                autoAdvance
                edge
                rowTest="cutup-row"
              />
            </div>
            <Splitter
              onDrag={(y) => {
                const top = rootRef.current?.getBoundingClientRect().top ?? 0
                const h = Math.max(240, Math.min(contentH - 200, y - top))
                setSplit(h / contentH)
              }}
              onEnd={() => writeLocal('ui.cutup.split', split)}
              onReset={() => {
                setSplit(null)
                writeLocal('ui.cutup.split', null)
              }}
            />
            {notices}
            <div className="cutup__controls">
              <span className="cutup__controls-label">Grades for:</span>
              <GradesFor focus={cutup.focus} items={items} onChange={(f) => void setFocus(f)} />
              <span className="cutup__controls-spacer" />
              <span className="cutup__count">
                {text.trim() ? `${shown.length} of ${plural(items.length, 'play')}` : plural(items.length, 'play')}
                {noFilm ? ` · ${noFilm} without film` : ''}
              </span>
            </div>
            {!shown.length ? (
              <EmptyState icon="search" title="No Results" body={`No plays match “${text.trim()}”.`} primary={{ label: 'Clear Search', run: () => setText('') }} />
            ) : (
              <PlayTable
                items={shown}
                width={contentW}
                current={cur}
                selected={selected}
                focusPlayer={focusPlayer}
                multiSeason={multiSeason}
                manual={manual}
                reorderable={manual && !text.trim() && !sort}
                sort={sort}
                onSort={(c) => setSort(c)}
                startOpts={startOpts}
                onClick={(item, e) => {
                  const k = keyOf(item.ref)
                  if (e.metaKey || e.ctrlKey) setSelection(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k])
                  else if (e.shiftKey) {
                    const a = shown.findIndex((x) => keyOf(x.ref) === (selected[selected.length - 1] ?? cur))
                    const b = shown.indexOf(item)
                    const [lo, hi] = a < b ? [a, b] : [b, a]
                    setSelection([...new Set([...selected, ...shown.slice(Math.max(0, lo), hi + 1).map((x) => keyOf(x.ref))])])
                  } else {
                    setSelection([k])
                    setCurrent(k)
                    reel.current?.play(k)
                  }
                }}
                onMenu={(item, e) => {
                  const k = keyOf(item.ref)
                  if (!selected.includes(k)) {
                    setSelection([k])
                    setCurrent(k)
                  }
                  void playMenu({ ref: item.ref, game: item.game, team: item.team, play: item.play, clips: item.clips, flagged: item.flagged, playerId: focusPlayer ?? undefined }, manual ? { remove: () => void remove(selected.includes(k) ? selectedRefs : [item.ref]) } : {}).then((m) => showMenu(e, m))
                }}
                onMove={(keys, target, after) => void move(keys, target, after)}
              />
            )}
          </>
        )}
      </div>
      {renaming && <RenamePopover name={cutup.name} onDone={(n) => (n === null ? setRenaming(false) : void rename(n))} />}
    </Screen>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Splitter({ onDrag, onEnd, onReset }: { onDrag: (y: number) => void; onEnd: () => void; onReset: () => void }) {
  const dragging = useRef(false)
  return (
    <div
      className="cutup__splitter"
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => dragging.current && onDrag(e.clientY)}
      onPointerUp={() => {
        if (dragging.current) onEnd()
        dragging.current = false
      }}
      onDoubleClick={onReset}
    />
  )
}

function RenamePopover({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const anchor = useRef<HTMLElement | null>(document.querySelector<HTMLElement>('.shell-toolbar__title'))
  const [value, setValue] = useState(name)
  return (
    <Popover anchor={anchor} open onClose={() => onDone(null)} width={304} test="cutup-rename">
      <TextField size="lg" width={280} value={value} onChange={setValue} onCommit={(v) => onDone(v)} autoFocus selectOnFocus ariaLabel="Cut-up name" />
    </Popover>
  )
}

/** "Grades for:" Studied Team, the cut-up's teams, Player… */
function GradesFor({ focus, items, onChange }: { focus: CutupFocus | null; items: CutupItem[]; onChange: (f: CutupFocus | null) => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [picking, setPicking] = useState(false)
  const teams = [...new Set(items.flatMap((i) => [i.game.homeTeam, i.game.awayTeam]))].sort((a, b) => (TEAM_BY_ABBR[a]?.nickname ?? a).localeCompare(TEAM_BY_ABBR[b]?.nickname ?? b))
  const label = focus?.playerId ? (playerName(focus.playerId) ?? 'Player') : focus?.team ? (TEAM_BY_ABBR[focus.team]?.nickname ?? focus.team) : 'Studied Team'
  const items2: MenuItemSpec[] = [
    { label: 'Studied Team', checked: !focus?.team && !focus?.playerId, run: () => onChange(null) },
    { kind: 'separator' },
    ...teams.map((t) => ({ label: TEAM_BY_ABBR[t]?.nickname ?? t, checked: focus?.team === t && !focus?.playerId, run: () => onChange({ team: t }) })),
    { kind: 'separator' },
    ...(focus?.playerId ? [{ label, checked: true, run: () => {} } as MenuItemSpec] : []),
    { label: 'Player…', run: () => setPicking(true) }
  ]
  return (
    <span ref={ref}>
      <PopupButton size="sm" variant="inline" value={label} label={label} options={[{ value: label, label }]} sections={items2} onChange={() => {}} test="cutup-focus" />
      <Popover anchor={ref} open={picking} onClose={() => setPicking(false)} width={300} padding="list">
        <PlayerSearch
          onPick={(p) => {
            setPicking(false)
            onChange({ ...(focus?.team ? { team: focus.team } : {}), playerId: p.id })
          }}
        />
      </Popover>
    </span>
  )
}

function GradesCell({ item, focusPlayer }: { item: CutupItem; focusPlayer: string | null }) {
  if (!item.play) return <span className="c-label-4">—</span>
  if (focusPlayer) {
    const e = focusEntry(item, focusPlayer)
    if (!e || e.grade === null) return <span className="c-label-4">—</span>
    return (
      <span className="cutup-grade">
        <GradeGlyph grade={e.grade} />
        {e.critical && <CriticalMark grade={e.grade} />}
      </span>
    )
  }
  const c = teamCounts(item)
  if (!c.plus && !c.minus && !c.zero) return null
  return (
    <span className="cutup-counts num">
      {c.plus > 0 && <span style={{ color: ink(100) }}>+{c.plus}</span>}
      {c.minus > 0 && <span style={{ color: ink(0) }}>−{c.minus}</span>}
      {!c.plus && !c.minus && <span className="c-label-3">0×{c.zero}</span>}
    </span>
  )
}

function PlayTable({
  items,
  width,
  current,
  selected,
  focusPlayer,
  multiSeason,
  reorderable,
  manual,
  sort,
  onSort,
  startOpts,
  onClick,
  onMenu,
  onMove
}: {
  items: CutupItem[]
  width: number
  current: string | null
  selected: string[]
  focusPlayer: string | null
  multiSeason: boolean
  reorderable: boolean
  manual: boolean
  sort: { column: CutupSortColumn; dir: 'asc' | 'desc' } | null
  onSort: (s: { column: CutupSortColumn; dir: 'asc' | 'desc' } | null) => void
  startOpts: { startAtSnap: boolean; preRoll: number }
  onClick: (item: CutupItem, e: React.MouseEvent) => void
  onMenu: (item: CutupItem, e: React.MouseEvent) => void
  onMove: (keys: string[], target: string, after: boolean) => void
}) {
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null)
  const dragKeys = useRef<string[] | null>(null)
  // Narrower than 900: Tags drops, then Markers, then Situation.
  const hidden = new Set<string>()
  if (width < 900) hidden.add('tags')
  if (width < 820) hidden.add('markers')
  if (width < 740) hidden.add('situation')
  const cols = COLS.filter((c) => !hidden.has(c.id))
  const template = cols.map((c) => (c.width ? `${c.width}px` : `minmax(${c.min ?? 80}px, 1fr)`)).join(' ')
  const order = new Map(items.map((i, n) => [keyOf(i.ref), n + 1]))

  const cell = (c: (typeof COLS)[number], item: CutupItem) => {
    const k = keyOf(item.ref)
    switch (c.id) {
      case 'n':
        return (
          <span className="cutup-row__n num">
            {reorderable && <Icon name="grip-vertical" size={12} className="cutup-row__grip" />}
            {k === current ? <Icon name="play" size={10} className="cutup-row__now" /> : order.get(k)}
          </span>
        )
      case 'game':
        return <span className="ellipsis">{gameCell(item, multiSeason)}</span>
      case 'clock':
        return <span className="cutup-row__clock">{clockCell(item)}</span>
      case 'situation':
        return <span className="ellipsis">{situationLabel(item)}</span>
      case 'play':
        return item.play ? (
          <span className="ellipsis" title={item.play.desc}>
            {shortDesc(item.play.desc)}
          </span>
        ) : (
          <span className="ellipsis c-label-3">
            Play {item.ref.playId} · {item.game.season} isn’t downloaded
          </span>
        )
      case 'grades':
        return <GradesCell item={item} focusPlayer={focusPlayer} />
      case 'epa':
        return item.play ? <span className="num">{formatEpa(item.teamEpa)}</span> : <span className="c-label-4">—</span>
      case 'tags':
        return <span className="ellipsis cutup-row__tags">{tagsOf(item).join(' · ')}</span>
      case 'markers':
        return (
          <span className="cutup-row__markers">
            {item.flagged && <Icon name="flag" size={12} className="cutup-row__flag" />}
            {hasNote(item) && <Icon name="message-square-text" size={12} className="c-label-3" />}
          </span>
        )
      case 'length': {
        const len = itemLength(item, startOpts)
        return len === null ? <span className="cutup-row__nofilm">No film</span> : <span className="num">{durationLabel(len)}</span>
      }
    }
  }

  return (
    <div className="table table--regular table--stripes cutup-table" role="grid" aria-multiselectable style={{ '--table-columns': template, '--table-sticky-top': '0px' } as React.CSSProperties}>
      <div className="table__header" role="row">
        {cols.map((c) => {
          const sorted = c.id !== 'n' && sort?.column === c.id
          return (
            <div
              key={c.id}
              role="columnheader"
              className={`table__th table__th--sortable${c.align === 'right' ? ' table__cell--right' : ''}`}
              aria-sort={sorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              title={c.id === 'n' ? 'Cut-up order' : undefined}
              onClick={() => {
                if (c.id === 'n') return onSort(null)
                const col = c.id as CutupSortColumn
                onSort({ column: col, dir: sorted ? (sort!.dir === 'asc' ? 'desc' : 'asc') : col === 'epa' || col === 'grades' ? 'desc' : 'asc' })
              }}
            >
              <span>{c.label}</span>
              {sorted && <Icon name={sort!.dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={10} />}
            </div>
          )
        })}
      </div>
      {items.map((item, n) => {
        const k = keyOf(item.ref)
        const isSel = selected.includes(k)
        return (
          <div
            key={k}
            role="row"
            className="table__row cutup-row"
            data-row-key={k}
            data-stripe={n % 2 === 1 || undefined}
            data-nofilm={!item.clips.length || undefined}
            data-current={k === current || undefined}
            data-drop={drop?.key === k ? (drop.after ? 'after' : 'before') : undefined}
            aria-selected={isSel}
            data-test="cutup-row"
            draggable
            title={!reorderable && manual ? undefined : undefined}
            onMouseDown={(e) => e.button === 0 && e.preventDefault()}
            onClick={(e) => onClick(item, e)}
            onContextMenu={(e) => {
              e.preventDefault()
              onMenu(item, e)
            }}
            onDragStart={(e) => {
              const keys = isSel ? selected : [k]
              const refs = items.filter((i) => keys.includes(keyOf(i.ref))).map((i) => i.ref)
              e.dataTransfer.setData(PLAY_DRAG_TYPE, JSON.stringify(refs))
              e.dataTransfer.effectAllowed = 'copyMove'
              dragKeys.current = reorderable ? keys : null
            }}
            onDragEnd={() => {
              dragKeys.current = null
              setDrop(null)
            }}
            onDragOver={(e) => {
              if (!dragKeys.current) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              const after = e.clientY > r.top + r.height / 2
              if (drop?.key !== k || drop.after !== after) setDrop({ key: k, after })
            }}
            onDragLeave={() => drop?.key === k && setDrop(null)}
            onDrop={(e) => {
              if (!dragKeys.current) return
              e.preventDefault()
              const keys = dragKeys.current
              dragKeys.current = null
              setDrop(null)
              onMove(keys, k, drop?.after ?? false)
            }}
          >
            {cols.map((c) => (
              <div key={c.id} role="gridcell" className={`table__cell${c.align === 'right' ? ' table__cell--right' : ''}`}>
                {cell(c, item)}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Inspector ──────────────────────────────────────────────────────────────

function CutupInspector({ detail, item, selectedRefs, focusPlayer, onRemove }: { detail: CutupDetail; item: CutupItem | null; selectedRefs: PlayRef[]; focusPlayer: string | null; onRemove: (refs: PlayRef[]) => void }) {
  const manual = detail.cutup.kind === 'manual'
  const anchor = useRef<HTMLDivElement>(null)
  if (selectedRefs.length > 1) {
    return (
      <Inspector title="Play">
        <div className="cutup-inspector__multi" ref={anchor}>
          <div className="cutup-inspector__multi-title">{selectedRefs.length} Plays Selected</div>
          <Button label="Add to Cut-up…" onClick={() => void requestAddToCutup(selectedRefs, anchor.current)} />
          {manual && <Button variant="destructive" label={`Remove ${selectedRefs.length} Plays`} onClick={() => onRemove(selectedRefs)} />}
        </div>
      </Inspector>
    )
  }
  if (!item) return <Inspector title="Play" />
  const p = item.play
  const entries = [...item.entries.filter((e) => e.grade !== null || e.tags.length || e.note)].sort((a, b) => (a.playerId === focusPlayer ? -1 : b.playerId === focusPlayer ? 1 : 0))
  const notes = [...(item.playNote ? [{ who: '', text: item.playNote }] : []), ...item.entries.filter((e) => e.note).map((e) => ({ who: e.name, text: e.note }))]
  const result = p ? [p.playType ? enumLabel(p.playType) : '', p.yardsGained !== null ? `${p.yardsGained} ${Math.abs(p.yardsGained) === 1 ? 'yard' : 'yards'}` : '', item.teamEpa !== null ? `EPA ${formatEpa(item.teamEpa)} for ${item.team}` : '', item.teamSuccess === null ? '' : item.teamSuccess ? 'Successful' : 'Unsuccessful'].filter(Boolean).join(' · ') : ''
  const lineup: [string, string][] = p
    ? (
        [
          ['Formation', p.formation ? enumLabel(p.formation) : ''],
          ['Offense', p.offPersonnel ? personnelLabel(p.offPersonnel) : ''],
          ['Defense', p.defPersonnel ? defPersonnelLabel(p.defPersonnel) : ''],
          ['Coverage', p.coverage ? enumLabel(p.coverage) : ''],
          ['Man or zone', p.manZone ? enumLabel(p.manZone) : ''],
          ['Pressure', p.wasPressure === null ? '' : p.wasPressure ? 'Pressured' : 'Not pressured'],
          ['Pass rushers', p.passRushers !== null ? String(p.passRushers) : ''],
          ['Box', p.defendersInBox !== null ? String(p.defendersInBox) : '']
        ] as [string, string][]
      ).filter(([, v]) => v)
    : []
  const matched = detail.cutup.kind === 'smart' && detail.cutup.rules?.match === 'any' ? matchedRuleLabels(detail, item, (f) => fieldDef(f as never, []).label) : null
  const openTape = () => navigate(links.tape(item.ref.gameId, item.team, { play: item.ref.playId, player: focusPlayer ?? undefined, focus: !!focusPlayer }))
  const clip = item.clips[0]
  return (
    <Inspector title="Play">
      <div className="cutup-inspector">
        <div className="cutup-inspector__play">
          <div className="cutup-inspector__caption">{playCaption(item.game, item.team, p)}</div>
          {p && <p className="cutup-inspector__desc selectable">{p.desc}</p>}
          {result && <div className="cutup-inspector__result">{result}</div>}
        </div>
        <InspectorSection id="grades" title="Grades">
          {entries.length ? (
            <div className="cutup-inspector__grades">
              {entries.map((e) => (
                <div key={e.playerId} className="cutup-inspector__grade" data-focus={e.playerId === focusPlayer || undefined}>
                  <span className="cutup-inspector__glyph">
                    <GradeGlyph grade={e.grade} />
                    {e.critical && <CriticalMark grade={e.grade} />}
                  </span>
                  <span className="cutup-inspector__who">
                    <a
                      href="#"
                      onClick={(ev) => {
                        ev.preventDefault()
                        navigate(links.player(item.game.season, e.playerId))
                      }}
                    >
                      {e.name}
                    </a>{' '}
                    <span className="c-label-3">{e.position}</span>
                    {e.tags.length > 0 && <span className="cutup-inspector__tags">{e.tags.join(' · ')}</span>}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="cutup-inspector__none">No grades on this play yet.</div>
          )}
        </InspectorSection>
        {notes.length > 0 && (
          <InspectorSection id="notes" title="Notes">
            <div className="cutup-inspector__notes selectable">
              {notes.map((n, i) => (
                <p key={i}>{n.who ? `${n.who}: ${n.text}` : n.text}</p>
              ))}
            </div>
            <Button variant="borderless" size="sm" label="Edit in Tape Room" onClick={openTape} />
          </InspectorSection>
        )}
        {lineup.length > 0 && (
          <InspectorSection id="lineup" title="Lineup">
            <dl className="cutup-inspector__lineup">
              {lineup.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </InspectorSection>
        )}
        <InspectorSection id="membership" title="In This Cut-up">
          {manual ? (
            <div className="cutup-inspector__member">
              {item.addedAt && <span>Added {new Date(item.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
              <Button variant="destructive" label="Remove from Cut-up" onClick={() => onRemove([item.ref])} />
            </div>
          ) : (
            <div className="cutup-inspector__member">
              <span>{matched ? (matched.length ? `Matches: ${matched.join(', ')}` : 'Matches the rules') : 'Matches every rule'}</span>
            </div>
          )}
        </InspectorSection>
        <div className="cutup-inspector__actions">
          <Button label="Open in Tape Room" onClick={openTape} test="cutup-open-tape" style={{ width: '100%' }} />
          <Button variant="borderless" label="Show Clip in Finder" disabled={!clip} onClick={() => clip && void rawApi.revealClip(clip.path)} />
        </div>
      </div>
    </Inspector>
  )
}

