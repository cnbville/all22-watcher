import type { CSSProperties } from 'react'

/** Slider (spec 01 §6.12): accent-filled track and a knob; ←/→ step, ⇧ for 10 steps. */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  size = 'md',
  ticks,
  ariaLabel,
  width
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  size?: 'sm' | 'md'
  ticks?: { value: number; label?: string }[]
  ariaLabel?: string
  width?: number | string
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <span className={`slider slider--${size}`} style={{ width, '--pct': `${pct}%` } as CSSProperties}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onMouseDown={(e) => e.currentTarget.blur()}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault()
            onChange(Math.max(min, Math.min(max, value + (e.key === 'ArrowLeft' ? -10 : 10) * step)))
          }
        }}
      />
      {ticks && (
        <span className="slider__ticks">
          {ticks.map((t) => (
            <span key={t.value} className="slider__tick" style={{ left: `${((t.value - min) / (max - min)) * 100}%` }}>
              {t.label && <span className="slider__tick-label">{t.label}</span>}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}
