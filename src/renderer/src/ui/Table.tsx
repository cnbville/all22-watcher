import { type CSSProperties, Fragment, type ReactNode, useRef } from 'react'
import { Icon } from './Icon'

export interface Column<R> {
  id: string
  label: ReactNode
  width?: number
  /** Flex weight for flexible columns. */
  flex?: number
  minWidth?: number
  align?: 'left' | 'right' | 'center'
  numeric?: boolean
  sortable?: boolean
  title?: string
  render: (row: R) => ReactNode
}

export interface SortState {
  column: string
  dir: 'asc' | 'desc'
}

/**
 * Data table (spec 01 §6.15): sticky header, stripes, selection with the indigo rule, ↑/↓ select, ↩ opens,
 * double-click opens, type-select on the first text column. Rows may be grouped.
 */
export function Table<R>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  selection,
  onSelect,
  onOpen,
  onContextMenu,
  groupBy,
  groupLabel,
  density = 'regular',
  stripes = true,
  stickyTop = 52,
  test,
  rowTest,
  typeSelect,
  className
}: {
  columns: Column<R>[]
  rows: R[]
  rowKey: (r: R) => string
  sort?: SortState
  onSort?: (s: SortState) => void
  selection?: string | null
  onSelect?: (key: string, row: R) => void
  onOpen?: (row: R) => void
  onContextMenu?: (row: R, e: React.MouseEvent) => void
  groupBy?: (r: R) => string
  groupLabel?: (group: string, rows: R[]) => ReactNode
  density?: 'regular' | 'compact' | 'tall'
  stripes?: boolean
  stickyTop?: number
  test?: string
  rowTest?: string
  /** Text used for type-select. */
  typeSelect?: (r: R) => string
  className?: string
}) {
  const typed = useRef({ text: '', at: 0 })
  const template = columns
    .map((c) => (c.width ? `${c.width}px` : `minmax(${c.minWidth ?? 80}px, ${c.flex ?? 1}fr)`))
    .join(' ')
  const style = { '--table-columns': template, '--table-sticky-top': `${stickyTop}px` } as CSSProperties

  const groups: { key: string; rows: R[] }[] = []
  if (groupBy) {
    for (const r of rows) {
      const g = groupBy(r)
      const last = groups[groups.length - 1]
      if (last && last.key === g) last.rows.push(r)
      else groups.push({ key: g, rows: [r] })
    }
  } else groups.push({ key: '', rows })

  const flat = groups.flatMap((g) => g.rows)
  const index = selection ? flat.findIndex((r) => rowKey(r) === selection) : -1

  const select = (i: number) => {
    const r = flat[Math.max(0, Math.min(flat.length - 1, i))]
    if (!r) return
    onSelect?.(rowKey(r), r)
    requestAnimationFrame(() => document.querySelector(`[data-row-key="${CSS.escape(rowKey(r))}"]`)?.scrollIntoView({ block: 'nearest' }))
  }

  let stripe = 0
  return (
    <div
      className={`table table--${density}${stripes ? ' table--stripes' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      role="grid"
      tabIndex={onSelect ? 0 : -1}
      data-test={test}
      onKeyDown={(e) => {
        if (!onSelect) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          select(index + (e.key === 'ArrowDown' ? 1 : -1))
        } else if (e.key === 'Enter' && index >= 0) {
          e.preventDefault()
          e.stopPropagation()
          onOpen?.(flat[index])
        } else if (typeSelect && e.key.length === 1 && !e.metaKey && !e.ctrlKey && e.key !== ' ') {
          const now = performance.now()
          typed.current = { text: (now - typed.current.at < 1000 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
          const j = flat.findIndex((r) => typeSelect(r).toLowerCase().startsWith(typed.current.text))
          if (j >= 0) select(j)
          e.stopPropagation()
        }
      }}
    >
      <div className="table__header" role="row">
        {columns.map((c) => {
          const sorted = sort?.column === c.id
          return (
            <div
              key={c.id}
              role="columnheader"
              className={`table__th${c.numeric || c.align === 'right' ? ' table__cell--right' : ''}${c.sortable ? ' table__th--sortable' : ''}`}
              aria-sort={sorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              title={c.title}
              onClick={() => {
                if (!c.sortable || !onSort) return
                onSort({ column: c.id, dir: sorted ? (sort!.dir === 'asc' ? 'desc' : 'asc') : c.numeric ? 'desc' : 'asc' })
              }}
            >
              <span>{c.label}</span>
              {sorted && <Icon name={sort!.dir === 'asc' ? 'chevron-up' : 'chevron-down'} size={10} />}
            </div>
          )
        })}
      </div>
      {groups.map((g) => (
        <Fragment key={g.key || 'all'}>
          {groupBy && (
            <div className="table__group" role="row">
              {groupLabel ? groupLabel(g.key, g.rows) : g.key}
            </div>
          )}
          {g.rows.map((r) => {
            const key = rowKey(r)
            const odd = stripe++ % 2 === 1
            return (
              <div
                key={key}
                role="row"
                className="table__row"
                data-row-key={key}
                data-stripe={odd || undefined}
                aria-selected={selection === key}
                data-test={rowTest}
                onMouseDown={(e) => {
                  if (e.button === 0 && !(e.target as HTMLElement).closest('a, button, input')) onSelect?.(key, r)
                }}
                onDoubleClick={() => onOpen?.(r)}
                onContextMenu={(e) => {
                  if (!onContextMenu) return
                  e.preventDefault()
                  onSelect?.(key, r)
                  onContextMenu(r, e)
                }}
              >
                {columns.map((c) => (
                  <div key={c.id} role="gridcell" className={`table__cell${c.numeric || c.align === 'right' ? ' table__cell--right' : ''}${c.numeric ? ' num' : ''}`}>
                    {c.render(r)}
                  </div>
                ))}
              </div>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}

/** "—" for a missing value, in --label-4. */
export function Missing() {
  return <span className="missing">—</span>
}
