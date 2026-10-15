import { useEffect, useMemo, useState } from 'react'
import { emptyTally, gradeScore, mergeTally } from '@shared/stats'
import type { PlayerSeasonLine, SeasonStatus } from '@shared/types'
import { api } from '../../api'
import { formatSigned, statColumns, weekCode } from '../../format'
import { Button } from '../../ui/Button'
import { RingGauge } from '../../ui/charts/RingGauge'
import { Sparkline } from '../../ui/charts/Sparkline'
import { Icon } from '../../ui/Icon'
import { ProgressRing } from '../../ui/Progress'
import { Spinner } from '../../ui/Spinner'
import { type Column, Table } from '../../ui/Table'
import { TeamChip } from '../../ui/TeamChip'
import { useDataEvent } from '../../shell/dataEvents'
import { links, navigate } from '../../shell/router'
import { Section } from '../../shell/Screen'
import { downloadSeason, useDownload, useSeasons } from '../../shell/store'
import { CareerTrend, type CareerSeason, CompactList, SampleBadge } from '../shared'
import type { PlayerCtx } from './Player'

/** Career's season range (03 §6.6): from the rookie year (by years of experience, not before 2016) to the newest season. */
export function careerRange(season: number, yearsExp: string, seasons: SeasonStatus[]): number[] {
  const downloaded = seasons.filter((s) => s.downloaded).map((s) => s.season)
  const exp = Number(yearsExp)
  const firstSeason = yearsExp !== '' && Number.isFinite(exp) ? Math.max(2016, season - exp) : Math.min(season, ...downloaded)
  const last = Math.max(season, ...downloaded)
  const known = new Set(seasons.map((s) => s.season))
  const out: number[] = []
  for (let s = last; s >= firstSeason; s--) if (known.has(s) || s === season) out.push(s)
  return out
}

export type LineState = { state: 'loading' } | { state: 'line'; line: PlayerSeasonLine } | { state: 'none' } | { state: 'notDownloaded' }

/** Season lines per player, kept for the session (rows fill in once, then come back instantly). */
const cache = new Map<string, PlayerSeasonLine | null>()

export function useCareerLines(ctx: Pick<PlayerCtx, 'p' | 'playerId' | 'season'>): { range: number[]; lines: Map<number, LineState>; seasons: SeasonStatus[] } {
  const seasons = useSeasons() ?? []
  const range = useMemo(() => careerRange(ctx.season, ctx.p.player.yearsExp, seasons), [ctx.season, ctx.p.player.yearsExp, seasons])
  const downloaded = new Set(seasons.filter((s) => s.downloaded).map((s) => s.season))
  const [, bump] = useState(0)
  const [tick, setTick] = useState(0)
  useDataEvent(['season', 'grades'], () => {
    for (const k of [...cache.keys()]) if (k.startsWith(`${ctx.playerId}:`)) cache.delete(k)
    setTick((t) => t + 1)
  })
  const key = (s: number) => `${ctx.playerId}:${s}`
  const wanted = range.filter((s) => downloaded.has(s) && !cache.has(key(s)))
  useEffect(() => {
    let live = true
    const queue = [...wanted]
    const hint = { name: ctx.p.player.name, group: ctx.p.player.group }
    const worker = async () => {
      while (live && queue.length) {
        const s = queue.shift()!
        const line = await api.playerSeasonLine(s, ctx.playerId, hint).catch(() => null)
        cache.set(key(s), line)
        if (live) bump((n) => n + 1)
      }
    }
    void Promise.all([worker(), worker()])
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted.join(','), ctx.playerId, tick])
  const lines = new Map<number, LineState>()
  for (const s of range) {
    if (!downloaded.has(s)) lines.set(s, { state: 'notDownloaded' })
    else if (!cache.has(key(s))) lines.set(s, { state: 'loading' })
    else {
      const line = cache.get(key(s))
      lines.set(s, line ? { state: 'line', line } : { state: 'none' })
    }
  }
  return { range, lines, seasons }
}

