import type { ReactNode } from 'react'

/**
 * Non-tabular list row (spec 01 §6.16): leading accessory, title, optional second line, trailing meta. Selection,
 * hover and "current" look like table rows.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  extra,
  trailing,
  selected,
  current,
  onClick,
  onDoubleClick,
  onContextMenu,
  draggable,
  onDragStart,
  test,
  height
}: {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** Third line (tags) for 56-tall rows. */
  extra?: ReactNode
  trailing?: ReactNode
  selected?: boolean
  current?: boolean
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  test?: string
  height?: 28 | 44 | 56
}) {
  const h = height ?? (extra ? 56 : subtitle ? 44 : 28)
  return (
    <div
      className={`list-row list-row--h${h}`}
      role="option"
      aria-selected={selected}
      aria-current={current || undefined}
      data-test={test}
      onMouseDown={(e) => e.button === 0 && e.preventDefault()}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {leading && <div className="list-row__leading">{leading}</div>}
      <div className="list-row__text">
        <div className="list-row__title ellipsis">{title}</div>
        {subtitle && <div className="list-row__subtitle ellipsis">{subtitle}</div>}
        {extra && <div className="list-row__extra">{extra}</div>}
      </div>
      {trailing && <div className="list-row__trailing">{trailing}</div>}
    </div>
  )
}
