import { type CSSProperties, type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { clipUrl } from '@shared/api'
import type { Shape } from '@shared/drawing'
import { durationLabel, playCaption } from '@shared/labels'
import { clipStartTime } from '@shared/snap'
import type { Angle, Clip, GameInfo, Grade, Play, PlayRef } from '@shared/types'
import { Button } from '../../ui/Button'
import { Hud, HudButton } from '../../ui/Hud'
import { Icon } from '../../ui/Icon'
import { type MenuItemSpec, openMenu } from '../../ui/Menu'
import { useCommand, useDynamicMenus } from '../../shell/commands'
import { action, sep, showMenu, submenu } from '../../shell/contextMenus'
import { openImport } from '../../shell/importRequest'
import { useEscape } from '../../shell/keyRouter'
import { links, navigate } from '../../shell/router'
import { useSettings } from '../../shell/store'
import { setUi, useUi } from '../../shell/uiState'
import { api } from '../../api'
import { readLocal, useMeasure, writeLocal } from './hooks'
import { ANGLE_LABEL, ANGLE_NAME, playMenu } from './playMenu'
import { PlayRow } from './PlayRow'
import { drawShapes, letterbox } from './reel/drawShapes'
import { requestAddToCutup } from './requests'

/**
 * Reel Player (03 §2.6): plays a list of plays from any games in order, each from its start point (the snap minus
 * the pre-roll). A self-contained engine: one video element per pane, angle switching, side-by-side angles kept in
 * sync, read-only drawings, a transport HUD and the Playback commands. The props follow the spec, so the pane can
 * later move onto the tape room's shared playback engine (02 §20) without changing callers.
 */

export interface ReelEntry {
  ref: PlayRef
  game: GameInfo
  /** Whose side EPA and captions use. */
  team: string
  play: Play | null
  clips: Clip[]
  drawing: Partial<Record<Angle, Shape[]>> | null
  grade?: Grade | null
  critical?: boolean
  tags?: string[]
  /** The grade note. */
  note?: string
  /** The play note (shown when there is no grade note). */
  playNote?: string
  flagged?: boolean
  teamEpa?: number | null
}

export interface ReelHandle {
  /** Starts the first entry with auto-advance on. */
  playAll(): void
  /** Plays entry `key`; `advance` turns auto-advance on (↓) or off (a row click). */
  play(key: string, advance?: boolean): void
  pause(): void
}

export const entryKey = (e: { ref: PlayRef }) => `${e.ref.gameId}:${e.ref.playId}`

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2]
const ANGLE_ORDER: Angle[] = ['sideline', 'main', 'endzone']
const FRAME = 1 / 30

export interface ReelPlayerProps {
  entries: ReelEntry[]
  /** The current entry's key (`entryKey`); null = the first. */
  current: string | null
  onCurrentChange: (key: string) => void
  /** `side`: stage + caption with the play list beside it (Player › Film); `stack`: the stage alone (Cut-up). */
  layout?: 'side' | 'stack'
  /** Where the chosen angle is remembered. */
  angleKey?: string
  /** Always advance at the end of a play (the Cut-up player). Otherwise Play All and ↓ turn it on, a row click off. */
  autoAdvance?: boolean
  /** Imperative handle (Play All from a screen's button). */
  handle?: Ref<ReelHandle>
  /** Player focus when opening the tape room. */
  playerId?: string
  /** Registers the Playback commands and keys (only while the reel is the visible section). Default true. */
  keys?: boolean
  /** Rows' data-test in the list. */
  rowTest?: string
  /** The list's selection (keys), for Add to Cut-up and Export; defaults to the current play. */
  selection?: string[]
  onSelectionChange?: (keys: string[]) => void
  /** Stage radius 0 when it fills a region edge to edge. */
  edge?: boolean
  test?: string
}

function pickClip(clips: Clip[], playId: number, angle: Angle): Clip | null {
  const mine = clips.filter((c) => c.playId === playId)
  return mine.find((c) => c.angle === angle) ?? ANGLE_ORDER.map((a) => mine.find((c) => c.angle === a)).find(Boolean) ?? mine[0] ?? null
}

