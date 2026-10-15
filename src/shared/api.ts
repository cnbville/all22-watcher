import type { ExportOverlay, ExportPlan, ExportVideoRequest } from './exportVideo'
import type {
  Activity,
  AlignmentResult,
  Angle,
  ChartField,
  ClipMatchRow,
  Cutup,
  CutupDetail,
  CutupFocus,
  CutupKind,
  CutupPreview,
  CutupRules,
  CutupSummary,
  DataProgress,
  DataStatus,
  FfmpegStatus,
  FilmLibraryItem,
  GameFilm,
  GradeEntry,
  ImportLogEntry,
  LeaderRow,
  MatchPreview,
  MatchupData,
  PlayerProfile,
  PlayerSeasonLine,
  PlayNote,
  PlayRef,
  PositionGroup,
  RecentFilm,
  RecentPlayer,
  RuleOptions,
  SearchIndex,
  SeasonStatus,
  Settings,
  SidebarBadges,
  TagDef,
  TeamCard,
  TeamFilmStats,
  TeamOverview,
  TeamSummary,
  WatchStatus
} from './types'

export interface MatchOptions {
  includeSpecialTeams?: boolean
  includeNoPlays?: boolean
  /** Angles of clips already saved, kept as they are when fixing matches. */
  angles?: Record<string, Angle>
}

/** What changed in main, so screens refetch (03 §2.2.6). Main sends these for changes it makes on its own. */
export type DataKind = 'grades' | 'notes' | 'film' | 'cutups' | 'season' | 'settings'

/** Everything main pushes to the windows, over one channel (`api-event`). */
export type ApiEvent =
  | { type: 'activity'; activity: Activity }
  | { type: 'dataStatus'; status: DataStatus }
  | { type: 'watchStatus'; status: WatchStatus }
  | { type: 'changed'; kinds: DataKind[] }

export const API_EVENT_CHANNEL = 'api-event'

/** Everything the window can ask of the app; implemented in main, exposed by preload as window.api. */
export interface Api {
  // Seasons and season data
  seasons(): Promise<SeasonStatus[]>
  downloadSeason(season: number): Promise<SeasonStatus>
  onDataProgress(cb: (p: DataProgress) => void): () => void
  /** The sidebar footer's season data row (01 §1.2); defaults to the current season. Pushed as `dataStatus` events. */
  dataStatus(season?: number): Promise<DataStatus>
  /** "Update Now": re-downloads the season (default: current) whatever its age. */
  updateSeasonNow(season?: number): Promise<DataStatus>
  /** Bytes on disk per downloaded season (Settings › Data). */
  seasonStorage(): Promise<Record<number, number>>
  /** Deletes a season's downloaded data; grades, notes and film stay. Rejects while it downloads. */
  removeSeason(season: number): Promise<void>

  // Teams, games, players
  teamSummaries(season: number): Promise<TeamSummary[]>
  teamOverview(season: number, team: string): Promise<TeamOverview>
  teamCards(season: number, abbrs: string[]): Promise<TeamCard[]>
  teamFilmStats(season: number): Promise<Record<string, TeamFilmStats>>
  gameFilm(gameId: string): Promise<GameFilm>
  /** Records that you opened a game's film studying `team`. */
  openedFilm(gameId: string, team: string): Promise<void>
  recentFilm(): Promise<RecentFilm[]>
  /** Every game with imported film, all seasons, newest game first (the Film screen). */
  filmLibrary(): Promise<FilmLibraryItem[]>
  recentlyGraded(limit: number): Promise<RecentPlayer[]>
  playerProfile(season: number, playerId: string): Promise<PlayerProfile | null>
  playerSeasonLine(season: number, playerId: string, hint?: { name: string; group: PositionGroup }): Promise<PlayerSeasonLine | null>
  leaderboard(season: number, group: PositionGroup): Promise<LeaderRow[]>
  matchup(season: number, left: string, right: string): Promise<MatchupData>
  searchIndex(season: number): Promise<SearchIndex>
  sidebarBadges(season: number): Promise<SidebarBadges>

