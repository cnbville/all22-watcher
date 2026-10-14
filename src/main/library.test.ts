import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { Store } from './db'
import { Library } from './library'
import { mirrorFetcher, seasonStatuses } from './nflverse'

const csv = (rows: Record<string, string | number>[]) => {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return [cols.join(','), ...rows.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n') + '\n'
}

/** A tiny 2025 season: cornerback g1 plays for NYJ in week 1, then is traded and plays for IND against NYJ in week 2. */
async function tradeSeason(): Promise<Library> {
  const dir = await mkdtemp(join(tmpdir(), 'all22-lib-'))
  const mirror = join(dir, 'mirror')
  await mkdir(mirror)
  const wk1 = '2025_01_DAL_NYJ'
  const wk2 = '2025_02_NYJ_IND'
  const game = (game_id: string, week: number, away_team: string, home_team: string) =>
    ({ game_id, season: 2025, week, game_type: 'REG', gameday: `2025-09-0${week}`, away_team, home_team, away_score: 10, home_score: 20 })
  const play = (game_id: string, play_id: number, posteam: string, defteam: string, extra: Record<string, string> = {}) =>
    ({ game_id, play_id, posteam, defteam, play_type: 'pass', pass: 1, ...extra })
  await writeFile(join(mirror, 'games.csv'), csv([game(wk1, 1, 'DAL', 'NYJ'), game(wk2, 2, 'NYJ', 'IND')]))
  await writeFile(
    join(mirror, 'play_by_play_2025.csv.gz'),
    gzipSync(
      csv([
        play(wk1, 10, 'DAL', 'NYJ', { receiver_player_id: 'x1' }),
        play(wk1, 11, 'DAL', 'NYJ', { play_type: 'no_play', penalty: '1', penalty_type: 'False Start' }),
        play(wk1, 12, 'DAL', 'NYJ', { play_type: 'no_play', penalty: '1', penalty_type: 'Defensive Holding' }),
        play(wk2, 10, 'NYJ', 'IND')
      ])
    )
  )
  const lineup = (game: string, play_id: number, offense: string, defense: string) =>
    ({ nflverse_game_id: game, play_id, offense_players: offense, defense_players: defense, offense_positions: 'QB', defense_positions: 'CB' })
  await writeFile(
    join(mirror, 'pbp_participation_2025.csv'),
    csv([lineup(wk1, 10, 'd1', 'g1'), lineup(wk1, 11, 'd1', 'g1'), lineup(wk1, 12, 'd1', 'g1'), lineup(wk2, 10, 'q1', 'g1')])
  )
  const player = (gsis_id: string, team: string, position: string) =>
    ({ gsis_id, full_name: gsis_id, team, position, depth_chart_position: position, status: 'ACT', week: 18 })
  await writeFile(
    join(mirror, 'roster_2025.csv'),
    csv([player('g1', 'IND', 'CB'), player('x1', 'IND', 'WR'), player('d1', 'DAL', 'QB'), player('q1', 'NYJ', 'QB')])
  )
  // x1 has a box score for DAL in week 1 but isn't in the lineups, like a season without participation data.
  await writeFile(
    join(mirror, 'stats_player_week_2025.csv'),
    csv([{ player_id: 'x1', game_id: wk1, week: 1, season_type: 'REG', team: 'DAL', opponent_team: 'NYJ', receptions: 1 }])
  )

  const store = await Store.open(join(dir, 'grades.sqlite'))
  const library = new Library(store, join(dir, 'cache'), mirrorFetcher(mirror))
  await library.downloadSeason(2025, () => {})
  return library
}

describe('Library with players who changed teams', () => {
  it('counts snaps for the team they were played for, skipping pre-snap fouls', async () => {
    const library = await tradeSeason()
    const season = await library.season(2025)
    expect(season.snaps.g1).toEqual({
      '2025_01_DAL_NYJ': { team: 'NYJ', offense: 0, defense: 2, special: 0 },
      '2025_02_NYJ_IND': { team: 'IND', offense: 0, defense: 1, special: 0 }
    })

    const nyj = await library.teamOverview(2025, 'NYJ')
    expect(nyj.roster.find((p) => p.id === 'g1')?.snaps).toBe(2)
    expect((await library.teamOverview(2025, 'IND')).roster.find((p) => p.id === 'g1')?.snaps).toBe(1)
    expect((await library.teamOverview(2025, 'DAL')).roster.map((p) => p.id)).toContain('x1')
  })

  it('lists them on the side they played for in each game', async () => {
    const library = await tradeSeason()
    const film = await library.gameFilm('2025_01_DAL_NYJ')
    expect(film.players.g1.team).toBe('NYJ')
    expect(film.players.x1.team).toBe('DAL')
    expect(film.plays.map((p) => p.playId)).toEqual([10, 11, 12])

    const profile = await library.playerProfile(2025, 'g1')
    expect(profile!.games.map((g) => [g.team, g.opponent])).toEqual([
      ['NYJ', 'DAL'],
      ['IND', 'NYJ']
    ])
  })

  it('asks for a fresh download when the cache was saved by an older version', async () => {
    const library = await tradeSeason()
    const meta = join(library.cacheDir, '2025', 'meta.json')
    await writeFile(meta, JSON.stringify({ ...JSON.parse(await readFile(meta, 'utf8')), version: 1 }))
    expect((await seasonStatuses(library.cacheDir, [2025]))[0].downloaded).toBe(false)
    const reopened = new Library(library.store, library.cacheDir, mirrorFetcher('/nowhere'))
    await expect(reopened.season(2025)).rejects.toThrow(/older version/)
  })
})
