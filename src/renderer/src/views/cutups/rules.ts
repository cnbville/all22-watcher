import { defPersonnelLabel, enumLabel, personnelLabel } from '@shared/labels'
import { type FilterToken, RULE_OPS, ruleComplete } from '@shared/playQuery'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { ChartField, CutupRules, PlayRule, RuleField, RuleOp, RuleOptions } from '@shared/types'

/**
 * The smart cut-up rule fields (03 §9.3): sections, menu labels, operator labels, the kind of value control each
 * one uses, value labels, templates, and the one-line summary ("Down is 3rd · Pressure is Pressured"). Pure, so the
 * rules sheet, the cut-up screen and the tests share it.
 */

export type ValueKind =
  | 'seasons' // popup of downloaded seasons (two for "between")
  | 'team' // team popup
  | 'game' // popup of games
  | 'week' // stepper 1–22
  | 'segmented' // one of a few (single choice)
  | 'toggles' // several of a few (multi choice)
  | 'distance' // toggles for "is", stepper for at least / at most
  | 'stepper'
  | 'popup' // one of the values seen
  | 'personnel' // popup with Offense and Defense sections
  | 'epa' // number field(s)
  | 'text'
  | 'player'
  | 'tag'
  | 'chart'

export interface FieldDef {
  field: RuleField | 'chart'
  label: string
  section: 'Game' | 'Situation' | 'Lineup' | 'Result' | 'Your grading'
  kind: ValueKind
  /** Fixed choices for segmented and toggles: canonical value → label. */
  choices?: { value: string; label: string }[]
  /** Stepper range and default. */
  min?: number
  max?: number
  def?: number
  unit?: string
  /** Grade, Status and Tag take a "for" scope. */
  scoped?: boolean
}

export const FIELDS: FieldDef[] = [
  { field: 'season', label: 'Season', section: 'Game', kind: 'seasons' },
  { field: 'team', label: 'Team', section: 'Game', kind: 'team' },
  { field: 'opponent', label: 'Opponent', section: 'Game', kind: 'team' },
  { field: 'game', label: 'Game', section: 'Game', kind: 'game' },
  { field: 'week', label: 'Week', section: 'Game', kind: 'week', min: 1, max: 22, def: 1 },
  { field: 'side', label: 'Side', section: 'Situation', kind: 'segmented', choices: [{ value: 'offense', label: 'Offense' }, { value: 'defense', label: 'Defense' }] },
  { field: 'type', label: 'Type', section: 'Situation', kind: 'toggles', choices: [{ value: 'pass', label: 'Pass' }, { value: 'run', label: 'Run' }, { value: 'special', label: 'Special Teams' }] },
  { field: 'down', label: 'Down', section: 'Situation', kind: 'toggles', choices: ['1st', '2nd', '3rd', '4th'].map((label, i) => ({ value: String(i + 1), label })) },
  { field: 'distance', label: 'Distance', section: 'Situation', kind: 'distance', choices: [{ value: '1-3', label: '1–3' }, { value: '4-6', label: '4–6' }, { value: '7-10', label: '7–10' }, { value: '11+', label: '11+' }], min: 1, max: 99, def: 7, unit: 'yards' },
  { field: 'quarter', label: 'Quarter', section: 'Situation', kind: 'toggles', choices: [...['1', '2', '3', '4'].map((q) => ({ value: q, label: `Q${q}` })), { value: 'OT', label: 'OT' }] },
  { field: 'situation', label: 'Situation', section: 'Situation', kind: 'toggles', choices: [{ value: 'redZone', label: 'Red Zone' }, { value: 'goalToGo', label: 'Goal to Go' }, { value: 'twoMinute', label: 'Two-Minute' }] },
  { field: 'yardline', label: 'Field position', section: 'Situation', kind: 'stepper', min: 1, max: 50, def: 20, unit: 'yard line' },
  { field: 'formation', label: 'Formation', section: 'Lineup', kind: 'popup' },
  { field: 'personnel', label: 'Personnel', section: 'Lineup', kind: 'personnel' },
  { field: 'coverage', label: 'Coverage', section: 'Lineup', kind: 'popup' },
  { field: 'manZone', label: 'Man or zone', section: 'Lineup', kind: 'segmented', choices: [{ value: 'man', label: 'Man' }, { value: 'zone', label: 'Zone' }] },
  { field: 'pressure', label: 'Pressure', section: 'Lineup', kind: 'segmented', choices: [{ value: 'pressured', label: 'Pressured' }, { value: 'notPressured', label: 'Not Pressured' }] },
  { field: 'passRushers', label: 'Pass rushers', section: 'Lineup', kind: 'stepper', min: 0, max: 11, def: 5 },
  { field: 'box', label: 'Defenders in the box', section: 'Lineup', kind: 'stepper', min: 0, max: 11, def: 7 },
  { field: 'result', label: 'Result', section: 'Result', kind: 'toggles', choices: [{ value: 'td', label: 'TD' }, { value: 'turnover', label: 'Turnover' }, { value: 'sack', label: 'Sack' }, { value: 'penalty', label: 'Penalty' }, { value: 'explosive', label: 'Explosive' }] },
  { field: 'success', label: 'Success', section: 'Result', kind: 'segmented', choices: [{ value: 'successful', label: 'Successful' }, { value: 'unsuccessful', label: 'Unsuccessful' }] },
  { field: 'epa', label: 'EPA', section: 'Result', kind: 'epa', min: -10, max: 10, def: 0 },
  { field: 'yards', label: 'Yards gained', section: 'Result', kind: 'stepper', min: -99, max: 99, def: 10, unit: 'yards' },
  { field: 'text', label: 'Description', section: 'Result', kind: 'text' },
  { field: 'player', label: 'Player', section: 'Your grading', kind: 'player' },
  { field: 'grade', label: 'Grade', section: 'Your grading', kind: 'toggles', scoped: true, choices: [{ value: '+', label: '+' }, { value: '0', label: '0' }, { value: '-', label: '−' }] },
  { field: 'status', label: 'Status', section: 'Your grading', kind: 'toggles', scoped: true, choices: [{ value: 'ungraded', label: 'Ungraded' }, { value: 'graded', label: 'Graded' }, { value: 'critical', label: 'Critical' }] },
  { field: 'tag', label: 'Tag', section: 'Your grading', kind: 'tag', scoped: true },
  { field: 'marked', label: 'Marked', section: 'Your grading', kind: 'toggles', choices: [{ value: 'flagged', label: 'Flagged' }, { value: 'notes', label: 'Notes' }, { value: 'drawings', label: 'Drawings' }] },
  { field: 'note', label: 'Note', section: 'Your grading', kind: 'text' }
]

