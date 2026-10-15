import { gameTitle, weekShort } from '@shared/labels'
import { gameMayMatch, matchRules, type PlayContext } from '@shared/playQuery'
import { clipStartTime } from '@shared/snap'
import { teamEpa, teamSuccess } from '@shared/stats'
import type {
  Clip,
  Cutup,
  CutupDetail,
  CutupEntry,
  CutupFocus,
  CutupItem,
  CutupPreview,
  CutupRules,
  CutupSummary,
  GameInfo,
  GradeEntry,
  Play,
  PlayNote,
  PlayRef,
  RuleField,
  RuleOptions,
  Settings
} from '@shared/types'
import { gameFromId, type Library } from './library'

/**
 * Cut-up evaluation (03 §9.2): smart cut-up rules over the universe of games with film or grades, the perspective
 * team of each play, and the item builder both kinds share.
 */

const seasonOf = (gameId: string) => Number(gameId.slice(0, 4))
const refKey = (r: PlayRef) => `${r.gameId}:${r.playId}`
const POSTER_ANGLES: Clip['angle'][] = ['sideline', 'main', 'endzone']

/** Rule fields that read nflverse participation (lineup) data. */
export const LINEUP_FIELDS = new Set<RuleField>(['formation', 'personnel', 'coverage', 'manZone', 'pressure', 'passRushers', 'box'])

export const PREVIEW_SAMPLE = 5

/** One play a cut-up holds, before its item is built. */
interface Hit {
  ref: PlayRef
  game: GameInfo
  team: string
  /** null when the season isn't downloaded. */
  play: Play | null
  addedAt: string | null
}

interface Evaluation {
  hits: Hit[]
  skippedSeasons: number[]
  noLineupSeasons: number[]
}

/** The cut-up's team focus, or the team of an "is studied" Team rule when every rule must match (03 §9.3). */
export function effectiveFocus(rules: CutupRules | null, focus: CutupFocus | null): CutupFocus | null {
  if (focus?.team || !rules || rules.match !== 'all') return focus
  const studied = rules.rules.find((r) => r.field === 'team' && r.op === 'studied')
  const team = studied ? String(Array.isArray(studied.value) ? studied.value[0] : studied.value) : ''
  return team ? { ...(focus ?? {}), team } : focus
}

/**
 * The perspective team of a play (03 §9.1): `focus.team` when that team plays in the game; else, with a focus player,
 * the team that player was graded for in the game; else the game's studied team; else the home team.
 */
export function perspectiveTeam(game: GameInfo, focus: CutupFocus | null, studied: string | undefined, entries: GradeEntry[] = []): string {
  if (focus?.team && (game.homeTeam === focus.team || game.awayTeam === focus.team)) return focus.team
  if (focus?.playerId) {
    const e = entries.find((x) => x.playerId === focus.playerId && (x.team === game.homeTeam || x.team === game.awayTeam))
    if (e) return e.team
  }
  if (studied && (game.homeTeam === studied || game.awayTeam === studied)) return studied
  return game.homeTeam
}

/** Orders matching plays (03 §9.1) and applies the limit. */
export function orderHits<T extends { game: GameInfo; play: Play | null; team: string; ref: PlayRef }>(hits: T[], order: CutupRules['order'], limit: number | null): T[] {
  const byGame = (a: T, b: T) =>
    a.game.season - b.game.season || a.game.week - b.game.week || a.game.gameday.localeCompare(b.game.gameday) || a.game.gameId.localeCompare(b.game.gameId) || a.ref.playId - b.ref.playId
  const epa = (h: T) => (h.play ? teamEpa(h.play, h.team) : null)
  const out = [...hits]
  if (order === 'game') out.sort(byGame)
  else if (order === 'newest') {
    out.sort((a, b) => b.game.season - a.game.season || b.game.week - a.game.week || b.game.gameday.localeCompare(a.game.gameday) || b.game.gameId.localeCompare(a.game.gameId) || a.ref.playId - b.ref.playId)
  } else {
    const dir = order === 'epa-desc' ? -1 : 1
    out.sort((a, b) => {
      const ea = epa(a)
      const eb = epa(b)
      if (ea === null && eb === null) return byGame(a, b)
      if (ea === null) return 1
      if (eb === null) return -1
      return dir * (ea - eb) || byGame(a, b)
    })
  }
  return limit && limit > 0 ? out.slice(0, limit) : out
}

