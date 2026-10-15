/**
 * Every icon the app draws, by its lucide-react (1.57.0) kebab-case name. The renderer maps each name to its
 * component in `ui/icons.ts`; adding a name here without a component there is a type error.
 */
export const ICON_NAMES = [
  // Navigation and chrome
  'chevron-left', 'chevron-right', 'chevron-up', 'chevron-down', 'chevrons-up-down',
  'panel-left', 'panel-right', 'search', 'circle-x', 'x', 'ellipsis', 'check', 'plus', 'minus',
  // Sections
  'house', 'film', 'shield', 'trophy', 'swords', 'arrow-left-right', 'list-video', 'list-filter', 'list-plus',
  'bookmark-plus', 'folder-input', 'folder-sync', 'folder-open', 'database', 'refresh-cw',
  // Settings
  'settings', 'tags', 'clipboard-list',
  // Playback
  'play', 'pause', 'skip-back', 'skip-forward', 'step-back', 'step-forward', 'rotate-ccw', 'crosshair', 'gauge',
  'repeat', 'video', 'video-off', 'columns-2', 'maximize-2', 'minimize-2', 'picture-in-picture-2', 'volume-2',
  'volume-x', 'layout-list',
  // Drawing
  'pen-line', 'move-up-right', 'circle', 'square', 'type', 'undo-2', 'redo-2', 'eraser', 'mouse-pointer-2',
  'spotlight', 'bring-to-front', 'send-to-back',
  // Grading
  'flag', 'zap', 'star', 'message-square-text', 'scan-eye', 'users-round', 'user-round', 'user-round-x', 'unlink',
  // Export and files
  'share', 'file-spreadsheet', 'file-text', 'clapperboard', 'arrow-down-up', 'timer',
  // Lists and data
  'funnel', 'arrow-down-wide-narrow', 'grip-vertical', 'calendar', 'history', 'chart-column', 'chart-line',
  'chart-scatter', 'layout-grid', 'list', 'sliders-horizontal',
  // Status and help
  'info', 'circle-check', 'triangle-alert', 'circle-alert', 'keyboard', 'circle-help',
  // Edit
  'trash-2', 'copy', 'pencil'
] as const

export type IconName = (typeof ICON_NAMES)[number]
