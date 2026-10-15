/** Activity indicator: 12 spokes stepping around the circle (spec 01 §6.31). */
export function Spinner({ size = 16, label }: { size?: 12 | 16 | 20 | 32; label?: string }) {
  const spokes = Array.from({ length: 12 }, (_, i) => i)
  const r1 = size * 0.26
  const r2 = size * 0.46
  const w = Math.max(1.5, size / 10)
  return (
    <svg className="spinner" width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} role="progressbar" aria-label={label ?? 'Loading'}>
      {spokes.map((i) => (
        <line
          key={i}
          x1={0}
          y1={-r1}
          x2={0}
          y2={-r2}
          strokeWidth={w}
          strokeLinecap="round"
          transform={`rotate(${i * 30})`}
          opacity={0.15 + (0.85 * i) / 11}
        />
      ))}
    </svg>
  )
}
