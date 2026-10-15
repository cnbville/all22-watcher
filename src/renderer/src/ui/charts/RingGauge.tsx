import { ink } from '../heat'

const SPEC: Record<number, { stroke: number; text: string | null; label: boolean }> = {
  120: { stroke: 12, text: 'ring-gauge__value--xl', label: true },
  72: { stroke: 8, text: 'ring-gauge__value--md', label: true },
  44: { stroke: 5, text: 'ring-gauge__value--sm', label: false },
  24: { stroke: 3, text: null, label: false }
}

/** A grade at a glance: a 270° arc open at the bottom, Apple Watch style (spec 01 §6.34). */
export function RingGauge({ score, size = 72, label, animate = true }: { score: number | null; size?: 24 | 44 | 72 | 120; label?: string; animate?: boolean }) {
  const s = SPEC[size]
  const r = (size - s.stroke) / 2
  const c = size / 2
  const sweep = 270
  const circumference = 2 * Math.PI * r
  const arcLength = (circumference * sweep) / 360
  const value = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100
  // The arc starts at the bottom-left (135° from 3 o'clock) and runs clockwise.
  const rotate = 135
  const tick = { x: c, y: s.stroke / 2 }
  return (
    <span className="ring-gauge" style={{ width: size, height: size }} role="img" aria-label={score === null ? 'Not graded' : `Grade ${Math.round(score)}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="ring-gauge__track"
          cx={c}
          cy={c}
          r={r}
          fill="none"
          strokeWidth={s.stroke}
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference}`}
          transform={`rotate(${rotate} ${c} ${c})`}
        />
        {size >= 44 && <rect className="ring-gauge__tick" x={tick.x - 1} y={tick.y - 3} width={2} height={6} rx={1} />}
        {score !== null && value > 0 && (
          <circle
            className={`ring-gauge__arc${animate ? ' ring-gauge__arc--animate' : ''}`}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={ink(score)}
            strokeWidth={s.stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength * value} ${circumference}`}
            style={{ '--arc': `${arcLength * value}`, '--circ': `${circumference}` } as React.CSSProperties}
            transform={`rotate(${rotate} ${c} ${c})`}
          />
        )}
      </svg>
      {s.text && (
        <span className="ring-gauge__center">
          <span className={`ring-gauge__value ${s.text}`} style={{ color: score === null ? undefined : ink(score) }}>
            {score === null ? '—' : Math.round(score)}
          </span>
          {s.label && label && <span className={`ring-gauge__label ring-gauge__label--${size}`}>{label}</span>}
        </span>
      )}
    </span>
  )
}
