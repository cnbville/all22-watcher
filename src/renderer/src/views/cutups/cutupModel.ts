import { downDistance, gameLabel, shortDesc } from '@shared/labels'
import { matchRule } from '@shared/playQuery'
import { clipStartTime } from '@shared/snap'
import type { CutupDetail, CutupItem, CutupSummary, Grade, PlayRef, Settings } from '@shared/types'

/**
 * Pure pieces of the cut-up screen (03 §9.6) and the Cut-ups screen (03 §10.1): rows from items, cells, filtering,
 * column sorts and the tile and sort helpers. No React here so the tests can run them.
 */

export const keyOf = (r: PlayRef) => `${r.gameId}:${r.playId}`

/** Whose grades the cut-up shows. */
export interface Focus {
  playerId: string | null
}

/** The focus player's entry on a play, if graded. */
export function focusEntry(item: CutupItem, playerId: string | null) {
  return playerId ? (item.entries.find((e) => e.playerId === playerId) ?? null) : null
}

/** "+5 −2" counts of the perspective team's grades on a play. */
export function teamCounts(item: CutupItem): { plus: number; minus: number; zero: number } {
  let plus = 0
  let minus = 0
  let zero = 0
  for (const e of item.entries) {
    if (e.grade === 1) plus++
    else if (e.grade === -1) minus++
    else if (e.grade === 0) zero++
  }
  return { plus, minus, zero }
}

/** "3rd & 7 · DAL 36"; special teams by kind. */
export function situationLabel(item: CutupItem): string {
  const p = item.play
  if (!p) return ''
  const t = p.playType
  if (t === 'punt') return 'Punt'
  if (t === 'kickoff') return 'Kickoff'
  if (t === 'field_goal') return 'Field goal'
  if (t === 'extra_point') return 'Extra point'
  const dd = downDistance(p)
  return [dd, p.yrdln && p.yrdln !== '50' ? p.yrdln : p.yrdln ? '50' : ''].filter(Boolean).join(' · ')
}

/** "Wk 1 vs DAL", with the season first when the cut-up spans seasons. */
export function gameCell(item: CutupItem, multiSeason: boolean): string {
  const label = gameLabel(item.game, item.team)
  return multiSeason ? `${item.game.season} ${label}` : label
}

export function clockCell(item: CutupItem): string {
  if (!item.play) return ''
  return `${item.play.qtr >= 5 ? 'OT' : `Q${item.play.qtr}`} ${item.play.time}`
}

/** Seconds from the start point to the clip's end (first sideline/main/end zone clip), or null without film. */
export function itemLength(item: CutupItem, s: Pick<Settings, 'startAtSnap' | 'preRoll'>): number | null {
  const clip = (['sideline', 'main', 'endzone'] as const).map((a) => item.clips.find((c) => c.angle === a)).find(Boolean) ?? item.clips[0]
  if (!clip || clip.duration === null || clip.duration === undefined) return clip ? 0 : null
  return Math.max(0, clip.duration - clipStartTime(clip, s))
}

