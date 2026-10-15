import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import type { GradeEntry } from '@shared/types'
import { Store } from './db'

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'all22-db-'))
  return { store: await Store.open(join(dir, 'grades.sqlite')), file: join(dir, 'grades.sqlite') }
}

describe('Store', () => {
  it('seeds default tags and chart fields', async () => {
    const { store } = await freshStore()
    expect(store.tags().filter((t) => t.group === 'OL').map((t) => t.label)).toContain('Pass pro win')
    expect(store.chartFields().map((f) => f.name)).toContain('Coverage shell')
  })

  it('saves grades, keeps them across reopen, and deletes empty ones', async () => {
    const { store, file } = await freshStore()
    store.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 71, playerId: 'p1', team: 'DAL', grade: 1, tags: ['Run block win'], note: '', critical: false, offField: false })
    store.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 112, playerId: 'p1', team: 'DAL', grade: -1, tags: [], note: 'late', critical: false, offField: false })
    store.close()

    const reopened = await Store.open(file)
    const grades = reopened.gradesForPlayer('p1', 2025)
    expect(grades.map((g) => g.grade)).toEqual([1, -1])
    expect(grades[0].tags).toEqual(['Run block win'])
    expect(reopened.gradesForTeam('DAL', 2025)).toHaveLength(2)
    expect(reopened.gradesForPlayer('p1', 2024)).toHaveLength(0)
    expect(reopened.gradedPlayCounts(['2025_01_DAL_PHI'], 'DAL').get('2025_01_DAL_PHI')).toBe(2)
    expect(reopened.gradedPlayCounts(['2025_01_DAL_PHI'], 'PHI').get('2025_01_DAL_PHI')).toBeUndefined()

    reopened.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 71, playerId: 'p1', team: 'DAL', grade: null, tags: [], note: '', critical: false, offField: false })
    expect(reopened.gradesForPlayer('p1', 2025)).toHaveLength(1)
  })

  it('seeds the defaults only once, so emptied lists stay empty', async () => {
    const { store, file } = await freshStore()
    store.saveChartFields([])
    store.saveTags(store.tags().filter((t) => t.group !== 'QB'))
    store.close()

    const reopened = await Store.open(file)
    expect(reopened.chartFields()).toEqual([])
    expect(reopened.tags().filter((t) => t.group === 'QB')).toEqual([])
    expect(reopened.settings()).not.toHaveProperty('seeded')
  })

  it('marks a database from before seed-once as seeded without reseeding it', async () => {
    const { store, file } = await freshStore()
    store.saveChartFields([{ name: 'Front', options: ['Over', 'Under'] }])
    store.close()
    const SQL = await initSqlJs()
    const old = new SQL.Database(readFileSync(file))
    old.run("DELETE FROM settings WHERE key = 'seeded'")
    writeFileSync(file, Buffer.from(old.export()))

    const upgraded = await Store.open(file)
    expect(upgraded.chartFields().map((f) => f.name)).toEqual(['Front'])
    upgraded.saveChartFields([])
    upgraded.close()
    expect((await Store.open(file)).chartFields()).toEqual([])
  })

  it('renames a tag on existing grades, but not a label another group still uses', async () => {
    const { store } = await freshStore()
    const grade = (playerId: string, tags: string[]) =>
      store.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 71, playerId, team: 'DAL', grade: 1, tags, note: '', critical: false, offField: false })
    const tagsOf = (playerId: string) => store.gradesForGame('2025_01_DAL_PHI').find((g) => g.playerId === playerId)!.tags
    grade('ol', ['Pancake', 'Penalty'])
    grade('wr', ['Drop', 'Route win'])

    const pancake = store.tags().find((t) => t.group === 'OL' && t.label === 'Pancake')!
    const renamed = store.saveTags(store.tags().map((t) => (t.id === pancake.id ? { ...t, label: 'Pancake block' } : t)))
    expect(renamed.find((t) => t.label === 'Pancake block')!.id).toBe(pancake.id)
    expect(tagsOf('ol')).toEqual(['Pancake block', 'Penalty'])

    // 'Drop' is also an RB and TE tag, and the grade doesn't say which group it came from.
    store.saveTags(store.tags().map((t) => (t.group === 'WR' && t.label === 'Drop' ? { ...t, label: 'Dropped pass' } : t)))
    expect(tagsOf('wr')).toEqual(['Drop', 'Route win'])
    store.saveTags(store.tags().map((t) => (t.label === 'Drop' ? { ...t, label: 'Dropped pass' } : t)))
    expect(tagsOf('wr')).toEqual(['Dropped pass', 'Route win'])
    // Renamed two different ways (WR and TE both had it): no telling which one the grade meant.
    store.saveTags(store.tags().map((t) => (t.label === 'Route win' ? { ...t, label: `${t.group} route win` } : t)))
    expect(tagsOf('wr')).toEqual(['Dropped pass', 'Route win'])

    // A tag removed and another added (no id carried over) isn't a rename.
    store.saveTags([
      ...store.tags().filter((t) => t.label !== 'Penalty'),
      { group: 'OL', label: 'Holding', kind: 'neg' }
    ])
    expect(tagsOf('ol')).toEqual(['Pancake block', 'Penalty'])
  })

  it('keeps charted values when a chart field or option is renamed', async () => {
    const { store } = await freshStore()
    const note = { gameId: 'g', playId: 1, note: '', drawing: {}, flagged: false }
    store.savePlayNote({ ...note, chart: { 'Coverage shell': 'Cover 3', Pressure: '5+ blitz', 'Run concept': 'Power' } })
    const chart = () => store.notesForGame('g')[0].chart

    const fields = store.chartFields()
    const saved = store.saveChartFields(
      fields.map((f) =>
        f.name === 'Coverage shell' ? { ...f, name: 'Shell', options: f.options.map((o) => (o === 'Cover 3' ? 'Cover 3 sky' : o)) } : f
      )
    )
    expect(saved.map((f) => f.id)).toEqual(fields.map((f) => f.id))
    expect(chart()).toEqual({ Shell: 'Cover 3 sky', Pressure: '5+ blitz', 'Run concept': 'Power' })

    // Swapping two names swaps their values; removing an option or a field keeps what was charted.
    store.saveChartFields(
      store.chartFields().map((f) => ({
        ...f,
        name: f.name === 'Pressure' ? 'Run concept' : f.name === 'Run concept' ? 'Pressure' : f.name,
        options: f.name === 'Shell' ? f.options.filter((o) => o !== 'Cover 3 sky') : f.options
      }))
    )
    expect(chart()).toEqual({ Shell: 'Cover 3 sky', Pressure: 'Power', 'Run concept': '5+ blitz' })
    store.saveChartFields(store.chartFields().filter((f) => f.name !== 'Pressure'))
    expect(chart()).toEqual({ Shell: 'Cover 3 sky', Pressure: 'Power', 'Run concept': '5+ blitz' })
  })

  it('replaces clips per game and relinks them', async () => {
    const { store } = await freshStore()
    store.replaceClips('g', [
      { path: '/a/1.mp4', fileName: '1.mp4', angle: 'sideline', playId: 10 },
      { path: '/a/2.mp4', fileName: '2.mp4', angle: 'sideline', playId: 20 },
      { path: '/b/1.mp4', fileName: '1.mp4', angle: 'endzone', playId: 10 }
    ])
    const clips = store.clipsForGame('g')
    expect(clips).toHaveLength(3)
    store.relinkClip(clips[0].id, null)
    expect(store.clipById(clips[0].id)!.playId).toBeNull()
    expect(store.clipCounts(['g']).get('g')).toBe(3)
  })

  it('merges settings patches', async () => {
    const { store } = await freshStore()
    store.saveSettings({ autoAdvance: true, pinned: { DAL: ['p1'] } })
    expect(store.settings()).toMatchObject({ autoAdvance: true, defaultSpeed: 1, pinned: { DAL: ['p1'] } })
  })
})

