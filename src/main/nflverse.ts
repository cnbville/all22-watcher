import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import Papa from 'papaparse'
import { positionGroup } from '@shared/teams'
import { summarizeTeams } from '@shared/stats'
import type { DataProgress, GameInfo, Play, PlayerWeek, RosterPlayer, SeasonStatus, Snaps, TeamSummary } from '@shared/types'

const BASE = 'https://github.com/nflverse/nflverse-data/releases/download'
const CACHE_VERSION = 1

export const FILES = {
  schedule: () => `${BASE}/schedules/games.csv`,
  pbp: (s: number) => `${BASE}/pbp/play_by_play_${s}.csv.gz`,
  participation: (s: number) => `${BASE}/pbp_participation/pbp_participation_${s}.csv`,
  roster: (s: number) => `${BASE}/rosters/roster_${s}.csv`,
  playerStats: (s: number) => `${BASE}/stats_player/stats_player_week_${s}.csv`
}

/** Opens a download as a stream, or returns null when the file doesn't exist (404). */
export type Fetcher = (url: string) => Promise<Readable | null>

export class NotFoundError extends Error {}

/** Reads files from a local folder instead of the network, named like the release assets. Used by tests and offline setups. */
export function mirrorFetcher(dir: string): Fetcher {
  return async (url) => {
    const file = join(dir, url.split('/').pop()!)
    return existsSync(file) ? createReadStream(file) : null
  }
}

