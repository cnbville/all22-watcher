import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    expect(reopened.gradedPlayCounts(['2025_01_DAL_PHI']).get('2025_01_DAL_PHI')).toBe(2)

    reopened.saveGrade({ gameId: '2025_01_DAL_PHI', playId: 71, playerId: 'p1', team: 'DAL', grade: null, tags: [], note: '' })
    expect(reopened.gradesForPlayer('p1', 2025)).toHaveLength(1)
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

  it('leaves the file alone when opening fails for another reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-db-'))
    const file = join(dir, 'grades.sqlite')
    await mkdir(file)
    await expect(Store.openOrRecover(file)).rejects.toThrow(/EISDIR/)
    expect(await readdir(dir)).toEqual(['grades.sqlite'])
  })
})