const BY_FIELD = new Map(FIELDS.map((f) => [f.field, f]))

/** The definition of a rule's field; chart fields share one. */
export function fieldDef(field: RuleField, chartFields: ChartField[] = []): FieldDef {
  if (field.startsWith('chart:')) {
    const id = Number(field.slice(6))
    const cf = chartFields.find((c) => c.id === id)
    return { field: 'chart', label: cf?.name ?? 'Chart field', section: 'Your grading', kind: 'chart', choices: (cf?.options ?? []).map((o) => ({ value: o, label: o })) }
  }
  return BY_FIELD.get(field) ?? FIELDS[0]
}

export const OP_LABEL: Record<RuleOp, string> = {
  is: 'is',
  isNot: 'is not',
  gte: 'is at least',
  lte: 'is at most',
  between: 'is between',
  includes: 'includes',
  excludes: 'does not include',
  contains: 'contains',
  onField: 'was on the field',
  credited: 'is credited',
  graded: 'was graded',
  offense: 'is on offense',
  defense: 'is on defense',
  studied: 'is studied',
  insideOpp: 'is inside the opponent’s',
  insideOwn: 'is inside own'
}

export function opsFor(field: RuleField): RuleOp[] {
  return RULE_OPS[field.startsWith('chart:') ? 'chart' : field] ?? ['is']
}

/** The control a rule's value slot shows for its field and operator. */
export function valueKind(rule: Pick<PlayRule, 'field' | 'op'>, chartFields: ChartField[] = []): ValueKind {
  const def = fieldDef(rule.field, chartFields)
  if (def.kind === 'distance') return rule.op === 'is' ? 'toggles' : 'stepper'
  return def.kind
}

