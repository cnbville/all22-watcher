export type Grade = -1 | 0 | 1

export type PositionGroup = 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DL' | 'LB' | 'DB' | 'ST'

export type Side = 'offense' | 'defense'

export type Angle = 'sideline' | 'endzone' | 'main'

export interface Team {
  abbr: string
  name: string
  nickname: string
  conference: 'AFC' | 'NFC'
  division: string
  color: string
  color2: string
}

export interface GameInfo {
  gameId: string
  season: number
  week: number
  gameType: string
  gameday: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
}

export interface Play {
  playId: number
  gameId: string
  qtr: number
  time: string
  down: number | null
  ydstogo: number | null
  yrdln: string
  yardline100: number | null
  posteam: string
  defteam: string
  playType: string
  desc: string
  yardsGained: number | null
  epa: number | null
  success: boolean | null
  isPass: boolean
  isRush: boolean
  special: boolean
  shotgun: boolean
  noHuddle: boolean
  passLength: string | null
  passLocation: string | null
  runLocation: string | null
  runGap: string | null
  touchdown: boolean
  turnover: boolean
  sack: boolean
  penalty: boolean
  /** Players credited in the play-by-play (passer, rusher, receiver, tacklers, defenders). */
  involved: string[]
  // From nflverse participation data, when published for the season.
  formation: string | null
  offPersonnel: string | null
  defPersonnel: string | null
  defendersInBox: number | null
  passRushers: number | null
  coverage: string | null
  manZone: string | null
  wasPressure: boolean | null
  offensePlayers: string[]
  defensePlayers: string[]
}

export interface RosterPlayer {
  id: string
  name: string
  team: string
  position: string
  depthPos: string
  group: PositionGroup
  jersey: string
  status: string
  headshot: string
  college: string
  height: string
  weight: string
  yearsExp: string
}

/** One player's box score for one game; only non-zero stat keys are kept. */
export interface PlayerWeek {
  playerId: string
  gameId: string
  week: number
  seasonType: string
  team: string
  opponent: string
  stats: Record<string, number>
}

export interface Snaps {
  offense: number
  defense: number
  special: number
}

export interface TeamRankedStat {
  key: string
  label: string
  value: number
  rank: number
  format: 'int' | 'dec1' | 'dec2' | 'pct'
  /** Neither good nor bad (like pass rate), so the rank isn't colored. */
  neutral?: boolean
}

export interface TeamSummary {
  team: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  games: number
  offense: TeamRankedStat[]
  defense: TeamRankedStat[]
}

export interface Clip {
  id: number
  gameId: string
  path: string
  fileName: string
  angle: Angle
  sortIndex: number
  playId: number | null
}

export interface GradeEntry {
  gameId: string
  playId: number
  playerId: string
  team: string
  grade: Grade | null
  tags: string[]
  note: string
}

export interface Stroke {
  color: string
  width: number
  points: [number, number][]
}

export interface PlayNote {
  gameId: string
  playId: number
  note: string
  chart: Record<string, string>
  drawing: Partial<Record<Angle, Stroke[]>>
  flagged: boolean
}

export interface TagDef {
  id: number
  group: PositionGroup
  label: string
  kind: 'pos' | 'neg' | 'neutral'
}

export interface ChartField {
  id: number
  name: string
  options: string[]
}

export interface Settings {
  autoAdvance: boolean
  defaultSpeed: number
  pinned: Record<string, string[]>
}

export interface SeasonStatus {
  season: number
  downloaded: boolean
  downloadedAt: string | null
  hasParticipation: boolean
}

export interface DataProgress {
  season: number
  step: string
  done: number
  total: number
  error?: string
}

export interface GradeTally {
  graded: number
  plus: number
  zero: number
  minus: number
}

export interface TeamGame extends GameInfo {
  clipCount: number
  playCount: number
  gradedPlays: number
}

export interface TeamRosterRow extends RosterPlayer {
  snaps: number
  tally: GradeTally
}

export interface TeamOverview {
  team: Team
  season: number
  summary: TeamSummary | null
  games: TeamGame[]
  roster: TeamRosterRow[]
}

export interface RecentFilm {
  game: GameInfo
  team: string
  clipCount: number
  playCount: number
  gradedPlays: number
}

export interface GameFilm {
  game: GameInfo
  plays: Play[]
  clips: Clip[]
  grades: GradeEntry[]
  notes: PlayNote[]
  players: Record<string, RosterPlayer>
  hasParticipation: boolean
}

export interface ClipMatchRow {
  path: string
  fileName: string
  angle: Angle
  playId: number | null
}

export interface MatchPreview {
  gameId: string
  rows: ClipMatchRow[]
  plays: Play[]
  includeSpecialTeams: boolean
  includeNoPlays: boolean
  unsupported: string[]
  warnings: string[]
}

export interface PlayerGameLine {
  game: GameInfo
  team: string
  opponent: string
  snaps: Snaps | null
  stats: Record<string, number>
  tally: GradeTally
}

export interface ReelItem {
  gameId: string
  team: string
  playId: number
  week: number
  opponent: string
  play: Play | null
  clips: Clip[]
  grade: Grade | null
  tags: string[]
  note: string
}

export interface PlayerProfile {
  player: RosterPlayer
  season: number
  totals: Record<string, number>
  games: PlayerGameLine[]
  tally: GradeTally
  tagCounts: { tag: string; count: number }[]
  reel: ReelItem[]
}
