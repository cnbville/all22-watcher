import { type ReactNode, useRef, useState } from 'react'
import type { IconName } from '@shared/icons'
import { Icon } from '../ui/Icon'
import { Segmented } from '../ui/Segmented'
import { persist, setInspectorWidth, ui, useUi } from './uiState'

/** Right-hand panel for the current selection (01 §2.7). Passed to <Screen inspector={…}>. */
export function Inspector<T extends string>({
  title,
  tabs,
  tab,
  onTab,
  children
}: {
  title?: string
  tabs?: { value: T; icon: IconName; label: string }[]
  tab?: T
  onTab?: (t: T) => void
  children?: ReactNode
}) {
  return (
    <div className="inspector">
      <div className="inspector__header">
        {tabs && tab !== undefined && onTab ? (
          <Segmented size="toolbar" value={tab} onChange={onTab} options={tabs.map((t) => ({ value: t.value, icon: t.icon, title: t.label }))} label="Inspector" />
        ) : (
          <span className="inspector__title">{title}</span>
        )}
      </div>
      <div className="inspector__body">{children ?? <div className="inspector__empty">No Selection</div>}</div>
    </div>
  )
}

/** Inspector section: 32-tall header with a hover disclosure; collapse state persists per screen. */
export function InspectorSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const screen = useUi().screen
  const key = `ui.inspector.${screen}.section.${id}`
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === 'collapsed'
    } catch {
      return false
    }
  })
  const toggle = () => {
    persist(key, collapsed ? 'expanded' : 'collapsed')
    setCollapsed(!collapsed)
  }
  return (
    <section className="inspector-section" data-collapsed={collapsed || undefined}>
      <div className="inspector-section__header">
        <span className="inspector-section__title">{title}</span>
        <button type="button" className="inspector-section__toggle" aria-label={collapsed ? 'Expand' : 'Collapse'} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
        </button>
      </div>
      {!collapsed && <div className="inspector-section__body">{children}</div>}
    </section>
  )
}

/** Label/value grid for inspector forms: `96px 1fr`. */
export function InspectorForm({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="inspector-form">
      {rows.map(([k, v], i) => (
        <div key={i} className="inspector-form__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The shell's inspector column with its leading-edge resize handle. */
export function ShellInspector() {
  const s = useUi()
  const drag = useRef<{ x: number; w: number } | null>(null)
  return (
    <aside className="shell-inspector" data-test="inspector" style={{ width: s.inspectorWidth }}>
      <div
        className="shell-inspector__resize"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: ui().inspectorWidth }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (drag.current) setInspectorWidth(drag.current.w + (drag.current.x - e.clientX))
        }}
        onPointerUp={() => (drag.current = null)}
      />
      <div id="inspector-slot" className="shell-inspector__slot" />
    </aside>
  )
}
