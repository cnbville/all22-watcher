import { useMemo, useState } from 'react'
import { DIVISIONS, TEAMS } from '@shared/teams'
import type { Team, TeamFilmStats, TeamRankedStat, TeamSummary } from '@shared/types'
import { api } from '../../api'
import { formatEpa, formatSigned, ordinal, recordLabel } from '../../format'
import { RankBadge } from '../../ui/Badge'
import { EmptyState } from '../../ui/EmptyState'
import { PopupButton } from '../../ui/PopupButton'
import { Segmented } from '../../ui/Segmented'
import { type Column, type SortState, Table } from '../../ui/Table'
import { TeamChip, TeamLogo } from '../../ui/TeamChip'
import { Tile } from '../../ui/Tile'
import { showMenu, teamMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { links, navigate } from '../../shell/router'
import { LargeTitle, Loading, LoadError, Screen, Section, useScrollRestore } from '../../shell/Screen'
import { Toolbar } from '../../shell/Toolbar'
import { useLoaded, useLocalState, useRouteState } from '../shared'
import { SeasonGate, useSeasonReady } from '../shared/SeasonGate'
import './teams.css'

/** Teams (03 §4): all 32 by division, or the standings. */

type View = 'divisions' | 'standings'
type GroupBy = 'division' | 'conference' | 'league'

const city = (t: Team) => t.name.replace(` ${t.nickname}`, '')
const pctOf = (s?: TeamSummary) => (s && s.wins + s.losses + s.ties ? (s.wins + s.ties / 2) / (s.wins + s.losses + s.ties) : 0)
const diffOf = (s?: TeamSummary) => (s ? s.pointsFor - s.pointsAgainst : 0)
const epaStat = (s: TeamSummary | undefined, side: 'offense' | 'defense'): TeamRankedStat | undefined => s?.[side].find((x) => x.key === 'epa')

interface Data {
  summaries: Map<string, TeamSummary>
  film: Record<string, TeamFilmStats>
}

export function Teams({ season }: { season: number }) {
  const [view, setView] = useRouteState<View>(`teams.${season}`, 'view', 'divisions')
  const [q, setQ] = useState('')
  const ready = useSeasonReady(season)
  return (
    <Screen name="teams">
      <Toolbar
        title="Teams"
        subtitle={`${season} season`}
        windowTitle={`Teams — ${season}`}
        collapsesLargeTitle
        center={
          ready && (
            <Segmented
              size="toolbar"
              value={view}
              onChange={setView}
              label="View"
              options={[
                { value: 'divisions', label: 'Divisions', test: 'teams-view-divisions' },
                { value: 'standings', label: 'Standings', test: 'teams-view-standings' }
              ]}
            />
          )
        }
        search={ready ? { placeholder: 'Search teams', value: q, onChange: setQ, test: 'teams-search' } : undefined}
      />
      <SeasonGate season={season}>
        <TeamsContent season={season} view={view} q={q} />
      </SeasonGate>
    </Screen>
  )
}

function TeamsContent({ season, view, q }: { season: number; view: View; q: string }) {
  const data = useLoaded<Data>(
    async () => {
      const [s, film] = await Promise.all([api.teamSummaries(season), api.teamFilmStats(season).catch(() => ({}))])
      return { summaries: new Map(s.map((x) => [x.team, x])), film }
    },
    [season]
  )
  useDataEvent(['season', 'film', 'grades'], data.reload)
  useScrollRestore(data.data !== null)
  const needle = q.trim().toLowerCase()
  const shown = TEAMS.filter((t) => !needle || t.abbr.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle))
  if (data.error && !data.data) return <LoadError what="the teams" error={data.error} retry={data.reload} />
  if (!data.data) return <Loading />
  return (
    <>
      <LargeTitle>Teams</LargeTitle>
      {!shown.length ? (
        <EmptyState icon="search" title={`No Results for “${q.trim()}”`} body="Check the spelling or try a team’s city or abbreviation." />
      ) : view === 'divisions' ? (
        <Divisions season={season} teams={shown} data={data.data} />
      ) : (
        <Standings season={season} teams={shown} data={data.data} />
      )}
    </>
  )
}

