import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { gradeScore } from '@shared/stats'
import type { ClipMatchRow, GradeEntry } from '@shared/types'
import { convertClips, convertedPath } from './convert'
import { Store } from './db'
import { Library, SEASON_LRU } from './library'
import { mirrorFetcher, seasonStatuses } from './nflverse'
import { CutupEngine } from './playQuery'

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
        play(wk2, 10, 'NYJ', 'IND'),
        play(wk2, 20, 'IND', 'NYJ', { play_type: 'kickoff', pass: '0', special: '1' })
      ])
    )
  )
  const lineup = (game: string, play_id: number, offense: string, defense: string) =>
    ({ nflverse_game_id: game, play_id, offense_players: offense, defense_players: defense, offense_positions: 'QB', defense_positions: 'CB' })
  await writeFile(
    join(mirror, 'pbp_participation_2025.csv'),
    csv([
      lineup(wk1, 10, 'd1', 'g1'),
      lineup(wk1, 11, 'd1', 'g1'),
      lineup(wk1, 12, 'd1', 'g1'),
      lineup(wk2, 10, 'q1', 'g1'),
      // Before 2023, kickoff lineups are listed from the kicking team's side (possession_team NYJ, pbp posteam IND).
      { ...lineup(wk2, 20, 'k1', 'r1'), possession_team: 'NYJ' }
    ])
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

  it('puts kickoff units on the right side when lineups follow the kicking team', async () => {
    const library = await tradeSeason()
    const kickoff = (await library.gameFilm('2025_02_NYJ_IND')).plays.find((p) => p.playId === 20)!
    expect([kickoff.offensePlayers, kickoff.defensePlayers]).toEqual([['r1'], ['k1']])
    const season = await library.season(2025)
    expect(season.snaps.k1['2025_02_NYJ_IND']).toEqual({ team: 'NYJ', offense: 0, defense: 0, special: 1 })
    expect(season.snaps.r1['2025_02_NYJ_IND']).toEqual({ team: 'IND', offense: 0, defense: 0, special: 1 })
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

// v2: several seasons, season lines, leaderboards, matchups and cut-ups

type Row = Record<string, string | number>
interface SeasonSpec {
  season: number
  /** [gameId, gameday, homeScore (null: not played)] */
  games: [string, string, number | null][]
  plays?: Row[]
  /** [id, name, team, position] */
  roster?: [string, string, string, string][]
}

/** One mirror holding several seasons; every season is downloaded unless listed in `skip`. */
async function seasons(specs: SeasonSpec[], skip: number[] = []): Promise<Library> {
  const dir = await mkdtemp(join(tmpdir(), 'all22-lib2-'))
  const mirror = join(dir, 'mirror')
  await mkdir(mirror)
  const games = specs.flatMap((s) =>
    s.games.map(([game_id, gameday, home_score]) => {
      const [, week, away_team, home_team] = game_id.split('_')
      return { game_id, season: s.season, week: Number(week), game_type: 'REG', gameday, away_team, home_team, away_score: home_score === null ? '' : 10, home_score: home_score ?? '' }
    })
  )
  await writeFile(join(mirror, 'games.csv'), csv(games))
  for (const s of specs) {
    if (s.plays?.length) await writeFile(join(mirror, `play_by_play_${s.season}.csv.gz`), gzipSync(csv(s.plays)))
    if (s.roster?.length) {
      await writeFile(
        join(mirror, `roster_${s.season}.csv`),
        csv(s.roster.map(([gsis_id, full_name, team, position]) => ({ gsis_id, full_name, team, position, depth_chart_position: position, status: 'ACT', week: 18 })))
      )
    }
  }
  const store = await Store.open(join(dir, 'grades.sqlite'))
  const library = new Library(store, join(dir, 'cache'), mirrorFetcher(mirror))
  for (const s of specs) if (!skip.includes(s.season)) await library.downloadSeason(s.season, () => {})
  return library
}

const grade = (library: Library, gameId: string, playId: number, playerId: string, team: string, g: -1 | 0 | 1 | null, extra: Partial<GradeEntry> = {}) =>
  library.saveGrade({ gameId, playId, playerId, team, grade: g, tags: [], note: '', critical: false, offField: false, ...extra })

const pbp = (game_id: string, play_id: number, posteam: string, defteam: string, extra: Row = {}): Row => ({
  game_id,
  play_id,
  posteam,
  defteam,
  play_type: 'pass',
  pass: 1,
  qtr: 1,
  time: '10:00',
  down: 1,
  ydstogo: 10,
  yardline_100: 75,
  epa: 0.1,
  success: 1,
  yards_gained: 5,
  ...extra
})

describe('Library seasons LRU', () => {
  it('keeps at most four seasons loaded, evicting the least recently used', async () => {
    const lib = await seasons([2021, 2022, 2023, 2024, 2025].map((season) => ({ season, games: [[`${season}_01_DAL_PHI`, `${season}-09-10`, 20]] })))
    for (const s of [2021, 2022, 2023, 2024]) await lib.season(s)
    expect(lib.loadedSeasons()).toEqual([2021, 2022, 2023, 2024])
    await lib.season(2021)
    await lib.season(2025)
    expect(lib.loadedSeasons()).toEqual([2023, 2024, 2021, 2025])
    expect(SEASON_LRU).toBe(4)
  })
})

describe('Library.playerSeasonLine', () => {
  const specs: SeasonSpec[] = [
    {
      season: 2024,
      games: [['2024_01_DAL_PHI', '2024-09-08', 20]],
      roster: [
        ['old-mhj', 'Marvin Harrison Jr.', 'ARI', 'WR'],
        ['wr-a', 'Mike Williams', 'NYJ', 'WR'],
        ['wr-b', 'Mike Williams', 'PIT', 'WR'],
        ['qb-allen', 'Josh Allen', 'BUF', 'QB'],
        ['lb-allen', 'Josh Allen', 'JAX', 'OLB'],
        ['cb1', 'Cooper DeJean', 'PHI', 'CB']
      ]
    },
    { season: 2025, games: [['2025_01_DAL_PHI', '2025-09-04', 24]], roster: [['cb1', 'Cooper DeJean', 'PHI', 'CB']] }
  ]
  it('matches by id, then by name and group, never on an ambiguous name', async () => {
    const lib = await seasons(specs)
    expect(await lib.playerSeasonLine(2024, 'cb1')).toMatchObject({ matchedBy: 'id', player: { name: 'Cooper DeJean' } })
    expect(await lib.playerSeasonLine(2024, 'new-mhj', { name: 'Marvin Harrison', group: 'WR' })).toMatchObject({ matchedBy: 'name', player: { id: 'old-mhj' } })
    expect(await lib.playerSeasonLine(2024, 'new-mw', { name: 'Mike Williams', group: 'WR' })).toBeNull()
    // Same name, different group: the group decides.
    expect(await lib.playerSeasonLine(2024, 'x', { name: 'Josh Allen', group: 'QB' })).toMatchObject({ player: { id: 'qb-allen' } })
    expect(await lib.playerSeasonLine(2024, 'nobody')).toBeNull()
    expect(await lib.playerSeasonLine(2019, 'cb1')).toBeNull()
  })
})

describe('Library.leaderboard and matchup', () => {
  const wk1 = '2025_01_DAL_NYJ'
  const wk2 = '2025_02_NYJ_IND'
  const specs: SeasonSpec[] = [
    { season: 2024, games: [['2024_05_IND_NYJ', '2024-10-06', 17]] },
    {
      season: 2025,
      games: [
        [wk1, '2025-09-07', 20],
        [wk2, '2025-09-14', 13],
        ['2025_12_IND_NYJ', '2025-11-23', null]
      ],
      plays: [pbp(wk1, 10, 'DAL', 'NYJ', { epa: 1 }), pbp(wk1, 11, 'DAL', 'NYJ', { epa: -1 }), pbp(wk2, 10, 'IND', 'NYJ', { epa: 0.5 })],
      roster: [
        ['g1', 'Garrett Traded', 'IND', 'CB'],
        ['s1', 'Stay Put', 'NYJ', 'S'],
        ['w1', 'Wide Out', 'NYJ', 'WR']
      ]
    }
  ]
  it('ranks graded players of the group, a traded player as one row', async () => {
    const lib = await seasons(specs)
    grade(lib, wk1, 10, 'g1', 'NYJ', 1)
    grade(lib, wk1, 11, 'g1', 'NYJ', 1, { critical: true })
    grade(lib, wk2, 10, 'g1', 'IND', -1)
    grade(lib, wk1, 10, 's1', 'NYJ', 0)
    grade(lib, wk1, 11, 's1', 'NYJ', null, { tags: ['Missed tackle'] })
    grade(lib, wk1, 10, 'w1', 'NYJ', 1)
    const rows = await lib.leaderboard(2025, 'DB')
    expect(rows.map((r) => [r.player.id, r.teams, r.games, r.tally.graded])).toEqual([
      ['g1', ['NYJ', 'IND'], 2, 3],
      ['s1', ['NYJ'], 1, 1]
    ])
    // 50 + 50 * (2 - 1 + 1) / (3 + 1) = 75
    expect(gradeScore(rows[0].tally)).toBe(75)
    // EPA from each team's side: NYJ defended +1 and -1, IND's offense +0.5.
    expect(rows[0].epa).toBeCloseTo((-1 + 1 + 0.5) / 3)
    expect(rows[0].lastGames.map((g) => g.gameId)).toEqual([wk2, wk1])
    expect((await lib.leaderboard(2025, 'WR')).map((r) => r.player.id)).toEqual(['w1'])
  })
  it('lists meetings across downloaded seasons, newest first', async () => {
    const lib = await seasons(specs)
    const m = await lib.matchup(2025, 'NYJ', 'IND')
    expect(m.meetings.map((x) => x.game.gameId)).toEqual(['2025_12_IND_NYJ', wk2, '2024_05_IND_NYJ'])
    expect(m.left.team.abbr).toBe('NYJ')
    expect(m.right.team.abbr).toBe('IND')
  })
})

describe('Cut-up evaluation', () => {
  const g1 = '2025_01_DAL_PHI'
  const g2 = '2025_02_PHI_KC'
  const specs: SeasonSpec[] = [
    { season: 2019, games: [['2019_01_DAL_PHI', '2019-09-08', 20]] },
    {
      season: 2025,
      games: [
        [g1, '2025-09-04', 24],
        [g2, '2025-09-14', 20]
      ],
      plays: [
        pbp(g1, 1, 'PHI', 'DAL', { down: 3, epa: 0.4 }),
        pbp(g1, 2, 'DAL', 'PHI', { down: 3, epa: 1.5 }),
        pbp(g1, 3, 'PHI', 'DAL', { down: 1, epa: -0.2 }),
        pbp(g2, 1, 'KC', 'PHI', { down: 3, epa: -2 }),
        pbp(g2, 2, 'PHI', 'KC', { down: 2, epa: 0.3 })
      ],
      roster: [['qb1', 'Jalen Q', 'PHI', 'QB']]
    }
  ]
  const third = { match: 'all' as const, rules: [{ field: 'down' as const, op: 'is' as const, value: ['3'] }], limit: null, order: 'game' as const }

  it('evaluates rules over games with film or grades, from the studied team’s side', async () => {
    const lib = await seasons(specs, [2019])
    const engine = new CutupEngine(lib)
    // g1 has film studied as PHI; g2 only has a grade.
    lib.store.replaceClips(g1, [{ path: '/c/1.mp4', fileName: '1.mp4', angle: 'sideline', playId: 1 }])
    lib.store.touchFilm(g1, 'PHI', false)
    grade(lib, g2, 2, 'qb1', 'PHI', 1)
    const preview = await engine.preview(third)
    expect(preview.sample.map((i) => [i.ref.gameId, i.ref.playId, i.team])).toEqual([
      [g1, 1, 'PHI'],
      [g1, 2, 'PHI'],
      [g2, 1, 'KC']
    ])
    // g2 has no studied team: the home team's side. With a focus team, that team's side.
    const focused = await engine.preview(third, { team: 'PHI' })
    expect(focused.sample.at(-1)!.team).toBe('PHI')
    expect(focused.sample.map((i) => i.teamEpa)).toEqual([0.4, -1.5, 2])
    expect(preview.playCount).toBe(3)
    expect(preview.gameCount).toBe(2)
  })

  it('orders by team EPA, limits, and side rules use the perspective team', async () => {
    const lib = await seasons(specs, [2019])
    const engine = new CutupEngine(lib)
    lib.store.touchFilm(g1, 'PHI', false)
    lib.store.touchFilm(g2, 'PHI', false)
    const best = await engine.preview({ ...third, order: 'epa-desc', limit: 2 })
    expect(best.sample.map((i) => [i.ref.gameId, i.ref.playId])).toEqual([
      [g2, 1],
      [g1, 1]
    ])
    const worst = await engine.preview({ ...third, order: 'epa-asc' })
    expect(worst.sample[0].ref).toEqual({ gameId: g1, playId: 2 })
    const newest = await engine.preview({ ...third, order: 'newest' })
    expect(newest.sample[0].ref.gameId).toBe(g2)
    const offense = await engine.preview({ match: 'all', rules: [{ field: 'side', op: 'is', value: ['offense'] }], limit: null, order: 'game' })
    expect(offense.sample.map((i) => `${i.ref.gameId}#${i.ref.playId}`)).toEqual([`${g1}#1`, `${g1}#3`, `${g2}#2`])
  })

  it('sees every play of a game from a focus player’s team, graded on the play or not', async () => {
    const lib = await seasons(specs, [2019])
    const engine = new CutupEngine(lib)
    // g1 is studied as PHI; DAL's d1 is graded on play 2 only.
    lib.store.touchFilm(g1, 'PHI', false)
    grade(lib, g1, 2, 'd1', 'DAL', 1)
    grade(lib, g1, 1, 'qb1', 'PHI', 1)
    const preview = await engine.preview(third, { playerId: 'd1' })
    expect(preview.sample.filter((i) => i.ref.gameId === g1).map((i) => [i.ref.playId, i.team])).toEqual([
      [1, 'DAL'],
      [2, 'DAL']
    ])
    const items = await engine.itemsForRefs([{ gameId: g1, playId: 1 }], { playerId: 'd1' })
    expect(items[0].team).toBe('DAL')
    const cut = lib.store.createCutup({ kind: 'manual', focus: { playerId: 'd1' }, plays: [{ gameId: g1, playId: 1 }] })
    expect((await engine.detail(cut.id))!.items[0].team).toBe('DAL')
  })

  it('reports seasons it couldn’t read, and smart results follow new grades', async () => {
    const lib = await seasons(specs, [2019])
    const engine = new CutupEngine(lib)
    grade(lib, '2019_01_DAL_PHI', 5, 'qb1', 'PHI', 1)
    grade(lib, g1, 3, 'qb1', 'PHI', 1)
    const cut = lib.store.createCutup({ kind: 'smart', rules: { match: 'all', rules: [{ field: 'status', op: 'is', value: ['graded'] }], limit: null, order: 'game' } })
    let detail = (await engine.detail(cut.id))!
    expect(detail.items.map((i) => i.ref.playId)).toEqual([3])
    expect(detail.skippedSeasons).toEqual([2019])
    expect(detail.items[0].entries).toEqual([{ playerId: 'qb1', name: 'Jalen Q', position: 'QB', grade: 1, critical: false, tags: [], note: '' }])
    grade(lib, g1, 1, 'qb1', 'PHI', -1)
    detail = (await engine.detail(cut.id))!
    expect(detail.items.map((i) => i.ref.playId)).toEqual([1, 3])
    const [summary] = await engine.summaries()
    expect(summary).toMatchObject({ playCount: 2, gameCount: 1, withoutFilm: 2, poster: null, duration: 0 })
  })

  it('builds manual cut-ups in user order, with plays of seasons not downloaded', async () => {
    const lib = await seasons(specs, [2019])
    const engine = new CutupEngine(lib)
    lib.store.replaceClips(g1, [{ path: '/c/3.mp4', fileName: '3.mp4', angle: 'endzone', playId: 3 }])
    lib.store.setClipDurations(g1, new Map([['/c/3.mp4', 6]]))
    const clip = lib.store.clipsForGame(g1)[0]
    lib.store.setClipSnap(clip.id, 2500)
    const cut = lib.store.createCutup({ kind: 'manual', plays: [{ gameId: g1, playId: 3 }, { gameId: '2019_01_DAL_PHI', playId: 9 }, { gameId: g2, playId: 1 }] })
    const detail = (await engine.detail(cut.id))!
    expect(detail.items.map((i) => [i.ref.playId, i.play?.playId ?? null, i.clips.length])).toEqual([
      [3, 3, 1],
      [9, null, 0],
      [1, 1, 0]
    ])
    expect(detail.skippedSeasons).toEqual([2019])
    expect(detail.items[0].addedAt).toBeTruthy()
    // Start at the snap with a 1 s pre-roll: 6 - 1.5 = 4.5 s, poster at the start point.
    const [summary] = await engine.summaries()
    expect(summary).toMatchObject({ playCount: 3, gameCount: 3, withoutFilm: 2, duration: 4.5, poster: { clipId: clip.id, at: 1.5 } })
    expect(await engine.refs(cut.id)).toHaveLength(3)
  })

  it('offers the values seen in the universe for the rules sheet', async () => {
    const lib = await seasons(specs, [2019])
    const engine = new CutupEngine(lib)
    lib.store.touchFilm(g1, 'PHI', false)
    grade(lib, g2, 1, 'qb1', 'PHI', 0)
    const opts = await engine.ruleOptions()
    expect(opts.seasons).toEqual([2025])
    expect(opts.games.map((g) => g.label)).toEqual(['2025 · Wk 2 · PHI @ KC', '2025 · Wk 1 · DAL @ PHI'])
    // No participation in this mirror.
    expect(opts.noLineupSeasons).toEqual([2025])
    expect(opts.tags.length).toBeGreaterThan(0)
  })
})
