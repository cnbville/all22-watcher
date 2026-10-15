import type {
  ChartField,
  ClipMatchRow,
  DataProgress,
  GameFilm,
  GradeEntry,
  MatchPreview,
  PlayerProfile,
  PlayNote,
  SeasonStatus,
  Settings,
  TagDef,
  TeamOverview,
  RecentFilm,
  TeamSummary
} from './types'

export interface MatchOptions {
  includeSpecialTeams?: boolean
  includeNoPlays?: boolean
}

/** Everything the window can ask of the app; implemented in main, exposed by preload as window.api. */
export interface Api {
  seasons(): Promise<SeasonStatus[]>
  downloadSeason(season: number): Promise<SeasonStatus>
  onDataProgress(cb: (p: DataProgress) => void): () => void

  teamSummaries(season: number): Promise<TeamSummary[]>
  teamOverview(season: number, team: string): Promise<TeamOverview>
  gameFilm(gameId: string): Promise<GameFilm>
  /** Records that you opened a game's film studying `team`. */
  openedFilm(gameId: string, team: string): Promise<void>
  recentFilm(): Promise<RecentFilm[]>

  pickClips(): Promise<string[] | null>
  previewMatch(gameId: string, paths: string[], options?: MatchOptions): Promise<MatchPreview>
  importClips(gameId: string, team: string, rows: ClipMatchRow[]): Promise<void>
  /** Whether ffmpeg is installed, so clips in other formats can be converted. */
  canConvert(): Promise<boolean>
  convertClips(gameId: string, paths: string[]): Promise<{ converted: string[]; failed: { path: string; error: string }[] }>
  onConvertProgress(cb: (p: { done: number; total: number }) => void): () => void
  relinkClip(clipId: number, playId: number | null): Promise<void>
  removeFilm(gameId: string): Promise<void>
  revealClip(path: string): Promise<void>

  saveGrade(entry: GradeEntry): Promise<void>
  savePlayNote(note: PlayNote): Promise<void>

  playerProfile(season: number, playerId: string): Promise<PlayerProfile | null>

  tags(): Promise<TagDef[]>
  /** Tags that keep their id are renames: grades tagged with the old label get the new one. */
  saveTags(tags: (Omit<TagDef, 'id'> & { id?: number })[]): Promise<TagDef[]>
  chartFields(): Promise<ChartField[]>
  /** Fields that keep their id are renames: values already charted move to the new name. */
  saveChartFields(fields: (Omit<ChartField, 'id'> & { id?: number })[]): Promise<ChartField[]>
  settings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>

  exportGradesCsv(season: number, team: string): Promise<string | null>
  exportPlayerReport(season: number, playerId: string): Promise<string | null>
  dataFolder(): Promise<string>
  openDataFolder(): Promise<void>
}

export const CLIP_SCHEME = 'tape'

export function clipUrl(clipId: number): string {
  return `${CLIP_SCHEME}://clip/${clipId}`
}
