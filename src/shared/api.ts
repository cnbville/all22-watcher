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

  pickClips(): Promise<string[] | null>
  previewMatch(gameId: string, paths: string[], options?: MatchOptions): Promise<MatchPreview>
  importClips(gameId: string, rows: ClipMatchRow[]): Promise<void>
  relinkClip(clipId: number, playId: number | null): Promise<void>
  removeFilm(gameId: string): Promise<void>
  revealClip(path: string): Promise<void>

  saveGrade(entry: GradeEntry): Promise<void>
  savePlayNote(note: PlayNote): Promise<void>

  playerProfile(season: number, playerId: string): Promise<PlayerProfile | null>

  tags(): Promise<TagDef[]>
  saveTags(tags: Omit<TagDef, 'id'>[]): Promise<TagDef[]>
  chartFields(): Promise<ChartField[]>
  saveChartFields(fields: Omit<ChartField, 'id'>[]): Promise<ChartField[]>
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
