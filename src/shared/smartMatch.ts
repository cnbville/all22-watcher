import { expectedDuration } from './alignment'
import { baseName, filmablePlays } from './matching'
import type { Angle, Play } from './types'

/**
 * Matching for clips cut by hand (smart matching).
 *
 * Clips cut by hand from a full game don't line up one to one with the play-by-play: plays get skipped (the other
 * team's snaps, plays without the player being studied), a play can be cut twice, and nothing on the film names the
 * play. What still holds is order: clips are cut in the order the game was played. So each angle's clips are placed
 * on an increasing run of plays, picking the placement that best explains:
 *
 * - order: a clip comes after the previous clip's play;
 * - skips: skipping plays costs a little, starting a new run of skips costs more (people cut drives, not random plays);
 * - length: a clip's length fits the kind of play (alignment.ts), after learning how long this person's clips run
 *   compared with the plays (padding, or both angles in one clip);
 * - the plays the user already confirmed (anchors), which every placement must keep.
 *
 * Every clip also gets a margin: how much worse its next best placement is. Clips with a small margin are the ones
 * worth a look; confirming one usually settles the clips around it.
 */

export type Side = 'all' | 'offense' | 'defense'

/** Which plays the clips were cut from. */
export interface MatchScope {
  side: Side
  includeSpecialTeams: boolean
  includeNoPlays: boolean
}

export interface SmartClip {
  path: string
  angle: Angle
  /** Seconds; null when unknown. */
  duration: number | null
}

export interface SmartPlacement {
  playId: number | null
  /** How much worse the next best placement of this clip is (0 = a coin flip). Infinity for anchored clips. */
  margin: number
  /** Whether the margin is wide enough to trust without a look. */
  sure: boolean
  anchored: boolean
}

/** Plays the clips are placed on: the filmable plays of the scope, in game order. */
export function scopePlays(plays: Play[], scope: MatchScope, team: string | null): Play[] {
  const filmable = filmablePlays(plays, scope.includeSpecialTeams, scope.includeNoPlays)
  if (scope.side === 'all' || !team) return filmable
  return filmable.filter((p) => (scope.side === 'offense' ? p.posteam === team : p.defteam === team))
}

const SIDES: Side[] = ['all', 'offense', 'defense']

/**
 * Guesses which plays were cut from how many clips there are: the smallest scope that still has a play for every
 * clip, among the scopes holding every play the user confirmed. Too few plays costs more than too many, since
 * skipping plays is normal for hand-cut film and clips without a play are not. One side of the ball is only guessed
 * when the clips could be most of its snaps, or the user's own matches (three or more) are all on that side.
 */
export function guessScope(plays: Play[], team: string | null, clipCount: number, anchoredPlayIds: number[] = []): MatchScope {
  const byId = new Map(plays.map((p) => [p.playId, p]))
  const anchored = anchoredPlayIds.map((id) => byId.get(id)).filter((p): p is Play => !!p)
  let sides: Side[] = ['all']
  if (team) {
    const ofSide = (side: Side) => scopePlays(plays, { side, includeSpecialTeams: false, includeNoPlays: false }, team).length
    const onSide = (side: 'offense' | 'defense') => anchored.length >= 3 && anchored.every((p) => (side === 'offense' ? p.posteam : p.defteam) === team)
    if (onSide('offense')) sides = ['offense']
    else if (onSide('defense')) sides = ['defense']
    else if (clipCount >= 0.6 * Math.min(ofSide('offense'), ofSide('defense'))) sides = SIDES
  }
  let best: { scope: MatchScope; cost: number } | null = null
  for (const side of sides) {
    for (const includeSpecialTeams of [false, true]) {
      for (const includeNoPlays of [false, true]) {
        const scope = { side, includeSpecialTeams, includeNoPlays }
        const ps = scopePlays(plays, scope, team)
        const ids = new Set(ps.map((p) => p.playId))
        if (!anchoredPlayIds.every((id) => ids.has(id))) continue
        const m = ps.length
        const cost = m < clipCount ? (clipCount - m) * 3 : m - clipCount
        if (!best || cost < best.cost) best = { scope, cost }
      }
    }
  }
  return best?.scope ?? { side: 'all', includeSpecialTeams: true, includeNoPlays: true }
}

/** Costs, in units of "how badly a length fits" (|log ratio| / lengthSpread). Tuned on simulated games (smartMatch.test.ts). */
export const TUNING = {
  lengthSpread: 0.4,
  /** Lengths never count for more than this per clip, so one odd clip can't drag the rest. */
  lengthCap: 2.5,
  /** Starting a run of skipped plays. */
  skipRun: 2,
  /** A clip that isn't any play in the scope (a play cut twice, a replay). */
  noPlay: 5
}
/** A margin below this is worth a look. */
export const SURE_MARGIN = 1.5

/**
 * Places every clip on a play. `clips` are in cut order (each angle's clips in the order they sort); `anchors` holds
 * the user's own matches by path (null = not a play). Anchored plays outside the scope are matched anyway.
 */
