import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { clipUrl } from '@shared/api'
import type { Clip, Stroke } from '@shared/types'

export interface VideoHandle {
  togglePlay(): void
  step(frames: number): void
  seekBy(seconds: number): void
  restart(): void
}

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2]
export const INK = ['#ffd60a', '#ff4d4d', '#4dd2ff', '#ffffff', '#7CFC7C']
const FRAME = 1 / 30

interface Props {
  clip: Clip | null
  speed: number
  loop: boolean
  drawing: boolean
  ink: string
  strokes: Stroke[]
  onStrokes(strokes: Stroke[]): void
  onEnded(): void
  overlay?: React.ReactNode
  autoPlay?: boolean
}

/** The film itself: a video with a drawing layer on top, plus a transport bar. */
export const VideoStage = forwardRef<VideoHandle, Props & { transportExtra?: React.ReactNode }>(function VideoStage(
  { clip, speed, loop, drawing, ink, strokes, onStrokes, onEnded, overlay, transportExtra, autoPlay = true },
  ref
) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef<Stroke | null>(null)

  const controls = useMemo<VideoHandle>(() => ({
    togglePlay() {
      const v = video.current
      if (!v) return
      if (v.paused) void v.play().catch(() => {})
      else v.pause()
    },
    step(frames) {
      const v = video.current
      if (!v) return
      v.pause()
      v.currentTime = Math.min(Math.max(0, v.currentTime + frames * FRAME), v.duration || 0)
    },
    seekBy(seconds) {
      const v = video.current
      if (!v) return
      v.currentTime = Math.min(Math.max(0, v.currentTime + seconds), v.duration || 0)
    },
    restart() {
      const v = video.current
      if (!v) return
      v.currentTime = 0
      void v.play().catch(() => {})
    }
  }), [])
  useImperativeHandle(ref, () => controls, [controls])

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed
  }, [speed, clip])

  useEffect(() => setError(null), [clip])

  // The drawing layer maps 0–1 coordinates onto the visible picture (the video is letterboxed).
  const contentRect = useCallback(() => {
    const v = video.current
    const c = canvas.current
    if (!v || !c) return { x: 0, y: 0, w: 1, h: 1 }
    const cw = c.clientWidth
    const ch = c.clientHeight
    const vw = v.videoWidth || 16
    const vh = v.videoHeight || 9
    const scale = Math.min(cw / vw, ch / vh)
    const w = vw * scale
    const h = vh * scale
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
  }, [])

  const redraw = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    if (c.width !== c.clientWidth * dpr || c.height !== c.clientHeight * dpr) {
      c.width = c.clientWidth * dpr
      c.height = c.clientHeight * dpr
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, c.clientWidth, c.clientHeight)
    const r = contentRect()
    const all = live.current ? [...strokes, live.current] : strokes
    for (const s of all) {
      if (s.points.length < 2) continue
      const pts = s.points.map(([x, y]) => [r.x + x * r.w, r.y + y * r.h] as const)
      ctx.strokeStyle = s.color
      ctx.fillStyle = s.color
      ctx.lineWidth = s.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = 3
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y)
      ctx.stroke()
      // Arrowhead pointing along the last stretch of the stroke.
      const end = pts[pts.length - 1]
      const back = pts[Math.max(0, pts.length - 6)]
      const angle = Math.atan2(end[1] - back[1], end[0] - back[0])
      const size = 6 + s.width * 2
      ctx.beginPath()
      ctx.moveTo(end[0], end[1])
      ctx.lineTo(end[0] - size * Math.cos(angle - 0.45), end[1] - size * Math.sin(angle - 0.45))
      ctx.lineTo(end[0] - size * Math.cos(angle + 0.45), end[1] - size * Math.sin(angle + 0.45))
      ctx.closePath()
      ctx.fill()
    }
  }, [strokes, contentRect])

  useEffect(redraw, [redraw])
  useEffect(() => {
    const ro = new ResizeObserver(redraw)
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [redraw])

  const toNorm = (e: React.PointerEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect()
    const r = contentRect()
    return [(e.clientX - rect.left - r.x) / r.w, (e.clientY - rect.top - r.y) / r.h]
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawing) {
      video.current && (video.current.paused ? void video.current.play().catch(() => {}) : video.current.pause())
      return
    }
    canvas.current!.setPointerCapture(e.pointerId)
    video.current?.pause()
    live.current = { color: ink, width: 3, points: [toNorm(e)] }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!live.current) return
    live.current.points.push(toNorm(e))
    redraw()
  }
  const onPointerUp = () => {
    const s = live.current
    live.current = null
    if (s && s.points.length > 1) onStrokes([...strokes, s])
    else redraw()
  }

  const fmt = (t: number) => `${Math.floor(t)}.${String(Math.floor((t % 1) * 10))}s`

  return (
    <>
      <div className="video-wrap" ref={wrap}>
        {clip ? (
          <video
            key={clip.id}
            ref={video}
            src={clipUrl(clip.id)}
            autoPlay={autoPlay}
            muted
            playsInline
            onLoadedMetadata={(e) => {
              e.currentTarget.playbackRate = speed
              setDuration(e.currentTarget.duration)
              redraw()
            }}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => setError('This clip couldn’t be played. The file may have moved or uses an unsupported format.')}
            onEnded={(e) => {
              if (loop) {
                e.currentTarget.currentTime = 0
                void e.currentTarget.play().catch(() => {})
              } else onEnded()
            }}
          />
        ) : (
          <div className="no-clip">No clip linked to this play.</div>
        )}
        {error && <div className="no-clip" style={{ position: 'absolute' }}>{error}</div>}
        <canvas
          ref={canvas}
          className={drawing ? 'drawing' : ''}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {overlay && <div className="video-overlay">{overlay}</div>}
      </div>
      <div className="transport">
        <button className="btn small" onClick={() => controls.step(-1)} title="Back one frame (←)">
          ◀︎❙
        </button>
        <button className="btn small" style={{ width: 44 }} onClick={() => controls.togglePlay()} title="Play / pause (Space)">
          {playing ? '❚❚' : '▶︎'}
        </button>
        <button className="btn small" onClick={() => controls.step(1)} title="Forward one frame (→)">
          ❙▶︎
        </button>
        <input
          className="scrub"
          type="range"
          min={0}
          max={duration || 0}
          step={FRAME}
          value={Math.min(time, duration || 0)}
          onChange={(e) => {
            if (video.current) video.current.currentTime = Number(e.target.value)
          }}
        />
        <span className="mono faint" style={{ width: 92, textAlign: 'right' }}>
          {fmt(time)} / {fmt(duration)}
        </span>
        {transportExtra}
      </div>
    </>
  )
})
