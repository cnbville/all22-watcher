import { useRef } from 'react'
import { Icon } from './Icon'
import { noMouseFocus } from './keyboard'
import { type MenuItemSpec, openMenu } from './Menu'

export interface PopupOption<T> {
  value: T
  label: string
  disabled?: boolean
  test?: string
}

/**
 * Popup button (select) showing the current value (spec 01 §6.4). Opens a menu with the checked item over the
 * button. Space/↩/↓ open it; type-select while closed changes the value.
 */
export function PopupButton<T>({
  value,
  options,
  onChange,
  size = 'md',
  variant = 'default',
  disabled,
  width,
  label,
  test,
  sections,
  extra
}: {
  value: T
  options: PopupOption<T>[]
  onChange: (v: T) => void
  size?: 'sm' | 'md' | 'toolbar'
  variant?: 'default' | 'inline'
  disabled?: boolean
  width?: number
  /** Overrides the shown text. */
  label?: string
  test?: string
  /** Prebuilt menu items instead of `options` (e.g. section headers). */
  sections?: MenuItemSpec[]
  extra?: MenuItemSpec[]
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const current = options.find((o) => o.value === value)
  const open = () => {
    if (!ref.current || disabled) return
    const items: MenuItemSpec[] =
      sections ??
      options.map((o) => ({ label: o.label, checked: o.value === value, disabled: o.disabled, test: o.test, run: () => onChange(o.value) }))
    openMenu({ anchor: ref.current, items: extra ? [...items, ...extra] : items, placement: 'checked', minWidth: ref.current.offsetWidth + 24 })
  }
  return (
    <button
      ref={ref}
      type="button"
      className={`popup-button popup-button--${size} popup-button--${variant}`}
      disabled={disabled}
      aria-haspopup="menu"
      data-test={test}
      style={{ width }}
      onMouseDown={(e) => {
        noMouseFocus(e)
        open()
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault()
          open()
        } else if (e.key.length === 1 && !e.metaKey) {
          const now = performance.now()
          typed.current = { text: (now - typed.current.at < 1000 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
          const hit = options.find((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text))
          if (hit) onChange(hit.value)
        }
      }}
    >
      <span className="popup-button__label">{label ?? current?.label ?? ''}</span>
      <Icon name="chevrons-up-down" size={12} className="popup-button__chevrons" />
    </button>
  )
}

/** Pull-down: a group of actions under a label or icon (spec 01 §6.5). */
export function PulldownButton({
  label,
  icon,
  items,
  size = 'md',
  variant = 'default',
  iconOnly,
  title,
  test,
  disabled
}: {
  label: string
  icon?: import('./Icon').IconName
  items: MenuItemSpec[] | (() => MenuItemSpec[])
  size?: 'sm' | 'md' | 'toolbar'
  variant?: 'default' | 'borderless' | 'toolbar'
  iconOnly?: boolean
  title?: string
  test?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const open = () => {
    if (!ref.current) return
    openMenu({ anchor: ref.current, items: typeof items === 'function' ? items() : items, placement: 'below' })
  }
  return (
    <button
      ref={ref}
      type="button"
      className={`button button--${variant} button--${size}${iconOnly ? ' button--icon' : ''}`}
      aria-haspopup="menu"
      aria-label={iconOnly ? label : undefined}
      title={title ?? (iconOnly ? label : undefined)}
      data-test={test}
      disabled={disabled}
      onMouseDown={(e) => {
        noMouseFocus(e)
        open()
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault()
          open()
        }
      }}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 12 : size === 'md' ? 14 : 16} />}
      {!iconOnly && <span className="button__label">{label}</span>}
      {!(iconOnly && icon === 'ellipsis') && <Icon name="chevron-down" size={10} className="button__chevron" />}
    </button>
  )
}
