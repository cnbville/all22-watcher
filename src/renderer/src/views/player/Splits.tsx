import { useMemo, useState } from 'react'
import { rulesToTokens } from '@shared/playQuery'
import { computeSplits, type SplitGroup, type SplitRow } from '@shared/splits'

import { TEAM_BY_ABBR } from '@shared/teams'
import type { PlayRule } from '@shared/types'
import { openRulesSheet } from '../cutups/actions'
import { formatEpa, formatPct, gameOutcome, ordinal, weekCode } from '../../format'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { EmptyState } from '../../ui/EmptyState'
import { PopupButton } from '../../ui/PopupButton'
import { type Column, Table } from '../../ui/Table'
import { TeamDot } from '../../ui/TeamChip'
import { action, sep, showMenu } from '../../shell/contextMenus'
import { links, navigate } from '../../shell/router'
import { Section } from '../../shell/Screen'
import { GradeEpaStrip, OpponentScatter, PlayList, SampleBadge, SampleGrade, SplitBar, tierSummaries, useLocalState } from '../shared'
import { epaByGame, epaFigures, epaPoints, type Measure, MEASURE_CHOICES, MEASURES, opponentGames, secondLook, splitPlays } from './model'
import type { PlayerCtx } from './Player'

const first = (name: string) => name.split(/\s+/)[0] ?? name

/** Player › Splits (03 §6.4): Situations, By Opponent, Grade vs EPA. */
export function Splits({ ctx }: { ctx: PlayerCtx }) {
  if (!ctx.p.tally.graded) {
    return (
      <EmptyState
        icon="chart-column"
        title="No splits yet"
        body={`Splits fill in as you grade ${first(ctx.p.player.name)}’s plays.`}
        primary={{ label: 'Grade on Film', run: ctx.gradeOnFilm, disabled: !ctx.filmGame }}
      />
    )
  }
  return (
    <>
      <Situations ctx={ctx} />
      <ByOpponent ctx={ctx} />
      <GradeVsEpa ctx={ctx} />
    </>
  )
}

// ── Situations ───────────────────────────────────────────────────────────────

interface SplitTableRow {
  key: string
  group: SplitGroup
  row: SplitRow | null
}

