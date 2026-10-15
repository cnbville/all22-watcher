import type { Drawing } from './drawing'
export type { Drawing, LegacyStroke, Shape } from './drawing'

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
  /** The team that lost the ball, once per turnover (an interception returned and fumbled back lists both teams). */
  giveaways: string[]
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
  /** nflverse fixed_drive; null in seasons cached before drives were read. */
  drive: number | null
  /** nflverse fixed_drive_result, e.g. "Touchdown", "Punt". */
  driveResult: string | null
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
  /** The side the player was on in that game. */
  team: string
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

/** Regular-season games only, so the record, points and ranks agree. */
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
  /** Snap point in milliseconds of clip time, or null when not marked. */
  snapMs: number | null
  /** Clip length in seconds, read at import (null when it couldn't be read). Used by the alignment check. */
  duration: number | null
}

export interface GradeEntry {
  gameId: string
  playId: number
  playerId: string
  team: string
  grade: Grade | null
  tags: string[]
  note: string
  /** Game-changing play: counts double in every grade once the entry has a grade. */
  critical: boolean
  /** Not on Field: the player wasn't on the field for this snap (grade null, critical false). */
  offField: boolean
}

export interface PlayNote {
  gameId: string
  playId: number
  note: string
  chart: Record<string, string>
  drawing: Drawing
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
  /** Replays, reels, cut-ups and exports start at each clip's snap point (minus the pre-roll). */
  startAtSnap: boolean
  /** Seconds of pre-snap look before the snap: 0, 0.5, 1, 1.5, 2 or 3. */
  preRoll: number
  welcomeSeen: boolean
  /** Sidebar My Teams, ordered abbreviations. */
  myTeams: string[]
  /** Teams the user removed from My Teams, so they aren't added back automatically. */
  myTeamsRemoved: string[]
  /** Folder watched for new game folders; null = off. */
  watchFolder: string | null
  watchPaused: boolean
  /** Re-download the current season's data on launch and every 6 hours during the season. */
  autoUpdateSeasons: boolean
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
  /** All graded entries (raw counts). */
  graded: number
  plus: number
  zero: number
  minus: number
  /** Graded entries marked critical. */
  critical: number
  /** Of those, the + and − ones (critical zeros = critical − critPlus − critMinus). */
  critPlus: number
  critMinus: number
}

export interface TeamGame extends GameInfo {
  clipCount: number
  playCount: number
  gradedPlays: number
}

export interface TeamRosterRow extends RosterPlayer {
  snaps: number
  tally: GradeTally
  /** Teams the player played for this season, by first game. */
  teams: string[]
}

export type UnitKey = PositionGroup | 'OFF' | 'DEF'

export interface UnitGameLine {
  gameId: string
  week: number
  gameType: string
  opponent: string
  home: boolean
  /** Only units with grades. */
  units: Partial<Record<UnitKey, GradeTally>>
}

export interface TeamOverview {
  team: Team
  season: number
  summary: TeamSummary | null
  games: TeamGame[]
  roster: TeamRosterRow[]
  /** Games with any grade for the team, in date order. */
  unitsByGame: UnitGameLine[]
  rosterTrend: Record<string, { gameId: string; grade: number }[]>
  /** Mean team EPA on the player's graded scrimmage plays. */
  rosterEpa: Record<string, number | null>
  hasParticipation: boolean
}

export interface PlayRef {
  gameId: string
  playId: number
}

export interface RecentFilm {
  game: GameInfo
  team: string
  clipCount: number
  playCount: number
  gradedPlays: number
  /** First play, in play order, with a clip and no grade for `team`; null when all are graded. */
  resumePlayId: number | null
  /** The resume play's clip (sideline, else main, else end zone) and its snap point in seconds. */
  poster: { clipId: number; at: number } | null
  /** null = imported but never opened. */
  openedAt: string | null
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
  critical: boolean
  /** Play note flag. */
  flagged: boolean
  /** Play note text (`note` is the grade note). */
  playNote: string
  teamEpa: number | null
  teamSuccess: boolean | null
  /** The play's charting (PlayNote.chart), for chart-field splits and tokens. */
  chart: Record<string, string>
  /** The play's drawings, for the reel player. */
  drawing: Drawing | null
}

