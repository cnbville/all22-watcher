import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POSITION_GROUPS, sideOfGroup, TEAM_BY_ABBR } from '@shared/teams'
import type {
  Angle,
  ChartField,
  Clip,
  GameFilm,
  Grade,
  GradeEntry,
  Play,
  PlayNote,
  PositionGroup,
  RosterPlayer,
  Settings,
  Stroke,
  TagDef
} from '@shared/types'
import { api } from '../api'
import { Crumbs } from '../App'
import { ErrorBox, isTyping, Kbd, Loading, Modal, TeamChip, toast, useAsync } from '../components/common'
import { INK, SPEEDS, type VideoHandle, VideoStage } from '../components/VideoStage'
import {
  downDistance,
  lastName,
  playKind,
  playTypeLabel,
  prettyEnum,
  quarterLabel,
  resultLabel,
  shortDesc,
  weekLabel
} from '../format'
import { links, navigate } from '../router'
import { ImportFilm } from './ImportFilm'

const TAG_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']
const ANGLE_ORDER: Angle[] = ['sideline', 'endzone', 'main']

interface Filters {
  side: 'all' | 'off' | 'def'
  kind: 'all' | 'pass' | 'run' | 'special'
  down: string
  qtr: string
  status: 'all' | 'ungraded' | 'graded' | 'flagged' | 'noted'
  formation: string
  personnel: string
  coverage: string
  search: string
}

const NO_FILTERS: Filters = {
  side: 'all', kind: 'all', down: '', qtr: '', status: 'all', formation: '', personnel: '', coverage: '', search: ''
}

const gradeKey = (playId: number, playerId: string) => `${playId}|${playerId}`
const NO_GRADES: GradeEntry[] = []

export function TapeRoom({ gameId, team, initialPlay }: { gameId: string; team: string; initialPlay: number | null }) {
  const film = useAsync(() => api.gameFilm(gameId), [gameId])
  const meta = useAsync(() => Promise.all([api.tags(), api.chartFields(), api.settings()]), [])
  if (film.error || meta.error) return <div className="page"><ErrorBox error={film.error ?? meta.error} /></div>
  if (!film.data || !meta.data) return <Loading label="Loading film…" />
  const [tags, fields, settings] = meta.data
  return (
    <Room
      film={film.data}
      tags={tags}
      chartFields={fields}
      initialSettings={settings}
      team={team || film.data.game.homeTeam}
      initialPlay={initialPlay}
      reload={film.reload}
    />
  )
}