/** A rule's starting value for a field and operator: steppers start at their default, everything else empty. */
export function emptyValue(field: RuleField, op: RuleOp, chartFields: ChartField[] = []): PlayRule['value'] {
  const def = fieldDef(field, chartFields)
  const kind = valueKind({ field, op }, chartFields)
  if (kind === 'week' || kind === 'stepper') return op === 'between' ? [def.def ?? 1, (def.def ?? 1) + 3] : (def.def ?? 0)
  if (kind === 'epa') return op === 'between' ? [-0.5, 0.5] : 0
  if (kind === 'seasons' && op === 'between') return []
  if (kind === 'text') return ''
  return []
}

/** A new rule for `field` with its first operator. */
export function newRule(field: RuleField, chartFields: ChartField[] = []): PlayRule {
  const op = opsFor(field)[0]
  return { field, op, value: emptyValue(field, op, chartFields) }
}

/** Changing the operator keeps the value when the control stays the same. */
export function withOp(rule: PlayRule, op: RuleOp, chartFields: ChartField[] = []): PlayRule {
  const before = valueKind(rule, chartFields)
  const after = valueKind({ field: rule.field, op }, chartFields)
  const shapeChanges = (rule.op === 'between') !== (op === 'between')
  return { ...rule, op, value: before === after && !shapeChanges ? rule.value : emptyValue(rule.field, op, chartFields) }
}

export const WEEK_NAMES: Record<number, string> = { 19: 'Wild Card', 20: 'Divisional', 21: 'Conference', 22: 'Super Bowl' }
export const weekValueLabel = (w: number) => WEEK_NAMES[w] ?? String(w)

export interface LabelContext {
  chartFields?: ChartField[]
  options?: RuleOptions | null
  /** Player names by id (the "for" scope and Player rules). */
  players?: Record<string, string>
}

const list = (v: PlayRule['value']): string[] => (Array.isArray(v) ? v.map(String) : v === '' ? [] : [String(v)])

/** A value as the summary line writes it. */
export function valueLabel(rule: PlayRule, ctx: LabelContext = {}): string {
  const def = fieldDef(rule.field, ctx.chartFields)
  const kind = valueKind(rule, ctx.chartFields)
  const v = rule.value
  const choice = (x: string) => def.choices?.find((c) => c.value === x)?.label ?? x
  if (rule.op === 'between' && Array.isArray(v) && v.length === 2) {
    const f = (x: string | number) => (rule.field === 'week' ? weekValueLabel(Number(x)) : rule.field === 'epa' ? formatNum(Number(x)) : String(x))
    return `${f(v[0])}–${f(v[1])}`
  }
  switch (kind) {
    case 'team':
      return list(v).map((t) => TEAM_BY_ABBR[t]?.nickname ?? t).join(', ')
    case 'game':
      return list(v).map((g) => ctx.options?.games.find((x) => x.gameId === g)?.label ?? g).join(', ')
    case 'week':
      return weekValueLabel(Number(Array.isArray(v) ? v[0] : v))
    case 'stepper':
      return `${Array.isArray(v) ? v[0] : v}${def.unit ? ` ${def.unit}` : ''}`
    case 'epa':
      return formatNum(Number(Array.isArray(v) ? v[0] : v))
    case 'text':
      return `“${String(v)}”`
    case 'player':
      return list(v).map((id) => ctx.players?.[id] ?? 'a player').join(', ')
    case 'personnel':
      return list(v).map((p) => (/DL|LB|DB/.test(p) ? defPersonnelLabel(p) : personnelLabel(p))).join(' or ')
    case 'popup':
      return list(v).map(enumLabel).join(' or ')
    default:
      return list(v).map(choice).join(rule.op === 'isNot' ? ' or ' : ', ')
  }
}

const formatNum = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n < 0 ? `−${Math.abs(n).toFixed(1)}` : '0.0')

/** "Down is 3rd", "Grade is − for Cooper DeJean". */
export function ruleSentence(rule: PlayRule, ctx: LabelContext = {}): string {
  const def = fieldDef(rule.field, ctx.chartFields)
  const value = valueLabel(rule, ctx)
  const scope = rule.player ? ` for ${ctx.players?.[rule.player] ?? 'a player'}` : ''
  if (rule.field === 'yardline') return `${def.label} ${OP_LABEL[rule.op]} ${value}`
  if (rule.field === 'player') return `${value} ${OP_LABEL[rule.op]}`
  return `${def.label} ${OP_LABEL[rule.op]} ${value}${scope}`
}