export interface PlayerProfile {
  player: RosterPlayer
  season: number
  totals: Record<string, number>
  games: PlayerGameLine[]
  tally: GradeTally
  tagCounts: { tag: string; count: number }[]
  reel: ReelItem[]
  /** In order; more than one means traded or signed mid-season. */
  teams: { team: string; firstWeek: number; lastWeek: number }[]
  hasParticipation: boolean
}

// ── Home, teams, players (03 §2.2.1) ─────────────────────────────────────────

export interface RecentPlayer {
  playerId: string
  season: number
  name: string
  team: string
  /** depthPos || position */
  position: string
  headshot: string
  /** That season. */
  tally: GradeTally
  /** ISO time of the newest grade. */
  lastGradedAt: string
}

export interface TeamCard {
  team: string
  wins: number
  losses: number
  ties: number
  /** Earliest game with no score. */
  nextGame: GameInfo | null
  /** Latest scored game. */
  lastGame: GameInfo | null
  gamesWithFilm: number
  /** Plays in games with film. */
  playCount: number
  gradedPlays: number
}

export interface TeamFilmStats {
  gamesWithFilm: number
  playCount: number
  gradedPlays: number
}

export interface PlayerSeasonLine {
  season: number
  /** That season's entry (team, position, jersey). */
  player: RosterPlayer
  matchedBy: 'id' | 'name'
  teams: string[]
  games: number
  snaps: number
  /** Same rules as PlayerProfile.totals. */
  totals: Record<string, number>
  tally: GradeTally
  /** Graded games in date order; `plays`, `opponent`, `gameType` and `home` describe the game for charts. */
  byGame: { gameId: string; week: number; grade: number; plays?: number; opponent?: string; gameType?: string; home?: boolean }[]
}

export interface LeaderRow {
  player: RosterPlayer
  /** Teams graded for this season, latest last. */
  teams: string[]
  /** Games with a grade. */
  games: number
  /** Season snaps (participation). */
  snaps: number
  tally: GradeTally
  /** Mean team EPA on graded scrimmage plays. */
  epa: number | null
  byGame: { gameId: string; week: number; grade: number }[]
  /** Newest first, for the "Last N games" filter; EPA sum and count let the renderer recompute EPA for the last N. */
  lastGames: { gameId: string; tally: GradeTally; epaSum: number; epaPlays: number }[]
  /** Up to 3. */
  topTags: { tag: string; count: number }[]
}

export interface MatchupSide {
  team: Team
  summary: TeamSummary | null
  units: Partial<Record<UnitKey, GradeTally>>
  /** Graded players of this team, season. */
  players: { player: RosterPlayer; tally: GradeTally }[]
  statLeaders: { key: string; label: string; player: RosterPlayer; value: number }[]
  film: { gamesPlayed: number; withFilm: TeamGame[] }
}

export interface MatchupData {
  season: number
  left: MatchupSide
  right: MatchupSide
  /** Every meeting in downloaded seasons, newest first. */
  meetings: { game: GameInfo; clipCount: number; gradedPlays: number; studiedTeam: string | null }[]
}

// ── Cut-ups (03 §9.1) ────────────────────────────────────────────────────────

export type CutupKind = 'manual' | 'smart'

/** Whose grades and EPA the cut-up shows. */
export interface CutupFocus {
  team?: string
  playerId?: string
}

export interface Cutup {
  /** 'cu_' + 10 random base-36 characters. */
  id: string
  name: string
  kind: CutupKind
  /** Smart only. */
  rules: CutupRules | null
  /** null = each game's studied team. */
  focus: CutupFocus | null
  sort: number
  createdAt: string
  updatedAt: string
}

