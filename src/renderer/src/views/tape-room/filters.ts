import { type FilterToken, matchRule, type PlayContext, textContains, tokensToRules } from '@shared/playQuery'
import type { Play } from '@shared/types'
import { prettyEnum } from '../../format'
import type { SearchToken } from '../../ui/SearchField'

/**
 * The play list's filters (02 §4.3): tokens of one key with one or more values (OR within a key, AND across keys and
 * with the free text), their labels, matching, and the suggestions shown while typing. Canonical values are
 * `shared/playQuery.ts`'s, so smart cut-ups and the reel read the same tokens.
 */

export type TapeKey = 'side' | 'type' | 'down' | 'distance' | 'quarter' | 'situation' | 'status' | 'marked' | 'result' | 'formation' | 'personnel' | 'coverage'

export const TAPE_KEYS: TapeKey[] = ['side', 'type', 'down', 'distance', 'quarter', 'situation', 'status', 'marked', 'result', 'formation', 'personnel', 'coverage']

export const KEY_LABEL: Record<TapeKey, string> = {
  side: 'Side',
  type: 'Type',
  down: 'Down',
  distance: 'Distance',
  quarter: 'Quarter',
  situation: 'Situation',
  status: 'Status',
  marked: 'Marked',
  result: 'Result',
  formation: 'Formation',
  personnel: 'Personnel',
  coverage: 'Coverage'
}

/** Keys that hold one value (radio menus and popups). */
export const SINGLE_KEYS = new Set<TapeKey>(['side', 'formation', 'personnel', 'coverage'])
/** Keys that need lineup data (popups shown only when the game has it). */
export const LINEUP_KEYS = new Set<TapeKey>(['formation', 'personnel', 'coverage'])

export interface ValueOption {
  value: string
  label: string
  /** Shorter segment text in the popover ("TD"). */
  short?: string
}

export interface LineupOptions {
  formation: string[]
  personnel: string[]
  coverage: string[]
}

export const NO_LINEUP_OPTIONS: LineupOptions = { formation: [], personnel: [], coverage: [] }

/** The values a key offers, in display order. */
export function valueOptions(key: TapeKey, team: string, lineup: LineupOptions = NO_LINEUP_OPTIONS): ValueOption[] {
  switch (key) {
    case 'side':
      return [
        { value: 'offense', label: `${team} Offense` },
        { value: 'defense', label: `${team} Defense` }
      ]
    case 'type':
      return [
        { value: 'pass', label: 'Pass' },
        { value: 'run', label: 'Run' },
        { value: 'special', label: 'Special Teams' }
      ]
    case 'down':
      return ['1st', '2nd', '3rd', '4th'].map((label, i) => ({ value: String(i + 1), label }))
    case 'distance':
      return [
        { value: '1-3', label: '1–3' },
        { value: '4-6', label: '4–6' },
        { value: '7-10', label: '7–10' },
        { value: '11+', label: '11+' }
      ]
    case 'quarter':
      return [
        { value: '1', label: 'Q1' },
        { value: '2', label: 'Q2' },
        { value: '3', label: 'Q3' },
        { value: '4', label: 'Q4' },
        { value: 'OT', label: 'OT' }
      ]
    case 'situation':
      return [
        { value: 'redZone', label: 'Red Zone' },
        { value: 'goalToGo', label: 'Goal to Go' },
        { value: 'twoMinute', label: 'Two-Minute' }
      ]
    case 'status':
      return [
        { value: 'ungraded', label: 'Ungraded' },
        { value: 'graded', label: 'Graded' },
        { value: 'critical', label: 'Critical' }
      ]
    case 'marked':
      return [
        { value: 'flagged', label: 'Flagged' },
        { value: 'notes', label: 'Notes' },
        { value: 'drawings', label: 'Drawings' }
      ]
    case 'result':
      return [
        { value: 'td', label: 'Touchdown', short: 'TD' },
        { value: 'turnover', label: 'Turnover' },
        { value: 'sack', label: 'Sack' },
        { value: 'penalty', label: 'Penalty' }
      ]
    case 'formation':
      return lineup.formation.map((v) => ({ value: v, label: prettyEnum(v) }))
    case 'personnel':
      return lineup.personnel.map((v) => ({ value: v, label: v }))
    case 'coverage':
      return lineup.coverage.map((v) => ({ value: v, label: prettyEnum(v) }))
  }
}

