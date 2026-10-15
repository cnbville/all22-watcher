import type { Clip, Settings } from './types'

/** Pre-roll choices offered in Settings and the export sheet, in seconds. */
export const PRE_ROLLS = [0, 0.5, 1, 1.5, 2, 3] as const

/** Where a clip starts playing: its snap point minus the pre-roll when "Start clips at the snap" is on, else 0. */
export function clipStartTime(clip: Pick<Clip, 'snapMs'>, s: Pick<Settings, 'startAtSnap' | 'preRoll'>): number {
  return s.startAtSnap && clip.snapMs !== null ? Math.max(0, clip.snapMs / 1000 - s.preRoll) : 0
}