export type RuleField =
  | 'season' | 'team' | 'opponent' | 'game' | 'week'
  | 'side' | 'type' | 'down' | 'distance' | 'quarter' | 'situation' | 'yardline'
  | 'formation' | 'personnel' | 'coverage' | 'manZone' | 'pressure' | 'passRushers' | 'box'
  | 'result' | 'success' | 'epa' | 'yards' | 'text'
  | 'player' | 'grade' | 'status' | 'tag' | 'marked' | 'note'
  | `chart:${number}`

export type RuleOp =
  | 'is' | 'isNot' | 'gte' | 'lte' | 'between' | 'includes' | 'excludes' | 'contains'
  | 'onField' | 'credited' | 'graded' | 'offense' | 'defense' | 'studied' | 'insideOpp' | 'insideOwn'

export interface PlayRule {
  field: RuleField
  op: RuleOp
  value: string[] | number | [number, number] | string
  /** Scope of Grade, Status and Tag rules: a player id; absent = anyone on the perspective team. */
  player?: string
}

export interface CutupRules {
  match: 'all' | 'any'
  /** 1–12 */
  rules: PlayRule[]
  /** 1–500, null = no limit. */
  limit: number | null
  order: 'game' | 'newest' | 'epa-desc' | 'epa-asc'
}

export interface CutupSummary {
  cutup: Cutup
  playCount: number
  gameCount: number
  /** Seconds, from each clip's start point to its end, plays with film only. */
  duration: number
  withoutFilm: number
  /** First play with film. */
  poster: { clipId: number; at: number } | null
}

export interface CutupEntry {
  playerId: string
  name: string
  position: string
  grade: Grade | null
  critical: boolean
  tags: string[]
  note: string
}

export interface CutupItem {
  ref: PlayRef
  game: GameInfo
  /** The perspective team for this play. */
  team: string
  /** null when the season isn't downloaded. */
  play: Play | null
  clips: Clip[]
  drawing: PlayNote['drawing'] | null
  playNote: string
  flagged: boolean
  chart: Record<string, string>
  entries: CutupEntry[]
  teamEpa: number | null
  teamSuccess: boolean | null
  /** Manual only. */
  addedAt: string | null
}

export interface CutupDetail {
  cutup: Cutup
  items: CutupItem[]
  skippedSeasons: number[]
}

export interface CutupPreview {
  playCount: number
  gameCount: number
  duration: number
  /** The first 5 plays. */
  sample: CutupItem[]
  skippedSeasons: number[]
  noLineupSeasons: number[]
}

/** Value lists for the rules sheet. */
export interface RuleOptions {
  seasons: number[]
  /** Games with film or grades, newest first. Label like "2025 · Wk 1 · DAL @ PHI". */
  games: { gameId: string; season: number; week: number; label: string; homeTeam: string; awayTeam: string }[]
  formations: string[]
  offPersonnel: string[]
  defPersonnel: string[]
  coverages: string[]
  tags: { group: PositionGroup; label: string }[]
  chartFields: ChartField[]
  /** Seasons in the universe without participation (lineup rules match nothing there). */
  noLineupSeasons: number[]
}

// ── Search, film library, sidebar ────────────────────────────────────────────

export interface SearchIndex {
  season: number
  teams: { abbr: string; name: string; nickname: string; division: string; wins: number; losses: number; ties: number }[]
  players: { id: string; name: string; team: string; position: string; group: PositionGroup; jersey: string; headshot: string; season: number; graded: number }[]
  games: {
    gameId: string
    season: number
    week: number
    gameType: string
    gameday: string
    homeTeam: string
    awayTeam: string
    clipCount: number
    playCount: number
    gradedPlays: number
    studiedTeam: string | null
  }[]
  cutups: { id: string; name: string; kind: CutupKind; playCount: number }[]
}