function Situations({ ctx }: { ctx: PlayerCtx }) {
  const [type, setType] = useState<'all' | 'run' | 'pass'>('all')
  const [hideSmall, setHideSmall] = useLocalState('ui.splits.hideSmall', false)
  const groups = useMemo(
    () => computeSplits(splitPlays(ctx.p), { type, hasParticipation: ctx.p.hasParticipation, chartFields: ctx.chartFields }),
    [ctx.p, type, ctx.chartFields]
  )
  const fixed = new Set(['down', 'distance', 'quarter'])
  const rows: SplitTableRow[] = groups.flatMap((g): SplitTableRow[] => {
    if (g.notPublished) return [{ key: `${g.key}:np`, group: g, row: null }]
    const list = g.rows.filter((r) => (fixed.has(g.key) || g.key.startsWith('chart:') || r.tally.graded > 0) && (!hideSmall || r.tally.graded >= 5))
    return list.map((r) => ({ key: `${g.key}:${r.key}`, group: g, row: r }))
  })
  const [sel, setSel] = useState<string | null>(null)
  const watch = (rule: PlayRule | null) => {
    if (!rule) return
    const t = rulesToTokens([rule])
    if (t) ctx.openFilm(t.tokens, t.text)
  }
  // "Save as Smart Cut-up…" (03 §6.4.1): the rules sheet, prefilled.
  const saveSmart = (r: SplitRow) => {
    if (!r.rule) return
    openRulesSheet({
      mode: 'new',
      name: `${ctx.p.player.name} · ${r.label}`,
      rules: [{ field: 'player', op: 'graded', value: [ctx.playerId] }, r.rule],
      focus: { playerId: ctx.playerId }
    })
  }
  const dash = <span className="c-label-4">—</span>
  const columns: Column<SplitTableRow>[] = [
    {
      id: 'split',
      label: 'Split',
      flex: 1,
      minWidth: 200,
      render: (x) =>
        x.row ? (
          <span title={x.row.detail ? x.row.detail.map((d) => `${d.raw}: ${d.count}`).join('\n') : undefined}>{x.row.label}</span>
        ) : (
          <span className="t-callout c-label-3">Not published for {ctx.season} yet</span>
        )
    },
    { id: 'plays', label: 'Plays', width: 56, numeric: true, render: (x) => (x.row ? x.row.tally.graded || dash : null) },
    {
      id: 'tally',
      label: '+ / 0 / −',
      width: 88,
      align: 'right',
      render: (x) => (x.row && x.row.tally.graded ? <span className="t-callout c-label-2 num">{`${x.row.tally.plus} / ${x.row.tally.zero} / ${x.row.tally.minus}`}</span> : x.row ? dash : null)
    },
    { id: 'grade', label: 'Grade', width: 56, align: 'right', render: (x) => (x.row ? <SampleGrade score={x.row.grade} plays={x.row.tally.graded} /> : null) },
    { id: 'bar', label: '', width: 160, render: (x) => (x.row ? <SplitBar score={x.row.grade} plays={x.row.tally.graded} /> : null) },
    { id: 'epa', label: 'EPA / play', width: 72, numeric: true, render: (x) => (x.row ? (x.row.epa === null ? dash : formatEpa(x.row.epa)) : null) },
    { id: 'success', label: 'Success', width: 64, numeric: true, render: (x) => (x.row ? (x.row.success === null ? dash : formatPct(x.row.success)) : null) },
    {
      id: 'watch',
      label: '',
      width: 32,
      render: (x) =>
        x.row?.rule && x.row.tally.graded ? (
          <span className="split-watch">
            <Button variant="borderless" size="sm" iconOnly icon="play" label="Watch These Plays" onClick={() => watch(x.row!.rule)} />
          </span>
        ) : null
    }
  ]
  return (
    <Section title="Situations" test="splits-table">
      <div className="splits-controls">
        <PopupButton<'all' | 'run' | 'pass'>
          size="sm"
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: 'All Plays' },
            { value: 'run', label: 'Runs' },
            { value: 'pass', label: 'Passes' }
          ]}
        />
        <Checkbox checked={hideSmall} onChange={setHideSmall}>Hide fewer than 5 plays</Checkbox>
        <span className="splits-controls__note">Grades from fewer than 5 plays are grey.</span>
      </div>
      <Table
        className="splits-table"
        columns={columns}
        rows={rows}
        rowKey={(x) => x.key}
        selection={sel}
        onSelect={setSel}
        onOpen={(x) => watch(x.row?.rule ?? null)}
        onContextMenu={(x, e) => {
          const r = x.row
          if (!r) return
          void showMenu(e, [
            action('Watch These Plays', () => watch(r.rule), { enabled: !!r.rule && r.tally.graded > 0 }),
            action('Save as Smart Cut-up…', () => saveSmart(r), { enabled: !!r.rule }),
            sep(),
            action('Copy Row', () =>
              void navigator.clipboard.writeText(
                [r.label, r.tally.graded, `${r.tally.plus} / ${r.tally.zero} / ${r.tally.minus}`, r.grade ?? '', r.epa === null ? '' : formatEpa(r.epa), r.success === null ? '' : formatPct(r.success)].join('\t')
              )
            )
          ])
        }}
        groupBy={(x) => x.group.key}
        groupLabel={(_, list) => (
          <span>
            {list[0].group.label}
            {list[0].group.suffix && <span className="c-label-3"> · {list[0].group.suffix}</span>}
          </span>
        )}
        rowTest="split-row"
      />
    </Section>
  )
}

// ── By Opponent ──────────────────────────────────────────────────────────────

