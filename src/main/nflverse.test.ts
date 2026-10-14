import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloadSeason, loadGamePlays, loadSeason, mirrorFetcher } from './nflverse'

// Runs against real nflverse files in a local folder: NFLVERSE_MIRROR=/path/to/files npm test
const mirror = process.env.NFLVERSE_MIRROR

describe.skipIf(!mirror)('nflverse season download', () => {
  it('builds a usable cache from release files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'all22-'))
    const steps: string[] = []
    await downloadSeason(2025, dir, mirrorFetcher(mirror!), (p) => steps.push(p.step))
    expect(steps.at(-1)).toBe('Done')

    const season = await loadSeason(dir, 2025)
    expect(season).not.toBeNull()
    expect(season!.games.length).toBeGreaterThan(270)
    expect(season!.teams).toHaveLength(32)
    expect(season!.meta.hasParticipation).toBe(true)

    const plays = await loadGamePlays(dir, '2025_01_DAL_PHI')
    const firstRun = plays.find((p) => p.playId === 71)!
    expect(firstRun.playType).toBe('run')
    expect(firstRun.offensePlayers).toHaveLength(11)
    expect(firstRun.involved.length).toBeGreaterThan(0)

    const phi = season!.teams.find((t) => t.team === 'PHI')!
    expect(phi.wins + phi.losses + phi.ties).toBe(17)
  }, 300_000)
})