/** The perspective team's tags on the play, most used first. */
export function tagsOf(item: CutupItem): string[] {
  const count = new Map<string, number>()
  for (const e of item.entries) for (const t of e.tags) count.set(t, (count.get(t) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}

export const hasNote = (item: CutupItem) => !!item.playNote || item.entries.some((e) => !!e.note)

/** Free-text filter over the caption, description, tags and notes. */
export function filterItems(items: CutupItem[], text: string, multiSeason: boolean): CutupItem[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items
  return items.filter((i) => {
    const hay = [gameCell(i, multiSeason), clockCell(i), situationLabel(i), i.play ? shortDesc(i.play.desc) : '', tagsOf(i).join(' '), i.playNote, ...i.entries.map((e) => `${e.name} ${e.note}`)].join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export type CutupSortColumn = 'game' | 'clock' | 'situation' | 'play' | 'grades' | 'epa' | 'tags' | 'markers' | 'length'

const gradeRank = (g: Grade | null | undefined) => (g === 1 ? 3 : g === 0 ? 2 : g === -1 ? 1 : 0)

/** Column sort for the view only; ties keep the cut-up's order. */
export function sortItems(items: CutupItem[], column: CutupSortColumn | null, dir: 'asc' | 'desc', ctx: { playerId: string | null; multiSeason: boolean; settings: Pick<Settings, 'startAtSnap' | 'preRoll'> }): CutupItem[] {
  if (!column) return items
  const value = (i: CutupItem): number | string => {
    switch (column) {
      case 'game':
        return `${i.game.season}-${String(i.game.week).padStart(2, '0')}-${i.game.gameday}`
      case 'clock':
        return i.play ? i.play.qtr * 10000 + (900 - clockSeconds(i.play.time)) : 0
      case 'situation':
        return situationLabel(i)
      case 'play':
        return i.play ? shortDesc(i.play.desc) : ''
      case 'grades': {
        if (ctx.playerId) return gradeRank(focusEntry(i, ctx.playerId)?.grade)
        const c = teamCounts(i)
        return c.plus - c.minus
      }
      case 'epa':
        return i.teamEpa ?? -999
      case 'tags':
        return tagsOf(i).join(' · ')
      case 'markers':
        return (i.flagged ? 2 : 0) + (hasNote(i) ? 1 : 0)
      case 'length':
        return itemLength(i, ctx.settings) ?? -1
    }
  }
  const indexed = items.map((item, i) => ({ item, i, v: value(item) }))
  indexed.sort((a, b) => {
    const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))
    return (dir === 'asc' ? c : -c) || a.i - b.i
  })
  return indexed.map((x) => x.item)
}

function clockSeconds(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

/** Moves `moving` keys to sit before `target` (or after it), keeping their relative order. */
export function reorderKeys(order: string[], moving: string[], target: string, after: boolean): string[] {
  const set = new Set(moving)
  const rest = order.filter((k) => !set.has(k))
  const block = order.filter((k) => set.has(k))
  if (set.has(target)) return order
  const at = rest.indexOf(target)
  if (at < 0) return order
  rest.splice(after ? at + 1 : at, 0, ...block)
  return rest
}

/** For "any" cut-ups: the rules this play meets ("Matches: Down, Pressure"). */
export function matchedRuleLabels(detail: CutupDetail, item: CutupItem, label: (field: string) => string): string[] | null {
  const rules = detail.cutup.rules
  if (!rules || !item.play) return null
  const ctx = {
    game: item.game,
    team: item.team,
    entries: item.entries.map((e) => ({ gameId: item.ref.gameId, playId: item.ref.playId, playerId: e.playerId, team: item.team, grade: e.grade, tags: e.tags, note: e.note, critical: e.critical, offField: false })),
    note: { gameId: item.ref.gameId, playId: item.ref.playId, note: item.playNote, chart: item.chart, drawing: item.drawing ?? {}, flagged: item.flagged }
  }
  try {
    return rules.rules.filter((r) => matchRule(r, item.play!, ctx)).map((r) => label(r.field))
  } catch {
    return null
  }
}

// ── The Cut-ups screen ───────────────────────────────────────────────────

export type CutupsSort = 'manual' | 'name' | 'updated' | 'plays'

export function sortCutups(list: CutupSummary[], sort: CutupsSort): CutupSummary[] {
  const out = [...list]
  switch (sort) {
    case 'name':
      return out.sort((a, b) => a.cutup.name.localeCompare(b.cutup.name))
    case 'updated':
      return out.sort((a, b) => b.cutup.updatedAt.localeCompare(a.cutup.updatedAt))
    case 'plays':
      return out.sort((a, b) => b.playCount - a.playCount || a.cutup.name.localeCompare(b.cutup.name))
    default:
      return out.sort((a, b) => a.cutup.sort - b.cutup.sort)
  }
}

/** "Updated today", "Updated yesterday", "Updated Oct 12". */
export function updatedLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400000)
  if (diff <= 0) return 'Updated today'
  if (diff === 1) return 'Updated yesterday'
  return `Updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })}`
}
