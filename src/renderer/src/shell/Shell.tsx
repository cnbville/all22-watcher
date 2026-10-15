import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { Activity } from '@shared/types'
import { Button } from '../ui/Button'
import { MenuHost } from '../ui/Menu'
import { commandTooltip } from '@shared/commands'
import { ImportFilm } from '../views/import/ImportFilm'
import { AnalysisHost } from '../views/AnalysisHost'
import { newSmartCutup } from '../views/cutups/actions'
import type { CutupSummary, SidebarBadges } from '@shared/types'
import { banner, BannerHost, errorBanner } from './Banners'
import { runCommand, setDynamicMenus, useCommand } from './commands'
import { emit, useDataEvent } from './dataEvents'
import { DropOverlay } from './DropOverlay'
import { ShellInspector } from './Inspector'
import { closeImport, importContext, openImport, sheetDropHandler, useImportContext, useImportRequest } from './importRequest'
import { checkClipAlignment } from '../views/import/fixMatches'
import { api, rawApi } from '../api'
import { installKeyRouter } from './keyRouter'
import { KeyboardShortcuts } from './KeyboardShortcuts'
import { QuickOpen } from './QuickOpen'
import { back, forward, links, navigate, routeNow, setSettingsOpener, useHistory } from './router'
import { primaryRoute, Sidebar } from './Sidebar'
import { onSeasonChange, refreshSeasons, saveSettings, seasonNow, setSeason, useMyTeams, useSeason, useSettings } from './store'
import { focusToolbarSearch, ShellToolbar } from './Toolbar'
import { setUi, sidebarShown, toggleInspector, toggleSidebar, ui, useUi } from './uiState'
import { Welcome } from './Welcome'

/** The main window's chrome (01 §2.2): sidebar, toolbar, content, inspector and the transient layers. */

const runCommandLater = (id: Parameters<typeof runCommand>[0]) => setTimeout(() => runCommand(id), 0)

const SEASON_SCOPED = /^\/(teams|team|player|leaders|matchup)\/(\d{4})(.*)$/

function useShellCommands(cutupsList: CutupSummary[], startNewCutup: () => void) {
  const h = useHistory()
  const s = useUi()
  const { season, seasons } = useSeason()
  const myTeams = useMyTeams()
  const go = (key: string) => season && navigate(primaryRoute(key, season))
  useCommand('go.back', back, { enabled: h.canGoBack })
  useCommand('go.forward', forward, { enabled: h.canGoForward })
  useCommand('go.home', () => go('home'))
  useCommand('go.film', () => go('film'))
  useCommand('go.teams', () => go('teams'))
  useCommand('go.leaderboards', () => go('leaderboards'))
  useCommand('go.matchups', () => go('matchups'))
  useCommand('go.quickOpen', () => setUi({ quickOpen: true }))
  useCommand('go.season', (arg) => arg && setSeason(Number(arg)), { enabled: !!seasons?.length })
  useCommand('go.manageSeasons', () => void window.shell.openSettings('data'))
  useCommand('go.team', (arg) => arg && season && navigate(links.team(season, arg)), { enabled: myTeams.length > 0 })
  useCommand('go.cutups', () => navigate(links.cutups()))
  useCommand('go.cutup', (arg) => arg && navigate(links.cutup(arg)), { enabled: cutupsList.length > 0 })
  useCommand('view.sidebar', toggleSidebar, { label: sidebarShown(s) ? 'Hide Sidebar' : 'Show Sidebar', enabled: !s.filmOnly })
  useCommand('view.inspector', toggleInspector, { enabled: s.hasInspector, label: s.inspectorVisible ? 'Hide Inspector' : 'Show Inspector' })
  useCommand('file.newCutup', startNewCutup)
  useCommand('file.newSmartCutup', () => newSmartCutup())
  useCommand('file.importFilm', () => {
    const ctx = importContext()
    openImport(ctx ? { game: ctx.game, team: ctx.team } : {})
  })
  const downloaded = !!season && !!seasons?.some((x) => x.season === season && x.downloaded)
  const [updating, setUpdating] = useState(false)
  useCommand(
    'file.updateData',
    () => {
      if (!season || updating) return
      setUpdating(true)
      rawApi
        .updateSeasonNow(season)
        .then(
          (st) => {
            void refreshSeasons()
            if (st.state === 'failed') errorBanner(`Couldn’t update ${season} data`, st.error ?? 'The download failed.', () => runCommandLater('file.updateData'))
            else banner({ title: `${season} data updated`, kind: 'success' })
          },
          (e) => errorBanner(`Couldn’t update ${season} data`, e)
        )
        .finally(() => setUpdating(false))
    },
    { enabled: downloaded && !updating, label: season ? `Update ${season} Season Data` : undefined }
  )
  // File › Check Clip Alignment (improvement 14) for the game in context; screens with a selected game may register their own.
  const ctx = useImportContext()
  useCommand('file.checkAlignment', () => ctx && void checkClipAlignment(ctx.game, ctx.team), { enabled: !!ctx })
  useCommand('file.openRecent', (arg) => {
    const [gameId, team] = (arg ?? '').split('|')
    if (gameId) navigate(links.tape(gameId, team ?? ''))
  })
  useCommand('edit.find', () => {
    if (!focusToolbarSearch()) setUi({ quickOpen: true })
  })
  useCommand('help.shortcuts', (arg) => setUi({ shortcuts: { open: true, filter: arg } }))
  useCommand('help.welcome', () => setUi({ welcome: true }))
}

