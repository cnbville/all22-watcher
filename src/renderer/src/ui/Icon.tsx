import type { CSSProperties } from 'react'
import type { IconName } from '@shared/icons'
import { ICONS } from './icons'

export type { IconName }

/** A lucide icon at the app's stroke width: 1.5, or 1.25 at 48px (spec 01 §6.35). */
export function Icon({
  name,
  size = 16,
  className,
  style,
  filled
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
  /** Fills the shape with the current color (a set flag). */
  filled?: boolean
}) {
  const C = ICONS[name]
  return (
    <C
      size={size}
      strokeWidth={size >= 40 ? 1.25 : 1.5}
      absoluteStrokeWidth={false}
      className={className ? `icon ${className}` : 'icon'}
      style={style}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden
      focusable={false}
    />
  )
}