export class CutupEngine {
  private cache = new Map<string, { key: string; evaluation: Evaluation }>()

  constructor(private library: Library) {}

  private get store() {
    return this.library.store
  }

  /** Games with film or grades, newest first, with their studied team. */
  private universeIds(): string[] {
    const ids = new Set<string>([...this.store.studiedTeams().keys(), ...this.store.gamesWithGrades()])
    // Only games with clips count as "film"; studied teams of games whose film was removed are harmless (no plays match without grades).
    return [...ids].sort((a, b) => b.localeCompare(a))
  }

  private async cacheKey(extra: string): Promise<string> {
    return `${this.store.changeCount}|${(await this.library.downloadedSeasons()).join(',')}|${extra}`
  }

  /** Every play in the universe matching `rules`, ordered and limited. */
  private async evaluate(rules: CutupRules, focusIn: CutupFocus | null): Promise<Evaluation> {
    const focus = effectiveFocus(rules, focusIn)
    const downloaded = new Set(await this.library.downloadedSeasons())
    const studied = this.store.studiedTeams()
    const chartFields = this.store.chartFields()
    const usesLineups = rules.rules.some((r) => LINEUP_FIELDS.has(r.field))
    const skipped = new Set<number>()
    const noLineups = new Set<number>()
    const hits: Hit[] = []
    if (!rules.rules.length) return { hits, skippedSeasons: [], noLineupSeasons: [] }
    for (const gameId of this.universeIds()) {
      const season = seasonOf(gameId)
      if (!downloaded.has(season)) {
        const game = gameFromId(gameId)
        if (gameMayMatch(rules, game, perspectiveTeam(game, focus, studied.get(gameId)))) skipped.add(season)
        continue
      }
      const data = await this.library.seasonOrNull(season)
      const game = data?.games.find((g) => g.gameId === gameId)
      if (!data || !game) continue
      const entries = this.store.gradesForGame(gameId)
      const team = perspectiveTeam(game, focus, studied.get(gameId), entries)
      if (!gameMayMatch(rules, game, team)) continue
      if (usesLineups && !data.meta.hasParticipation) noLineups.add(season)
      const notes = new Map(this.store.notesForGame(gameId).map((n) => [n.playId, n]))
      const byPlay = groupBy(entries, (e) => e.playId)
      const plays = await this.library.filmPlays(gameId)
      // One perspective per game: a focus player's side comes from his grades anywhere in the game, so plays he
      // wasn't graded on are still seen from his team.
      for (const play of plays) {
        const ctx: PlayContext = { game, team, entries: byPlay.get(play.playId) ?? [], note: notes.get(play.playId) ?? null, chartFields }
        if (matchRules(rules, play, ctx)) hits.push({ ref: { gameId, playId: play.playId }, game, team, play, addedAt: null })
      }
    }
    return {
      hits: orderHits(hits, rules.order, rules.limit),
      skippedSeasons: [...skipped].sort((a, b) => b - a),
      noLineupSeasons: [...noLineups].sort((a, b) => b - a)
    }
  }

  /** A manual cut-up's plays in user order; plays of seasons not downloaded keep `play: null`. */
  private async manualHits(cutup: Cutup): Promise<Evaluation> {
    const studied = this.store.studiedTeams()
    const skipped = new Set<number>()
    const hits: Hit[] = []
    const gameCache = new Map<string, { game: GameInfo; plays: Map<number, Play> | null; entries: GradeEntry[] }>()
    for (const row of this.store.cutupPlays(cutup.id)) {
      let g = gameCache.get(row.gameId)
      if (!g) {
        const data = await this.library.seasonOrNull(seasonOf(row.gameId))
        const game = data?.games.find((x) => x.gameId === row.gameId) ?? gameFromId(row.gameId)
        const plays = data ? new Map((await this.library.plays(row.gameId)).map((p) => [p.playId, p])) : null
        if (!data) skipped.add(seasonOf(row.gameId))
        g = { game, plays, entries: this.store.gradesForGame(row.gameId) }
        gameCache.set(row.gameId, g)
      }
      const team = perspectiveTeam(g.game, cutup.focus, studied.get(row.gameId), g.entries)
      hits.push({ ref: { gameId: row.gameId, playId: row.playId }, game: g.game, team, play: g.plays?.get(row.playId) ?? null, addedAt: row.addedAt })
    }
    return { hits, skippedSeasons: [...skipped].sort((a, b) => b - a), noLineupSeasons: [] }
  }

