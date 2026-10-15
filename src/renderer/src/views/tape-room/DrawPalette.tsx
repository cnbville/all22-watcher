import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DRAW_COLORS, type LineEnd, type Shape, shapeVisibleAt } from '@shared/drawing'
import type { Angle } from '@shared/types'
import { runCommand } from '../../shell/commands'
import { action, type MenuAction, sep, showMenu, submenu } from '../../shell/contextMenus'
import { Icon, type IconName } from '../../ui/Icon'
import { noMouseFocus } from '../../ui/keyboard'
import { type MenuItemSpec, openMenu } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { textBox } from '../../ui/video/drawShapes'
import type { VideoEngine } from '../../ui/video/engine'
import type { DrawStyle, Room, ShowFor, Tool } from './model'
import {
  type Box,
  bigEnough,
  dragBox,
  HANDLE_CURSOR,
  type Handle,
  handlesOf,
  hitShape,
  hitTest,
  moveShape,
  type Pt,
  resizeShape,
  shapeBounds,
  simplify,
  snap45
} from './shapeEdit'

/**
 * Draw mode (02 §11): the Markup-style palette over the film, and the drawing layer on the active picture that
 * creates, selects, moves and resizes shapes and edits text.
 */

const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
  { id: 'select', icon: 'mouse-pointer-2', label: 'Select', key: '1' },
  { id: 'pen', icon: 'pen-line', label: 'Pen', key: '2' },
  { id: 'arrow', icon: 'move-up-right', label: 'Arrow', key: '3' },
  { id: 'line', icon: 'minus', label: 'Line', key: '4' },
  { id: 'circle', icon: 'circle', label: 'Circle', key: '5' },
  { id: 'box', icon: 'square', label: 'Box', key: '6' },
  { id: 'text', icon: 'type', label: 'Text', key: '7' },
  { id: 'spotlight', icon: 'spotlight', label: 'Spotlight', key: '8' }
]

const WIDTHS: { value: 2 | 4 | 6; label: string }[] = [
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Medium' },
  { value: 6, label: 'Thick' }
]
const SIZES: { value: 18 | 24 | 32; label: string; short: string }[] = [
  { value: 18, label: 'Small', short: 'S' },
  { value: 24, label: 'Medium', short: 'M' },
  { value: 32, label: 'Large', short: 'L' }
]
const ENDS: { value: LineEnd; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'block', label: 'Block' }
]
const SHOW_FOR: { value: ShowFor; label: string; short: string }[] = [
  { value: null, label: 'Until End of Clip', short: 'End' },
  { value: 1, label: '1 Second', short: '1 s' },
  { value: 2, label: '2 Seconds', short: '2 s' },
  { value: 3, label: '3 Seconds', short: '3 s' },
  { value: 'frame', label: 'This Frame Only', short: '1 fr' }
]

export const PALETTE_WIDTH = 673
export const PALETTE_HEIGHT = 40

const newId = () => crypto.randomUUID().slice(0, 8)

/** A shape's "Show for" choice, or 'custom' when its span was dragged to another length. */
function showForOf(s: Shape, frame: number): ShowFor | 'custom' {
  if (s.duration === null) return null
  if (Math.abs(s.duration - frame) < frame / 4) return 'frame'
  for (const n of [1, 2, 3]) if (Math.abs(s.duration - n) < 0.001) return n
  return 'custom'
}

const durationFor = (v: ShowFor, frame: number) => (v === null ? null : v === 'frame' ? frame : v)

/** Applies a style change to a shape (only the parts that shape has). */
function styled(s: Shape, patch: Partial<DrawStyle>): Shape {
  let n: Shape = { ...s }
  if (patch.color) n = { ...n, color: patch.color }
  if (patch.width && s.kind !== 'text') n = { ...n, width: patch.width }
  if (patch.textSize && s.kind === 'text') n = { ...n, size: patch.textSize } as Shape
  if (patch.penEnd && s.kind === 'pen') n = { ...n, end: patch.penEnd } as Shape
  if (patch.lineEnd && s.kind === 'line') n = { ...n, end: patch.lineEnd } as Shape
  return n
}

