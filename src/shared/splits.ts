import { defPersonnelLabel, enumLabel, personnelLabel } from './labels'
import { DISTANCE_BUCKETS, distanceBucket, manZoneKey, playKind, quarterKey, situations } from './playQuery'
import { addToTally, emptyTally, gradeScore, teamEpa, teamSuccess } from './stats'
import type { ChartField, Grade, GradeTally, Play, PlayRule } from './types'

/** Grades from fewer graded plays than this are shown grey (03 §2.4). */
export const SMALL_SAMPLE = 5

/** One graded play of a player, with what the splits need. */
export interface SplitPlay {
  play: Play
  /** The player's team in that game. */
  team: string
  grade: Grade | null
  critical: boolean
  /** The play's charting (PlayNote.chart). */
  chart: Record<string, string>
}

export interface SplitRow {
  key: string
  label: string
  tally: GradeTally
  grade: number | null
  /** 1–4 graded plays: grey, no heat color. */
  small: boolean
  epa: number | null
  success: number | null
  /** The rule that selects these plays ("Watch These Plays", "Save as Smart Cut-up"); null for "Other". */
  rule: PlayRule | null
  /** Raw groupings behind a label, with counts (defensive personnel tooltip). */
  detail?: { raw: string; count: number }[]
}

export interface SplitGroup {
  key: string
  label: string
  /** "your charting" for chart field groups. */
  suffix?: string
  /** Participation-based groups in a season without participation: one row "Not published for {season} yet". */
  notPublished?: boolean
  rows: SplitRow[]
}

export interface SplitOptions {
  /** Restricts every split to runs or passes; the Play type group hides when not 'all'. */
  type: 'all' | 'run' | 'pass'
  hasParticipation: boolean
  chartFields: ChartField[]
}

function row(key: string, label: string, plays: SplitPlay[], rule: PlayRule | null): SplitRow {
  const tally = emptyTally()
  let epaSum = 0
  let epaN = 0
  let succ = 0
  let succN = 0
  for (const p of plays) {
    addToTally(tally, p.grade, p.critical)
    if (p.grade === null) continue
    const e = teamEpa(p.play, p.team)
    if (e !== null) {
      epaSum += e
      epaN++
    }
    const s = teamSuccess(p.play, p.team)
    if (s !== null) {
      succ += s ? 1 : 0
      succN++
    }
  }
  return {
    key,
    label,
    tally,
    grade: gradeScore(tally),
    small: tally.graded > 0 && tally.graded < SMALL_SAMPLE,
    epa: epaN ? epaSum / epaN : null,
    success: succN ? succ / succN : null,
    rule
  }
}

/** Seen values, most plays first; more than 6 → the top 5 + "Other". */
function seenRows(field: PlayRule['field'], plays: SplitPlay[], valueOf: (p: SplitPlay) => string | null, label: (v: string) => string): SplitRow[] {
  const by = new Map<string, SplitPlay[]>()
  for (const p of plays) {
    const v = valueOf(p)
    if (v === null || v === '') continue
    by.set(v, [...(by.get(v) ?? []), p])
  }
  const sorted = [...by].sort((a, b) => b[1].length - a[1].length || label(a[0]).localeCompare(label(b[0])))
  const rows = (list: [string, SplitPlay[]][]) => list.map(([v, ps]) => row(v, label(v), ps, { field, op: 'is', value: [v] }))
  if (sorted.length <= 6) return rows(sorted)
  return [...rows(sorted.slice(0, 5)), row('other', 'Other', sorted.slice(5).flatMap(([, ps]) => ps), null)]
}

/** Seen values merged under one label (defensive personnel: "Nickel" covers several raw groupings). */
function labelledRows(field: PlayRule['field'], plays: SplitPlay[], valueOf: (p: SplitPlay) => string | null, label: (v: string) => string): SplitRow[] {
  const by = new Map<string, { raws: Map<string, number>; plays: SplitPlay[] }>()
  for (const p of plays) {
    const v = valueOf(p)
    if (!v) continue
    const l = label(v)
    const g = by.get(l) ?? by.set(l, { raws: new Map(), plays: [] }).get(l)!
    g.raws.set(v, (g.raws.get(v) ?? 0) + 1)
    g.plays.push(p)
  }
  const sorted = [...by].sort((a, b) => b[1].plays.length - a[1].plays.length)
  const rows = (list: typeof sorted) =>
    list.map(([l, g]) => ({
      ...row(l, l, g.plays, { field, op: 'is', value: [...g.raws.keys()] }),
      detail: [...g.raws].map(([raw, count]) => ({ raw, count })).sort((a, b) => b.count - a.count)
    }))
  if (sorted.length <= 6) return rows(sorted)
  return [...rows(sorted.slice(0, 5)), row('other', 'Other', sorted.slice(5).flatMap(([, g]) => g.plays), null)]
}