  private async evaluationFor(cutup: Cutup): Promise<Evaluation> {
    const key = await this.cacheKey(`${cutup.updatedAt}|${JSON.stringify(cutup.rules)}|${JSON.stringify(cutup.focus)}`)
    const hit = this.cache.get(cutup.id)
    if (hit && hit.key === key) return hit.evaluation
    const evaluation = cutup.kind === 'smart' && cutup.rules ? await this.evaluate(cutup.rules, cutup.focus) : cutup.kind === 'smart' ? { hits: [], skippedSeasons: [], noLineupSeasons: [] } : await this.manualHits(cutup)
    this.cache.set(cutup.id, { key, evaluation })
    return evaluation
  }

  /** Plays a cut-up holds right now, in its order (smart: computed). */
  async refs(id: string): Promise<PlayRef[]> {
    const cutup = this.store.cutupById(id)
    if (!cutup) return []
    return (await this.evaluationFor(cutup)).hits.map((h) => h.ref)
  }

  private totals(hits: Hit[], settings: Settings) {
    let duration = 0
    let withoutFilm = 0
    let poster: CutupSummary['poster'] = null
    const clipsByGame = new Map<string, Clip[]>()
    for (const h of hits) {
      let clips = clipsByGame.get(h.ref.gameId)
      if (!clips) {
        clips = this.store.clipsForGame(h.ref.gameId)
        clipsByGame.set(h.ref.gameId, clips)
      }
      const forPlay = clips.filter((c) => c.playId === h.ref.playId)
      const clip = POSTER_ANGLES.map((a) => forPlay.find((c) => c.angle === a)).find(Boolean)
      if (!clip) {
        withoutFilm++
        continue
      }
      const start = clipStartTime(clip, settings)
      if (clip.duration !== null) duration += Math.max(0, clip.duration - start)
      if (!poster) poster = { clipId: clip.id, at: start }
    }
    return {
      playCount: hits.length,
      gameCount: new Set(hits.map((h) => h.ref.gameId)).size,
      duration: Math.round(duration * 10) / 10,
      withoutFilm,
      poster
    }
  }

  /** Every cut-up in sidebar order with its counts (03 §9.2). */
  async summaries(): Promise<CutupSummary[]> {
    const settings = this.store.settings()
    const out: CutupSummary[] = []
    for (const cutup of this.store.cutups()) {
      const { hits } = await this.evaluationFor(cutup)
      out.push({ cutup, ...this.totals(hits, settings) })
    }
    return out
  }

  async detail(id: string): Promise<CutupDetail | null> {
    const cutup = this.store.cutupById(id)
    if (!cutup) return null
    const evaluation = await this.evaluationFor(cutup)
    return { cutup, items: await this.items(evaluation.hits, effectiveFocus(cutup.rules, cutup.focus)), skippedSeasons: evaluation.skippedSeasons }
  }

  async preview(rules: CutupRules, focus: CutupFocus | null = null): Promise<CutupPreview> {
    const evaluation = await this.evaluate(rules, focus)
    const totals = this.totals(evaluation.hits, this.store.settings())
    return {
      playCount: totals.playCount,
      gameCount: totals.gameCount,
      duration: totals.duration,
      sample: await this.items(evaluation.hits.slice(0, PREVIEW_SAMPLE), effectiveFocus(rules, focus)),
      skippedSeasons: evaluation.skippedSeasons,
      noLineupSeasons: evaluation.noLineupSeasons
    }
  }