export function valueLabel(key: TapeKey, value: string, team: string): string {
  if (key === 'formation' || key === 'coverage') return prettyEnum(value)
  if (key === 'personnel') return value
  return valueOptions(key, team).find((o) => o.value === value)?.label ?? value
}

/** The distinct formation, personnel (the studied team's) and coverage values of a game's plays. */
export function lineupOptions(plays: readonly Play[], team: string): LineupOptions {
  const uniq = (f: (p: Play) => string | null) => [...new Set(plays.map(f).filter((v): v is string => !!v))].sort()
  return {
    formation: uniq((p) => p.formation),
    personnel: uniq((p) => (p.posteam === team ? p.offPersonnel : p.defPersonnel)),
    coverage: uniq((p) => p.coverage)
  }
}

// Tokens

const isTapeKey = (k: string): k is TapeKey => (TAPE_KEYS as string[]).includes(k)

/** Sets a key's values (removing the token when empty), keeping the tokens' order. */
export function setTokenValues(tokens: readonly FilterToken[], key: TapeKey, values: string[]): FilterToken[] {
  const i = tokens.findIndex((t) => t.key === key)
  if (!values.length) return tokens.filter((t) => t.key !== key)
  if (i < 0) return [...tokens, { key, values }]
  return tokens.map((t, j) => (j === i ? { key, values } : t))
}

export function tokenValues(tokens: readonly FilterToken[], key: TapeKey): string[] {
  return tokens.find((t) => t.key === key)?.values ?? []
}

/** Adds one value to a key (replacing it for single-value keys). */
export function addTokenValue(tokens: readonly FilterToken[], key: TapeKey, value: string): FilterToken[] {
  const have = tokenValues(tokens, key)
  if (have.includes(value)) return [...tokens]
  return setTokenValues(tokens, key, SINGLE_KEYS.has(key) ? [value] : [...have, value])
}

/** "Down: 3rd, 4th" as the search field's token. */
export function toSearchToken(t: FilterToken, team: string): SearchToken {
  const key = t.key as TapeKey
  return {
    key: t.key,
    keyLabel: `${KEY_LABEL[key] ?? t.key}:`,
    value: JSON.stringify(t.values),
    label: t.values.map((v) => valueLabel(key, v, team)).join(', ')
  }
}

export function fromSearchTokens(list: readonly SearchToken[]): FilterToken[] {
  const out: FilterToken[] = []
  for (const st of list) {
    if (!isTapeKey(st.key)) continue
    let values: string[] = []
    try {
      const v = JSON.parse(st.value) as unknown
      values = Array.isArray(v) ? v.map(String) : [String(v)]
    } catch {
      values = [st.value]
    }
    const merged = addAll(out, st.key, values)
    out.splice(0, out.length, ...merged)
  }
  return out
}

function addAll(tokens: FilterToken[], key: TapeKey, values: string[]): FilterToken[] {
  let next = tokens
  for (const v of values) next = addTokenValue(next, key, v)
  return next
}

// Matching

export interface MatchContext extends PlayContext {
  /** Player Focus: Status tests this player's entry. */
  player?: string
}

/**
 * Whether a play passes the tokens and the free text. Personnel tests the studied team's personnel on the play
 * (offense personnel on offense, defense personnel on defense), not either side's.
 */
