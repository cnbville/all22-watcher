/** Time labels for the transport (02 §5.5). */

const MINUS = '−'

/** "1.80", from 60 s on "1:02.40". */
export function formatSeconds(t: number): string {
  const v = Math.max(0, t)
  if (v < 60) return v.toFixed(2)
  const m = Math.floor(v / 60)
  const s = v - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

/** Play time with sign: "−0.40", "0.00" (within half a frame of the snap), "+2.53". */
export function formatFromSnap(t: number, snap: number, frame: number): string {
  const d = t - snap
  if (Math.abs(d) < frame / 2) return '0.00'
  return `${d < 0 ? MINUS : '+'}${formatSeconds(Math.abs(d))}`
}

/** The elapsed label in the chosen mode. */
export function elapsedLabel(t: number, snap: number | null, mode: 'snap' | 'clip', frame: number): string {
  return mode === 'snap' && snap !== null ? formatFromSnap(t, snap, frame) : formatSeconds(t)
}

/** "1.80 s" for toasts and menus. */
export function secondsLabel(t: number): string {
  return `${t.toFixed(2)} s`
}
