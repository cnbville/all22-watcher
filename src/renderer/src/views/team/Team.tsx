import { useCallback, useEffect, useMemo, useState } from 'react'
import { emptyTally, formatStat, gradeScore, plusRate } from '@shared/stats'
import { POSITION_GROUPS, TEAM_BY_ABBR } from '@shared/teams'
import type { GradeTally, PositionGroup, TeamGame, TeamOverview, TeamRankedStat, TeamRosterRow } from '@shared/types'
import { api } from '../../api'
import { RankBadge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { GradeValue, TallyBar } from '../../ui/Grade'
import { Icon } from '../../ui/Icon'
import { Segmented } from '../../ui/Segmented'
import { type Column, Table } from '../../ui/Table'
import { TeamBadge, TeamChip } from '../../ui/TeamChip'
import { useCommand } from '../../shell/commands'
import { exportCsv, gameMenu, playerMenu, showMenu, teamMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { openImport } from '../../shell/importRequest'
import { links, navigate, setEntrySelection, useHistory } from '../../shell/router'
import { CollapsingTitle, Loading, LoadError, Screen, Section, useScrollRestore } from '../../shell/Screen'
import { useMyTeams } from '../../shell/store'
import { Toolbar } from '../../shell/Toolbar'
import { gameResult, opponentLabel, pct, weekLabel } from '../../format'
import { SeasonGate } from '../shared/SeasonGate'
import './team.css'

/** Team (03 §5, basic): header, Overview · Games · Roster · Units. Ports everything v1's team page did. */

type TeamSection = 'overview' | 'games' | 'roster' | 'units'

const GROUP_NAMES: Record<PositionGroup, string> = {
  QB: 'Quarterbacks',
  RB: 'Running Backs',
  WR: 'Wide Receivers',
  TE: 'Tight Ends',
  OL: 'Offensive Line',
  DL: 'Defensive Line',
  LB: 'Linebackers',
  DB: 'Defensive Backs',
  ST: 'Specialists'
}

const record = (o: TeamOverview) => (o.summary ? `${o.summary.wins}–${o.summary.losses}${o.summary.ties ? `–${o.summary.ties}` : ''}` : '0–0')

function readSection(route: string): TeamSection {
  try {
    return (sessionStorage.getItem(`ui.route.${route}.section`) as TeamSection) || 'overview'
  } catch {
    return 'overview'
  }
}

export function Team({ season, team }: { season: number; team: string }) {
  const route = links.team(season, team)
  const [section, setSectionState] = useState<TeamSection>(() => readSection(route))
  const [q, setQ] = useState('')
  const [data, setData] = useState<TeamOverview | null>(null)
  const [error, setError] = useState<unknown>(null)
  const myTeams = useMyTeams()
  const t = TEAM_BY_ABBR[team]
  const setSection = (s: TeamSection) => {
    setSectionState(s)
    try {
      sessionStorage.setItem(`ui.route.${route}.section`, s)
    } catch {
      // Not remembered.
    }
  }
  const load = useCallback(() => {
    api.teamOverview(season, team).then(
      (d) => {
        setData(d)
        setError(null)
      },
      (e) => setError(e)
    )
  }, [season, team])
  useEffect(load, [load])
  useDataEvent(['film', 'grades', 'season'], load)
  useCommand('file.exportCsv', () => void exportCsv(season, team))
  useCommand('view.section', (arg) => setSection((['overview', 'games', 'roster', 'units'] as const)[Number(arg ?? 0)] ?? 'overview'))

  return (
    <Screen name="team">
      <Toolbar
        title={t?.name ?? team}
        subtitle={data ? `${record(data)} · ${t?.division ?? ''} · ${season}` : `${season}`}
        windowTitle={`${t?.name ?? team} — ${season}`}
        collapsesLargeTitle
        titleMenu={() => [
          ...myTeams.filter((a) => a !== team).map((a) => ({ label: TEAM_BY_ABBR[a]?.name ?? a, run: () => navigate(links.team(season, a)) })),
          ...(myTeams.filter((a) => a !== team).length ? [{ kind: 'separator' as const }] : []),
          { label: 'All Teams…', run: () => navigate(links.teams(season)) }
        ]}
        center={
          <Segmented
            size="toolbar"
            value={section}
            onChange={setSection}
            label="Section"
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'games', label: 'Games' },
              { value: 'roster', label: 'Roster' },
              { value: 'units', label: 'Units' }
            ]}
          />
        }
        trailing={[
          { kind: 'button', command: 'go.matchups', icon: 'swords', label: 'Matchup' },
          { kind: 'pulldown', icon: 'share', label: 'Export', items: [{ label: 'Export Grades as CSV…', shortcut: '⇧⌘E', run: () => void exportCsv(season, team) }], test: 'toolbar-export' }
        ]}
        search={{ placeholder: 'Search players', value: q, onChange: (v) => (setQ(v), v && setSection('roster')) }}
      />
      <SeasonGate season={season}>
        {error && !data ? (
          <LoadError what="this team" error={error} retry={load} />
        ) : !data ? (
          <Loading />
        ) : (
          <TeamContent data={data} season={season} team={team} section={section} q={q} reload={load} />
        )}
      </SeasonGate>
    </Screen>
  )
}

