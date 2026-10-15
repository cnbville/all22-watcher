import { useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'
import { noMouseFocus } from './keyboard'

export interface SegmentOption<T extends string> {
  value: T
  label?: string
  icon?: IconName
  title?: string
  disabled?: boolean
  test?: string
}

type Size = 'sm' | 'md' | 'toolbar'

/** Exclusive choice with a sliding thumb (spec 01 §6.2). ←/→ change the selection when focused. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  test
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  size?: Size
  label?: string
  test?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  const [animate, setAnimate] = useState(false)

  useLayoutEffect(() => {
    const el = track.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!el) return setThumb(null)
    setThumb({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value, options.length, options.map((o) => o.label).join()])
  // Slide only after the first placement.
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const move = (dir: number) => {
    const enabled = options.filter((o) => !o.disabled)
    const i = enabled.findIndex((o) => o.value === value)
    const next = enabled[(i + dir + enabled.length) % enabled.length]
    if (next) onChange(next.value)
  }

  return (
    <div
      ref={track}
      className={`segmented segmented--${size}`}
      role="radiogroup"
      aria-label={label}
      data-test={test}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          e.stopPropagation()
          move(e.key === 'ArrowLeft' ? -1 : 1)
        }
      }}
    >
      {thumb && <span className={`segmented__thumb${animate ? ' segmented__thumb--animate' : ''}`} style={{ left: thumb.left, width: thumb.width }} />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          className={`segmented__item${o.icon && !o.label ? ' segmented__item--icon' : ''}`}
          title={o.title ?? (o.icon && !o.label ? o.value : undefined)}
          aria-label={o.label ? undefined : o.title}
          data-test={o.test}
          onMouseDown={noMouseFocus}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={size === 'sm' ? 12 : 14} />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  )
}

/** Same look, but each segment toggles on its own (spec 01 §6.3). */
export function ToggleSegments<T extends string>({
  options,
  values,
  onChange,
  size = 'md',
  label
}: {
  options: SegmentOption<T>[]
  values: T[]
  onChange: (v: T[]) => void
  size?: Size
  label?: string
}) {
  return (
    <div className={`segmented segmented--${size} segmented--toggles`} role="group" aria-label={label}>
      {options.map((o) => {
        const on = values.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            className={`segmented__item${o.icon && !o.label ? ' segmented__item--icon' : ''}`}
            title={o.title}
            data-test={o.test}
            onMouseDown={noMouseFocus}
            onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
          >
            {o.icon && <Icon name={o.icon} size={size === 'sm' ? 12 : 14} />}
            {o.label && <span>{o.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
