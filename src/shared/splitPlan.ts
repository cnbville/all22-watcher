import type { Angle } from './types'

/**
 * Splitting a full game into one clip per play (splitGame.ts runs ffmpeg; this is the pure part).
 *
 * All-22 coaches film runs play after play with a hard cut between camera shots: each play is shown from the
 * sideline, then again from the end zone. Both shots run from the snap to the whistle, so they are nearly the same
 * length. So the cuts ffmpeg finds give shots, and shots are paired into plays where two in a row match in length.
 * A shot with no partner (a play shown from one angle, a title card) stays a clip of its own.
 */

export interface SplitResult {
  /** The folder of clips, laid out for import (Sideline/001.mp4, End Zone/001.mp4, or Plays/001.mp4). */
  folder: string
  plays: number
  clips: number
  angles: number
}

export interface PlannedShot {
  start: number
  end: number
  /** 1-based play number in the film, shared by a play's sideline and end zone shots. */
  play: number
  angle: Angle
}

/** A single video at least this long is offered for splitting: it holds many plays, not one. */
export const FULL_GAME_SECONDS = 8 * 60

/** Shots shorter than this are flashes or transitions, merged into the shot before them. */
export const MIN_SHOT = 1.2
/** Two shots pair when their lengths differ by less than about this ratio. */
const PAIR_SPREAD = 0.1
const SINGLE = 1.5
/** Below this share of shots in pairs the film is treated as one angle. */
const PAIRED_SHARE = 0.5

/** Shots between the cuts (seconds), with flashes merged away. */
export function shotsFromCuts(cuts: number[], duration: number): { start: number; end: number }[] {
  const times = [...new Set(cuts.filter((t) => t > 0 && t < duration))].sort((a, b) => a - b)
  const shots: { start: number; end: number }[] = []
  let start = 0
  for (const t of [...times, duration]) {
    if (t - start < MIN_SHOT && shots.length) shots[shots.length - 1].end = t
    else shots.push({ start, end: t })
    start = t
  }
  // A short first shot was kept only because there was nothing before it: fold it into the next.
  if (shots.length > 1 && shots[0].end - shots[0].start < MIN_SHOT) {
    shots[1].start = shots[0].start
    shots.shift()
  }
  return shots
}

/** Pairs shots into plays (sideline first, then end zone), or numbers them one per play when the film has one angle. */
export function planPlays(cuts: number[], duration: number): PlannedShot[] {
  const shots = shotsFromCuts(cuts, duration)
  const len = shots.map((s) => s.end - s.start)
  const k = shots.length
  // cost[i]: best cost of the first i shots; pair[i]: whether shot i-1 ends a pair.
  const cost = new Float64Array(k + 1)
  const pair = new Uint8Array(k + 1)
  for (let i = 1; i <= k; i++) {
    cost[i] = cost[i - 1] + SINGLE
    if (i >= 2) {
      const c = cost[i - 2] + Math.abs(Math.log(len[i - 2] / len[i - 1])) / PAIR_SPREAD
      if (c < cost[i]) {
        cost[i] = c
        pair[i] = 1
      }
    }
  }
  const groups: number[][] = []
  for (let i = k; i > 0; ) {
    if (pair[i]) {
      groups.unshift([i - 2, i - 1])
      i -= 2
    } else {
      groups.unshift([i - 1])
      i -= 1
    }
  }
  const paired = groups.filter((g) => g.length === 2).length * 2
  if (k && paired / k < PAIRED_SHARE) return shots.map((s, i) => ({ ...s, play: i + 1, angle: 'main' }))
  return groups.flatMap((g, i) => g.map((s, j) => ({ ...shots[s], play: i + 1, angle: j === 0 ? ('sideline' as const) : ('endzone' as const) })))
}

/** Reads the cut times out of ffmpeg's `showinfo` lines. */
export function parseShowinfo(stderr: string): number[] {
  const out: number[] = []
  for (const m of stderr.matchAll(/Parsed_showinfo[^\n]*?pts_time:\s*([\d.]+)/g)) out.push(Number(m[1]))
  return out
}