function TeamContent({ data, season, team, section, q, reload }: { data: TeamOverview; season: number; team: string; section: TeamSection; q: string; reload: () => void }) {
  useScrollRestore(true)
  const { summary, games, roster } = data
  const t = data.team
  return (
    <>
      <CollapsingTitle className="team-header" test="team-header">
        <span onContextMenu={(e) => void showMenu(e, teamMenu(season, team))}>
          <TeamBadge abbr={t.abbr} />
        </span>
        <div className="team-header__text">
          <h1 className="t-large-title">{t.name}</h1>
          <div className="team-header__sub">
            {record(data)} · {t.division} · {season}
            {summary ? ` · ${summary.pointsFor} PF · ${summary.pointsAgainst} PA` : ''}
          </div>
        </div>
      </CollapsingTitle>
      {section === 'overview' && (
        <>
          {summary && (
            <Section title="Season Stats">
              <div className="team-stats">
                <StatColumn title="Offense" stats={summary.offense} />
                <StatColumn title="Defense" stats={summary.defense} />
              </div>
            </Section>
          )}
          <UnitGrades roster={roster} />
          <GamesList games={games} team={team} reload={reload} />
        </>
      )}
      {section === 'games' && <GamesList games={games} team={team} reload={reload} />}
      {section === 'roster' && <Roster season={season} roster={roster} q={q} />}
      {section === 'units' && (
        <UnitGrades roster={roster} always />
      )}
    </>
  )
}