/** The rules in one line: "Down is 3rd · Pressure is Pressured" (or " or " between them for "any"). */
export function rulesSummary(rules: CutupRules, ctx: LabelContext = {}): string {
  return rules.rules.map((r) => ruleSentence(r, ctx)).join(rules.match === 'any' ? ' or ' : ' · ')
}

/** Which rules a play matched, for "Matches: Down, Pressure" in "any" cut-ups. */
export function ruleFieldNames(rules: PlayRule[], ctx: LabelContext = {}): string {
  return [...new Set(rules.map((r) => fieldDef(r.field, ctx.chartFields).label))].join(', ')
}

export function allComplete(rules: PlayRule[]): boolean {
  return rules.length > 0 && rules.every(ruleComplete)
}

// Templates (03 §9.4)

export interface Template {
  id: string
  label: string
  name: string
  rules: PlayRule[]
  needsPlayer?: boolean
}

export const TEMPLATES: Template[] = [
  { id: 'pressures', label: '3rd-Down Pressures', name: '3rd-down pressures', rules: [{ field: 'down', op: 'is', value: ['3'] }, { field: 'pressure', op: 'is', value: ['pressured'] }] },
  { id: 'thirdLong', label: 'Third and Long', name: 'Third and long', rules: [{ field: 'down', op: 'is', value: ['3'] }, { field: 'distance', op: 'is', value: ['7-10', '11+'] }] },
  { id: 'redZone', label: 'Red Zone Plays', name: 'Red zone plays', rules: [{ field: 'situation', op: 'is', value: ['redZone'] }] },
  { id: 'explosive', label: 'Explosive Plays Allowed', name: 'Explosive plays allowed', rules: [{ field: 'side', op: 'is', value: ['defense'] }, { field: 'result', op: 'is', value: ['explosive'] }] },
  { id: 'critical', label: 'Critical Plays', name: 'Critical plays', rules: [{ field: 'status', op: 'is', value: ['critical'] }] },
  { id: 'flagged', label: 'Flagged Plays', name: 'Flagged plays', rules: [{ field: 'marked', op: 'is', value: ['flagged'] }] },
  { id: 'minus', label: 'Minus Plays for a Player…', name: 'Minus plays: {name}', rules: [{ field: 'grade', op: 'is', value: ['-'] }], needsPlayer: true }
]

export function templateRules(t: Template, player?: { id: string; name: string }): { name: string; rules: PlayRule[] } {
  if (!t.needsPlayer || !player) return { name: t.name, rules: t.rules.map((r) => ({ ...r })) }
  return { name: t.name.replace('{name}', player.name), rules: t.rules.map((r) => ({ ...r, player: player.id })) }
}

/** Whether the name field still holds a template's name (so choosing another template may replace it). */
export function isTemplateName(name: string): boolean {
  const n = name.trim()
  return !n || TEMPLATES.some((t) => t.name === n || (t.needsPlayer && n.startsWith('Minus plays: ')))
}

// Tokens → a name

const TOKEN_LABEL: Record<string, (v: string) => string> = {
  down: (v) => ['', '1st', '2nd', '3rd', '4th'][Number(v)] ?? v,
  pressure: (v) => (v === 'pressured' ? 'Pressured' : 'Not pressured'),
  grade: (v) => (v === '-' ? '−' : v),
  quarter: (v) => (v === 'OT' ? 'OT' : `Q${v}`)
}

/** "3rd · Pressured · PHI": the tokens' values joined, the studied team last (03 §9.4). */
export function nameFromTokens(tokens: FilterToken[], team?: string, text?: string): string {
  const parts = tokens.flatMap((t) => {
    const def = FIELDS.find((f) => f.field === t.key)
    return t.values.map((v) => TOKEN_LABEL[t.key]?.(v) ?? def?.choices?.find((c) => c.value === v)?.label ?? enumLabel(v))
  })
  if (text?.trim()) parts.push(`“${text.trim()}”`)
  if (team) parts.push(team)
  return parts.join(' · ').slice(0, 80)
}

/** The perspective team a "Team is studied" rule names, which becomes the cut-up's focus team (03 §9.3). */
export function studiedTeam(rules: PlayRule[]): string | undefined {
  const r = rules.find((x) => x.field === 'team' && x.op === 'studied')
  const v = r && (Array.isArray(r.value) ? r.value[0] : r.value)
  return v ? String(v) : undefined
}