  // Import and clips
  pickClips(): Promise<string[] | null>
  previewMatch(gameId: string, paths: string[], options?: MatchOptions): Promise<MatchPreview>
  importClips(gameId: string, team: string, rows: ClipMatchRow[]): Promise<void>
  /** Whether ffmpeg is available (bundled, Homebrew or system), so clips in other formats can be converted. */
  canConvert(): Promise<boolean>
  /** Converts with the bundled ffmpeg as a cancellable `convert` activity (Dock progress); a cancelled run resolves with what it converted. */
  convertClips(gameId: string, paths: string[]): Promise<{ converted: string[]; failed: { path: string; error: string }[] }>
  onConvertProgress(cb: (p: { done: number; total: number }) => void): () => void
  relinkClip(clipId: number, playId: number | null): Promise<void>
  removeFilm(gameId: string): Promise<void>
  revealClip(path: string): Promise<void>
  /** Sets or clears a clip's snap point (ms of clip time). Rejects with "That clip is no longer in your film." */
  setClipSnap(clipId: number, snapMs: number | null): Promise<void>
  /** Runs the alignment check on a game's saved clips (reads missing durations first) and stores the result. */
  checkAlignment(gameId: string): Promise<AlignmentResult>
  /** The last stored alignment result for a game, or null. */
  alignment(gameId: string): Promise<AlignmentResult | null>
  /** The alignment check on unsaved rows (Import Film and Fix Clip Matches sheets). */
  checkAlignmentRows(gameId: string, rows: ClipMatchRow[]): Promise<AlignmentResult>
  /** Recent imports, manual and watch folder, newest first. */
  importLog(limit?: number): Promise<ImportLogEntry[]>
  ffmpegStatus(): Promise<FfmpegStatus>

  // Watch folder
  watchStatus(): Promise<WatchStatus>
  /** Scans the watch folder now. */
  checkWatchFolder(): Promise<WatchStatus>
  /** Folder picker for the watch folder; saves the setting and starts watching. null when cancelled. */
  chooseWatchFolder(): Promise<string | null>

  // Grading
  saveGrade(entry: GradeEntry): Promise<void>
  savePlayNote(note: PlayNote): Promise<void>

  // Cut-ups
  cutups(): Promise<CutupSummary[]>
  cutup(id: string): Promise<CutupDetail | null>
  createCutup(input: { name?: string; kind: CutupKind; rules?: CutupRules; focus?: CutupFocus; plays?: PlayRef[] }): Promise<Cutup>
  updateCutup(id: string, patch: { name?: string; rules?: CutupRules; focus?: CutupFocus | null }): Promise<Cutup>
  deleteCutup(id: string): Promise<void>
  duplicateCutup(id: string, asManual?: boolean): Promise<Cutup>
  addToCutup(id: string, plays: PlayRef[]): Promise<{ added: number; already: number }>
  removeFromCutup(id: string, plays: PlayRef[]): Promise<void>
  reorderCutup(id: string, plays: PlayRef[]): Promise<void>
  reorderCutups(ids: string[]): Promise<void>
  previewCutupRules(rules: CutupRules, focus?: CutupFocus | null): Promise<CutupPreview>
  cutupRuleOptions(): Promise<RuleOptions>

  // Export video
  exportVideoPlan(req: ExportVideoRequest): Promise<ExportPlan>
  startExportVideo(req: ExportVideoRequest, overlays: ExportOverlay[]): Promise<{ activityId: string }>
  exportFolders(): Promise<{ last: string | null; desktop: string; documents: string; downloads: string; movies: string }>
  chooseFolder(): Promise<string | null>
  revealPath(path: string): Promise<void>
  openPath(path: string): Promise<void>

