import type { CSSProperties } from 'react'

/** Progress bar: 4px (default) or 2px mini; `value` null is indeterminate (spec 01 §6.31). */
export function ProgressBar({
  value,
  mini,
  width,
  style,
  label
}: {
  value: number | null
  mini?: boolean
  width?: number | string
  style?: CSSProperties
  label?: string
}) {
  const v = value === null ? null : Math.max(0, Math.min(1, value))
  return (
    <div
      className={`progress${mini ? ' progress--mini' : ''}`}
      style={{ width, ...style }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v === null ? undefined : Math.round(v * 100)}
    >
      {v === null ? <div className="progress__indeterminate" /> : <div className="progress__fill" style={{ width: `${v * 100}%` }} />}
    </div>
  )
}

const RING: Record<number, number> = { 14: 2, 20: 2.5, 28: 3 }

/** Determinate progress ring, starting at 12 o'clock. */
export function ProgressRing({ value, size = 14 }: { value: number; size?: 14 | 20 | 28 }) {
  const stroke = RING[size]
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <svg className="progress-ring" width={size} height={size} role="progressbar" aria-valuenow={Math.round(v * 100)}>
      <circle className="progress-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
      <circle
        className="progress-ring__arc"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={`${c * v} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        strokeLinecap="round"
      />
    </svg>
  )
}
