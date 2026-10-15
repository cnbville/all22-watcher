import type { GameInfo, GradeEntry, Play, PlayNote, RosterPlayer } from '@shared/types'

/** Fixtures for the tape room's unit tests. */

export const GAME: GameInfo = {
  gameId: '2025_01_DAL_PHI', season: 2025, week: 1, gameType: 'REG', gameday: '2025-09-04', homeTeam: 'PHI', awayTeam: 'DAL',
  homeScore: 24, awayScore: 20
}

export function play(over: Partial<Play> & { playId: number }): Play {
  return {
    gameId: GAME.gameId, qtr: 1, time: '10:00', down: 1, ydstogo: 10, yrdln: 'PHI 25', yardline100: 75, posteam: 'PHI',
    defteam: 'DAL', playType: 'pass', desc: 'J.Hurts pass short left to A.Brown', yardsGained: 5, epa: 0.2, success: true,
    isPass: true, isRush: false, special: false, shotgun: true, noHuddle: false, passLength: 'short', passLocation: 'left',
    runLocation: null, runGap: null, touchdown: false, turnover: false, giveaways: [], sack: false, penalty: false,
    involved: [], formation: null, offPersonnel: null, defPersonnel: null, defendersInBox: null, passRushers: null,
    coverage: null, manZone: null, wasPressure: null, offensePlayers: [], defensePlayers: [], drive: 1, driveResult: 'Punt',
    ...over
  }
}

export function player(id: string, over: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    id, name: id, team: 'PHI', position: 'WR', depthPos: 'WR', group: 'WR', jersey: '11', status: 'ACT', headshot: '',
    college: '', height: '', weight: '', yearsExp: '', ...over
  }
}

export function entry(playId: number, playerId: string, over: Partial<GradeEntry> = {}): GradeEntry {
  return { gameId: GAME.gameId, playId, playerId, team: 'PHI', grade: null, tags: [], note: '', critical: false, offField: false, ...over }
}

export function note(playId: number, over: Partial<PlayNote> = {}): PlayNote {
  return { gameId: GAME.gameId, playId, note: '', chart: {}, drawing: {}, flagged: false, ...over }
}