function Divisions({ season, teams, data }: { season: number; teams: Team[]; data: Data }) {
  // Arrow keys move across the tiles: ←/→ in reading order, ↑/↓ within a column (into the next conference's column).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    const tiles = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-test="team-tile"]'))
    const cur = tiles.indexOf(document.activeElement as HTMLElement)
    if (cur < 0) return
    const pos = (el: HTMLElement) => {
      const d = (el.querySelector('[data-col]') as HTMLElement | null)?.dataset ?? {}
      return { conf: Number(d.conf), col: Number(d.col), row: Number(d.row) }
    }
    const p = pos(tiles[cur])
    const find = (f: (q: ReturnType<typeof pos>) => boolean) => tiles.find((t) => f(pos(t)))
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = find((x) => x.conf === p.conf && x.col === p.col && x.row === p.row + 1) ?? find((x) => x.conf === p.conf + 1 && x.col === p.col && x.row === 0)
    if (e.key === 'ArrowUp')
      next =
        find((x) => x.conf === p.conf && x.col === p.col && x.row === p.row - 1) ??
        [...tiles].reverse().find((t) => pos(t).conf === p.conf - 1 && pos(t).col === p.col)
    if (e.key === 'ArrowRight') next = find((x) => x.conf === p.conf && x.row === p.row && x.col === p.col + 1) ?? find((x) => x.conf === p.conf && x.row === p.row + 1 && x.col === 0)
    if (e.key === 'ArrowLeft')
      next = find((x) => x.conf === p.conf && x.row === p.row && x.col === p.col - 1) ?? [...tiles].reverse().find((t) => pos(t).conf === p.conf && pos(t).row === p.row - 1)
    if (next) {
      e.preventDefault()
      e.stopPropagation()
      next.focus()
    }
  }
  return (
    <div onKeyDown={onKeyDown}>
      {(['AFC', 'NFC'] as const).map((conf, ci) => {
        const divs = DIVISIONS.filter((d) => d.startsWith(conf))
        if (!divs.some((d) => teams.some((t) => t.division === d))) return null
        return (
          <Section key={conf} title={conf}>
            <div className="teams-divisions">
              {divs.map((div, col) => {
                const list = teams.filter((t) => t.division === div)
                if (!list.length) return null
                return (
                  <div key={div} className="teams-division">
                    <div className="teams-division__title">{div.replace(`${conf} `, '')}</div>
                    {list.map((t, row) => {
                      const s = data.summaries.get(t.abbr)
                      const f = data.film[t.abbr]
                      const frac = f && f.playCount ? f.gradedPlays / f.playCount : null
                      return (
                        <Tile
                          key={t.abbr}
                          test="team-tile"
                          className="team-tile"
                          progress={f?.gamesWithFilm ? frac : undefined}
                          title={f?.gamesWithFilm ? `${f.gamesWithFilm} ${f.gamesWithFilm === 1 ? 'game' : 'games'} with film · ${Math.round((frac ?? 0) * 100)}% graded` : undefined}
                          onOpen={() => navigate(links.team(season, t.abbr))}
                          onContextMenu={(e) => void showMenu(e, teamMenu(season, t.abbr))}
                        >
                          <span data-conf={ci} data-col={col} data-row={row} hidden />
                          <TeamLogo abbr={t.abbr} size={44} />
                          <div className="team-tile__names">
                            <div className="team-tile__nickname ellipsis">{t.nickname}</div>
                            <div className="team-tile__meta ellipsis num">
                              {s ? recordLabel(s.wins, s.losses, s.ties) : '0–0'}
                              <span className="team-tile__diff"> · {formatSigned(diffOf(s))}</span>
                            </div>
                          </div>
                        </Tile>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </Section>
        )
      })}
    </div>
  )
}

function Standings({ season, teams, data }: { season: number; teams: Team[]; data: Data }) {
  const [groupBy, setGroupBy] = useLocalState<GroupBy>('ui.teams.groupBy', 'division')
  const [sort, setSort] = useRouteState<SortState>(`teams.${season}`, 'sort', { column: 'pct', dir: 'desc' })
  const [sel, setSel] = useState<string | null>(null)
  const { summaries, film } = data
  const ties = [...summaries.values()].some((s) => s.ties > 0)
  const rankCell = (t: Team, side: 'offense' | 'defense') => {
    const r = epaStat(summaries.get(t.abbr), side)
    if (!r || !summaries.get(t.abbr)?.games) return <span className="c-label-4">—</span>
    return <RankBadge rank={r.rank} title={`${side === 'offense' ? 'EPA / play' : 'EPA / play allowed'} ${formatEpa(r.value)} · ${ordinal(r.rank)}`} />
  }
  const columns: Column<Team>[] = [
    {
      id: 'team',
      label: 'Team',
      flex: 3,
      minWidth: 220,
      sortable: true,
      render: (t) => (
        <span className="standings-team">
          <TeamChip abbr={t.abbr} />
          <a
            className="standings-team__name"
            onClick={(e) => {
              e.stopPropagation()
              navigate(links.team(season, t.abbr))
            }}
          >
            {t.nickname}
          </a>
          <span className="standings-team__city">{city(t)}</span>
        </span>
      )
    },
    { id: 'w', label: 'W', width: 40, numeric: true, sortable: true, render: (t) => summaries.get(t.abbr)?.wins ?? 0 },
    { id: 'l', label: 'L', width: 40, numeric: true, sortable: true, render: (t) => summaries.get(t.abbr)?.losses ?? 0 },
    ...(ties ? [{ id: 't', label: 'T', width: 40, numeric: true, sortable: true, render: (t: Team) => summaries.get(t.abbr)?.ties ?? 0 }] : []),
    { id: 'pct', label: 'Pct', width: 56, numeric: true, sortable: true, render: (t) => pctOf(summaries.get(t.abbr)).toFixed(3).replace(/^0/, '') },
    { id: 'pf', label: 'PF', width: 56, numeric: true, sortable: true, render: (t) => summaries.get(t.abbr)?.pointsFor ?? 0 },
    { id: 'pa', label: 'PA', width: 56, numeric: true, sortable: true, render: (t) => summaries.get(t.abbr)?.pointsAgainst ?? 0 },
    { id: 'diff', label: 'Diff', width: 56, numeric: true, sortable: true, render: (t) => formatSigned(diffOf(summaries.get(t.abbr))) },
    { id: 'off', label: 'Off. rank', width: 72, align: 'right', sortable: true, render: (t) => rankCell(t, 'offense') },
    { id: 'def', label: 'Def. rank', width: 72, align: 'right', sortable: true, render: (t) => rankCell(t, 'defense') },
    { id: 'film', label: 'Film', width: 56, numeric: true, sortable: true, render: (t) => film[t.abbr]?.gamesWithFilm || <span className="c-label-4">—</span> },
    {
      id: 'graded',
      label: 'Graded',
      width: 64,
      numeric: true,
      sortable: true,
      render: (t) => {
        const f = film[t.abbr]
        return f?.playCount ? `${Math.round((f.gradedPlays / f.playCount) * 100)}%` : <span className="c-label-4">—</span>
      }
    }
  ]
  const value = (t: Team): number | string => {
    const s = summaries.get(t.abbr)
    const f = film[t.abbr]
    switch (sort.column) {
      case 'team':
        return t.nickname
      case 'w':
        return s?.wins ?? 0
      case 'l':
        return s?.losses ?? 0
      case 't':
        return s?.ties ?? 0
      case 'pf':
        return s?.pointsFor ?? 0
      case 'pa':
        return s?.pointsAgainst ?? 0
      case 'diff':
        return diffOf(s)
      case 'off':
        return -(epaStat(s, 'offense')?.rank ?? 99)
      case 'def':
        return -(epaStat(s, 'defense')?.rank ?? 99)
      case 'film':
        return f?.gamesWithFilm ?? 0
      case 'graded':
        return f?.playCount ? f.gradedPlays / f.playCount : -1
      default:
        return pctOf(s) * 1e6 + diffOf(s)
    }
  }
  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...teams].sort((a, b) => {
      const va = value(a)
      const vb = value(b)
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
      return c * dir || (pctOf(summaries.get(b.abbr)) - pctOf(summaries.get(a.abbr))) || diffOf(summaries.get(b.abbr)) - diffOf(summaries.get(a.abbr))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, summaries, film, sort])
  const groupPopup = (
    <PopupButton<GroupBy>
      value={groupBy}
      onChange={setGroupBy}
      label={`Group by ${groupBy === 'division' ? 'Division' : groupBy === 'conference' ? 'Conference' : 'League'}`}
      options={[
        { value: 'division', label: 'Division' },
        { value: 'conference', label: 'Conference' },
        { value: 'league', label: 'League' }
      ]}
    />
  )
  const table = (rows: Team[], grouped: boolean) => (
    <Table
      className="table--light"
      density="tall"
      stripes={false}
      columns={columns}
      rows={rows}
      rowKey={(t) => t.abbr}
      sort={sort}
      onSort={setSort}
      selection={sel}
      onSelect={setSel}
      onOpen={(t) => navigate(links.team(season, t.abbr))}
      onContextMenu={(t, e) => void showMenu(e, teamMenu(season, t.abbr))}
      groupBy={grouped ? (t) => t.division : undefined}
      groupLabel={grouped ? (g) => g : undefined}
      rowTest="teams-standings-row"
      typeSelect={(t) => t.nickname}
    />
  )
  if (groupBy === 'league') {
    return (
      <Section title="NFL" trailing={groupPopup}>
        {table(sorted, false)}
      </Section>
    )
  }
  return (
    <>
      {(['AFC', 'NFC'] as const).map((conf, i) => {
        const rows = sorted.filter((t) => t.conference === conf)
        if (!rows.length) return null
        const ordered = groupBy === 'division' ? DIVISIONS.filter((d) => d.startsWith(conf)).flatMap((d) => rows.filter((t) => t.division === d)) : rows
        return (
          <Section key={conf} title={conf} trailing={i === 0 || !sorted.some((t) => t.conference === 'AFC') ? groupPopup : undefined}>
            {table(ordered, groupBy === 'division')}
          </Section>
        )
      })}
    </>
  )
}
