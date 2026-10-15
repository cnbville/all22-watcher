import './video.css'
import { type CSSProperties, type ReactNode, useRef } from 'react'
import { Icon, type IconName } from '../Icon'
import { noMouseFocus } from '../keyboard'
import { openMenu } from '../Menu'
import { type VideoController, type VideoEngine, SPEEDS, useVideoState } from './engine'
import { Scrubber, type ScrubberProps } from './Scrubber'
import { elapsedLabel, formatSeconds } from './time'

/**
 * The transport HUD (01 §6.21, 02 §5.3). `variant="large"` is the tape room's two-row HUD with the scrubber, time
 * labels and an optional drawing lane; `variant="compact"` is the one-row 44px HUD for the preview panel and small
 * players. Every control is optional except play/pause and frame steps; leave an action out to hide its button.
 *
 *   <TransportHud video={ctl} width={720} onToggle={ctl.toggle} onFrameBack={() => ctl.stepFrames(-1)} … />
 *
 * The HUD reads time, speed, loop and sound from the controller; it never owns playback state.
 */

export interface TransportAction {
  run(): void
  enabled?: boolean
  /** Tooltip, with its shortcut: "Next Play (↓)". */
  title?: string
}

export interface TransportHudProps {
  variant?: 'large' | 'compact'
  video: VideoController | VideoEngine
  hidden?: boolean
  /** HUD width in px (large: min(720, viewer − 48), at least 420). */
  width: number
  style?: CSSProperties
  /** No playable clip: controls draw disabled. */
  disabled?: boolean
  onToggle(): void
  onFrameBack(): void
  onFrameForward(): void
  prevPlay?: TransportAction
  nextPlay?: TransportAction
  replay?: TransportAction
  setSnap?: TransportAction
  onSpeed(speed: number): void
  onLoop(): void
  sound?: TransportAction
  filmOnly?: TransportAction & { on: boolean }
  /** The angle popup button (or the angle name as plain text). */
  angle?: ReactNode
  /** The clock clip's snap point (s) and start point; drives the snap marker, pre-roll and the "from snap" label. */
  snap: number | null
  startPoint: number | null
  timeMode: 'snap' | 'clip'
  /** Clicking the elapsed label switches the time mode (only offered when there is a snap point). */
  onTimeMode?(): void
  /** Scrubber callbacks (time, duration and frame come from the controller). */
  scrubber: Omit<ScrubberProps, 'time' | 'duration' | 'frame' | 'snap' | 'startPoint' | 'timeMode' | 'disabled'>
  /** Rows under the scrubber, aligned to the scrubber track (the drawing lane). */
  lane?: ReactNode
  onPointerEnter?(): void
  onPointerLeave?(): void
  /** A HUD menu opened or closed (auto-hide stays shown while one is open). */
  onMenu?(open: boolean): void
  test?: string
}

function HudButton({
  icon,
  title,
  onClick,
  on,
  disabled,
  test,
  wide
}: {
  icon: IconName
  title: string
  onClick(): void
  on?: boolean
  disabled?: boolean
  test?: string
  wide?: boolean
}) {
  return (
    <button
      type="button"
      className={`hud__button${wide ? ' hud__button--wide' : ''}`}
      aria-label={title.replace(/ \(.*\)$/, '')}
      title={title}
      aria-pressed={on === undefined ? undefined : on}
      disabled={disabled}
      data-test={test}
      onMouseDown={noMouseFocus}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
    </button>
  )
}

const speedLabel = (s: number) => `${s}×`