function StatColumn({ title, stats }: { title: string; stats: TeamRankedStat[] }) {
  return (
    <div className="team-stats__column">
      <div className="team-stats__title">{title}</div>
      <div className="team-stats__grid">
        {stats.map((s) => (
          <div className="stat-tile" key={s.key} data-test="stat-tile">
            <div className="stat-tile__label">{s.label}</div>
            <div className="stat-tile__value">{formatStat(s.value, s.format)}</div>
            <RankBadge rank={s.rank} neutral={s.neutral} title={`${s.rank} of 32`} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Your grades rolled up by position group, so you can see which unit is carrying the team. */
function UnitGrades({ roster, always }: { roster: TeamRosterRow[]; always?: boolean }) {
  const units = POSITION_GROUPS.map((g) => {
    const tally: GradeTally = emptyTally()
    for (const p of roster.filter((r) => r.group === g)) {
      tally.graded += p.tally.graded
      tally.plus += p.tally.plus
      tally.zero += p.tally.zero
      tally.minus += p.tally.minus
    }
    return { group: g, tally }
  }).filter((u) => u.tally.graded > 0)
  if (!units.length) {
    return always ? <EmptyState icon="chart-line" title="No grades yet" body="Grade this team’s players in the tape room and their units are rated here." /> : null
  }
  return (
    <Section title="Unit Grades" trailing={<span className="t-callout c-label-3">From your film grading · 50 is neutral</span>}>
      <div className="team-units">
        {units.map((u) => (
          <div className="unit-tile" key={u.group}>
            <div className="stat-tile__label">{GROUP_NAMES[u.group]}</div>
            <div className="unit-tile__value">
              <GradeValue score={gradeScore(u.tally)} />
            </div>
            <div className="unit-tile__sub">
              {u.tally.graded} snaps · {pct(plusRate(u.tally))} plus
            </div>
            <TallyBar tally={u.tally} />
          </div>
        ))}
      </div>
    </Section>
  )
}

function GamesList({ games, team, reload }: { games: TeamGame[]; team: string; reload: () => void }) {
  const withFilm = games.filter((g) => g.clipCount).length
  const importFilm = (g: TeamGame) => openImport({ game: g, team, onImported: () => navigate(links.tape(g.gameId, team)) })
  return (
    <Section title="Games" trailing={<span className="t-callout c-label-3">{withFilm} with film</span>}>
      <div className="team-games">
        {games.map((g) => {
          const opp = team === g.homeTeam ? g.awayTeam : g.homeTeam
          const played = g.homeScore !== null
          const result = gameResult(g, team)
          return (
            <div
              key={g.gameId}
              className="game-row"
              data-test="game-row"
              onContextMenu={(e) => void showMenu(e, gameMenu(g, team, { hasFilm: g.clipCount > 0, importFilm: () => importFilm(g), onRemoved: reload }))}
            >
              <span className="game-row__week">{weekLabel(g)}</span>
              <TeamChip abbr={opp} />
              <span className="game-row__opp">{opponentLabel(g, team)}</span>
              <span className="game-row__result" data-result={result[0]}>
                {result}
              </span>
              <span className="game-row__film">
                {g.clipCount ? (
                  <>
                    <span className="c-label-3" title="Plays graded">
                      {g.gradedPlays} of {g.playCount} graded
                    </span>
                    <Button size="sm" label="Watch" icon="play" test="game-action" onClick={() => navigate(links.tape(g.gameId, team))} />
                  </>
                ) : played && g.playCount ? (
                  <Button size="sm" variant="borderless" icon="folder-input" label="Import Film…" test="game-action" onClick={() => importFilm(g)} />
                ) : (
                  <span className="c-label-3">{played ? 'No plays yet' : 'Upcoming'}</span>
                )}
              </span>
              {g.clipCount > 0 && <Icon name="chevron-right" size={12} className="game-row__chevron" />}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function Roster({ season, roster, q }: { season: number; roster: TeamRosterRow[]; q: string }) {
  const h = useHistory()
  const [sel, setSel] = useState<string | null>(h.entries[h.index]?.selection ?? null)
  const needle = q.trim().toLowerCase()
  const rows = useMemo(
    () =>
      roster
        .filter((p) => (needle ? p.name.toLowerCase().includes(needle) || p.jersey === needle || p.position.toLowerCase() === needle : p.snaps > 0 || p.tally.graded > 0 || p.status === 'ACT'))
        .sort((a, b) => POSITION_GROUPS.indexOf(a.group) - POSITION_GROUPS.indexOf(b.group)),
    [roster, needle]
  )
  if (!rows.length) return <EmptyState icon="search" title={needle ? `No Results for “${q.trim()}”` : 'No players yet'} body={needle ? 'Check the spelling or try a team, player or week.' : undefined} />
  const columns: Column<TeamRosterRow>[] = [
    { id: 'jersey', label: '#', width: 44, numeric: true, render: (p) => <span className="c-label-3">{p.jersey}</span> },
    {
      id: 'name',
      label: 'Player',
      flex: 3,
      minWidth: 180,
      render: (p) => (
        <a className="link" onClick={(e) => (e.stopPropagation(), navigate(links.player(season, p.id)))}>
          {p.name}
        </a>
      )
    },
    { id: 'pos', label: 'Pos', width: 60, render: (p) => <span className="c-label-2">{p.depthPos || p.position}</span> },
    { id: 'snaps', label: 'Snaps', width: 64, numeric: true, render: (p) => p.snaps || '—' },
    { id: 'graded', label: 'Graded', width: 64, numeric: true, render: (p) => p.tally.graded || '—' },
    { id: 'tally', label: '+ / 0 / −', width: 100, render: (p) => <TallyBar tally={p.tally} width={80} /> },
    { id: 'plus', label: '+%', width: 56, numeric: true, render: (p) => (p.tally.graded ? pct(plusRate(p.tally)) : '—') },
    { id: 'grade', label: 'Grade', width: 64, numeric: true, render: (p) => <GradeValue score={gradeScore(p.tally)} /> }
  ]
  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      selection={sel}
      onSelect={(k) => {
        setSel(k)
        setEntrySelection(k)
      }}
      onOpen={(p) => navigate(links.player(season, p.id))}
      onContextMenu={(p, e) => void showMenu(e, playerMenu(season, p))}
      groupBy={(p) => p.group}
      groupLabel={(g) => GROUP_NAMES[g as PositionGroup]}
      rowTest="roster-row"
      typeSelect={(p) => p.name}
    />
  )
}
