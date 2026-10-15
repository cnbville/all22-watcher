import type { CSSProperties, ReactNode } from 'react'
import { ProgressBar } from './Progress'

/** A clickable summary in a grid (spec 01 §6.27). Single click opens; Enter/Space open from the keyboard. */
export function Tile({
  children,
  onOpen,
  onContextMenu,
  progress,
  title,
  test,
  className,
  style
}: {
  children: ReactNode
  onOpen?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  /** 0–1: the 2px progress track along the bottom edge. */
  progress?: number | null
  title?: string
  test?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={`tile${className ? ` ${className}` : ''}`}
      role="button"
      tabIndex={0}
      title={title}
      data-test={test}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onOpen?.()
        }
      }}
    >
      {children}
      {progress !== undefined && progress !== null && <ProgressBar value={progress} mini style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} />}
    </div>
  )
}