function ByOpponent({ ctx }: { ctx: PlayerCtx }) {
  const group = ctx.p.player.group
  const choices = MEASURE_CHOICES[group]
  const [stored, setMeasure] = useLocalState<Measure>(`ui.opponents.${group}`, choices[0])
  const measure = choices.includes(stored) ? stored : choices[0]
  const m = MEASURES[measure]
  const games = useMemo(() => opponentGames(ctx.p, ctx.summaries, measure), [ctx.p, ctx.summaries, measure])
  const tiers = tierSummaries(games)
  const epa = useMemo(() => epaByGame(ctx.p), [ctx.p])
  const lines = new Map(ctx.p.games.map((g) => [g.game.gameId, g]))
  const [sel, setSel] = useState<string | null>(null)
  const openGame = (gameId: string) => ctx.openFilm([{ key: 'game', values: [gameId] }])
  if (!games.length) return null
  const dash = <span className="c-label-4">—</span>
  const columns: Column<(typeof games)[number]>[] = [
    { id: 'wk', label: 'Wk', width: 48, render: (g) => <span className="t-callout c-label-3">{weekCode(lines.get(g.key)!.game)}</span> },
    {
      id: 'opp',
      label: 'Opponent',
      flex: 1,
      render: (g) => {
        const line = lines.get(g.key)!
        return (
          <span className="game-opp">
            <TeamDot abbr={g.opp} size={8} />
            <a
              className="game-opp__label"
              onClick={(e) => {
                e.stopPropagation()
                navigate(links.team(ctx.season, g.opp))
              }}
            >
              {line.team === line.game.homeTeam ? 'vs' : '@'} {g.opp}
            </a>
            <span className="game-opp__name">{TEAM_BY_ABBR[g.opp]?.nickname}</span>
          </span>
        )
      }
    },
    { id: 'rank', label: m.column, width: 96, render: (g) => (g.rank ? <span className="rank-plain">{ordinal(g.rank)}</span> : dash) },
    { id: 'plays', label: 'Plays', width: 56, numeric: true, render: (g) => g.tally.graded },
    { id: 'tally', label: '+ / 0 / −', width: 88, align: 'right', render: (g) => <span className="t-callout c-label-2 num">{`${g.tally.plus} / ${g.tally.zero} / ${g.tally.minus}`}</span> },
    { id: 'grade', label: 'Grade', width: 56, align: 'right', render: (g) => <SampleGrade score={g.score} plays={g.tally.graded} /> },
    { id: 'epa', label: 'EPA / play', width: 72, numeric: true, render: (g) => (epa.get(g.key) == null ? dash : formatEpa(epa.get(g.key)!)) },
    {
      id: 'result',
      label: 'Result',
      width: 88,
      render: (g) => {
        const line = lines.get(g.key)!
        const r = gameOutcome(line.game, line.team)
        return r ? (
          <span className="game-result">
            <span className="game-result__letter">{r.letter}</span>
            <span className="num">{r.score}</span>
          </span>
        ) : (
          dash
        )
      }
    }
  ]
  return (
    <Section
      title="By Opponent"
      test="opponents-chart"
      trailing={<PopupButton<Measure> size="sm" value={measure} onChange={setMeasure} options={choices.map((c) => ({ value: c, label: MEASURES[c].label }))} />}
    >
      <div className="opp-layout">
        <div className="opp-layout__chart">
          <OpponentScatter games={games} height={220} onSelect={openGame} test="opponent-scatter" />
        </div>
        <div className="opp-layout__tiers">
          {tiers.map((t) => (
            <div key={t.tier} className="tier-row">
              <div>
                <div className="tier-row__label">{t.label}</div>
                <div className="tier-row__detail">{t.games ? `${t.games} ${t.games === 1 ? 'game' : 'games'} · ${t.tally.graded} ${t.tally.graded === 1 ? 'play' : 'plays'}` : 'No games'}</div>
              </div>
              <SampleBadge score={t.score} plays={t.tally.graded} />
            </div>
          ))}
        </div>
      </div>
      <Table className="opp-table" columns={columns} rows={games} rowKey={(g) => g.key} selection={sel} onSelect={setSel} onOpen={(g) => openGame(g.key)} />
      <div className="player-footnote">
        Opponent strength is each opponent’s {ctx.season} regular-season rank in {m.noun} (1st is the best unit).
      </div>
    </Section>
  )
}

// ── Grade vs EPA ─────────────────────────────────────────────────────────────

function GradeVsEpa({ ctx }: { ctx: PlayerCtx }) {
  const points = useMemo(() => epaPoints(ctx.entries), [ctx.entries])
  const figs = epaFigures(points)
  const look = useMemo(() => secondLook(ctx.entries), [ctx.entries])
  const [selected, setSelected] = useState<string | null>(null)
  const team = TEAM_BY_ABBR[ctx.p.player.team]
  const openPlay = (key: string) => {
    const e = ctx.entries.find((x) => `${x.ref.gameId}:${x.ref.playId}` === key)
    if (e) navigate(links.tape(e.ref.gameId, e.team, { play: e.ref.playId, player: ctx.playerId, focus: true }))
  }
  return (
    <Section title="Grade vs EPA" test="epa-chart">
      <GradeEpaStrip points={points} teamName={team?.nickname ?? ctx.p.player.team} selected={selected} onSelect={setSelected} onOpen={openPlay} test="epa-strip" />
      <div className="epa-figures">
        {figs.lanes.map((l) => (
          <div key={l.grade} className="figure">
            <div className="figure__label">{l.grade === 1 ? '+ plays' : l.grade === 0 ? '0 plays' : '− plays'}</div>
            <div className="figure__value num">{l.mean === null ? '—' : formatEpa(l.mean)}</div>
            <div className="figure__caption">
              average EPA · {l.plays} {l.plays === 1 ? 'play' : 'plays'}
            </div>
          </div>
        ))}
        <div className="figure">
          <div className="figure__label">Agreement</div>
          <div className="figure__value num">{figs.agreement === null ? '—' : formatPct(figs.agreement)}</div>
          <div className="figure__caption">of + and − plays where EPA agrees</div>
        </div>
      </div>
      <div className="second-look">
        <div className="second-look__title">Worth a Second Look</div>
        <div className="second-look__sub">Plays where your grade and EPA point opposite ways.</div>
        {look.length ? <PlayList entries={look} playerId={ctx.playerId} rowTest="second-look-row" /> : <div className="player-quiet">Your grades and EPA agree on every play.</div>}
      </div>
      <div className="player-footnote">
        EPA is the change in expected points on the play, from the {team?.nickname ?? ctx.p.player.team}’ side: positive helped {team ? team.name.replace(` ${team.nickname}`, '') : 'them'}.
      </div>
    </Section>
  )
}

