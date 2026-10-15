import { type ReactNode, useState } from 'react'
import { posterUrl } from '@shared/api'
import { Icon } from '../../ui/Icon'

/**
 * Poster frame (03 §2.7): a still from a clip at its start point. Shows the `film` placeholder on
 * `--bg-under-page` until the image loads and keeps it on error; the image fades in over 120ms.
 */
export function Poster({
  poster,
  width,
  alt = '',
  className,
  children
}: {
  /** The clip and the time (seconds) of the still; null shows the placeholder. */
  poster: { clipId: number; at: number } | null
  /** Requested image width (the main process scales to it); default 480. */
  width?: number
  alt?: string
  className?: string
  /** Overlays (badges, progress) drawn over the image. */
  children?: ReactNode
}) {
  const src = poster ? posterUrl(poster.clipId, poster.at, width) : null
  const [state, setState] = useState<{ src: string | null; loaded: boolean; failed: boolean }>({ src, loaded: false, failed: false })
  const current = state.src === src ? state : { src, loaded: false, failed: false }
  return (
    <div className={`poster${className ? ` ${className}` : ''}`} data-loaded={current.loaded || undefined}>
      {(!current.loaded || current.failed) && (
        <div className="poster__placeholder" aria-hidden>
          <Icon name="film" size={32} />
        </div>
      )}
      {src && !current.failed && (
        <img
          className="poster__image"
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => setState({ src, loaded: true, failed: false })}
          onError={() => setState({ src, loaded: false, failed: true })}
        />
      )}
      {children}
    </div>
  )
}
