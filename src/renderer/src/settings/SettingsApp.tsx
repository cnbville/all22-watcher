import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SETTINGS_PANES, type SettingsPane } from '@shared/shell'
import type { IconName } from '@shared/icons'
import { Icon } from '../ui/Icon'
import { MenuHost } from '../ui/Menu'
import { BannerHost } from '../shell/Banners'
import { installKeyRouter } from '../shell/keyRouter'
import { useRoute } from '../shell/router'
import { ChartingPane } from './panes/ChartingPane'
import { DataPane } from './panes/DataPane'
import { FilmPane } from './panes/FilmPane'
import { GeneralPane } from './panes/GeneralPane'
import { GradingPane } from './panes/GradingPane'
import './settings.css'

/** The Settings window (01 §4): icon tabs, one pane at a time, the window fits the pane. */

const PANES: Record<SettingsPane, { label: string; icon: IconName; render: () => ReactNode }> = {
  general: { label: 'General', icon: 'settings', render: () => <GeneralPane /> },
  grading: { label: 'Grading', icon: 'tags', render: () => <GradingPane /> },
  charting: { label: 'Charting', icon: 'clipboard-list', render: () => <ChartingPane /> },
  film: { label: 'Film & Import', icon: 'film', render: () => <FilmPane /> },
  data: { label: 'Data', icon: 'database', render: () => <DataPane /> }
}

function readPane(): SettingsPane {
  try {
    const p = localStorage.getItem('ui.settings.pane') as SettingsPane | null
    return p && SETTINGS_PANES.includes(p) ? p : 'general'
  } catch {
    return 'general'
  }
}

export function SettingsApp() {
  const route = useRoute()
  const fromRoute = route.path[0] === 'settings' && SETTINGS_PANES.includes(route.path[1] as SettingsPane) ? (route.path[1] as SettingsPane) : null
  const [pane, setPane] = useState<SettingsPane>(fromRoute ?? readPane())
  const [fading, setFading] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const tabs = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (fromRoute) switchTo(fromRoute)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromRoute])

  useEffect(() => installKeyRouter(), [])

  // Main sends navigate when Settings is already open on another pane.
  useEffect(() => window.shell.onNavigate((r) => {
    const p = r.split('/')[2] as SettingsPane
    if (SETTINGS_PANES.includes(p)) switchTo(p)
  }), [])

  const switchTo = (p: SettingsPane) => {
    if (p === pane) return
    setFading(true)
    setTimeout(() => {
      setPane(p)
      setFading(false)
    }, 80)
  }

  useEffect(() => {
    document.title = PANES[pane].label
    try {
      localStorage.setItem('ui.settings.pane', pane)
    } catch {
      // Not remembered.
    }
  }, [pane])

  // Report the pane's natural height so the window fits it (84 + pane).
  useLayoutEffect(() => {
    const el = content.current
    if (!el) return
    const report = () => window.shell.setContentHeight(Math.ceil(el.scrollHeight))
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pane])

  // ⌘W closes the window through the menu; esc does nothing here (macOS settings windows ignore it).

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = SETTINGS_PANES.indexOf(pane)
    const next = SETTINGS_PANES[(i + (e.key === 'ArrowRight' ? 1 : SETTINGS_PANES.length - 1)) % SETTINGS_PANES.length]
    switchTo(next)
    tabs.current?.querySelector<HTMLElement>(`[data-pane="${next}"]`)?.focus()
  }

  return (
    <div className="settings-window">
      <div className="settings-window__titlebar">{PANES[pane].label}</div>
      <div ref={tabs} className="settings-window__tabs" role="tablist" onKeyDown={onTabKey}>
        {SETTINGS_PANES.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            data-pane={p}
            aria-selected={p === pane}
            className="settings-tab"
            data-test={`settings-tab-${p}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => switchTo(p)}
          >
            <Icon name={PANES[p].icon} size={20} />
            <span className="settings-tab__label">{PANES[p].label}</span>
          </button>
        ))}
      </div>
      <div className="settings-window__body">
        <div ref={content} className="settings-pane" data-state={fading ? 'leaving' : undefined} data-test={`settings-pane-${pane}`}>
          {PANES[pane].render()}
        </div>
      </div>
      <div id="layer-popover" />
      <BannerHost />
      <MenuHost />
    </div>
  )
}
