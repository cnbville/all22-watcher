import { useMemo, useState } from 'react'
import { gradeScore } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { PlayerGameLine } from '@shared/types'
import { formatEpa, gameDayLabel, gameOutcome, statColumns, weekCode } from '../../format'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { type Column, Table } from '../../ui/Table'
import { TeamChip, TeamDot } from '../../ui/TeamChip'
import { gameMenu, showMenu } from '../../shell/contextMenus'
import { openImport } from '../../shell/importRequest'
import { links, navigate } from '../../shell/router'
import { SampleBadge } from '../shared'
import { epaByGame, meanEpa } from './model'
import type { PlayerCtx } from './Player'

type LogRow = { kind: 'game'; line: PlayerGameLine } | { kind: 'season' }

const snapsOf = (l: PlayerGameLine) => (l.snaps ? l.snaps.offense + l.snaps.defense + l.snaps.special : null)

/** Player › Game Log (03 §6.5): one row per game, a Season totals row last. */
export function GameLogSection({ ctx }: { ctx: PlayerCtx }) {
  const { p, season } = ctx
  const cols = statColumns(p.player.group)
  const epa = useMemo(() => epaByGame(p), [p])
  const seasonEpa = useMemo(() => meanEpa(p), [p])
  const filmGames = useMemo(() => new Set(p.reel.filter((r) => r.clips.length).map((r) => r.gameId)), [p])
  const traded = p.teams.length > 1
  const [sel, setSel] = useState<string | null>(null)
  if (!p.games.length) return <EmptyState small title={`No games for this player in the ${season} data.`} />
  const dash = <span className="c-label-4">—</span>
  const hasFilm = (l: PlayerGameLine) => filmGames.has(l.game.gameId)
  const open = (l: PlayerGameLine) => {
    if (hasFilm(l)) navigate(links.tape(l.game.gameId, l.team, { player: ctx.playerId, focus: true }))
    else navigate(links.team(season, l.team))
  }
  const totalSnaps = p.games.reduce((n, g) => n + (snapsOf(g) ?? 0), 0)
  const columns: Column<LogRow>[] = [
    { id: 'wk', label: 'Wk', width: 48, render: (r) => (r.kind === 'game' ? <span className="t-callout c-label-3">{weekCode(r.line.game)}</span> : 'Season') },
    { id: 'date', label: 'Date', width: 88, render: (r) => (r.kind === 'game' ? <span className="t-callout c-label-2">{gameDayLabel(r.line.game.gameday)}</span> : null) },
    {
      id: 'opp',
      label: 'Opponent',
      flex: 1,
      minWidth: 140,
      render: (r) =>
        r.kind === 'game' ? (
          <span className="game-opp">
            <TeamDot abbr={r.line.opponent} size={8} />
            <a
              className="game-opp__label"
              onClick={(e) => {
                e.stopPropagation()
                navigate(links.team(season, r.line.opponent))
              }}
            >
              {r.line.team === r.line.game.homeTeam ? 'vs' : '@'} {r.line.opponent}
            </a>
          </span>
        ) : (
          <span className="c-label-2">{p.games.length} games</span>
        )
    },
    ...(traded ? [{ id: 'team', label: 'Team', width: 56, render: (r: LogRow) => (r.kind === 'game' ? <TeamChip abbr={r.line.team} /> : null) }] : []),
    {
      id: 'result',
      label: 'Result',
      width: 88,
      render: (r) => {
        if (r.kind !== 'game') return null
        const o = gameOutcome(r.line.game, r.line.team)
        return o ? (
          <span className="game-result">
            <span className="game-result__letter">{o.letter}</span>
            <span className="num">{o.score}</span>
          </span>
        ) : (
          dash
        )
      }
    },
    {
      id: 'snaps',
      label: 'Snaps',
      width: 64,
      numeric: true,
      render: (r) => {
        if (r.kind === 'season') return totalSnaps || dash
        const s = r.line.snaps
        const n = snapsOf(r.line)
        if (!s || n === null) return dash
        const parts = [s.offense ? `Offense ${s.offense}` : '', s.defense ? `Defense ${s.defense}` : '', s.special ? `Special teams ${s.special}` : ''].filter(Boolean).join(' · ')
        return <span title={parts}>{n}</span>
      }
    },
    ...cols.map(
      (c): Column<LogRow> => ({
        id: `stat-${c.key}`,
        label: c.label,
        width: 64,
        numeric: true,
        render: (r) => (r.kind === 'season' ? c.value(p.totals) : Object.keys(r.line.stats).length ? c.value(r.line.stats) : dash)
      })
    ),
    {
      id: 'tally',
      label: '+ / 0 / −',
      width: 88,
      align: 'right',
      render: (r) => {
        const t = r.kind === 'season' ? p.tally : r.line.tally
        return t.graded ? <span className="t-callout c-label-2 num">{`${t.plus} / ${t.zero} / ${t.minus}`}</span> : dash
      }
    },
    {
      id: 'grade',
      label: 'Grade',
      width: 56,
      align: 'right',
      render: (r) => {
        const t = r.kind === 'season' ? p.tally : r.line.tally
        return <SampleBadge score={gradeScore(t)} plays={t.graded} />
      }
    },
    {
      id: 'epa',
      label: 'EPA / play',
      width: 72,
      numeric: true,
      render: (r) => {
        const v = r.kind === 'season' ? seasonEpa : epa.get(r.line.game.gameId)
        return v == null ? dash : formatEpa(v)
      }
    },
    {
      id: 'film',
      label: 'Film',
      width: 40,
      render: (r) =>
        r.kind === 'game' && hasFilm(r.line) ? (
          <span title="Film imported" className="c-label-2">
            <Icon name="film" size={14} />
          </span>
        ) : null
    },
    {
      id: 'focus',
      label: '',
      width: 28,
      render: (r) =>
        r.kind === 'game' && hasFilm(r.line) ? (
          <span className="row-hover">
            <Button variant="borderless" size="sm" iconOnly icon="scan-eye" label="Grade in Player Focus" onClick={() => open(r.line)} />
          </span>
        ) : null
    }
  ]
  const rows: LogRow[] = [...p.games.map((line) => ({ kind: 'game' as const, line })), { kind: 'season' }]
  return (
    <Table
      className="game-log"
      columns={columns}
      rows={rows}
      rowKey={(r) => (r.kind === 'game' ? r.line.game.gameId : 'season')}
      selection={sel}
      onSelect={setSel}
      onOpen={(r) => r.kind === 'game' && open(r.line)}
      onContextMenu={(r, e) => {
        if (r.kind !== 'game') return
        const l = r.line
        void showMenu(e, gameMenu(l.game, l.team, { hasFilm: hasFilm(l), importFilm: () => openImport({ game: l.game, team: l.team }) }))
      }}
      rowTest="game-log-row"
      typeSelect={(r) => (r.kind === 'game' ? (TEAM_BY_ABBR[r.line.opponent]?.nickname ?? r.line.opponent) : 'Season')}
    />
  )
}