function Room({
  film,
  tags,
  chartFields,
  initialSettings,
  team: initialTeam,
  initialPlay,
  reload
}: {
  film: GameFilm
  tags: TagDef[]
  chartFields: ChartField[]
  initialSettings: Settings
  team: string
  initialPlay: number | null
  reload: () => void
}) {
  const { game, plays } = film
  const [team, setTeam] = useState(initialTeam)
  const [settings, setSettings] = useState(initialSettings)
  const [grades, setGrades] = useState(() => new Map(film.grades.map((g) => [gradeKey(g.playId, g.playerId), g])))
  const [notes, setNotes] = useState(() => new Map(film.notes.map((n) => [n.playId, n])))
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [speed, setSpeed] = useState(settings.defaultSpeed)
  const [loop, setLoop] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [ink, setInk] = useState(INK[0])
  const [onlyFocus, setOnlyFocus] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const video = useRef<VideoHandle>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const clipsByPlay = useMemo(() => {
    const m = new Map<number, Clip[]>()
    for (const c of film.clips) if (c.playId !== null) m.set(c.playId, [...(m.get(c.playId) ?? []), c])
    return m
  }, [film.clips])
  const angles = useMemo(
    () => ANGLE_ORDER.filter((a) => film.clips.some((c) => c.angle === a)),
    [film.clips]
  )
  const [angle, setAngle] = useState<Angle>(angles[0] ?? 'main')
  // Film can be imported or replaced while the room is open; fall back to the preferred angle.
  useEffect(() => {
    if (angles.length && !angles.includes(angle)) setAngle(angles[0])
  }, [angles, angle])

  const opponent = team === game.homeTeam ? game.awayTeam : game.homeTeam
  useEffect(() => {
    if (film.clips.length) void api.openedFilm(game.gameId, team)
  }, [game.gameId, team, film.clips.length])
  const pinned = settings.pinned[team] ?? []
  const sideOf = (p: Play) => (p.posteam === team ? 'off' : 'def')

  const gradesByPlay = useMemo(() => {
    const m = new Map<number, GradeEntry[]>()
    for (const g of grades.values()) {
      if (g.team !== team || g.grade === null) continue
      const list = m.get(g.playId)
      if (list) list.push(g)
      else m.set(g.playId, [g])
    }
    return m
  }, [grades, team])
  const playGrades = useCallback((playId: number) => gradesByPlay.get(playId) ?? NO_GRADES, [gradesByPlay])

  const options = useMemo(() => {
    const uniq = (f: (p: Play) => string | null) => [...new Set(plays.map(f).filter((v): v is string => !!v))].sort()
    return {
      formation: uniq((p) => p.formation),
      personnel: uniq((p) => (p.posteam === team ? p.offPersonnel : p.defPersonnel)),
      coverage: uniq((p) => p.coverage)
    }
  }, [plays, team])

  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return plays.filter((p) => {
      if (filters.side !== 'all' && sideOf(p) !== filters.side) return false
      if (filters.kind !== 'all' && playKind(p) !== filters.kind) return false
      if (filters.down && String(p.down) !== filters.down) return false
      if (filters.qtr && String(Math.min(p.qtr, 5)) !== filters.qtr) return false
      if (filters.formation && p.formation !== filters.formation) return false
      if (filters.personnel && (p.posteam === team ? p.offPersonnel : p.defPersonnel) !== filters.personnel) return false
      if (filters.coverage && p.coverage !== filters.coverage) return false
      if (filters.status === 'graded' && !playGrades(p.playId).length) return false
      if (filters.status === 'ungraded' && playGrades(p.playId).length) return false
      if (filters.status === 'flagged' && !notes.get(p.playId)?.flagged) return false
      if (filters.status === 'noted' && !notes.get(p.playId)?.note.trim()) return false
      if (q && !p.desc.toLowerCase().includes(q)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays, filters, team, notes, playGrades])

  const [currentId, setCurrentId] = useState<number | null>(() => {
    if (initialPlay !== null && plays.some((p) => p.playId === initialPlay)) return initialPlay
    return plays.find((p) => clipsByPlay.has(p.playId))?.playId ?? plays[0]?.playId ?? null
  })
  const current = plays.find((p) => p.playId === currentId) ?? null
  const currentClips = current ? clipsByPlay.get(current.playId) ?? [] : []
  const clip = currentClips.find((c) => c.angle === angle) ?? currentClips[0] ?? null
  const note: PlayNote | null = current
    ? notes.get(current.playId) ?? { gameId: game.gameId, playId: current.playId, note: '', chart: {}, drawing: {}, flagged: false }
    : null

  const go = useCallback(
    (delta: number) => {
      if (!visible.length) return
      const i = visible.findIndex((p) => p.playId === currentId)
      let next: Play | undefined
      if (i !== -1) next = visible[Math.min(visible.length - 1, Math.max(0, i + delta))]
      else {
        // The current play can drop out of the list (graded while showing Ungraded): step from where it sat.
        const pi = plays.findIndex((p) => p.playId === currentId)
        const before = visible.filter((p) => plays.indexOf(p) < pi).length
        next = pi === -1 ? visible[0] : visible[delta > 0 ? before + delta - 1 : before + delta]
      }
      if (!next || next.playId === currentId) return
      // Notes save on blur, so blur a note still being typed before its field is swapped for the next play's.
      const typing = document.activeElement
      if (typing instanceof HTMLElement && typing.closest('.tape-side')) typing.blur()
      setCurrentId(next.playId)
    },
    [visible, plays, currentId]
  )

  // Who's being graded on this play: the 11 on the field when nflverse has participation data,
  // otherwise the players you've starred plus anyone credited in the play-by-play.
  const roster = useMemo(
    () => Object.values(film.players).filter((p) => p.team === team).sort(byPosition),
    [film.players, team]
  )
  const gradingList = useMemo((): RosterPlayer[] => {
    if (!current) return []
    const onOffense = current.posteam === team
    const onField = onOffense ? current.offensePlayers : current.defensePlayers
    const ids: string[] = []
    if (onField.length) {
      ids.push(...onField)
      if (onlyFocus && pinned.length) ids.splice(0, ids.length, ...onField.filter((id) => pinned.includes(id)))
    } else {
      const side = current.special ? 'special' : onOffense ? 'offense' : 'defense'
      ids.push(...pinned.filter((id) => {
        const p = film.players[id]
        return !p || current.special || sideOfGroup(p.group) === side
      }))
      if (!onlyFocus) ids.push(...current.involved.filter((id) => film.players[id]?.team === team))
    }
    for (const g of grades.values()) if (g.playId === current.playId && g.team === team) ids.push(g.playerId)
    return [...new Set(ids)].map((id) => film.players[id] ?? stubPlayer(id, team)).sort(byPosition)
  }, [current, team, film.players, pinned, onlyFocus, grades])

  useEffect(() => {
    if (!gradingList.some((p) => p.id === selected)) setSelected(gradingList[0]?.id ?? null)
  }, [gradingList, selected])

  // Each new play starts at the top of the player list.
  const firstPlayer = gradingList[0]?.id ?? null
  useEffect(() => {
    setSelected(firstPlayer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  // Keep the selected play visible in the list.
  useEffect(() => {
    document.querySelector('.play-row.current')?.scrollIntoView({ block: 'nearest' })
  }, [currentId])

  const tagsFor = (p: RosterPlayer | undefined) => tags.filter((t) => t.group === (p?.group ?? 'ST'))

  const saveGrade = (entry: GradeEntry) => {
    setGrades((m) => new Map(m).set(gradeKey(entry.playId, entry.playerId), entry))
    void api.saveGrade(entry)
  }
  const entryFor = (playerId: string): GradeEntry =>
    grades.get(gradeKey(current!.playId, playerId)) ?? {
      gameId: game.gameId, playId: current!.playId, playerId, team, grade: null, tags: [], note: ''
    }
  const setGrade = (playerId: string, grade: Grade | null) => {
    if (!current) return
    saveGrade({ ...entryFor(playerId), grade })
  }
  /** Grades everyone on the play who has no grade yet as 0, for snaps where nobody stood out. */
  const fillZeros = () => {
    if (!current) return
    for (const p of gradingList) if (entryFor(p.id).grade === null) saveGrade({ ...entryFor(p.id), grade: 0 })
  }
  const toggleTag = (playerId: string, tag: TagDef) => {
    if (!current) return
    const e = entryFor(playerId)
    const has = e.tags.includes(tag.label)
    const nextTags = has ? e.tags.filter((t) => t !== tag.label) : [...e.tags, tag.label]
    // A tag implies a grade when none is set yet: positive tags lean +, negative tags lean –.
    const grade = e.grade ?? (has ? null : tag.kind === 'pos' ? 1 : tag.kind === 'neg' ? -1 : null)
    saveGrade({ ...e, tags: nextTags, grade })
  }
  const saveNote = (patch: Partial<PlayNote>) => {
    if (!note) return
    const next = { ...note, ...patch }
    setNotes((m) => new Map(m).set(next.playId, next))
    void api.savePlayNote(next)
  }
  const togglePin = (playerId: string) => {
    const list = pinned.includes(playerId) ? pinned.filter((x) => x !== playerId) : [...pinned, playerId]
    const next = { ...settings.pinned, [team]: list }
    setSettings({ ...settings, pinned: next })
    void api.saveSettings({ pinned: next })
  }
  const selectNextPlayer = (dir = 1) => {
    if (!gradingList.length) return
    const i = gradingList.findIndex((p) => p.id === selected)
    const ni = i + dir
    if (ni >= gradingList.length && dir > 0) {
      if (settings.autoAdvance) go(1)
      return
    }
    setSelected(gradingList[Math.max(0, Math.min(gradingList.length - 1, ni))].id)
  }

  // Angle switching cycles through the angles this play has, not every angle in the game.
  const playAngles = ANGLE_ORDER.filter((a) => currentClips.some((c) => c.angle === a))
  const nextAngle = () => playAngles.length > 1 && setAngle(playAngles[(playAngles.indexOf(clip!.angle) + 1) % playAngles.length])

  const strokes: Stroke[] = (note?.drawing[clip?.angle ?? angle] ?? []) as Stroke[]
  const setStrokes = (s: Stroke[]) => saveNote({ drawing: { ...note!.drawing, [clip?.angle ?? angle]: s } })

  // Keyboard: the whole room is drivable without the mouse. Re-subscribed every render so handlers see current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (fixing || isTyping(e) || (e.metaKey && e.key !== 'z')) return
      // A dropdown left focused would otherwise pick an option by type-ahead on keys that aren't hotkeys.
      if (e.target instanceof HTMLSelectElement) e.target.blur()
      if (showHelp) {
        if (e.key === 'Escape' || e.key === '?') setShowHelp(false)
        return
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const sel = gradingList.find((p) => p.id === selected)
      const tagIndex = TAG_KEYS.indexOf(k)
      let handled = true
      if (k === ' ') video.current?.togglePlay()
      else if (k === 'ArrowLeft') e.shiftKey ? video.current?.seekBy(-1) : video.current?.step(-1)
      else if (k === 'ArrowRight') e.shiftKey ? video.current?.seekBy(1) : video.current?.step(1)
      else if (k === 'ArrowUp') go(-1)
      else if (k === 'ArrowDown' || k === 'Enter') go(1)
      else if (k === '[') setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)] ?? 1)
      else if (k === ']') setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)] ?? 1)
      else if (k === 'b') video.current?.restart()
      else if (k === 'l') setLoop((v) => !v)
      else if (k === 'a') nextAngle()
      else if (k === 'd') setDrawing((v) => !v)
      else if (k === 'c') note && setStrokes([])
      else if (k === 'z') note && setStrokes(strokes.slice(0, -1))
      else if (k === 'f') note && saveNote({ flagged: !note.flagged })
      else if (k === 'n') noteRef.current?.focus()
      else if (k === '?') setShowHelp(true)
      else if (k === 'Tab') selectNextPlayer(e.shiftKey ? -1 : 1)
      else if (/^[1-9]$/.test(k) && gradingList[Number(k) - 1]) setSelected(gradingList[Number(k) - 1].id)
      else if ((k === '=' || k === '+') && sel) (setGrade(sel.id, 1), selectNextPlayer())
      else if (k === '-' && sel) (setGrade(sel.id, -1), selectNextPlayer())
      else if ((k === ')' || (k === '0' && e.shiftKey)) && current) fillZeros()
      else if (k === '0' && sel) (setGrade(sel.id, 0), selectNextPlayer())
      else if ((k === 'Backspace' || k === 'Delete') && sel) setGrade(sel.id, null)
      else if (tagIndex >= 0 && sel && tagsFor(sel)[tagIndex]) toggleTag(sel.id, tagsFor(sel)[tagIndex])
      else handled = false
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onEnded = () => {
    // Don't change plays under a note still being typed: the rest of it would land as hotkeys on the next play.
    const typing = document.activeElement
    if ((typing instanceof HTMLTextAreaElement || (typing instanceof HTMLInputElement && typing.type === 'text')) && typing.closest('.tape-side')) return
    if (settings.autoAdvance) go(1)
  }

  const studyTeam = TEAM_BY_ABBR[team]
  const gradedCount = gradesByPlay.size

  return (
    <>
      <Crumbs>
        <span className="sep">/</span>
        <a onClick={() => navigate(links.team(game.season, team))}>{studyTeam?.name ?? team}</a>
        <span className="sep">/</span>
        <span>
          {weekLabel(game)} · {game.awayTeam} @ {game.homeTeam}
        </span>
      </Crumbs>
      <div className="row" style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
        <span className="faint">Studying</span>
        <div className="seg">
          {[game.awayTeam, game.homeTeam].map((t) => (
            <button key={t} className={team === t ? 'on' : ''} onClick={() => setTeam(t)}>
              {t}
            </button>
          ))}
        </div>
        <span className="faint" style={{ marginLeft: 8 }}>
          {gradedCount} of {plays.length} plays graded for {team}
        </span>
        {!film.hasParticipation && (
          <span className="badge info" title="nflverse hasn't published who was on the field for this game yet">
            On-field lineups not published yet: star players to grade them
          </span>
        )}
        <span className="spacer" />
        <button className="btn small" onClick={() => setFixing(true)}>
          {film.clips.length ? 'Fix clip matches' : 'Import film'}
        </button>
        <button className="btn small" onClick={() => setShowHelp(true)}>
          Hotkeys <Kbd>?</Kbd>
        </button>
      </div>
      <div className="tape">
        <PlayList
          plays={visible}
          total={plays.length}
          filters={filters}
          setFilters={setFilters}
          options={options}
          team={team}
          opponent={opponent}
          currentId={currentId}
          onSelect={setCurrentId}
          clipsByPlay={clipsByPlay}
          playGrades={playGrades}
          notes={notes}
          hasParticipation={film.hasParticipation}
        />
        <div className="tape-stage">
          <VideoStage
            ref={video}
            clip={clip}
            speed={speed}
            loop={loop}
            drawing={drawing}
            ink={ink}
            strokes={strokes}
            onStrokes={setStrokes}
            onEnded={onEnded}
            overlay={
              current && (
                <>
                  <span className="badge">
                    {quarterLabel(current.qtr)} {current.time}
                  </span>
                  <span className="badge">
                    {current.posteam} {downDistance(current)}
                  </span>
                  {clip && angles.length > 1 && <span className="badge">{clip.angle === 'endzone' ? 'End zone' : clip.angle === 'sideline' ? 'Sideline' : 'Main'}</span>}
                  {speed !== 1 && <span className="badge">{speed}×</span>}
                  {note?.flagged && <span className="badge" style={{ color: 'var(--flag)' }}>⚑ Flagged</span>}
                </>
              )
            }
            transportExtra={
              <>
                <select className="input" style={{ height: 24, width: 70 }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Speed ([ and ])">
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
                <button className={`btn small ${loop ? 'active' : ''}`} onClick={() => setLoop(!loop)} title="Loop the clip (L)">
                  Loop
                </button>
                {playAngles.length > 1 && (
                  <button className="btn small" onClick={nextAngle} title="Switch camera angle (A)">
                    {clip?.angle === 'endzone' ? 'End zone' : clip?.angle === 'sideline' ? 'Sideline' : 'Angle'}
                  </button>
                )}
                <button className={`btn small ${drawing ? 'active' : ''}`} onClick={() => setDrawing(!drawing)} title="Draw on the film (D)">
                  Draw
                </button>
                {drawing && (
                  <>
                    {INK.map((c) => (
                      <span key={c} className={`swatch ${ink === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setInk(c)} />
                    ))}
                    <button className="btn small ghost" onClick={() => setStrokes(strokes.slice(0, -1))} title="Undo (Z)">
                      Undo
                    </button>
                    <button className="btn small ghost" onClick={() => setStrokes([])} title="Clear (C)">
                      Clear
                    </button>
                  </>
                )}
              </>
            }
          />
        </div>
        <div className="tape-side">
          {current && note ? (
            <>
              <PlayInfo play={current} clip={clip} flagged={note.flagged} onFlag={() => saveNote({ flagged: !note.flagged })} />
              <div className="side-section">
                <div className="row" style={{ marginBottom: 8 }}>
                  <TeamChip abbr={team} size="sm" />
                  <h3>
                    Grade {team} {current.special ? 'special teams' : current.posteam === team ? 'offense' : 'defense'}
                  </h3>
                  <span className="spacer" />
                  <label className="row faint" style={{ fontSize: 12, gap: 4 }} title="Only show players you've starred">
                    <input type="checkbox" checked={onlyFocus} onChange={(e) => setOnlyFocus(e.target.checked)} />
                    Starred only
                  </label>
                </div>
                {gradingList.length === 0 && (
                  <p className="faint" style={{ margin: '4px 0 8px' }}>
                    No players listed for this play. Add the players you’re studying below and star them so they show up on
                    every snap.
                  </p>
                )}
                {gradingList.map((p, i) => {
                  const e = grades.get(gradeKey(current.playId, p.id))
                  return (
                    <PlayerGradeRow
                      key={p.id}
                      index={i}
                      season={game.season}
                      playId={current.playId}
                      player={p}
                      entry={e}
                      tags={tagsFor(p)}
                      selected={selected === p.id}
                      starred={pinned.includes(p.id)}
                      onSelect={() => setSelected(p.id)}
                      onGrade={(g) => setGrade(p.id, e?.grade === g ? null : g)}
                      onTag={(t) => toggleTag(p.id, t)}
                      onStar={() => togglePin(p.id)}
                      onNote={(text) => saveGrade({ ...entryFor(p.id), note: text })}
                    />
                  )
                })}
                <select
                  className="input"
                  style={{ width: '100%', marginTop: 8, height: 28 }}
                  value=""
                  onChange={(e) => {
                    const id = e.target.value
                    if (!id) return
                    if (!pinned.includes(id)) togglePin(id)
                    setSelected(id)
                  }}
                >
                  <option value="">+ Star a {team} player to grade…</option>
                  {roster
                    .filter((p) => !pinned.includes(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.jersey ? `#${p.jersey} ` : ''}
                        {p.name} ({p.depthPos || p.position})
                      </option>
                    ))}
                </select>
              </div>
              {chartFields.length > 0 && (
                <div className="side-section">
                  <h4 style={{ marginBottom: 8 }}>Charting</h4>
                  <div className="chart-fields">
                    {chartFields.map((f) => (
                      <ChartSelect key={f.id} field={f} value={note.chart[f.name] ?? ''} onChange={(v) => saveNote({ chart: { ...note.chart, [f.name]: v } })} />
                    ))}
                  </div>
                </div>
              )}
              <div className="side-section">
                <h4 style={{ marginBottom: 8 }}>
                  Play notes <Kbd>N</Kbd>
                </h4>
                <NoteBox key={current.playId} value={note.note} inputRef={noteRef} onSave={(text) => saveNote({ note: text })} />
              </div>
            </>
          ) : (
            <div className="empty">No plays match these filters.</div>
          )}
        </div>
      </div>
      {showHelp && <HotkeyHelp onClose={() => setShowHelp(false)} />}
      {fixing && (
        <ImportFilm
          game={game}
          team={team}
          existing={
            film.clips.length
              ? film.clips.map((c) => ({ path: c.path, fileName: c.fileName, angle: c.angle, playId: c.playId }))
              : undefined
          }
          onClose={() => setFixing(false)}
          onImported={() => {
            setFixing(false)
            reload()
            toast('Film updated')
          }}
        />
      )}
    </>
  )
}

function byPosition(a: RosterPlayer, b: RosterPlayer) {
  return (
    POSITION_GROUPS.indexOf(a.group) - POSITION_GROUPS.indexOf(b.group) ||
    (Number(a.jersey) || 99) - (Number(b.jersey) || 99) ||
    a.name.localeCompare(b.name)
  )
}

function stubPlayer(id: string, team: string): RosterPlayer {
  return {
    id, name: id, team, position: '', depthPos: '', group: 'ST' as PositionGroup, jersey: '', status: '',
    headshot: '', college: '', height: '', weight: '', yearsExp: ''
  }
}

function PlayList(props: {
  plays: Play[]
  total: number
  filters: Filters
  setFilters: (f: Filters) => void
  options: { formation: string[]; personnel: string[]; coverage: string[] }
  team: string
  opponent: string
  currentId: number | null
  onSelect: (id: number) => void
  clipsByPlay: Map<number, Clip[]>
  playGrades: (playId: number) => GradeEntry[]
  notes: Map<number, PlayNote>
  hasParticipation: boolean
}) {
  const { filters: f, setFilters } = props
  const set = (patch: Partial<Filters>) => setFilters({ ...f, ...patch })
  const active = JSON.stringify(f) !== JSON.stringify(NO_FILTERS)
  return (
    <div className="tape-list">
      <div className="tape-filters">
        <input className="input" placeholder="Search plays (e.g. sack, Lamb, deep left)" value={f.search} onChange={(e) => set({ search: e.target.value })} />
        <div className="row">
          <select className="input" value={f.side} onChange={(e) => set({ side: e.target.value as Filters['side'] })}>
            <option value="all">Both sides</option>
            <option value="off">{props.team} offense</option>
            <option value="def">{props.team} defense</option>
          </select>
          <select className="input" value={f.kind} onChange={(e) => set({ kind: e.target.value as Filters['kind'] })}>
            <option value="all">All plays</option>
            <option value="pass">Pass</option>
            <option value="run">Run</option>
            <option value="special">Special teams</option>
          </select>
        </div>
        <div className="row">
          <select className="input" value={f.down} onChange={(e) => set({ down: e.target.value })}>
            <option value="">Down</option>
            {[1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>
                {['1st', '2nd', '3rd', '4th'][d - 1]} down
              </option>
            ))}
          </select>
          <select className="input" value={f.qtr} onChange={(e) => set({ qtr: e.target.value })}>
            <option value="">Quarter</option>
            {[1, 2, 3, 4, 5].map((q) => (
              <option key={q} value={q}>
                {quarterLabel(q)}
              </option>
            ))}
          </select>
          <select className="input" value={f.status} onChange={(e) => set({ status: e.target.value as Filters['status'] })}>
            <option value="all">Status</option>
            <option value="ungraded">Ungraded</option>
            <option value="graded">Graded</option>
            <option value="flagged">Flagged</option>
            <option value="noted">Has notes</option>
          </select>
        </div>
        {props.hasParticipation && (
          <div className="row">
            <select className="input" value={f.formation} onChange={(e) => set({ formation: e.target.value })}>
              <option value="">Formation</option>
              {props.options.formation.map((o) => (
                <option key={o} value={o}>
                  {prettyEnum(o)}
                </option>
              ))}
            </select>
            <select className="input" value={f.personnel} onChange={(e) => set({ personnel: e.target.value })} title={`${props.team} personnel`}>
              <option value="">Personnel</option>
              {props.options.personnel.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select className="input" value={f.coverage} onChange={(e) => set({ coverage: e.target.value })}>
              <option value="">Coverage</option>
              {props.options.coverage.map((o) => (
                <option key={o} value={o}>
                  {prettyEnum(o)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="row faint" style={{ fontSize: 11.5 }}>
          {props.plays.length} of {props.total} plays
          <span className="spacer" />
          {active && (
            <a onClick={() => setFilters(NO_FILTERS)} style={{ fontSize: 11.5 }}>
              Clear filters
            </a>
          )}
        </div>
      </div>
      <div className="plays">
        {props.plays.map((p) => {
          const kind = playKind(p)
          const gs = props.playGrades(p.playId)
          const res = resultLabel(p)
          const good = p.posteam === props.team ? (p.epa ?? 0) > 0 : (p.epa ?? 0) < 0
          const n = props.notes.get(p.playId)
          return (
            <div
              key={p.playId}
              className={`play-row ${p.playId === props.currentId ? 'current' : ''} ${props.clipsByPlay.has(p.playId) ? '' : 'noclip'}`}
              onClick={() => props.onSelect(p.playId)}
            >
              <div className="top">
                <span className={`kind-dot ${kind}`} />
                <span>
                  {quarterLabel(p.qtr)} {p.time}
                </span>
                <span>·</span>
                <span>
                  {p.posteam} {p.down ? downDistance(p) : playTypeLabel(p.playType)}
                </span>
                {n?.flagged && <span style={{ color: 'var(--flag)' }}>⚑</span>}
                {n?.note.trim() && <span title="Has notes">✎</span>}
                <span className={`result ${p.epa === null ? '' : good ? 'good' : 'bad'}`}>{res}</span>
              </div>
              <div className="desc" title={p.desc}>
                {shortDesc(p.desc)}
              </div>
              {gs.length > 0 && (
                <div className="grade-pips" style={{ marginTop: 3 }}>
                  {gs.map((g) => (
                    <i key={g.playerId} style={{ background: g.grade! > 0 ? 'var(--plus)' : g.grade! < 0 ? 'var(--minus)' : '#6f7a88' }} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PlayInfo({ play, clip, flagged, onFlag }: { play: Play; clip: Clip | null; flagged: boolean; onFlag: () => void }) {
  const facts: [string, string][] = [
    ['Result', `${playTypeLabel(play.playType)}${play.yardsGained !== null ? `, ${play.yardsGained} yds` : ''}`],
    ['EPA', play.epa === null ? '—' : `${play.epa >= 0 ? '+' : ''}${play.epa.toFixed(2)}`]
  ]
  if (play.formation || play.offPersonnel) {
    facts.push(['Formation', prettyEnum(play.formation)])
    facts.push(['Off. personnel', play.offPersonnel ?? '—'])
    facts.push(['Def. personnel', play.defPersonnel ?? '—'])
    facts.push(['In the box', play.defendersInBox?.toString() ?? '—'])
    if (play.isPass) facts.push(['Rushers', play.passRushers?.toString() ?? '—'])
    if (play.coverage) facts.push(['Coverage', `${prettyEnum(play.coverage)}${play.manZone ? ` (${prettyEnum(play.manZone)})` : ''}`])
    if (play.isPass && play.wasPressure !== null) facts.push(['Pressure', play.wasPressure ? 'Yes' : 'No'])
  } else if (play.shotgun || play.noHuddle) {
    facts.push(['Look', [play.shotgun && 'Shotgun', play.noHuddle && 'No huddle'].filter(Boolean).join(', ')])
  }
  return (
    <div className="side-section">
      <div className="row">
        <span className="play-head">
          {quarterLabel(play.qtr)} {play.time} · {downDistance(play)}
          {play.yrdln ? ` at ${play.yrdln}` : ''}
        </span>
        <span className="spacer" />
        <button className={`btn small ${flagged ? 'active' : ''}`} onClick={onFlag} title="Flag this play for your cut-ups (F)">
          ⚑ {flagged ? 'Flagged' : 'Flag'}
        </button>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>
        {play.posteam} ball vs {play.defteam}
      </div>
      <div className="play-desc">{play.desc}</div>
      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {clip && (
        <div className="faint" style={{ fontSize: 11, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <a className="faint" onClick={() => api.revealClip(clip.path)} title="Show in Finder">
            {clip.fileName}
          </a>
        </div>
      )}
    </div>
  )
}

function PlayerGradeRow({
  index, season, playId, player, entry, tags, selected, starred, onSelect, onGrade, onTag, onStar, onNote
}: {
  index: number
  season: number
  playId: number
  player: RosterPlayer
  entry: GradeEntry | undefined
  tags: TagDef[]
  selected: boolean
  starred: boolean
  onSelect: () => void
  onGrade: (g: Grade) => void
  onTag: (t: TagDef) => void
  onStar: () => void
  onNote: (text: string) => void
}) {
  const g = entry?.grade ?? null
  // A label whose tag was since removed (or renamed in only one of the groups sharing it) still shows, so it can be cleared.
  const stale = (entry?.tags ?? []).filter((l) => !tags.some((t) => t.label === l))
  const shownTags = [
    ...(selected ? tags : tags.filter((t) => entry?.tags.includes(t.label))),
    ...stale.map((label, i): TagDef => ({ id: -1 - i, group: player.group, label, kind: 'neutral' }))
  ]
  return (
    <div className={`player-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="line">
        <span className="hot">{index < 9 ? index + 1 : ''}</span>
        <span
          className={`star ${starred ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onStar()
          }}
          title={starred ? 'Unstar' : 'Star: always list this player'}
        >
          {starred ? '★' : '☆'}
        </span>
        <span className="jersey">{player.jersey}</span>
        <span className="pname">
          <a
            style={{ color: 'inherit' }}
            onClick={(e) => {
              e.stopPropagation()
              navigate(links.player(season, player.id))
            }}
          >
            {player.name}
          </a>
        </span>
        <span className="ppos">{player.depthPos || player.position}</span>
        <div className="gbtns" onClick={(e) => e.stopPropagation()}>
          <button className={`gbtn minus ${g === -1 ? 'on' : ''}`} onClick={() => onGrade(-1)} title="Minus (-)">
            –
          </button>
          <button className={`gbtn zero ${g === 0 ? 'on' : ''}`} onClick={() => onGrade(0)} title="Zero (0)">
            0
          </button>
          <button className={`gbtn plus ${g === 1 ? 'on' : ''}`} onClick={() => onGrade(1)} title="Plus (=)">
            +
          </button>
        </div>
      </div>
      {shownTags.length > 0 && (
        <div className="tags" onClick={(e) => e.stopPropagation()}>
          {shownTags.map((t) => (
            <span
              key={t.id}
              className={`tag ${t.kind} ${entry?.tags.includes(t.label) ? 'on' : ''}`}
              onClick={() => {
                onSelect()
                onTag(t)
              }}
            >
              {selected && <span className="k">{TAG_KEYS[tags.indexOf(t)]?.toUpperCase()}</span>}
              {t.label}
            </span>
          ))}
        </div>
      )}
      {selected && (
        <input
          className="input"
          style={{ width: '100%', marginTop: 6, height: 26, fontSize: 12 }}
          placeholder={`Note on ${lastName(player.name)} this play`}
          defaultValue={entry?.note ?? ''}
          key={`${playId}-${player.id}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          onBlur={(e) => e.target.value !== (entry?.note ?? '') && onNote(e.target.value)}
        />
      )}
    </div>
  )
}

function ChartSelect({ field, value, onChange }: { field: ChartField; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <span className="faint" style={{ fontSize: 12 }}>
        {field.name}
      </span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </>
  )
}

function NoteBox({ value, onSave, inputRef }: { value: string; onSave: (v: string) => void; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState(value)
  return (
    <textarea
      ref={inputRef}
      className="input"
      style={{ width: '100%' }}
      rows={3}
      placeholder="What did you see on this play?"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
      onBlur={() => text !== value && onSave(text)}
    />
  )
}

const HOTKEYS: [string[], string][] = [
  [['Space'], 'Play / pause'],
  [['←', '→'], 'Step one frame'],
  [['⇧←', '⇧→'], 'Jump one second'],
  [['↑', '↓'], 'Previous / next play'],
  [['Enter'], 'Next play'],
  [['B'], 'Back to the snap (restart clip)'],
  [['[', ']'], 'Slower / faster'],
  [['L'], 'Loop on / off'],
  [['A'], 'Switch camera angle'],
  [['1–9'], 'Select a player'],
  [['Tab'], 'Next player (⇧Tab previous)'],
  [['='], 'Grade + (then next player)'],
  [['0'], 'Grade 0'],
  [['-'], 'Grade –'],
  [['⇧0'], 'Grade everyone left 0'],
  [['⌫'], 'Clear grade'],
  [['Q', '…', 'P'], 'Toggle the player’s tags'],
  [['D'], 'Draw on the film'],
  [['Z'], 'Undo last line'],
  [['C'], 'Clear drawing'],
  [['F'], 'Flag play'],
  [['N'], 'Write a play note'],
  [['?'], 'This help']
]

function HotkeyHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Hotkeys" onClose={onClose} width={680}>
      <div className="help-grid">
        {HOTKEYS.map(([keys, label]) => (
          <div key={label}>
            <span className="keys">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="faint" style={{ marginTop: 14 }}>
        Grading a player moves you to the next one, so a play goes: watch, then <Kbd>=</Kbd>/<Kbd>0</Kbd>/<Kbd>-</Kbd> down the
        list, then <Kbd>↓</Kbd>. Turn on auto-advance in Settings to jump to the next play after the last player.
      </p>
    </Modal>
  )
}
