import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { DIVISIONS, TEAM_BY_ABBR, TEAMS } from '@shared/teams'
import type { IconName } from '@shared/icons'
import type { SeasonStatus } from '@shared/types'
import { Button } from '../ui/Button'
import { CountBadge, PlainCount } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import { type MenuItemSpec, openMenu } from '../ui/Menu'
import { Popover } from '../ui/Popover'
import { SearchField } from '../ui/SearchField'
import { TeamLogo } from '../ui/TeamChip'
import * as adapters from './adapters'
import type { CutupSummary } from './adapters'
import { DataStatusRow, WatchStatusRow } from './StatusRows'
import { addPlaysTo, confirmDeleteCutup, cutupMenu, newSmartCutup } from '../views/cutups/actions'
import { ExportStatusRow } from '../views/export/ExportStatus'
import { banner, errorBanner } from './Banners'
import { action, sep, showMenu, teamMenu } from './contextMenus'
import { links, navigate, useHistory } from './router'
import { addMyTeam, reorderMyTeams, setSeason, useMyTeams, useSeason } from './store'
import { ui, setSidebarWidth, setUi, toggleSidebar, useUi } from './uiState'

/** The source list (01 §1.2). */

export const PRIMARY: { key: string; label: string; icon: IconName; test: string }[] = [
  { key: 'home', label: 'Home', icon: 'house', test: 'sidebar-item-home' },
  { key: 'film', label: 'Film', icon: 'film', test: 'sidebar-item-film' },
  { key: 'teams', label: 'Teams', icon: 'shield', test: 'sidebar-item-teams' },
  { key: 'leaderboards', label: 'Leaderboards', icon: 'trophy', test: 'sidebar-item-leaderboards' },
  { key: 'matchups', label: 'Matchups', icon: 'swords', test: 'sidebar-item-matchups' }
]

function read(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/** Where each primary item goes, given the global season. */
export function primaryRoute(key: string, season: number): string {
  switch (key) {
    case 'home':
      return links.home()
    case 'film':
      return links.film()
    case 'teams':
      return links.teams(season)
    case 'leaderboards':
      return links.leaders(season, read('ui.leaders.pos', 'QB') as never)
    case 'matchups': {
      const last = read('ui.matchup.last', '')
      const [team, opp] = last.split('|')
      return team && opp ? links.matchup(season, team, opp) : links.matchup(season)
    }
    default:
      return links.home()
  }
}

// ── Season popup ────────────────────────────────────────────────────────────

export function seasonMenuItems(seasons: SeasonStatus[], season: number | null, choose: (s: number) => void, manage: (() => void) | null): MenuItemSpec[] {
  const down = seasons.filter((s) => s.downloaded)
  const notDown = seasons.filter((s) => !s.downloaded)
  const item = (s: SeasonStatus): MenuItemSpec => ({ label: String(s.season), checked: s.season === season, run: () => choose(s.season), test: `season-option-${s.season}` })
  const items: MenuItemSpec[] = []
  if (down.length) items.push({ kind: 'header', label: 'Downloaded' }, ...down.map(item))
  if (down.length && notDown.length) items.push({ kind: 'separator' })
  if (notDown.length) items.push({ kind: 'header', label: 'Not Downloaded' }, ...notDown.map(item))
  if (manage) items.push({ kind: 'separator' }, { label: 'Manage Seasons…', run: manage })
  return items
}

export function SeasonPopup({ test = 'season-popup' }: { test?: string }) {
  const { season, seasons } = useSeason()
  const ref = useRef<HTMLButtonElement>(null)
  const open = () => {
    if (!ref.current || !seasons) return
    const r = ref.current.getBoundingClientRect()
    openMenu({
      anchor: new DOMRect(r.left, r.top, r.width, r.height),
      items: seasonMenuItems(seasons, season, setSeason, () => void window.shell.openSettings('data')),
      placement: 'below',
      width: 220
    })
  }
  return (
    <button
      ref={ref}
      type="button"
      className="season-popup"
      data-test={test}
      aria-haspopup="menu"
      onMouseDown={(e) => {
        e.preventDefault()
        open()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault()
          open()
        }
      }}
    >
      <span className="season-popup__label">{season ? `${season} season` : 'Season'}</span>
      <Icon name="chevrons-up-down" size={12} className="season-popup__chevrons" />
    </button>
  )
}

