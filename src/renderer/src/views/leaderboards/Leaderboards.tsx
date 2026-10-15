import { type CSSProperties, useCallback, useMemo, useRef, useState } from 'react'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { FilmLibraryItem, LeaderRow, PositionGroup, TagDef } from '@shared/types'
import { api } from '../../api'
import { formatEpa, formatPct } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { Button } from '../../ui/Button'
import { Sparkline } from '../../ui/charts/Sparkline'
import { EmptyState } from '../../ui/EmptyState'
import { GradeBadge, TallyBar } from '../../ui/Grade'
import { heatFor } from '../../ui/heat'
import { Icon } from '../../ui/Icon'
import { Popover } from '../../ui/Popover'
import { PopupButton } from '../../ui/PopupButton'
import { Segmented } from '../../ui/Segmented'
import { Stepper } from '../../ui/Stepper'
import { type Column, Table } from '../../ui/Table'
import { TeamChip, TeamLogo } from '../../ui/TeamChip'
import { banner, errorBanner } from '../../shell/Banners'
import { useCommand, useDynamicMenus } from '../../shell/commands'
import { playerMenu, showMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { Inspector, InspectorSection } from '../../shell/Inspector'
import { links, navigate } from '../../shell/router'
import { LargeTitle, Loading, LoadError, Screen, useScrollRestore } from '../../shell/Screen'
import { useMyTeams } from '../../shell/store'
import { persist } from '../../shell/uiState'
import { Toolbar } from '../../shell/Toolbar'
import { LargeTallyBar, useLoaded, useLocalState, useMeasure } from '../shared'
import { SeasonGate, useSeasonReady } from '../shared/SeasonGate'
import { tagPolarity } from '../player/model'
import {
  csvName,
  dropped,
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  filtersOn,
  filterSummary,
  GROUP_NAMES,
  groupNoun,
  GROUPS,
  type LeaderFilters,
  type LeaderSort,
  type LeaderSortColumn,
  type LeaderView,
  leaderCsv,
  rankRows,
  searchRows,
  sortRows
} from './leaderModel'
import './leaderboards.css'

/** Leaderboards (03 §7): your grades ranked across every team you have graded, by position group. */
export function Leaderboards({ season, pos }: { season: number; pos: string }) {
  const ready = useSeasonReady(season)
  const group = (GROUPS.includes(pos as PositionGroup) ? pos : 'QB') as PositionGroup
  const myTeams = useMyTeams()
  const [stored, setFilters] = useLocalState<LeaderFilters>('ui.leaders.filters', DEFAULT_FILTERS)
  const filters: LeaderFilters = { ...DEFAULT_FILTERS, ...stored }
  const [sort, setSort] = useLocalState<LeaderSort>(`ui.leaders.sort.${group}`, DEFAULT_SORT)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const filterButton = useRef<HTMLButtonElement>(null)
  const closeFilters = useCallback(() => setFilterOpen(false), [])

  const data = useLoaded(() => (ready ? api.leaderboard(season, group) : Promise.resolve([])), [season, group, ready])
  const lists = useLoaded(async () => {
    const [tags, library] = await Promise.all([api.tags().catch(() => [] as TagDef[]), api.filmLibrary().catch(() => [] as FilmLibraryItem[])])
    return { tags, library }
  }, [])
  useDataEvent('grades', data.reload)
  useDataEvent(['film', 'settings'], lists.reload)

  const ranked = useMemo(() => rankRows(data.data ?? [], filters, myTeams), [data.data, filters, myTeams])
  const rows = useMemo(() => sortRows(searchRows(ranked, q), sort), [ranked, q, sort])
  const sel = rows.find((r) => r.id === selected) ?? null

  const setGroup = useCallback(
    (g: PositionGroup) => {
      persist('ui.leaders.pos', g)
      setSelected(null)
      navigate(links.leaders(season, g), { replace: true })
    },
    [season]
  )
  const clearFilters = () => setFilters(DEFAULT_FILTERS)
  const exportCsv = async () => {
    const name = csvName(group, season)
    try {
      const path = await api.saveCsv(name, leaderCsv(rows))
      if (path) banner({ title: `Exported ${path.split(/[\\/]/).pop()}`, action: { label: 'Show in Finder', run: () => window.shell.showItemInFolder(path) } })
    } catch (e) {
      errorBanner(`Couldn’t export ${name}`, e, () => void exportCsv())
    }
  }

  useCommand('view.section', (arg) => setGroup(GROUPS[Number(arg ?? 1) - 1] ?? 'QB'), { enabled: ready })
  useDynamicMenus({ sections: GROUPS.map((g, i) => ({ index: i + 1, label: GROUP_NAMES[g], checked: g === group })) })
  useCommand('view.filters', () => setFilterOpen((o) => !o), { enabled: ready, checked: filterOpen, label: filterOpen ? 'Hide Filters' : 'Show Filters' })
  useCommand('file.exportCsv', () => void exportCsv(), { enabled: ready && rows.length > 0, label: 'Export Leaderboard as CSV…' })

  const teamOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of data.data ?? []) for (const t of r.teams.length ? r.teams : [r.player.team]) set.add(t)
    if (filters.teams !== 'all' && filters.teams !== 'mine') set.add(filters.teams)
    return [...set].sort((a, b) => (TEAM_BY_ABBR[a]?.nickname ?? a).localeCompare(TEAM_BY_ABBR[b]?.nickname ?? b))
  }, [data.data, filters.teams])

  const pressed = filterOpen || filtersOn(filters)
  const count = ranked.length
  const inspector = (
    <LeaderInspector
      view={sel}
      total={count}
      season={season}
      tags={lists.data?.tags ?? []}
      library={lists.data?.library ?? []}
    />
  )

  return (
    <Screen name="leaderboards" inspector={inspector} inspectorWidth={320}>
      <Toolbar
        title="Leaderboards"
        subtitle={`${season} · ${GROUP_NAMES[group]}${data.data ? ` · ${count} graded` : ''}`}
        windowTitle={`Leaderboards — ${season}`}
        collapsesLargeTitle
        center={
          ready && (
            <Segmented
              size="toolbar"
              value={group}
              label="Position"
              onChange={setGroup}
              options={GROUPS.map((g) => ({ value: g, label: g, title: GROUP_NAMES[g], test: `leaders-pos-${g}` }))}
            />
          )
        }
        trailing={
          ready
            ? [
                {
                  kind: 'custom',
                  width: 32,
                  node: (
                    <Button
                      ref={filterButton}
                      variant="toolbar"
                      size="toolbar"
                      iconOnly
                      icon="funnel"
                      label="Filters"
                      title="Filters (⌥⌘F)"
                      pressed={pressed}
                      ariaHaspopup="dialog"
                      ariaExpanded={filterOpen}
                      onClick={() => setFilterOpen((o) => !o)}
                      test="leaders-filter"
                    />
                  )
                },
                {
                  kind: 'pulldown',
                  icon: 'share',
                  label: 'Export',
                  test: 'toolbar-export',
                  items: [{ label: 'Export as CSV…', shortcut: '⇧⌘E', disabled: !rows.length, run: () => void exportCsv(), test: 'leaders-export-csv' }]
                }
              ]
            : undefined
        }
        search={ready ? { placeholder: 'Search players', value: q, onChange: setQ, test: 'leaders-search' } : undefined}
        busy={data.busy}
      />
      <Popover anchor={filterButton} open={filterOpen} onClose={closeFilters} width={300} test="leaders-filter-popover">
        <FilterForm filters={filters} onChange={setFilters} teams={teamOptions} />
      </Popover>
      <SeasonGate season={season}>
        <LeaderContent
          season={season}
          group={group}
          data={data}
          ranked={ranked}
          rows={rows}
          q={q}
          filters={filters}
          clearFilters={clearFilters}
          sort={sort}
          setSort={setSort}
          selected={sel?.id ?? null}
          setSelected={setSelected}
        />
      </SeasonGate>
    </Screen>
  )
}