export function webFetcher(fetchImpl: (url: string) => Promise<Response>): Fetcher {
  return async (url) => {
    const res = await fetchImpl(url)
    if (res.status === 404) return null
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`)
    return Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  }
}

type Row = Record<string, string>

function parseCsv(stream: Readable, gz: boolean, onRow: (row: Row) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = Papa.parse(Papa.NODE_STREAM_INPUT, { header: true, skipEmptyLines: true })
    parser.on('data', (row: Row) => {
      try {
        onRow(row)
      } catch (e) {
        reject(e)
      }
    })
    parser.on('end', () => resolve())
    parser.on('error', reject)
    stream.on('error', reject)
    if (gz) {
      const gunzip = createGunzip()
      gunzip.on('error', reject)
      stream.pipe(gunzip).pipe(parser)
    } else {
      stream.pipe(parser)
    }
  })
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '' || v === 'NA') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: string | undefined): string | null => (v === undefined || v === '' || v === 'NA' ? null : v)
const flag = (v: string | undefined) => v === '1' || v === 'TRUE' || v === 'true'
const ids = (v: string | undefined) => (v ? v.split(';').filter(Boolean) : [])

const INVOLVED_COLUMNS = [
  'passer_player_id', 'receiver_player_id', 'rusher_player_id', 'interception_player_id', 'sack_player_id',
  'half_sack_1_player_id', 'half_sack_2_player_id', 'qb_hit_1_player_id', 'qb_hit_2_player_id',
  'solo_tackle_1_player_id', 'solo_tackle_2_player_id', 'assist_tackle_1_player_id', 'assist_tackle_2_player_id',
  'assist_tackle_3_player_id', 'assist_tackle_4_player_id', 'tackle_with_assist_1_player_id', 'tackle_with_assist_2_player_id',
  'pass_defense_1_player_id', 'pass_defense_2_player_id', 'forced_fumble_player_1_player_id', 'forced_fumble_player_2_player_id',
  'tackle_for_loss_1_player_id', 'tackle_for_loss_2_player_id', 'fumbled_1_player_id', 'kicker_player_id', 'punter_player_id',
  'kickoff_returner_player_id', 'punt_returner_player_id', 'penalty_player_id'
]

export function playFromRow(r: Row): Play {
  const involved = [...new Set(INVOLVED_COLUMNS.map((c) => r[c]).filter((v) => v && v !== 'NA'))]
  return {
    playId: Number(r.play_id),
    gameId: r.game_id,
    qtr: num(r.qtr) ?? 0,
    time: r.time ?? '',
    down: num(r.down),
    ydstogo: num(r.ydstogo),
    yrdln: r.yrdln ?? '',
    yardline100: num(r.yardline_100),
    posteam: r.posteam ?? '',
    defteam: r.defteam ?? '',
    playType: r.play_type === 'NA' ? '' : (r.play_type ?? ''),
    desc: r.desc ?? '',
    yardsGained: num(r.yards_gained),
    epa: num(r.epa),
    success: r.success === '' || r.success === 'NA' ? null : flag(r.success),
    isPass: flag(r.pass),
    isRush: flag(r.rush),
    special: flag(r.special_teams_play) || flag(r.special),
    shotgun: flag(r.shotgun),
    noHuddle: flag(r.no_huddle),
    passLength: str(r.pass_length),
    passLocation: str(r.pass_location),
    runLocation: str(r.run_location),
    runGap: str(r.run_gap),
    touchdown: flag(r.touchdown),
    turnover: flag(r.interception) || flag(r.fumble_lost),
    sack: flag(r.sack),
    penalty: flag(r.penalty),
    involved,
    formation: null,
    offPersonnel: null,
    defPersonnel: null,
    defendersInBox: null,
    passRushers: null,
    coverage: null,
    manZone: null,
    wasPressure: null,
    offensePlayers: [],
    defensePlayers: []
  }
}

const STAT_KEYS = [
  'completions', 'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'passing_air_yards',
  'passing_epa', 'passing_cpoe', 'carries', 'rushing_yards', 'rushing_tds', 'rushing_fumbles_lost', 'rushing_epa',
  'rushing_first_downs', 'targets', 'receptions', 'receiving_yards', 'receiving_tds', 'receiving_air_yards',
  'receiving_yards_after_catch', 'receiving_epa', 'receiving_first_downs', 'target_share', 'def_tackles_solo',
  'def_tackle_assists', 'def_tackles_for_loss', 'def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended',
  'def_fumbles_forced', 'def_tds', 'fg_made', 'fg_att', 'fg_long', 'pat_made', 'pat_att', 'pt_att', 'pt_yards',
  'pt_inside_20', 'pt_net_yards', 'punt_returns', 'punt_return_yards', 'kickoff_returns', 'kickoff_return_yards',
  'penalties', 'penalty_yards', 'fantasy_points_ppr'
]

export interface ExtraPlayer {
  id: string
  name: string
  position: string
  jersey: string
  team: string
}

export interface SeasonData {
  season: number
  meta: SeasonMeta
  games: GameInfo[]
  roster: RosterPlayer[]
  extraPlayers: ExtraPlayer[]
  playerWeeks: PlayerWeek[]
  snaps: Record<string, Record<string, Snaps>>
  teams: TeamSummary[]
}

interface SeasonMeta {
  version: number
  season: number
  downloadedAt: string
  hasParticipation: boolean
}

/** Downloads one season from nflverse, trims it to what the app uses, and writes it under `cacheDir/<season>`. */
export async function downloadSeason(
  season: number,
  cacheDir: string,
  fetcher: Fetcher,
  onProgress: (p: DataProgress) => void = () => {}
): Promise<void> {
  const total = 5
  const step = (done: number, label: string) => onProgress({ season, step: label, done, total })
  const tmp = join(cacheDir, `${season}.partial`)
  await rm(tmp, { recursive: true, force: true })
  await mkdir(join(tmp, 'plays'), { recursive: true })

  const open = async (url: string, required: boolean) => {
    const s = await fetcher(url)
    if (!s && required) throw new NotFoundError(`nflverse has no file at ${url}`)
    return s
  }

  step(0, 'Schedule')
  const games: GameInfo[] = []
  await parseCsv((await open(FILES.schedule(), true))!, false, (r) => {
    if (Number(r.season) !== season) return
    games.push({
      gameId: r.game_id,
      season,
      week: Number(r.week),
      gameType: r.game_type,
      gameday: r.gameday,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      homeScore: num(r.home_score),
      awayScore: num(r.away_score)
    })
  })
  if (!games.length) throw new NotFoundError(`No ${season} schedule published yet.`)

  step(1, 'Play-by-play')
  const playsByGame = new Map<string, Play[]>()
  const pbp = await open(FILES.pbp(season), false)
  if (pbp) {
    await parseCsv(pbp, true, (r) => {
      const play = playFromRow(r)
      if (!play.gameId || !Number.isFinite(play.playId)) return
      let list = playsByGame.get(play.gameId)
      if (!list) playsByGame.set(play.gameId, (list = []))
      list.push(play)
    })
  }

  step(2, 'Participation')
  const snaps: Record<string, Record<string, Snaps>> = {}
  const extra = new Map<string, ExtraPlayer>()
  let hasParticipation = false
  const participation = await open(FILES.participation(season), false)
  if (participation) {
    const index = new Map<string, Play>()
    for (const list of playsByGame.values()) for (const p of list) index.set(`${p.gameId}#${p.playId}`, p)
    await parseCsv(participation, false, (r) => {
      const play = index.get(`${r.nflverse_game_id}#${Number(r.play_id)}`)
      if (!play) return
      hasParticipation = true
      play.formation = str(r.offense_formation)
      play.offPersonnel = str(r.offense_personnel)
      play.defPersonnel = str(r.defense_personnel)
      play.defendersInBox = num(r.defenders_in_box)
      play.passRushers = num(r.number_of_pass_rushers)
      play.coverage = str(r.defense_coverage_type)
      play.manZone = str(r.defense_man_zone_type)
      play.wasPressure = r.was_pressure === '' ? null : flag(r.was_pressure)
      play.offensePlayers = ids(r.offense_players)
      play.defensePlayers = ids(r.defense_players)
      const kind: keyof Snaps | null = play.special ? 'special' : null
      for (const [list, names, positions, numbers, side, team] of [
        [play.offensePlayers, r.offense_names, r.offense_positions, r.offense_numbers, 'offense', play.posteam],
        [play.defensePlayers, r.defense_names, r.defense_positions, r.defense_numbers, 'defense', play.defteam]
      ] as const) {
        const nm = names?.split(';') ?? []
        const ps = positions?.split(';') ?? []
        const ns = numbers?.split(';') ?? []
        list.forEach((id, i) => {
          if (!extra.has(id)) extra.set(id, { id, name: nm[i] ?? id, position: ps[i] ?? '', jersey: ns[i] ?? '', team })
          if (play.playType === '') return
          const bucket = (snaps[id] ??= {})
          const s = (bucket[play.gameId] ??= { offense: 0, defense: 0, special: 0 })
          s[kind ?? side]++
        })
      }
    })
  }
  for (const [gameId, list] of playsByGame) {
    list.sort((a, b) => a.playId - b.playId)
    await writeFile(join(tmp, 'plays', `${gameId}.json`), JSON.stringify(list))
  }

  step(3, 'Rosters')
  const roster = new Map<string, RosterPlayer & { week: number }>()
  const rosterStream = await open(FILES.roster(season), false)
  if (rosterStream) {
    await parseCsv(rosterStream, false, (r) => {
      const id = r.gsis_id || (r.esb_id ? `esb-${r.esb_id}` : '')
      if (!id) return
      const week = num(r.week) ?? 0
      const prev = roster.get(id)
      if (prev && prev.week > week) return
      roster.set(id, {
        id,
        week,
        name: r.full_name,
        team: r.team,
        position: r.position,
        depthPos: r.depth_chart_position ?? '',
        group: positionGroup(r.position ?? '', r.depth_chart_position ?? ''),
        jersey: r.jersey_number ?? '',
        status: r.status ?? '',
        headshot: r.headshot_url ?? '',
        college: r.college ?? '',
        height: r.height ?? '',
        weight: r.weight ?? '',
        yearsExp: r.years_exp ?? ''
      })
    })
  }

  step(4, 'Player stats')
  const playerWeeks: PlayerWeek[] = []
  const statsStream = await open(FILES.playerStats(season), false)
  if (statsStream) {
    await parseCsv(statsStream, false, (r) => {
      const stats: Record<string, number> = {}
      for (const k of STAT_KEYS) {
        const v = num(r[k])
        if (v) stats[k] = v
      }
      playerWeeks.push({
        playerId: r.player_id,
        gameId: r.game_id,
        week: Number(r.week),
        seasonType: r.season_type,
        team: r.team,
        opponent: r.opponent_team,
        stats
      })
    })
  }

  const teams = summarizeTeams(games, [...playsByGame.values()].flat())
  const meta: SeasonMeta = { version: CACHE_VERSION, season, downloadedAt: new Date().toISOString(), hasParticipation }
  const rosterList = [...roster.values()].map(({ week: _week, ...p }) => p)
  await Promise.all([
    writeFile(join(tmp, 'games.json'), JSON.stringify(games)),
    writeFile(join(tmp, 'roster.json'), JSON.stringify(rosterList)),
    writeFile(join(tmp, 'extra_players.json'), JSON.stringify([...extra.values()])),
    writeFile(join(tmp, 'player_weeks.json'), JSON.stringify(playerWeeks)),
    writeFile(join(tmp, 'snaps.json'), JSON.stringify(snaps)),
    writeFile(join(tmp, 'teams.json'), JSON.stringify(teams))
  ])
  await writeFile(join(tmp, 'meta.json'), JSON.stringify(meta))

  const final = join(cacheDir, String(season))
  await rm(final, { recursive: true, force: true })
  await rename(tmp, final)
  step(5, 'Done')
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

export async function readSeasonMeta(cacheDir: string, season: number): Promise<SeasonMeta | null> {
  const file = join(cacheDir, String(season), 'meta.json')
  if (!existsSync(file)) return null
  const meta = await readJson<SeasonMeta>(file)
  return meta.version === CACHE_VERSION ? meta : null
}

export async function loadSeason(cacheDir: string, season: number): Promise<SeasonData | null> {
  const meta = await readSeasonMeta(cacheDir, season)
  if (!meta) return null
  const dir = join(cacheDir, String(season))
  const [games, roster, extraPlayers, playerWeeks, snaps, teams] = await Promise.all([
    readJson<GameInfo[]>(join(dir, 'games.json')),
    readJson<RosterPlayer[]>(join(dir, 'roster.json')),
    readJson<ExtraPlayer[]>(join(dir, 'extra_players.json')),
    readJson<PlayerWeek[]>(join(dir, 'player_weeks.json')),
    readJson<Record<string, Record<string, Snaps>>>(join(dir, 'snaps.json')),
    readJson<TeamSummary[]>(join(dir, 'teams.json'))
  ])
  return { season, meta, games, roster, extraPlayers, playerWeeks, snaps, teams }
}

export async function loadGamePlays(cacheDir: string, gameId: string): Promise<Play[]> {
  const season = gameId.slice(0, 4)
  const file = join(cacheDir, season, 'plays', `${gameId}.json`)
  return existsSync(file) ? readJson<Play[]>(file) : []
}

export async function seasonStatuses(cacheDir: string, seasons: number[]): Promise<SeasonStatus[]> {
  return Promise.all(
    seasons.map(async (season) => {
      const meta = await readSeasonMeta(cacheDir, season)
      return {
        season,
        downloaded: !!meta,
        downloadedAt: meta?.downloadedAt ?? null,
        hasParticipation: meta?.hasParticipation ?? false
      }
    })
  )
}

export async function cachedSeasons(cacheDir: string): Promise<number[]> {
  if (!existsSync(cacheDir)) return []
  const entries = await readdir(cacheDir)
  return entries.filter((e) => /^\d{4}$/.test(e)).map(Number)
}