export function matchPlay(play: Play, tokens: readonly FilterToken[], text: string, ctx: MatchContext): boolean {
  if (text.trim() && !textContains(play.desc, text)) return false
  for (const t of tokens) {
    if (!t.values.length) continue
    if (t.key === 'personnel') {
      const mine = play.posteam === ctx.team ? play.offPersonnel : play.defPersonnel
      if (!mine || !t.values.includes(mine)) return false
      continue
    }
    const [rule] = tokensToRules([t], { player: ctx.player })
    if (rule && !matchRule(rule, play, ctx)) return false
  }
  return true
}

// Suggestions

const ALIASES: { words: string[]; key: TapeKey; value: string }[] = [
  { words: ['3rd', 'third'], key: 'down', value: '3' },
  { words: ['1st', 'first'], key: 'down', value: '1' },
  { words: ['2nd', 'second'], key: 'down', value: '2' },
  { words: ['4th', 'fourth'], key: 'down', value: '4' },
  { words: ['red', 'rz', 'red zone'], key: 'situation', value: 'redZone' },
  { words: ['goal', 'goal to go'], key: 'situation', value: 'goalToGo' },
  { words: ['2 min', 'two', 'two-minute', 'two minute'], key: 'situation', value: 'twoMinute' },
  { words: ['td', 'touchdown'], key: 'result', value: 'td' },
  { words: ['int', 'fumble', 'turnover'], key: 'result', value: 'turnover' },
  { words: ['sack'], key: 'result', value: 'sack' },
  { words: ['penalty', 'flag'], key: 'result', value: 'penalty' },
  { words: ['pass'], key: 'type', value: 'pass' },
  { words: ['run'], key: 'type', value: 'run' },
  { words: ['punt', 'kick', 'special teams'], key: 'type', value: 'special' },
  { words: ['q1'], key: 'quarter', value: '1' },
  { words: ['q2'], key: 'quarter', value: '2' },
  { words: ['q3'], key: 'quarter', value: '3' },
  { words: ['q4'], key: 'quarter', value: '4' },
  { words: ['ot', 'overtime'], key: 'quarter', value: 'OT' },
  { words: ['ungraded'], key: 'status', value: 'ungraded' },
  { words: ['graded'], key: 'status', value: 'graded' },
  { words: ['critical'], key: 'status', value: 'critical' },
  { words: ['flagged'], key: 'marked', value: 'flagged' },
  { words: ['notes', 'noted'], key: 'marked', value: 'notes' },
  { words: ['drawings', 'drawn'], key: 'marked', value: 'drawings' }
]

export interface FilterSuggestion {
  key: TapeKey
  value: string
  label: string
}

/**
 * Filter suggestions for typed text: aliases ("rz" → Situation: Red Zone) and value labels, including the game's
 * formation, personnel and coverage values. Values already filtered are left out. At most 8.
 */
export function suggestFilters(text: string, team: string, tokens: readonly FilterToken[], lineup: LineupOptions = NO_LINEUP_OPTIONS): FilterSuggestion[] {
  const q = text.trim().toLowerCase()
  if (!q) return []
  const out: FilterSuggestion[] = []
  const seen = new Set<string>()
  const add = (key: TapeKey, value: string) => {
    const id = `${key}:${value}`
    if (seen.has(id) || tokenValues(tokens, key).includes(value)) return
    seen.add(id)
    out.push({ key, value, label: valueLabel(key, value, team) })
  }
  // A short query matches whole aliases only ("ot" is not "other"); longer ones match prefixes.
  const hit = (word: string) => (q.length < 3 ? word === q : word.startsWith(q))
  for (const a of ALIASES) if (a.words.some(hit)) add(a.key, a.value)
  for (const key of TAPE_KEYS) {
    for (const o of valueOptions(key, team, lineup)) {
      const label = o.label.toLowerCase()
      if (q.length >= 3 ? label.includes(q) : label === q || label.startsWith(q + ' ')) add(key, o.value)
    }
  }
  return out.slice(0, 8)
}