export function careerSeasons(lines: Map<number, LineState>): CareerSeason[] {
  const out: CareerSeason[] = []
  for (const [season, st] of lines) {
    if (st.state !== 'line' || !st.line.tally.graded) continue
    out.push({
      season,
      mean: gradeScore(st.line.tally),
      games: st.line.byGame.map((g) => ({
        key: `${season}:${g.gameId}`,
        gameId: g.gameId,
        title: `${g.gameType && g.gameType !== 'REG' ? weekCode({ week: g.week, gameType: g.gameType }) : `Week ${g.week}`}${g.opponent ? ` ${g.home ? 'vs' : '@'} ${g.opponent}` : ''}`,
        score: g.grade,
        plays: g.plays ?? 0
      }))
    })
  }
  return out.sort((a, b) => a.season - b.season)
}

const first = (name: string) => name.split(/\s+/)[0] ?? name
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** Player › Career (03 §6.6, improvement 12). */
export function Career({ ctx }: { ctx: PlayerCtx }) {
  const { p, playerId } = ctx
  const { range, lines } = useCareerLines(ctx)
  const graded = careerSeasons(lines)
  const career = [...lines.values()].reduce((t, st) => (st.state === 'line' ? mergeTally(t, st.line.tally) : t), emptyTally())
  const withLines = [...lines.values()].filter((s) => s.state === 'line').length
  const missing = range.filter((s) => lines.get(s)?.state === 'notDownloaded')
  const gamesGraded = graded.reduce((n, s) => n + s.games.length, 0)
  const [queue, setQueue] = useState<number[]>([])
  const downloadAll = async (list: number[]) => {
    setQueue(list)
    for (const s of list) {
      await downloadSeason(s)
      setQueue((q) => q.filter((x) => x !== s))
    }
  }
  const cols = statColumns(p.player.group).slice(0, 4)
  type Row = { season: number; st: LineState }
  const rows: Row[] = range.map((season) => ({ season, st: lines.get(season)! }))
  const dash = <span className="c-label-4">—</span>
  const columns: Column<Row>[] = [
    {
      id: 'season',
      label: 'Season',
      width: 64,
      render: (r) => (
        <span className="career-season">
          <a
            className="career-season__link"
            onClick={(e) => {
              e.stopPropagation()
              navigate(links.player(r.season, playerId))
            }}
          >
            {r.season}
          </a>
          {r.st.state === 'line' && r.st.line.matchedBy === 'name' && (
            <span title={`Matched by name and position. The ${r.season} data uses a different player ID.`} className="c-label-3">
              <Icon name="info" size={12} />
            </span>
          )}
        </span>
      )
    },
    {
      id: 'team',
      label: 'Team',
      width: 88,
      render: (r) =>
        r.st.state === 'line' ? (
          <span className="career-teams">
            {(r.st.line.teams.length ? r.st.line.teams : [r.st.line.player.team]).slice(0, 2).map((t) => (
              <TeamChip key={t} abbr={t} />
            ))}
          </span>
        ) : r.st.state === 'notDownloaded' ? (
          <CareerDownloadCell season={r.season} queued={queue.includes(r.season)} onDownload={() => void downloadAll([r.season])} />
        ) : r.st.state === 'none' ? (
          <span className="career-span">No snaps, stats or roster entry in {r.season}</span>
        ) : null
    },
    { id: 'pos', label: 'Pos', width: 48, render: (r) => (r.st.state === 'line' ? <span className="t-callout c-label-2">{r.st.line.player.depthPos || r.st.line.player.position}</span> : null) },
    { id: 'games', label: 'Games', width: 56, numeric: true, render: (r) => (r.st.state === 'line' ? r.st.line.games : null) },
    { id: 'snaps', label: 'Snaps', width: 64, numeric: true, render: (r) => (r.st.state === 'line' ? r.st.line.snaps || dash : null) },
    ...cols.map(
      (c): Column<Row> => ({ id: `s-${c.key}`, label: c.label, width: 64, numeric: true, render: (r) => (r.st.state === 'line' ? c.value(r.st.line.totals) : null) })
    ),
    { id: 'graded', label: 'Graded', width: 64, numeric: true, render: (r) => (r.st.state === 'line' ? r.st.line.tally.graded || dash : null) },
    {
      id: 'tally',
      label: '+ / 0 / −',
      width: 88,
      align: 'right',
      render: (r) => (r.st.state === 'line' && r.st.line.tally.graded ? <span className="t-callout c-label-2 num">{`${r.st.line.tally.plus} / ${r.st.line.tally.zero} / ${r.st.line.tally.minus}`}</span> : null)
    },
    {
      id: 'grade',
      label: 'Grade',
      width: 56,
      align: 'right',
      render: (r) =>
        r.st.state === 'loading' ? <Spinner size={12} /> : r.st.state === 'line' ? <SampleBadge score={gradeScore(r.st.line.tally)} plays={r.st.line.tally.graded} /> : null
    },
    {
      id: 'trend',
      label: 'Trend',
      width: 76,
      render: (r) => (r.st.state === 'line' && r.st.line.byGame.length ? <Sparkline values={r.st.line.byGame.map((g) => g.grade)} /> : null)
    }
  ]
  return (
    <div data-test="player-career">
      <div className="career-summary">
        <div className="career-summary__ring">
          <RingGauge score={gradeScore(career)} size={72} label="Career" />
          <span className="career-summary__text">
            {withLines} {withLines === 1 ? 'season' : 'seasons'} · {career.graded} {career.graded === 1 ? 'play' : 'plays'} graded
          </span>
        </div>
        <div className="career-summary__chart">
          {graded.length >= 2 && gamesGraded >= 4 ? (
            <CareerTrend seasons={graded} height={180} test="career-trend" onOpen={(_, s) => navigate(links.player(s, playerId))} />
          ) : graded.length >= 2 ? (
            <CompactList
              rows={[...graded].reverse().map((s, i, arr) => {
                const prev = arr[i + 1]
                const plays = s.games.reduce((n, g) => n + g.plays, 0)
                return {
                  key: String(s.season),
                  label: String(s.season),
                  detail: `${plays} plays${prev && prev.mean !== null && s.mean !== null ? ` · ${formatSigned(s.mean - prev.mean)} from ${prev.season}` : ''}`,
                  score: s.mean,
                  plays
                }
              })}
              onSelect={(k) => navigate(links.player(Number(k), playerId))}
            />
          ) : (
            <div className="player-quiet">Grade {first(p.player.name)} in more than one season to see a career trend.</div>
          )}
        </div>
      </div>
      {missing.length > 0 && (
        <div className="career-missing">
          <Icon name="database" size={14} />
          <span className="career-missing__text">
            {andList(missing.slice().sort().map(String))} {missing.length === 1 ? 'isn’t' : 'aren’t'} downloaded. Download {missing.length === 1 ? 'it' : 'them'} to see {p.player.name}’s full career.
          </span>
          <CareerDownloadAll missing={missing} queue={queue} onDownload={() => void downloadAll(missing.slice().sort((a, b) => b - a))} />
        </div>
      )}
      <Section title="Seasons">
        <Table
          className="career-table"
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.season)}
          onSelect={() => {}}
          onOpen={(r) => r.st.state === 'line' && navigate(links.player(r.season, playerId))}
          rowTest="career-row"
        />
      </Section>
    </div>
  )
}

