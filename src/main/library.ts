import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MatchOptions } from '@shared/api'
import { extensionOf, matchClips, PLAYABLE_EXTENSIONS, VIDEO_EXTENSIONS } from '@shared/matching'
import { addToTally, emptyTally } from '@shared/stats'
import { POSITION_GROUPS, positionGroup, TEAM_BY_ABBR } from '@shared/teams'
import type {
  ClipMatchRow,
  DataProgress,
  GameFilm,
  GameInfo,
  GradeEntry,
  GradeTally,
  MatchPreview,
  Play,
  PlayerGameLine,
  PlayerProfile,
  PlayNote,
  RecentFilm,
  ReelItem,
  RosterPlayer,
  SeasonStatus,
  TeamOverview,
  TeamRosterRow,
  TeamSummary
} from '@shared/types'
import { convertedPath } from './convert'
import type { Store } from './db'
import {
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

export function currentSeason(now = new Date()): number {
  // The NFL season starts in September; January–August still belong to last year's season.
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
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

  /** Downloads a season; a second request while one is running joins it instead of starting over. */
  downloadSeason(season: number, onProgress: (p: DataProgress) => void): Promise<SeasonStatus> {
    let running = this.downloads.get(season)
    if (!running) {
      running = this.runDownload(season, onProgress).finally(() => this.downloads.delete(season))
      this.downloads.set(season, running)
    }
    return running
  }

  private async runDownload(season: number, onProgress: (p: DataProgress) => void): Promise<SeasonStatus> {
    await downloadSeason(season, this.cacheDir, this.fetcher, onProgress)
    this.seasons.delete(season)
    for (const key of this.playsCache.keys()) if (key.startsWith(`${season}_`)) this.playsCache.delete(key)
    const [status] = await seasonStatuses(this.cacheDir, [season])
    return status
  }

  async season(season: number): Promise<SeasonData> {
    let data = this.seasons.get(season)
    if (!data) {
      const loaded = await loadSeason(this.cacheDir, season)
      if (!loaded) throw new Error(`The ${season} season hasn't been downloaded yet, or was saved by an older version of the app. Download it again from the home screen.`)
      this.seasons.set(season, (data = loaded))
    }
    return data
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

  private playerIndex(data: SeasonData): Map<string, RosterPlayer> {
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
    return map
  }

  private gameById(data: SeasonData, gameId: string): GameInfo {
    const g = data.games.find((x) => x.gameId === gameId)
    if (!g) throw new Error(`Unknown game ${gameId}`)
    return g
  }

  async teamSummaries(season: number): Promise<TeamSummary[]> {
    return (await this.season(season)).teams
  }

  async teamOverview(season: number, abbr: string): Promise<TeamOverview> {
    const data = await this.season(season)
    const team = TEAM_BY_ABBR[abbr]
    if (!team) throw new Error(`Unknown team ${abbr}`)
    const games = data.games
      .filter((g) => g.homeTeam === abbr || g.awayTeam === abbr)
      .sort((a, b) => a.gameday.localeCompare(b.gameday) || a.week - b.week)
    const gameIds = games.map((g) => g.gameId)
    const clipCounts = this.store.clipCounts(gameIds)
    const graded = this.store.gradedPlayCounts(gameIds)
    const teamGames = await Promise.all(
      games.map(async (g) => ({
        ...g,
        clipCount: clipCounts.get(g.gameId) ?? 0,
        playCount: (await this.plays(g.gameId)).filter((p) => p.playType !== '').length,
        gradedPlays: graded.get(g.gameId) ?? 0
      }))
    )

    const tallies = new Map<string, GradeTally>()
    for (const g of this.store.gradesForTeam(abbr, season)) {
      addToTally(tallies.get(g.playerId) ?? tallies.set(g.playerId, emptyTally()).get(g.playerId)!, g.grade)
    }
    const snapsFor = (id: string) => {
      let n = 0
      for (const s of Object.values(data.snaps[id] ?? {})) if (s.team === abbr) n += s.offense + s.defense + s.special
      return n
    }

    const index = this.playerIndex(data)
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
      .map((p) => ({ ...p, snaps: snapsFor(p.id), tally: tallies.get(p.id) ?? emptyTally() }))
      .sort(
        (a, b) =>
          POSITION_GROUPS.indexOf(a.group) - POSITION_GROUPS.indexOf(b.group) ||
          b.snaps - a.snaps ||
          a.name.localeCompare(b.name)
      )

    return {
      team,
      season,
      summary: data.teams.find((t) => t.team === abbr) ?? null,
      games: teamGames,
      roster
    }
  }

  async gameFilm(gameId: string): Promise<GameFilm> {
    const season = Number(gameId.slice(0, 4))
    const data = await this.season(season)
    const game = this.gameById(data, gameId)
    const plays = (await this.plays(gameId)).filter((p) => p.playType !== '')
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
    const playable = files.filter((f) => PLAYABLE_EXTENSIONS.includes(extensionOf(f)))
    const unsupported: string[] = []
    // Clips already converted to MP4 stand in for their originals.
    for (const f of files.filter((f) => !PLAYABLE_EXTENSIONS.includes(extensionOf(f)))) {
      const copy = convertedPath(f, this.convertedDir(gameId))
      if (existsSync(copy)) playable.push(copy)
      else unsupported.push(f)
    }
    const plays = (await this.plays(gameId)).filter((p) => p.playType !== '')
    const result = matchClips(playable, plays, options)
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

  importClips(gameId: string, team: string, rows: ClipMatchRow[]) {
    this.store.replaceClips(gameId, rows)
    this.store.touchFilm(gameId, team, false)
  }

  async recentFilm(): Promise<RecentFilm[]> {
    const out: RecentFilm[] = []
    for (const { gameId, team } of this.store.recentFilm()) {
      const season = Number(gameId.slice(0, 4))
      const data = await this.season(season).catch(() => null)
      const game = data?.games.find((g) => g.gameId === gameId)
      if (!game) continue
      out.push({
        game,
        team,
        clipCount: this.store.clipCounts([gameId]).get(gameId) ?? 0,
        playCount: (await this.plays(gameId)).filter((p) => p.playType !== '').length,
        gradedPlays: this.store.gradedPlayCounts([gameId]).get(gameId) ?? 0
      })
    }
    return out
  }

  saveGrade(entry: GradeEntry) {
    this.store.saveGrade(entry)
  }

  savePlayNote(note: PlayNote) {
    this.store.savePlayNote(note)
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

    const totals: Record<string, number> = {}
    const rateCounts: Record<string, number> = {}
    const tally = emptyTally()
    const tagCounts = new Map<string, number>()
    for (const g of grades) {
      addToTally(tally, g.grade)
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
      const stats = week?.stats ?? {}
      for (const [k, v] of Object.entries(stats)) {
        totals[k] = (totals[k] ?? 0) + v
        if (RATE_STATS.has(k)) rateCounts[k] = (rateCounts[k] ?? 0) + 1
      }
      const gameTally = emptyTally()
      for (const g of grades) if (g.gameId === game.gameId) addToTally(gameTally, g.grade)
      return { game, team, opponent, snaps: snaps[game.gameId] ?? null, stats, tally: gameTally }
    })
    for (const k of Object.keys(rateCounts)) totals[k] = totals[k] / rateCounts[k]
    if (totals.fg_long) totals.fg_long = Math.max(...weeks.map((w) => w.stats.fg_long ?? 0))
    const totalSnaps = lines.reduce((n, l) => n + (l.snaps ? l.snaps.offense + l.snaps.defense + l.snaps.special : 0), 0)
    if (totalSnaps) totals.snaps = totalSnaps

    const reel: ReelItem[] = []
    for (const gameId of [...new Set(grades.map((g) => g.gameId))]) {
      const plays = await this.plays(gameId)
      const clips = this.store.clipsForGame(gameId)
      const line = lines.find((l) => l.game.gameId === gameId)
      for (const g of grades.filter((x) => x.gameId === gameId)) {
        reel.push({
          gameId,
          team: g.team,
          playId: g.playId,
          week: line?.game.week ?? 0,
          opponent: line?.opponent ?? '',
          play: plays.find((p) => p.playId === g.playId) ?? null,
          clips: clips.filter((c) => c.playId === g.playId),
          grade: g.grade,
          tags: g.tags,
          note: g.note
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
      reel
    }
  }

  async gradesCsv(season: number, abbr: string): Promise<string> {
    const data = await this.season(season)
    const index = this.playerIndex(data)
    const grades = this.store.gradesForTeam(abbr, season)
    const header = ['week', 'opponent', 'game_id', 'play_id', 'qtr', 'time', 'down', 'distance', 'play_type', 'player', 'position', 'grade', 'tags', 'note', 'play']
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
          play?.desc ?? ''
        ]
          .map(csvCell)
          .join(',')
      )
    }
    return lines.join('\n') + '\n'
  }
}

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