  // Activities and events
  /** Running activities and ones that ended in the last 10 minutes (for a window that opens late). */
  activities(): Promise<Activity[]>
  /** Cancels a queued or running export or import. */
  cancelActivity(id: string): Promise<void>
  /** Main → renderer events: activities, data status, watch status, data changes. Returns an unsubscribe function. */
  onApiEvent(cb: (e: ApiEvent) => void): () => void

  // Settings and lists
  tags(): Promise<TagDef[]>
  /** Tags that keep their id are renames: grades tagged with the old label get the new one. */
  saveTags(tags: (Omit<TagDef, 'id'> & { id?: number })[]): Promise<TagDef[]>
  chartFields(): Promise<ChartField[]>
  /** Fields that keep their id are renames: values already charted move to the new name. */
  saveChartFields(fields: (Omit<ChartField, 'id'> & { id?: number })[]): Promise<ChartField[]>
  settings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>

  // Files
  exportGradesCsv(season: number, team: string): Promise<string | null>
  exportPlayerReport(season: number, playerId: string): Promise<string | null>
  /** Save dialog for a CSV the renderer built (Leaderboards). Saved path, or null when cancelled. */
  saveCsv(defaultName: string, csv: string): Promise<string | null>
  dataFolder(): Promise<string>
  openDataFolder(): Promise<void>
}

/** Api members that are local subscriptions in the preload, not IPC calls. */
export type ApiListener = 'onDataProgress' | 'onConvertProgress' | 'onApiEvent'
export type ApiMethod = Exclude<keyof Api, ApiListener>

const METHOD_MAP: Record<ApiMethod, true> = {
  seasons: true, downloadSeason: true, dataStatus: true, updateSeasonNow: true, seasonStorage: true, removeSeason: true,
  teamSummaries: true, teamOverview: true, teamCards: true, teamFilmStats: true, gameFilm: true, openedFilm: true, recentFilm: true,
  filmLibrary: true, recentlyGraded: true, playerProfile: true, playerSeasonLine: true, leaderboard: true, matchup: true,
  searchIndex: true, sidebarBadges: true,
  pickClips: true, previewMatch: true, importClips: true, canConvert: true, convertClips: true, relinkClip: true, removeFilm: true,
  revealClip: true, setClipSnap: true, checkAlignment: true, alignment: true, checkAlignmentRows: true, importLog: true, ffmpegStatus: true,
  watchStatus: true, checkWatchFolder: true, chooseWatchFolder: true,
  saveGrade: true, savePlayNote: true,
  cutups: true, cutup: true, createCutup: true, updateCutup: true, deleteCutup: true, duplicateCutup: true, addToCutup: true,
  removeFromCutup: true, reorderCutup: true, reorderCutups: true, previewCutupRules: true, cutupRuleOptions: true,
  exportVideoPlan: true, startExportVideo: true, exportFolders: true, chooseFolder: true, revealPath: true, openPath: true,
  activities: true, cancelActivity: true,
  tags: true, saveTags: true, chartFields: true, saveChartFields: true, settings: true, saveSettings: true,
  exportGradesCsv: true, exportPlayerReport: true, saveCsv: true, dataFolder: true, openDataFolder: true
}

/** Every IPC method name; the record above makes the compiler check it against `Api`. */
export const API_METHODS = Object.keys(METHOD_MAP) as ApiMethod[]

export const CLIP_SCHEME = 'tape'

export function clipUrl(clipId: number): string {
  return `${CLIP_SCHEME}://clip/${clipId}`
}

/** A still from a clip at `at` seconds (03 §2.7): 480 wide by default. */
/** A team's logo from nflverse's team list, cached on disk by the main process. */
export function logoUrl(abbr: string): string {
  return `${CLIP_SCHEME}://logo/${encodeURIComponent(abbr)}`
}

export function posterUrl(clipId: number, at: number, width?: number): string {
  return `${CLIP_SCHEME}://poster/${clipId}?t=${(Math.round(at * 10) / 10).toFixed(1)}${width ? `&w=${width}` : ''}`
}
