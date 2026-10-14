import { useState } from 'react'
import { emptyTally, formatStat, gradeScore, ordinal, plusRate } from '@shared/stats'
import { POSITION_GROUPS } from '@shared/teams'
import type { GradeTally, PositionGroup, TeamGame, TeamRankedStat, TeamRosterRow } from '@shared/types'
import { api } from '../api'
import { Crumbs } from '../App'
import { ErrorBox, GradeBar, Loading, Score, TeamChip, toast, useAsync } from '../components/common'
import { gameResult, opponentLabel, pct, weekLabel } from '../format'
import { links, navigate } from '../router'
import { ImportFilm } from './ImportFilm'

const GROUP_NAMES: Record<PositionGroup, string> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
  OL: 'Offensive line',
  DL: 'Defensive line',
  LB: 'Linebackers',
  DB: 'Defensive backs',
  ST: 'Specialists'
}

export function TeamPage({ season, team }: { season: number; team: string }) {
  const overview = useAsync(() => api.teamOverview(season, team), [season, team])
  const [importing, setImporting] = useState<TeamGame | null>(null)
  const [rosterFilter, setRosterFilter] = useState<'all' | 'offense' | 'defense' | 'graded'>('all')

  if (overview.error) return <div className="page"><ErrorBox error={overview.error} /></div>
  if (!overview.data) return <Loading />
  const { team: t, summary, games, roster } = overview.data

  const exportCsv = async () => {
    const path = await api.exportGradesCsv(season, team)
    if (path) toast(`Saved ${path.split('/').pop()}`)
  }

  const filtered = roster.filter((p) => {
    if (rosterFilter === 'graded') return p.tally.graded > 0
    if (rosterFilter === 'offense') return ['QB', 'RB', 'WR', 'TE', 'OL'].includes(p.group)
    if (rosterFilter === 'defense') return ['DL', 'LB', 'DB'].includes(p.group)
    return p.snaps > 0 || p.tally.graded > 0 || p.status === 'ACT'
  })

  return (
    <div className="page">
      <Crumbs>
        <span className="sep">/</span>
        <a onClick={() => navigate(links.home())}>{season}</a>
        <span className="sep">/</span>
        <span>{t.name}</span>
      </Crumbs>
      <div className="page-narrow">
        <div
          className="team-hero"
          style={{ background: `linear-gradient(110deg, ${t.color}cc 0%, ${t.color}55 45%, var(--panel) 100%)` }}
        >
          <TeamChip abbr={t.abbr} size="lg" />
          <div>
            <h1>{t.name}</h1>
            <div className="muted">
              {t.division} · {season}
            </div>
          </div>
          <span className="spacer" />
          {summary && (
            <div style={{ textAlign: 'right' }}>
              <div className="record">
                {summary.wins}-{summary.losses}
                {summary.ties ? `-${summary.ties}` : ''}
              </div>
              <div className="muted">
                {summary.pointsFor} PF · {summary.pointsAgainst} PA
              </div>
            </div>
          )}
        </div>

        {summary && (
          <div className="stat-grid">
            <StatCard title="Offense" stats={summary.offense} />
            <StatCard title="Defense" stats={summary.defense} />
          </div>
        )}

        <UnitGrades roster={roster} />

        <div className="two-col">
          <div className="card">
            <div className="card-title">
              <h3>Games & film</h3>
              <span className="spacer" />
              <span className="faint">{games.filter((g) => g.clipCount).length} with film</span>
            </div>
            <table className="table">
              <tbody>
                {games.map((g) => (
                  <GameRow key={g.gameId} game={g} team={team} onImport={() => setImporting(g)} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Roster & grades</h3>
              <span className="spacer" />
              <div className="seg">
                {(['all', 'offense', 'defense', 'graded'] as const).map((f) => (
                  <button key={f} className={rosterFilter === f ? 'on' : ''} onClick={() => setRosterFilter(f)}>
                    {f[0].toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <button className="btn small" onClick={exportCsv}>
                Export grades
              </button>
            </div>
            <RosterTable season={season} rows={filtered} />
          </div>
        </div>
      </div>
      {importing && (
        <ImportFilm
          game={importing}
          team={team}
          onClose={() => setImporting(null)}
          onImported={() => {
            setImporting(null)
            navigate(links.film(importing.gameId, team))
          }}
        />
      )}
    </div>
  )
}

/** Your grades rolled up by position group, so you can see which unit is carrying the team. */
function UnitGrades({ roster }: { roster: TeamRosterRow[] }) {
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
  if (!units.length) return null
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">
        <h3>Unit grades</h3>
        <span className="faint">from your film grading, 50 is neutral</span>
      </div>
      <div className="stat-list" style={{ gridTemplateColumns: `repeat(${Math.min(units.length, 9)}, 1fr)` }}>
        {units.map((u) => {
          const s = gradeScore(u.tally)!
          return (
            <div className="stat-tile" key={u.group}>
              <div className="label">{GROUP_NAMES[u.group]}</div>
              <div className="value">
                <Score tally={u.tally} />
              </div>
              <div className="faint" style={{ fontSize: 11 }}>
                {u.tally.graded} snaps · {pct(plusRate(u.tally))} plus
              </div>
              <div style={{ marginTop: 6 }} title={`${s}`}>
                <GradeBar tally={u.tally} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function rankClass(rank: number) {
  return rank <= 8 ? 'top' : rank >= 25 ? 'bottom' : 'mid'
}

function StatCard({ title, stats }: { title: string; stats: TeamRankedStat[] }) {
  return (
    <div className="card">
      <div className="card-title">
        <h3>{title}</h3>
        <span className="faint">league rank out of 32</span>
      </div>
      <div className="stat-list">
        {stats.map((s) => (
          <div className="stat-tile" key={s.key}>
            <div className="label">{s.label}</div>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <span className="value">{formatStat(s.value, s.format)}</span>
              <span className={`rank ${s.neutral ? 'mid' : rankClass(s.rank)}`}>{ordinal(s.rank)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GameRow({ game, team, onImport }: { game: TeamGame; team: string; onImport: () => void }) {
  const opp = team === game.homeTeam ? game.awayTeam : game.homeTeam
  const played = game.homeScore !== null
  const result = gameResult(game, team)
  return (
    <tr>
      <td className="faint" style={{ width: 70 }}>
        {weekLabel(game)}
      </td>
      <td>
        <div className="row">
          <TeamChip abbr={opp} size="sm" />
          <span>{opponentLabel(game, team)}</span>
        </div>
      </td>
      <td className={result.startsWith('W') ? 'score hi' : result.startsWith('L') ? 'score lo' : 'muted'}>{result}</td>
      <td className="num">
        {game.clipCount ? (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <span className="faint" title="Plays graded">
              {game.gradedPlays}/{game.playCount}
            </span>
            <button className="btn small primary" onClick={() => navigate(links.film(game.gameId, team))}>
              Watch
            </button>
          </div>
        ) : played && game.playCount ? (
          <button className="btn small" onClick={onImport}>
            Import film
          </button>
        ) : (
          <span className="faint">{played ? 'No plays yet' : 'Upcoming'}</span>
        )}
      </td>
    </tr>
  )
}

function RosterTable({ season, rows }: { season: number; rows: TeamRosterRow[] }) {
  if (!rows.length) return <div className="empty">No players here yet.</div>
  return (
    <div style={{ maxHeight: 720, overflow: 'auto', margin: '0 -16px', padding: '0 16px' }}>
      <table className="table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Player</th>
            <th>Pos</th>
            <th className="num">Snaps</th>
            <th className="num">Graded</th>
            <th>+ / 0 / –</th>
            <th className="num">+%</th>
            <th className="num">Grade</th>
          </tr>
        </thead>
        <tbody>
          {POSITION_GROUPS.map((g) => {
            const players = rows.filter((p) => p.group === g)
            if (!players.length) return null
            return [
              <tr className="group-row" key={`h-${g}`}>
                <td colSpan={8}>{GROUP_NAMES[g]}</td>
              </tr>,
              ...players.map((p) => (
                <tr key={p.id} className="click" onClick={() => navigate(links.player(season, p.id))}>
                  <td className="num faint">{p.jersey}</td>
                  <td>{p.name}</td>
                  <td className="muted">{p.depthPos || p.position}</td>
                  <td className="num">{p.snaps || <span className="faint">—</span>}</td>
                  <td className="num">{p.tally.graded || <span className="faint">—</span>}</td>
                  <td style={{ width: 90 }}>
                    <GradeBar tally={p.tally} />
                  </td>
                  <td className="num">{p.tally.graded ? pct(plusRate(p.tally)) : <span className="faint">—</span>}</td>
                  <td className="num">
                    <Score tally={p.tally} />
                  </td>
                </tr>
              ))
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