/** One game with imported film, any season (the Film screen). */
export interface FilmLibraryItem extends RecentFilm {
  importedAt: string
  /** 'watch' when the watch folder imported it. */
  source: 'manual' | 'watch'
  angles: Angle[]
  /** Suspect clips from the last alignment check, null when none was run. */
  suspectClips: number | null
}

export interface SidebarBadges {
  /** Games imported (by hand or by the watch folder) and never opened. */
  newFilm: number
  /** Per My Team: games of this season with film that still have ungraded plays for that team. */
  teams: Record<string, number>
}

// ── Import, alignment, watch folder, data status, ffmpeg ─────────────────────

export type AlignmentReason = 'tooShort' | 'tooLong' | 'angleMismatch' | 'shifted'

export interface AlignmentSuspect {
  clipId: number | null
  path: string
  angle: Angle
  playId: number
  reason: AlignmentReason
  /** Seconds. */
  clipDuration: number
  /** What the play would usually run, in seconds. */
  expected: number
  /** When a neighbouring play fits better: that play. */
  betterPlayId: number | null
  /** e.g. "Clip length doesn’t fit this play. Check the match." */
  message: string
}

export interface AlignmentResult {
  gameId: string
  /** Clips with a known duration that were compared. */
  checked: number
  /** Clips whose duration couldn't be read. */
  unknown: number
  suspects: AlignmentSuspect[]
  /** Each clip's length in seconds by path (null when unreadable). Filled by checkAlignmentRows, so the sheets can show lengths and re-run the check locally. */
  durations?: Record<string, number | null>
}

export interface ImportLogEntry {
  id: number
  /** The game folder (watch folder) or the first picked path. */
  folder: string
  gameId: string | null
  team: string | null
  source: 'manual' | 'watch'
  state: 'done' | 'failed'
  clipCount: number
  playCount: number
  suspectClips: number
  error: string | null
  at: string
}

export interface WatchStatus {
  folder: string | null
  folderName: string | null
  state: 'off' | 'watching' | 'importing' | 'missing' | 'paused'
  /** ISO time of the last scan. */
  lastChecked: string | null
  /** While importing. */
  current: { title: string; done: number; total: number } | null
  /** Games the watch folder imported that haven't been opened yet. */
  justImported: number
  /** Last 5 imports, newest first. */
  recent: ImportLogEntry[]
  /** Game folders seen but not matched to a game, with the reason. */
  unmatched: { folder: string; reason: string }[]
}

export interface DataStatus {
  season: number
  state: 'upToDate' | 'updating' | 'notDownloaded' | 'failed'
  downloadedAt: string | null
  hasParticipation: boolean
  /** While updating. */
  step: string | null
  done: number
  total: number
  error: string | null
  autoUpdate: boolean
  /** Whether today is inside this season's window (Aug 1 – Feb 28). */
  inSeason: boolean
}

export interface FfmpegStatus {
  path: string | null
  version: string | null
  source: 'env' | 'bundled' | 'system' | null
  bundled: boolean
  ffprobe: string | null
  encoders: { h264_videotoolbox: boolean; libx264: boolean }
}

// ── Activities (01 §3.2 + 03 §17 A6) ─────────────────────────────────────────

export interface Activity {
  id: string
  kind: 'download' | 'import' | 'convert' | 'export' | 'watch'
  /** 'Importing DAL @ PHI' */
  title: string
  /** '48 of 312' */
  detail?: string
  done: number
  total: number
  state: 'running' | 'done' | 'failed' | 'cancelled'
  error?: string
  route?: string
  cancellable?: boolean
  /** Exports: the finished file. */
  resultPath?: string
  /** Set on done/failed when the event deserves a notification (01 §3.7); never on cancelled. */
  notification?: { title: string; body?: string; route?: string; revealPath?: string }
}