/** Changes the style of the selected shape (pushing one undo entry) and the default for new shapes. */
export function applyStyle(room: Room, angle: Angle | null, patch: Partial<DrawStyle>, frame: number) {
  room.setStyle(patch)
  if (!angle || !room.selectedShape) return
  const list = room.shapesOf(angle)
  const sel = list.find((s) => s.id === room.selectedShape)
  if (!sel) return
  let next = styled(sel, patch)
  if (patch.showFor !== undefined) next = { ...next, duration: durationFor(patch.showFor, frame) }
  if (JSON.stringify(next) === JSON.stringify(sel)) return
  room.setShapes(
    angle,
    list.map((s) => (s.id === sel.id ? next : s)),
    { label: patch.showFor !== undefined ? 'Change Drawing Time' : 'Change Drawing Style' }
  )
}

/** The shape context menu (02 §16.5), for the shape body, a handle or its lane span. */
export function shapeMenu(e: React.MouseEvent | null, room: Room, angle: Angle, shape: Shape, engine: VideoEngine) {
  room.selectShape(shape.id)
  const st = engine.getState().panes[angle]
  const frame = st?.frame ?? 1 / 30
  const now = st?.time ?? 0
  const list = () => room.shapesOf(angle)
  const replace = (next: Shape, label: string) =>
    room.setShapes(
      angle,
      list().map((s) => (s.id === shape.id ? next : s)),
      { label }
    )
  const current = showForOf(shape, frame)
  const end = shape.duration === null ? null : shape.start + shape.duration
  const items: MenuAction[] = [
    action('Delete Drawing', () => runCommand('draw.deleteShape'), { accelerator: 'Backspace' }),
    action('Duplicate Drawing', () => runCommand('draw.duplicate')),
    sep(),
    submenu(
      'Color',
      DRAW_COLORS.map((c) => action(c.label, () => applyStyle(room, angle, { color: c.hex }, frame), { checked: shape.color.toLowerCase() === c.hex.toLowerCase() }))
    )
  ]
  if (shape.kind !== 'text') items.push(submenu('Line Width', WIDTHS.map((w) => action(w.label, () => applyStyle(room, angle, { width: w.value }, frame), { checked: shape.width === w.value }))))
  if (shape.kind === 'text') items.push(submenu('Text Size', SIZES.map((w) => action(w.label, () => applyStyle(room, angle, { textSize: w.value }, frame), { checked: shape.size === w.value }))))
  if (shape.kind === 'pen' || shape.kind === 'line') {
    const ends = shape.kind === 'pen' ? ENDS.filter((x) => x.value !== 'block') : ENDS
    items.push(
      submenu(
        'Line End',
        ends.map((x) =>
          action(x.label, () => applyStyle(room, angle, shape.kind === 'pen' ? { penEnd: x.value as 'none' | 'arrow' } : { lineEnd: x.value }, frame), { checked: shape.end === x.value })
        )
      )
    )
  }
  items.push(
    sep(),
    submenu('Show For', [
      ...SHOW_FOR.map((o) => action(o.label, () => replace({ ...shape, duration: durationFor(o.value, frame) }, 'Change Drawing Time'), { checked: current === o.value })),
      ...(current === 'custom' ? [action('Custom', () => {}, { checked: true, enabled: false })] : [])
    ]),
    action(
      'Start at Current Frame',
      () => replace({ ...shape, start: now, duration: end === null ? null : end - now }, 'Change Drawing Time'),
      { enabled: end === null || end - now >= frame }
    ),
    action('End at Current Frame', () => replace({ ...shape, duration: now - shape.start }, 'Change Drawing Time'), { enabled: now >= shape.start + frame }),
    action('Show Until End of Clip', () => replace({ ...shape, duration: null }, 'Change Drawing Time'), { enabled: shape.duration !== null }),
    sep(),
    action('Bring to Front', () => runCommand('draw.bringToFront')),
    action('Send to Back', () => runCommand('draw.sendToBack'))
  )
  void showMenu(e, items)
}

