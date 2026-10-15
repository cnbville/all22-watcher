import type { Clip, GameInfo, GradeEntry, Play, PlayNote } from './types'

/** Builders for unit-test fixtures (not used by the app). */

export function makeGame(o: Partial<GameInfo> = {}): GameInfo {
  return {
    gameId: '2025_01_DAL_PHI',
    season: 2025,
    week: 1,
    gameType: 'REG',
    gameday: '2025-09-04',
    homeTeam: 'PHI',
    awayTeam: 'DAL',
    homeScore: 24,
    awayScore: 20,
    ...o
  }
}

export function makePlay(o: Partial<Play> = {}): Play {
  return {
    playId: 1,
    gameId: '2025_01_DAL_PHI',
    qtr: 1,
    time: '10:00',
    down: 1,
    ydstogo: 10,
    yrdln: 'PHI 25',
    yardline100: 75,
    posteam: 'PHI',
    defteam: 'DAL',
    playType: 'pass',
    desc: 'J.Hurts pass short right to A.Brown for 8 yards',
    yardsGained: 8,
    epa: 0.5,
    success: true,
    isPass: true,
    isRush: false,
    special: false,
    shotgun: true,
    noHuddle: false,
    passLength: 'short',
    passLocation: 'right',
    runLocation: null,
    runGap: null,
    touchdown: false,
    turnover: false,
    giveaways: [],
    sack: false,
    penalty: false,
    involved: ['qb1', 'wr1'],
    formation: 'SHOTGUN',
    offPersonnel: '1 RB, 1 TE, 3 WR',
    defPersonnel: '4 DL, 2 LB, 5 DB',
    defendersInBox: 6,
    passRushers: 4,
    coverage: 'COVER_3',
    manZone: 'ZONE_COVERAGE',
    wasPressure: false,
    offensePlayers: ['qb1', 'wr1', 'ol1'],
    defensePlayers: ['cb1', 'lb1'],
    drive: 1,
    driveResult: 'Punt',
    ...o
  }
}

export function makeEntry(o: Partial<GradeEntry> = {}): GradeEntry {
  return { gameId: '2025_01_DAL_PHI', playId: 1, playerId: 'qb1', team: 'PHI', grade: 1, tags: [], note: '', critical: false, offField: false, ...o }
}

export function makeNote(o: Partial<PlayNote> = {}): PlayNote {
  return { gameId: '2025_01_DAL_PHI', playId: 1, note: '', chart: {}, drawing: {}, flagged: false, ...o }
}

export function makeClip(o: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    gameId: '2025_01_DAL_PHI',
    playId: 1,
    angle: 'sideline',
    path: '/clips/Sideline/Play 1.mp4',
    fileName: 'Play 1.mp4',
    sortIndex: 0,
    snapMs: null,
    duration: 6,
    ...o
  }
}
