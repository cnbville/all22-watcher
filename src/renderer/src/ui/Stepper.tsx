import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/** A small number with up/down halves (spec 01 §6.11). ↑/↓ step 1, ⇧ steps 10; holding repeats. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  ariaLabel
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  ariaLabel?: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const repeat = useRef<{ t: ReturnType<typeof setTimeout> | null; i: ReturnType<typeof setInterval> | null }>({ t: null, i: null })
  const latest = useRef(value)
  latest.current = value
  const stop = () => {
    if (repeat.current.t) clearTimeout(repeat.current.t)
    if (repeat.current.i) clearInterval(repeat.current.i)
    repeat.current = { t: null, i: null }
  }
  const start = (dir: number) => {
    const bump = () => {
      const next = clamp(latest.current + dir * step)
      latest.current = next
      onChange(next)
    }
    bump()
    repeat.current.t = setTimeout(() => (repeat.current.i = setInterval(bump, 80)), 400)
  }
  useEffect(() => stop, [])
  return (
    <span className="stepper">
      <input
        className="text-field text-field--md stepper__field"
        value={text}
        aria-label={ariaLabel}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text)
          if (Number.isFinite(n)) onChange(clamp(Math.round(n)))
          else setText(String(value))
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * step))
          } else if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <span className="stepper__buttons">
        <button type="button" aria-label="Increase" disabled={value >= max} onMouseDown={(e) => (e.preventDefault(), start(1))} onMouseUp={stop} onMouseLeave={stop}>
          <Icon name="chevron-up" size={10} />
        </button>
        <button type="button" aria-label="Decrease" disabled={value <= min} onMouseDown={(e) => (e.preventDefault(), start(-1))} onMouseUp={stop} onMouseLeave={stop}>
          <Icon name="chevron-down" size={10} />
        </button>
      </span>
    </span>
  )
}