export function smartMatch(clips: SmartClip[], scoped: Play[], allPlays: Play[], anchors: Map<string, number | null> = new Map()): Map<string, SmartPlacement> {
  const out = new Map<string, SmartPlacement>()
  const byAngle = new Map<Angle, SmartClip[]>()
  for (const c of clips) byAngle.set(c.angle, [...(byAngle.get(c.angle) ?? []), c])
  const byId = new Map(allPlays.map((p) => [p.playId, p]))
  const playsFor = (pinned: (number | null | undefined)[]) => {
    const ids = new Set(scoped.map((p) => p.playId))
    const extra = [...new Set(pinned.filter((id): id is number => typeof id === 'number' && byId.has(id) && !ids.has(id)))]
    return [...scoped, ...extra.map((id) => byId.get(id)!)].sort((a, b) => a.playId - b.playId)
  }

  // Angles cut from the same plays (a cut-up, a split game) are placed together: the clips of one play in every angle
  // move as one, so one angle's lengths and the user's picks on either settle both.
  const lists = [...byAngle.values()]
  const groups = playGroups(lists)
  if (groups) {
    const pinned = groups.map((g) => {
      const picks = g.filter((c) => anchors.has(c.path)).map((c) => anchors.get(c.path)!)
      return picks.length ? picks : null
    })
    // Picks that put two angles of one play on different plays can't be placed together.
    if (pinned.every((p) => !p || p.every((x) => x === p[0]))) {
      const key = (k: number) => `\0${k}`
      const combined: SmartClip[] = groups.map((g, k) => {
        const lengths = g.map((c) => c.duration).filter((d): d is number => !!d)
        return { path: key(k), angle: g[0].angle, duration: lengths.length ? lengths.reduce((a, b) => a + b) / lengths.length : null }
      })
      const jointAnchors = new Map(pinned.flatMap((p, k): [string, number | null][] => (p ? [[key(k), p[0]]] : [])))
      const placed = alignAngle(combined, playsFor(pinned.flat()), jointAnchors)
      groups.forEach((g, k) => g.forEach((c) => out.set(c.path, { ...placed.get(key(k))!, anchored: anchors.has(c.path) })))
      return out
    }
  }
  for (const list of lists) {
    const plays = playsFor(list.map((c) => anchors.get(c.path)))
    for (const [path, placement] of alignAngle(list, plays, anchors)) out.set(path, placement)
  }
  return out
}

const stemOf = (path: string) => baseName(path).replace(/\.[^.]+$/, '').toLowerCase()

/**
 * The clips of each play across angles, in order, when the angles were cut from the same plays: named alike
 * (Sideline/012.mp4 and End Zone/012.mp4, every angle's names among the fullest angle's), or as many clips each.
 * Null for one angle, or angles cut separately.
 */
export function playGroups(lists: SmartClip[][]): SmartClip[][] | null {
  if (lists.length < 2) return null
  const fullest = [...lists].sort((a, b) => b.length - a.length)[0]
  const stems = fullest.map((c) => stemOf(c.path))
  const unique = (l: SmartClip[]) => new Set(l.map((c) => stemOf(c.path))).size === l.length
  if (lists.every(unique) && lists.every((l) => l.every((c) => stems.includes(stemOf(c.path))))) {
    return stems.map((st) => lists.flatMap((l) => l.filter((c) => stemOf(c.path) === st)))
  }
  if (lists.every((l) => l.length === fullest.length)) return fullest.map((_, k) => lists.map((l) => l[k]))
  return null
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const k = s.length >> 1
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2
}

function alignAngle(clips: SmartClip[], plays: Play[], anchors: Map<string, number | null>): Map<string, SmartPlacement> {
  const n = clips.length
  const m = plays.length
  const expected = plays.map(expectedDuration)
  const lengths = clips.map((c) => c.duration).filter((d): d is number => d !== null && d > 0)
  // How long this person's clips run next to the plays: padding before the snap, both angles in one clip…
  let scale = (median(lengths) ?? 1) / (median(expected) ?? 1)
  if (!Number.isFinite(scale) || scale <= 0) scale = 1

  // Skipping is priced from how many plays there are per clip: cheap when only a few plays were cut.
  const kept = Math.min(0.97, Math.max(0.03, n / Math.max(m, 1)))
  const skip = -Math.log(1 - kept)

  let result = solve(clips, plays, expected, scale, skip, anchors)
  // Learn the scale from the placement once, then place again.
  for (let round = 0; round < 2; round++) {
    const ratios: number[] = []
    result.placement.forEach((j, i) => {
      const d = clips[i].duration
      if (j !== null && d) ratios.push(d / expected[j])
    })
    const learned = median(ratios)
    if (!learned || Math.abs(Math.log(learned / scale)) < 0.02) break
    scale = learned
    result = solve(clips, plays, expected, scale, skip, anchors)
  }

  const out = new Map<string, SmartPlacement>()
  clips.forEach((c, i) => {
    const j = result.placement[i]
    const anchored = anchors.has(c.path)
    const margin = anchored ? Infinity : result.margins[i]
    out.set(c.path, { playId: j === null ? null : plays[j].playId, margin, sure: margin >= SURE_MARGIN, anchored })
  })
  return out
}

