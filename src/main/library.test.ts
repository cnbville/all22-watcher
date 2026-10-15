import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { ClipMatchRow } from '@shared/types'
import { convertClips, convertedPath } from './convert'
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

/** Stands in for ffmpeg: writes an empty file at the output path, its last argument. */
async function fakeFfmpeg(dir: string): Promise<string> {
  const bin = join(dir, 'ffmpeg')
  await writeFile(bin, '#!/bin/sh\nfor out; do :; done\n: > "$out"\n', { mode: 0o755 })
  return bin
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

describe('Library.previewMatch', () => {
  it('reads angles from the picked folder down, and places converted copies by their originals', async () => {
    const library = await tradeSeason()
    const gameId = '2025_01_DAL_NYJ'
    const game = join(await mkdtemp(join(tmpdir(), 'all22-pick-')), 'Side Projects', 'DAL at NYJ')
    for (const angle of ['All-22', 'Sideline']) {
      await mkdir(join(game, angle), { recursive: true })
      await writeFile(join(game, angle, '001.mp4'), '')
    }
    const mkv = join(game, 'Sideline', '002.mkv')
    await writeFile(mkv, '')
    expect((await library.previewMatch(gameId, [game])).unsupported).toEqual([mkv])

    const copy = convertedPath(mkv, library.convertedDir(gameId))
    await mkdir(dirname(copy), { recursive: true })
    await writeFile(copy, '')
    const picked = await library.previewMatch(gameId, [game])
    expect(picked.unsupported).toEqual([])
    const rows = picked.rows.map((r) => [r.path, r.angle, r.playId])
    expect(rows).toEqual([
      [join(game, 'All-22', '001.mp4'), 'main', 10],
      [join(game, 'Sideline', '001.mp4'), 'sideline', 10],
      [copy, 'sideline', 11]
    ])

    // Fixing saved matches later picks the saved clips themselves, copies included.
    expect((await library.previewMatch(gameId, rows.map((r) => r[0] as string))).rows.map((r) => [r.path, r.angle, r.playId])).toEqual(rows)
  })

  // Converts the game's other formats, saves what the import shows, then reopens it to fix matches and ticks both boxes.
  const importThenFix = async (library: Library, gameId: string, game: string) => {
    const first = await library.previewMatch(gameId, [game])
    const { failed } = await convertClips(await fakeFfmpeg(dirname(game)), first.unsupported, library.convertedDir(gameId))
    expect(failed).toEqual([])
    const saved = (await library.previewMatch(gameId, [game])).rows
    const fix = () => library.previewMatch(gameId, saved.map((r) => r.path), { includeSpecialTeams: true, includeNoPlays: true })
    const byPath = (rows: ClipMatchRow[]) => Object.fromEntries(rows.map((r) => [r.path, [r.angle, r.playId]]))
    return { saved: byPath(saved), fixed: async () => byPath((await fix()).rows) }
  }

  it('fixing matches later reads converted copies as the clips they came from', async () => {
    const library = await tradeSeason()
    const gameId = '2025_01_DAL_NYJ'
    const game = join(await mkdtemp(join(tmpdir(), 'all22-fix-')), 'Film', 'DAL at NYJ')
    // Only the sideline's first half is MP4, so the playable originals alone all sit inside one half folder.
    const files = ['Sideline', 'End Zone'].flatMap((a) => ['1st Half', '2nd Half'].map((h) => join(game, a, h, `1.${a === 'Sideline' && h === '1st Half' ? 'mp4' : 'mkv'}`)))
    for (const f of files) {
      await mkdir(dirname(f), { recursive: true })
      await writeFile(f, '')
    }
    const { saved, fixed } = await importThenFix(library, gameId, game)
    const copy = (f: string) => (f.endsWith('.mkv') ? convertedPath(f, library.convertedDir(gameId)) : f)
    expect(saved).toEqual(Object.fromEntries(files.map((f, i) => [copy(f), [i < 2 ? 'sideline' : 'endzone', i % 2 ? 11 : 10]])))
    expect(await fixed()).toEqual(saved)

    // Copies made before their source folder was recorded are traced by the clips around them.
    const out = library.convertedDir(gameId)
    for (const hash of await readdir(out)) await rm(join(out, hash, '.source'))
    expect(await fixed()).toEqual(saved)
  })

  it('fixing matches later keeps an all-MKV game apart from the folders it sits in', async () => {
    const library = await tradeSeason()
    const gameId = '2025_01_DAL_NYJ'
    const game = join(await mkdtemp(join(tmpdir(), 'all22-fix-')), 'Side Projects', 'DAL at NYJ')
    for (const angle of ['All-22', 'Sideline']) {
      await mkdir(join(game, angle), { recursive: true })
      await writeFile(join(game, angle, '001.mkv'), '')
    }
    const { saved, fixed } = await importThenFix(library, gameId, game)
    const copy = (angle: string) => convertedPath(join(game, angle, '001.mkv'), library.convertedDir(gameId))
    expect(saved).toEqual({ [copy('All-22')]: ['main', 10], [copy('Sideline')]: ['sideline', 10] })
    expect(await fixed()).toEqual(saved)
  })
})