/** The v1 schema, exactly as v1 created it, with a few rows in it. */
const V1_SCHEMA = `
CREATE TABLE clips (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL, path TEXT NOT NULL, file_name TEXT NOT NULL,
  angle TEXT NOT NULL, sort_index INTEGER NOT NULL, play_id INTEGER, UNIQUE (game_id, path));
CREATE INDEX clips_game ON clips (game_id);
CREATE TABLE grades (game_id TEXT NOT NULL, play_id INTEGER NOT NULL, player_id TEXT NOT NULL, team TEXT NOT NULL, grade INTEGER,
  tags TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY (game_id, play_id, player_id));
CREATE TABLE play_notes (game_id TEXT NOT NULL, play_id INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', chart TEXT NOT NULL DEFAULT '{}',
  drawing TEXT NOT NULL DEFAULT '{}', flagged INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (game_id, play_id));
CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, grp TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL);
CREATE TABLE chart_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, options TEXT NOT NULL, sort INTEGER NOT NULL);
CREATE TABLE film_games (game_id TEXT PRIMARY KEY, team TEXT NOT NULL, imported_at TEXT NOT NULL, opened_at TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO clips (game_id, path, file_name, angle, sort_index, play_id) VALUES ('2025_01_DAL_PHI', '/f/1.mp4', '1.mp4', 'sideline', 0, 40);
INSERT INTO grades VALUES ('2025_01_DAL_PHI', 40, 'p1', 'PHI', 1, '["Pancake"]', 'nice', '2025-09-10T00:00:00.000Z');
INSERT INTO play_notes VALUES ('2025_01_DAL_PHI', 40, 'watch the edge', '{"Front":"Over"}',
  '{"sideline":[{"color":"#FFD60A","width":3,"points":[[0.1,0.1],[0.5,0.5]]}]}', 1);
INSERT INTO film_games VALUES ('2025_01_DAL_PHI', 'PHI', '2025-09-09T00:00:00.000Z', '2025-09-10T00:00:00.000Z');
INSERT INTO settings VALUES ('seeded', 'true');
INSERT INTO settings VALUES ('autoAdvance', 'true');
`