function anglesOf(clips: Clip[], playId: number): Angle[] {
  const set = new Set(clips.filter((c) => c.playId === playId).map((c) => c.angle))
  return (['sideline', 'endzone', 'main'] as Angle[]).filter((a) => set.has(a))
}

export function ReelPlayer({
  entries,
  current,
  onCurrentChange,
  layout = 'side',
  angleKey = 'ui.reel.angle',
  autoAdvance: alwaysAdvance = false,
  handle,
  playerId,
  keys = true,
  rowTest = 'reel-item',
  selection,
  onSelectionChange,
  edge,
  test = 'reel'
}: ReelPlayerProps) {
  const settings = useSettings()
  const startOpts = { startAtSnap: settings?.startAtSnap ?? true, preRoll: settings?.preRoll ?? 1 }
  const index = Math.max(0, entries.findIndex((e) => entryKey(e) === current))
  const entry = entries[index] ?? null
  const [angle, setAngleState] = useState<Angle>(() => readLocal<Angle>(angleKey, 'sideline'))
  const [sideBySide, setSideBySide] = useState(false)
  const [speed, setSpeed] = useState<number>(() => settings?.defaultSpeed ?? 1)
  const [loop, setLoop] = useState(false)
  const [sound, setSound] = useState(() => readLocal('ui.reel.sound', false))
  const [drawingsOn, setDrawingsOn] = useState(() => readLocal('ui.reel.drawings', true))
  const [advance, setAdvance] = useState(alwaysAdvance)
  const [playing, setPlaying] = useState(false)
  const [done, setDone] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState<number | null>(null)
  const [hudShown, setHudShown] = useState(true)
  const filmOnly = useUi().filmOnly
  const wantPlay = useRef(false)
  const videoA = useRef<HTMLVideoElement>(null)
  const videoB = useRef<HTMLVideoElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [rootRef, rootWidth] = useMeasure<HTMLDivElement>(1136)
  const listRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const auto = alwaysAdvance || advance

  const angles = entry ? anglesOf(entry.clips, entry.ref.playId) : []
  const clip = entry ? pickClip(entry.clips, entry.ref.playId, angle) : null
  const second = sideBySide && clip ? pickClip(entry!.clips.filter((c) => c.angle !== clip.angle), entry!.ref.playId, 'endzone') : null
  const start = clip ? clipStartTime(clip, startOpts) : 0
  const startB = second ? clipStartTime(second, startOpts) : 0
  const snapAt = clip?.snapMs != null ? clip.snapMs / 1000 : null
  const stacked = layout === 'side' && rootWidth < 900

  const setAngle = useCallback(
    (a: Angle) => {
      setAngleState(a)
      writeLocal(angleKey, a)
    },
    [angleKey]
  )

  // Load: a new clip resets the play state; wantPlay decides whether it starts.
  useEffect(() => {
    setDone(false)
    setFailed(null)
    setTime(start)
    setDuration(clip?.duration ?? 0)
  }, [clip?.id, start])

  const go = useCallback(
    (key: string, opts: { play?: boolean; advance?: boolean } = {}) => {
      if (opts.advance !== undefined && !alwaysAdvance) setAdvance(opts.advance)
      wantPlay.current = opts.play ?? true
      setDone(false)
      if (key === current) {
        const v = videoA.current
        if (v && clip) {
          v.currentTime = start
          if (wantPlay.current) void v.play().catch(() => {})
        }
      } else onCurrentChange(key)
    },
    [alwaysAdvance, current, onCurrentChange, clip, start]
  )

  const step = useCallback(
    (delta: number, opts: { advance?: boolean } = {}) => {
      const next = entries[index + delta]
      if (next) go(entryKey(next), { play: true, advance: opts.advance })
    },
    [entries, index, go]
  )

  const playAll = useCallback(() => {
    if (!entries.length) return
    if (!alwaysAdvance) setAdvance(true)
    go(entryKey(entries[0]), { play: true })
  }, [entries, alwaysAdvance, go])

  const toggle = useCallback(() => {
    const v = videoA.current
    if (done) return playAll()
    if (!v || !clip) return
    if (v.paused) {
      wantPlay.current = true
      if (v.currentTime >= (v.duration || Infinity) - 0.05) v.currentTime = start
      void v.play().catch(() => {})
    } else {
      wantPlay.current = false
      v.pause()
    }
  }, [done, playAll, clip, start])

  useImperativeHandle(handle, () => ({
    playAll,
    play: (key, adv) => go(key, { play: true, advance: adv }),
    pause: () => {
      wantPlay.current = false
      videoA.current?.pause()
    }
  }))

  // No film for this play: while playing all, move on after 2 s.
  useEffect(() => {
    if (!entry || clip || !auto || !wantPlay.current) return
    const t = setTimeout(() => {
      if (index + 1 < entries.length) step(1)
      else setDone(true)
    }, 2000)
    return () => clearTimeout(t)
  }, [entry, clip, auto, index, entries.length, step])

  const seek = useCallback(
    (t: number) => {
      const v = videoA.current
      if (!v) return
      const max = v.duration || duration || t
      v.currentTime = Math.max(0, Math.min(max, t))
      setTime(v.currentTime)
      setDone(false)
    },
    [duration]
  )

  const nextAngle = useCallback(() => {
    if (angles.length < 2 || !clip) return
    const i = angles.indexOf(clip.angle)
    wantPlay.current = playing
    setAngle(angles[(i + 1) % angles.length])
  }, [angles, clip, playing, setAngle])

  const enterFilmOnly = useCallback(() => setUi({ filmOnly: !filmOnly }), [filmOnly])
  useEscape(() => {
    if (!filmOnly) return false
    setUi({ filmOnly: false })
    return true
  }, filmOnly)
  useEffect(() => () => setUi({ filmOnly: false }), [])

  const openTape = useCallback(() => {
    if (!entry) return
    navigate(links.tape(entry.ref.gameId, entry.team, { play: entry.ref.playId, player: playerId, focus: !!playerId }))
  }, [entry, playerId])

  const selected = selection ?? (entry ? [entryKey(entry)] : [])
  const selectedRefs = () => entries.filter((e) => selected.includes(entryKey(e))).map((e) => e.ref)

  // Commands (§2.6 keys) while the reel is on screen.
  const on = keys && entries.length > 0
  useCommand('play.playAll', playAll, { enabled: on })
  useCommand('play.toggle', toggle, { enabled: on && (!!clip || done), label: playing ? 'Pause' : 'Play' })
  useCommand('play.prevPlay', () => step(-1), { enabled: on && index > 0 })
  useCommand(
    'play.nextPlay',
    () => {
      // ↩ shares play.nextPlay in the keymap; on a reel it opens the tape room at this play (§2.6).
      const ev = window.event as KeyboardEvent | undefined
      if (ev?.type === 'keydown' && ev.key === 'Enter') return openTape()
      step(1, { advance: true })
    },
    { enabled: on }
  )
  useCommand('play.frameBack', () => seek((videoA.current?.currentTime ?? 0) - FRAME), { enabled: on && !!clip })
  useCommand('play.frameForward', () => seek((videoA.current?.currentTime ?? 0) + FRAME), { enabled: on && !!clip })
  useCommand('play.secondBack', () => seek((videoA.current?.currentTime ?? 0) - 1), { enabled: on && !!clip })
  useCommand('play.secondForward', () => seek((videoA.current?.currentTime ?? 0) + 1), { enabled: on && !!clip })
  useCommand(
    'play.toSnap',
    () => {
      seek(start)
      wantPlay.current = true
      void videoA.current?.play().catch(() => {})
    },
    { enabled: on && !!clip }
  )
  useCommand('play.slower', () => setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)] ?? 1), { enabled: on && speed > SPEEDS[0] })
  useCommand('play.faster', () => setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)] ?? 1), { enabled: on && speed < SPEEDS[SPEEDS.length - 1] })
  useCommand('play.speed', (arg) => arg && setSpeed(Number(arg)), { enabled: on })
  useCommand('play.loop', () => setLoop((l) => !l), { enabled: on, checked: loop })
  useCommand(
    'play.sound',
    () =>
      setSound((s) => {
        writeLocal('ui.reel.sound', !s)
        return !s
      }),
    { enabled: on, checked: sound }
  )
  useCommand('play.angle', (arg) => arg && setAngle(arg as Angle), { enabled: on && angles.length > 1 })
  useCommand('play.nextAngle', nextAngle, { enabled: on && angles.length > 1 })
  useCommand('play.sideBySide', () => setSideBySide((s) => !s), { enabled: on && angles.length > 1, checked: sideBySide })
  useCommand('play.autoAdvance', () => setAdvance((a) => !a), { enabled: on && !alwaysAdvance, checked: auto })
  useCommand('view.filmOnly', enterFilmOnly, { enabled: on, label: filmOnly ? 'Exit Film Only' : 'Enter Film Only' })
  useCommand('grade.addToCutup', () => void requestAddToCutup(selectedRefs(), stageRef.current), { enabled: on && selected.length > 0 })
  useDynamicMenus(
    keys
      ? {
          speed,
          angles: (['sideline', 'endzone', 'main'] as Angle[]).map((a) => ({ angle: a, label: ANGLE_LABEL[a], enabled: angles.includes(a), checked: clip?.angle === a })),
          layout: sideBySide ? 'sideBySide' : 'single'
        }
      : {}
  )

  // Playback rate and sound follow the controls.
  useEffect(() => {
    for (const v of [videoA.current, videoB.current]) if (v) v.playbackRate = speed
  }, [speed, clip?.id, second?.id])
  useEffect(() => {
    if (videoA.current) videoA.current.muted = !sound
    if (videoB.current) videoB.current.muted = true
  }, [sound, clip?.id, second?.id])

  // Side-by-side: the second pane follows the first, offset by each clip's start point.
  useEffect(() => {
    if (!second) return
    let raf = 0
    const tick = () => {
      const a = videoA.current
      const b = videoB.current
      if (a && b && b.readyState >= 1) {
        const target = startB + (a.currentTime - start)
        if (Math.abs(b.currentTime - target) > 0.12) b.currentTime = Math.max(0, target)
        if (a.paused !== b.paused) {
          if (a.paused) b.pause()
          else void b.play().catch(() => {})
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [second, start, startB])

  // HUD auto-hide while playing (01 §6.21).
  const poke = useCallback(() => {
    setHudShown(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHudShown(false), 2500)
  }, [])
  useEffect(() => {
    if (!playing) {
      setHudShown(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    } else poke()
  }, [playing, poke])

  // The current row stays in view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const videoHandlers = {
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget
      setDuration(v.duration || 0)
      v.playbackRate = speed
      v.muted = !sound
      if (Math.abs(v.currentTime - start) > 0.05) v.currentTime = start
      if (wantPlay.current) void v.play().catch(() => {})
    },
    onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => setTime(e.currentTarget.currentTime),
    onSeeked: (e: React.SyntheticEvent<HTMLVideoElement>) => setTime(e.currentTarget.currentTime),
    onPlay: () => {
      setPlaying(true)
      window.shell?.setPlaybackActive?.(true)
    },
    onPause: () => {
      setPlaying(false)
      window.shell?.setPlaybackActive?.(false)
    },
    onEnded: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget
      if (loop) {
        v.currentTime = start
        void v.play().catch(() => {})
        return
      }
      if (auto && index + 1 < entries.length) step(1)
      else if (index + 1 >= entries.length && auto) setDone(true)
      else wantPlay.current = false
    },
    onError: () => clip && setFailed(clip.id)
  }

  const stageMenu = (e: React.MouseEvent) => {
    if (!clip) return
    void showMenu(e, [
      action(playing ? 'Pause' : 'Play', toggle, { accelerator: 'Space' }),
      action('Go to Snap', () => seek(start), { accelerator: 'B' }),
      sep(),
      submenu(
        'Angle',
        angles.map((a) => action(ANGLE_LABEL[a], () => setAngle(a), { checked: clip.angle === a }))
      ),
      action('Side-by-Side Angles', () => setSideBySide((s) => !s), { checked: sideBySide, enabled: angles.length > 1, accelerator: 'S' }),
      sep(),
      action('Copy Frame', () => copyFrame(videoA.current, entry?.drawing?.[clip.angle] ?? [], drawingsOn)),
      action('Show Clip in Finder', () => void api.revealClip(clip.path))
    ])
  }

  const segment = Math.max(0, (duration || clip?.duration || 0) - start)
  const elapsed = Math.max(0, time - start)
  const hudWidth = Math.min(560, Math.max(280, (stageRef.current?.clientWidth ?? 749) - 48))

  const stage = (
    <div
      ref={stageRef}
      className={`reel-stage${edge ? ' reel-stage--edge' : ''}${filmOnly ? ' reel-stage--film-only' : ''}${second ? ' reel-stage--split' : ''}`}
      data-test={`${test}-stage`}
      onMouseMove={playing ? poke : undefined}
      onContextMenu={stageMenu}
    >
      {!entry ? null : !clip ? (
        <div className="reel-stage__empty">
          <Icon name="film" size={32} />
          <div className="reel-stage__empty-title">No film for this play</div>
          <Button variant="borderless" size="sm" label="Import Film…" onClick={() => openImport({ game: entry.game, team: entry.team })} />
        </div>
      ) : failed === clip.id ? (
        <div className="reel-stage__empty">
          <Icon name="video-off" size={32} />
          <div className="reel-stage__empty-title">This clip couldn’t be played. The file may have moved or uses a format the player can’t open.</div>
          <Button
            variant="borderless"
            size="sm"
            label="Fix Clip Matches…"
            onClick={() => openImport({ game: entry.game, team: entry.team, existing: entry.clips.map((c) => ({ path: c.path, fileName: c.fileName, angle: c.angle, playId: c.playId })) })}
          />
        </div>
      ) : (
        <>
          <Pane
            clip={clip}
            videoRef={videoA}
            shapes={drawingsOn ? (entry.drawing?.[clip.angle] ?? []) : []}
            handlers={videoHandlers}
            onClick={toggle}
          />
          {second && <Pane clip={second} videoRef={videoB} shapes={drawingsOn ? (entry.drawing?.[second.angle] ?? []) : []} muted onClick={toggle} />}
          <Hud hidden={!hudShown} className="reel-hud" style={{ width: hudWidth } as CSSProperties}>
            <HudButton icon="skip-back" label="Previous Play (↑)" onClick={() => step(-1)} disabled={index === 0} />
            <HudButton icon={done ? 'rotate-ccw' : playing ? 'pause' : 'play'} label={done ? 'Replay All' : playing ? 'Pause (Space)' : 'Play (Space)'} onClick={toggle} test="reel-play" />
            <HudButton icon="skip-forward" label="Next Play (↓)" onClick={() => step(1, { advance: true })} disabled={index + 1 >= entries.length} />
            <span className="reel-hud__time num">
              {durationLabel(elapsed)} / {durationLabel(segment)}
            </span>
            <Scrubber start={start} end={duration || clip.duration || 0} snap={snapAt} time={time} onSeek={seek} />
            <HudPopup
              icon="video"
              label="Angle (A)"
              disabled={angles.length < 2}
              items={() => angles.map((a) => ({ label: ANGLE_LABEL[a], checked: clip.angle === a, run: () => setAngle(a) }))}
            />
            <HudButton icon="columns-2" label="Side-by-Side Angles (S)" on={sideBySide} disabled={angles.length < 2} onClick={() => setSideBySide((s) => !s)} />
            <HudPopup
              icon="gauge"
              label="Speed ([ and ])"
              text={speed === 1 ? undefined : `${speed}×`}
              items={() => SPEEDS.map((s) => ({ label: `${s}×`, checked: s === speed, run: () => setSpeed(s) }))}
            />
            <HudButton icon="repeat" label="Loop (L)" on={loop} onClick={() => setLoop((l) => !l)} />
            <HudButton
              icon="pen-line"
              label={drawingsOn ? 'Hide Drawings' : 'Show Drawings'}
              on={drawingsOn}
              onClick={() =>
                setDrawingsOn((d) => {
                  writeLocal('ui.reel.drawings', !d)
                  return !d
                })
              }
            />
            <HudButton icon={filmOnly ? 'minimize-2' : 'maximize-2'} label={filmOnly ? 'Exit Film Only (⇧⌘F)' : 'Film Only (⇧⌘F)'} onClick={enterFilmOnly} />
          </Hud>
        </>
      )}
      {clip && failed !== clip.id && (
        <span className="reel-stage__angle">
          {ANGLE_NAME[clip.angle]}
          {second ? ` · ${ANGLE_NAME[second.angle]}` : ''}
        </span>
      )}
    </div>
  )

  const caption = entry && layout === 'side' && (
    <div className="reel-caption">
      <div className="reel-caption__line1">
        <span className="reel-caption__title ellipsis">{playCaption(entry.game, entry.team, entry.play)}</span>
        <span className="reel-caption__count">
          {index + 1} of {entries.length}
        </span>
        <Button variant="borderless" size="sm" label="Open in Tape Room" onClick={openTape} test="reel-open-tape" />
      </div>
      {entry.play && <div className="reel-caption__desc selectable">{entry.play.desc}</div>}
      {(entry.note || entry.playNote) && (
        <div className="reel-caption__note">
          <Icon name="message-square-text" size={12} />
          <span className="selectable">{entry.note || entry.playNote}</span>
        </div>
      )}
    </div>
  )

  if (layout === 'stack') {
    return (
      <div ref={rootRef} className="reel reel--stack" data-test={test}>
        {stage}
      </div>
    )
  }

  const onRowClick = (e: ReelEntry, ev: React.MouseEvent) => {
    const key = entryKey(e)
    if ((ev.metaKey || ev.shiftKey) && onSelectionChange) {
      if (ev.shiftKey) {
        const a = entries.findIndex((x) => entryKey(x) === (selected[selected.length - 1] ?? current))
        const b = entries.indexOf(e)
        const [lo, hi] = a < b ? [a, b] : [b, a]
        onSelectionChange(Array.from(new Set([...selected, ...entries.slice(Math.max(0, lo), hi + 1).map(entryKey)])))
      } else onSelectionChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key])
      return
    }
    onSelectionChange?.([key])
    go(key, { play: true, advance: false })
  }

  return (
    <div ref={rootRef} className={`reel reel--side${stacked ? ' reel--stacked' : ''}`} data-test={test}>
      <div className="reel__main">
        {stage}
        {caption}
      </div>
      <div className="reel__list" ref={listRef} role="listbox" aria-label="Plays" aria-multiselectable>
        {entries.map((e) => {
          const key = entryKey(e)
          return (
            <PlayRow
              key={key}
              item={{ ...e, hasNote: !!(e.note || e.playNote) }}
              current={key === entryKey(entry ?? e) && !!entry}
              selected={selected.includes(key)}
              test={rowTest}
              dragPlays={() => (selected.includes(key) ? selectedRefs() : [e.ref])}
              onClick={(ev) => onRowClick(e, ev)}
              onDoubleClick={() => navigate(links.tape(e.ref.gameId, e.team, { play: e.ref.playId, player: playerId, focus: !!playerId }))}
              onContextMenu={(ev) => {
                ev.preventDefault()
                const target = { ...e, flagged: !!e.flagged, playerId }
                void playMenu(target).then((items) => showMenu(null, items))
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** One angle: the video with its drawings canvas over the letterboxed picture. */
function Pane({
  clip,
  videoRef,
  shapes,
  handlers,
  muted,
  onClick
}: {
  clip: Clip
  videoRef: React.RefObject<HTMLVideoElement | null>
  shapes: Shape[]
  handlers?: Partial<Record<string, (e: React.SyntheticEvent<HTMLVideoElement>) => void>>
  muted?: boolean
  onClick: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    const v = videoRef.current
    if (!c || !v) return
    let raf = 0
    let last = -1
    const draw = () => {
      const t = v.currentTime
      if (t !== last || c.width !== Math.round(c.clientWidth * (window.devicePixelRatio || 1))) {
        last = t
        drawShapes(c, shapes, t, letterbox(c.clientWidth, c.clientHeight, v.videoWidth, v.videoHeight), FRAME)
      }
      raf = requestAnimationFrame(draw)
    }
    if (shapes.length) raf = requestAnimationFrame(draw)
    else drawShapes(c, [], 0, { x: 0, y: 0, w: 0, h: 0 })
    return () => cancelAnimationFrame(raf)
  }, [shapes, videoRef, clip.id])
  return (
    <div className="reel-pane" onClick={onClick}>
      <video
        ref={videoRef}
        className="reel-pane__video"
        src={clipUrl(clip.id)}
        preload="auto"
        playsInline
        muted={muted ?? true}
        {...(handlers as object)}
      />
      <canvas ref={canvas} className="reel-pane__canvas" aria-hidden />
    </div>
  )
}

/** The custom scrubber: the segment from the start point to the clip's end, the pre-roll before the snap shaded. */
function Scrubber({ start, end, snap, time, onSeek }: { start: number; end: number; snap: number | null; time: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const span = Math.max(0.001, end - start)
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - start) / span) * 100))}%`
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return start + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span
  }
  return (
    <div
      ref={ref}
      className="reel-scrub"
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(span)}
      aria-valuenow={Math.round(time - start)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        onSeek(at(e.clientX))
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(at(e.clientX))
      }}
    >
      <span className="reel-scrub__track">
        {snap !== null && snap > start && <span className="reel-scrub__preroll" style={{ width: pct(snap) }} />}
        <span className="reel-scrub__played" style={{ width: pct(time) }} />
      </span>
      <span className="reel-scrub__knob" style={{ left: pct(time) }} />
    </div>
  )
}

function HudPopup({ icon, label, text, items, disabled }: { icon: 'video' | 'gauge'; label: string; text?: string; items: () => MenuItemSpec[]; disabled?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      className="hud__button reel-hud__popup"
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault()
        if (ref.current) openMenu({ anchor: ref.current, items: items(), placement: 'above' })
      }}
    >
      <Icon name={icon} size={18} />
      {text && <span className="reel-hud__popup-text">{text}</span>}
    </button>
  )
}

/** Copy Frame: the current frame with its drawings, to the clipboard. */
function copyFrame(v: HTMLVideoElement | null, shapes: Shape[], drawings: boolean) {
  if (!v || !v.videoWidth) return
  const c = document.createElement('canvas')
  c.width = v.videoWidth
  c.height = v.videoHeight
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.drawImage(v, 0, 0)
  if (drawings && shapes.length) {
    const overlay = document.createElement('canvas')
    overlay.style.width = `${c.width}px`
    overlay.style.height = `${c.height}px`
    Object.defineProperty(overlay, 'clientWidth', { value: c.width })
    Object.defineProperty(overlay, 'clientHeight', { value: c.height })
    drawShapes(overlay, shapes, v.currentTime, { x: 0, y: 0, w: c.width, h: c.height }, FRAME)
    ctx.drawImage(overlay, 0, 0, c.width, c.height)
  }
  window.shell.copyImage(c.toDataURL('image/png'))
}

