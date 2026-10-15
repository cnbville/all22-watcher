import { ink } from '../heat'

/** A trend in a row: 64×20 or 120×32, dashed 50 line, last point in its ink (spec 01 §6.34). */
export function Sparkline({ values, width = 64, height = 20 }: { values: number[]; width?: 64 | 120; height?: 20 | 32 }) {
  if (!values.length) return <span className="missing">—</span>
  const pad = 3
  const x = (i: number) => (values.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (values.length - 1))
  const y = (v: number) => pad + (1 - v / 100) * (height - 2 * pad)
  const last = values[values.length - 1]
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trend, last ${Math.round(last)}`}>
      <line className="sparkline__mid" x1={0} x2={width} y1={y(50)} y2={y(50)} />
      {values.length > 1 && <polyline className="sparkline__line" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" />}
      <circle cx={x(values.length - 1)} cy={y(last)} r={2} fill={ink(last)} />
    </svg>
  )
}