/** The floating Markup-style palette (02 §11.2). */
export function DrawPalette({
  room,
  angle,
  engine,
  viewerWidth,
  style,
  onMenu
}: {
  room: Room
  angle: Angle | null
  engine: VideoEngine
  viewerWidth: number
  style: CSSProperties
  onMenu?: (open: boolean) => void
}) {
  const { tool } = room
  const s = room.style
  const frame = () => (angle ? (engine.getState().panes[angle]?.frame ?? 1 / 30) : 1 / 30)
  const colorBtn = useRef<HTMLButtonElement>(null)
  const [colorOpen, setColorOpen] = useState(false)
  const sel = angle ? room.shapesOf(angle).find((x) => x.id === room.selectedShape) : undefined
  const textMode = sel ? sel.kind === 'text' : tool === 'text'
  const endEnabled = sel ? sel.kind === 'pen' || sel.kind === 'line' : tool === 'pen' || tool === 'arrow' || tool === 'line'
  const endKind: 'pen' | 'line' = sel ? (sel.kind === 'pen' ? 'pen' : 'line') : tool === 'pen' ? 'pen' : 'line'
  const endValue: LineEnd = sel && (sel.kind === 'pen' || sel.kind === 'line') ? sel.end : endKind === 'pen' ? s.penEnd : tool === 'arrow' ? 'arrow' : s.lineEnd
  const color = sel?.color ?? s.color
  const width = sel && sel.kind !== 'text' ? sel.width : s.width
  const size = sel?.kind === 'text' ? sel.size : s.textSize
  const showFor = sel ? showForOf(sel, frame()) : s.showFor
  const compactShow = viewerWidth < 705
  const collapsed = viewerWidth < PALETTE_WIDTH + 16

  const apply = (patch: Partial<DrawStyle>) => applyStyle(room, angle, patch, frame())
  const menu = (anchor: Element, items: MenuItemSpec[]) => {
    onMenu?.(true)
    openMenu({ anchor, items, placement: 'below', minWidth: 180, onClose: () => onMenu?.(false) })
  }
  const widthItems = (): MenuItemSpec[] =>
    textMode
      ? SIZES.map((o) => ({ label: o.label, checked: size === o.value, run: () => apply({ textSize: o.value }) }))
      : WIDTHS.map((o) => ({ label: o.label, checked: width === o.value, run: () => apply({ width: o.value }) }))
  const endItems = (): MenuItemSpec[] =>
    (endKind === 'pen' ? ENDS.filter((e) => e.value !== 'block') : ENDS).map((o) => ({
      label: o.label,
      checked: endValue === o.value,
      run: () => apply(endKind === 'pen' ? { penEnd: o.value as 'none' | 'arrow' } : { lineEnd: o.value })
    }))
  const showItems = (): MenuItemSpec[] => SHOW_FOR.map((o) => ({ label: o.label, checked: showFor === o.value, run: () => apply({ showFor: o.value }) }))
  const undoLabel = room.undo.peekUndo()?.label

  const btn = (icon: IconName, title: string, run: () => void, opts: { on?: boolean; disabled?: boolean; test?: string; style?: CSSProperties } = {}) => (
    <button
      type="button"
      className="hud__button"
      title={title}
      aria-label={title.replace(/ \(.*\)$/, '')}
      aria-pressed={opts.on === undefined ? undefined : opts.on}
      disabled={opts.disabled}
      data-test={opts.test}
      onMouseDown={noMouseFocus}
      onClick={run}
    >
      <Icon name={icon} size={18} style={opts.style} />
    </button>
  )

  const colorButton = (
    <button
      ref={colorBtn}
      type="button"
      className="hud__button draw-palette__color"
      title="Color"
      aria-label="Color"
      data-test="draw-color"
      onMouseDown={noMouseFocus}
      onClick={() => setColorOpen((o) => !o)}
    >
      <span className="draw-palette__dot" style={{ '--shape': color } as CSSProperties} />
    </button>
  )
  const widthButton = (
    <button
      type="button"
      className="hud__button"
      title={textMode ? 'Text Size' : 'Line Width'}
      aria-label={textMode ? 'Text Size' : 'Line Width'}
      data-test="draw-width"
      onMouseDown={noMouseFocus}
      onClick={(e) => menu(e.currentTarget, widthItems())}
    >
      {textMode ? <span className="draw-palette__size">{SIZES.find((x) => x.value === size)?.short ?? 'M'}</span> : <span className="draw-palette__bar" style={{ height: width / 2 }} />}
    </button>
  )
  const endButton = (
    <button
      type="button"
      className="hud__button"
      title="Line End"
      aria-label="Line End"
      data-test="draw-end"
      disabled={!endEnabled}
      onMouseDown={noMouseFocus}
      onClick={(e) => menu(e.currentTarget, endItems())}
    >
      <EndGlyph end={endValue} />
    </button>
  )
  const showButton = (
    <button
      type="button"
      className={`hud__text-button draw-palette__show${compactShow ? ' draw-palette__show--icon' : ''}`}
      title="Show New Drawings For"
      aria-label="Show New Drawings For"
      data-test="draw-show-for"
      onMouseDown={noMouseFocus}
      onClick={(e) => menu(e.currentTarget, showItems())}
    >
      <Icon name="timer" size={14} />
      {!compactShow && <span>{showFor === 'custom' ? 'Custom' : (SHOW_FOR.find((x) => x.value === showFor)?.short ?? 'End')}</span>}
    </button>
  )
  const edit = (
    <>
      {btn('undo-2', undoLabel ? `Undo ${undoLabel} (⌘Z)` : 'Undo (⌘Z)', () => runCommand('edit.undo'), { disabled: !room.undo.peekUndo(), test: 'draw-undo' })}
      {btn('redo-2', 'Redo (⇧⌘Z)', () => runCommand('edit.redo'), { disabled: !room.undo.peekRedo(), test: 'draw-redo' })}
      {btn('trash-2', 'Delete Drawing (⌫)', () => runCommand('draw.deleteShape'), { disabled: !sel, test: 'draw-delete' })}
      {btn('eraser', 'Clear Drawings (C)', () => runCommand('draw.clear'), { disabled: !angle || !room.shapesOf(angle).length, test: 'draw-clear' })}
    </>
  )
  const moreItems = (): MenuItemSpec[] => [
    { kind: 'submenu', label: 'Color', items: DRAW_COLORS.map((c) => ({ label: c.label, checked: color.toLowerCase() === c.hex.toLowerCase(), run: () => apply({ color: c.hex }) })) },
    { kind: 'submenu', label: textMode ? 'Text Size' : 'Line Width', items: widthItems() },
    { kind: 'submenu', label: 'Line End', items: endItems(), disabled: !endEnabled },
    { kind: 'submenu', label: 'Show New Drawings For', items: showItems() },
    { kind: 'separator' },
    { label: undoLabel ? `Undo ${undoLabel}` : 'Undo', shortcut: '⌘Z', disabled: !room.undo.peekUndo(), run: () => runCommand('edit.undo') },
    { label: 'Redo', shortcut: '⇧⌘Z', disabled: !room.undo.peekRedo(), run: () => runCommand('edit.redo') },
    { label: 'Delete Drawing', shortcut: '⌫', disabled: !sel, run: () => runCommand('draw.deleteShape') },
    { label: 'Clear Drawings', shortcut: 'C', disabled: !angle || !room.shapesOf(angle).length, run: () => runCommand('draw.clear') }
  ]

  return (
    <div className="hud draw-palette" data-test="draw-palette" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div className="draw-palette__group">
        {TOOLS.map((t) =>
          btn(t.icon, `${t.label} (${t.key})`, () => runCommand('draw.tool', t.id), {
            on: tool === t.id,
            test: `draw-tool-${t.id}`,
            style: t.id === 'line' ? { transform: 'rotate(-45deg)' } : undefined
          })
        )}
      </div>
      <span className="draw-palette__sep" />
      {collapsed ? (
        <button
          type="button"
          className="hud__button"
          title="More"
          aria-label="More"
          onMouseDown={noMouseFocus}
          onClick={(e) => menu(e.currentTarget, moreItems())}
        >
          <Icon name="ellipsis" size={18} />
        </button>
      ) : (
        <>
          <div className="draw-palette__group">
            {colorButton}
            {widthButton}
            {endButton}
            {showButton}
          </div>
          <span className="draw-palette__sep" />
          <div className="draw-palette__group">{edit}</div>
        </>
      )}
      <span className="draw-palette__sep" />
      <button type="button" className="draw-palette__done" title="Done Drawing (D)" data-test="draw-done" onMouseDown={noMouseFocus} onClick={() => runCommand('draw.toggle')}>
        Done
      </button>
      {colorOpen && (
        <Popover anchor={colorBtn} open onClose={() => setColorOpen(false)} width={172} test="draw-color-popover">
          <div className="draw-colors">
            {DRAW_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="draw-colors__swatch"
                title={c.label}
                aria-label={c.label}
                aria-pressed={color.toLowerCase() === c.hex.toLowerCase()}
                style={{ '--shape': c.hex } as CSSProperties}
                onMouseDown={noMouseFocus}
                onClick={() => {
                  apply({ color: c.hex })
                  setColorOpen(false)
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

/** Line end glyph: plain, arrowhead or T bar (18px). */
function EndGlyph({ end }: { end: LineEnd }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9h11" />
      {end === 'arrow' && <path d="M11 5.5 15 9l-4 3.5" />}
      {end === 'block' && <path d="M15 4.5v9" />}
    </svg>
  )
}

// ── The drawing layer ──────────────────────────────────────────────────────

let measureCtx: CanvasRenderingContext2D | null = null
/** A text shape's box in picture units, measured like drawShapes measures it. */
export function measureText(s: Extract<Shape, { kind: 'text' }>, picture: { w: number; h: number }): Box {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return { x: s.x, y: s.y, w: 0.1, h: 0.05 }
  return textBox(measureCtx, s, { x: 0, y: 0, w: picture.w, h: picture.h })
}

type Gesture =
  | { kind: 'create'; tool: Tool; from: Pt; points: Pt[]; start: number }
  | { kind: 'move'; id: string; from: Pt; orig: Shape; prev: Shape[]; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; orig: Shape; prev: Shape[]; moved: boolean }

/**
 * Pointer handling over the active picture in Draw mode (02 §11.3–§11.5). Draws the selection's handles; the shapes
 * themselves (and the shape being drawn, through `onDraft`) are painted by the pane's canvas.
 */
export function DrawLayer({
  room,
  angle,
  engine,
  picture,
  enabled,
  onDraft,
  onActivate
}: {
  room: Room
  angle: Angle
  engine: VideoEngine
  picture: { w: number; h: number }
  enabled: boolean
  onDraft: (s: Shape | null) => void
  /** Drawing on the inactive pane makes it active first. */
  onActivate?: () => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [editor, setEditor] = useState<{ at: Pt; id: string | null; text: string; color: string; size: 18 | 24 | 32 } | null>(null)
  const shapes = room.shapesOf(angle)
  const selected = shapes.find((s) => s.id === room.selectedShape) ?? null
  const px = picture
  const text = (s: Extract<Shape, { kind: 'text' }>) => measureText(s, picture)
  const paneState = () => engine.getState().panes[angle]
  const frame = () => paneState()?.frame ?? 1 / 30
  const now = () => paneState()?.time ?? 0
  const visibleShapes = () => shapes.filter((s) => shapeVisibleAt(s, now(), frame()) || s.id === room.selectedShape)

  const point = (e: { clientX: number; clientY: number }): Pt => {
    const r = el.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }
  const handleAt = (p: Pt): Handle | null => {
    if (!selected) return null
    for (const h of handlesOf(selected)) {
      if (Math.hypot((h.at[0] - p[0]) * px.w, (h.at[1] - p[1]) * px.h) <= 7) return h.id
    }
    return null
  }

  const editorRef = useRef(editor)
  editorRef.current = editor
  const commitEditor = () => {
    const ed = editorRef.current
    if (!ed) return
    editorRef.current = null
    setEditor(null)
    const value = ed.text.replace(/\s+$/, '')
    if (ed.id) {
      const orig = shapes.find((s) => s.id === ed.id)
      if (!orig || orig.kind !== 'text') return
      if (!value) {
        room.setShapes(angle, shapes.filter((s) => s.id !== ed.id), { label: 'Delete Drawing' })
        room.selectShape(null)
      } else if (value !== orig.text) {
        room.setShapes(angle, shapes.map((s) => (s.id === ed.id ? { ...orig, text: value } : s)), { label: 'Edit Text' })
      }
      return
    }
    if (!value) return
    const s = room.style
    const shape: Shape = {
      id: newId(),
      kind: 'text',
      color: ed.color,
      width: s.width,
      start: now(),
      duration: durationFor(s.showFor, frame()),
      x: ed.at[0],
      y: ed.at[1],
      text: value,
      size: ed.size
    }
    room.setShapes(angle, [...shapes, shape], { label: 'Drawing' })
    room.selectShape(shape.id)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return
    e.stopPropagation()
    onActivate?.()
    if (!engine.isPaused()) engine.pause()
    if (editor) {
      commitEditor()
      return
    }
    const p = point(e)
    const h = handleAt(p)
    if (h && selected) {
      gesture.current = { kind: 'resize', id: selected.id, handle: h, orig: selected, prev: shapes, moved: false }
    } else if (selected && hitShape(selected, p, px, text)) {
      gesture.current = { kind: 'move', id: selected.id, from: p, orig: selected, prev: shapes, moved: false }
    } else if (room.tool === 'select') {
      const hit = hitTest(visibleShapes(), p, px, text)
      room.selectShape(hit?.id ?? null)
      if (hit) gesture.current = { kind: 'move', id: hit.id, from: p, orig: hit, prev: shapes, moved: false }
    } else if (room.tool === 'text') {
      room.selectShape(null)
      const s = room.style
      setEditor({ at: p, id: null, text: '', color: s.color, size: s.textSize })
      return
    } else {
      room.selectShape(null)
      gesture.current = { kind: 'create', tool: room.tool, from: p, points: [p], start: now() }
    }
    el.current?.setPointerCapture(e.pointerId)
  }

  const build = (g: Extract<Gesture, { kind: 'create' }>, p: Pt, mods: { shift: boolean; alt: boolean }): Shape | null => {
    const s = room.style
    const base = { id: 'draft', color: s.color, width: s.width, start: g.start, duration: durationFor(s.showFor, frame()) }
    switch (g.tool) {
      case 'pen':
        return { ...base, kind: 'pen', points: g.points, end: s.penEnd }
      case 'arrow':
      case 'line':
        return { ...base, kind: 'line', from: g.from, to: mods.shift ? snap45(g.from, p, px) : p, end: g.tool === 'arrow' ? 'arrow' : s.lineEnd }
      case 'circle':
      case 'box':
      case 'spotlight':
        return { ...base, kind: g.tool === 'circle' ? 'ellipse' : g.tool, ...dragBox(g.from, p, px, mods) }
      default:
        return null
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!enabled) return
    const p = point(e)
    const g = gesture.current
    const mods = { shift: e.shiftKey, alt: e.altKey }
    if (!g) {
      const h = handleAt(p)
      if (h) setCursor(HANDLE_CURSOR[h])
      else if (selected && hitShape(selected, p, px, text)) setCursor('move')
      else setCursor(room.tool === 'select' ? 'default' : room.tool === 'text' ? 'text' : 'crosshair')
      return
    }
    if (g.kind === 'create') {
      if (g.tool === 'pen') g.points.push(p)
      onDraft(build(g, p, mods))
    } else if (g.kind === 'move') {
      g.moved = true
      const next = moveShape(g.orig, p[0] - g.from[0], p[1] - g.from[1])
      room.setShapes(angle, g.prev.map((s) => (s.id === g.id ? next : s)))
    } else {
      g.moved = true
      const next = resizeShape(g.orig, g.handle, p, px, mods)
      room.setShapes(angle, g.prev.map((s) => (s.id === g.id ? next : s)))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    const p = point(e)
    if (g.kind === 'create') {
      onDraft(null)
      let shape = build(g, p, { shift: e.shiftKey, alt: e.altKey })
      if (!shape) return
      if (shape.kind === 'pen') shape = { ...shape, points: simplify(shape.points) }
      if (!bigEnough(shape, px)) return
      shape = { ...shape, id: newId() }
      room.setShapes(angle, [...room.shapesOf(angle), shape], { label: 'Drawing' })
      room.selectShape(shape.id)
    } else if (g.moved) {
      const now = room.shapesOf(angle)
      room.setShapes(angle, now, { label: g.kind === 'move' ? 'Move Drawing' : 'Resize Drawing', prev: g.prev })
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!enabled) return
    e.stopPropagation()
    const hit = hitTest(visibleShapes(), point(e), px, text)
    if (hit?.kind === 'text') {
      room.selectShape(hit.id)
      setEditor({ at: [hit.x, hit.y], id: hit.id, text: hit.text, color: hit.color, size: hit.size })
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    if (!enabled) return
    const hit = hitTest(visibleShapes(), point(e), px, text)
    if (!hit) return
    e.preventDefault()
    e.stopPropagation()
    shapeMenu(e, room, angle, hit, engine)
  }

  // Leaving Draw mode commits the text being typed.
  useEffect(() => {
    if (!enabled && editor) commitEditor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // The selection's handles.
  let handles: React.ReactNode = null
  if (selected && enabled && !editor) {
    const b = shapeBounds(selected, text)
    const list = handlesOf(selected)
    handles = (
      <svg className="draw-layer__handles" width={px.w} height={px.h} aria-hidden>
        {(selected.kind === 'pen' || selected.kind === 'text') && (
          <rect className="draw-layer__bbox" x={b.x * px.w - 4} y={b.y * px.h - 4} width={b.w * px.w + 8} height={b.h * px.h + 8} />
        )}
        {list.map((h) =>
          selected.kind === 'line' ? (
            <circle key={h.id} className="draw-layer__handle" cx={h.at[0] * px.w} cy={h.at[1] * px.h} r={5} />
          ) : (
            <rect key={h.id} className="draw-layer__handle" x={h.at[0] * px.w - 4} y={h.at[1] * px.h - 4} width={8} height={8} rx={2} />
          )
        )}
      </svg>
    )
  }

  const k = px.h / 720
  return (
    <div
      ref={el}
      className="draw-layer"
      data-enabled={enabled || undefined}
      style={{ cursor: enabled ? cursor : undefined }}
      onPointerDown={onPointerDown}
      onMouseDown={(e) => {
        // The click's default focus change would land on the room and blur (commit) the text editor just opened.
        if (enabled && !(e.target as HTMLElement).closest('.draw-text-editor')) e.preventDefault()
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        gesture.current = null
        onDraft(null)
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {handles}
      {editor && (
        <TextEditor
          key={editor.id ?? `${editor.at[0]},${editor.at[1]}`}
          initial={editor.text}
          style={{
            left: editor.at[0] * px.w,
            top: editor.at[1] * px.h,
            color: editor.color,
            fontSize: editor.size * k,
            padding: `${4 * k}px ${8 * k}px`,
            borderRadius: 4 * k
          }}
          onChange={(t) => {
            if (editorRef.current) editorRef.current = { ...editorRef.current, text: t }
            setEditor((ed) => (ed ? { ...ed, text: t } : ed))
          }}
          onCommit={commitEditor}
          onCancel={() => {
            editorRef.current = null
            setEditor(null)
          }}
        />
      )}
    </div>
  )
}

function TextEditor({
  initial,
  style,
  onChange,
  onCommit,
  onCancel
}: {
  initial: string
  style: CSSProperties
  onChange: (t: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerText = initial
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      ref={ref}
      className="draw-text-editor"
      data-test="draw-text-editor"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label="Drawing text"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerText)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onCommit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => commitRef.current()}
    />
  )
}