function FilterForm({ filters, onChange, teams }: { filters: LeaderFilters; onChange: (f: LeaderFilters) => void; teams: string[] }) {
  const teamLabel = filters.teams === 'all' ? 'All Teams' : filters.teams === 'mine' ? 'My Teams' : (TEAM_BY_ABBR[filters.teams]?.nickname ?? filters.teams)
  return (
    <div className="screen-leaderboards leaders-filters">
      <div className="leaders-filters__row">
        <span className="leaders-filters__label">Minimum graded snaps</span>
        <Stepper value={filters.minSnaps} min={0} max={300} onChange={(v) => onChange({ ...filters, minSnaps: v })} ariaLabel="Minimum graded snaps" />
      </div>
      <div className="leaders-filters__row">
        <span className="leaders-filters__label">Teams</span>
        <PopupButton<string>
          value={filters.teams}
          width={140}
          label={teamLabel}
          onChange={(v) => onChange({ ...filters, teams: v })}
          options={[
            { value: 'all', label: 'All Teams' },
            { value: 'mine', label: 'My Teams' },
            ...teams.map((t) => ({ value: t, label: TEAM_BY_ABBR[t]?.nickname ?? t }))
          ]}
          test="leaders-filter-teams"
        />
      </div>
      <div className="leaders-filters__row">
        <span className="leaders-filters__label">Games</span>
        <PopupButton<string>
          value={String(filters.lastGames)}
          width={140}
          label={filters.lastGames ? `Last ${filters.lastGames} Games` : 'All Games'}
          onChange={(v) => onChange({ ...filters, lastGames: Number(v) as LeaderFilters['lastGames'] })}
          options={[
            { value: '0', label: 'All Games' },
            { value: '4', label: 'Last 4 Games' },
            { value: '8', label: 'Last 8 Games' }
          ]}
          test="leaders-filter-games"
        />
      </div>
      <div className="leaders-filters__footer">
        <Button variant="borderless" size="sm" label="Reset Filters" disabled={!filtersOn(filters)} onClick={() => onChange(DEFAULT_FILTERS)} test="leaders-filter-reset" />
      </div>
    </div>
  )
}

