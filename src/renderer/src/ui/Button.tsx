import type { CSSProperties, ReactNode, Ref } from 'react'
import { Icon, type IconName } from './Icon'
import { noMouseFocus } from './keyboard'
import { Spinner } from './Spinner'

export type ButtonVariant = 'default' | 'primary' | 'destructive' | 'borderless' | 'toolbar'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'toolbar'

export interface ButtonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  /** Square, icon only; `label` becomes the aria-label and the tooltip falls back to it. */
  iconOnly?: boolean
  label?: ReactNode
  children?: ReactNode
  /** Trailing chevron for pull-downs. */
  chevron?: boolean
  pressed?: boolean
  loading?: boolean
  disabled?: boolean
  title?: string
  ariaLabel?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (e: React.PointerEvent<HTMLButtonElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit'
  className?: string
  style?: CSSProperties
  test?: string
  ref?: Ref<HTMLButtonElement>
  autoFocus?: boolean
  /** Buttons in sheets and popovers may take focus from the keyboard; mouse clicks never move it (01 §6.0). */
  role?: string
  ariaHaspopup?: 'menu' | 'dialog' | 'listbox'
  ariaExpanded?: boolean
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 12, md: 14, lg: 16, toolbar: 16 }

/** Push button (spec 01 §6.1). */
export function Button({
  variant = 'default',
  size = 'md',
  icon,
  iconOnly,
  label,
  children,
  chevron,
  pressed,
  loading,
  disabled,
  title,
  ariaLabel,
  onClick,
  type = 'button',
  className,
  test,
  ref,
  ariaHaspopup,
  ariaExpanded,
  ...rest
}: ButtonProps) {
  const text = label ?? children
  const iconSize = ICON_SIZE[size]
  const classes = ['button', `button--${variant}`, `button--${size}`]
  if (iconOnly) classes.push('button--icon')
  if (className) classes.push(className)
  return (
    <button
      ref={ref}
      type={type}
      className={classes.join(' ')}
      disabled={disabled || loading}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-label={ariaLabel ?? (iconOnly && typeof text === 'string' ? text : undefined)}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      title={title ?? (iconOnly && typeof text === 'string' ? text : undefined)}
      data-test={test}
      onMouseDown={noMouseFocus}
      onClick={onClick}
      style={rest.style}
      onContextMenu={rest.onContextMenu}
      onPointerDown={rest.onPointerDown}
      onPointerUp={rest.onPointerUp}
      onKeyDown={rest.onKeyDown}
      autoFocus={rest.autoFocus}
    >
      {loading ? <Spinner size={12} /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {!iconOnly && text !== undefined && text !== null && <span className="button__label">{text}</span>}
      {chevron && <Icon name="chevron-down" size={10} className="button__chevron" />}
    </button>
  )
}
