/**
 * Drawing helpers for screens that import them from the tape room (03 §0): the shared shape model and the renderer,
 * which lives in `ui/video/drawShapes.ts` (02 §20, §23 A11).
 */
export { drawShapes, textBox, type PictureRect } from '../../ui/video/drawShapes'
export {
  DRAW_COLORS,
  migrateDrawing,
  packLane,
  shapeEnd,
  shapeVisibleAt,
  visibilityBreaks,
  type Drawing,
  type LineEnd,
  type Shape,
  type ShapeKind
} from '@shared/drawing'
