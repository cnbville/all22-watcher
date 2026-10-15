import { teamEpa, teamSuccess } from './stats'
import type { ChartField, GameInfo, GradeEntry, Play, PlayNote, PlayRule, RuleField, RuleOp } from './types'

/**
 * Smart cut-up rules and play filter tokens (03 §9.3, 02 §4.3). Pure, shared by main (cut-up evaluation) and the
 * renderer (tape room tokens, Player › Film tokens), so the two always agree.
 *
 * Canonical values (what rules and tokens store; screens map them to labels):
 *   side: offense | defense                 type: pass | run | special
 *   down: 1–4                                distance: 1-3 | 4-6 | 7-10 | 11+
 *   quarter: 1–4 | OT                        situation: redZone | goalToGo | twoMinute
 *   result: td | turnover | sack | penalty | explosive
 *   status: ungraded | graded | critical     marked: flagged | notes | drawings
 *   grade: + | 0 | -                         manZone: man | zone
 *   pressure: pressured | notPressured       success: successful | unsuccessful
 *   formation, personnel, coverage, tag, game, team, opponent, season: raw values (strings)
 */

export interface PlayContext {
  game: GameInfo
  /** The perspective team: whose side, grades and EPA the rules use. */
  team: string
  /** Every grade entry on the play (any team). */
  entries: GradeEntry[]
  note: PlayNote | null
  chartFields?: ChartField[]
}

export const DISTANCE_BUCKETS: { key: string; min: number; max: number }[] = [
  { key: '1-3', min: 1, max: 3 },
  { key: '4-6', min: 4, max: 6 },
  { key: '7-10', min: 7, max: 10 },
  { key: '11+', min: 11, max: Infinity }
]

export function distanceBucket(ydstogo: number | null): string | null {
  if (ydstogo === null) return null
  return DISTANCE_BUCKETS.find((b) => ydstogo >= b.min && ydstogo <= b.max)?.key ?? null
}

export const quarterKey = (qtr: number) => (qtr >= 5 ? 'OT' : String(qtr))