describe('v1 database migration', () => {
  async function v1File() {
    const dir = await mkdtemp(join(tmpdir(), 'all22-v1-'))
    const file = join(dir, 'grades.sqlite')
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.exec(V1_SCHEMA)
    writeFileSync(file, Buffer.from(db.export()))
    return { dir, file }
  }

  it('adds the new columns in place, keeps every row and backs up the v1 file once', async () => {
    const { dir, file } = await v1File()
    const original = await readFile(file)
    const store = await Store.open(file)
    expect(store.migrate()).toEqual([]) // already migrated by open; a second run changes nothing
    store.close()
    expect(await readFile(`${file}.v1-backup`)).toEqual(original)

    const again = await Store.open(file)
    const [grade] = again.gradesForGame('2025_01_DAL_PHI')
    expect(grade).toMatchObject({ grade: 1, tags: ['Pancake'], note: 'nice', critical: false, offField: false })
    const [clip] = again.clipsForGame('2025_01_DAL_PHI')
    expect(clip).toMatchObject({ playId: 40, snapMs: null, duration: null })
    const [note] = again.notesForGame('2025_01_DAL_PHI')
    expect(note.chart).toEqual({ Front: 'Over' })
    expect(note.flagged).toBe(true)
    expect(note.drawing.sideline).toEqual([
      { id: 'v1-0', kind: 'pen', color: '#FFD60A', width: 3, points: [[0.1, 0.1], [0.5, 0.5]], end: 'arrow', start: 0, duration: null }
    ])
    expect(again.settings()).toMatchObject({ autoAdvance: true, startAtSnap: true, preRoll: 1, myTeams: [], watchFolder: null })
    expect(again.recentFilm()).toEqual([{ gameId: '2025_01_DAL_PHI', team: 'PHI', openedAt: '2025-09-10T00:00:00.000Z' }])
    // Seeded flag was set by v1, so the tag list (empty here) is not refilled.
    expect(again.tags()).toEqual([])
    expect((await readdir(dir)).sort()).toEqual(['grades.sqlite', 'grades.sqlite.v1-backup'])
  })

  it('does not make a backup for a new database', async () => {
    const { store, file } = await freshStore()
    store.close()
    expect(existsSync(`${file}.v1-backup`)).toBe(false)
  })
})