  /** The item builder both kinds share (03 §9.2). */
  async items(hits: Hit[], focus: CutupFocus | null): Promise<CutupItem[]> {
    const perGame = new Map<string, { clips: Clip[]; entries: GradeEntry[]; notes: Map<number, PlayNote>; names: Map<string, { name: string; position: string }> }>()
    const out: CutupItem[] = []
    for (const h of hits) {
      let g = perGame.get(h.ref.gameId)
      if (!g) {
        const data = await this.library.seasonOrNull(seasonOf(h.ref.gameId))
        const index = data ? this.library.playerIndex(data) : null
        const names = new Map<string, { name: string; position: string }>()
        const entries = this.store.gradesForGame(h.ref.gameId)
        for (const e of entries) {
          const p = index?.get(e.playerId)
          names.set(e.playerId, { name: p?.name ?? e.playerId, position: p?.position ?? '' })
        }
        g = { clips: this.store.clipsForGame(h.ref.gameId), entries, notes: new Map(this.store.notesForGame(h.ref.gameId).map((n) => [n.playId, n])), names }
        perGame.set(h.ref.gameId, g)
      }
      const note = g.notes.get(h.ref.playId) ?? null
      const entries: CutupEntry[] = g.entries
        .filter((e) => e.playId === h.ref.playId && (focus?.playerId ? e.playerId === focus.playerId : e.team === h.team))
        .filter((e) => e.grade !== null || e.critical || e.tags.length > 0 || e.note.trim() !== '')
        .map((e) => ({ playerId: e.playerId, ...(g!.names.get(e.playerId) ?? { name: e.playerId, position: '' }), grade: e.grade, critical: e.critical, tags: e.tags, note: e.note }))
      out.push({
        ref: h.ref,
        game: h.game,
        team: h.team,
        play: h.play,
        clips: g.clips.filter((c) => c.playId === h.ref.playId),
        drawing: note?.drawing ?? null,
        playNote: note?.note ?? '',
        flagged: note?.flagged ?? false,
        chart: note?.chart ?? {},
        entries,
        teamEpa: h.play ? teamEpa(h.play, h.team) : null,
        teamSuccess: h.play ? teamSuccess(h.play, h.team) : null,
        addedAt: h.addedAt
      })
    }
    return out
  }

  /** Items for plays given directly (Export Video of a reel, Add to Cut-up previews). */
  async itemsForRefs(refs: PlayRef[], focus: CutupFocus | null = null): Promise<CutupItem[]> {
    const studied = this.store.studiedTeams()
    const hits: Hit[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
      if (seen.has(refKey(ref))) continue
      seen.add(refKey(ref))
      const data = await this.library.seasonOrNull(seasonOf(ref.gameId))
      const game = data?.games.find((x) => x.gameId === ref.gameId) ?? gameFromId(ref.gameId)
      const play = data ? ((await this.library.plays(ref.gameId)).find((p) => p.playId === ref.playId) ?? null) : null
      hits.push({ ref, game, team: perspectiveTeam(game, focus, studied.get(ref.gameId), this.store.gradesForGame(ref.gameId)), play, addedAt: null })
    }
    return this.items(hits, focus)
  }

  /** Value lists for the rules sheet (03 §9.2). */
  async ruleOptions(): Promise<RuleOptions> {
    const downloaded = await this.library.downloadedSeasons()
    const have = new Set(downloaded)
    const games: RuleOptions['games'] = []
    const formations = new Set<string>()
    const offPersonnel = new Set<string>()
    const defPersonnel = new Set<string>()
    const coverages = new Set<string>()
    const noLineups = new Set<number>()
    for (const gameId of this.universeIds()) {
      const season = seasonOf(gameId)
      if (!have.has(season)) continue
      const data = await this.library.seasonOrNull(season)
      const game = data?.games.find((g) => g.gameId === gameId)
      if (!data || !game) continue
      games.push({ gameId, season, week: game.week, label: `${season} · ${weekShort(game)} · ${gameTitle(game)}`, homeTeam: game.homeTeam, awayTeam: game.awayTeam })
      if (!data.meta.hasParticipation) {
        noLineups.add(season)
        continue
      }
      for (const p of await this.library.filmPlays(gameId)) {
        if (p.formation) formations.add(p.formation)
        if (p.offPersonnel) offPersonnel.add(p.offPersonnel)
        if (p.defPersonnel) defPersonnel.add(p.defPersonnel)
        if (p.coverage) coverages.add(p.coverage)
      }
    }
    games.sort((a, b) => b.season - a.season || b.week - a.week || b.gameId.localeCompare(a.gameId))
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b))
    return {
      seasons: downloaded,
      games,
      formations: sorted(formations),
      offPersonnel: sorted(offPersonnel),
      defPersonnel: sorted(defPersonnel),
      coverages: sorted(coverages),
      tags: this.store.tags().map((t) => ({ group: t.group, label: t.label })),
      chartFields: this.store.chartFields(),
      noLineupSeasons: [...noLineups].sort((a, b) => b - a)
    }
  }

  /** Drops cached results (a cut-up was deleted). */
  forget(id: string) {
    this.cache.delete(id)
  }
}

function groupBy<T, K>(list: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const t of list) {
    const k = key(t)
    const arr = out.get(k)
    if (arr) arr.push(t)
    else out.set(k, [t])
  }
  return out
}