/**
 * Min-cost placement by dynamic programming over (clip, last play used), forward and backward, so every clip's best
 * alternative is known too. Play positions are 1-based inside (0 = before the first play). O(clips × plays).
 */
function solve(clips: SmartClip[], plays: Play[], expected: number[], scale: number, skip: number, anchors: Map<string, number | null>) {
  const n = clips.length
  const m = plays.length
  const INF = Infinity
  const position = new Map(plays.map((p, j) => [p.playId, j + 1]))
  const gap = (k: number) => (k <= 0 ? 0 : TUNING.skipRun + k * skip)

  // What clip i (0-based) costs on play j (1-based), and as no play.
  const anchorOf = clips.map((c) => {
    if (!anchors.has(c.path)) return undefined
    const id = anchors.get(c.path)!
    return id === null ? null : (position.get(id) ?? null)
  })
  const fit = (i: number, j: number) => {
    const a = anchorOf[i]
    if (a !== undefined) return a === j ? 0 : INF
    const d = clips[i].duration
    if (!d) return 0
    return Math.min(TUNING.lengthCap, Math.abs(Math.log(d / (scale * expected[j - 1]))) / TUNING.lengthSpread)
  }
  const none = (i: number) => {
    const a = anchorOf[i]
    if (a === undefined) return TUNING.noPlay
    return a === null ? 0 : INF
  }

  const row = () => new Float64Array(m + 1).fill(INF)
  // F[i][j]: best cost of clips 0..i-1 with the last play used = j. Fm[i][j]: same, with clip i-1 on play j, which
  // came after play from[i][j].
  const F: Float64Array[] = [row()]
  F[0][0] = 0
  const Fm: Float64Array[] = [row()]
  const from: Int32Array[] = [new Int32Array(m + 1)]
  for (let i = 1; i <= n; i++) {
    const prev = F[i - 1]
    const cur = row()
    const cm = row()
    const back = new Int32Array(m + 1).fill(-1)
    // Gaps of two or more plays: the running min over j' <= j-2 of prev[j'] - j'*skip, kept as j grows.
    let run = INF
    let runAt = -1
    for (let j = 1; j <= m; j++) {
      if (j >= 2 && prev[j - 2] - (j - 2) * skip < run) {
        run = prev[j - 2] - (j - 2) * skip
        runAt = j - 2
      }
      const jump = run + TUNING.skipRun + (j - 1) * skip
      const f = fit(i - 1, j)
      if (prev[j - 1] <= jump) {
        cm[j] = prev[j - 1] + f
        back[j] = j - 1
      } else {
        cm[j] = jump + f
        back[j] = runAt
      }
    }
    const nc = none(i - 1)
    for (let j = 0; j <= m; j++) cur[j] = Math.min(cm[j], prev[j] + nc)
    F.push(cur)
    Fm.push(cm)
    from.push(back)
  }

  // B[i][j]: best cost of clips i..n-1 given the last play used before them is j (including trailing skips).
  const B: Float64Array[] = Array.from({ length: n + 1 }, row)
  for (let j = 0; j <= m; j++) B[n][j] = gap(m - j)
  for (let i = n - 1; i >= 0; i--) {
    const next = B[i + 1]
    const cur = B[i]
    const h = new Float64Array(m + 2).fill(INF)
    for (let j = 1; j <= m; j++) h[j] = fit(i, j) + next[j]
    const nc = none(i)
    let run = INF
    for (let j = m; j >= 0; j--) {
      if (j + 2 <= m) run = Math.min(run, h[j + 2] + (j + 2) * skip)
      const best = Math.min(j + 1 <= m ? h[j + 1] : INF, run + TUNING.skipRun - (j + 1) * skip)
      cur[j] = Math.min(best, next[j] + nc)
    }
  }

  // Trace the best placement back from the end.
  const placement: (number | null)[] = new Array(n).fill(null)
  let bestEnd = INF
  let j = 0
  for (let k = 0; k <= m; k++) {
    const c = F[n][k] + gap(m - k)
    if (c < bestEnd) {
      bestEnd = c
      j = k
    }
  }
  for (let i = n; i >= 1; i--) {
    if (j > 0 && Fm[i][j] === F[i][j]) {
      placement[i - 1] = j - 1
      j = from[i][j]
    } else placement[i - 1] = null
  }

  // Each clip's margin: best total with the clip elsewhere (another play, or no play) minus the best total.
  const margins = placement.map((pj, i) => {
    let alt = INF
    for (let k = 1; k <= m; k++) {
      if (pj !== null && k === pj + 1) continue
      alt = Math.min(alt, Fm[i + 1][k] + B[i + 1][k])
    }
    if (pj !== null) {
      const nc = none(i)
      for (let k = 0; k <= m; k++) alt = Math.min(alt, F[i][k] + nc + B[i + 1][k])
    }
    return alt - bestEnd
  })

  return { placement, margins, cost: bestEnd }
}