describe('v2 store additions', () => {
  const entry = (extra: Partial<GradeEntry>): GradeEntry => ({
    gameId: 'g', playId: 1, playerId: 'p1', team: 'PHI', grade: null, tags: [], note: '', critical: false, offField: false, ...extra
  })

  it('keeps a row that is only critical or only Not on Field, and clears grade and critical when off the field', async () => {
    const { store } = await freshStore()
    store.saveGrade(entry({ critical: true }))
    expect(store.gradesForGame('g')).toMatchObject([{ grade: null, critical: true }])
    store.saveGrade(entry({ grade: 1, critical: true, offField: true }))
    expect(store.gradesForGame('g')).toMatchObject([{ grade: null, critical: false, offField: true }])
    store.saveGrade(entry({}))
    expect(store.gradesForGame('g')).toEqual([])
  })

  it('keeps snap points and durations by path when clips are replaced, and rejects a snap for a gone clip', async () => {
    const { store } = await freshStore()
    store.replaceClips('g', [
      { path: '/a/1.mp4', fileName: '1.mp4', angle: 'sideline', playId: 10 },
      { path: '/a/2.mp4', fileName: '2.mp4', angle: 'sideline', playId: 20 }
    ])
    const [first] = store.clipsForGame('g')
    store.setClipSnap(first.id, 1800)
    store.setClipDurations('g', new Map([['/a/1.mp4', 6.5]]))
    store.replaceClips('g', [
      { path: '/a/1.mp4', fileName: '1.mp4', angle: 'sideline', playId: 20 },
      { path: '/a/3.mp4', fileName: '3.mp4', angle: 'sideline', playId: 30 }
    ])
    const clips = store.clipsForGame('g')
    expect(clips.map((c) => [c.path, c.snapMs, c.duration])).toEqual([
      ['/a/1.mp4', 1800, 6.5],
      ['/a/3.mp4', null, null]
    ])
    expect(() => store.setClipSnap(first.id, 100)).toThrow('That clip is no longer in your film.')
  })

  it('creates, names, fills, reorders, duplicates and deletes cut-ups', async () => {
    const { store } = await freshStore()
    const a = store.createCutup({ kind: 'manual' })
    const b = store.createCutup({ kind: 'manual', name: '  ' })
    const s = store.createCutup({ kind: 'smart', rules: { match: 'all', rules: [{ field: 'down', op: 'is', value: ['3'] }], limit: null, order: 'game' } })
    expect([a.name, b.name, s.name]).toEqual(['Untitled Cut-up', 'Untitled Cut-up 2', 'Untitled Smart Cut-up'])
    expect(a.id).toMatch(/^cu_[0-9a-z]{10}$/)

    const p = (playId: number) => ({ gameId: 'g', playId })
    expect(store.addToCutup(a.id, [p(1), p(2), p(1)])).toEqual({ added: 2, already: 0 })
    expect(store.addToCutup(a.id, [p(2), p(3)])).toEqual({ added: 1, already: 1 })
    expect(store.cutupPlays(a.id).map((x) => x.playId)).toEqual([1, 2, 3])
    expect(() => store.addToCutup(s.id, [p(1)])).toThrow(/smart/)

    store.reorderCutup(a.id, [p(3), p(1)])
    expect(store.cutupPlays(a.id).map((x) => x.playId)).toEqual([3, 1, 2])
    store.removeFromCutup(a.id, [p(1)])
    expect(store.cutupPlays(a.id).map((x) => x.playId)).toEqual([3, 2])

    const copy = store.duplicateCutup(a.id)
    expect(copy.name).toBe('Untitled Cut-up copy')
    expect(store.cutupPlays(copy.id).map((x) => x.playId)).toEqual([3, 2])
    expect(store.cutups().map((c) => c.id)).toEqual([a.id, copy.id, b.id, s.id])
    expect(store.duplicateCutup(a.id).name).toBe('Untitled Cut-up copy 2')

    const fixed = store.duplicateCutup(s.id, [p(7), p(8)])
    expect([fixed.kind, fixed.name, store.cutupPlays(fixed.id).length]).toEqual(['manual', 'Untitled Smart Cut-up (fixed)', 2])

    store.reorderCutups([s.id, a.id])
    expect(store.cutups().slice(0, 2).map((c) => c.id)).toEqual([s.id, a.id])
    expect(store.updateCutup(s.id, { name: 'Third downs', focus: { team: 'PHI' } })).toMatchObject({ name: 'Third downs', focus: { team: 'PHI' } })

    store.deleteCutup(a.id)
    expect(store.cutupById(a.id)).toBeNull()
    expect(store.cutupPlays(a.id)).toEqual([])
  })

  it('logs imports, newest first', async () => {
    const { store } = await freshStore()
    const base = { gameId: 'g', team: 'PHI', state: 'done' as const, clipCount: 10, playCount: 5, suspectClips: 0, error: null }
    store.logImport({ ...base, folder: '/w/one', source: 'watch', signature: 'abc' })
    store.logImport({ ...base, folder: '/w/two', source: 'manual' })
    expect(store.importLog(5).map((e) => e.folder)).toEqual(['/w/two', '/w/one'])
    expect(store.importLog(5, 'watch').map((e) => e.folder)).toEqual(['/w/one'])
    expect(store.lastWatchImport('/w/one')?.signature).toBe('abc')
  })

  it('treats a watch-folder re-import as new until opened, but keeps the open time for imports made in the app', async () => {
    const { store } = await freshStore()
    const openedAt = (gameId: string) => store.recentFilm().find((f) => f.gameId === gameId)?.openedAt ?? null
    for (const gameId of ['w', 'm']) store.replaceClips(gameId, [{ path: `/c/${gameId}.mp4`, fileName: `${gameId}.mp4`, angle: 'sideline', playId: 1 }])
    store.touchFilm('w', 'PHI', true)
    store.touchFilm('m', 'PHI', true)
    store.touchFilm('w', 'PHI', false, 'watch')
    store.touchFilm('m', 'PHI', false, 'manual')
    expect(openedAt('w')).toBeNull()
    expect(openedAt('m')).not.toBeNull()
  })
})