/** Player › Splits › Situations (03 §6.4.1). Only graded plays count. */
export function computeSplits(all: SplitPlay[], opts: SplitOptions): SplitGroup[] {
  const graded = all.filter((p) => p.grade !== null)
  const plays = opts.type === 'all' ? graded : graded.filter((p) => playKind(p.play) === opts.type)
  const scrimmage = plays.filter((p) => !p.play.special)
  const groups: SplitGroup[] = []
  if (opts.type === 'all') {
    const rows = [
      row('run', 'Run', plays.filter((p) => playKind(p.play) === 'run'), { field: 'type', op: 'is', value: ['run'] }),
      row('pass', 'Pass', plays.filter((p) => playKind(p.play) === 'pass'), { field: 'type', op: 'is', value: ['pass'] })
    ]
    const st = plays.filter((p) => p.play.special)
    if (st.length) rows.push(row('special', 'Special teams', st, { field: 'type', op: 'is', value: ['special'] }))
    groups.push({ key: 'type', label: 'Play type', rows })
  }

  groups.push({
    key: 'down',
    label: 'Down',
    rows: ['1st', '2nd', '3rd', '4th'].map((l, i) =>
      row(String(i + 1), l, plays.filter((p) => p.play.down === i + 1), { field: 'down', op: 'is', value: [String(i + 1)] })
    )
  })

  groups.push({
    key: 'distance',
    label: 'Distance',
    rows: DISTANCE_BUCKETS.map((b) =>
      row(
        b.key,
        `${b.key.replace('-', '–')} to go`,
        plays.filter((p) => p.play.down !== null && distanceBucket(p.play.ydstogo) === b.key),
        { field: 'distance', op: 'is', value: [b.key] }
      )
    )
  })

  const quarters = ['1', '2', '3', '4']
  if (plays.some((p) => p.play.qtr >= 5)) quarters.push('OT')
  groups.push({
    key: 'quarter',
    label: 'Quarter',
    rows: quarters.map((q) => row(q, q === 'OT' ? 'OT' : `Q${q}`, plays.filter((p) => quarterKey(p.play.qtr) === q), { field: 'quarter', op: 'is', value: [q] }))
  })

  groups.push({
    key: 'situation',
    label: 'Situation',
    rows: (
      [
        ['redZone', 'Red zone'],
        ['goalToGo', 'Goal to go'],
        ['twoMinute', 'Two-minute']
      ] as const
    )
      .map(([k, l]) => row(k, l, plays.filter((p) => situations(p.play).includes(k)), { field: 'situation', op: 'is', value: [k] }))
      .filter((r) => r.tally.graded > 0)
  })

  const lineup = (key: string, label: string, rows: () => SplitRow[]) =>
    groups.push(opts.hasParticipation ? { key, label, rows: rows() } : { key, label, notPublished: true, rows: [] })

  lineup('pressure', 'Pressure', () =>
    seenRows(
      'pressure',
      scrimmage.filter((p) => p.play.isPass),
      (p) => (p.play.wasPressure === null ? null : p.play.wasPressure ? 'pressured' : 'notPressured'),
      (v) => (v === 'pressured' ? 'Pressured' : 'Clean pocket')
    )
  )
  lineup('coverage', 'Coverage', () => seenRows('coverage', scrimmage, (p) => p.play.coverage, enumLabel))
  lineup('manZone', 'Man or zone', () => seenRows('manZone', scrimmage, (p) => manZoneKey(p.play.manZone), (v) => (v === 'man' ? 'Man' : 'Zone')))
  lineup('formation', 'Formation', () => seenRows('formation', scrimmage, (p) => p.play.formation, enumLabel))
  lineup('offPersonnel', 'Offensive personnel', () => labelledRows('personnel', scrimmage, (p) => p.play.offPersonnel, personnelLabel))
  lineup('defPersonnel', 'Defensive personnel', () => labelledRows('personnel', scrimmage, (p) => p.play.defPersonnel, defPersonnelLabel))

  for (const f of opts.chartFields) {
    groups.push({
      key: `chart:${f.id}`,
      label: f.name,
      suffix: 'your charting',
      rows: f.options.map((o) => row(o, o, plays.filter((p) => p.chart[f.name] === o), { field: `chart:${f.id}`, op: 'is', value: [o] }))
    })
  }
  return groups
}