// ── Rows ────────────────────────────────────────────────────────────────────

interface RowProps {
  rowKey: string
  icon: ReactNode
  label: ReactNode
  trailing?: ReactNode
  selected: boolean
  dimmed?: boolean
  test?: string
  title?: string
  onOpen: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onDoubleClickLabel?: () => void
  drag?: {
    draggable: boolean
    onDragStart?: (e: React.DragEvent) => void
    onDragOver?: (e: React.DragEvent) => void
    onDragLeave?: () => void
    onDrop?: (e: React.DragEvent) => void
    dropTarget?: boolean
  }
}

function Row({ rowKey, icon, label, trailing, selected, dimmed, test, title, onOpen, onContextMenu, onDoubleClickLabel, drag }: RowProps) {
  return (
    <div
      className="sidebar-row"
      role="treeitem"
      aria-selected={selected}
      data-key={rowKey}
      data-test={test}
      data-dimmed={dimmed || undefined}
      data-drop={drag?.dropTarget || undefined}
      title={title}
      onMouseDown={(e) => e.button === 0 && e.preventDefault()}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      draggable={drag?.draggable}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag?.onDrop}
    >
      <span className="sidebar-row__icon">{icon}</span>
      <span className="sidebar-row__label" onDoubleClick={onDoubleClickLabel}>
        {label}
      </span>
      {trailing !== undefined && <span className="sidebar-row__trailing">{trailing}</span>}
    </div>
  )
}

function SectionHeader({
  id,
  label,
  collapsed,
  onToggle,
  onAdd,
  addLabel,
  onLabelClick,
  addRef
}: {
  id: string
  label: string
  collapsed: boolean
  onToggle: () => void
  onAdd: (e?: React.MouseEvent) => void
  addLabel: string
  onLabelClick?: () => void
  addRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <div className="sidebar-section__header" data-section={id}>
      <span className="sidebar-section__label" data-link={onLabelClick ? true : undefined} onClick={onLabelClick}>
        {label}
      </span>
      <button ref={addRef} type="button" className="sidebar-section__button" aria-label={addLabel} title={addLabel} onMouseDown={(e) => e.preventDefault()} onClick={(e) => onAdd(e)}>
        <Icon name="plus" size={14} />
      </button>
      <button type="button" className="sidebar-section__button" aria-label={collapsed ? `Show ${label}` : `Hide ${label}`} onMouseDown={(e) => e.preventDefault()} onClick={onToggle}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
      </button>
    </div>
  )
}

function useSectionState(id: string): [boolean, () => void] {
  const key = `ui.sidebar.section.${id}`
  const [collapsed, setCollapsed] = useState(() => read(key, 'expanded') === 'collapsed')
  return [
    collapsed,
    () => {
      try {
        localStorage.setItem(key, collapsed ? 'expanded' : 'collapsed')
      } catch {
        // Not remembered.
      }
      setCollapsed(!collapsed)
    }
  ]
}

// ── Team picker ─────────────────────────────────────────────────────────────

