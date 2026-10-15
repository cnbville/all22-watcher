import { describe, expect, it } from 'vitest'
import type { AlignmentSuspect, ClipMatchRow, Play } from '@shared/types'
import { angleFolders, clipName, countMismatch, gameNameCandidates, lengthLabel, suspectFix, summaryLine } from './importModel'

const row = (path: string, angle: ClipMatchRow['angle'], playId: number | null = 1): ClipMatchRow => ({
  path,
  fileName: path.split('/').pop()!,
  angle,
  playId
})

const copy = '/data/converted/2025_01_DAL_PHI/99a6cfac/Sideline/Play 3.mkv.mp4'

describe('import model', () => {
  it('shows a converted copy under its original name', () => {
    expect(clipName(row(copy, 'sideline'))).toBe('Play 3.mkv')
    expect(clipName(row('/film/Sideline/Play 3.mp4', 'sideline'))).toBe('Play 3.mp4')
  })

  it('groups clips by folder and merges converted copies into the folder they came from', () => {
    const folders = angleFolders([
      row('/film/DAL at PHI/Sideline/Play 1.mp4', 'sideline'),
      row('/film/DAL at PHI/Sideline/Play 2.mp4', 'sideline'),
      row(copy, 'sideline'),
      row('/film/DAL at PHI/End Zone/Play 1.mp4', 'endzone')
    ])
    expect(folders.map((f) => [f.label, f.angle, f.count])).toEqual([
      ['End Zone', 'endzone', 1],
      ['Sideline', 'sideline', 3]
    ])
  })

  it('reports clip counts per angle only when they differ from the plays', () => {
    const rows = [row('/a/1.mp4', 'sideline'), row('/a/2.mp4', 'sideline'), row('/b/1.mp4', 'endzone')]
    expect(countMismatch(rows, 2)).toEqual([
      { angle: 'sideline', clips: 2 },
      { angle: 'endzone', clips: 1 }
    ])
    expect(countMismatch(rows.slice(0, 2), 2)).toBeNull()
  })

  it('lists folder names nearest first as game-name candidates', () => {
    expect(gameNameCandidates(['/Users/coach/Film/2025 Wk 1 DAL @ PHI/Sideline/Play 1.mp4'])).toEqual([
      'Sideline',
      '2025 Wk 1 DAL @ PHI',
      'Film',
      'Play 1.mp4'
    ])
  })

  it('suggests sliding when the better play is next door, and moving otherwise', () => {
    const plays = [10, 11, 12, 13].map((playId) => ({ playId }) as Play)
    const suspect = (playId: number, betterPlayId: number | null) => ({ playId, betterPlayId }) as AlignmentSuspect
    expect(suspectFix(suspect(11, 12), plays)).toMatchObject({ kind: 'shift', delta: 1, label: 'Slide Later' })
    expect(suspectFix(suspect(11, 10), plays)).toMatchObject({ kind: 'shift', delta: -1, label: 'Slide Earlier' })
    expect(suspectFix(suspect(10, 13), plays)).toEqual({ kind: 'move', playId: 13, label: 'Move' })
    expect(suspectFix(suspect(10, null), plays)).toBeNull()
  })

  it('formats lengths and the summary line', () => {
    expect(lengthLabel(5.43)).toBe('5.4 s')
    expect(lengthLabel(12.6)).toBe('13 s')
    expect(lengthLabel(null)).toBe('')
    expect(summaryLine([row('/a/1.mp4', 'sideline', 1), row('/b/1.mp4', 'endzone', 1), row('/a/2.mp4', 'sideline', null)])).toBe('3 clips · 2 angles · 1 play')
  })
})
