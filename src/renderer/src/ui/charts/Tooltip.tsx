import type { ReactNode } from 'react'

/** Chart hover tooltip: small popover material, no arrow, 12px from the pointer (spec 01 §6.34). */
export function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="chart-tooltip" style={{ left: x + 12, top: y + 12 }} role="tooltip">
      {children}
    </div>
  )
}
