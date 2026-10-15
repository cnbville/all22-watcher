import type { CSSProperties, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { noMouseFocus } from './keyboard'

/** Floating material over video, QuickTime style (spec 01 §6.21). Hiding is the owner's call (`hidden`). */
export function Hud({ children, hidden, className, style }: { children: ReactNode; hidden?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div className={`hud${className ? ` ${className}` : ''}`} data-state={hidden ? 'hidden' : 'shown'} style={style}>
      {children}
    </div>
  )
}

export function HudButton({
  icon,
  label,
  onClick,
  on,
  disabled,
  test
}: {
  icon: IconName
  label: string
  onClick: () => void
  on?: boolean
  disabled?: boolean
  test?: string
}) {
  return (
    <button
      type="button"
      className="hud__button"
      aria-label={label}
      title={label}
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
