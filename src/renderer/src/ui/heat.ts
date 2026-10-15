import { mixOklab, withAlpha } from './color'

/**
 * The one heat scale for every grade, rank and +/0/− count (spec 01 §5.2): red → neutral grey → green, mixed in
 * OKLab with an easing exponent so values near 50 stay calm. Ink is for numbers and glyphs, fill for bars.
 */
export const HEAT = {
  lo: '#EF5A5F',
  mid: '#9B9BA4',
  hi: '#4FC98C',
  loFill: '#8A3A3E',
  midFill: '#4A4A52',
  hiFill: '#2C7A55'
} as const

function build(mid: string, lo: string, hi: string): string[] {
  const out: string[] = []
  for (let score = 0; score <= 100; score++) {
    const d = Math.max(-1, Math.min(1, (score - 50) / 50))
    const t = Math.pow(Math.abs(d), 0.6)
    out.push(mixOklab(mid, d >= 0 ? hi : lo, t))
  }
  return out
}

const INK = build(HEAT.mid, HEAT.lo, HEAT.hi)
const FILL = build(HEAT.midFill, HEAT.loFill, HEAT.hiFill)

const clampScore = (score: number) => Math.max(0, Math.min(100, Math.round(score)))

/** Numbers, glyphs and ring arcs. */
export function ink(score: number): string {
  return INK[clampScore(score)]
}

/** Bars, segments and chart bars. */
export function fill(score: number): string {
  return FILL[clampScore(score)]
}

/** The ink at 14% alpha: selected grade segments, badges. */
export function tint(score: number): string {
  return withAlpha(ink(score), 0.14)
}

/** The PDF report's light print palette (03 §12.2): the same formula with print anchors. */
export const HEAT_PRINT = {
  lo: '#C2272F',
  mid: '#66666E',
  hi: '#167A4A',
  loFill: '#F0B4B6',
  midFill: '#D4D4D9',
  hiFill: '#9ED8B9'
} as const

const PRINT_INK = build(HEAT_PRINT.mid, HEAT_PRINT.lo, HEAT_PRINT.hi)
const PRINT_FILL = build(HEAT_PRINT.midFill, HEAT_PRINT.loFill, HEAT_PRINT.hiFill)

export const heatPrint = {
  ink: (score: number): string => PRINT_INK[clampScore(score)],
  fill: (score: number): string => PRINT_FILL[clampScore(score)],
  /** Ink at 12% alpha on white. */
  tint: (score: number): string => withAlpha(PRINT_INK[clampScore(score)], 0.12)
}

/** The screen or print heat functions, for charts that render in both (03 §12.2 `palette`). */
export type Palette = 'screen' | 'print'
export function heatFor(palette: Palette = 'screen'): { ink: (s: number) => string; fill: (s: number) => string; tint: (s: number) => string } {
  return palette === 'print' ? heatPrint : { ink, fill, tint }
}

/** 1st of N → 100, last → 0 (01 §5.2 rank badges). */
export function rankScore(rank: number, n = 32): number {
  return n <= 1 ? 50 : (100 * (n - rank)) / (n - 1)
}

/** The score a grade glyph stands for: + → 100, 0 → 50, − → 0. */
export function gradeGlyphScore(grade: -1 | 0 | 1): number {
  return grade > 0 ? 100 : grade < 0 ? 0 : 50
}

/** CSS custom properties for an element colored by a score: `--heat-ink`, `--heat-fill`, `--heat-tint`. */
export function heatVars(score: number | null): Record<string, string> {
  if (score === null) return {}
  return { '--heat-ink': ink(score), '--heat-fill': fill(score), '--heat-tint': tint(score) }
}
