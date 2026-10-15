import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
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
    store.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 71, playerId: 'p1', team: 'DAL', grade: 1, tags: ['Run block win'], note: '' })
    store.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 112, playerId: 'p1', team: 'DAL', grade: -1, tags: [], note: 'late' })
    store.close()

    const reopened = await Store.open(file)
    const grades = reopened.gradesForPlayer('p1', 2025)
    expect(grades.map((g) => g.grade)).toEqual([1, -1])
    expect(grades[0].tags).toEqual(['Run block win'])
    expect(reopened.gradesForTeam('DAL', 2025)).toHaveLength(2)
    expect(reopened.gradesForPlayer('p1', 2024)).toHaveLength(0)
    expect(reopened.gradedPlayCounts(['2025_01_DAL_PHI'], 'DAL').get('2025_01_DAL_PHI')).toBe(2)
    expect(reopened.gradedPlayCounts(['2025_01_DAL_PHI'], 'PHI').get('2025_01_DAL_PHI')).toBeUndefined()

    reopened.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 71, playerId: 'p1', team: 'DAL', grade: null, tags: [], note: '' })
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
      store.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 71, playerId, team: 'DAL', grade: 1, tags, note: '' })
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
    store.saveGrade({ gameId: 'g', playId: 1, playerId: 'p1', team: 'DAL', grade: 1, tags: [], note: '' })
    store.close()
    const bytes = await readFile(file)
    await writeFile(file, bytes.subarray(0, 50))
    const { store: fresh, movedTo } = await Store.openOrRecover(file)
    expect(movedTo).not.toBeNull()
    expect(fresh.gradesForGame('g')).toEqual([])
  })

  it('moves a file with a damaged schema aside', async () => {
    const { store, file } = await freshStore()
    store.saveGrade({ gameId: 'g', playId: 1, playerId: 'p1', team: 'DAL', grade: 1, tags: [], note: '' })
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
