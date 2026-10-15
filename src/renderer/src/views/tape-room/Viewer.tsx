import { type CSSProperties, type MutableRefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Shape, shapeVisibleAt } from '@shared/drawing'
import { gradeScore, tallyOf } from '@shared/stats'
import type { Angle, Clip, TeamGame } from '@shared/types'
import { api } from '../../api'
import { runCommand } from '../../shell/commands'
import { action, sep, showMenu, submenu } from '../../shell/contextMenus'
import { setUi } from '../../shell/uiState'
import { type MenuItemSpec, openMenu } from '../../ui/Menu'
import { isTyping, noMouseFocus } from '../../ui/keyboard'
import { Icon } from '../../ui/Icon'
import { AnglePane, fitPicture, PaneMessage, type Rect } from '../../ui/video/AnglePane'
import { DrawingLane, laneRows } from '../../ui/video/DrawingLane'
import { drawShapes } from '../../ui/video/drawShapes'
import { useVideoState, type VideoEngine } from '../../ui/video/engine'
import { quantize } from '../../ui/video/frameLength'
import { secondsLabel } from '../../ui/video/time'
import { TransportHud, transportHudHeight, transportHudWidth } from '../../ui/video/TransportHud'
import { ViewerToast } from '../../ui/video/ViewerToast'
import { DrawLayer, DrawPalette, PALETTE_HEIGHT, shapeMenu } from './DrawPalette'
import { GradingHud } from './GradingHud'
import { angleLabel, angleTitle, type EndPanel, type Layout, type Room, weekName } from './model'
import { readPref, writePref } from './prefs'

/**
 * The viewer (02 §5, §8, §13.3): one or two angle panes in Single, Side by Side or Picture in Picture, per-pane
 * states, the transport HUD with the angle popup and drawing lane, auto-hide, gestures, the video and snap menus,
 * the toast, Film Only's grading HUD, Draw mode's palette and layer, and the end-of-list panel.
 */

export interface ViewerActions {
  setSnapHere(): void
  clearSnap(): void
  goToSnap(): void
  nudgeSnap(dir: 1 | -1): void
  chooseAngle(a: Angle): void
  chooseLayout(l: Layout): void
  swapAngles(): void
  setSecondAngle(a: Angle): void
  toggleDraw(): void
  copyFrame(a: Angle): void
  switchTeam(): void
  firstPlay(): void
  firstUngraded(): void
  continueIn(g: TeamGame): void
  teamGames: TeamGame[]
  exportVideo(): void
  deleteShape(): void
  duplicateShape(): void
  arrange(front: boolean): void
  gradedPlays: number
  startPoint: number | null
  snap: number | null
  playAngles: Angle[]
  twoPane: boolean
  primary: Angle
  second: Angle
}

type Corner = 'tl' | 'tr' | 'bl' | 'br'
const GAP = 4

