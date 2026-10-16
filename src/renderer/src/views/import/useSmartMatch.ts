import { useEffect, useMemo, useState } from 'react'
import { shiftMatches } from '@shared/matching'
import { guessScope, type MatchScope, scopePlays, type SmartPlacement, smartMatch } from '@shared/smartMatch'
import type { MatchPreview, Play } from '@shared/types'
import { ANGLES, type SheetRow } from './importModel'

/**
 * Smart matching in the import sheet (shared/smartMatch.ts): which plays the clips were cut from, the user's own
 * matches (anchors), and every other clip placed around them once clip lengths are read.
 *
 * A new import starts smart. Fix Clip Matches starts with the saved matches as they are and turns smart on with
 * Match Again. While smart, picking a play for a clip (the play menu, sliding, the review) pins that clip there and
 * the rest move around it; otherwise those edit the one row, as before.
 */
export function useSmartMatch({
  preview,
  team,
  rows,
  setRows,
  durations,
  reading,
  fix
}: {
  preview: MatchPreview | null
  team: string | null
  rows: SheetRow[]
  setRows: (update: (rows: SheetRow[]) => SheetRow[]) => void
  durations: Record<string, number | null>
  reading: boolean
  fix: boolean
}) {
  const [smart, setSmart] = useState(!fix)
  const [anchors, setAnchors] = useState<Map<string, number | null>>(new Map())
  const [chosenScope, setChosenScope] = useState<MatchScope | null>(null)

  const plays = useMemo(() => [...(preview?.plays ?? [])].sort((a, b) => a.playId - b.playId), [preview])
  const largestAngle = Math.max(0, ...ANGLES.map((a) => rows.filter((r) => r.angle === a).length))
  const anchoredIds = [...anchors.values()].filter((id): id is number => id !== null)
  const anchoredKey = anchoredIds.join()
  const scope = useMemo(
    () => chosenScope ?? guessScope(plays, team, largestAngle, anchoredIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosenScope, plays, team, largestAngle, anchoredKey]
  )
  const ordered = useMemo(() => scopePlays(plays, scope, team), [plays, scope, team])

  // Clips in cut order: each angle's clips as the rows list them.
  const clipKey = rows.map((r) => `${r.angle}\t${r.path}`).join('\n')
  const lengthKey = rows.map((r) => durations[r.path] ?? '').join()
  const placements = useMemo<Map<string, SmartPlacement> | null>(() => {
    if (!smart || !preview || reading || !rows.length || !plays.length) return null
    return smartMatch(
      rows.map((r) => ({ path: r.path, angle: r.angle, duration: durations[r.path] ?? null })),
      ordered,
      plays,
      anchors
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart, preview, reading, clipKey, lengthKey, ordered, plays, anchors])

  useEffect(() => {
    if (!placements) return
    setRows((rs) => {
      const next = rs.map((r) => {
        const p = placements.get(r.path)
        return p && p.playId !== r.playId ? { ...r, playId: p.playId } : r
      })
      return next.some((r, i) => r !== rs[i]) ? next : rs
    })
  }, [placements, setRows])

  const needsLook = useMemo(() => new Set([...(placements ?? [])].filter(([, p]) => !p.sure && !p.anchored).map(([path]) => path)), [placements])

  const pin = (path: string, playId: number | null) => setAnchors((a) => new Map(a).set(path, playId))

  /** The user's pick of a play for one clip. */
  const link = (index: number, playId: number | null) => {
    const row = rows[index]
    if (!row) return
    if (smart) pin(row.path, playId)
    else setRows((rs) => rs.map((r, i) => (i === index ? { ...r, playId } : r)))
  }

  /** ⇧↑/⇧↓: one play earlier or later, and (while smart) the clips after it follow by themselves. */
  const shift = (index: number, delta: 1 | -1) => {
    const row = rows[index]
    if (!row) return
    if (!smart) {
      setRows((rs) => shiftMatches(rs, index, delta, ordered))
      return
    }
    const ids = ordered.map((p) => p.playId)
    const at = row.playId === null ? -1 : ids.indexOf(row.playId)
    const next = at === -1 ? (delta > 0 ? 0 : -1) : at + delta
    pin(row.path, next >= 0 && next < ids.length ? ids[next] : null)
  }

  /** Match Again: forget the user's picks and place every clip afresh. */
  const matchAgain = () => {
    setAnchors(new Map())
    setChosenScope(null)
    setSmart(true)
  }

  return {
    smart,
    scope,
    setScope: (s: MatchScope) => setChosenScope(s),
    /** Plays clips are matched against, in game order. */
    ordered,
    /** Every play of the game, in game order. */
    plays,
    placements,
    anchors,
    needsLook,
    pin,
    link,
    shift,
    matchAgain
  }
}

export type SmartMatch = ReturnType<typeof useSmartMatch>

/** The plays a clip can be on: after the play of the clip before it and before the next pinned clip's play. */
export function candidatePlays(rows: SheetRow[], index: number, from: Play[], anchors: Map<string, number | null>): Play[] {
  const row = rows[index]
  const same = rows.map((r, i) => ({ r, i })).filter((x) => x.r.angle === row.angle)
  const k = same.findIndex((x) => x.i === index)
  const before = same.slice(0, k).reverse().find((x) => x.r.playId !== null)?.r.playId ?? -Infinity
  const after = same.slice(k + 1).find((x) => anchors.has(x.r.path) && anchors.get(x.r.path) !== null)
  const limit = after ? (anchors.get(after.r.path) as number) : Infinity
  return from.filter((p) => p.playId > before && p.playId < limit)
}
