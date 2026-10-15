import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hud, HudButton } from './Hud'
import { Icon } from './Icon'
import { useLayer } from './keyboard'

/**
 * Quick Look-style preview of a play (spec 01 §6.23): Space or esc closes, ↑/↓ (and ←/→) move the selection in
 * the list underneath, ↩ opens the play in the tape room. The compact transport HUD sits over the video.
 */
export function PreviewPanel({
  label,
  src,
  start = 0,
  footer,
  onClose,
  onMove,
  onOpen
}: {
  label: ReactNode
  src: string | null
  /** Clip start point in seconds (the snap minus pre-roll). */
  start?: number
  footer?: ReactNode
  onClose: () => void
  onMove?: (dir: -1 | 1) => void
  onOpen?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  useLayer(true, {
    kind: 'preview',
    close: onClose,
    onKey: (e) => {
      if (e.key === ' ' || e.key === 'Escape') onClose()
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') onMove?.(-1)
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') onMove?.(1)
      else if (e.key === 'Enter') onOpen?.()
      else return false
      e.preventDefault()
      return true
    }
  })

  useEffect(() => {
    const v = video.current
    if (!v) return
    const seek = () => {
      v.currentTime = start
      void v.play().catch(() => {})
    }
    if (v.readyState >= 1) seek()
    else v.addEventListener('loadedmetadata', seek, { once: true })
  }, [src, start])

  const layer = document.getElementById('layer-overlay') ?? document.body
  return createPortal(
    <div className="preview-panel" role="dialog" aria-label="Preview">
      <div className="preview-panel__header">
        <span className="preview-panel__label ellipsis">{label}</span>
        <button type="button" className="preview-panel__close" aria-label="Close" onMouseDown={(e) => e.preventDefault()} onClick={onClose}>
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="preview-panel__video">
        {src ? (
          <video ref={video} src={src} muted playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        ) : (
          <div className="preview-panel__none">No clip for this play</div>
        )}
        {src && (
          <Hud className="hud--transport-compact">
            <HudButton icon="rotate-ccw" label="Replay from Snap" onClick={() => video.current && ((video.current.currentTime = start), void video.current.play())} />
            <HudButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onClick={() => (video.current?.paused ? void video.current.play() : video.current?.pause())} />
          </Hud>
        )}
      </div>
      {footer && <div className="preview-panel__footer">{footer}</div>}
    </div>,
    layer
  )
}
