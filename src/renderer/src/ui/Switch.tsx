import type { ReactNode } from 'react'
import { noMouseFocus } from './keyboard'

/** Toggle switch for settings that apply immediately (spec 01 §6.9). */
export function Switch({
  checked,
  onChange,
  disabled,
  size = 'md',
  label,
  test
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
  label?: string
  test?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch switch--${size}`}
      data-test={test}
      onMouseDown={noMouseFocus}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  )
}

/** Checkbox with a clickable label (spec 01 §6.10). `mixed` draws the dash. */
export function Checkbox({
  checked,
  mixed,
  onChange,
  disabled,
  children,
  test
}: {
  checked: boolean
  mixed?: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  children?: ReactNode
  test?: string
}) {
  return (
    <label className={`checkbox${disabled ? ' checkbox--disabled' : ''}`} data-test={test} onMouseDown={noMouseFocus}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} ref={(el) => void (el && (el.indeterminate = !!mixed))} />
      <span className="checkbox__box" aria-hidden>
        {mixed ? (
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="4.25" width="8" height="1.5" rx="0.75" fill="currentColor" /></svg>
        ) : checked ? (
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.2 4.1 7.3 8 2.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : null}
      </span>
      {children && <span className="checkbox__label">{children}</span>}
    </label>
  )
}

export function Radio({
  checked,
  onChange,
  disabled,
  children,
  name
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  children?: ReactNode
  name?: string
}) {
  return (
    <label className={`checkbox checkbox--radio${disabled ? ' checkbox--disabled' : ''}`} onMouseDown={noMouseFocus}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="checkbox__box" aria-hidden />
      {children && <span className="checkbox__label">{children}</span>}
    </label>
  )
}

/** Rotating chevron for sections and expandable rows (spec 01 §6.13). */
export function Disclosure({ expanded, onToggle, label }: { expanded: boolean; onToggle?: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="disclosure"
      aria-expanded={expanded}
      aria-label={label ?? (expanded ? 'Collapse' : 'Expand')}
      onMouseDown={noMouseFocus}
      onClick={(e) => {
        e.stopPropagation()
        onToggle?.()
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
