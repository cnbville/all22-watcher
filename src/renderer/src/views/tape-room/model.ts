import type { DRAW_TOOLS } from '@shared/commands'
import type { LineEnd, Shape } from '@shared/drawing'
import type { FilterToken } from '@shared/playQuery'
import type { Angle, ChartField, Clip, GameFilm, GameInfo, Grade, GradeEntry, Play, PlayNote, RosterPlayer, Settings, TagDef } from '@shared/types'
import type { VideoController } from '../../ui/video/engine'
import type { LineupOptions } from './filters'
import type { ProgressState } from './grading'
import type { TapeData } from './useTapeData'
import type { UndoStack } from './undo'

/** Shared types and small helpers for the tape room's parts (02 §20). */

export const ANGLE_ORDER: Angle[] = ['sideline', 'endzone', 'main']

/** "Sideline", "End Zone", "Main" (menus, the HUD popup, toasts). */
export const angleTitle = (a: Angle | string) => (a === 'endzone' ? 'End Zone' : a === 'sideline' ? 'Sideline' : 'Main')
/** "Sideline", "End zone", "Main" (the angle pill, the Info tab: sentence case). */
export const angleLabel = (a: Angle | string) => (a === 'endzone' ? 'End zone' : a === 'sideline' ? 'Sideline' : 'Main')

export type Layout = 'single' | 'sideBySide' | 'pip'
export type InspectorTab = 'grade' | 'notes' | 'chart' | 'info'
export type GroupBy = 'quarter' | 'drive' | 'none'
export type Tool = (typeof DRAW_TOOLS)[number]
export type ShowFor = number | null | 'frame'

export interface DrawStyle {
  color: string
  width: 2 | 4 | 6
  textSize: 18 | 24 | 32
  penEnd: 'none' | 'arrow'
  lineEnd: LineEnd
  showFor: ShowFor
}

export interface PaneInfo {
  angle: Angle
  clip: Clip | null
}

export interface FocusState {
  player: RosterPlayer
  snaps: Play[]
  snapIds: Set<number>
  progress: { graded: number; total: number; offField: number }
}

export type EndPanel =
  | { kind: 'lastUngraded' }
  | { kind: 'allGraded' }
  | { kind: 'focusLast' }
  | { kind: 'focusDone'; nextGame: GameInfo | null }

/** Everything the panes read and the actions they call. Built once per render by the room. */
export interface Room {
  film: GameFilm
  game: GameInfo
  team: string
  opponent: string
  plays: Play[]
  players: Record<string, RosterPlayer>
  tags: TagDef[]
  chartFields: ChartField[]
  settings: Settings
  data: TapeData
  undo: UndoStack
  video: VideoController
  lineup: LineupOptions
  hasFilm: boolean
  gameAngles: Angle[]
  clipsByPlay: Map<number, Clip[]>
  alignment: Map<number, string>
  // The list.
  baseList: Play[]
  visible: Play[]
  tokens: FilterToken[]
  text: string
  setTokens(t: FilterToken[]): void
  setText(t: string): void
  group: GroupBy
  setGroup(g: GroupBy): void
  drivesAvailable: boolean
  multi: Set<number>
  setMulti(s: Set<number>): void
  listedFor(play: Play): RosterPlayer[]
  progressOf(play: Play): { done: number; listed: number; state: ProgressState }
  playGradeCounts(play: Play): { plus: number; minus: number; critical: boolean; graded: number }
  // The current play.
  current: Play | null
  currentNote: PlayNote | null
  currentClips: Clip[]
  listed: RosterPlayer[]
  selected: RosterPlayer | null
  /** The player grading keys act on (the focus player in Player Focus). */
  target: RosterPlayer | null
  targetEntry: GradeEntry | undefined
  pinned: string[]
  starredOnly: boolean
  setStarredOnly(v: boolean): void
  focus: FocusState | null
  onFocusSnap: boolean
  // Video.
  panes: PaneInfo[]
  layout: Layout
  active: Angle | null
  activeClip: Clip | null
  playable: boolean
  // Drawing.
  drawMode: boolean
  tool: Tool
  style: DrawStyle
  selectedShape: string | null
  // Actions.
  goTo(playId: number, opts?: { mouse?: boolean; keepMulti?: boolean }): void
  step(delta: number): void
  select(playerId: string): void
  grade(playerId: string, g: Grade, opts?: { advance?: boolean; toggle?: boolean }): void
  clearGrade(playerId: string): void
  toggleCritical(playerId: string): void
  toggleOffField(playerId: string): void
  toggleTag(playerId: string, tag: TagDef): void
  toggleStar(playerId: string): void
  savePlayerNote(playerId: string, text: string): void
  fillZeros(): void
  clearPlay(): void
  toggleFlag(): void
  savePlayNote(text: string): void
  setChart(field: string, value: string): void
  enterFocus(playerId: string): void
  exitFocus(): void
  openFocusPicker(anchor?: HTMLElement | null): void
  openAddPlayer(anchor: HTMLElement | null): void
  fixMatches(focusPlayId?: number): void
  openPlayer(playerId: string): void
  setActive(angle: Angle): void
  setTab(tab: InspectorTab): void
  tab: InspectorTab
  /** The tape room root takes keyboard focus back (after a mouse choice). */
  refocus(): void
  playMenu(e: React.MouseEvent, play: Play): void
  gradingRowMenu(e: React.MouseEvent, player: RosterPlayer): void
  // Drawing actions.
  setTool(t: Tool): void
  setStyle(patch: Partial<DrawStyle>): void
  selectShape(id: string | null): void
  shapesOf(angle: Angle): Shape[]
  /** Replaces one angle's shapes; `label` pushes an undo entry. Debounced save unless `now`. */
  setShapes(angle: Angle, shapes: Shape[], opts?: { label?: string; prev?: Shape[] }): void
}

export function snapSeconds(clip: Clip | null | undefined): number | null {
  return clip && clip.snapMs !== null ? clip.snapMs / 1000 : null
}

/** "Week 1", "Wild Card" for the toolbar subtitle and title menu. */
export function weekName(game: GameInfo): string {
  if (game.gameType === 'REG') return `Week ${game.week}`
  return { WC: 'Wild Card', DIV: 'Divisional', CON: 'Conference Championship', SB: 'Super Bowl' }[game.gameType] ?? game.gameType
}

/** "2025_01_DAL_PHI" → title and subtitle while the film loads (02 §3). */
export function titleFromGameId(gameId: string): { title: string; subtitle: string } {
  const m = /^(\d{4})_(\d{2})_([A-Z]+)_([A-Z]+)$/.exec(gameId)
  if (!m) return { title: 'Film', subtitle: '' }
  const week = Number(m[2])
  return { title: `${m[3]} @ ${m[4]}`, subtitle: `${week <= 18 ? `Week ${week}` : 'Postseason'} · ${m[1]}` }
}
