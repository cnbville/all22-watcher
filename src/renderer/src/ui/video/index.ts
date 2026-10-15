/**
 * The shared video engine (02 §20). Player screens (the tape room, cut-up and reel players, the preview panel) use
 * only what is exported here:
 *
 * - `useVideoController` / `VideoController`: one engine per surface; start points, flash-free clip swaps,
 *   preloading, speed, loop, sound, frame-accurate seeks, synced angles.
 * - `useVideoState(ctl, select)`: subscribe to a slice of the playback state.
 * - `AnglePane` + `fitPicture` + `PaneMessage`: one angle's <video>, drawing canvas, pill and state overlay.
 * - `TransportHud` (large or compact), `Scrubber`, `DrawingLane`: the controls.
 * - `drawShapes`: renders drawings onto any 2D context (Copy Frame, video export).
 * - `useSyncedPlayback` / `SyncController`: the sync model alone, for players that manage their own elements.
 */
export { AnglePane, fitPicture, PaneMessage, type AnglePaneProps, type Rect } from './AnglePane'
export { DrawingLane, laneRows, LANE_ROWS, shapeName, spanLabel, type DrawingLaneProps } from './DrawingLane'
export { drawShapes, textBox, SPOTLIGHT_DIM, type PictureRect } from './drawShapes'
export {
  SPEEDS,
  useVideoController,
  useVideoState,
  VideoEngine,
  type EngineConfig,
  type EnginePane,
  type PaneError,
  type PaneState,
  type VideoController,
  type VideoState
} from './engine'
export { DEFAULT_FRAME, FRAME_LENGTHS, frameIndex, quantize, snapFrame, stepTime } from './frameLength'
export { Scrubber, type ScrubberProps } from './Scrubber'
export { HARD_RESYNC_S, MAX_RATE_ADJUST, SOFT_TOLERANCE_S, SyncController, syncFollowers, syncOffsets, useSyncedPlayback } from './sync'
export { elapsedLabel, formatFromSnap, formatSeconds, secondsLabel } from './time'
export { TransportHud, transportHudHeight, transportHudWidth, type TransportAction, type TransportHudProps } from './TransportHud'
export { ViewerToast, viewerToast } from './ViewerToast'
