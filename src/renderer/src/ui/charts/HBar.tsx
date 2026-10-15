import { fill, ink } from '../heat'

/** Horizontal bar for splits and leaderboards: 6 tall track, heat fill, value in ink (spec 01 §6.34). */
export function HBar({ score, width = 120 }: { score: number | null; width?: number }) {
  return (
    <span className="hbar">
      <span className="hbar__track" style={{ width }}>
        {score !== null && <span className="hbar__fill" style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: fill(score) }} />}
      </span>
      <span className="hbar__value" style={{ color: score === null ? undefined : ink(score) }}>
        {score === null ? '—' : Math.round(score)}
      </span>
    </span>
  )
}
