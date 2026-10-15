import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DRAW_TOOLS } from '@shared/commands'
import type { Shape } from '@shared/drawing'
import type { FilterToken } from '@shared/playQuery'
import { clipStartTime } from '@shared/snap'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { Angle, ChartField, GameFilm, Grade, GradeEntry, Play, PlayNote, RosterPlayer, Settings, TagDef, TeamGame } from '@shared/types'
import { api } from '../../api'
import { quarterLabel } from '../../format'
import { banner, errorBanner } from '../../shell/Banners'
import { runCommand, useCommand, useDynamicMenus } from '../../shell/commands'
import { action, playerMenu, sep, showMenu, submenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { setImportContext } from '../../shell/importRequest'
import { useEscape } from '../../shell/keyRouter'
import { links, navigate, setEntrySelection, useRoute } from '../../shell/router'
import { Screen } from '../../shell/Screen'
import { saveSettings, useSettings } from '../../shell/store'
import { Toolbar } from '../../shell/Toolbar'
import { setUi, useUi } from '../../shell/uiState'
import { EmptyState } from '../../ui/EmptyState'
import { isTyping } from '../../ui/keyboard'
import type { MenuItemSpec } from '../../ui/Menu'
import { Segmented } from '../../ui/Segmented'
import { Spinner } from '../../ui/Spinner'
import { teamMarkFor } from '../../ui/teamMark'
import { SPEEDS, useVideoController } from '../../ui/video/engine'
import { quantize } from '../../ui/video/frameLength'
import { secondsLabel } from '../../ui/video/time'
import { viewerToast } from '../../ui/video/ViewerToast'
import { checkClipAlignment, openFixMatches } from '../import/fixMatches'
import { addToCutupMenu, requestAddToCutup, requestExportVideo, useExportVideoAvailable } from '../shared/requests'
import { SeasonDownload, useSeasonReady } from '../shared/SeasonGate'
import { AddPlayerPopover } from './Inspector/AddPlayerPopover'
import { FocusPicker } from './Inspector/FocusPicker'
import { TapeInspector } from './Inspector/TapeInspector'
import { fromSearchTokens, lineupOptions, matchPlay, toSearchToken } from './filters'
import { focusProgress, focusSnaps } from './focus'
import {
  emptyEntry,
  firstToGrade,
  gradeCounts,
  listedPlayers,
  playIsUngraded,
  playProgress,
  stubPlayer,
  tagsFor,
  withGrade,
  withOffField,
  withTag
} from './grading'
import {
  ANGLE_ORDER,
  angleTitle,
  type DrawStyle,
  type EndPanel,
  type FocusState,
  type GroupBy,
  type InspectorTab,
  type Layout,
  type PaneInfo,
  type Room,
  snapSeconds,
  titleFromGameId,
  type Tool,
  weekName
} from './model'
import { PlayBrowser } from './PlayBrowser'
import { readPref, usePref, writePref } from './prefs'
import { buildSuggestions, tokenMenu } from './searchMenus'
import { useUndoStack, type UndoTarget } from './undo'
import { useTapeData } from './useTapeData'
import { copyFrame, Viewer } from './Viewer'
import './tape-room.css'

/**
 * The tape room (02): watch and grade a game's film. `TapeRoom` loads the season, the film, tags and chart fields
 * and shows the whole-room states (§17); `Room` owns the state, registers every command (§15) and renders the play
 * browser, the viewer and the inspector.
 */
export function TapeRoom({ gameId, team, initialPlay }: { gameId: string; team: string; initialPlay: number | null }) {
  const season = Number(gameId.slice(0, 4)) || 0
  const ready = useSeasonReady(season)
  if (!ready) {
    return (
      <Shell gameId={gameId}>
        <div className="tape-room__state">
          <SeasonDownload season={season} />
        </div>
      </Shell>
    )
  }
  return <FilmLoader gameId={gameId} team={team} initialPlay={initialPlay} />
}

const TABS: InspectorTab[] = ['grade', 'notes', 'chart', 'info']

/** The room's frame before the film is in: the toolbar from the game id, empty panes (02 §3, §17). */
function Shell({ gameId, children, inspector }: { gameId: string; children: React.ReactNode; inspector?: React.ReactNode }) {
  const head = titleFromGameId(gameId)
  const [away, home] = head.title.split(' @ ')
  return (
    <Screen name="tape-room" scroll="none" takeover inspector={inspector ?? <div className="tape-inspector" />} inspectorWidth={340} inspectorMin={300}>
      <Toolbar
        title={head.title}
        subtitle={head.subtitle}
        separator="always"
        center={
          away && home ? (
            <div className="tape-study" data-disabled style={{ '--dot-0': teamMarkFor(away), '--dot-1': teamMarkFor(home) } as React.CSSProperties}>
              <Segmented size="toolbar" value={home} onChange={() => {}} label="Studying" options={[away, home].map((t) => ({ value: t, label: t }))} />
            </div>
          ) : undefined
        }
        trailing={[
          { kind: 'button', command: 'view.playList', icon: 'layout-list', priority: 1 },
          { kind: 'button', command: 'play.sideBySide', icon: 'columns-2', priority: 3 },
          { kind: 'button', command: 'draw.toggle', icon: 'pen-line', priority: 3 },
          { kind: 'button', command: 'grade.focus', icon: 'scan-eye', priority: 4 },
          { kind: 'pulldown', icon: 'ellipsis', label: 'More', items: [], test: 'tape-more' }
        ]}
        search={{ placeholder: 'Search plays', value: '', onChange: () => {}, test: 'play-search' }}
        inspector
      />
      {children}
    </Screen>
  )
}

function FilmLoader({ gameId, team, initialPlay }: { gameId: string; team: string; initialPlay: number | null }) {
  const [film, setFilm] = useState<GameFilm | null>(null)
  const [meta, setMeta] = useState<{ tags: TagDef[]; fields: ChartField[] } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const settings = useSettings()
  const seq = useRef(0)
  const load = useCallback(() => {
    const id = ++seq.current
    setError(null)
    Promise.all([api.gameFilm(gameId), api.tags(), api.chartFields()]).then(
      ([f, tags, fields]) => {
        if (id !== seq.current) return
        setFilm(f)
        setMeta({ tags, fields })
      },
      (e) => id === seq.current && setError(e)
    )
  }, [gameId])
  useEffect(load, [load])
  // Settings changed in the Settings window (tags, chart fields).
  useDataEvent('settings', () => {
    void Promise.all([api.tags(), api.chartFields()]).then(([tags, fields]) => setMeta({ tags, fields }))
  })

  if (error && !film) {
    return (
      <Shell gameId={gameId}>
        <div className="tape-room__state" data-test="tape-error">
          <EmptyState icon="circle-alert" title="Couldn’t load the film" body={String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')} selectableBody primary={{ label: 'Try Again', run: load }} />
        </div>
      </Shell>
    )
  }
  if (!film || !meta || !settings) {
    return (
      <Shell gameId={gameId}>
        <LoadingPanes />
      </Shell>
    )
  }
  if (!film.plays.length) {
    return (
      <Shell gameId={gameId}>
        <div className="tape-room__state" data-test="tape-no-plays">
          <EmptyState
            icon="calendar"
            title="This game hasn’t been played yet"
            body="Plays appear once nflverse publishes the play-by-play, usually the morning after the game."
            primary={{ label: `Update ${film.game.season} Season Data`, run: () => runCommand('file.updateData') }}
          />
        </div>
      </Shell>
    )
  }
  return <Room film={film} tags={meta.tags} chartFields={meta.fields} settings={settings} routeTeam={team} initialPlay={initialPlay} reload={load} />
}

/** Empty panes with a spinner in the viewer after 200ms (02 §17). */
function LoadingPanes() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="tape-room" data-test="tape-loading">
      <div className="tape-room__panes">
        <div className="play-browser" style={{ width: readPref('ui.tape.list.width', 300) }} />
        <div className="viewer viewer--loading">
          {show && (
            <div className="viewer__loading" role="status">
              <Spinner size={20} />
              <span>Loading film…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const DEFAULT_STYLE: DrawStyle = { color: '#FFD60A', width: 4, textSize: 24, penEnd: 'arrow', lineEnd: 'none', showFor: null }

function initialPlayId(film: GameFilm, team: string, requested: number | null): number | null {
  const { plays } = film
  if (requested !== null && plays.some((p) => p.playId === requested)) return requested
  const last = readPref<number | null>(`ui.tape.lastPlay.${film.game.gameId}.${team}`, null)
  if (last !== null && plays.some((p) => p.playId === last)) return last
  const withClip = new Set(film.clips.map((c) => c.playId))
  return plays.find((p) => withClip.has(p.playId))?.playId ?? plays[0]?.playId ?? null
}

function Room({
  film,
  tags,
  chartFields,
  settings,
  routeTeam,
  initialPlay,
  reload: reloadFilm
}: {
  film: GameFilm
  tags: TagDef[]
  chartFields: ChartField[]
  settings: Settings
  routeTeam: string
  initialPlay: number | null
  reload: () => void
}) {
  const { game, plays, players } = film
  const gameId = game.gameId
  const route = useRoute()
  const shellUi = useUi()
  const filmOnly = shellUi.filmOnly
  const rootRef = useRef<HTMLDivElement>(null)
  const undo = useUndoStack()

  // ── Studied team ──────────────────────────────────────────────────────────
  const [team, setTeamState] = useState(() => (routeTeam === game.homeTeam || routeTeam === game.awayTeam ? routeTeam : game.homeTeam))
  const opponent = team === game.homeTeam ? game.awayTeam : game.homeTeam

  // ── Current play, selection, focus ────────────────────────────────────────
  const [currentId, setCurrentId] = useState<number | null>(() => initialPlayId(film, team, initialPlay))
  const [sel, setSel] = useState<{ playId: number | null; team: string; id: string | null }>({ playId: null, team, id: null })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [multi, setMulti] = useState<Set<number>>(() => new Set())
  const [endPanel, setEndPanel] = useState<EndPanel | null>(null)

  // ── Preferences ───────────────────────────────────────────────────────────
  const [starredOnly, setStarredOnly] = usePref('ui.tape.starredOnly', false)
  const [tab, setTabPref] = usePref<InspectorTab>('ui.tape.inspectorTab', 'grade', { validate: (v) => TABS.includes(v) })
  const drivesAvailable = plays.some((p) => p.drive !== null)
  const [groupPref, setGroup] = usePref<GroupBy>('ui.tape.group', 'quarter', { validate: (v) => ['quarter', 'drive', 'none'].includes(v) })
  const group: GroupBy = groupPref === 'drive' && !drivesAvailable ? 'quarter' : groupPref
  const [listVisible, setListVisible] = usePref('ui.tape.list.visible', true)
  const [layoutPref, setLayout] = usePref<Layout>('ui.tape.layout', 'single', { validate: (v) => ['single', 'sideBySide', 'pip'].includes(v) })
  const [lastMulti, setLastMulti] = usePref<'sideBySide' | 'pip'>('ui.tape.lastMulti', 'sideBySide')
  const [anglePref, setAnglePref] = usePref<Angle | null>('ui.tape.angle', null)
  const [secondPref, setSecondPref] = usePref<Angle | null>('ui.tape.secondAngle', null)
  const [loop, setLoop] = usePref('ui.tape.loop', true)
  const [sound, setSound] = usePref('ui.tape.sound', false)
  const [timeMode, setTimeMode] = usePref<'snap' | 'clip'>('ui.tape.timeMode', 'snap')
  const [speed, setSpeed] = useState(() => (SPEEDS as readonly number[]).includes(settings.defaultSpeed) ? settings.defaultSpeed : 1)
  const [hideControls, setHideControls] = useState(false)
  const [activeAngle, setActiveAngle] = useState<Angle | null>(null)

  // Drawing.
  const [drawMode, setDrawMode] = useState(false)
  const [tool, setToolPref] = usePref<Tool>('ui.draw.tool', 'pen', { validate: (v) => (DRAW_TOOLS as readonly string[]).includes(v) })
  const [color, setColor] = usePref('ui.draw.color', DEFAULT_STYLE.color)
  const [width, setWidth] = usePref<2 | 4 | 6>('ui.draw.width', 4)
  const [textSize, setTextSize] = usePref<18 | 24 | 32>('ui.draw.textSize', 24)
  const [penEnd, setPenEnd] = usePref<'none' | 'arrow'>('ui.draw.end.pen', 'arrow')
  const [lineEnd, setLineEnd] = usePref<DrawStyle['lineEnd']>('ui.draw.end.line', 'none')
  const [showFor, setShowFor] = usePref<DrawStyle['showFor']>('ui.draw.showFor', null)
  const [selectedShape, setSelectedShape] = useState<string | null>(null)
  const style: DrawStyle = { color, width, textSize, penEnd, lineEnd, showFor }

  // Filters: per game and team for this launch (02 §4.3).
  const filterKey = `ui.tape.filters.${gameId}.${team}`
  const [filters, setFilters] = useState(() => readPref<{ tokens: FilterToken[]; text: string }>(filterKey, { tokens: [], text: '' }, 'session'))
  const filtersFor = useRef(filterKey)
  if (filtersFor.current !== filterKey) {
    filtersFor.current = filterKey
    const next = readPref<{ tokens: FilterToken[]; text: string }>(filterKey, { tokens: [], text: '' }, 'session')
    if (JSON.stringify(next) !== JSON.stringify(filters)) setFilters(next)
  }
  const setTokens = (tokens: FilterToken[]) => {
    const next = { ...filters, tokens }
    setFilters(next)
    writePref(filterKey, next, 'session')
  }
  const setText = (text: string) => {
    const next = { ...filters, text }
    setFilters(next)
    writePref(filterKey, next, 'session')
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  const revealRef = useRef<(t: UndoTarget) => void>(() => {})
  const data = useTapeData(film, undo, (t) => revealRef.current(t))
  // A reload replaces the room's notes with the database's: drawing edits still waiting to save go first.
  const reload = () => {
    data.flushNotes()
    reloadFilm()
  }
  useDataEvent('film', () => {
    if (!data.consumeOwnFilmEvent()) reload()
  })
  const clipsByPlay = useMemo(() => {
    const m = new Map<number, typeof data.clips>()
    for (const c of data.clips) if (c.playId !== null) m.set(c.playId, [...(m.get(c.playId) ?? []), c])
    return m
  }, [data.clips])
  const gameAngles = useMemo(() => ANGLE_ORDER.filter((a) => data.clips.some((c) => c.angle === a)), [data.clips])
  const hasFilm = data.clips.length > 0
  const pinned = useMemo(() => settings.pinned[team] ?? [], [settings.pinned, team])
  const lineup = useMemo(() => lineupOptions(plays, team), [plays, team])

  // Alignment check results (improvement 14): the list's warning marker.
  const [alignment, setAlignment] = useState<Map<number, string>>(() => new Map())
  useEffect(() => {
    let live = true
    void api.alignment(gameId).then(
      (r) => live && r && setAlignment(new Map(r.suspects.map((s) => [s.playId, s.message] as [number, string]))),
      () => {}
    )
    return () => {
      live = false
    }
  }, [gameId, data.clips])

  const entriesByPlay = useMemo(() => {
    const m = new Map<number, GradeEntry[]>()
    for (const e of data.grades.values()) m.set(e.playId, [...(m.get(e.playId) ?? []), e])
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.version])
  const teamEntries = useCallback((playId: number) => (entriesByPlay.get(playId) ?? []).filter((e) => e.team === team), [entriesByPlay, team])
  const entryOf = data.entryOf

  const listedMap = useMemo(() => {
    const m = new Map<number, RosterPlayer[]>()
    for (const p of plays) m.set(p.playId, listedPlayers(p, team, pinned, starredOnly, entriesByPlay.get(p.playId) ?? [], players))
    return m
  }, [plays, team, pinned, starredOnly, entriesByPlay, players])
  const listedFor = useCallback((p: Play) => listedMap.get(p.playId) ?? [], [listedMap])
  const progressOf = useCallback((p: Play) => playProgress(listedFor(p), (id) => entryOf(p.playId, id)), [listedFor, entryOf])
  const playGradeCounts = useCallback((p: Play) => {
    const es = teamEntries(p.playId)
    return { ...gradeCounts(es), graded: es.filter((e) => e.grade !== null).length }
  }, [teamEntries])
  const gradedPlays = useMemo(() => plays.filter((p) => teamEntries(p.playId).some((e) => e.grade !== null)).length, [plays, teamEntries])

  // ── Player Focus ──────────────────────────────────────────────────────────
  const allEntries = useMemo(() => [...data.grades.values()], [data.grades, data.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const focus: FocusState | null = useMemo(() => {
    if (!focusId) return null
    const player = players[focusId] ?? stubPlayer(focusId, team)
    const snaps = focusSnaps(player, team, plays, allEntries, film.hasParticipation)
    return { player, snaps, snapIds: new Set(snaps.map((p) => p.playId)), progress: focusProgress(player.id, snaps, allEntries) }
  }, [focusId, players, team, plays, allEntries, film.hasParticipation])

  // ── The list ──────────────────────────────────────────────────────────────
  const baseList = focus ? focus.snaps : plays
  const visible = useMemo(
    () =>
      baseList.filter((p) =>
        matchPlay(p, filters.tokens, filters.text, {
          game,
          team,
          entries: entriesByPlay.get(p.playId) ?? [],
          note: data.notes.get(p.playId) ?? null,
          player: focus?.player.id
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseList, filters, game, team, entriesByPlay, data.version, focus?.player.id]
  )

  // ── Current play ──────────────────────────────────────────────────────────
  const current = plays.find((p) => p.playId === currentId) ?? null
  const currentNote = current ? data.noteOf(current.playId) : null
  const currentClips = useMemo(() => (current ? (clipsByPlay.get(current.playId) ?? []) : []), [current, clipsByPlay])
  const listed = current ? listedFor(current) : []
  const defaultSel = current ? firstToGrade(listed, (id) => entryOf(current.playId, id)) : null
  let selectedId = sel.playId === currentId && sel.team === team ? sel.id : defaultSel
  if (selectedId && !listed.some((p) => p.id === selectedId)) selectedId = listed[0]?.id ?? null
  const selected = listed.find((p) => p.id === selectedId) ?? null
  useEffect(() => {
    if (sel.playId !== currentId || sel.team !== team) setSel({ playId: currentId, team, id: defaultSel })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, team])
  const onFocusSnap = !!focus && !!current && focus.snapIds.has(current.playId)
  const target = focus ? (onFocusSnap ? focus.player : null) : selected
  const targetEntry = target && current ? entryOf(current.playId, target.id) : undefined

  // ── Angles and layout (02 §8) ─────────────────────────────────────────────
  const twoAngles = gameAngles.length >= 2
  const layout: Layout = twoAngles ? layoutPref : 'single'
  const primary: Angle = anglePref && gameAngles.includes(anglePref) ? anglePref : (gameAngles[0] ?? 'sideline')
  const second: Angle = secondPref && gameAngles.includes(secondPref) && secondPref !== primary ? secondPref : (gameAngles.find((a) => a !== primary) ?? primary)
  const playAngles = ANGLE_ORDER.filter((a) => currentClips.some((c) => c.angle === a))
  const clipOf = (a: Angle) => currentClips.find((c) => c.angle === a) ?? null
  const shown: Angle = playAngles.includes(primary) ? primary : (playAngles[0] ?? primary)
  const twoPane = layout !== 'single' && currentClips.length > 0
  const panes: PaneInfo[] = twoPane
    ? [
        { angle: primary, clip: clipOf(primary) },
        { angle: second, clip: clipOf(second) }
      ]
    : [{ angle: shown, clip: clipOf(shown) }]
  let active: Angle | null = panes[0]?.angle ?? null
  if (layout === 'sideBySide' && twoPane && activeAngle && panes.some((p) => p.angle === activeAngle && p.clip)) active = activeAngle
  if (twoPane && !panes.find((p) => p.angle === active)?.clip) active = panes.find((p) => p.clip)?.angle ?? active
  const activeClip = active ? clipOf(active) : null

  // ── Video ─────────────────────────────────────────────────────────────────
  const preload = useMemo(() => {
    const i = visible.findIndex((p) => p.playId === currentId)
    const near = [visible[i + 1], visible[i - 1]].filter(Boolean) as Play[]
    const out = []
    for (const p of near) {
      const cs = clipsByPlay.get(p.playId) ?? []
      for (const a of twoPane ? [primary, second] : [shown]) {
        const c = cs.find((x) => x.angle === a) ?? (twoPane ? null : cs[0])
        if (c) out.push(c)
      }
    }
    return out.slice(0, 4)
  }, [visible, currentId, clipsByPlay, twoPane, primary, second, shown])
  const video = useVideoController({
    panes: panes.map((p) => ({ id: p.angle, clip: p.clip })),
    active,
    startAtSnap: settings.startAtSnap,
    preRoll: settings.preRoll,
    speed,
    loop,
    sound,
    autoplay: !drawMode,
    preload
  })
  const [vstate, setVstate] = useState(() => ({ playing: false, ready: false, clock: null as string | null }))
  useEffect(
    () =>
      video.engine.subscribe(() => {
        const s = video.engine.getState()
        setVstate((v) => (v.playing === s.playing && v.ready === s.ready && v.clock === s.clock ? v : { playing: s.playing, ready: s.ready, clock: s.clock }))
      }),
    [video]
  )
  const playable = !!vstate.clock && panes.some((p) => p.clip)
  const activePlayable = !!activeClip && !video.engine.getState().panes[active ?? '']?.error

  // Keep the display awake while film plays (02 §5.10).
  useEffect(() => {
    window.shell?.setPlaybackActive(vstate.playing)
  }, [vstate.playing])
  useEffect(() => () => window.shell?.setPlaybackActive(false), [])

  // ── Navigation ────────────────────────────────────────────────────────────
  const refocus = useCallback(() => rootRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => refocus(), [refocus])

  const blurFields = () => {
    const a = document.activeElement
    if (a instanceof HTMLElement && isTyping(a) && (a.closest('.screen-tape-room') || a.closest('#inspector-slot'))) a.blur()
  }

  const goTo = useCallback(
    (playId: number, opts: { mouse?: boolean; keepMulti?: boolean } = {}) => {
      blurFields()
      data.flushNotes()
      setEndPanel(null)
      setSelectedShape(null)
      if (!opts.keepMulti) setMulti(new Set())
      setCurrentId(playId)
      if (opts.mouse) refocus()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.flushNotes, refocus]
  )

  const showEnd = useCallback(() => {
    video.pause()
    if (focus) {
      if (focus.progress.graded < focus.progress.total) setEndPanel({ kind: 'focusLast' })
      else setEndPanel({ kind: 'focusDone', nextGame: null })
      return
    }
    const anyUngraded = visible.some((p) => playIsUngraded(listedFor(p), (id) => entryOf(p.playId, id)))
    setEndPanel({ kind: anyUngraded ? 'lastUngraded' : 'allGraded' })
  }, [video, focus, visible, listedFor, entryOf])

  /** ↑/↓ in the filtered list; v1's `go()` when the current play was filtered out (02 §13.1). */
  const step = (delta: number) => {
    if (!visible.length) return
    const i = visible.findIndex((p) => p.playId === currentId)
    let next: Play | undefined
    if (i !== -1) next = visible[i + delta]
    else {
      const pi = plays.findIndex((p) => p.playId === currentId)
      const before = visible.filter((p) => plays.indexOf(p) < pi).length
      next = pi === -1 ? visible[0] : visible[delta > 0 ? before + delta - 1 : before + delta]
    }
    if (!next) {
      if (delta < 0) window.shell?.beep()
      else showEnd()
      return
    }
    goTo(next.playId)
  }

  const isUngraded = (p: Play) =>
    focus
      ? (() => {
          const e = entryOf(p.playId, focus.player.id)
          return !e || (e.grade === null && !e.offField)
        })()
      : playIsUngraded(listedFor(p), (id) => entryOf(p.playId, id))
  const stepUngraded = (dir: 1 | -1) => {
    if (!visible.length) return
    const start = Math.max(-1, visible.findIndex((p) => p.playId === currentId))
    for (let k = 1; k <= visible.length; k++) {
      const p = visible[(((start + dir * k) % visible.length) + visible.length) % visible.length]
      if (p.playId !== currentId && isUngraded(p)) return goTo(p.playId)
    }
    if (dir > 0) showEnd()
    else window.shell?.beep()
  }
  const anyUngradedInList = useMemo(() => visible.some((p) => isUngraded(p)), [visible, listedMap, data.version, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Route and history ─────────────────────────────────────────────────────
  useEffect(() => {
    const url = links.tape(gameId, team, {
      play: currentId ?? undefined,
      player: focus?.player.id,
      focus: !!focus,
      angles: layout !== 'single' ? 'both' : undefined
    })
    if (`/${route.path.join('/')}?${route.query.toString()}` !== url) navigate(url, { replace: true })
    if (currentId !== null) {
      writePref(`ui.tape.lastPlay.${gameId}.${team}`, currentId)
      setEntrySelection(String(currentId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, team, currentId, focus?.player.id, layout])

  // Back/Forward between entries of the same game: follow the route.
  useEffect(() => {
    const qTeam = route.query.get('team')
    const qPlay = route.query.get('play')
    if (qTeam && qTeam !== team && (qTeam === game.homeTeam || qTeam === game.awayTeam)) setTeamState(qTeam)
    if (qPlay && Number(qPlay) !== currentId && plays.some((p) => p.playId === Number(qPlay))) setCurrentId(Number(qPlay))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  // Opened with ?player=&focus=1 or ?angles=both.
  useEffect(() => {
    const pid = route.query.get('player')
    if (pid && route.query.get('focus') === '1') {
      const known = players[pid] || plays.some((p) => p.offensePlayers.includes(pid) || p.defensePlayers.includes(pid) || p.involved.includes(pid))
      if (known) enterFocus(pid)
      else banner({ title: players[pid] ? `${players[pid].name} isn’t in this game` : 'This player isn’t in this game' })
    }
    if (route.query.get('angles') === 'both' && twoAngles && layoutPref === 'single') setLayout(lastMulti)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recorded as opened (clears the sidebar Film badge); the drop target and File › Import Film use this game.
  useEffect(() => {
    if (hasFilm) void api.openedFilm(gameId, team).catch(() => {})
  }, [gameId, team, hasFilm])
  useEffect(() => {
    setImportContext({ game, team })
    return () => setImportContext(null)
  }, [game, team])

  // The studied team's games with film, for the title menu.
  const [teamGames, setTeamGames] = useState<TeamGame[]>([])
  useEffect(() => {
    let live = true
    void api.teamOverview(game.season, team).then(
      (o) => live && setTeamGames(o.games.filter((g) => g.clipCount > 0)),
      () => {}
    )
    return () => {
      live = false
    }
  }, [game.season, team, gradedPlays])

  // ── Grading actions (02 §7) ───────────────────────────────────────────────
  const entryFor = (playId: number, playerId: string) => entryOf(playId, playerId) ?? emptyEntry(gameId, playId, playerId, team)
  const select = (playerId: string) => setSel({ playId: currentId, team, id: playerId })

  revealRef.current = (t) => {
    if (t.playId !== currentId) goTo(t.playId)
    if (t.playerId) setSel({ playId: t.playId, team, id: t.playerId })
    if (t.angle && layout === 'sideBySide') setActiveAngle(t.angle as Angle)
  }

  const typingInRoom = () => {
    const a = document.activeElement
    return a instanceof HTMLElement && isTyping(a) && !!(a.closest('.screen-tape-room') || a.closest('#inspector-slot'))
  }
  const autoAdvance = () => {
    if (settings.autoAdvance && !typingInRoom()) step(1)
  }
  /** After a grade by key: the next listed player (skipping Not on Field); after the last, Auto-Advance. */
  const advanceFrom = (playerId: string) => {
    if (!current) return
    const i = listed.findIndex((p) => p.id === playerId)
    for (let j = i + 1; j < listed.length; j++) {
      const e = entryOf(current.playId, listed[j].id)
      if (!e?.offField) return select(listed[j].id)
    }
    autoAdvance()
  }

  const grade = (playerId: string, g: Grade, opts: { advance?: boolean; toggle?: boolean } = {}) => {
    if (!current) return
    const e = entryFor(current.playId, playerId)
    const next = opts.toggle && e.grade === g ? withGrade(e, null) : withGrade(e, g)
    if (!focus) select(playerId)
    data.changeEntries([next], { label: 'Grade', target: { playId: current.playId, playerId } })
    if (!opts.advance) return
    if (focus) step(1)
    else advanceFrom(playerId)
  }
  const clearGrade = (playerId: string) => {
    if (!current) return
    data.changeEntries([withGrade(entryFor(current.playId, playerId), null)], { label: 'Clear Grade', target: { playId: current.playId, playerId } })
  }
  const toggleCritical = (playerId: string) => {
    if (!current) return
    const e = entryFor(current.playId, playerId)
    data.changeEntries([{ ...e, critical: !e.critical, offField: e.critical ? e.offField : false }], { label: 'Critical', target: { playId: current.playId, playerId } })
  }
  const toggleOffField = (playerId: string, byKey = false) => {
    if (!current) return
    const e = entryFor(current.playId, playerId)
    const on = !e.offField
    data.changeEntries([withOffField(e, on)], { label: 'Not on Field', target: { playId: current.playId, playerId } })
    if (on && byKey) {
      if (focus) step(1)
      else advanceFrom(playerId)
    }
  }
  const toggleTag = (playerId: string, tag: TagDef) => {
    if (!current) return
    data.changeEntries([withTag(entryFor(current.playId, playerId), tag)], { label: 'Tag', target: { playId: current.playId, playerId } })
  }
  const setPinned = (list: string[]) => void saveSettings({ pinned: { ...settings.pinned, [team]: list } }).catch((e) => errorBanner('Couldn’t save the star', e))
  const toggleStar = (playerId: string) => {
    const was = pinned.includes(playerId)
    const before = pinned
    const after = was ? pinned.filter((x) => x !== playerId) : [...pinned, playerId]
    setPinned(after)
    undo.push({ label: 'Star', undo: () => setPinned(before), redo: () => setPinned(after) })
  }
  const savePlayerNote = (playerId: string, text: string) => {
    if (!current) return
    data.changeEntries([{ ...entryFor(current.playId, playerId), note: text }])
  }
  const fillZeros = () => {
    if (!current) return
    const next = listed
      .map((p) => entryFor(current.playId, p.id))
      .filter((e) => e.grade === null && !e.offField)
      .map((e) => withGrade(e, 0))
    if (next.length) data.changeEntries(next, { label: 'Grade Everyone Left 0', target: { playId: current.playId } })
    autoAdvance()
  }
  const clearPlay = () => {
    if (!current) return
    const next = teamEntries(current.playId)
      .filter((e) => e.grade !== null || e.critical || e.offField)
      .map((e) => ({ ...e, grade: null, critical: false, offField: false }))
    if (next.length) data.changeEntries(next, { label: 'Clear Grades', target: { playId: current.playId } })
  }
  const toggleFlag = (playIds?: number[]) => {
    const ids = playIds ?? (current ? [current.playId] : [])
    if (!ids.length) return
    const on = !data.noteOf(ids[0]).flagged
    for (const id of ids) {
      const was = data.noteOf(id).flagged
      data.changeNote(id, (n) => ({ ...n, flagged: on }), { kind: 'flag', label: 'Flag', target: { playId: id }, inverse: (n) => ({ ...n, flagged: was }) })
    }
  }
  const savePlayNote = (text: string) => {
    if (!current) return
    data.changeNote(current.playId, (n) => ({ ...n, note: text }), { kind: 'note' })
  }
  const setChart = (field: string, value: string) => {
    if (!current) return
    const was = data.noteOf(current.playId).chart[field] ?? ''
    const set = (v: string) => (n: PlayNote) => {
      const chart = { ...n.chart }
      if (v) chart[field] = v
      else delete chart[field]
      return { ...n, chart }
    }
    data.changeNote(current.playId, set(value), { kind: 'chart', label: 'Chart Field', target: { playId: current.playId }, inverse: set(was) })
  }

  // ── Player Focus (02 §9) ──────────────────────────────────────────────────
  const [picker, setPicker] = useState<HTMLElement | null>(null)
  const pickerAnchor = useRef<HTMLElement | null>(null)
  const [addPlayer, setAddPlayer] = useState<HTMLElement | null>(null)
  const addAnchor = useRef<HTMLElement | null>(null)

  function enterFocus(playerId: string) {
    const p = players[playerId]
    const ownTeam = p && (p.team === game.homeTeam || p.team === game.awayTeam) ? p.team : team
    const player = p ?? stubPlayer(playerId, ownTeam)
    const snaps = focusSnaps(player, ownTeam, plays, [...data.grades.values()], film.hasParticipation)
    if (ownTeam !== team) setTeamState(ownTeam)
    setFocusId(playerId)
    setPicker(null)
    setTabPref('grade')
    if (!snaps.some((s) => s.playId === currentId) && snaps.length) {
      const first = snaps.find((s) => {
        const e = entryOf(s.playId, playerId)
        return !e || (e.grade === null && !e.offField)
      })
      goTo((first ?? snaps[0]).playId)
    }
    refocus()
  }
  const exitFocus = () => {
    if (!focus) return
    const id = focus.player.id
    setFocusId(null)
    if (current && listed.some((p) => p.id === id)) setSel({ playId: current.playId, team, id })
  }
  const openFocusPicker = (anchor?: HTMLElement | null) => {
    pickerAnchor.current = anchor ?? document.querySelector<HTMLElement>('[data-test="toolbar-focus"]') ?? rootRef.current
    setPicker(pickerAnchor.current)
  }
  const openAddPlayer = (anchor: HTMLElement | null) => {
    addAnchor.current = anchor ?? document.querySelector<HTMLElement>('[data-test="grade-header"]')
    setAddPlayer(addAnchor.current)
  }

  // ── Studied team switch (02 §3) ───────────────────────────────────────────
  const switchTeam = (t: string) => {
    if (t === team) return
    setFocusId(null)
    setSelectedShape(null)
    setTeamState(t)
    refocus()
  }

  // ── Fix Clip Matches (02 §18) ─────────────────────────────────────────────
  const fixMatches = (focusPlayId?: number) =>
    void openFixMatches({
      game,
      team,
      existing: data.clips.length
        ? data.clips.map((c) => ({ clipId: c.id, path: c.path, fileName: c.fileName, angle: c.angle, playId: c.playId, snapMs: c.snapMs }))
        : undefined,
      focusPlayId,
      onImported: () => {
        reload()
        banner({ title: 'Film updated', kind: 'success' })
      }
    })
  /** More › Check Clip Alignment (File › Check Clip Alignment is the shell's, through the import context). */
  const checkAlignment = () =>
    void checkClipAlignment(game, team, reload).then(() =>
      api.alignment(gameId).then(
        (r) => r && setAlignment(new Map(r.suspects.map((s) => [s.playId, s.message] as [number, string]))),
        () => {}
      )
    )

  // ── Snap points (02 §10) ──────────────────────────────────────────────────
  const paneFrame = (a: Angle) => video.engine.getState().panes[a]?.frame ?? 1 / 30
  const paneTime = (a: Angle) => video.engine.getState().panes[a]?.time ?? 0
  const setSnapHere = () => {
    if (!active || !activeClip || !current) return
    const f = paneFrame(active)
    const t = quantize(paneTime(active), f)
    video.engine.seekPane(active, t)
    data.setSnap(activeClip.id, Math.round(t * 1000), { label: 'Set Snap', target: { playId: current.playId, angle: active } })
    viewerToast(`Snap Set at ${secondsLabel(t)}`)
  }
  const nudgeSnap = (dir: 1 | -1) => {
    if (!active || !activeClip || !current) return
    const f = paneFrame(active)
    const base = activeClip.snapMs !== null ? activeClip.snapMs / 1000 : quantize(paneTime(active), f)
    const dur = video.engine.getState().panes[active]?.duration ?? Infinity
    const t = Math.max(f / 2, Math.min(quantize(base, f) + dir * f, dur - f / 2))
    video.engine.seekPane(active, t)
    data.setSnap(activeClip.id, Math.round(t * 1000), { label: 'Set Snap', target: { playId: current.playId, angle: active }, mergeKey: `nudge:${activeClip.id}` })
    viewerToast(`Snap at ${secondsLabel(t)}`)
  }
  const clearSnap = () => {
    if (!activeClip || !current) return
    data.setSnap(activeClip.id, null, { label: 'Clear Snap', target: { playId: current.playId, angle: active ?? undefined } })
    viewerToast('Snap Cleared')
  }
  const goToSnap = () => {
    if (!active || !activeClip || activeClip.snapMs === null) return
    video.pause()
    video.engine.seekPane(active, activeClip.snapMs / 1000)
  }

  // ── Angles (02 §8.2) ──────────────────────────────────────────────────────
  const nextAngle = () => {
    if (layout === 'sideBySide' && twoPane) {
      const other = panes.find((p) => p.angle !== active && p.clip)
      if (other) {
        setActiveAngle(other.angle)
        viewerToast(`${angleTitle(other.angle)} Active`)
      }
      return
    }
    if (layout === 'pip' && twoPane) return swapAngles()
    if (playAngles.length < 2) return
    const next = playAngles[(playAngles.indexOf(shown) + 1) % playAngles.length]
    setAnglePref(next)
    if (next === second) setSecondPref(primary)
    viewerToast(angleTitle(next))
  }
  const swapAngles = () => {
    setAnglePref(second)
    setSecondPref(primary)
    setActiveAngle(second)
  }
  const toggleSideBySide = () => {
    if (!twoAngles) return
    const next: Layout = layout === 'single' ? lastMulti : 'single'
    setLayout(next)
    setActiveAngle(primary)
    viewerToast(next === 'single' ? 'Single Angle' : next === 'pip' ? 'Picture in Picture' : 'Side by Side')
  }
  const togglePip = () => {
    if (!twoAngles) return
    if (layout === 'pip') setLayout('single')
    else {
      setLayout('pip')
      setLastMulti('pip')
    }
  }
  const chooseAngle = (a: Angle) => {
    if (layout !== 'single' && a === second) return swapAngles()
    setAnglePref(a)
    if (a === second) setSecondPref(primary)
  }
  const chooseLayout = (l: Layout) => {
    if (l !== 'single') setLastMulti(l)
    setLayout(l)
  }
  const setActive = (a: Angle) => {
    if (layout === 'sideBySide') setActiveAngle(a)
  }

  // ── Drawing (02 §11) ──────────────────────────────────────────────────────
  const shapesOf = (a: Angle): Shape[] => currentNote?.drawing[a] ?? []
  const activeShapes = active ? shapesOf(active) : []
  const setShapes = (a: Angle, shapes: Shape[], opts: { label?: string; prev?: Shape[] } = {}) => {
    if (!current) return
    const prev = opts.prev ?? shapesOf(a)
    data.changeNote(current.playId, (n) => ({ ...n, drawing: { ...n.drawing, [a]: shapes } }), {
      kind: 'drawing',
      debounce: true,
      label: opts.label,
      target: { playId: current.playId, angle: a },
      inverse: (n) => ({ ...n, drawing: { ...n.drawing, [a]: prev } })
    })
  }
  const toggleDraw = () => {
    if (!drawMode) {
      video.pause()
      setDrawMode(true)
    } else {
      setDrawMode(false)
      setSelectedShape(null)
    }
  }
  const setStyle = (patch: Partial<DrawStyle>) => {
    if (patch.color !== undefined) setColor(patch.color)
    if (patch.width !== undefined) setWidth(patch.width)
    if (patch.textSize !== undefined) setTextSize(patch.textSize)
    if (patch.penEnd !== undefined) setPenEnd(patch.penEnd)
    if (patch.lineEnd !== undefined) setLineEnd(patch.lineEnd)
    if (patch.showFor !== undefined) setShowFor(patch.showFor)
  }
  const selShape = activeShapes.find((s) => s.id === selectedShape) ?? null
  const deleteShape = () => {
    if (!active || !selShape) return
    setShapes(active, activeShapes.filter((s) => s.id !== selShape.id), { label: 'Delete Drawing' })
    setSelectedShape(null)
  }
  const arrange = (front: boolean) => {
    if (!active || !selShape) return
    const rest = activeShapes.filter((s) => s.id !== selShape.id)
    setShapes(active, front ? [...rest, selShape] : [selShape, ...rest], { label: 'Arrange Drawing' })
  }
  const duplicateShape = () => {
    if (!active || !selShape) return
    const copy = offsetShape({ ...selShape, id: crypto.randomUUID().slice(0, 8) } as Shape, 0.02)
    setShapes(active, [...activeShapes, copy], { label: 'Duplicate Drawing' })
    setSelectedShape(copy.id)
  }

  // ── Inspector tabs ────────────────────────────────────────────────────────
  const setTab = (t: InspectorTab) => setTabPref(t)
  const toGrade = () => tab !== 'grade' && setTab('grade')

  // ── Context menus (02 §16.1, §16.2) ───────────────────────────────────────
  const playMenu = (e: React.MouseEvent, play: Play) => {
    const inMulti = multi.has(play.playId) || play.playId === currentId
    const ids = inMulti ? [...new Set([...(currentId !== null ? [currentId] : []), ...multi])] : [play.playId]
    if (!inMulti) setMulti(new Set())
    const ordered = plays.filter((p) => ids.includes(p.playId))
    const flagged = data.noteOf(play.playId).flagged
    const clips = clipsByPlay.get(play.playId) ?? []
    const refs = ordered.map((p) => ({ gameId, playId: p.playId }))
    e.preventDefault()
    void addToCutupMenu(refs).then((cutupItems) => {
      void showMenu(null, [
        action(flagged ? 'Unflag Play' : 'Flag Play', () => toggleFlag(ordered.map((p) => p.playId)), { accelerator: 'F' }),
        submenu('Add to Cut-up', cutupItems),
        sep(),
        action('Copy Description', () => void navigator.clipboard.writeText(ordered.map((p) => p.desc).join('\n'))),
        clips.length > 1
          ? submenu(
              'Show Clip in Finder',
              clips.map((c) => action(angleTitle(c.angle), () => void api.revealClip(c.path)))
            )
          : action('Show Clip in Finder', () => clips[0] && void api.revealClip(clips[0].path), { enabled: clips.length === 1 && ordered.length === 1 }),
        sep(),
        action('Fix Clip Match…', () => fixMatches(play.playId), { enabled: ordered.length === 1 })
      ])
    })
  }
  const gradingRowMenu = (e: React.MouseEvent, player: RosterPlayer) => {
    if (!current) return
    select(player.id)
    const en = entryOf(current.playId, player.id)
    const g = en?.grade ?? null
    const ptags = tagsFor(tags, player)
    const starred = pinned.includes(player.id)
    const canOff = !current.offensePlayers.length || !!en?.offField || !film.hasParticipation
    void showMenu(e, [
      action('Plus', () => grade(player.id, 1), { accelerator: '=', checked: g === 1 }),
      action('Zero', () => grade(player.id, 0), { accelerator: '0', checked: g === 0 }),
      action('Minus', () => grade(player.id, -1), { accelerator: '-', checked: g === -1 }),
      action('Clear Grade', () => clearGrade(player.id), { accelerator: 'Backspace', enabled: g !== null }),
      sep(),
      action(en?.critical ? 'Unmark Critical' : 'Mark Critical', () => toggleCritical(player.id), { accelerator: '!' }),
      ...(canOff ? [action('Not on Field', () => toggleOffField(player.id), { accelerator: 'X', checked: !!en?.offField })] : []),
      submenu(
        'Tags',
        ptags.length
          ? ptags.map((t, i) => ({ ...action(t.label, () => toggleTag(player.id, t), { checked: !!en?.tags.includes(t.label), accelerator: i < 10 ? 'QWERTYUIOP'[i] : undefined }) }))
          : [{ item: { label: 'No Tags', enabled: false } }]
      ),
      sep(),
      action('Grade in Player Focus', () => enterFocus(player.id)),
      action(starred ? 'Unstar for Grading' : 'Star for Grading', () => toggleStar(player.id)),
      action('Add Player Note', () => focusPlayerNote(player.id), { accelerator: 'Shift+N' }),
      sep(),
      ...playerMenu(game.season, player).filter((a) => a.item.label === 'Open Player' || a.item.label === 'Copy Name')
    ])
  }
  const focusPlayerNote = (playerId: string) => {
    toGrade()
    if (!focus) select(playerId)
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-test="player-note"]')?.focus())
  }

  // Cut-ups (⌘D): the cut-ups owner's popover, else a menu of manual cut-ups (views/shared/requests.ts).
  const openCutupMenu = () => {
    if (!current) return
    const anchor = document.querySelector('[data-test="play-row"][data-current="true"]') ?? document.querySelector('[data-test="viewer"]')
    void requestAddToCutup([{ gameId, playId: current.playId }], anchor)
  }

  // Export Play Video… hands the play to the Export Video sheet's owner.
  const exportAvailable = useExportVideoAvailable()
  const exportPlayVideo = () => {
    if (!current) return
    const source = { kind: 'plays' as const, label: `${game.awayTeam} @ ${game.homeTeam}`, team, plays: [{ gameId, playId: current.playId }] }
    if (!requestExportVideo(source, `${game.awayTeam} @ ${game.homeTeam} · ${quarterLabel(current.qtr)} ${current.time}`)) banner({ title: 'Export Video isn’t available yet', kind: 'info' })
  }
  const exportCsv = () =>
    void api.exportGradesCsv(game.season, team).then(
      (path) => path && banner({ title: `Exported ${path.split(/[\\/]/).pop()}`, kind: 'success', action: { label: 'Show in Finder', run: () => window.shell.showItemInFolder(path) } }),
      (e) => errorBanner('Couldn’t export the grades', e)
    )

  // ── Video helpers ─────────────────────────────────────────────────────────
  const poke = useRef<() => void>(() => {})
  const pb = (fn: () => void) => () => {
    poke.current()
    fn()
  }
  const changeSpeed = (s: number) => {
    setSpeed(s)
    viewerToast(`${s}×`)
  }
  const speedStep = (dir: 1 | -1) => {
    const i = (SPEEDS as readonly number[]).indexOf(speed)
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + dir))]
    if (next !== speed) changeSpeed(next)
  }

  // Clip ended with Loop off: Auto-Advance (02 §13.2).
  const ended = useRef<() => void>(() => {})
  ended.current = () => {
    window.shell?.setPlaybackActive(false)
    if (settings.autoAdvance && !typingInRoom()) step(1)
  }
  useEffect(() => video.onEnded(() => ended.current()), [video])

  // ── Commands (02 §15) ─────────────────────────────────────────────────────
  const hasTarget = !!target && !!current
  const targetTags = tagsFor(tags, target ?? undefined)
  const canOffField = hasTarget && (!film.hasParticipation || !(current!.offensePlayers.length || current!.defensePlayers.length) || !!targetEntry?.offField)
  const listUngraded = !focus && listed.some((p) => {
    const e = current ? entryOf(current.playId, p.id) : undefined
    return !e || (e.grade === null && !e.offField)
  })
  const playHasMarks = !!current && teamEntries(current.playId).some((e) => e.grade !== null || e.critical || e.offField)

  useCommand('play.toggle', pb(() => video.toggle()), { enabled: playable, label: vstate.playing ? 'Pause' : 'Play' })
  useCommand('play.frameBack', pb(() => video.stepFrames(-1)), { enabled: playable })
  useCommand('play.frameForward', pb(() => video.stepFrames(1)), { enabled: playable })
  useCommand('play.secondBack', pb(() => video.seekBy(-1)), { enabled: playable })
  useCommand('play.secondForward', pb(() => video.seekBy(1)), { enabled: playable })
  useCommand('play.prevPlay', pb(() => step(-1)), { enabled: !!current && visible.length > 0 })
  useCommand('play.nextPlay', pb(() => step(1)), { enabled: !!current && visible.length > 0 })
  useCommand('play.prevUngraded', pb(() => stepUngraded(-1)), { enabled: anyUngradedInList })
  useCommand('play.nextUngraded', pb(() => stepUngraded(1)), { enabled: visible.length > 0 })
  useCommand('play.toSnap', pb(() => video.replay()), { enabled: playable })
  useCommand('play.setSnap', pb(setSnapHere), { enabled: activePlayable })
  useCommand('play.snapEarlier', pb(() => nudgeSnap(-1)), { enabled: activePlayable })
  useCommand('play.snapLater', pb(() => nudgeSnap(1)), { enabled: activePlayable })
  useCommand('play.clearSnap', clearSnap, { enabled: !!activeClip && activeClip.snapMs !== null })
  useCommand('play.startAtSnap', () => void saveSettings({ startAtSnap: !settings.startAtSnap }), { checked: settings.startAtSnap })
  useCommand('play.slower', pb(() => speedStep(-1)), { enabled: speed > SPEEDS[0] })
  useCommand('play.faster', pb(() => speedStep(1)), { enabled: speed < SPEEDS[SPEEDS.length - 1] })
  useCommand('play.speed', (arg) => arg && changeSpeed(Number(arg)))
  useCommand(
    'play.loop',
    pb(() => {
      setLoop(!loop)
      viewerToast(loop ? 'Loop Off' : 'Loop On')
    }),
    { checked: loop }
  )
  useCommand(
    'play.sound',
    pb(() => {
      setSound(!sound)
      viewerToast(sound ? 'Sound Off' : 'Sound On')
    }),
    { checked: sound, enabled: playable }
  )
  useCommand('play.angle', (arg) => arg && chooseAngle(arg as Angle), { enabled: playAngles.length > 0 })
  useCommand('play.nextAngle', pb(nextAngle), { enabled: playAngles.length > 1 || twoPane })
  useCommand('play.sideBySide', pb(toggleSideBySide), { enabled: twoAngles && !!current, checked: layout !== 'single' })
  useCommand('play.pip', togglePip, { enabled: twoAngles && !!current, checked: layout === 'pip' })
  useCommand('play.secondAngle', (arg) => arg && setSecondPref(arg as Angle), { enabled: layout !== 'single' && gameAngles.length > 2 })
  useCommand('play.swapAngles', swapAngles, { enabled: layout !== 'single' && twoPane })
  useCommand('play.autoAdvance', () => void saveSettings({ autoAdvance: !settings.autoAdvance }), { checked: settings.autoAdvance })
  useCommand('view.playList', () => setListVisible(!listVisible), { enabled: !filmOnly, label: listVisible ? 'Hide Play List' : 'Show Play List' })
  useCommand(
    'view.controls',
    () => {
      const hide = !hideControls
      setHideControls(hide)
      if (hide) viewerToast('Controls Hidden · Press H to Show')
      else poke.current()
    },
    { enabled: !!current, label: hideControls ? 'Show Controls' : 'Hide Controls' }
  )
  useCommand('view.filmOnly', () => setUi({ filmOnly: !filmOnly }), { label: filmOnly ? 'Exit Film Only' : 'Enter Film Only' })
  useCommand('view.section', (arg) => {
    const t = TABS[Number(arg) - 1]
    if (t) setTab(t)
  })
  useDynamicMenus({
    sections: [
      { index: 1, label: 'Show Grade Inspector', checked: tab === 'grade' },
      { index: 2, label: 'Show Notes Inspector', checked: tab === 'notes' },
      { index: 3, label: 'Show Chart Inspector', checked: tab === 'chart' },
      { index: 4, label: 'Show Info Inspector', checked: tab === 'info' }
    ],
    speed,
    tags: targetTags.slice(0, 10).map((t, i) => ({ index: i, label: t.label, checked: !!targetEntry?.tags.includes(t.label) })),
    angles: gameAngles.map((a) => ({ angle: a, label: angleTitle(a), enabled: playAngles.includes(a), checked: (layout === 'single' ? shown : primary) === a })),
    secondAngle: layout !== 'single' && gameAngles.length > 2 ? gameAngles.filter((a) => a !== primary).map((a) => ({ angle: a, label: angleTitle(a), checked: a === second })) : [],
    layout: current ? layout : null,
    drawTool: drawMode ? tool : null
  })

  const gradeKey = (g: Grade) => () => {
    if (!target) return
    toGrade()
    grade(target.id, g, { advance: true })
  }
  useCommand('grade.selectPlayer', (arg) => {
    const p = listed[Number(arg) - 1]
    if (p) {
      toGrade()
      select(p.id)
    }
  }, { enabled: !drawMode && !focus && listed.length > 0 })
  const movePlayer = (dir: 1 | -1) => {
    toGrade()
    if (!listed.length || !current) return
    const i = listed.findIndex((p) => p.id === selectedId)
    for (let j = i + dir; j >= 0 && j < listed.length; j += dir) {
      if (!entryOf(current.playId, listed[j].id)?.offField) return select(listed[j].id)
    }
    if (dir > 0) autoAdvance()
  }
  useCommand('grade.nextPlayer', () => movePlayer(1), { enabled: !focus && listed.length > 0 })
  useCommand('grade.prevPlayer', () => movePlayer(-1), { enabled: !focus && listed.length > 0 })
  useCommand('grade.plus', gradeKey(1), { enabled: hasTarget })
  useCommand('grade.zero', gradeKey(0), { enabled: hasTarget })
  useCommand('grade.minus', gradeKey(-1), { enabled: hasTarget })
  useCommand('grade.clear', () => target && (toGrade(), clearGrade(target.id)), { enabled: hasTarget && !selectedShape })
  useCommand('grade.fillZeros', () => (toGrade(), fillZeros()), { enabled: !focus && listUngraded })
  useCommand('grade.clearPlay', clearPlay, { enabled: playHasMarks })
  useCommand('grade.critical', () => target && (toGrade(), toggleCritical(target.id)), { enabled: hasTarget, label: targetEntry?.critical ? 'Unmark Critical' : 'Mark Critical' })
  useCommand('grade.offField', () => target && (toGrade(), toggleOffField(target.id, true)), { enabled: canOffField, checked: !!targetEntry?.offField })
  useCommand('grade.toggleTag', (arg) => {
    const t = targetTags[Number(arg)]
    if (target && t) {
      toGrade()
      toggleTag(target.id, t)
    }
  }, { enabled: hasTarget && targetTags.length > 0 })
  useCommand('grade.addPlayer', () => (toGrade(), openAddPlayer(null)), { enabled: !!current })
  useCommand('grade.star', () => target && toggleStar(target.id), { enabled: !!target, label: target && pinned.includes(target.id) ? 'Unstar Player' : 'Star Player' })
  useCommand('grade.playerNote', () => target && focusPlayerNote(target.id), { enabled: hasTarget })
  useCommand('grade.focus', () => openFocusPicker(), { enabled: !!current })
  useCommand('grade.exitFocus', exitFocus, { enabled: !!focus })
  useCommand('grade.flag', () => toggleFlag(), { enabled: !!current, label: currentNote?.flagged ? 'Unflag Play' : 'Flag Play' })
  useCommand('grade.note', () => {
    setTab('notes')
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-test="play-note"]')?.focus())
  }, { enabled: !!current })
  useCommand('grade.addToCutup', openCutupMenu, { enabled: !!current })
  useCommand('draw.toggle', toggleDraw, { enabled: activePlayable || drawMode, checked: drawMode })
  useCommand('draw.tool', (arg) => {
    if (arg && (DRAW_TOOLS as readonly string[]).includes(arg)) {
      setToolPref(arg as Tool)
      if (arg !== 'select') setSelectedShape(null)
    }
  }, { enabled: drawMode })
  useCommand('draw.deleteShape', deleteShape, { enabled: !!selShape })
  useCommand(
    'draw.undo',
    () => {
      if (!active || !activeShapes.length) return
      setShapes(active, activeShapes.slice(0, -1), { label: 'Delete Drawing' })
      setSelectedShape(null)
    },
    { enabled: activeShapes.length > 0 }
  )
  useCommand(
    'draw.clear',
    () => {
      if (!active) return
      setShapes(active, [], { label: 'Clear Drawings' })
      setSelectedShape(null)
    },
    { enabled: activeShapes.length > 0 }
  )
  useCommand('draw.duplicate', duplicateShape, { enabled: !!selShape })
  useCommand('draw.bringToFront', () => arrange(true), { enabled: !!selShape })
  useCommand('draw.sendToBack', () => arrange(false), { enabled: !!selShape })
  useCommand('file.fixMatches', () => fixMatches(currentId ?? undefined))
  useCommand('file.exportVideo', exportPlayVideo, { enabled: playable && exportAvailable, label: 'Export Play Video…' })
  useCommand('file.exportCsv', exportCsv)
  const nextUndo = undo.peekUndo()
  const nextRedo = undo.peekRedo()
  useCommand(
    'edit.undo',
    () => {
      if (isTyping(document.activeElement)) return void document.execCommand('undo')
      undo.undo()
    },
    { enabled: !!nextUndo || isTyping(document.activeElement), label: nextUndo ? `Undo ${nextUndo.label}` : 'Undo' }
  )
  useCommand(
    'edit.redo',
    () => {
      if (isTyping(document.activeElement)) return void document.execCommand('redo')
      undo.redo()
    },
    { enabled: !!nextRedo || isTyping(document.activeElement), label: nextRedo ? `Redo ${nextRedo.label}` : 'Redo' }
  )

  // esc in the tape room (02 §14.6), after fields, text editing and drags have had it.
  useEscape(() => {
    if (selectedShape) return setSelectedShape(null), true
    if (endPanel) return setEndPanel(null), true
    if (drawMode) return toggleDraw(), true
    if (filmOnly) return setUi({ filmOnly: false }), true
    if (focus) return exitFocus(), true
    if (multi.size) return setMulti(new Set()), true
    return false
  })

  // ── Toolbar (02 §3) ───────────────────────────────────────────────────────
  const subtitle = focus
    ? `Player Focus · ${focus.player.name} · ${focus.progress.graded} of ${focus.progress.total} graded`
    : `${weekName(game)} · ${game.season} · ${gradedPlays} of ${plays.length} graded`
  const titleMenu = (): MenuItemSpec[] => {
    const list = [...teamGames].sort((a, b) => a.week - b.week || a.gameday.localeCompare(b.gameday))
    if (!list.some((g) => g.gameId === gameId)) list.push({ ...game, clipCount: data.clips.length, playCount: plays.length, gradedPlays })
    return [
      { kind: 'header', label: `${team} Film` },
      ...list.map(
        (g): MenuItemSpec => ({
          label: `${weekName(g)} · ${g.awayTeam} @ ${g.homeTeam} — ${g.gradedPlays ? `${g.gameId === gameId ? gradedPlays : g.gradedPlays} of ${g.playCount} graded` : 'not started'}`,
          checked: g.gameId === gameId,
          run: () => {
            if (g.gameId === gameId) return
            navigate(links.tape(g.gameId, team, focus ? { player: focus.player.id, focus: true } : undefined))
          }
        })
      ),
      { kind: 'separator' },
      { label: `Open ${TEAM_BY_ABBR[team]?.name ?? team}`, run: () => navigate(links.team(game.season, team)) },
      { label: 'Show All Film', run: () => runCommand('go.film') }
    ]
  }
  const moreItems = (): MenuItemSpec[] => [
    hasFilm
      ? { label: 'Fix Clip Matches…', shortcut: '⇧⌘I', run: () => fixMatches(currentId ?? undefined) }
      : { label: 'Import Film…', shortcut: '⌘I', run: () => runCommand('file.importFilm') },
    { label: 'Check Clip Alignment', disabled: !hasFilm, run: checkAlignment },
    { kind: 'separator' },
    { label: 'Export Play Video…', shortcut: '⌘E', disabled: !playable || !exportAvailable, run: exportPlayVideo },
    { label: 'Export Grades as CSV…', shortcut: '⇧⌘E', run: exportCsv },
    { kind: 'separator' },
    { label: 'Edit Tags…', run: () => void window.shell.openSettings('grading') },
    { label: 'Keyboard Shortcuts', shortcut: '⌘/', run: () => runCommand('help.shortcuts', 'tape') }
  ]

  // Focusing the search field shows the play browser (02 §3).
  const [listOverlay, setListOverlay] = useState(false)
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[data-test="play-search"]')) return
      if (!listVisible) setListVisible(true)
      setListOverlay(true)
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [listVisible, setListVisible])

  // ── Narrow windows (02 §2.3) ──────────────────────────────────────────────
  const [roomWidth, setRoomWidth] = useState(1100)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoomWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [listWidth, setListWidth] = usePref('ui.tape.list.width', 300)
  const overlayList = roomWidth < listWidth + 480
  useEffect(() => {
    if (!overlayList) setListOverlay(false)
  }, [overlayList])

  const room: Room = {
    film,
    game,
    team,
    opponent,
    plays,
    players,
    tags,
    chartFields,
    settings,
    data,
    undo,
    video,
    lineup,
    hasFilm,
    gameAngles,
    clipsByPlay,
    alignment,
    baseList,
    visible,
    tokens: filters.tokens,
    text: filters.text,
    setTokens,
    setText,
    group,
    setGroup,
    drivesAvailable,
    multi,
    setMulti,
    listedFor,
    progressOf,
    playGradeCounts,
    current,
    currentNote,
    currentClips,
    listed,
    selected,
    target,
    targetEntry,
    pinned,
    starredOnly,
    setStarredOnly,
    focus,
    onFocusSnap,
    panes,
    layout,
    active,
    activeClip,
    playable,
    drawMode,
    tool,
    style,
    selectedShape,
    goTo: (id, opts) => {
      goTo(id, opts)
      if (opts?.mouse && overlayList) setListOverlay(false)
    },
    step,
    select: (id) => {
      select(id)
    },
    grade,
    clearGrade,
    toggleCritical,
    toggleOffField: (id) => toggleOffField(id),
    toggleTag,
    toggleStar,
    savePlayerNote,
    fillZeros,
    clearPlay,
    toggleFlag: () => toggleFlag(),
    savePlayNote,
    setChart,
    enterFocus,
    exitFocus,
    openFocusPicker,
    openAddPlayer,
    fixMatches,
    openPlayer: (id) => navigate(links.player(game.season, id)),
    setActive,
    setTab,
    tab,
    refocus,
    playMenu,
    gradingRowMenu,
    setTool: (t) => setToolPref(t),
    setStyle,
    selectShape: setSelectedShape,
    shapesOf,
    setShapes
  }

  const searchTokens = filters.tokens.map((t) => toSearchToken(t, team))
  const subtitleText = subtitle
  const studyOptions = [game.awayTeam, game.homeTeam].map((t) => ({
    value: t,
    label: t,
    title: `Study ${TEAM_BY_ABBR[t]?.name ?? t}`,
    test: `study-team-${t}`
  }))

  return (
    <Screen name="tape-room" scroll="none" takeover inspector={<TapeInspector room={room} />} inspectorWidth={340} inspectorMin={300}>
      <Toolbar
        title={`${game.awayTeam} @ ${game.homeTeam}`}
        subtitle={subtitleText}
        windowTitle={`${game.awayTeam} @ ${game.homeTeam} — ${weekName(game)}, ${game.season}`}
        separator="always"
        titleMenu={titleMenu}
        center={
          <div className="tape-study" data-test="study-team" style={{ '--dot-0': teamMarkFor(game.awayTeam), '--dot-1': teamMarkFor(game.homeTeam) } as React.CSSProperties}>
            <Segmented size="toolbar" value={team} onChange={switchTeam} label="Studying" options={studyOptions} />
          </div>
        }
        trailing={[
          { kind: 'button', command: 'view.playList', icon: 'layout-list', pressed: listVisible && !overlayList ? true : overlayList ? listOverlay : false, priority: 1, test: 'toolbar-playlist' },
          { kind: 'button', command: 'play.sideBySide', icon: 'columns-2', label: twoAngles ? 'Side-by-Side Angles' : 'This game has one camera angle', pressed: layout !== 'single', priority: 3, test: 'toolbar-angles' },
          { kind: 'button', command: 'draw.toggle', icon: 'pen-line', pressed: drawMode, priority: 3, test: 'toolbar-draw' },
          focus
            ? { kind: 'button', command: 'grade.exitFocus', icon: 'scan-eye', label: 'Exit Player Focus', pressed: true, priority: 4, test: 'toolbar-focus' }
            : { kind: 'button', command: 'grade.focus', icon: 'scan-eye', label: 'Player Focus', pressed: false, priority: 4, test: 'toolbar-focus' },
          { kind: 'pulldown', icon: 'ellipsis', label: 'More', items: moreItems, test: 'tape-more' }
        ]}
        search={{
          placeholder: 'Search plays',
          value: filters.text,
          onChange: setText,
          tokens: searchTokens,
          onTokensChange: (list) => setTokens(fromSearchTokens(list)),
          suggest: (t) => buildSuggestions(t, team, filters.tokens, lineup, () => setText(t)),
          onTokenClick: (tok, anchor) => tokenMenu(tok, anchor, team, filters.tokens, lineup, setTokens),
          test: 'play-search'
        }}
        inspector
      />
      <div
        ref={rootRef}
        className="tape-room"
        data-test="tape-room"
        tabIndex={-1}
        data-film-only={filmOnly || undefined}
        data-draw={drawMode || undefined}
      >
        <div className="tape-room__panes">
          <PlayBrowser
            room={room}
            visible={!filmOnly && (overlayList ? listOverlay : listVisible)}
            overlay={overlayList}
            width={listWidth}
            onWidth={setListWidth}
            onHide={() => (overlayList ? setListOverlay(false) : setListVisible(false))}
          />
          <Viewer
            room={room}
            filmOnly={filmOnly}
            hideControls={hideControls}
            timeMode={timeMode}
            onTimeMode={() => setTimeMode(timeMode === 'snap' ? 'clip' : 'snap')}
            endPanel={endPanel}
            onEndPanel={setEndPanel}
            pokeRef={poke}
            onViewerClick={() => overlayList && listOverlay && setListOverlay(false)}
            actions={{
              setSnapHere,
              clearSnap,
              goToSnap,
              nudgeSnap,
              chooseAngle,
              chooseLayout,
              swapAngles,
              setSecondAngle: (a) => setSecondPref(a),
              toggleDraw,
              copyFrame: (a) => void copyFrame(video.engine, a, shapesOf(a)),
              switchTeam: () => switchTeam(opponent),
              firstPlay: () => visible[0] && goTo(visible[0].playId),
              firstUngraded: () => {
                const p = visible.find((x) => isUngraded(x))
                if (p) goTo(p.playId)
              },
              continueIn: (g) => navigate(links.tape(g.gameId, team, focus ? { player: focus.player.id, focus: true } : undefined)),
              teamGames,
              exportVideo: exportPlayVideo,
              deleteShape,
              duplicateShape,
              arrange,
              gradedPlays,
              startPoint: activeClip ? clipStartTime(activeClip, settings) : null,
              snap: snapSeconds(activeClip),
              playAngles,
              twoPane,
              primary,
              second
            }}
          />
        </div>
      </div>
      <FocusPicker room={room} anchor={pickerAnchor} open={!!picker} onClose={() => (setPicker(null), refocus())} />
      <AddPlayerPopover room={room} anchor={addAnchor} open={!!addPlayer} onClose={() => (setAddPlayer(null), refocus())} />
    </Screen>
  )
}

/** A copy of a shape moved by `d` picture units (Duplicate Drawing). */
function offsetShape(s: Shape, d: number): Shape {
  switch (s.kind) {
    case 'pen':
      return { ...s, points: s.points.map(([x, y]) => [x + d, y + d] as [number, number]) }
    case 'line':
      return { ...s, from: [s.from[0] + d, s.from[1] + d], to: [s.to[0] + d, s.to[1] + d] }
    default:
      return { ...s, x: s.x + d, y: s.y + d }
  }
}