function CareerDownloadAll({ missing, queue, onDownload }: { missing: number[]; queue: number[]; onDownload: () => void }) {
  const current = queue[0] ?? null
  const dl = useDownload(current)
  if (current !== null) {
    const p = dl?.progress
    return (
      <span className="career-progress">
        <ProgressRing value={p?.total ? p.done / p.total : 0} size={14} />
        <span>
          Downloading {current}… {missing.length - queue.length + 1} of {missing.length}
        </span>
      </span>
    )
  }
  return <Button size="sm" label={missing.length === 1 ? `Download ${missing[0]}` : `Download ${missing.length} Seasons`} onClick={onDownload} test="career-download" />
}

function CareerDownloadCell({ season, queued, onDownload }: { season: number; queued: boolean; onDownload: () => void }) {
  const dl = useDownload(season)
  const busy = dl?.busy || queued
  const p = dl?.progress
  return (
    <span className="career-span">
      Not downloaded
      {busy ? (
        <span className="career-progress">
          <ProgressRing value={p?.total ? p.done / p.total : 0} size={14} />
          {p?.total ? `${p.done} of ${p.total}` : ''}
        </span>
      ) : (
        <Button variant="borderless" size="sm" label="Download" onClick={onDownload} test="career-row-download" />
      )}
    </span>
  )
}
