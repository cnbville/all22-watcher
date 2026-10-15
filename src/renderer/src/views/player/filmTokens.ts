import { defPersonnelLabel, enumLabel, gameLabel, personnelLabel } from '@shared/labels'
import { type FilterToken, matchRule, type TokenKey, tokensToRules } from '@shared/playQuery'
import type { ChartField, GameInfo } from '@shared/types'
import type { SearchSuggestion, SearchToken } from '../../ui/SearchField'
import type { ReelEntry } from '../shared'
import { reelContext } from './model'

/** Player › Film search tokens (03 §6.3): the tape room's keys plus Grade, Tag, Game, Man/Zone, Pressure and chart fields. */

const FIXED: Partial<Record<TokenKey, { label: string; values: [string, string][] }>> = {
  side: { label: 'Side', values: [['offense', 'Offense'], ['defense', 'Defense']] },
  type: { label: 'Type', values: [['pass', 'Pass'], ['run', 'Run'], ['special', 'Special teams']] },
  down: { label: 'Down', values: [['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4', '4th']] },
  distance: { label: 'Distance', values: [['1-3', '1–3'], ['4-6', '4–6'], ['7-10', '7–10'], ['11+', '11+']] },
  quarter: { label: 'Quarter', values: [['1', 'Q1'], ['2', 'Q2'], ['3', 'Q3'], ['4', 'Q4'], ['OT', 'OT']] },
  situation: { label: 'Situation', values: [['redZone', 'Red zone'], ['goalToGo', 'Goal to go'], ['twoMinute', 'Two-minute']] },
  status: { label: 'Status', values: [['critical', 'Critical']] },
  marked: { label: 'Marked', values: [['flagged', 'Flagged'], ['notes', 'Notes'], ['drawings', 'Drawings']] },
  result: { label: 'Result', values: [['td', 'Touchdown'], ['turnover', 'Turnover'], ['sack', 'Sack'], ['penalty', 'Penalty'], ['explosive', 'Explosive']] },
  grade: { label: 'Grade', values: [['+', '+'], ['0', '0'], ['-', '−']] },
  manZone: { label: 'Man/Zone', values: [['man', 'Man'], ['zone', 'Zone']] },
  pressure: { label: 'Pressure', values: [['pressured', 'Pressured'], ['notPressured', 'Not Pressured']] }
}

const RAW_LABEL: Partial<Record<TokenKey, string>> = { formation: 'Formation', personnel: 'Personnel', coverage: 'Coverage', tag: 'Tag', game: 'Game' }

export interface TokenEnv {
  games: Map<string, GameInfo>
  /** The player's team per game, for "Wk 1 vs DAL". */
  teams: Map<string, string>
  chartFields: ChartField[]
}

export function keyLabel(key: string, env: TokenEnv): string {
  if (key.startsWith('chart:')) return env.chartFields.find((f) => `chart:${f.id}` === key)?.name ?? 'Chart'
  return FIXED[key as TokenKey]?.label ?? RAW_LABEL[key as TokenKey] ?? key
}

export function valueLabel(key: string, value: string, env: TokenEnv): string {
  const fixed = FIXED[key as TokenKey]?.values.find(([v]) => v === value)
  if (fixed) return fixed[1]
  switch (key) {
    case 'formation':
    case 'coverage':
      return enumLabel(value)
    case 'personnel': {
      const off = personnelLabel(value)
      return off !== value ? off : defPersonnelLabel(value) || value
    }
    case 'game': {
      const g = env.games.get(value)
      return g ? gameLabel(g, env.teams.get(value) ?? g.homeTeam) : value
    }
    default:
      return value
  }
}

export function toSearchToken(key: string, value: string, env: TokenEnv): SearchToken {
  return { key, keyLabel: `${keyLabel(key, env)}:`, value, label: valueLabel(key, value, env) }
}