/** Copies a pane's frame at the video's native size, with its visible shapes, to the clipboard (02 §16.3). */
export async function copyFrame(engine: VideoEngine, angle: Angle, shapes: readonly Shape[]) {
  const video = engine.videoOf(angle)
  if (!video || !video.videoWidth) return
  const st = engine.getState().panes[angle]
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(video, 0, 0)
  drawShapes(ctx, shapes, { x: 0, y: 0, w: canvas.width, h: canvas.height }, st?.time ?? video.currentTime, st?.frame ?? 1 / 30)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

interface PaneGeo {
  angle: Angle
  clip: Clip | null
  pane: Rect
  picture: Rect
  inset?: boolean
}

export function Viewer({
  room,
  filmOnly,
  hideControls,
  timeMode,
  onTimeMode,
  endPanel,
  onEndPanel,
  pokeRef,
  onViewerClick,
  actions
}: {
  room: Room
  filmOnly: boolean
  hideControls: boolean
  timeMode: 'snap' | 'clip'
  onTimeMode: () => void
  endPanel: EndPanel | null
  onEndPanel: (p: EndPanel | null) => void
  pokeRef: MutableRefObject<() => void>
  onViewerClick: () => void
  actions: ViewerActions
}) {
  const { video, layout, current, active, panes, drawMode } = room
  const engine = video.engine
  const el = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    const update = () => setSize({ w: node.clientWidth, h: node.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  // Engine state the layout needs: each pane's picture aspect and error, the time, duration and play state.
  const vs = useVideoState(video, (s) => {
    const out: Record<string, string | number | boolean> = { playing: s.playing, duration: s.duration, time: s.time, ready: s.ready }
    for (const p of Object.values(s.panes)) {
      out[`a:${p.id}`] = p.width && p.height ? p.width / p.height : 16 / 9
      out[`e:${p.id}`] = p.error ?? ''
    }
    return out
  })
  const aspectOf = (a: Angle) => (vs[`a:${a}`] as number | undefined) ?? 16 / 9
  const errorOf = (a: Angle) => (vs[`e:${a}`] as string | undefined) || null
  const playing = !!vs.playing
  const duration = (vs.duration as number) || 0

  // ── Geometry (02 §5.1) ──────────────────────────────────────────────────
  const W = size.w
  const H = size.h
  const [pipCorner, setPipCorner] = useState<Corner>(() => readPref<Corner>('ui.tape.pipCorner', 'tr'))
  const [pipDrag, setPipDrag] = useState<{ dx: number; dy: number } | null>(null)
  const geo: PaneGeo[] = []
  let arrangement: 'lr' | 'tb' | null = null
  if (panes.length === 2 && layout === 'sideBySide') {
    const asp = aspectOf(panes[0].angle)
    const lrPane = { x: 0, y: 0, w: (W - GAP) / 2, h: H }
    const tbPane = { x: 0, y: 0, w: W, h: (H - GAP) / 2 }
    const lr = fitPicture(lrPane, asp)
    const tb = fitPicture(tbPane, asp)
    arrangement = lr.w * lr.h >= tb.w * tb.h ? 'lr' : 'tb'
    panes.forEach((p, i) => {
      const pane =
        arrangement === 'lr'
          ? { x: i * ((W + GAP) / 2), y: 0, w: (W - GAP) / 2, h: H }
          : { x: 0, y: i * ((H + GAP) / 2), w: W, h: (H - GAP) / 2 }
      geo.push({ angle: p.angle, clip: p.clip, pane, picture: fitPicture(pane, aspectOf(p.angle)) })
    })
  } else if (panes.length === 2 && layout === 'pip') {
    const main = { x: 0, y: 0, w: W, h: H }
    const mainPic = fitPicture(main, aspectOf(panes[0].angle))
    geo.push({ angle: panes[0].angle, clip: panes[0].clip, pane: main, picture: mainPic })
    const iw = Math.max(200, Math.min(480, W * 0.3))
    const ih = iw / aspectOf(panes[1].angle)
    const left = pipCorner.endsWith('l') ? mainPic.x + 16 : mainPic.x + mainPic.w - iw - 16
    const top = pipCorner.startsWith('t') ? mainPic.y + 16 : mainPic.y + mainPic.h - ih - 16
    const inset = { x: left + (pipDrag?.dx ?? 0), y: top + (pipDrag?.dy ?? 0), w: iw, h: ih }
    geo.push({ angle: panes[1].angle, clip: panes[1].clip, pane: inset, picture: inset, inset: true })
  } else if (panes.length) {
    const pane = { x: 0, y: 0, w: W, h: H }
    geo.push({ angle: panes[0].angle, clip: panes[0].clip, pane, picture: fitPicture(pane, aspectOf(panes[0].angle)) })
  }
  const activeGeo = geo.find((g) => g.angle === active) ?? geo[0]
  const lowest = geo.filter((g) => !g.inset).reduce((m, g) => Math.max(m, g.picture.y + g.picture.h), 0)

  // ── Auto-hide (02 §5.7) ─────────────────────────────────────────────────
  const [chromeShown, setChromeShown] = useState(true)
  const inside = useRef(false)
  const pins = useRef({ hud: false, menu: false, drag: false })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playingRef = useRef(playing)
  playingRef.current = playing
  const drawRef = useRef(drawMode)
  drawRef.current = drawMode
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const p = pins.current
    if (p.hud || p.menu || p.drag || drawRef.current) return setChromeShown(true)
    if (playingRef.current) {
      if (!inside.current) return setChromeShown(false)
      timer.current = setTimeout(() => setChromeShown(false), 2500)
    } else if (!inside.current) {
      timer.current = setTimeout(() => setChromeShown(false), 1000)
    }
  }, [])
  const poke = useCallback(() => {
    setChromeShown(true)
    schedule()
  }, [schedule])
  pokeRef.current = poke
  useEffect(() => {
    poke()
  }, [playing, drawMode, poke])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const pin = (k: keyof typeof pins.current, on: boolean) => {
    pins.current[k] = on
    if (on) setChromeShown(true)
    schedule()
  }
  const hudHidden = hideControls || !chromeShown
  const cursorHidden = !chromeShown && playing && !drawMode

  // ── Pane states (02 §5.11) ──────────────────────────────────────────────
  const compact = (g: PaneGeo) => g.pane.h < 240
  const fix = () => room.fixMatches(current?.playId)
  const messageFor = (g: PaneGeo, i: number): React.ReactNode => {
    const c = compact(g)
    if (!room.hasFilm) {
      if (i > 0) return null
      return (
        <PaneMessage
          test="no-film"
          icon="film"
          compact={c}
          title="No film for this game yet"
          body={`Import the All-22 clips for ${room.game.awayTeam} @ ${room.game.homeTeam}, ${weekName(room.game)}. You can grade from the play-by-play in the meantime.`}
          action={{ label: 'Import Film…', primary: true, run: () => runCommand('file.importFilm') }}
        />
      )
    }
    if (!g.clip) {
      if (room.currentClips.length && (i > 0 || geo.length > 1)) {
        return <PaneMessage test="no-clip-angle" icon="video-off" compact={c} title={`No ${angleLabel(g.angle).toLowerCase()} clip`} action={{ label: 'Fix Clip Matches…', borderless: true, run: fix }} />
      }
      if (i > 0) return null
      return (
        <PaneMessage
          test="no-clip"
          icon="video-off"
          compact={c}
          title="No clip for this play"
          body="This play isn’t matched to a clip. If the clips are out of order, fix the matches."
          action={{ label: 'Fix Clip Matches…', run: fix }}
        />
      )
    }
    const err = errorOf(g.angle)
    if (err === 'missing') {
      const folder = g.clip.path.split(/[\\/]/).slice(-3, -1).join('/')
      return (
        <PaneMessage
          test="clip-missing"
          icon="circle-alert"
          compact={c}
          title="Clip file not found"
          body={`“${g.clip.fileName}” is no longer in “${folder}”. If you moved the film, choose its new folder in Fix Clip Matches.`}
          action={{ label: 'Fix Clip Matches…', run: fix }}
        />
      )
    }
    if (err) {
      return (
        <PaneMessage
          test="clip-error"
          icon="circle-alert"
          compact={c}
          title="Couldn’t play this clip"
          body="This clip couldn’t be played. The file may have moved or uses a format the player can’t open."
          action={{ label: 'Fix Clip Matches…', run: fix }}
        />
      )
    }
    return null
  }
  const anyPlayable = geo.some((g) => g.clip && !errorOf(g.angle))

  // ── Drawing ─────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Shape | null>(null)
  const activeShapes = active ? room.shapesOf(active) : []
  const showLane = !!active && (activeShapes.length > 0 || drawMode) && anyPlayable
  const rows = showLane ? laneRows(activeShapes, duration || 1) : 0
  const laneDrag = useRef<Shape[] | null>(null)

  // ── HUD placement (02 §5.3) ─────────────────────────────────────────────
  const hudW = transportHudWidth(W)
  const hudH = transportHudHeight(rows)
  const below = H - lowest
  const hudTop = below >= hudH + 32 ? lowest + (below - hudH) / 2 : Math.max(8, lowest - 24 - hudH)

  // Palette and toast positions.
  const picTop = activeGeo ? activeGeo.picture.y : 0
  const paletteTop = picTop >= 64 ? (picTop - PALETTE_HEIGHT) / 2 : picTop + 12
  let toastTop = picTop + 16
  if (drawMode && paletteTop + PALETTE_HEIGHT + 12 > toastTop) toastTop = paletteTop + PALETTE_HEIGHT + 12

  // ── Gestures (02 §5.8) ──────────────────────────────────────────────────
  const wheel = useRef(0)
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    wheel.current += e.deltaX
    const n = Math.trunc(wheel.current / 6)
    if (n) {
      wheel.current -= n * 6
      video.stepFrames(n)
      poke()
    }
  }
  const paneClick = (g: PaneGeo) => (e: React.MouseEvent) => {
    onViewerClick()
    if (drawMode || e.button !== 0) return
    if (layout === 'sideBySide' && geo.length > 1 && g.angle !== active) return room.setActive(g.angle)
    if (g.inset) return
    if (anyPlayable) video.toggle()
  }
  const paneDouble = (g: PaneGeo) => (e: React.MouseEvent) => {
    if (drawMode || g.inset) return
    e.preventDefault()
    setUi({ filmOnly: !filmOnly })
  }
  const videoMenu = (g: PaneGeo) => (e: React.MouseEvent) => {
    e.preventDefault()
    if (geo.length > 1 && layout === 'sideBySide' && g.angle !== active) room.setActive(g.angle)
    const angles = actions.playAngles
    const clip = g.clip
    void showMenu(e, [
      action(playing ? 'Pause' : 'Play', () => video.toggle(), { accelerator: 'Space', enabled: anyPlayable }),
      action('Replay from Snap', () => video.replay(), { accelerator: 'B', enabled: anyPlayable }),
      action('Set Snap Here', actions.setSnapHere, { accelerator: 'Shift+B', enabled: !!room.activeClip && anyPlayable }),
      action('Clear Snap Point', actions.clearSnap, { enabled: actions.snap !== null }),
      sep(),
      submenu(
        'Angle',
        angles.length ? angles.map((a) => action(angleTitle(a), () => actions.chooseAngle(a), { checked: (layout === 'single' ? active : actions.primary) === a })) : [action('No Angles', () => {}, { enabled: false })]
      ),
      action('Side-by-Side Angles', () => runCommand('play.sideBySide'), { accelerator: 'S', checked: layout !== 'single', enabled: room.gameAngles.length > 1 }),
      action('Picture in Picture', () => runCommand('play.pip'), { checked: layout === 'pip', enabled: room.gameAngles.length > 1 }),
      ...(actions.twoPane ? [action('Swap Angles', actions.swapAngles)] : []),
      sep(),
      action('Draw', actions.toggleDraw, { accelerator: 'D', checked: drawMode, enabled: anyPlayable || drawMode }),
      action(hideControls ? 'Show Controls' : 'Hide Controls', () => runCommand('view.controls'), { accelerator: 'H' }),
      action(filmOnly ? 'Exit Film Only' : 'Enter Film Only', () => setUi({ filmOnly: !filmOnly }), { accelerator: 'Shift+CmdOrCtrl+F' }),
      sep(),
      action('Copy Frame', () => actions.copyFrame(g.angle), { enabled: !!clip && !errorOf(g.angle) }),
      action('Show Clip in Finder', () => clip && void api.revealClip(clip.path), { enabled: !!clip })
    ])
  }
  const snapMenu = (e: React.MouseEvent) => {
    void showMenu(e, [
      action('Go to Snap', actions.goToSnap),
      action('Nudge Snap Earlier', () => actions.nudgeSnap(-1), { accelerator: 'Alt+Left' }),
      action('Nudge Snap Later', () => actions.nudgeSnap(1), { accelerator: 'Alt+Right' }),
      sep(),
      action('Clear Snap Point', actions.clearSnap)
    ])
  }

  // PiP inset: drag to move, release slides to the nearest corner; a click swaps.
  const pipStart = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const pipDown = (e: React.PointerEvent) => {
    if (drawMode || e.button !== 0) return
    e.stopPropagation()
    pipStart.current = { x: e.clientX, y: e.clientY, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const pipMove = (e: React.PointerEvent) => {
    const s = pipStart.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.moved && Math.hypot(dx, dy) < 4) return
    s.moved = true
    setPipDrag({ dx, dy })
  }
  const pipUp = (e: React.PointerEvent) => {
    const s = pipStart.current
    pipStart.current = null
    if (!s) return
    if (!s.moved) {
      actions.swapAngles()
      return
    }
    const g = geo.find((x) => x.inset)
    const main = geo[0]
    if (g && main) {
      const cx = g.pane.x + g.pane.w / 2
      const cy = g.pane.y + g.pane.h / 2
      const corner: Corner = `${cy < main.picture.y + main.picture.h / 2 ? 't' : 'b'}${cx < main.picture.x + main.picture.w / 2 ? 'l' : 'r'}` as Corner
      setPipCorner(corner)
      writePref('ui.tape.pipCorner', corner)
    }
    void e
    setPipDrag(null)
  }

  // ── The angle popup (02 §5.6) ───────────────────────────────────────────
  const angleBtn = useRef<HTMLButtonElement>(null)
  const shownAngle = layout === 'single' ? active : actions.primary
  const angleItems = (): MenuItemSpec[] => {
    const items: MenuItemSpec[] = [
      { kind: 'header', label: 'Angle' },
      ...room.gameAngles.map(
        (a): MenuItemSpec => ({
          label: angleTitle(a),
          checked: shownAngle === a,
          disabled: !actions.playAngles.includes(a),
          shortcut: shownAngle === a ? 'A' : undefined,
          test: `angle-option-${a}`,
          run: () => actions.chooseAngle(a)
        })
      ),
      { kind: 'separator' },
      { kind: 'header', label: 'Layout' },
      ...(
        [
          ['single', 'Single'],
          ['sideBySide', 'Side by Side'],
          ['pip', 'Picture in Picture']
        ] as [Layout, string][]
      ).map(
        ([l, label]): MenuItemSpec => ({
          label,
          checked: layout === l,
          disabled: l !== 'single' && room.gameAngles.length < 2,
          shortcut: l === 'sideBySide' ? 'S' : undefined,
          test: `layout-option-${l}`,
          run: () => actions.chooseLayout(l)
        })
      )
    ]
    if (layout !== 'single') {
      const others = room.gameAngles.filter((a) => a !== actions.primary)
      if (room.gameAngles.length > 2) {
        items.push(
          { kind: 'separator' },
          { kind: 'submenu', label: 'Second Angle', items: others.map((a) => ({ label: angleTitle(a), checked: a === actions.second, run: () => actions.setSecondAngle(a) })) }
        )
      } else items.push({ kind: 'separator' })
      items.push({ label: 'Swap Angles', run: actions.swapAngles, disabled: !actions.twoPane })
    }
    return items
  }
  const angleNode =
    actions.playAngles.length <= 1 && layout === 'single' ? (
      <span className="hud__angle-text">{shownAngle ? angleTitle(shownAngle) : ''}</span>
    ) : (
      <button
        ref={angleBtn}
        type="button"
        className="hud__text-button hud__angle-button"
        title="Angle (A)"
        data-test="angle-popup"
        aria-haspopup="menu"
        onMouseDown={(e) => {
          noMouseFocus(e)
          if (!angleBtn.current) return
          pin('menu', true)
          openMenu({ anchor: angleBtn.current, items: angleItems(), placement: 'above', minWidth: 220, onClose: () => pin('menu', false) })
        }}
      >
        <span>{shownAngle ? angleTitle(shownAngle) : 'Angle'}</span>
        <Icon name="chevron-down" size={10} />
      </button>
    )

  // ── Lane (02 §11.7) ─────────────────────────────────────────────────────
  const lane =
    showLane && active ? (
      <LiveLane
        room={room}
        angle={active}
        engine={engine}
        snap={actions.snap}
        timeMode={timeMode}
        onSelect={(s) => {
          room.selectShape(s.id)
          const st = engine.getState().panes[active]
          if (st && !shapeVisibleAt(s, st.time, st.frame)) {
            video.pause()
            engine.seekPane(active, quantize(s.start, st.frame, st.duration))
          }
        }}
        onTimeChange={(id, start, dur) => {
          if (!laneDrag.current) laneDrag.current = room.shapesOf(active)
          room.setShapes(
            active,
            laneDrag.current.map((s) => (s.id === id ? { ...s, start, duration: dur } : s))
          )
        }}
        onTimeCommit={() => {
          const prev = laneDrag.current
          laneDrag.current = null
          if (prev) room.setShapes(active, room.shapesOf(active), { label: 'Change Drawing Time', prev })
        }}
        onTimeCancel={() => {
          if (laneDrag.current) room.setShapes(active, laneDrag.current)
          laneDrag.current = null
        }}
        onContextMenu={(e, s) => shapeMenu(e, room, active, s, engine)}
        onHiddenMenu={(anchor, hidden) =>
          openMenu({
            anchor,
            placement: 'above',
            items: hidden.map((s) => ({
              label: `${s.kind === 'text' ? 'Text' : s.kind[0].toUpperCase() + s.kind.slice(1)} · ${secondsLabel(s.start)}`,
              run: () => room.selectShape(s.id)
            }))
          })
        }
      />
    ) : undefined

  // ── Scrubbing ───────────────────────────────────────────────────────────
  const wasPlaying = useRef(false)

  const ghost = drawMode ? room.selectedShape : null
  const viewerStyle: CSSProperties = cursorHidden ? { cursor: 'none' } : {}

  return (
    <div
      ref={el}
      className="viewer"
      data-test="viewer"
      data-layout={layout}
      data-arrangement={arrangement ?? undefined}
      style={viewerStyle}
      onPointerMove={() => {
        inside.current = true
        poke()
      }}
      onPointerEnter={() => {
        inside.current = true
        poke()
      }}
      onPointerLeave={() => {
        inside.current = false
        schedule()
      }}
      onWheel={onWheel}
    >
      {geo.map((g, i) => {
        const isActive = g.angle === active
        const pillShown = actions.playAngles.length > 1 || geo.length > 1
        return (
          <AnglePane
            key={g.angle}
            engine={engine}
            id={g.angle}
            pane={g.pane}
            picture={g.inset ? { x: g.pane.x, y: g.pane.y, w: g.pane.w, h: g.pane.h } : g.picture}
            label={pillShown && g.clip ? angleLabel(g.angle) : undefined}
            active={isActive}
            ring={geo.length > 1 && layout === 'sideBySide'}
            unlinked={geo.length > 1 && !!g.clip && g.clip.snapMs === null && geo.some((o) => o !== g && o.clip?.snapMs !== null && o.clip)}
            chromeHidden={hudHidden}
            shapes={room.shapesOf(g.angle)}
            ghost={isActive ? ghost : null}
            draft={isActive ? draft : null}
            message={messageFor(g, i)}
            inset={g.inset}
            onPointerDown={g.inset ? pipDown : undefined}
            onClick={g.inset ? undefined : paneClick(g)}
            onDoubleClick={paneDouble(g)}
            onContextMenu={videoMenu(g)}
          >
            {g.clip && !errorOf(g.angle) && (drawMode || (isActive && room.selectedShape)) && (
              <DrawLayer
                room={room}
                angle={g.angle}
                engine={engine}
                picture={{ w: g.picture.w, h: g.picture.h }}
                enabled={drawMode && (isActive || layout === 'sideBySide')}
                onDraft={setDraft}
                onActivate={() => !isActive && room.setActive(g.angle)}
              />
            )}
            {g.inset && (
              <div
                className="pip-overlay"
                onPointerMove={pipMove}
                onPointerUp={pipUp}
                onPointerDown={pipDown}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="hud__button pip-overlay__swap"
                  title="Swap Angles"
                  aria-label="Swap Angles"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={noMouseFocus}
                  onClick={(e) => {
                    e.stopPropagation()
                    actions.swapAngles()
                  }}
                >
                  <Icon name="arrow-left-right" size={14} />
                </button>
              </div>
            )}
          </AnglePane>
        )
      })}

      {anyPlayable && current && (
        <TransportHud
          video={video}
          width={hudW}
          hidden={hudHidden}
          style={{ left: (W - hudW) / 2, top: hudTop }}
          onToggle={() => video.toggle()}
          onFrameBack={() => video.stepFrames(-1)}
          onFrameForward={() => video.stepFrames(1)}
          prevPlay={{ run: () => room.step(-1), enabled: room.visible.length > 0 }}
          nextPlay={{ run: () => room.step(1), enabled: room.visible.length > 0 }}
          replay={{ run: () => video.replay() }}
          setSnap={{ run: actions.setSnapHere, enabled: !!room.activeClip }}
          onSpeed={(s) => runCommand('play.speed', String(s))}
          onLoop={() => runCommand('play.loop')}
          sound={{ run: () => runCommand('play.sound') }}
          filmOnly={{ run: () => setUi({ filmOnly: !filmOnly }), on: filmOnly }}
          angle={angleNode}
          snap={actions.snap}
          startPoint={room.settings.startAtSnap && actions.snap !== null ? actions.startPoint : null}
          timeMode={timeMode}
          onTimeMode={onTimeMode}
          scrubber={{
            onSeek: (t) => video.seekClip(t),
            onScrubStart: () => {
              wasPlaying.current = !engine.isPaused()
              pin('drag', true)
              video.pause()
            },
            onScrub: (t) => video.seekClip(t),
            onScrubEnd: () => {
              pin('drag', false)
              if (wasPlaying.current) video.play()
            },
            onSnapClick: actions.goToSnap,
            onSnapDrag: (t) => {
              pin('drag', true)
              video.pause()
              if (active) engine.seekPane(active, t)
            },
            onSnapCommit: (t) => {
              pin('drag', false)
              const clip = room.activeClip
              if (clip && current) room.data.setSnap(clip.id, Math.round(t * 1000), { label: 'Set Snap', target: { playId: current.playId, angle: active ?? undefined } })
            },
            onSnapCancel: () => pin('drag', false),
            onSnapContextMenu: snapMenu,
            onFrameStep: (n) => video.stepFrames(n)
          }}
          lane={lane}
          onPointerEnter={() => pin('hud', true)}
          onPointerLeave={() => pin('hud', false)}
          onMenu={(open) => pin('menu', open)}
        />
      )}

      {drawMode && (
        <DrawPalette
          room={room}
          angle={active}
          engine={engine}
          viewerWidth={W}
          style={{ top: paletteTop }}
          onMenu={(open) => pin('menu', open)}
        />
      )}

      {filmOnly && <GradingHud room={room} hidden={hudHidden} />}

      <ViewerToast top={toastTop} />

      {endPanel && <EndOfList room={room} panel={endPanel} onClose={() => onEndPanel(null)} actions={actions} />}
    </div>
  )
}

/** The drawing lane, reading the playhead live. */
function LiveLane({
  room,
  angle,
  engine,
  snap,
  timeMode,
  ...cb
}: {
  room: Room
  angle: Angle
  engine: VideoEngine
  snap: number | null
  timeMode: 'snap' | 'clip'
  onSelect(s: Shape): void
  onTimeChange(id: string, start: number, duration: number | null): void
  onTimeCommit(id: string): void
  onTimeCancel(): void
  onContextMenu(e: React.MouseEvent, s: Shape): void
  onHiddenMenu(anchor: Element, shapes: Shape[]): void
}) {
  const st = useVideoState(engine, (s) => ({ time: s.panes[angle]?.time ?? s.time, duration: s.panes[angle]?.duration ?? s.duration, frame: s.panes[angle]?.frame ?? s.frame }))
  return (
    <DrawingLane
      shapes={room.shapesOf(angle)}
      duration={st.duration || 1}
      frame={st.frame}
      time={st.time}
      snap={snap}
      timeMode={timeMode}
      selectedId={room.selectedShape}
      {...cb}
    />
  )
}

/** The end-of-list panel (02 §13.3). */
function EndOfList({ room, panel, onClose, actions }: { room: Room; panel: EndPanel; onClose: () => void; actions: ViewerActions }) {
  const { focus, team, plays, visible } = room
  const filtered = room.tokens.length > 0 || room.text.trim().length > 0
  let title = ''
  let body = ''
  let primary: { label: string; run: () => void }
  let secondary: { label: string; run: () => void }
  const close = (fn: () => void) => () => {
    onClose()
    fn()
  }
  if (focus) {
    const name = focus.player.name
    const entries = focus.snaps.map((p) => room.data.entryOf(p.playId, focus.player.id)).filter((e): e is NonNullable<typeof e> => !!e)
    const score = gradeScore(tallyOf(entries))
    const firstSnap = close(actions.firstPlay)
    if (panel.kind === 'focusLast') {
      title = `That’s ${name}’s last snap`
      body = `${focus.progress.graded} of ${focus.progress.total} snaps graded.`
      primary = { label: 'Next Ungraded Snap', run: close(actions.firstUngraded) }
      secondary = { label: 'Back to First Snap', run: firstSnap }
    } else {
      title = 'Every snap is graded'
      body = `${name} · ${focus.snaps.length} snaps · game grade ${score === null ? '—' : Math.round(score)}`
      const next = [...actions.teamGames]
        .filter((g) => g.gameId !== room.game.gameId && g.clipCount > 0 && (g.week > room.game.week || g.gameday > room.game.gameday))
        .sort((a, b) => a.week - b.week || a.gameday.localeCompare(b.gameday))[0]
      if (next) {
        const where = next.homeTeam === team ? `vs ${next.awayTeam}` : `@ ${next.homeTeam}`
        primary = { label: `Continue in ${weekName(next)} ${where}`, run: close(() => actions.continueIn(next)) }
        secondary = { label: 'Exit Player Focus', run: close(room.exitFocus) }
      } else {
        primary = { label: 'Exit Player Focus', run: close(room.exitFocus) }
        secondary = { label: 'Back to First Snap', run: firstSnap }
      }
    }
  } else if (panel.kind === 'lastUngraded') {
    title = filtered ? 'That’s the last play in this list' : 'That’s the last play'
    const ungraded = visible.filter((p) => {
      const pr = room.progressOf(p)
      return pr.listed > 0 && pr.done < pr.listed
    }).length
    body = filtered ? `${ungraded} of the ${visible.length} plays here are still ungraded.` : `${actions.gradedPlays} of ${plays.length} plays graded for ${team}.`
    primary = { label: 'Go to First Ungraded Play', run: close(actions.firstUngraded) }
    secondary = { label: 'Back to First Play', run: close(actions.firstPlay) }
  } else {
    title = filtered ? 'Every play in this list is graded' : 'Every play is graded'
    body = filtered ? `${visible.length} plays.` : `You’ve graded all ${plays.length} plays for ${team}.`
    primary = { label: 'Back to First Play', run: close(actions.firstPlay) }
    secondary = { label: `Study ${room.opponent}`, run: close(actions.switchTeam) }
  }

  // ↩ runs the primary; ↑ closes and goes back; any other key closes and then acts normally (esc is the room's).
  const primaryRef = useRef(primary)
  primaryRef.current = primary
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Keys typed into a note or field are the field's.
      if (e.key === 'Escape' || e.metaKey || isTyping(e)) return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        primaryRef.current.run()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        room.step(-1)
      } else if (!['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, room])

  return (
    <div className="end-of-list__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} onClick={(e) => e.stopPropagation()}>
      <div className="hud end-of-list" data-test="end-of-list" role="dialog" aria-label={title}>
        <div className="end-of-list__title">{title}</div>
        <div className="end-of-list__body">{body}</div>
        <div className="end-of-list__actions">
          <button type="button" className="end-of-list__button" onMouseDown={noMouseFocus} onClick={secondary.run}>
            {secondary.label}
          </button>
          <button type="button" className="end-of-list__button end-of-list__button--primary" onMouseDown={noMouseFocus} onClick={primary.run}>
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  )
}