describe('Store.openOrRecover', () => {
  it('opens a good file as is', async () => {
    const { store, file } = await freshStore()
    store.saveSettings({ autoAdvance: true })
    store.close()
    const { store: reopened, movedTo } = await Store.openOrRecover(file)
    expect(movedTo).toBeNull()
    expect(reopened.settings().autoAdvance).toBe(true)
  })

  it('moves an unreadable file aside and starts fresh', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-db-'))
    const file = join(dir, 'grades.sqlite')
    await writeFile(file, 'not a database at all')
    const { store, movedTo } = await Store.openOrRecover(file)
    expect(movedTo).toMatch(/grades\.sqlite\.corrupt-/)
    expect(await readFile(movedTo!, 'utf8')).toBe('not a database at all')
    expect(store.tags().length).toBeGreaterThan(0)
    expect((await readdir(dir)).sort()).toEqual(['grades.sqlite', movedTo!.slice(dir.length + 1)])
  })

  it('moves a truncated file aside', async () => {
    const { store, file } = await freshStore()
    store.saveGrade({ gameId: 'g', playId: 1, playerId: 'p1', team: 'DAL', grade: 1, tags: [], note: '', critical: false, offField: false })
    store.close()
    const bytes = await readFile(file)
    await writeFile(file, bytes.subarray(0, 50))
    const { store: fresh, movedTo } = await Store.openOrRecover(file)
    expect(movedTo).not.toBeNull()
    expect(fresh.gradesForGame('g')).toEqual([])
  })

  it('moves a file with a damaged schema aside', async () => {
    const { store, file } = await freshStore()
    store.saveGrade({ gameId: 'g', playId: 1, playerId: 'p1', team: 'DAL', grade: 1, tags: [], note: '', critical: false, offField: false })
    store.close()
    const bytes = await readFile(file)
    bytes.write('CREATE TABLX', bytes.indexOf('CREATE TABLE clips'))
    await writeFile(file, bytes)
    const { store: fresh, movedTo } = await Store.openOrRecover(file)
    expect(movedTo).not.toBeNull()
    expect(await readFile(movedTo!)).toEqual(bytes)
    expect(fresh.gradesForGame('g')).toEqual([])
  })

  it('moves a file with a damaged header aside', async () => {
    const { store, file } = await freshStore()
    store.close()
    const bytes = await readFile(file)
    // Offset 44 holds the schema format number, which SQLite refuses above 4.
    bytes.writeUInt32BE(99, 44)
    await writeFile(file, bytes)
    const { movedTo } = await Store.openOrRecover(file)
    expect(movedTo).not.toBeNull()
    expect(await readFile(movedTo!)).toEqual(bytes)
  })

  it('leaves the file alone when opening fails for another reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-db-'))
    const file = join(dir, 'grades.sqlite')
    await mkdir(file)
    await expect(Store.openOrRecover(file)).rejects.toThrow(/EISDIR/)
    expect(await readdir(dir)).toEqual(['grades.sqlite'])
  })
})
