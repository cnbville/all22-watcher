/**
 * Frame length of a clip, learned while it plays (v1's method, unchanged), and frame quantizing (02 §5.10).
 */

/** Frame lengths of the usual film rates: 60, 59.94, 50, 30, 29.97, 25, 24 and 23.976 fps. */
export const FRAME_LENGTHS = [1 / 60, 1001 / 60000, 1 / 50, 1 / 30, 1001 / 30000, 1 / 25, 1 / 24, 1001 / 24000]

/** Until a clip's frame length is learned. */
export const DEFAULT_FRAME = 1 / 30

/** The usual frame length closest to a measured gap between frames, or null if none is close. */
export function snapFrame(gap: number): number | null {
  const near = FRAME_LENGTHS.reduce((a, b) => (Math.abs(b - gap) < Math.abs(a - gap) ? b : a))
  return Math.abs(near - gap) / near < 0.02 ? near : null
}

/** The index of the frame shown at clip time `t` (a hair of tolerance so the middle of a frame stays in it). */
export function frameIndex(t: number, frame: number): number {
  return Math.floor(t / frame + 1e-6)
}

/**
 * The middle of the frame that contains `t`, so the displayed frame is the intended one (02 §5.10). Clamped to
 * [half a frame, duration − half a frame] when the duration is known.
 */
export function quantize(t: number, frame: number, duration?: number): number {
  let q = frameIndex(Math.max(0, t), frame) * frame + frame / 2
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) q = Math.min(q, Math.max(frame / 2, duration - frame / 2))
  return q
}

/** The middle of the frame `n` frames away from the one shown at `t`. */
export function stepTime(t: number, n: number, frame: number, duration?: number): number {
  const target = (frameIndex(t, frame) + n) * frame + frame / 2
  return quantize(Math.max(0, target), frame, duration)
}

/**
 * Learns a playing video's frame length from the smallest gap between presented frames. Above 1× the screen skips
 * frames, so media time over frames decoded says how many a gap spans. A seek starts over. Calls `onFrame` once
 * with the learned length; returns a function that stops listening.
 */
export function learnFrameLength(v: HTMLVideoElement, onFrame: (frame: number) => void): () => void {
  if (typeof v.requestVideoFrameCallback !== 'function') return () => {}
  let start: { time: number; frames: number } | null = null
  let last = 0
  let gap = Infinity
  let id = 0
  let done = false
  const tick: VideoFrameRequestCallback = (_now, meta) => {
    const frames = v.getVideoPlaybackQuality().totalVideoFrames
    if (v.paused || !start) {
      start = v.paused ? null : { time: meta.mediaTime, frames }
      gap = Infinity
    } else {
      if (meta.mediaTime > last) gap = Math.min(gap, meta.mediaTime - last)
      if (meta.mediaTime - start.time >= 1) {
        const rough = (meta.mediaTime - start.time) / Math.max(1, frames - start.frames)
        const snapped = snapFrame(gap / Math.max(1, Math.round(gap / rough)))
        if (snapped) {
          done = true
          onFrame(snapped)
          return
        }
        start = { time: meta.mediaTime, frames }
        gap = Infinity
      }
    }
    last = meta.mediaTime
    id = v.requestVideoFrameCallback(tick)
  }
  const onSeeking = () => (start = null)
  id = v.requestVideoFrameCallback(tick)
  v.addEventListener('seeking', onSeeking)
  return () => {
    if (!done) v.cancelVideoFrameCallback(id)
    v.removeEventListener('seeking', onSeeking)
  }
}