/** "06:41" → 401 seconds; null when unreadable. */
export function clockSeconds(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** 02 §4.3 situations. A play can be in several. */
export function situations(play: Play): string[] {
  const out: string[] = []
  if (play.yardline100 !== null && play.down !== null && play.yardline100 <= 20) out.push('redZone')
  if (play.yardline100 !== null && play.ydstogo !== null && play.down !== null && play.yardline100 <= play.ydstogo) out.push('goalToGo')
  const clock = clockSeconds(play.time)
  if ((play.qtr === 2 || play.qtr === 4) && clock !== null && clock <= 120) out.push('twoMinute')
  return out
}

export function playKind(play: Play): 'pass' | 'run' | 'special' | null {
  if (play.special) return 'special'
  if (play.isPass) return 'pass'
  if (play.isRush) return 'run'
  return null
}

/** A pass of 20+ or a run of 10+ yards gained. */
export function isExplosive(play: Play): boolean {
  const y = play.yardsGained ?? 0
  return (play.isPass && y >= 20) || (play.isRush && y >= 10)
}

export function results(play: Play): string[] {
  const out: string[] = []
  if (play.touchdown) out.push('td')
  if (play.turnover) out.push('turnover')
  if (play.sack) out.push('sack')
  if (play.penalty) out.push('penalty')
  if (isExplosive(play)) out.push('explosive')
  return out
}

export function manZoneKey(raw: string | null): string | null {
  if (!raw) return null
  const v = raw.toUpperCase()
  if (v.startsWith('MAN')) return 'man'
  if (v.startsWith('ZONE')) return 'zone'
  return null
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function textContains(haystack: string, needle: string): boolean {
  const n = fold(needle.trim())
  return !n || fold(haystack).includes(n)
}

const gradeKey = (g: GradeEntry['grade']) => (g === 1 ? '+' : g === 0 ? '0' : g === -1 ? '-' : null)

/** Entries a Grade, Status or Tag rule looks at: the scoped player's, else the perspective team's. */
function scopedEntries(rule: PlayRule, ctx: PlayContext): GradeEntry[] {
  return rule.player ? ctx.entries.filter((e) => e.playerId === rule.player) : ctx.entries.filter((e) => e.team === ctx.team)
}

function statusValues(entries: GradeEntry[]): string[] {
  const graded = entries.filter((e) => e.grade !== null)
  const out = graded.length ? ['graded'] : ['ungraded']
  if (graded.some((e) => e.critical)) out.push('critical')
  return out
}

function markedValues(ctx: PlayContext): string[] {
  const out: string[] = []
  if (ctx.note?.flagged) out.push('flagged')
  if (ctx.note?.note.trim() || ctx.entries.some((e) => e.note.trim())) out.push('notes')
  if (ctx.note && Object.values(ctx.note.drawing).some((list) => (list?.length ?? 0) > 0)) out.push('drawings')
  return out
}

const asList = (v: PlayRule['value']): string[] => (Array.isArray(v) ? v.map(String) : v === '' ? [] : [String(v)])
const asNum = (v: PlayRule['value']): number => (Array.isArray(v) ? Number(v[0]) : Number(v))
const asRange = (v: PlayRule['value']): [number, number] => {
  const [a, b] = Array.isArray(v) ? v.map(Number) : [Number(v), Number(v)]
  return a <= b ? [a, b] : [b, a]
}

/** Values the play has for a set-valued field, or null when the field doesn't apply (that never matches). */
function setValues(field: RuleField, play: Play, ctx: PlayContext): string[] | null {
  const opp = ctx.game.homeTeam === ctx.team ? ctx.game.awayTeam : ctx.game.homeTeam
  switch (field) {
    case 'season':
      return [String(ctx.game.season)]
    case 'opponent':
      return [opp]
    case 'game':
      return [ctx.game.gameId]
    case 'side':
      if (!play.posteam) return null
      return [play.posteam === ctx.team ? 'offense' : 'defense']
    case 'type': {
      const k = playKind(play)
      return k ? [k] : []
    }
    case 'down':
      return play.down === null ? null : [String(play.down)]
    case 'distance': {
      if (play.down === null) return null
      const b = distanceBucket(play.ydstogo)
      return b ? [b] : null
    }
    case 'quarter':
      return [quarterKey(play.qtr)]
    case 'situation':
      return situations(play)
    case 'formation':
      return play.formation === null ? null : [play.formation]
    case 'personnel': {
      const v = [play.offPersonnel, play.defPersonnel].filter((x): x is string => !!x)
      return v.length ? v : null
    }
    case 'coverage':
      return play.coverage === null ? null : [play.coverage]
    case 'manZone': {
      const k = manZoneKey(play.manZone)
      return k ? [k] : null
    }
    case 'pressure':
      if (!play.isPass || play.wasPressure === null) return null
      return [play.wasPressure ? 'pressured' : 'notPressured']
    case 'result':
      return results(play)
    case 'success': {
      const s = teamSuccess(play, ctx.team)
      return s === null ? null : [s ? 'successful' : 'unsuccessful']
    }
    case 'marked':
      return markedValues(ctx)
    default:
      if (field.startsWith('chart:')) {
        const id = Number(field.slice(6))
        const name = ctx.chartFields?.find((f) => f.id === id)?.name
        const v = name ? ctx.note?.chart[name] : undefined
        return v ? [v] : null
      }
      return null
  }
}

function numericValue(field: RuleField, play: Play, ctx: PlayContext): number | null {
  switch (field) {
    case 'week':
      return ctx.game.week
    case 'season':
      return ctx.game.season
    case 'distance':
      return play.down === null ? null : play.ydstogo
    case 'passRushers':
      return play.passRushers
    case 'box':
      return play.defendersInBox
    case 'epa':
      return teamEpa(play, ctx.team)
    case 'yards':
      return play.yardsGained
    default:
      return null
  }
}

/** Whether one rule matches one play. Incomplete rules (no value) match nothing. */
export function matchRule(rule: PlayRule, play: Play, ctx: PlayContext): boolean {
  const { field, op, value } = rule
  switch (field) {
    case 'team': {
      const team = String(Array.isArray(value) ? value[0] : value)
      if (!team) return false
      if (op === 'offense') return play.posteam === team
      if (op === 'defense') return play.defteam === team
      return ctx.team === team // studied
    }
    case 'yardline': {
      const n = asNum(value)
      if (!Number.isFinite(n) || play.yardline100 === null) return false
      return op === 'insideOwn' ? play.yardline100 >= 100 - n : play.yardline100 <= n
    }
    case 'text':
      return typeof value === 'string' && value.trim() !== '' && textContains(play.desc, value)
    case 'note': {
      if (typeof value !== 'string' || !value.trim()) return false
      return [ctx.note?.note ?? '', ...ctx.entries.map((e) => e.note)].some((t) => t && textContains(t, value))
    }
    case 'player': {
      const id = String(Array.isArray(value) ? value[0] : value)
      if (!id) return false
      if (op === 'credited') return play.involved.includes(id)
      if (op === 'graded') return ctx.entries.some((e) => e.playerId === id && e.grade !== null)
      return play.offensePlayers.includes(id) || play.defensePlayers.includes(id) // onField
    }
    case 'grade': {
      const want = new Set(asList(value))
      if (!want.size) return false
      return scopedEntries(rule, ctx).some((e) => {
        const k = gradeKey(e.grade)
        return k !== null && want.has(k)
      })
    }
    case 'status': {
      const want = asList(value)
      if (!want.length) return false
      const have = statusValues(scopedEntries(rule, ctx))
      const hit = want.some((v) => have.includes(v))
      return op === 'isNot' ? !hit : hit
    }
    case 'tag': {
      const want = asList(value)
      if (!want.length) return false
      const tags = new Set(scopedEntries(rule, ctx).flatMap((e) => e.tags))
      const hit = want.some((t) => tags.has(t))
      return op === 'excludes' ? !hit : hit
    }
  }

  if (op === 'gte' || op === 'lte' || op === 'between' || ((field === 'week' || field === 'passRushers' || field === 'box') && op === 'is' && !Array.isArray(value))) {
    const v = numericValue(field, play, ctx)
    if (v === null) return false
    if (op === 'gte') return v >= asNum(value)
    if (op === 'lte') return v <= asNum(value)
    if (op === 'between') {
      const [a, b] = asRange(value)
      return v >= a && v <= b
    }
    return v === asNum(value)
  }

  const want = asList(value)
  if (!want.length) return false
  if (field === 'week' || field === 'passRushers' || field === 'box') {
    const v = numericValue(field, play, ctx)
    const hit = v !== null && want.map(Number).includes(v)
    return op === 'isNot' ? !hit && v !== null : hit
  }
  const have = setValues(field, play, ctx)
  if (have === null) return false
  const hit = want.some((v) => have.includes(v))
  return op === 'isNot' || op === 'excludes' ? !hit : hit
}

export function matchRules(rules: { match: 'all' | 'any'; rules: PlayRule[] }, play: Play, ctx: PlayContext): boolean {
  if (!rules.rules.length) return false
  return rules.match === 'any' ? rules.rules.some((r) => matchRule(r, play, ctx)) : rules.rules.every((r) => matchRule(r, play, ctx))
}

/** Rules that look only at the game (applied before plays are loaded). */
export const GAME_FIELDS = new Set<RuleField>(['season', 'team', 'opponent', 'game', 'week'])

/**
 * Whether a game can hold matching plays, from its game-level rules alone. `team` is the perspective team for the game.
 * With "any", a game can't be ruled out unless every rule is a game rule that fails.
 */
export function gameMayMatch(rules: { match: 'all' | 'any'; rules: PlayRule[] }, game: GameInfo, team: string): boolean {
  const gameRules = rules.rules.filter((r) => GAME_FIELDS.has(r.field) && !(r.field === 'team' && r.op !== 'studied'))
  const teamPlays = rules.rules.filter((r) => r.field === 'team' && r.op !== 'studied')
  const fake = { posteam: '', defteam: '' } as Play
  const ctx: PlayContext = { game, team, entries: [], note: null }
  const test = (r: PlayRule) => {
    if (r.field === 'team' && r.op !== 'studied') {
      const t = String(Array.isArray(r.value) ? r.value[0] : r.value)
      return game.homeTeam === t || game.awayTeam === t
    }
    return matchRule(r, fake, ctx)
  }
  if (rules.match === 'all') return [...gameRules, ...teamPlays].every(test)
  if (gameRules.length + teamPlays.length < rules.rules.length) return true
  return [...gameRules, ...teamPlays].some(test)
}

// Tokens

/** Token keys: the tape room's (02 §4.3) plus the reel's (03 §6.3); chart fields use `chart:<id>`. */
export type TokenKey =
  | 'side' | 'type' | 'down' | 'distance' | 'quarter' | 'situation' | 'status' | 'marked' | 'result'
  | 'formation' | 'personnel' | 'coverage' | 'grade' | 'tag' | 'game' | 'manZone' | 'pressure'
  | `chart:${number}`

export interface FilterToken {
  key: TokenKey
  /** Canonical values (see the top of this file). Values combine with OR. */
  values: string[]
}

const TOKEN_FIELDS: Record<string, RuleField> = {
  side: 'side', type: 'type', down: 'down', distance: 'distance', quarter: 'quarter', situation: 'situation', status: 'status',
  marked: 'marked', result: 'result', formation: 'formation', personnel: 'personnel', coverage: 'coverage', grade: 'grade',
  tag: 'tag', game: 'game', manZone: 'manZone', pressure: 'pressure'
}

/**
 * Turns filter tokens (and free text) into rules: one rule per key with op 'is' (Tag: 'includes'); free text becomes
 * a Description rule. With `player`, Grade, Status and Tag rules are scoped to that player (Player Focus, the reel).
 */
export function tokensToRules(tokens: FilterToken[], ctx: { text?: string; player?: string } = {}): PlayRule[] {
  const rules: PlayRule[] = []
  for (const t of tokens) {
    if (!t.values.length) continue
    const field = (t.key.startsWith('chart:') ? t.key : TOKEN_FIELDS[t.key]) as RuleField | undefined
    if (!field) continue
    const rule: PlayRule = { field, op: field === 'tag' ? 'includes' : 'is', value: [...t.values] }
    if (ctx.player && (field === 'grade' || field === 'status' || field === 'tag')) rule.player = ctx.player
    rules.push(rule)
  }
  if (ctx.text?.trim()) rules.push({ field: 'text', op: 'contains', value: ctx.text.trim() })
  return rules
}

/**
 * The reverse, for "Watch These Plays" and opening a smart cut-up as Player Film filters: null when some rule has no
 * token form (another operator, a numeric field, a game-level field other than Game).
 */
export function rulesToTokens(rules: PlayRule[]): { tokens: FilterToken[]; text: string } | null {
  const tokens: FilterToken[] = []
  let text = ''
  const keyOf = (field: RuleField): TokenKey | null => {
    if (field.startsWith('chart:')) return field as TokenKey
    const k = Object.keys(TOKEN_FIELDS).find((key) => TOKEN_FIELDS[key] === field)
    return (k as TokenKey | undefined) ?? null
  }
  for (const r of rules) {
    if (r.field === 'text' && r.op === 'contains' && typeof r.value === 'string') {
      if (text) return null
      text = r.value
      continue
    }
    const key = keyOf(r.field)
    const okOp = r.field === 'tag' ? r.op === 'includes' : r.op === 'is'
    if (!key || !okOp || !Array.isArray(r.value)) return null
    if (tokens.some((t) => t.key === key)) return null
    tokens.push({ key, values: r.value.map(String) })
  }
  return { tokens, text }
}

/** Operators each field offers, first one the default (03 §9.3). */
export const RULE_OPS: Record<string, RuleOp[]> = {
  season: ['is', 'isNot', 'between'],
  team: ['studied', 'offense', 'defense'],
  opponent: ['is', 'isNot'],
  game: ['is', 'isNot'],
  week: ['is', 'between', 'gte', 'lte'],
  side: ['is'],
  type: ['is', 'isNot'],
  down: ['is', 'isNot'],
  distance: ['is', 'gte', 'lte'],
  quarter: ['is', 'isNot'],
  situation: ['is', 'isNot'],
  yardline: ['insideOpp', 'insideOwn'],
  formation: ['is', 'isNot'],
  personnel: ['is', 'isNot'],
  coverage: ['is', 'isNot'],
  manZone: ['is'],
  pressure: ['is'],
  passRushers: ['is', 'gte', 'lte'],
  box: ['is', 'gte', 'lte'],
  result: ['is', 'isNot'],
  success: ['is'],
  epa: ['gte', 'lte', 'between'],
  yards: ['gte', 'lte'],
  text: ['contains'],
  player: ['onField', 'credited', 'graded'],
  grade: ['is'],
  status: ['is', 'isNot'],
  tag: ['includes', 'excludes'],
  marked: ['is', 'isNot'],
  note: ['contains'],
  chart: ['is', 'isNot']
}

/** Whether a rule has a value, so the sheet can mark it incomplete. */
export function ruleComplete(rule: PlayRule): boolean {
  const v = rule.value
  if (Array.isArray(v)) return v.length > 0 && v.every((x) => x !== '' && x !== null && x !== undefined)
  if (typeof v === 'number') return Number.isFinite(v)
  return typeof v === 'string' && v.trim() !== ''
}