export function TeamPicker({ onPick, exclude = [] }: { onPick: (abbr: string) => void; exclude?: string[] }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const match = (abbr: string) => {
    const t = TEAM_BY_ABBR[abbr]
    return !needle || t.abbr.toLowerCase().startsWith(needle) || t.name.toLowerCase().includes(needle)
  }
  return (
    <div className="team-picker">
      <SearchField size="md" value={q} onChange={setQ} placeholder="Search teams" autoFocus />
      <div className="team-picker__list">
        {DIVISIONS.map((div) => {
          const teams = TEAMS.filter((t) => t.division === div && match(t.abbr))
          if (!teams.length) return null
          return (
            <div key={div}>
              <div className="team-picker__division">{div}</div>
              {teams.map((t) => (
                <button key={t.abbr} type="button" className="team-picker__row" disabled={exclude.includes(t.abbr)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(t.abbr)}>
                  <TeamLogo abbr={t.abbr} size={18} />
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar({ cutups, badges, onNewCutup, renaming, setRenaming }: {
  cutups: CutupSummary[]
  badges: adapters.SidebarBadges
  onNewCutup: () => void
  renaming: string | null
  setRenaming: (id: string | null) => void
}) {
  const s = useUi()
  const { season } = useSeason()
  const myTeams = useMyTeams()
  const h = useHistory()
  const current = h.entries[h.index]?.sidebarKey ?? 'home'
  const selectedKey = current.startsWith('team:') && !myTeams.includes(current.slice(5)) ? 'teams' : current
  const [teamsCollapsed, toggleTeams] = useSectionState('myTeams')
  const [cutupsCollapsed, toggleCutups] = useSectionState('cutups')
  const [pickerOpen, setPickerOpen] = useState(false)
  const addTeamRef = useRef<HTMLButtonElement>(null)
  const emptyTeamRef = useRef<HTMLDivElement>(null)
  const pickerAnchor = useRef<HTMLElement | null>(null)
  const [dragTeam, setDragTeam] = useState<string | null>(null)
  const [dropCutup, setDropCutup] = useState<string | null>(null)
  const [dragCutup, setDragCutup] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })

  const go = (route: string) => {
    navigate(route)
    if (ui().narrow) setUi({ overlayOpen: false })
  }

  const rows = useMemo(() => {
    const out: { key: string; open: () => void; label: string; section?: string; cutup?: CutupSummary }[] = []
    for (const p of PRIMARY) out.push({ key: p.key, label: p.label, open: () => season && go(primaryRoute(p.key, season)) })
    if (!teamsCollapsed) for (const t of myTeams) out.push({ key: `team:${t}`, label: TEAM_BY_ABBR[t]?.nickname ?? t, section: 'myTeams', open: () => season && go(links.team(season, t)) })
    if (!cutupsCollapsed) for (const c of cutups) out.push({ key: `cutup:${c.cutup.id}`, label: c.cutup.name, section: 'cutups', cutup: c, open: () => go(links.cutup(c.cutup.id)) })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, myTeams, cutups, teamsCollapsed, cutupsCollapsed])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const i = rows.findIndex((r) => r.key === selectedKey)
    const row = rows[i]
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      next?.open()
    } else if (e.key === 'ArrowLeft' && row?.section) {
      e.preventDefault()
      if (row.section === 'myTeams' && !teamsCollapsed) toggleTeams()
      if (row.section === 'cutups' && !cutupsCollapsed) toggleCutups()
    } else if (e.key === 'ArrowRight') {
      if (teamsCollapsed) toggleTeams()
      if (cutupsCollapsed) toggleCutups()
    } else if (e.key === 'Enter' && row?.cutup) {
      e.preventDefault()
      setRenaming(row.cutup.cutup.id)
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && row?.cutup) {
      e.preventDefault()
      void confirmDeleteCutup(row.cutup)
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const now = performance.now()
      typed.current = { text: now - typed.current.at > 1000 ? e.key : typed.current.text + e.key, at: now }
      const hit = rows.find((r) => r.label.toLowerCase().startsWith(typed.current.text.toLowerCase()))
      hit?.open()
    }
  }

  // Resizing the trailing edge (01 §1.2): 200–320, below 160 collapses, double-click resets.
  const drag = useRef<{ x: number; w: number } | null>(null)

  return (
    <aside className="shell-sidebar" data-test="sidebar" style={{ width: s.sidebarWidth }}>
      <div className="shell-sidebar__band" />
      <div className="shell-sidebar__season">
        <SeasonPopup />
      </div>
      <div ref={list} className="shell-sidebar__list" role="tree" tabIndex={0} onKeyDown={onKeyDown} aria-label="Sidebar">
        {PRIMARY.map((p) => (
          <Row
            key={p.key}
            rowKey={p.key}
            test={p.test}
            icon={<Icon name={p.icon} size={16} />}
            label={p.label}
            selected={selectedKey === p.key}
            trailing={p.key === 'film' && badges.newFilm > 0 ? <CountBadge count={badges.newFilm} /> : undefined}
            onOpen={() => season && go(primaryRoute(p.key, season))}
          />
        ))}
        <div className="sidebar-section">
          <SectionHeader id="myTeams" label="My teams" collapsed={teamsCollapsed} onToggle={toggleTeams} addLabel="Add team" addRef={addTeamRef} onAdd={() => ((pickerAnchor.current = addTeamRef.current), setPickerOpen(true))} />
          {!teamsCollapsed &&
            (myTeams.length ? (
              myTeams.map((abbr) => {
                const n = badges.teams[abbr] ?? 0
                return (
                  <Row
                    key={abbr}
                    rowKey={`team:${abbr}`}
                    test={`sidebar-team-${abbr}`}
                    icon={<TeamLogo abbr={abbr} size={18} />}
                    label={TEAM_BY_ABBR[abbr]?.nickname ?? abbr}
                    selected={selectedKey === `team:${abbr}`}
                    trailing={n > 0 ? <CountBadge count={n} title={`${n} ${n === 1 ? 'game' : 'games'} with ungraded plays`} /> : undefined}
                    onOpen={() => season && go(links.team(season, abbr))}
                    onContextMenu={(e) => season && void showMenu(e, teamMenu(season, abbr))}
                    drag={{
                      draggable: true,
                      onDragStart: (e) => {
                        setDragTeam(abbr)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/x-all22-team', abbr)
                      },
                      onDragOver: (e) => {
                        if (!dragTeam || dragTeam === abbr) return
                        e.preventDefault()
                      },
                      onDrop: (e) => {
                        e.preventDefault()
                        if (!dragTeam || dragTeam === abbr) return
                        const order = myTeams.filter((t) => t !== dragTeam)
                        order.splice(order.indexOf(abbr) + (myTeams.indexOf(dragTeam) < myTeams.indexOf(abbr) ? 1 : 0), 0, dragTeam)
                        setDragTeam(null)
                        void reorderMyTeams(order)
                      }
                    }}
                  />
                )
              })
            ) : (
              <div ref={emptyTeamRef}>
                <Row rowKey="addTeam" dimmed icon={<Icon name="plus" size={16} />} label="Add team…" selected={false} onOpen={() => ((pickerAnchor.current = emptyTeamRef.current), setPickerOpen(true))} />
              </div>
            ))}
        </div>
        <div className="sidebar-section">
          <SectionHeader id="cutups" label="Cut-ups" collapsed={cutupsCollapsed} onToggle={toggleCutups} addLabel="New cut-up (⌥-click for smart)" onAdd={(e) => (e?.altKey ? newSmartCutup() : onNewCutup())} onLabelClick={() => go(links.cutups())} />
          {!cutupsCollapsed &&
            (cutups.length ? (
              cutups.map((c) => {
                const id = c.cutup.id
                const smart = c.cutup.kind === 'smart'
                return (
                  <Row
                    key={id}
                    rowKey={`cutup:${id}`}
                    test={`sidebar-cutup-${id}`}
                    icon={<Icon name={smart ? 'list-filter' : 'list-video'} size={16} />}
                    label={renaming === id ? <RenameField name={c.cutup.name} onDone={(name) => commitRename(id, c.cutup.name, name, setRenaming)} /> : c.cutup.name}
                    selected={selectedKey === `cutup:${id}`}
                    trailing={renaming === id ? undefined : <PlainCount count={c.playCount} />}
                    onOpen={() => go(links.cutup(id))}
                    onDoubleClickLabel={() => setRenaming(id)}
                    onContextMenu={(e) => void showMenu(e, cutupMenu(c, () => setRenaming(id)))}
                    title={`${smart ? 'Smart cut-up' : c.cutup.name} · ${c.playCount} ${c.playCount === 1 ? 'play' : 'plays'} · ${c.gameCount} ${c.gameCount === 1 ? 'game' : 'games'}`}
                    drag={{
                      draggable: renaming !== id,
                      dropTarget: dropCutup === id,
                      onDragStart: (e) => {
                        setDragCutup(id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/x-all22-cutup', id)
                      },
                      onDragOver: (e) => {
                        // Reordering cut-ups (03 §9.7), or plays dropped onto a manual one (01 §1.4.6).
                        if (dragCutup && e.dataTransfer.types.includes('text/x-all22-cutup')) {
                          if (dragCutup !== id) e.preventDefault()
                          return
                        }
                        if (smart || !e.dataTransfer.types.includes('text/x-all22-play')) return
                        e.preventDefault()
                        setDropCutup(id)
                      },
                      onDragLeave: () => setDropCutup(null),
                      onDrop: (e) => {
                        setDropCutup(null)
                        if (dragCutup && e.dataTransfer.types.includes('text/x-all22-cutup')) {
                          e.preventDefault()
                          const ids = cutups.map((x) => x.cutup.id)
                          const from = ids.indexOf(dragCutup)
                          const order = ids.filter((x) => x !== dragCutup)
                          order.splice(order.indexOf(id) + (from < ids.indexOf(id) ? 1 : 0), 0, dragCutup)
                          setDragCutup(null)
                          void adapters.reorderCutups(order).catch((err) => errorBanner('Couldn’t move the cut-up', err))
                          return
                        }
                        if (smart) return
                        e.preventDefault()
                        try {
                          const plays = JSON.parse(e.dataTransfer.getData('text/x-all22-play')) as { gameId: string; playId: number }[]
                          void addPlaysTo(id, c.cutup.name, plays)
                        } catch {
                          // Not a play drag.
                        }
                      }
                    }}
                  />
                )
              })
            ) : (
              <Row rowKey="newCutup" dimmed icon={<Icon name="plus" size={16} />} label="New cut-up" selected={false} onOpen={onNewCutup} />
            ))}
        </div>
      </div>
      <div className="shell-sidebar__footer">
        <WatchStatusRow />
        {season && <DataStatusRow season={season} />}
        <ExportStatusRow />
      </div>
      <div
        className="shell-sidebar__resize"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: ui().sidebarWidth }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const w = drag.current.w + e.clientX - drag.current.x
          if (w < 160) {
            drag.current = null
            toggleSidebar()
          } else setSidebarWidth(w)
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => setSidebarWidth(240)}
      />
      <Popover anchor={pickerAnchor} open={pickerOpen} onClose={() => setPickerOpen(false)} placement="right" width={280} padding="list">
        <TeamPicker
          exclude={myTeams}
          onPick={(abbr) => {
            setPickerOpen(false)
            void addMyTeam(abbr)
          }}
        />
      </Popover>
    </aside>
  )
}

function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(name)
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      className="sidebar-rename"
      autoFocus
      value={v}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v)
        else if (e.key === 'Escape') {
          e.preventDefault()
          finish(null)
        }
      }}
      onBlur={() => finish(v)}
    />
  )
}

function commitRename(id: string, old: string, name: string | null, setRenaming: (id: string | null) => void) {
  setRenaming(null)
  const next = name?.trim()
  if (!next || next === old) return
  void adapters.updateCutup(id, { name: next.slice(0, 80) }).catch((e) => errorBanner('Couldn’t rename the cut-up', e))
}

// The Cut-up context menu and delete live with the cut-ups (03 §10.3); re-exported for existing callers.
export { confirmDeleteCutup, cutupMenu }
