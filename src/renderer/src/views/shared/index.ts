/** The browse screens' shared building blocks (03 §2), for every screen that shows grades, plays or film. */
import './shared.css'

export { useLoaded, useLocalState, useMeasure, useRouteState, readLocal, writeLocal, prefersReducedMotion } from './hooks'
export { SampleBadge, SampleGrade, sampleFill, sampleInk, sampleTone, smallSampleTip } from './SampleGrade'
export { PLAY_DRAG_TYPE, PlayCaption, PlayRow, type PlayRowItem } from './PlayRow'
export { ANGLE_LABEL, ANGLE_NAME, playMenu, type PlayMenuTarget } from './playMenu'
export { Poster } from './Poster'
export { PlayList } from './PlayList'
export { ReelPlayer, entryKey, type ReelEntry, type ReelHandle, type ReelPlayerProps } from './ReelPlayer'
export {
  addToCutupMenu,
  hasExportVideoHandler,
  onAddToCutupRequest,
  onExportVideoRequest,
  requestAddToCutup,
  requestExportVideo,
  useExportVideoAvailable,
  type AddToCutupRequest,
  type ExportSheetRequest
} from './requests'
export { drawShapes, letterbox, paintShapes, type VideoRect } from './reel/drawShapes'
export { SeasonGate, useSeasonReady } from './SeasonGate'

export { axisNumber, type ChartBaseProps, Tip, TipLine, TipTitle, valueEndBar } from './charts/base'
export { CompactList, type CompactRow } from './charts/CompactList'
export { GradeByGameChart, type GameBar } from './charts/GradeByGame'
export { GradeEpaStrip, beeswarm, type EpaPoint } from './charts/GradeEpaStrip'
export { OpponentScatter, TIER_LABEL, tierOf, tierSummaries, type OpponentGame, type Tier, type TierSummary } from './charts/OpponentScatter'
export { CareerTrend, type CareerGamePoint, type CareerSeason } from './charts/CareerTrend'
export { LargeTallyBar, SplitBar, VersusRow, rankScore, type VersusSide } from './charts/Bars'
export { UnitHeatGrid, type HeatColumn, type HeatRow } from './charts/UnitHeatGrid'