function LeaderContent({
  season,
  group,
  data,
  ranked,
  rows,
  q,
  filters,
  clearFilters,
  sort,
  setSort,
  selected,
  setSelected
}: {
  season: number
  group: PositionGroup
  data: ReturnType<typeof useLoaded<LeaderRow[]>>
  ranked: LeaderView[]
  rows: LeaderView[]
  q: string
  filters: LeaderFilters
  clearFilters: () => void
  sort: LeaderSort
  setSort: (s: LeaderSort) => void
  selected: string | null
  setSelected: (id: string | null) => void
}) {
  const [measure, width] = useMeasure<HTMLDivElement>()
  useScrollRestore(data.data !== null)
  // "No grades yet" for the whole season vs "No quarterbacks graded yet" for this group.
  const empty = data.data !== null && data.data.length === 0
  const anyGrades = useLoaded(
    async () => {
      if (!empty) return true
      const lists = await Promise.all(GROUPS.filter((g) => g !== group).map((g) => api.leaderboard(season, g).catch(() => [])))
      return lists.some((l) => l.length > 0)
    },
    [season, group, empty]
  )
  if (data.error && !data.data) return <LoadError what="the leaderboard" error={data.error} retry={data.reload} />
  if (!data.data || (empty && anyGrades.data === null)) return <Loading />

  const header = (
    <>
      <LargeTitle>Leaderboards</LargeTitle>
      <p className="leaders__intro">Your grades, ranked across every team you’ve graded.</p>
      {filtersOn(filters) && (
        <div className="leaders__summary" data-test="leaders-filter-summary">
          <span>{filterSummary(filters)}</span>
          <Button variant="borderless" size="sm" label="Clear" onClick={clearFilters} test="leaders-filter-clear" />
        </div>
      )}
    </>
  )

  if (empty) {
    return (
      <>
        {header}
        {anyGrades.data ? (
          <EmptyState
            icon="trophy"
            title={`No ${groupNoun(group)} graded yet`}
            body={`Grade ${groupNoun(group)} in the tape room and they’ll be ranked here.`}
            primary={{ label: 'Open Film', run: () => navigate(links.film()) }}
            test="leaders-empty"
          />
        ) : (
          <EmptyState icon="trophy" title="No grades yet" body="Grade players in the tape room and they’ll be ranked here." primary={{ label: 'Open Film', run: () => navigate(links.film()) }} test="leaders-empty" />
        )}
      </>
    )
  }
  if (!ranked.length) {
    return (
      <>
        {header}
        <EmptyState icon="funnel" title="No players match these filters" primary={{ label: 'Clear Filters', run: clearFilters }} test="leaders-no-match" />
      </>
    )
  }

  const hide = dropped(width)
  const heat = heatFor('screen')
  const columns: Column<LeaderView>[] = [
    {
      id: 'rank',
      label: 'Rank',
      width: 48,
      align: 'right',
      render: (v) => <span className={`leaders__rank num${v.tied ? ' leaders__rank--tied' : ''}`}>{v.rank}</span>
    },
    {
      id: 'player',
      label: 'Player',
      flex: 1,
      minWidth: 220,
      sortable: true,
      render: (v) => (
        <span className="leaders__player">
          <Avatar url={v.row.player.headshot} name={v.name} size={24} team={v.teams[v.teams.length - 1]} />
          <a
            className="leaders__name"
            onClick={(e) => {
              e.stopPropagation()
              navigate(links.player(season, v.id))
            }}
          >
            {v.name}
          </a>
          {v.row.player.jersey && <span className="leaders__jersey">#{v.row.player.jersey}</span>}
        </span>
      )
    },
    {
      id: 'team',
      label: 'Team',
      width: 64,
      sortable: true,
      render: (v) => (
        <span className="leaders__team" title={v.teams.length > 1 ? v.teams.join(', ') : undefined}>
          <TeamChip abbr={v.teams[v.teams.length - 1]} />
          {v.teams.length > 1 && <span className="leaders__more">+{v.teams.length - 1}</span>}
        </span>
      )
    },
    { id: 'pos', label: 'Pos', width: 48, sortable: true, render: (v) => <span className="leaders__pos">{v.position}</span> },
    { id: 'games', label: 'Games', width: 56, numeric: true, sortable: true, render: (v) => v.games },
    { id: 'snaps', label: 'Snaps', width: 64, numeric: true, sortable: true, render: (v) => v.snaps || <span className="missing">—</span> },
    { id: 'graded', label: 'Graded', width: 64, numeric: true, sortable: true, render: (v) => v.graded },
    { id: 'tally', label: '+ / 0 / −', width: 88, render: (v) => <TallyBar tally={v.tally} width={72} /> },
    { id: 'plusRate', label: '+%', width: 56, numeric: true, sortable: true, render: (v) => (v.plusRate === null ? <span className="missing">—</span> : formatPct(v.plusRate)) },
    {
      id: 'crit',
      label: 'Crit',
      width: 48,
      numeric: true,
      sortable: true,
      render: (v) =>
        v.crit ? (
          <span className="leaders__crit">
            <Icon name="zap" size={10} />
            {v.crit}
          </span>
        ) : (
          <span className="missing">—</span>
        )
    },
    {
      id: 'epa',
      label: 'EPA / play',
      width: 72,
      numeric: true,
      sortable: true,
      render: (v) => (v.epa === null ? <span className="missing">—</span> : <span style={{ color: heat.ink(v.epa >= 0 ? 75 : 25) } as CSSProperties}>{formatEpa(v.epa)}</span>)
    },
    { id: 'grade', label: 'Grade', width: 56, align: 'right', sortable: true, render: (v) => <GradeBadge score={v.grade} /> },
    { id: 'trend', label: 'Trend', width: 76, render: (v) => (v.trend.length > 1 ? <Sparkline values={v.trend} /> : <span className="missing">—</span>) }
  ]
  const shown = columns.filter((c) => !hide.has(c.id))

  const podium = q.trim() ? [] : ranked.slice(0, 3)
  return (
    <>
      {header}
      {podium.length > 0 && <TopShelf views={podium} season={season} total={ranked.length} />}
      <div ref={measure} className="leaders__table">
        {!rows.length ? (
          <EmptyState icon="search" title={`No Results for “${q.trim()}”`} body="Check the spelling, or try a team’s name or abbreviation." />
        ) : (
          <Table
            columns={shown}
            rows={rows}
            rowKey={(v) => v.id}
            sort={sort}
            onSort={(s) => setSort({ column: s.column as LeaderSortColumn, dir: s.column === 'grade' && s.column !== sort.column ? 'desc' : s.dir })}
            selection={selected}
            onSelect={(k) => setSelected(k)}
            onOpen={(v) => navigate(links.player(season, v.id))}
            onContextMenu={(v, e) => void showMenu(e, playerMenu(season, v.row.player))}
            rowTest="leader-row"
            test="leaders-table"
            typeSelect={(v) => v.name}
          />
        )}
      </div>
    </>
  )
}

/** The top three as quiet cards above the table: headshot, name, team logo and the grade as one light number. */
function TopShelf({ views, season, total }: { views: LeaderView[]; season: number; total: number }) {
  return (
    <div className="leaders-top" data-test="leaders-top">
      {views.map((v) => {
        const team = v.teams[v.teams.length - 1]
        return (
          <button
            key={v.id}
            type="button"
            className="leaders-top__card"
            onClick={() => navigate(links.player(season, v.id))}
            onContextMenu={(e) => void showMenu(e, playerMenu(season, v.row.player))}
            title={`Open ${v.name}`}
          >
            <span className="leaders-top__rank">{v.tied ? `T-${v.rank}` : v.rank} of {total}</span>
            <span className="leaders-top__who">
              <Avatar url={v.row.player.headshot} name={v.name} size={44} team={team} />
              <span className="leaders-top__names">
                <span className="leaders-top__name">{v.name}</span>
                <span className="leaders-top__line">
                  <TeamLogo abbr={team} size={16} />
                  {[v.position, TEAM_BY_ABBR[team]?.nickname ?? team].join(' · ')}
                </span>
              </span>
            </span>
            <span className="leaders-top__grade">
              <span className="leaders-top__score num">{v.grade === null ? '—' : Math.round(v.grade)}</span>
              <span className="leaders-top__sub num">
                {v.graded} graded · {v.games} {v.games === 1 ? 'game' : 'games'}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function LeaderInspector({ view, total, season, tags, library }: { view: LeaderView | null; total: number; season: number; tags: TagDef[]; library: FilmLibraryItem[] }) {
  if (!view) return <Inspector title="Player" />
  const p = view.row.player
  const team = view.teams[view.teams.length - 1]
  const t = view.tally
  const weeks = view.row.byGame.map((g) => g.week)
  const polarity = tagPolarity(tags, p.group)
  const heat = heatFor('screen')
  const filmGame = library
    .filter((f) => f.game.season === season && (f.game.homeTeam === team || f.game.awayTeam === team))
    .sort((a, b) => b.game.gameday.localeCompare(a.game.gameday) || b.game.week - a.game.week)[0]
  const line = [p.jersey ? `#${p.jersey}` : '', view.position, TEAM_BY_ABBR[team]?.nickname ?? team].filter(Boolean).join(' · ')
  return (
    <Inspector title="Player">
      <div className="leaders-inspector" data-test="leaders-inspector">
        <div className="leaders-inspector__identity" onContextMenu={(e) => void showMenu(e, playerMenu(season, p))}>
          <Avatar url={p.headshot} name={p.name} size={48} team={team} />
          <div className="leaders-inspector__names">
            <a className="leaders-inspector__name" onClick={() => navigate(links.player(season, p.id))}>
              {p.name}
            </a>
            <div className="leaders-inspector__line">{line}</div>
          </div>
        </div>
        <InspectorSection id="grade" title="Grade">
          <div className="leaders-inspector__grade">
            <span className="leaders-inspector__score num">{view.grade === null ? '—' : Math.round(view.grade)}</span>
            <div>
              <div className="leaders-inspector__rank">
                Rank {view.rank} of {total}
              </div>
              <div className="leaders-inspector__sub">
                {t.graded} graded {t.graded === 1 ? 'snap' : 'snaps'} · {view.games} {view.games === 1 ? 'game' : 'games'}
              </div>
            </div>
          </div>
          <div className="leaders-inspector__tally">
            <LargeTallyBar tally={t} />
          </div>
          <div className="leaders-inspector__counts">
            {t.plus} plus · {t.zero} zero · {t.minus} minus · {t.critical} critical
          </div>
        </InspectorSection>
        {view.trend.length > 0 && (
          <InspectorSection id="byGame" title="By game">
            {view.trend.length > 1 ? (
              <>
                <Sparkline values={view.trend} width={120} height={32} />
                <div className="leaders-inspector__weeks">
                  <span>Wk {weeks[0]}</span>
                  <span>Wk {weeks[weeks.length - 1]}</span>
                </div>
              </>
            ) : (
              <div className="leaders-inspector__counts">Graded in Week {weeks[0]} only. A trend appears after a second game.</div>
            )}
          </InspectorSection>
        )}
        {view.row.topTags.length > 0 && (
          <InspectorSection id="tags" title="Top tags">
            <div className="leaders-inspector__tags">
              {view.row.topTags.map((tag) => {
                const kind = polarity.get(tag.tag) ?? 'neutral'
                const style =
                  kind === 'pos'
                    ? ({ '--chip-bg': heat.tint(100), '--chip-fg': heat.ink(100) } as CSSProperties)
                    : kind === 'neg'
                      ? ({ '--chip-bg': heat.tint(0), '--chip-fg': heat.ink(0) } as CSSProperties)
                      : undefined
                return (
                  <button
                    key={tag.tag}
                    type="button"
                    className="leaders-tag"
                    style={style}
                    title={`Watch the ${tag.count} ${tag.tag} plays`}
                    onClick={() => navigate(links.player(season, p.id, { section: 'film', tokens: JSON.stringify([{ key: 'tag', values: [tag.tag] }]) }))}
                  >
                    <span>{tag.tag}</span>
                    <span className="leaders-tag__count">{tag.count}</span>
                  </button>
                )
              })}
            </div>
          </InspectorSection>
        )}
        <div className="leaders-inspector__actions">
          <Button label="Open Player" onClick={() => navigate(links.player(season, p.id))} style={{ width: '100%' }} test="leaders-open-player" />
          <Button variant="borderless" label="Watch Film" onClick={() => navigate(links.player(season, p.id, { section: 'film' }))} />
          <Button
            variant="borderless"
            label="Grade in Player Focus"
            disabled={!filmGame}
            title={filmGame ? undefined : `No film for the ${TEAM_BY_ABBR[team]?.nickname ?? team} yet`}
            onClick={() => filmGame && navigate(links.tape(filmGame.game.gameId, team, { player: p.id, focus: true }))}
          />
        </div>
      </div>
    </Inspector>
  )
}
