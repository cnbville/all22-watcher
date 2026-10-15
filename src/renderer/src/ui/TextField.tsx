import { type CSSProperties, type Ref, useEffect, useRef, useState } from 'react'

/**
 * Text field (spec 01 §6.6). Controlled by `value`; with `commitOnBlur` it keeps a draft and calls `onCommit` on
 * blur and ↩, and esc reverts. Without it every change goes to `onChange`.
 */
export function TextField({
  value,
  onChange,
  onCommit,
  commitOnBlur,
  placeholder,
  size = 'md',
  invalid,
  disabled,
  width,
  autoFocus,
  selectOnFocus,
  test,
  ariaLabel,
  ref,
  style,
  mono,
  align
}: {
  value: string
  onChange?: (v: string) => void
  onCommit?: (v: string) => void
  commitOnBlur?: boolean
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  /** A message shown under the field; the border turns red. */
  invalid?: string | null
  disabled?: boolean
  width?: number | string
  autoFocus?: boolean
  selectOnFocus?: boolean
  test?: string
  ariaLabel?: string
  ref?: Ref<HTMLInputElement>
  style?: CSSProperties
  mono?: boolean
  align?: 'left' | 'right'
}) {
  const [draft, setDraft] = useState(value)
  const reverting = useRef(false)
  useEffect(() => setDraft(value), [value])
  const shown = commitOnBlur ? draft : value
  return (
    <span className="text-field-wrap" style={{ width }}>
      <input
        ref={ref}
        className={`text-field text-field--${size}${invalid ? ' text-field--invalid' : ''}${mono ? ' text-field--mono' : ''}`}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck={false}
        aria-label={ariaLabel ?? placeholder}
        aria-invalid={!!invalid}
        data-test={test}
        style={{ ...style, textAlign: align }}
        onFocus={(e) => selectOnFocus && e.currentTarget.select()}
        onChange={(e) => (commitOnBlur ? setDraft(e.target.value) : onChange?.(e.target.value))}
        onBlur={() => {
          if (reverting.current) {
            reverting.current = false
            return
          }
          if (commitOnBlur && draft !== value) onCommit?.(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (!commitOnBlur) onCommit?.(value)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (commitOnBlur) {
              reverting.current = true
              setDraft(value)
            }
            e.currentTarget.blur()
          }
        }}
      />
      {invalid && <span className="text-field__error">{invalid}</span>}
    </span>
  )
}

/** Multi-line text area; saves on blur. */
export function TextArea({
  value,
  onCommit,
  placeholder,
  rows = 3,
  ref,
  test
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  rows?: number
  ref?: Ref<HTMLTextAreaElement>
  test?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <textarea
      ref={ref}
      className="text-area"
      rows={rows}
      value={draft}
      placeholder={placeholder}
      data-test={test}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.blur()
        }
      }}
    />
  )
}