export function Shell({ children }: { children: ReactNode }) {
  const s = useUi()
  const settings = useSettings()
  const { season, seasons } = useSeason()
  const myTeams = useMyTeams()
  const importReq = useImportRequest()
  const [cutupsList, setCutups] = useState<CutupSummary[]>([])
  const [badges, setBadges] = useState<SidebarBadges>({ newFilm: 0, teams: {} })
  const [renaming, setRenaming] = useState<string | null>(null)

  // Keyboard, focus, full screen, narrow windows.
  useEffect(() => installKeyRouter(), [])
  useEffect(() => {
    const html = document.documentElement
    const focus = () => {
      html.dataset.windowFocused = 'true'
      setUi({ windowFocused: true })
    }
    const blur = () => {
      html.dataset.windowFocused = 'false'
      setUi({ windowFocused: false })
    }
    const resize = () => setUi({ narrow: window.innerWidth < 1100 })
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', resize)
    const offState = window.shell.onWindowState((st) => {
      html.dataset.fullscreen = String(st.fullScreen)
      html.dataset.reduceTransparency = String(st.reduceTransparency)
      setUi({ fullScreen: st.fullScreen })
    })
    // Mouse buttons 4/5 are Back/Forward (01 §1.4.1).
    const mouse = (e: MouseEvent) => {
      if (e.button === 3) back()
      else if (e.button === 4) forward()
    }
    window.addEventListener('mouseup', mouse)
    setSettingsOpener((pane) => void window.shell.openSettings(pane))
    const offNav = window.shell.onNavigate((route) => navigate(route))
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mouseup', mouse)
      offState()
      offNav()
    }
  }, [])

  // Changing the season rewrites a season-scoped route to the same entity in the new season (01 §1.3).
  useEffect(
    () =>
      onSeasonChange((next) => {
        const m = SEASON_SCOPED.exec(routeNow().raw)
        if (m && Number(m[2]) !== next) navigate(`/${m[1]}/${next}${m[3]}`, { replace: true })
      }),
    []
  )

  // Cut-ups and badges for the sidebar.
  const loadCutups = useCallback(() => {
    rawApi.cutups().then(setCutups, () => setCutups([]))
  }, [])
  useEffect(loadCutups, [loadCutups])
  // Smart cut-up counts change with grades, notes, film and seasons too.
  useDataEvent(['cutups', 'grades', 'notes', 'film', 'season'], loadCutups)
  const loadBadges = useCallback(() => {
    if (!season) return
    rawApi.sidebarBadges(season).then(setBadges, () => undefined)
  }, [season, myTeams.join()])
  useEffect(loadBadges, [loadBadges])
  useDataEvent(['film', 'grades', 'season'], loadBadges)
  useEffect(() => window.shell.setDockBadge(badges.newFilm), [badges.newFilm])

  // Dynamic menus the shell owns.
  useEffect(() => {
    setDynamicMenus({
      seasons: (seasons ?? []).map((x) => ({ season: x.season, downloaded: x.downloaded, checked: x.season === season })),
      myTeams: myTeams.map((abbr) => ({ abbr, label: TEAM_BY_ABBR[abbr]?.nickname ?? abbr })),
      cutups: cutupsList.map((c) => ({ id: c.cutup.id, label: c.cutup.name, smart: c.cutup.kind === 'smart' })),
      season
    })
  }, [seasons, season, myTeams, cutupsList])

  // Activities that finish in main: refresh screens, notify (01 §3.7), Dock progress.
  useEffect(() => {
    const running = new Map<string, Activity>()
    const onActivity = (a: Activity) => {
      if (a.state === 'running') running.set(a.id, a)
      else running.delete(a.id)
      const fractions = [...running.values()].map((x) => (x.total ? x.done / x.total : 0))
      window.shell.setDockProgress(fractions.length ? fractions.reduce((p, q) => p + q, 0) / fractions.length : -1)
      if (a.state === 'running' || a.state === 'cancelled') return
      if (a.kind === 'import' || a.kind === 'watch' || a.kind === 'convert') emit('film')
      if (a.kind === 'download') emit('season')
      // Exports post their own banner with the file's facts (views/export).
      if (a.notification && a.kind !== 'export') {
        const n = a.notification
        void window.shell.notify(n).then((where) => {
          if (where !== 'in-app') return
          banner({
            title: n.title,
            body: n.body,
            kind: a.state === 'failed' ? 'error' : 'success',
            action: n.revealPath ? { label: 'Show in Finder', run: () => window.shell.showItemInFolder(n.revealPath!) } : n.route ? { label: 'Open', run: () => navigate(n.route!) } : undefined
          })
        })
      }
    }
    const offActivity = window.shell.onActivity(onActivity)
    const offEvents = rawApi.onApiEvent((e) => {
      if (e.type === 'changed') emit(...e.kinds)
    })
    void rawApi.activities().then((list) => list.filter((a) => a.state === 'running').forEach(onActivity))
    return () => {
      offActivity()
      offEvents()
    }
  }, [])

  // Film Only: traffic lights hide; the top 8px reveals the toolbar (01 §1.5).
  const [reveal, setReveal] = useState(false)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-film-only', s.filmOnly)
    window.shell.setTrafficLightsVisible(!s.filmOnly || reveal)
  }, [s.filmOnly, reveal])

  // Tape room takeover: the narrow-window overlay closes after a navigation.
  const h = useHistory()
  useEffect(() => {
    if (ui().overlayOpen) setUi({ overlayOpen: false })
  }, [h.index])

  const startNewCutup = async () => {
    const c = await api.createCutup({ kind: 'manual' }).catch((e) => (errorBanner('Couldn’t create the cut-up', e), null))
    if (!c) return
    navigate(links.cutup(c.id))
    setRenaming(c.id)
  }
  useShellCommands(cutupsList, () => void startNewCutup())

  const welcomeOpen = s.welcome || (settings !== null && !settings.welcomeSeen)
  const closeWelcome = () => {
    setUi({ welcome: false })
    if (settings && !settings.welcomeSeen) void saveSettings({ welcomeSeen: true })
  }

  const shown = sidebarShown(s)
  const sidebarMode = !shown ? 'hidden' : s.narrow && !s.tapeRoomSidebar ? 'overlay' : 'shown'
  const inspectorMode = !s.hasInspector ? 'none' : s.inspectorVisible && !s.filmOnly ? 'shown' : 'hidden'

  return (
    <div
      className="shell"
      data-screen={s.screen}
      data-sidebar={sidebarMode}
      data-inspector={inspectorMode}
      data-takeover={s.tapeRoomSidebar ? true : undefined}
      data-film-only={s.filmOnly || undefined}
      data-reveal={reveal || undefined}
      data-narrow={s.narrow || undefined}
      style={{ '--sidebar-w': `${s.sidebarWidth}px`, '--inspector-w': `${s.inspectorWidth}px` } as React.CSSProperties}
    >
      <Sidebar cutups={cutupsList} badges={badges} onNewCutup={() => void startNewCutup()} renaming={renaming} setRenaming={setRenaming} />
      {sidebarMode === 'overlay' && <div className="shell-sidebar-scrim" onMouseDown={() => setUi({ overlayOpen: false })} />}
      <div className="shell-main">
        <ShellToolbar />
        <div className="shell-body">
          <main className="shell-content" id="content">
            {children}
          </main>
          <ShellInspector />
        </div>
      </div>
      <div className="shell-titlebar-controls">
        <Button
          variant="toolbar"
          size="toolbar"
          iconOnly
          icon="panel-left"
          label={shown ? 'Hide Sidebar' : 'Show Sidebar'}
          title={commandTooltip('view.sidebar', shown ? 'Hide Sidebar' : 'Show Sidebar')}
          onClick={toggleSidebar}
        />
      </div>
      {s.filmOnly && (
        <div
          className="shell-reveal-strip"
          onMouseEnter={() => {
            if (revealTimer.current) clearTimeout(revealTimer.current)
            revealTimer.current = setTimeout(() => setReveal(true), 300)
          }}
          onMouseLeave={() => {
            if (revealTimer.current) clearTimeout(revealTimer.current)
            revealTimer.current = setTimeout(() => setReveal(false), 1000)
          }}
        />
      )}
      <div id="layer-popover" />
      <div id="layer-banner">
        <BannerHost />
      </div>
      <div id="layer-sheet">
        {importReq && (
          <ImportFilm
            key={importReq.game?.gameId ?? 'choose'}
            game={importReq.game ?? null}
            team={importReq.team ?? null}
            initialPaths={importReq.paths}
            existing={importReq.existing}
            focusPlayId={importReq.focusPlayId}
            onlySuspects={importReq.onlySuspects}
            onClose={closeImport}
            onImported={(info) => {
              const req = importReq
              closeImport()
              // Without a caller of its own, a new import opens the film it just saved.
              if (req.onImported) req.onImported()
              else if (!info.fix) navigate(links.tape(info.game.gameId, info.team))
            }}
          />
        )}
        <AnalysisHost />
        {s.shortcuts.open && <KeyboardShortcuts filter={s.shortcuts.filter} onClose={() => setUi({ shortcuts: { open: false } })} />}
      </div>
      <div id="layer-overlay">
        {s.quickOpen && <QuickOpen onClose={() => setUi({ quickOpen: false })} />}
        {welcomeOpen && <Welcome onContinue={closeWelcome} />}
        <DropOverlay
          onDrop={(paths) => {
            const intoSheet = sheetDropHandler()
            if (intoSheet) return intoSheet(paths)
            const ctx = importContext()
            openImport({ game: ctx?.game, team: ctx?.team, paths })
          }}
        />
      </div>
      <MenuHost />
    </div>
  )
}

export { seasonNow }
