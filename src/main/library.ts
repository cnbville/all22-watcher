import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { checkAlignment as runAlignment, type AlignmentClip } from '@shared/alignment'
import type { MatchOptions } from '@shared/api'
import { gameTitle } from '@shared/labels'
import { extensionOf, matchClips, pickedPaths, PLAYABLE_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/matching'
import { addToTally, emptyTally, gradeScore, mergeTally, teamEpa, teamSuccess } from '@shared/stats'
import { DEFENSE_GROUPS, OFFENSE_GROUPS, POSITION_GROUPS, positionGroup, TEAM_BY_ABBR, TEAMS } from '@shared/teams'
import type {
  AlignmentResult,
  Clip,
  ClipMatchRow,
  DataProgress,
  FilmLibraryItem,
  GameFilm,
  GameInfo,
  GradeEntry,
  GradeTally,
  LeaderRow,
  MatchPreview,
  MatchupData,
  MatchupSide,
  Play,
  PlayerGameLine,
  PlayerProfile,
  PlayerSeasonLine,
  PlayNote,
  PositionGroup,
  RecentFilm,
  RecentPlayer,
  ReelItem,
  RosterPlayer,
  SearchIndex,
  SeasonStatus,
  SidebarBadges,
  TeamCard,
  TeamFilmStats,
  TeamGame,
  TeamOverview,
  TeamRosterRow,
  TeamSummary,
  UnitGameLine,
  UnitKey
} from '@shared/types'
import { convertedFrom, findConverted } from './convert'
import type { Store } from './db'
import { changed } from './events'
import { probeAll } from './ffmpeg'
import {
  cachedSeasons,
  downloadSeason,
  type Fetcher,
  loadGamePlays,
  loadSeason,
  type SeasonData,
  seasonStatuses
} from './nflverse'

/** Stats that are rates, so they're averaged instead of summed in season totals. */
const RATE_STATS = new Set(['passing_cpoe', 'target_share'])

const FIRST_SEASON = 2016

/** Seasons kept loaded at once (03 §2.2.4); loading a fifth evicts the least recently used. */
export const SEASON_LRU = 4

export function currentSeason(now = new Date()): number {
  // The NFL season starts in September; January–August still belong to last year's season.
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

/** A game id's parts, for games whose season isn't downloaded: "2025_01_DAL_PHI". */
export function gameFromId(gameId: string): GameInfo {
  const [season, week, away, home] = gameId.split('_')
  return {
    gameId,
    season: Number(season),
    week: Number(week),
    gameType: Number(week) > 18 ? 'POST' : 'REG',
    gameday: '',
    homeTeam: home ?? '',
    awayTeam: away ?? '',
    homeScore: null,
    awayScore: null
  }
}

const seasonOf = (gameId: string) => Number(gameId.slice(0, 4))
const unitOf = (g: PositionGroup): UnitKey[] => (OFFENSE_GROUPS.includes(g) ? [g, 'OFF'] : DEFENSE_GROUPS.includes(g) ? [g, 'DEF'] : [g])
const addUnit = (units: Partial<Record<UnitKey, GradeTally>>, group: PositionGroup, e: GradeEntry) => {
  for (const u of unitOf(group)) addToTally((units[u] ??= emptyTally()), e.grade, e.critical)
}
const ANGLE_POSTER: Clip['angle'][] = ['sideline', 'main', 'endzone']

/** Lowercase, punctuation and suffixes (Jr, Sr, II–V) removed, for matching a player across seasons by name. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(w))
    .join(' ')
}

/** The app's brain: joins nflverse data with the user's clips and grades. Has no Electron dependency so it can be tested directly. */
export class Library {
  private seasons = new Map<number, SeasonData>()
  private playsCache = new Map<string, Play[]>()
  private downloads = new Map<number, Promise<SeasonStatus>>()

  constructor(
    readonly store: Store,
    readonly cacheDir: string,
    private fetcher: Fetcher,
    /** Where MP4 copies of clips in other formats are kept, one folder per game. */
    readonly convertedRoot: string = join(cacheDir, '..', 'converted')
  ) {}

  convertedDir(gameId: string): string {
    return join(this.convertedRoot, gameId)
  }

  availableSeasons(): number[] {
    const out: number[] = []
    for (let s = currentSeason(); s >= FIRST_SEASON; s--) out.push(s)
    return out
  }

  seasonStatuses(): Promise<SeasonStatus[]> {
    return seasonStatuses(this.cacheDir, this.availableSeasons())
  }

  /** Seasons whose data is on disk in the current format, newest first. */
  async downloadedSeasons(): Promise<number[]> {
    const statuses = await seasonStatuses(this.cacheDir, await cachedSeasons(this.cacheDir))
    return statuses.filter((s) => s.downloaded).map((s) => s.season).sort((a, b) => b - a)
  }

  /** Downloads a season; a second request while one is running joins it instead of starting over. */
  downloadSeason(season: number, onProgress: (p: DataProgress) => void): Promise<SeasonStatus> {
    let running = this.downloads.get(season)
    if (!running) {
      running = this.runDownload(season, onProgress).finally(() => this.downloads.delete(season))
      this.downloads.set(season, running)
    }
    return running
  }

  isDownloading(season: number): boolean {
    return this.downloads.has(season)
  }

  private async runDownload(season: number, onProgress: (p: DataProgress) => void): Promise<SeasonStatus> {
    await downloadSeason(season, this.cacheDir, this.fetcher, onProgress)
    this.seasons.delete(season)
    for (const key of this.playsCache.keys()) if (key.startsWith(`${season}_`)) this.playsCache.delete(key)
    const [status] = await seasonStatuses(this.cacheDir, [season])
    return status
  }

  /** A loaded season; at most SEASON_LRU stay in memory. */
  async season(season: number): Promise<SeasonData> {
    let data = this.seasons.get(season)
    if (data) {
      // Most recently used goes last.
      this.seasons.delete(season)
      this.seasons.set(season, data)
      return data
    }
    const loaded = await loadSeason(this.cacheDir, season)
    if (!loaded) throw new Error(`The ${season} season hasn't been downloaded yet, or was saved by an older version of the app. Download it again from the home screen.`)
    data = loaded
    this.seasons.set(season, data)
    while (this.seasons.size > SEASON_LRU) this.seasons.delete(this.seasons.keys().next().value!)
    return data
  }

  /** Loaded seasons, least recently used first (for tests). */
  loadedSeasons(): number[] {
    return [...this.seasons.keys()]
  }

  async seasonOrNull(season: number): Promise<SeasonData | null> {
    return this.season(season).catch(() => null)
  }

  async plays(gameId: string): Promise<Play[]> {
    let plays = this.playsCache.get(gameId)
    if (!plays) {
      plays = await loadGamePlays(this.cacheDir, gameId)
      this.playsCache.set(gameId, plays)
      if (this.playsCache.size > 60) this.playsCache.delete(this.playsCache.keys().next().value!)
    }
    return plays
  }

  /** Plays that are real snaps or no-plays (no timeouts or quarter ends). */
  async filmPlays(gameId: string): Promise<Play[]> {
    return (await this.plays(gameId)).filter((p) => p.playType !== '')
  }

  private indexCache = new WeakMap<SeasonData, Map<string, RosterPlayer>>()

  playerIndex(data: SeasonData): Map<string, RosterPlayer> {
    const hit = this.indexCache.get(data)
    if (hit) return hit
    const map = new Map<string, RosterPlayer>()
    for (const e of data.extraPlayers) {
      map.set(e.id, {
        id: e.id,
        name: e.name,
        team: e.team,
        position: e.position,
        depthPos: e.position,
        group: positionGroup(e.position),
        jersey: e.jersey,
        status: '',
        headshot: '',
        college: '',
        height: '',
        weight: '',
        yearsExp: ''
      })
    }
    for (const p of data.roster) map.set(p.id, p)
    this.indexCache.set(data, map)
    return map
  }

  private stubPlayer(id: string, team = ''): RosterPlayer {
    return { id, name: id, team, position: '', depthPos: '', group: 'ST', jersey: '', status: '', headshot: '', college: '', height: '', weight: '', yearsExp: '' }
  }

  gameById(data: SeasonData, gameId: string): GameInfo {
    const g = data.games.find((x) => x.gameId === gameId)
    if (!g) throw new Error(`Unknown game ${gameId}`)
    return g
  }

  /** The game, from its season when downloaded, else from its id. */
  async gameInfo(gameId: string): Promise<GameInfo> {
    const data = await this.seasonOrNull(seasonOf(gameId))
    return data?.games.find((g) => g.gameId === gameId) ?? gameFromId(gameId)
  }

  async teamSummaries(season: number): Promise<TeamSummary[]> {
    return (await this.season(season)).teams
  }

  /** A team's games of the season with film and grading progress, in date order. */
  async teamGames(season: number, abbr: string): Promise<TeamGame[]> {
    const data = await this.season(season)
    const games = data.games
      .filter((g) => g.homeTeam === abbr || g.awayTeam === abbr)
      .sort((a, b) => a.gameday.localeCompare(b.gameday) || a.week - b.week)
    const gameIds = games.map((g) => g.gameId)
    const clipCounts = this.store.clipCounts(gameIds)
    const graded = this.store.gradedPlayCounts(gameIds, abbr)
    return Promise.all(
      games.map(async (g) => ({
        ...g,
        clipCount: clipCounts.get(g.gameId) ?? 0,
        playCount: (await this.filmPlays(g.gameId)).length,
        gradedPlays: graded.get(g.gameId) ?? 0
      }))
    )
  }

  /** Teams a player played for in a season, by first game. */
  private playerTeams(data: SeasonData, playerId: string): { team: string; firstWeek: number; lastWeek: number }[] {
    const byGame = new Map<string, string>()
    for (const [gameId, s] of Object.entries(data.snaps[playerId] ?? {})) byGame.set(gameId, s.team)
    for (const w of data.playerWeeks) if (w.playerId === playerId && w.team && !byGame.has(w.gameId)) byGame.set(w.gameId, w.team)
    const games = new Map(data.games.map((g) => [g.gameId, g]))
    const rows = [...byGame]
      .map(([gameId, team]) => ({ team, game: games.get(gameId) }))
      .filter((r): r is { team: string; game: GameInfo } => !!r.game)
      .sort((a, b) => a.game.gameday.localeCompare(b.game.gameday) || a.game.week - b.game.week)
    const out: { team: string; firstWeek: number; lastWeek: number }[] = []
    for (const r of rows) {
      const last = out[out.length - 1]
      if (last && last.team === r.team) last.lastWeek = r.game.week
      else if (!out.some((o) => o.team === r.team)) out.push({ team: r.team, firstWeek: r.game.week, lastWeek: r.game.week })
      else out.find((o) => o.team === r.team)!.lastWeek = r.game.week
    }
    return out
  }

  async teamOverview(season: number, abbr: string): Promise<TeamOverview> {
    const data = await this.season(season)
    const team = TEAM_BY_ABBR[abbr]
    if (!team) throw new Error(`Unknown team ${abbr}`)
    const teamGames = await this.teamGames(season, abbr)
    const index = this.playerIndex(data)
    const grades = this.store.gradesForTeam(abbr, season)

    const tallies = new Map<string, GradeTally>()
    for (const g of grades) addToTally(tallies.get(g.playerId) ?? tallies.set(g.playerId, emptyTally()).get(g.playerId)!, g.grade, g.critical)
    const snapsFor = (id: string) => {
      let n = 0
      for (const s of Object.values(data.snaps[id] ?? {})) if (s.team === abbr) n += s.offense + s.defense + s.special
      return n
    }

    const ids = new Set<string>()
    for (const p of data.roster) if (p.team === abbr && p.status !== 'CUT' && p.status !== 'RET') ids.add(p.id)
    const rosterIds = new Set(data.roster.map((p) => p.id))
    for (const e of data.extraPlayers) if (e.team === abbr && !rosterIds.has(e.id)) ids.add(e.id)
    // Players who played for the team before a trade or release.
    for (const [id, games] of Object.entries(data.snaps)) if (Object.values(games).some((s) => s.team === abbr)) ids.add(id)
    for (const w of data.playerWeeks) if (w.team === abbr) ids.add(w.playerId)
    for (const id of tallies.keys()) ids.add(id)

    const roster: TeamRosterRow[] = [...ids]
      .map((id) => index.get(id))
      .filter((p): p is RosterPlayer => !!p)
      .map((p) => ({ ...p, snaps: snapsFor(p.id), tally: tallies.get(p.id) ?? emptyTally(), teams: this.playerTeams(data, p.id).map((t) => t.team) }))
      .sort(
        (a, b) =>
          POSITION_GROUPS.indexOf(a.group) - POSITION_GROUPS.indexOf(b.group) ||
          b.snaps - a.snaps ||
          a.name.localeCompare(b.name)
      )

    // Unit grades by game, per-player game grades and EPA on graded plays.
    const gameOrder = new Map(teamGames.map((g, i) => [g.gameId, i]))
    const byGame = new Map<string, GradeEntry[]>()
    for (const g of grades) byGame.set(g.gameId, [...(byGame.get(g.gameId) ?? []), g])
    const unitsByGame: UnitGameLine[] = []
    const rosterTrend: Record<string, { gameId: string; grade: number }[]> = {}
    const epaSum = new Map<string, { sum: number; n: number }>()
    for (const game of teamGames.filter((g) => byGame.has(g.gameId))) {
      const entries = byGame.get(game.gameId)!
      const units: Partial<Record<UnitKey, GradeTally>> = {}
      const perPlayer = new Map<string, GradeTally>()
      const plays = new Map((await this.plays(game.gameId)).map((p) => [p.playId, p]))
      for (const e of entries) {
        if (e.grade === null) continue
        addUnit(units, (index.get(e.playerId) ?? this.stubPlayer(e.playerId)).group, e)
        addToTally(perPlayer.get(e.playerId) ?? perPlayer.set(e.playerId, emptyTally()).get(e.playerId)!, e.grade, e.critical)
        const play = plays.get(e.playId)
        const epa = play ? teamEpa(play, abbr) : null
        if (epa !== null) {
          const acc = epaSum.get(e.playerId) ?? epaSum.set(e.playerId, { sum: 0, n: 0 }).get(e.playerId)!
          acc.sum += epa
          acc.n++
        }
      }
      if (Object.keys(units).length) {
        unitsByGame.push({
          gameId: game.gameId,
          week: game.week,
          gameType: game.gameType,
          opponent: game.homeTeam === abbr ? game.awayTeam : game.homeTeam,
          home: game.homeTeam === abbr,
          units
        })
      }
      for (const [id, t] of perPlayer) (rosterTrend[id] ??= []).push({ gameId: game.gameId, grade: gradeScore(t)! })
    }
    unitsByGame.sort((a, b) => gameOrder.get(a.gameId)! - gameOrder.get(b.gameId)!)
    const rosterEpa: Record<string, number | null> = {}
    for (const id of tallies.keys()) {
      const acc = epaSum.get(id)
      rosterEpa[id] = acc && acc.n ? acc.sum / acc.n : null
    }

    return {
      team,
      season,
      summary: data.teams.find((t) => t.team === abbr) ?? null,
      games: teamGames,
      roster,
      unitsByGame,
      rosterTrend,
      rosterEpa,
      hasParticipation: data.meta.hasParticipation
    }
  }

  async gameFilm(gameId: string): Promise<GameFilm> {
    const season = seasonOf(gameId)
    const data = await this.season(season)
    const game = this.gameById(data, gameId)
    const plays = await this.filmPlays(gameId)
    const index = this.playerIndex(data)
    const players: Record<string, RosterPlayer> = {}
    for (const p of index.values()) if (p.team === game.homeTeam || p.team === game.awayTeam) players[p.id] = p
    for (const play of plays) {
      for (const id of [...play.offensePlayers, ...play.defensePlayers, ...play.involved]) {
        const p = index.get(id)
        if (p) players[id] = p
      }
    }
    // Players who changed teams during the season are listed with the side they played for in this game.
    const sides = new Map<string, string>()
    for (const w of data.playerWeeks) if (w.gameId === gameId) sides.set(w.playerId, w.team)
    for (const play of plays) {
      for (const id of play.offensePlayers) sides.set(id, play.posteam)
      for (const id of play.defensePlayers) sides.set(id, play.defteam)
    }
    for (const [id, team] of sides) {
      const p = players[id] ?? index.get(id)
      if (p && (team === game.homeTeam || team === game.awayTeam)) players[id] = { ...p, team }
    }
    return {
      game,
      plays,
      clips: this.store.clipsForGame(gameId),
      grades: this.store.gradesForGame(gameId),
      notes: this.store.notesForGame(gameId),
      players,
      hasParticipation: plays.some((p) => p.offensePlayers.length > 0)
    }
  }

  async previewMatch(gameId: string, paths: string[], options: MatchOptions = {}): Promise<MatchPreview> {
    const files = await expandVideoFiles(paths)
    const outDir = this.convertedDir(gameId)
    const isCopy = (f: string) => f.startsWith(outDir + sep)
    // Saved copies (when fixing matches) are read as the clips they were made from, so they come out as on import.
    const originals = new Map<string, string>()
    const near = files.filter((f) => !isCopy(f))
    for (const f of files.filter(isCopy)) {
      const original = await convertedFrom(f, outDir, near)
      if (original) originals.set(f, original)
    }
    const traced = (f: string) => !isCopy(f) || originals.has(f)
    const original = (f: string) => originals.get(f) ?? f
    // Angles and order are read only from the folders the user picked, never the ones above.
    const picked = pickedPaths(paths.filter(traced).map(original), files.filter(traced).map(original))
    // A copy that can't be traced goes by the source folders kept under its hash.
    const names = new Map(files.map((f): [string, string] => [f, picked.get(original(f)) ?? relative(outDir, f).split(sep).slice(1).join('/')]))
    const playable = files.filter((f) => PLAYABLE_EXTENSIONS.includes(extensionOf(f)))
    const unsupported: string[] = []
    // Clips already converted to MP4 stand in for their originals, and are placed by the original's path.
    for (const f of files.filter((f) => !PLAYABLE_EXTENSIONS.includes(extensionOf(f)))) {
      const copy = await findConverted(f, outDir)
      if (!copy) {
        unsupported.push(f)
        continue
      }
      playable.push(copy)
      names.set(copy, names.get(f) ?? f)
    }
    const plays = await this.filmPlays(gameId)
    const result = matchClips(playable, plays, options, (p) => names.get(p) ?? p)
    const warnings = [...result.warnings]
    if (!plays.length) warnings.unshift('No play-by-play for this game yet, so clips can’t be matched to plays.')
    return {
      gameId,
      rows: result.rows,
      plays,
      includeSpecialTeams: result.includeSpecialTeams,
      includeNoPlays: result.includeNoPlays,
      unsupported,
      warnings
    }
  }

  /**
   * Saves a game's clips (keeping snap points by path), adds the team to My Teams the first time, then reads clip
   * lengths and runs the alignment check in the background of the call. Returns the check's result.
   */
  async importClips(gameId: string, team: string, rows: ClipMatchRow[], source: 'manual' | 'watch' = 'manual'): Promise<AlignmentResult | null> {
    this.store.replaceClips(gameId, rows)
    this.store.touchFilm(gameId, team, false, source)
    this.addMyTeam(team)
    return this.checkAlignment(gameId).catch(() => null)
  }

  /** Adds a team to My Teams the first time film is imported or a player graded, unless the user removed it before. */
  addMyTeam(team: string) {
    if (!TEAM_BY_ABBR[team]) return
    const s = this.store.settings()
    if (s.myTeams.includes(team) || s.myTeamsRemoved.includes(team)) return
    this.store.saveSettings({ myTeams: [...s.myTeams, team] })
    changed('settings')
  }

  /** Reads missing clip lengths for a game, runs the alignment check and stores the result. */
  async checkAlignment(gameId: string): Promise<AlignmentResult> {
    let clips = this.store.clipsForGame(gameId)
    const missing = clips.filter((c) => c.duration === null).map((c) => c.path)
    if (missing.length) {
      const probes = await probeAll(missing)
      this.store.setClipDurations(gameId, new Map(missing.map((p) => [p, probes.get(p)?.duration ?? null])))
      clips = this.store.clipsForGame(gameId)
    }
    const result = runAlignment(
      gameId,
      clips.map((c) => ({ clipId: c.id, path: c.path, angle: c.angle, playId: c.playId, duration: c.duration })),
      await this.filmPlays(gameId)
    )
    this.store.saveAlignment(gameId, result)
    return result
  }

  /** The alignment check on rows not saved yet (import and Fix Clip Matches sheets). */
  async checkAlignmentRows(gameId: string, rows: ClipMatchRow[]): Promise<AlignmentResult> {
    const probes = await probeAll(rows.map((r) => r.path))
    const saved = new Map(this.store.clipsForGame(gameId).map((c) => [c.path, c.id]))
    const clips: AlignmentClip[] = rows.map((r) => ({ clipId: saved.get(r.path) ?? null, path: r.path, angle: r.angle, playId: r.playId, duration: probes.get(r.path)?.duration ?? null }))
    return runAlignment(gameId, clips, await this.filmPlays(gameId))
  }

  /** The first play in play order with a clip and no grade for `team`, and a poster for it. */
  private resumeFor(plays: Play[], clips: Clip[], grades: GradeEntry[], team: string): { resumePlayId: number | null; poster: RecentFilm['poster'] } {
    const graded = new Set(grades.filter((g) => g.team === team && g.grade !== null).map((g) => g.playId))
    const withClip = new Set(clips.map((c) => c.playId))
    const ordered = [...plays].sort((a, b) => a.playId - b.playId)
    const resume = ordered.find((p) => withClip.has(p.playId) && !graded.has(p.playId)) ?? null
    const posterPlay = resume ?? ordered.find((p) => withClip.has(p.playId)) ?? null
    let poster: RecentFilm['poster'] = null
    if (posterPlay) {
      const forPlay = clips.filter((c) => c.playId === posterPlay.playId)
      const clip = ANGLE_POSTER.map((a) => forPlay.find((c) => c.angle === a)).find(Boolean)
      if (clip) poster = { clipId: clip.id, at: (clip.snapMs ?? 0) / 1000 }
    }
    return { resumePlayId: resume?.playId ?? null, poster }
  }

  private async filmEntry(gameId: string, team: string, openedAt: string | null): Promise<RecentFilm> {
    const game = await this.gameInfo(gameId)
    const plays = await this.filmPlays(gameId)
    const clips = this.store.clipsForGame(gameId)
    const grades = this.store.gradesForGame(gameId)
    const { resumePlayId, poster } = this.resumeFor(plays, clips, grades, team)
    return {
      game,
      team,
      clipCount: clips.length,
      playCount: plays.length,
      gradedPlays: new Set(grades.filter((g) => g.team === team && g.grade !== null).map((g) => g.playId)).size,
      resumePlayId,
      poster,
      openedAt
    }
  }

  async recentFilm(): Promise<RecentFilm[]> {
    const out: RecentFilm[] = []
    for (const { gameId, team, openedAt } of this.store.recentFilm()) {
      const data = await this.seasonOrNull(seasonOf(gameId))
      if (!data?.games.some((g) => g.gameId === gameId)) continue
      out.push(await this.filmEntry(gameId, team, openedAt))
    }
    return out
  }

  /** Every game with film, all seasons, newest game first. */
  async filmLibrary(): Promise<FilmLibraryItem[]> {
    const out: FilmLibraryItem[] = []
    for (const f of this.store.filmGames()) {
      const entry = await this.filmEntry(f.gameId, f.team, f.openedAt)
      const clips = this.store.clipsForGame(f.gameId)
      out.push({
        ...entry,
        importedAt: f.importedAt,
        source: f.source,
        angles: (['sideline', 'endzone', 'main'] as const).filter((a) => clips.some((c) => c.angle === a)),
        suspectClips: this.store.alignment(f.gameId)?.suspects.length ?? null
      })
    }
    return out.sort((a, b) => (b.game.gameday || b.game.gameId).localeCompare(a.game.gameday || a.game.gameId))
  }

  saveGrade(entry: GradeEntry) {
    this.store.saveGrade(entry)
    if (entry.grade !== null) this.addMyTeam(entry.team)
  }

  savePlayNote(note: PlayNote) {
    this.store.savePlayNote(note)
  }

  /** Season totals from weekly box scores (rates averaged, longest field goal kept as a max), plus snaps. */
  private totalsFor(weeks: SeasonData['playerWeeks'], snaps: { offense: number; defense: number; special: number }[]): Record<string, number> {
    const totals: Record<string, number> = {}
    const rateCounts: Record<string, number> = {}
    for (const w of weeks) {
      for (const [k, v] of Object.entries(w.stats)) {
        totals[k] = (totals[k] ?? 0) + v
        if (RATE_STATS.has(k)) rateCounts[k] = (rateCounts[k] ?? 0) + 1
      }
    }
    for (const k of Object.keys(rateCounts)) totals[k] = totals[k] / rateCounts[k]
    if (totals.fg_long) totals.fg_long = Math.max(...weeks.map((w) => w.stats.fg_long ?? 0))
    const totalSnaps = snaps.reduce((n, s) => n + s.offense + s.defense + s.special, 0)
    if (totalSnaps) totals.snaps = totalSnaps
    return totals
  }

  async playerProfile(season: number, playerId: string): Promise<PlayerProfile | null> {
    const data = await this.season(season)
    const player = this.playerIndex(data).get(playerId)
    if (!player) return null

    const grades = this.store.gradesForPlayer(playerId, season)
    const weeks = data.playerWeeks.filter((w) => w.playerId === playerId)
    const snaps = data.snaps[playerId] ?? {}
    const gameIds = new Set([...weeks.map((w) => w.gameId), ...Object.keys(snaps), ...grades.map((g) => g.gameId)])
    const games = data.games.filter((g) => gameIds.has(g.gameId)).sort((a, b) => a.gameday.localeCompare(b.gameday))

    const tally = emptyTally()
    const tagCounts = new Map<string, number>()
    for (const g of grades) {
      addToTally(tally, g.grade, g.critical)
      for (const t of g.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
    }

    const lines: PlayerGameLine[] = games.map((game) => {
      const week = weeks.find((w) => w.gameId === game.gameId)
      const team =
        week?.team ??
        snaps[game.gameId]?.team ??
        grades.find((g) => g.gameId === game.gameId)?.team ??
        (player.team === game.awayTeam ? game.awayTeam : game.homeTeam)
      const opponent = team === game.homeTeam ? game.awayTeam : game.homeTeam
      const gameTally = emptyTally()
      for (const g of grades) if (g.gameId === game.gameId) addToTally(gameTally, g.grade, g.critical)
      return { game, team, opponent, snaps: snaps[game.gameId] ?? null, stats: week?.stats ?? {}, tally: gameTally }
    })
    const totals = this.totalsFor(
      weeks.filter((w) => games.some((g) => g.gameId === w.gameId)),
      lines.map((l) => l.snaps).filter((s): s is NonNullable<typeof s> => !!s)
    )

    const reel: ReelItem[] = []
    for (const gameId of [...new Set(grades.map((g) => g.gameId))]) {
      const plays = await this.plays(gameId)
      const clips = this.store.clipsForGame(gameId)
      const notes = new Map(this.store.notesForGame(gameId).map((n) => [n.playId, n]))
      const line = lines.find((l) => l.game.gameId === gameId)
      for (const g of grades.filter((x) => x.gameId === gameId)) {
        const play = plays.find((p) => p.playId === g.playId) ?? null
        const note = notes.get(g.playId)
        reel.push({
          gameId,
          team: g.team,
          playId: g.playId,
          week: line?.game.week ?? 0,
          opponent: line?.opponent ?? '',
          play,
          clips: clips.filter((c) => c.playId === g.playId),
          grade: g.grade,
          tags: g.tags,
          note: g.note,
          critical: g.critical,
          flagged: note?.flagged ?? false,
          playNote: note?.note ?? '',
          teamEpa: play ? teamEpa(play, g.team) : null,
          teamSuccess: play ? teamSuccess(play, g.team) : null,
          chart: note?.chart ?? {},
          drawing: note?.drawing ?? null
        })
      }
    }

    return {
      player,
      season,
      totals,
      games: lines,
      tally,
      tagCounts: [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
      reel,
      teams: this.playerTeams(data, playerId),
      hasParticipation: data.meta.hasParticipation
    }
  }

  /**
   * One season of a player's career (03 §6.6): matched by id (roster, extra players, box scores, snaps or grades),
   * else by normalized name and position group when exactly one roster entry fits.
   */
  async playerSeasonLine(season: number, playerId: string, hint?: { name: string; group: PositionGroup }): Promise<PlayerSeasonLine | null> {
    const data = await this.seasonOrNull(season)
    if (!data) return null
    const index = this.playerIndex(data)
    let id = playerId
    let matchedBy: PlayerSeasonLine['matchedBy'] = 'id'
    const appears = (pid: string) =>
      index.has(pid) || data.playerWeeks.some((w) => w.playerId === pid) || !!data.snaps[pid] || this.store.gradesForPlayer(pid, season).length > 0
    if (!appears(id)) {
      if (!hint) return null
      const want = normalizeName(hint.name)
      const found = data.roster.filter((p) => normalizeName(p.name) === want && p.group === hint.group)
      const unique = [...new Map(found.map((p) => [p.id, p])).values()]
      if (unique.length !== 1) return null
      id = unique[0].id
      matchedBy = 'name'
    }
    const player = index.get(id) ?? { ...this.stubPlayer(id), name: hint?.name ?? id, group: hint?.group ?? 'ST' }
    const weeks = data.playerWeeks.filter((w) => w.playerId === id)
    const snaps = data.snaps[id] ?? {}
    const grades = this.store.gradesForPlayer(id, season)
    const gameIds = new Set([...weeks.map((w) => w.gameId), ...Object.keys(snaps)])
    const tally = emptyTally()
    for (const g of grades) addToTally(tally, g.grade, g.critical)
    const gamesById = new Map(data.games.map((g) => [g.gameId, g]))
    const perGame = new Map<string, GradeTally>()
    for (const g of grades) addToTally(perGame.get(g.gameId) ?? perGame.set(g.gameId, emptyTally()).get(g.gameId)!, g.grade, g.critical)
    const teamIn = new Map(grades.map((g) => [g.gameId, g.team]))
    const byGame = [...perGame]
      .filter(([, t]) => t.graded)
      .map(([gameId, t]) => {
        const game = gamesById.get(gameId)
        const team = teamIn.get(gameId) ?? ''
        const opponent = game ? (game.homeTeam === team ? game.awayTeam : game.homeTeam) : ''
        return { gameId, week: game?.week ?? 0, grade: gradeScore(t)!, plays: t.graded, opponent, gameType: game?.gameType ?? 'REG', home: game?.homeTeam === team, day: game?.gameday ?? '' }
      })
      .sort((a, b) => a.day.localeCompare(b.day) || a.week - b.week)
      .map(({ day: _day, ...r }) => r)
    return {
      season,
      player,
      matchedBy,
      teams: this.playerTeams(data, id).map((t) => t.team),
      games: gameIds.size,
      snaps: Object.values(snaps).reduce((n, s) => n + s.offense + s.defense + s.special, 0),
      totals: this.totalsFor(weeks, Object.values(snaps)),
      tally,
      byGame
    }
  }

  /** Players by their newest grade (Home › Recently Graded). */
  async recentlyGraded(limit: number): Promise<RecentPlayer[]> {
    const out: RecentPlayer[] = []
    for (const r of this.store.recentlyGradedPlayers(limit)) {
      const data = await this.seasonOrNull(r.season)
      const p = data ? this.playerIndex(data).get(r.playerId) : undefined
      out.push({
        playerId: r.playerId,
        season: r.season,
        name: p?.name ?? r.playerId,
        team: p?.team || r.team,
        position: p ? p.depthPos || p.position : '',
        headshot: p?.headshot ?? '',
        tally: (() => {
          const t = emptyTally()
          for (const g of this.store.gradesForPlayer(r.playerId, r.season)) addToTally(t, g.grade, g.critical)
          return t
        })(),
        lastGradedAt: r.at
      })
    }
    return out
  }

  async teamFilmStats(season: number): Promise<Record<string, TeamFilmStats>> {
    const out: Record<string, TeamFilmStats> = {}
    for (const t of TEAMS) out[t.abbr] = { gamesWithFilm: 0, playCount: 0, gradedPlays: 0 }
    const data = await this.season(season)
    const gameIds = data.games.map((g) => g.gameId)
    const clips = this.store.clipCounts(gameIds)
    for (const g of data.games) {
      if (!clips.get(g.gameId)) continue
      const plays = (await this.filmPlays(g.gameId)).length
      for (const team of [g.homeTeam, g.awayTeam]) {
        const s = out[team]
        if (!s) continue
        s.gamesWithFilm++
        s.playCount += plays
        s.gradedPlays += this.store.gradedPlayCounts([g.gameId], team).get(g.gameId) ?? 0
      }
    }
    return out
  }

  async teamCards(season: number, abbrs: string[]): Promise<TeamCard[]> {
    const data = await this.season(season)
    const stats = await this.teamFilmStats(season)
    return abbrs.map((abbr) => {
      const s = data.teams.find((t) => t.team === abbr)
      const games = data.games.filter((g) => g.homeTeam === abbr || g.awayTeam === abbr).sort((a, b) => a.gameday.localeCompare(b.gameday))
      const played = games.filter((g) => g.homeScore !== null)
      return {
        team: abbr,
        wins: s?.wins ?? 0,
        losses: s?.losses ?? 0,
        ties: s?.ties ?? 0,
        nextGame: games.find((g) => g.homeScore === null) ?? null,
        lastGame: played[played.length - 1] ?? null,
        ...(stats[abbr] ?? { gamesWithFilm: 0, playCount: 0, gradedPlays: 0 })
      }
    })
  }

  /** Every player of one position group with at least one graded play this season, one row each (traded players too). */
  async leaderboard(season: number, group: PositionGroup): Promise<LeaderRow[]> {
    const data = await this.season(season)
    const index = this.playerIndex(data)
    const gamesById = new Map(data.games.map((g) => [g.gameId, g]))
    const byPlayer = new Map<string, GradeEntry[]>()
    for (const g of this.store.gradesForSeason(season)) {
      if (g.grade === null) continue
      const p = index.get(g.playerId)
      if ((p?.group ?? 'ST') !== group) continue
      byPlayer.set(g.playerId, [...(byPlayer.get(g.playerId) ?? []), g])
    }
    const rows: LeaderRow[] = []
    for (const [playerId, entries] of byPlayer) {
      const player = index.get(playerId) ?? this.stubPlayer(playerId)
      const day = (gameId: string) => gamesById.get(gameId)?.gameday ?? gameId
      const games = [...new Set(entries.map((e) => e.gameId))].sort((a, b) => day(a).localeCompare(day(b)))
      const teams: string[] = []
      for (const gid of games) for (const e of entries) if (e.gameId === gid && !teams.includes(e.team)) teams.push(e.team)
      const tally = emptyTally()
      const tags = new Map<string, number>()
      let epaSum = 0
      let epaN = 0
      const perGame = new Map<string, { tally: GradeTally; epaSum: number; epaPlays: number }>()
      for (const gid of games) perGame.set(gid, { tally: emptyTally(), epaSum: 0, epaPlays: 0 })
      for (const e of entries) {
        addToTally(tally, e.grade, e.critical)
        for (const t of e.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
        const pg = perGame.get(e.gameId)!
        addToTally(pg.tally, e.grade, e.critical)
        const play = (await this.plays(e.gameId)).find((p) => p.playId === e.playId)
        const epa = play ? teamEpa(play, e.team) : null
        if (epa !== null) {
          epaSum += epa
          epaN++
          pg.epaSum += epa
          pg.epaPlays++
        }
      }
      rows.push({
        player,
        teams,
        games: games.length,
        snaps: Object.values(data.snaps[playerId] ?? {}).reduce((n, s) => n + s.offense + s.defense + s.special, 0),
        tally,
        epa: epaN ? epaSum / epaN : null,
        byGame: games.map((gid) => ({ gameId: gid, week: gamesById.get(gid)?.week ?? 0, grade: gradeScore(perGame.get(gid)!.tally)! })),
        lastGames: [...games].reverse().map((gid) => ({ gameId: gid, ...perGame.get(gid)! })),
        topTags: [...tags].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 3)
      })
    }
    return rows.sort((a, b) => (gradeScore(b.tally) ?? 0) - (gradeScore(a.tally) ?? 0) || b.tally.graded - a.tally.graded || a.player.name.localeCompare(b.player.name))
  }

  private async matchupSide(data: SeasonData, abbr: string): Promise<MatchupSide> {
    const team = TEAM_BY_ABBR[abbr]
    if (!team) throw new Error(`Unknown team ${abbr}`)
    const index = this.playerIndex(data)
    const units: Partial<Record<UnitKey, GradeTally>> = {}
    const tallies = new Map<string, GradeTally>()
    for (const e of this.store.gradesForTeam(abbr, data.season)) {
      if (e.grade === null) continue
      const p = index.get(e.playerId) ?? this.stubPlayer(e.playerId, abbr)
      addUnit(units, p.group, e)
      addToTally(tallies.get(e.playerId) ?? tallies.set(e.playerId, emptyTally()).get(e.playerId)!, e.grade, e.critical)
    }
    const players = [...tallies]
      .map(([id, tally]) => ({ player: index.get(id) ?? this.stubPlayer(id, abbr), tally }))
      .sort((a, b) => (gradeScore(b.tally) ?? 0) - (gradeScore(a.tally) ?? 0) || b.tally.graded - a.tally.graded)

    // Stat leaders from regular-season box scores for this team.
    const sums = new Map<string, Record<string, number>>()
    for (const w of data.playerWeeks) {
      if (w.team !== abbr || w.seasonType !== 'REG') continue
      const s = sums.get(w.playerId) ?? sums.set(w.playerId, {}).get(w.playerId)!
      for (const [k, v] of Object.entries(w.stats)) s[k] = (s[k] ?? 0) + v
      s.tackles = (s.def_tackles_solo ?? 0) + (s.def_tackle_assists ?? 0)
    }
    const top = (key: string, label: string, n = 1) =>
      [...sums]
        .filter(([, s]) => (s[key] ?? 0) > 0)
        .sort((a, b) => b[1][key] - a[1][key])
        .slice(0, n)
        .map(([id, s]) => ({ key, label, player: index.get(id) ?? this.stubPlayer(id, abbr), value: s[key] }))
    const statLeaders = [
      ...top('passing_yards', 'pass yds'),
      ...top('rushing_yards', 'rush yds'),
      ...top('receiving_yards', 'rec yds', 2),
      ...top('def_sacks', 'sacks'),
      ...top('tackles', 'tackles'),
      ...top('def_interceptions', 'INT'),
      ...top('def_pass_defended', 'PD')
    ]
    const games = await this.teamGames(data.season, abbr)
    return {
      team,
      summary: data.teams.find((t) => t.team === abbr) ?? null,
      units,
      players,
      statLeaders,
      film: { gamesPlayed: games.filter((g) => g.homeScore !== null).length, withFilm: games.filter((g) => g.clipCount > 0).reverse() }
    }
  }

  async matchup(season: number, left: string, right: string): Promise<MatchupData> {
    const data = await this.season(season)
    const studied = this.store.studiedTeams()
    const meetings: MatchupData['meetings'] = []
    for (const s of await this.downloadedSeasons()) {
      const d = s === season ? data : await this.seasonOrNull(s)
      if (!d) continue
      for (const g of d.games) {
        if (!((g.homeTeam === left && g.awayTeam === right) || (g.homeTeam === right && g.awayTeam === left))) continue
        const team = studied.get(g.gameId) ?? null
        meetings.push({
          game: g,
          clipCount: this.store.clipCounts([g.gameId]).get(g.gameId) ?? 0,
          gradedPlays: team ? this.store.gradedPlayCounts([g.gameId], team).get(g.gameId) ?? 0 : 0,
          studiedTeam: team
        })
      }
    }
    meetings.sort((a, b) => b.game.gameday.localeCompare(a.game.gameday) || b.game.season - a.game.season)
    // The season stays loaded for the sides even if the meetings walk evicted it.
    const current = await this.season(season)
    return { season, left: await this.matchupSide(current, left), right: await this.matchupSide(current, right), meetings }
  }

  /** Quick Open's index: teams, players and games of the season, and every cut-up. */
  async searchIndex(season: number, cutups: SearchIndex['cutups'] = []): Promise<SearchIndex> {
    const data = await this.season(season)
    const graded = new Map<string, number>()
    for (const g of this.store.gradesForSeason(season)) if (g.grade !== null) graded.set(g.playerId, (graded.get(g.playerId) ?? 0) + 1)
    const index = this.playerIndex(data)
    const players = data.roster
      .filter((p) => p.status !== 'RET' || graded.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, team: p.team, position: p.depthPos || p.position, group: p.group, jersey: p.jersey, headshot: p.headshot, season, graded: graded.get(p.id) ?? 0 }))
    for (const id of graded.keys()) {
      if (players.some((p) => p.id === id)) continue
      const p = index.get(id)
      if (p) players.push({ id, name: p.name, team: p.team, position: p.position, group: p.group, jersey: p.jersey, headshot: '', season, graded: graded.get(id)! })
    }
    const ids = data.games.map((g) => g.gameId)
    const clips = this.store.clipCounts(ids)
    const studied = this.store.studiedTeams()
    const games = await Promise.all(
      data.games.map(async (g) => {
        const team = studied.get(g.gameId) ?? null
        const hasFilm = (clips.get(g.gameId) ?? 0) > 0
        return {
          gameId: g.gameId,
          season,
          week: g.week,
          gameType: g.gameType,
          gameday: g.gameday,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          clipCount: clips.get(g.gameId) ?? 0,
          playCount: hasFilm ? (await this.filmPlays(g.gameId)).length : 0,
          gradedPlays: team ? this.store.gradedPlayCounts([g.gameId], team).get(g.gameId) ?? 0 : 0,
          studiedTeam: team
        }
      })
    )
    return {
      season,
      teams: TEAMS.map((t) => {
        const s = data.teams.find((x) => x.team === t.abbr)
        return { abbr: t.abbr, name: t.name, nickname: t.nickname, division: t.division, wins: s?.wins ?? 0, losses: s?.losses ?? 0, ties: s?.ties ?? 0 }
      }),
      players,
      games,
      cutups
    }
  }

  /** Sidebar badges: new film, and per My Team the season's games with film still holding ungraded plays. */
  async sidebarBadges(season: number): Promise<SidebarBadges> {
    const film = this.store.filmGames()
    const teams: Record<string, number> = {}
    const data = await this.seasonOrNull(season)
    for (const abbr of this.store.settings().myTeams) {
      let n = 0
      if (data) {
        for (const g of data.games) {
          if (g.homeTeam !== abbr && g.awayTeam !== abbr) continue
          if (!film.some((f) => f.gameId === g.gameId)) continue
          const plays = (await this.filmPlays(g.gameId)).length
          const graded = this.store.gradedPlayCounts([g.gameId], abbr).get(g.gameId) ?? 0
          if (graded < plays) n++
        }
      }
      teams[abbr] = n
    }
    return { newFilm: film.filter((f) => !f.openedAt).length, teams }
  }

  async gradesCsv(season: number, abbr: string): Promise<string> {
    const data = await this.season(season)
    const index = this.playerIndex(data)
    const grades = this.store.gradesForTeam(abbr, season)
    // critical and not_on_field go last so existing spreadsheets keep their column positions.
    const header = ['week', 'opponent', 'game_id', 'play_id', 'qtr', 'time', 'down', 'distance', 'play_type', 'player', 'position', 'grade', 'tags', 'note', 'play', 'critical', 'not_on_field']
    const lines = [header.join(',')]
    for (const g of grades) {
      const game = data.games.find((x) => x.gameId === g.gameId)
      const play = (await this.plays(g.gameId)).find((p) => p.playId === g.playId)
      const player = index.get(g.playerId)
      lines.push(
        [
          game?.week ?? '',
          game ? (game.homeTeam === abbr ? game.awayTeam : game.homeTeam) : '',
          g.gameId,
          g.playId,
          play?.qtr ?? '',
          play?.time ?? '',
          play?.down ?? '',
          play?.ydstogo ?? '',
          play?.playType ?? '',
          player?.name ?? g.playerId,
          player?.position ?? '',
          g.grade === null ? '' : g.grade > 0 ? '+' : g.grade < 0 ? '-' : '0',
          g.tags.join('; '),
          g.note,
          play?.desc ?? '',
          g.critical && g.grade !== null ? '1' : '',
          g.offField ? '1' : ''
        ]
          .map(csvCell)
          .join(',')
      )
    }
    return lines.join('\n') + '\n'
  }

  /** "DAL @ PHI" for a game id. */
  async gameTitle(gameId: string): Promise<string> {
    return gameTitle(await this.gameInfo(gameId))
  }
}

export { mergeTally }

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Expands any folders into the video files inside them (recursively), skipping hidden files. */
export async function expandVideoFiles(paths: string[]): Promise<string[]> {
  const out: string[] = []
  const walk = async (p: string, depth: number) => {
    if (!existsSync(p)) return
    const s = await stat(p)
    if (s.isDirectory()) {
      if (depth > 4) return
      for (const entry of await readdir(p)) {
        if (!entry.startsWith('.')) await walk(join(p, entry), depth + 1)
      }
    } else if (VIDEO_EXTENSIONS.includes(extensionOf(p))) {
      out.push(p)
    }
  }
  for (const p of paths) await walk(p, 0)
  return [...new Set(out)]
}
