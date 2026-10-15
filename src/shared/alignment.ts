import type { AlignmentResult, AlignmentSuspect, Angle, Play } from './types'

/**
 * Clip alignment check (improvement 14), from clip lengths alone, no on-screen clock reading.
 *
 * An All-22 clip runs from just before the snap to the whistle, so its length follows the kind of play: kneels and
 * spikes are short, punts and kickoffs long, long gains longer than stuffed runs. Three signals, strongest first:
 *
 * 1. Angles disagree: the sideline and end zone clips of one play are cut from the same snap and whistle, so their
 *    lengths agree within a second or so. When they don't, and one of them matches the other angle's clip of a
 *    neighbouring play, that clip is on the wrong play.
 * 2. Shifted run: within one angle, a stretch of clips fits the plays one before or after much better than the
 *    plays they are matched to (the classic one missing or extra clip in the middle of a game).
 * 3. Way off: a clip far shorter or longer than any play of its kind runs (a 2 s clip on a punt return TD).
 */

export interface AlignmentClip {
  clipId: number | null
  path: string
  angle: Angle
  playId: number | null
  /** Seconds; null when unknown. */
  duration: number | null
}

const BASE: Record<string, number> = {
  pass: 7,
  run: 5.5,
  punt: 10,
  kickoff: 9.5,
  field_goal: 5,
  extra_point: 4.5,
  qb_kneel: 3.5,
  qb_spike: 3,
  no_play: 5.5
}

/** What a clip of this play usually runs, in seconds. */
export function expectedDuration(play: Play): number {
  let d = BASE[play.playType] ?? 6
  const yards = Math.abs(play.yardsGained ?? 0)
  if (play.playType === 'pass' || play.playType === 'run') d += Math.min(yards, 60) * 0.07
  if (play.sack) d += 1
  if (play.touchdown && (play.playType === 'punt' || play.playType === 'kickoff')) d += 3
  if (play.turnover) d += 2
  return d
}

/** How badly a length fits an expected length: |log ratio|, 0 = perfect. */
const misfit = (actual: number, expected: number) => Math.abs(Math.log(Math.max(actual, 0.2) / expected))

/** Clips this far off (×/÷) are flagged on their own. */
const WAY_OFF = Math.log(2.6)
/** Two angles of one play differ by more than max(ANGLE_ABS, ANGLE_REL × longer). */
const ANGLE_ABS = 1.5
const ANGLE_REL = 0.25
const WINDOW = 3

export function checkAlignment(gameId: string, clips: AlignmentClip[], plays: Play[]): AlignmentResult {
  const byId = new Map(plays.map((p) => [p.playId, p]))
  const order = [...plays].sort((a, b) => a.playId - b.playId)
  const indexOf = new Map(order.map((p, i) => [p.playId, i]))
  const suspects = new Map<string, AlignmentSuspect>()
  const known = clips.filter((c) => c.duration !== null && c.playId !== null && byId.has(c.playId))
  const flag = (c: AlignmentClip, reason: AlignmentSuspect['reason'], betterPlayId: number | null, message: string) => {
    if (suspects.has(c.path)) return
    const play = byId.get(c.playId!)!
    suspects.set(c.path, {
      clipId: c.clipId,
      path: c.path,
      angle: c.angle,
      playId: play.playId,
      reason,
      clipDuration: c.duration!,
      expected: Math.round(expectedDuration(play) * 10) / 10,
      betterPlayId,
      message
    })
  }

  // 1. Angles disagree.
  const byAngle = new Map<Angle, Map<number, AlignmentClip>>()
  for (const c of known) {
    const m = byAngle.get(c.angle) ?? byAngle.set(c.angle, new Map()).get(c.angle)!
    if (!m.has(c.playId!)) m.set(c.playId!, c)
  }
  const angles = [...byAngle.keys()]
  const differ = (a: number, b: number) => Math.abs(a - b) > Math.max(ANGLE_ABS, ANGLE_REL * Math.max(a, b))
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      const A = byAngle.get(angles[i])!
      const B = byAngle.get(angles[j])!
      for (const [playId, a] of A) {
        const b = B.get(playId)
        if (!b || !differ(a.duration!, b.duration!)) continue
        const k = indexOf.get(playId)!
        const neighbours = [order[k - 1], order[k + 1]].filter(Boolean).map((p) => p.playId)
        // Which side is off? The clip that matches the other angle's clip on a neighbouring play.
        const aMoved = neighbours.find((n) => B.get(n) && !differ(a.duration!, B.get(n)!.duration!))
        const bMoved = neighbours.find((n) => A.get(n) && !differ(b.duration!, A.get(n)!.duration!))
        const exp = expectedDuration(byId.get(playId)!)
        const msg = 'Clip length doesn’t match the other angle of this play. Check the match.'
        if (aMoved !== undefined && bMoved === undefined) flag(a, 'angleMismatch', aMoved, msg)
        else if (bMoved !== undefined && aMoved === undefined) flag(b, 'angleMismatch', bMoved, msg)
        else if (misfit(a.duration!, exp) > misfit(b.duration!, exp)) flag(a, 'angleMismatch', null, msg)
        else flag(b, 'angleMismatch', null, msg)
      }
    }
  }

  // 2. Shifted runs within an angle: compare the window's fit at offset 0 against ±1.
  for (const [, m] of byAngle) {
    const list = [...m.values()].sort((x, y) => indexOf.get(x.playId!)! - indexOf.get(y.playId!)!)
    if (list.length < 2 * WINDOW + 1) continue
    const cost = (c: AlignmentClip, shift: number) => {
      const p = order[indexOf.get(c.playId!)! + shift]
      return p ? misfit(c.duration!, expectedDuration(p)) : null
    }
    for (let i = 0; i < list.length; i++) {
      const win = list.slice(Math.max(0, i - WINDOW), i + WINDOW + 1)
      const sum = (shift: number) => {
        let s = 0
        for (const c of win) {
          const v = cost(c, shift)
          if (v === null) return Infinity
          s += v
        }
        return s / win.length
      }
      const here = sum(0)
      for (const shift of [-1, 1]) {
        const there = sum(shift)
        // Clearly better one play over, and the fit here is poor in absolute terms.
        if (there < here * 0.55 && here > 0.25) {
          const c = list[i]
          const better = order[indexOf.get(c.playId!)! + shift]
          flag(c, 'shifted', better?.playId ?? null, `Clip lengths around here fit the ${shift < 0 ? 'previous' : 'next'} play better. Check the match.`)
          break
        }
      }
    }
  }

  // 3. Way off on its own.
  for (const c of known) {
    const exp = expectedDuration(byId.get(c.playId!)!)
    const r = Math.log(Math.max(c.duration!, 0.2) / exp)
    if (r < -WAY_OFF) flag(c, 'tooShort', null, 'Clip is much shorter than this play would run. Check the match.')
    else if (r > WAY_OFF) flag(c, 'tooLong', null, 'Clip is much longer than this play would run. Check the match.')
  }

  return {
    gameId,
    checked: known.length,
    unknown: clips.filter((c) => c.duration === null).length,
    suspects: [...suspects.values()].sort((a, b) => a.playId - b.playId || a.angle.localeCompare(b.angle))
  }
}