/** Search tokens (one per value) → filter tokens (one per key, values OR). */
export function toFilter(tokens: SearchToken[]): FilterToken[] {
  const by = new Map<string, string[]>()
  for (const t of tokens) by.set(t.key, [...(by.get(t.key) ?? []), t.value])
  return [...by].map(([key, values]) => ({ key: key as TokenKey, values: [...new Set(values)] }))
}

export function fromFilter(filter: FilterToken[], env: TokenEnv): SearchToken[] {
  return filter.flatMap((f) => f.values.map((v) => toSearchToken(f.key, v, env)))
}

/** `?tokens=` holds JSON FilterToken[]. */
export function parseTokensParam(raw: string | undefined): FilterToken[] | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as FilterToken[]
    return Array.isArray(v) ? v.filter((t) => t && typeof t.key === 'string' && Array.isArray(t.values)) : null
  } catch {
    return null
  }
}

export function tokensParam(filter: FilterToken[]): string {
  return JSON.stringify(filter)
}

/** Every value present in these plays per key, with counts: the suggestion pool. */
export function tokenPool(entries: ReelEntry[], playerId: string, env: TokenEnv, charts: Map<string, Record<string, string>>): { key: string; value: string; count: number }[] {
  const candidates = new Map<string, Set<string>>()
  const add = (k: string, v: string | null | undefined) => {
    if (!v) return
    const set = candidates.get(k) ?? new Set<string>()
    set.add(v)
    candidates.set(k, set)
  }
  for (const [k, def] of Object.entries(FIXED)) for (const [v] of def!.values) add(k, v)
  for (const e of entries) {
    add('game', e.ref.gameId)
    e.tags?.forEach((t) => add('tag', t))
    if (!e.play) continue
    add('formation', e.play.formation)
    add('personnel', e.play.offPersonnel)
    add('personnel', e.play.defPersonnel)
    add('coverage', e.play.coverage)
  }
  for (const f of env.chartFields) for (const o of f.options) add(`chart:${f.id}`, o)
  const out: { key: string; value: string; count: number }[] = []
  for (const [key, values] of candidates) {
    for (const value of values) {
      const rules = tokensToRules([{ key: key as TokenKey, values: [value] }], { player: playerId })
      if (!rules.length) continue
      let count = 0
      for (const e of entries) {
        if (!e.play) continue
        const ctx = reelContext(e, playerId, env.chartFields, charts.get(`${e.ref.gameId}:${e.ref.playId}`) ?? {})
        if (matchRule(rules[0], e.play, ctx)) count++
      }
      if (count) out.push({ key, value, count })
    }
  }
  return out
}

/** Suggestions for typed text: keys or values that start with it (or contain it), "Down: 3rd · 6". */
export function suggest(text: string, pool: { key: string; value: string; count: number }[], current: SearchToken[], env: TokenEnv): SearchSuggestion[] {
  const q = text.trim().toLowerCase()
  if (!q) return []
  const taken = new Set(current.map((t) => `${t.key}\u0001${t.value}`))
  const scored: { s: SearchSuggestion; score: number }[] = []
  for (const p of pool) {
    if (taken.has(`${p.key}\u0001${p.value}`)) continue
    const token = toSearchToken(p.key, p.value, env)
    const k = token.keyLabel.toLowerCase().replace(':', '')
    const v = token.label.toLowerCase()
    const score = v.startsWith(q) ? 3 : k.startsWith(q) ? 2 : v.includes(q) || `${k} ${v}`.includes(q) ? 1 : 0
    if (score) scored.push({ s: { section: token.keyLabel.replace(':', ''), token, detail: String(p.count) }, score })
  }
  scored.sort((a, b) => b.score - a.score || (a.s.section ?? '').localeCompare(b.s.section ?? '') || Number(b.s.detail) - Number(a.s.detail))
  // Group by section in first-seen order, at most 12.
  const top = scored.slice(0, 12).map((x) => x.s)
  const order: string[] = []
  for (const s of top) if (!order.includes(s.section!)) order.push(s.section!)
  return order.flatMap((sec) => top.filter((s) => s.section === sec))
}
