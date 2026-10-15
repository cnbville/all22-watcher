import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FilterToken } from '@shared/playQuery'
import { gradeScore, netScore, plusRate } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { ChartField, FilmLibraryItem, PlayerProfile, TagDef, TeamSummary } from '@shared/types'
import { api } from '../../api'
import { experienceLabel, formatPct, formatSigned, heightLabel } from '../../format'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Segmented } from '../../ui/Segmented'
import type { SearchToken } from '../../ui/SearchField'
import { TeamLogo } from '../../ui/TeamChip'
import { useCommand, useDynamicMenus } from '../../shell/commands'
import { exportReport, playerMenu, showMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { links, navigate, useHistory, useRoute } from '../../shell/router'
import { CollapsingTitle, Loading, LoadError, Screen, useScrollRestore } from '../../shell/Screen'
import { useSeasons } from '../../shell/store'
import { Toolbar } from '../../shell/Toolbar'
import { Poster, readLocal, type ReelEntry, requestExportVideo, useExportVideoAvailable, useLoaded, useRouteState } from '../shared'
import { SeasonGate } from '../shared/SeasonGate'
import { Career } from './Career'
import { FilmSection, filmReelState } from './FilmSection'
import { fromFilter, parseTokensParam, suggest, type TokenEnv, tokenPool, toFilter } from './filmTokens'
import { GameLogSection } from './GameLog'
import { heroPoster, type PlayerSection, PLAYER_SECTIONS, positionName, reelEntries, type ReelSort, teamsLine, trendNote } from './model'
import { Overview } from './Overview'
import { Splits } from './Splits'
import './player.css'

/** Everything the sections share. */
export interface PlayerCtx {
  p: PlayerProfile
  season: number
  playerId: string
  entries: ReelEntry[]
  tags: TagDef[]
  chartFields: ChartField[]
  summaries: TeamSummary[]
  /** Chart values by "gameId:playId". */
  charts: Map<string, Record<string, string>>
  /** Latest game with film for his team (Grade on Film), or null. */
  filmGame: { gameId: string; team: string } | null
  /** Shows Film filtered by these tokens. */
  openFilm: (tokens: FilterToken[], text?: string) => void
  gradeOnFilm: () => void
  setSection: (s: PlayerSection) => void
}

const firstName = (name: string) => name.split(/\s+/)[0] ?? name

export function PlayerPage({ season, playerId }: { season: number; playerId: string }) {
  const route = useRoute()
  const routeKey = links.player(season, playerId)
  const [storedSection, setSection] = useRouteState<PlayerSection>(routeKey, 'section', 'overview')
  const [querySection, setQuerySection] = useState<PlayerSection | null>(() => {
    const q = route.query.get('section') as PlayerSection | null
    return q && PLAYER_SECTIONS.some((s) => s.value === q) ? q : null
  })
  const section = querySection ?? storedSection
  const changeSection = (s: PlayerSection) => {
    setQuerySection(null)
    setSection(s)
  }
  const [tokens, setTokens] = useRouteState<SearchToken[]>(routeKey, 'tokens', [])
  const [text, setText] = useRouteState<string>(routeKey, 'text', '')
  const [sort, setSort] = useRouteState<ReelSort>(routeKey, 'sort', 'game')

  const profile = useLoaded(() => api.playerProfile(season, playerId), [season, playerId])
  const lists = useLoaded(async () => {
    const [tags, chartFields] = await Promise.all([api.tags().catch(() => [] as TagDef[]), api.chartFields().catch(() => [] as ChartField[])])
    return { tags, chartFields }
  }, [])
  const summaries = useLoaded(() => api.teamSummaries(season).catch(() => [] as TeamSummary[]), [season])
  const library = useLoaded(() => api.filmLibrary().catch(() => [] as FilmLibraryItem[]), [])
  useDataEvent(['grades', 'notes', 'film', 'season'], profile.reload)
  useDataEvent('film', library.reload)
  useDataEvent('settings', lists.reload)

  const p = profile.data
  const player = p?.player
  const team = player ? TEAM_BY_ABBR[player.team] : undefined
  const entries = useMemo(() => (p ? reelEntries(p) : []), [p])
  const charts = useMemo(() => new Map((p?.reel ?? []).map((r) => [`${r.gameId}:${r.playId}`, r.chart ?? {}])), [p])
  const chartFields = lists.data?.chartFields ?? []
  const env: TokenEnv = useMemo(
    () => ({ games: new Map(entries.map((e) => [e.ref.gameId, e.game])), teams: new Map(entries.map((e) => [e.ref.gameId, e.team])), chartFields }),
    [entries, chartFields]
  )
  const pool = useMemo(() => (p ? tokenPool(entries, playerId, env, charts) : []), [p, entries, playerId, env, charts])

  // ?tokens= from a link (a split's "Watch These Plays", a smart cut-up) replaces the remembered tokens once.
  const [appliedParam, setAppliedParam] = useState(false)
  useEffect(() => {
    if (appliedParam || !p) return
    const parsed = parseTokensParam(route.query.get('tokens') ?? undefined)
    if (parsed) {
      setTokens(fromFilter(parsed, env))
      setText('')
    }
    setAppliedParam(true)
  }, [appliedParam, p, route.query, env, setTokens, setText])

  const filmGame = useMemo(() => {
    if (!player || !library.data) return null
    const mine = library.data.filter((f) => f.game.season === season && (f.game.homeTeam === player.team || f.game.awayTeam === player.team))
    const latest = mine.sort((a, b) => b.game.gameday.localeCompare(a.game.gameday) || b.game.week - a.game.week)[0]
    return latest ? { gameId: latest.game.gameId, team: player.team } : null
  }, [player, library.data, season])
  const gradeOnFilm = () => {
    if (filmGame) navigate(links.tape(filmGame.gameId, filmGame.team, { player: playerId, focus: true }))
  }
  const exportAvailable = useExportVideoAvailable()
  const [saving, setSaving] = useState(false)
  const saveReport = async () => {
    setSaving(true)
    try {
      await exportReport(season, playerId)
    } finally {
      setSaving(false)
    }
  }
  // Plays: All Graded, Shown in the Reel (filters on), Selected (2+ on Film), 03 §11.3.
  const exportVideo = () => {
    const all = entries.map((e) => e.ref)
    const reel = filmReelState.current
    const choices = [{ key: 'all', label: `All Graded Plays (${all.length})`, plays: all }]
    if (reel?.filtered) choices.push({ key: 'shown', label: `Shown in the Reel (${reel.shown.length})`, plays: reel.shown })
    if (reel && reel.selected.length >= 2) choices.push({ key: 'selected', label: `Selected Plays (${reel.selected.length})`, plays: reel.selected })
    requestExportVideo({ kind: 'player', season, playerId, plays: all }, player ? `${player.name} · ${season} reel` : undefined, {
      choices,
      initial: choices[choices.length - 1].key,
      fileName: player ? `${player.name} reel` : undefined,
      angle: readLocal('ui.reel.angle', 'sideline')
    })
  }

  useCommand('file.exportReport', () => void saveReport(), { enabled: !!p && !saving, label: saving ? 'Saving Report…' : undefined })
  useCommand('file.exportVideo', exportVideo, { enabled: !!p && exportAvailable && entries.some((e) => e.clips.length), label: 'Export Reel Video…' })
  useCommand('view.section', (arg) => changeSection(PLAYER_SECTIONS[Number(arg ?? 1) - 1]?.value ?? 'overview'))
  useDynamicMenus({ sections: PLAYER_SECTIONS.map((s, i) => ({ index: i + 1, label: s.label, checked: s.value === section })) })

  const subtitle = player ? [player.jersey ? `#${player.jersey}` : '', player.depthPos || player.position, team?.name ?? player.team, String(season)].filter(Boolean).join(' · ') : String(season)
  const ctx: PlayerCtx | null = p
    ? {
        p,
        season,
        playerId,
        entries,
        tags: lists.data?.tags ?? [],
        chartFields,
        summaries: summaries.data ?? [],
        charts,
        filmGame,
        openFilm: (filter, t = '') => {
          setTokens(fromFilter(filter, env))
          setText(t)
          changeSection('film')
          document.getElementById('content')?.scrollTo({ top: 0 })
        },
        gradeOnFilm,
        setSection: changeSection
      }
    : null

  return (
    <Screen name="player">
      <Toolbar
        title={player?.name ?? 'Player'}
        subtitle={subtitle}
        windowTitle={player ? `${player.name} — ${season}` : 'Player'}
        collapsesLargeTitle
        busy={profile.busy}
        center={
          p && (
            <Segmented
              size="toolbar"
              value={section}
              onChange={changeSection}
              label="Section"
              options={PLAYER_SECTIONS.map((s) => ({ ...s, test: `player-section-${s.value}` }))}
            />
          )
        }
        trailing={[
          {
            kind: 'custom',
            width: 32,
            node: (
              <GradeOnFilmButton disabled={!filmGame} title={filmGame ? 'Grade on Film' : `No film for the ${team?.nickname ?? player?.team ?? 'team'} yet`} onClick={gradeOnFilm} />
            )
          },
          {
            kind: 'pulldown',
            icon: 'share',
            label: 'Export',
            test: 'toolbar-export',
            items: [
              { label: 'Export Reel Video…', shortcut: '⌘E', disabled: !exportAvailable || !entries.some((e) => e.clips.length), run: exportVideo, test: 'export-video' },
              { label: saving ? 'Saving Report…' : 'Export Scouting Report (PDF)…', shortcut: '⌥⌘E', disabled: saving || !p, run: () => void saveReport(), test: 'export-report' }
            ]
          }
        ]}
        search={
          section === 'film' && p
            ? {
                placeholder: 'Search plays',
                value: text,
                onChange: setText,
                tokens,
                onTokensChange: setTokens,
                suggest: (t) => suggest(t, pool, tokens, env),
                test: 'film-search'
              }
            : undefined
        }
      />
      <SeasonGate season={season}>
        {profile.error && !p ? (
          <LoadError what="this player" error={profile.error} retry={profile.reload} />
        ) : !p || !player ? (
          profile.loading ? <Loading /> : <NotInSeason season={season} playerId={playerId} />
        ) : (
          <PlayerBody
            ctx={ctx!}
            section={section}
            film={{ tokens, setTokens, text, setText, sort, setSort, env }}
          />
        )}
      </SeasonGate>
    </Screen>
  )
}

function GradeOnFilmButton({ disabled, title, onClick }: { disabled: boolean; title: string; onClick: () => void }) {
  return <Button variant="toolbar" size="toolbar" iconOnly icon="scan-eye" label="Grade on Film" title={title} disabled={disabled} onClick={onClick} test="grade-on-film" />
}

function NotInSeason({ season, playerId }: { season: number; playerId: string }) {
  const h = useHistory()
  const seasons = useSeasons()
  const [found, setFound] = useState<number | null>(null)
  const fromHistory = useMemo(() => {
    for (let i = h.index - 1; i >= 0; i--) {
      const m = /^\/player\/(\d{4})\/([^?]+)/.exec(h.entries[i]?.route ?? '')
      if (m && decodeURIComponent(m[2]) === playerId && Number(m[1]) !== season) return Number(m[1])
    }
    return null
  }, [h, playerId, season])
  useEffect(() => {
    if (fromHistory || !seasons) return
    let live = true
    const list = seasons.filter((s) => s.downloaded && s.season !== season).map((s) => s.season).sort((a, b) => b - a)
    void (async () => {
      for (const s of list) {
        const line = await api.playerSeasonLine(s, playerId).catch(() => null)
        if (!live) return
        if (line) return setFound(s)
      }
    })()
    return () => {
      live = false
    }
  }, [fromHistory, seasons, season, playerId])
  const target = fromHistory ?? found
  return (
    <EmptyState
      icon="user-round"
      title={`Not in the ${season} data`}
      body={`This player has no roster entry, snaps or stats in the ${season} season.`}
      primary={target ? { label: `Show ${target}`, run: () => navigate(links.player(target, playerId)) } : undefined}
    />
  )
}

export interface FilmState {
  tokens: SearchToken[]
  setTokens: (t: SearchToken[]) => void
  text: string
  setText: (t: string) => void
  sort: ReelSort
  setSort: (s: ReelSort) => void
  env: TokenEnv
}

function PlayerBody({ ctx, section, film }: { ctx: PlayerCtx; section: PlayerSection; film: FilmState }) {
  useScrollRestore(true)
  return (
    <>
      <PlayerHeader ctx={ctx} />
      <div className="player-body">
        {section === 'overview' && <Overview ctx={ctx} />}
        {section === 'film' && <FilmSection ctx={ctx} film={film} filter={toFilter(film.tokens)} />}
        {section === 'splits' && <Splits ctx={ctx} />}
        {section === 'log' && <GameLogSection ctx={ctx} />}
        {section === 'career' && <Career ctx={ctx} />}
      </div>
    </>
  )
}

function PlayerHeader({ ctx }: { ctx: PlayerCtx }) {
  const { p, season } = ctx
  const player = p.player
  const team = TEAM_BY_ABBR[player.team]
  const score = gradeScore(p.tally)
  const t = p.tally
  const pos = player.depthPos || player.position
  const bio = [heightLabel(player.height), player.weight ? `${player.weight} lb` : '', player.college, experienceLabel(player.yearsExp), t.graded ? `${t.graded} ${t.graded === 1 ? 'play' : 'plays'} graded` : '']
    .filter(Boolean)
    .join(' · ')
  const moved = teamsLine(p)
  const menu = (e: React.MouseEvent) => void showMenu(e, playerMenu(season, player))
  const poster = useMemo(() => heroPoster(ctx.entries), [ctx.entries])
  const art = useBleed()
  const trend = trendNote(p)
  const tip = t.graded
    ? `${t.plus} plus · ${t.zero} zero · ${t.minus} minus · ${t.critical} critical · net ${formatSigned(netScore(t))} · ${formatPct(plusRate(t))} plus`
    : 'Not graded yet'
  return (
    <CollapsingTitle className="player-hero" test="player-header">
      <div ref={art} className="player-hero__art" data-keyart aria-hidden>
        {poster && <Poster poster={poster} width={1600} className="player-hero__still" />}
      </div>
      <div className="player-hero__content">
        <div className="player-hero__text">
          <div className="player-hero__line">
            <TeamLogo abbr={player.team} size={20} />
            <span>
              {[positionName(pos), player.jersey ? `No. ${player.jersey}` : ''].filter(Boolean).join(' · ')}
              {' · '}
              <a className="player-hero__link" onClick={() => navigate(links.team(season, player.team))}>
                {team?.name ?? player.team}
              </a>
            </span>
          </div>
          <h1 className="player-hero__name" onContextMenu={menu}>
            {player.name}
          </h1>
          {bio && <div className="player-hero__bio num">{bio}</div>}
          {moved && (
            <div className="player-hero__bio">
              {moved.before}
              {moved.link && (
                <a className="player-hero__link" onClick={() => navigate(links.team(season, moved.link!.abbr))}>
                  {moved.link.text}
                </a>
              )}
              {moved.after}
            </div>
          )}
        </div>
        <div className="player-hero__grade" title={tip} data-test="player-grade">
          <span className="player-hero__score num">{score === null ? '—' : Math.round(score)}</span>
          <span className="player-hero__note">{t.graded ? (trend ? `Season grade, ${trend.charAt(0).toLowerCase()}${trend.slice(1)}` : 'Season grade') : 'Not graded yet'}</span>
        </div>
      </div>
    </CollapsingTitle>
  )
}

/** Lets the key art run the full width of the content column, past the page's max width and side padding. */
function useBleed() {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const content = document.getElementById('content')
    if (!el || !content) return
    const set = () => el.style.setProperty('--bleed-w', `${content.clientWidth}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(content)
    return () => ro.disconnect()
  }, [])
  return ref
}

export { firstName }
