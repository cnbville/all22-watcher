import type { CSSProperties } from 'react'
import { SMALL_SAMPLE } from '@shared/splits'
import { heatFor, type Palette } from '../../ui/heat'

/**
 * Grades from a subset of a player's plays (03 §2.4): 0 plays "—", 1–4 plays grey with a caution tooltip,
 * 5 or more in the heat ink.
 */
export type SampleTone = 'none' | 'small' | 'full'

export function sampleTone(plays: number): SampleTone {
  return plays <= 0 ? 'none' : plays < SMALL_SAMPLE ? 'small' : 'full'
}

export function smallSampleTip(plays: number): string {
  return `Only ${plays} graded ${plays === 1 ? 'play' : 'plays'}, too few to read much into.`
}

/** The ink for a grade from `plays` graded plays: heat ink, or grey for small samples. */
export function sampleInk(score: number | null, plays: number, palette: Palette = 'screen'): string {
  if (score === null || plays <= 0) return 'var(--ch-label-4)'
  if (plays < SMALL_SAMPLE) return 'var(--ch-label-3)'
  return heatFor(palette).ink(score)
}

/** A bar or dot fill: heat fill, or the neutral fill for small samples. */
export function sampleFill(score: number | null, plays: number, palette: Palette = 'screen'): string {
  if (score === null || plays <= 0) return 'transparent'
  if (plays < SMALL_SAMPLE) return 'var(--ch-neutral)'
  return heatFor(palette).fill(score)
}

/** The grade as text (13/16 semibold), §2.4 rules. */
export function SampleGrade({ score, plays, palette = 'screen', className }: { score: number | null; plays: number; palette?: Palette; className?: string }) {
  const tone = sampleTone(plays)
  if (score === null || tone === 'none') return <span className={`sample-grade sample-grade--none${className ? ` ${className}` : ''}`}>—</span>
  return (
    <span
      className={`sample-grade sample-grade--${tone}${className ? ` ${className}` : ''}`}
      style={tone === 'full' ? { color: heatFor(palette).ink(score) } : undefined}
      title={tone === 'small' ? smallSampleTip(plays) : undefined}
    >
      {Math.round(score)}
    </span>
  )
}

/** The 20-tall grade badge (01 §6.29) with §2.4 rules: small samples get a neutral badge. */
export function SampleBadge({ score, plays, palette = 'screen', title }: { score: number | null; plays: number; palette?: Palette; title?: string }) {
  const tone = sampleTone(plays)
  if (score === null || tone === 'none') return <span className="sample-badge sample-badge--none">—</span>
  const heat = heatFor(palette)
  const style = tone === 'full' ? ({ '--badge-ink': heat.ink(score), '--badge-tint': heat.tint(score) } as CSSProperties) : undefined
  return (
    <span className={`sample-badge sample-badge--${tone}`} style={style} title={title ?? (tone === 'small' ? smallSampleTip(plays) : undefined)}>
      {Math.round(score)}
    </span>
  )
}
