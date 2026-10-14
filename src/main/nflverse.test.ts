import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloadSeason, loadGamePlays, loadSeason, mirrorFetcher, playFromRow } from './nflverse'

describe('playFromRow', () => {
  const giveaways = (r: Record<string, string>) => playFromRow({ play_id: '1', game_id: 'g', ...r }).giveaways

  it('charges a lost fumble to the team that fumbled', () => {
    expect(giveaways({ posteam: 'DAL', defteam: 'PHI', fumble_lost: '1', fumbled_1_team: 'DAL', fumble_recovery_1_team: 'PHI' })).toEqual(['DAL'])
    // A muffed punt: the punting team has possession, the returner fumbles and the punting team recovers.
    const muff = { posteam: 'TEN', defteam: 'DEN', play_type: 'punt', fumble_lost: '1', fumbled_1_team: 'DEN', fumble_recovery_1_team: 'TEN' }
    expect(giveaways(muff)).toEqual(['DEN'])
    expect(giveaways({ posteam: 'SEA', defteam: 'CAR', fumble: '1', fumble_lost: '0', fumbled_1_team: 'SEA', fumble_recovery_1_team: 'SEA' })).toEqual([])
    expect(giveaways({ posteam: 'BAL', defteam: 'CIN', fumble_lost: '1', fumbled_1_team: 'BAL', fumble_recovery_1_team: 'NA' })).toEqual(['BAL'])
  })

  it('counts each change of possession on an interception return', () => {
    expect(giveaways({ posteam: 'OAK', defteam: 'KC', interception: '1' })).toEqual(['LV'])
    const back = {
      posteam: 'PHI', defteam: 'LAC', interception: '1', fumble_lost: '1',
      fumbled_1_team: 'LAC', fumble_recovery_1_team: 'PHI', fumbled_2_team: 'PHI', fumble_recovery_2_team: 'LAC'
    }
    expect(giveaways(back)).toEqual(['PHI', 'LAC', 'PHI'])
  })
})

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