export function TransportHud(p: TransportHudProps) {
  const variant = p.variant ?? 'large'
  const s = useVideoState(p.video, (v) => ({
    time: v.time,
    duration: v.duration,
    frame: v.frame,
    playing: v.playing,
    speed: v.speed,
    loop: v.loop,
    sound: v.sound
  }))
  const speedRef = useRef<HTMLButtonElement>(null)
  // Narrow HUDs drop Sound, then Film Only, then Previous/Next Play (their keys and menus still work).
  const showSound = p.width >= 560
  const showFilmOnly = p.width >= 520
  const showPlays = p.width >= 480
  const off = !!p.disabled

  const openSpeed = () => {
    if (!speedRef.current) return
    p.onMenu?.(true)
    openMenu({
      anchor: speedRef.current,
      placement: 'above',
      minWidth: 120,
      items: SPEEDS.map((v) => ({ label: speedLabel(v), checked: v === s.speed, run: () => p.onSpeed(v) })),
      onClose: () => p.onMenu?.(false)
    })
  }

  const speed = (
    <button
      ref={speedRef}
      type="button"
      className="hud__text-button hud__speed"
      title="Speed ([ and ])"
      data-test="hud-speed"
      aria-haspopup="menu"
      onMouseDown={(e) => {
        noMouseFocus(e)
        openSpeed()
      }}
    >
      {speedLabel(s.speed)}
      <Icon name="chevron-down" size={10} />
    </button>
  )
  const loop = <HudButton icon="repeat" title="Loop (L)" on={s.loop} onClick={p.onLoop} test="hud-loop" />
  const play = (
    <HudButton
      icon={s.playing ? 'pause' : 'play'}
      title={s.playing ? 'Pause (Space)' : 'Play (Space)'}
      onClick={p.onToggle}
      disabled={off}
      test="hud-play"
      wide
    />
  )
  const frameBack = <HudButton icon="step-back" title="Back One Frame (←)" onClick={p.onFrameBack} disabled={off} test="hud-frame-back" />
  const frameForward = <HudButton icon="step-forward" title="Forward One Frame (→)" onClick={p.onFrameForward} disabled={off} test="hud-frame-forward" />
  const action = (a: TransportAction | undefined, icon: IconName, fallback: string, test: string) =>
    a && <HudButton icon={icon} title={a.title ?? fallback} onClick={a.run} disabled={a.enabled === false} test={test} />

  const snapMode = p.timeMode === 'snap' && p.snap !== null
  const elapsed = (
    <button
      type="button"
      className="hud__time hud__time--elapsed"
      disabled={p.snap === null || !p.onTimeMode}
      title={p.snap === null ? undefined : snapMode ? 'Time from the snap. Click to show clip time.' : 'Clip time. Click to show time from the snap.'}
      onMouseDown={noMouseFocus}
      onClick={p.onTimeMode}
    >
      {off ? '' : elapsedLabel(s.time, p.snap, p.timeMode, s.frame)}
    </button>
  )
  const duration = <span className="hud__time hud__time--duration">{off ? '' : formatSeconds(s.duration)}</span>
  const scrubber = (
    <Scrubber
      {...p.scrubber}
      time={s.time}
      duration={s.duration}
      frame={s.frame}
      snap={p.snap}
      startPoint={p.startPoint}
      timeMode={p.timeMode}
      disabled={off}
    />
  )

  if (variant === 'compact') {
    return (
      <div
        className="hud transport-hud transport-hud--compact"
        data-state={p.hidden ? 'hidden' : 'shown'}
        data-test={p.test ?? 'transport-hud'}
        style={{ width: p.width, ...p.style }}
        onPointerEnter={p.onPointerEnter}
        onPointerLeave={p.onPointerLeave}
      >
        {play}
        {elapsed}
        <div className="transport-hud__scrub">{scrubber}</div>
        {duration}
        {speed}
        {loop}
        {action(p.sound, s.sound ? 'volume-2' : 'volume-x', 'Sound (M)', 'hud-sound')}
      </div>
    )
  }

  return (
    <div
      className="hud transport-hud transport-hud--large"
      data-state={p.hidden ? 'hidden' : 'shown'}
      data-test={p.test ?? 'transport-hud'}
      style={{ width: p.width, ...p.style }}
      onPointerEnter={p.onPointerEnter}
      onPointerLeave={p.onPointerLeave}
    >
      <div className="transport-hud__row">
        <div className="transport-hud__group transport-hud__group--left">
          {speed}
          {loop}
        </div>
        <div className="transport-hud__group transport-hud__group--center">
          {showPlays && action(p.prevPlay, 'skip-back', 'Previous Play (↑)', 'hud-prev-play')}
          {frameBack}
          {play}
          {frameForward}
          {showPlays && action(p.nextPlay, 'skip-forward', 'Next Play (↓)', 'hud-next-play')}
        </div>
        <div className="transport-hud__group transport-hud__group--right">
          {action(p.replay, 'rotate-ccw', 'Replay from Snap (B)', 'hud-replay')}
          {action(p.setSnap, 'crosshair', 'Set Snap Here (⇧B)', 'hud-set-snap')}
          {p.angle && <div className="transport-hud__angle">{p.angle}</div>}
          {showSound && p.sound && (
            <HudButton icon={s.sound ? 'volume-2' : 'volume-x'} title={p.sound.title ?? 'Sound (M)'} on={s.sound} onClick={p.sound.run} disabled={p.sound.enabled === false} test="hud-sound" />
          )}
          {showFilmOnly && p.filmOnly && (
            <HudButton
              icon={p.filmOnly.on ? 'minimize-2' : 'maximize-2'}
              title={p.filmOnly.title ?? (p.filmOnly.on ? 'Exit Film Only (⇧⌘F)' : 'Enter Film Only (⇧⌘F)')}
              onClick={p.filmOnly.run}
              test="hud-film-only"
            />
          )}
        </div>
      </div>
      <div className="transport-hud__scrub-row">
        {elapsed}
        {scrubber}
        {duration}
      </div>
      {p.lane && (
        <div className="transport-hud__lane-row">
          <span className="transport-hud__lane-icon">
            <Icon name="pen-line" size={12} />
          </span>
          {p.lane}
          <span />
        </div>
      )}
    </div>
  )
}

/** Large HUD height: 68, plus 4 + rows × 8 + (rows − 1) × 2 with a drawing lane (02 §5.3). */
export function transportHudHeight(laneRows: number): number {
  return 68 + (laneRows > 0 ? 4 + laneRows * 8 + (laneRows - 1) * 2 : 0)
}

/** Large HUD width: min(720, viewer − 48), at least 420; below a 468 viewer, viewer − 16. */
export function transportHudWidth(viewerWidth: number): number {
  if (viewerWidth < 468) return Math.max(0, viewerWidth - 16)
  return Math.max(420, Math.min(720, viewerWidth - 48))
}
