import { useEffect, useMemo, useState } from 'react'
import { gameLabel, weekName, weekShort } from '@shared/labels'
import { emptyTally, formatStat, gradeScore, mergeTally, plusRate } from '@shared/stats'
import { DEFENSE_GROUPS, OFFENSE_GROUPS, POSITION_GROUPS, TEAM_BY_ABBR, TEAMS } from '@shared/teams'
import type { FilmLibraryItem, GradeTally, PositionGroup, TeamGame, TeamOverview, TeamRankedStat, TeamRosterRow, TeamSummary, UnitGameLine, UnitKey } from '@shared/types'
import { api } from '../../api'
import { formatEpa, formatPct, gameDayLabel, gameOutcome, ordinal, recordLabel, weekCode } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { RankBadge, TextBadge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Sparkline } from '../../ui/charts/Sparkline'
import { EmptyState } from '../../ui/EmptyState'
import { TallyBar } from '../../ui/Grade'
import { ProgressBar } from '../../ui/Progress'
import { Segmented, ToggleSegments } from '../../ui/Segmented'
import { type Column, type SortState, Table } from '../../ui/Table'
import { TeamBadge, TeamDot, TeamLogo } from '../../ui/TeamChip'
import { useCommand, useDynamicMenus } from '../../shell/commands'
import { action, exportCsv, gameMenu, playerMenu, sep, showMenu, teamMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { openImport, setImportContext } from '../../shell/importRequest'
import { links, navigate, setEntrySelection, useHistory } from '../../shell/router'
import { CollapsingTitle, Loading, LoadError, Screen, Section, useScrollRestore } from '../../shell/Screen'
import { useMyTeams } from '../../shell/store'
import { Toolbar } from '../../shell/Toolbar'
import {
  type HeatColumn,
  type HeatRow,
  KeyArt,
  KeyNumber,
  type OpponentGame,
  OpponentScatter,
  SampleBadge,
  Shelf,
  StillCard,
  ThinTrend,
  tierSummaries,
  UnitHeatGrid,
  useLoaded,
  useRouteState
} from '../shared'
import { SeasonGate } from '../shared/SeasonGate'
import './team.css'

/** Team (03 §5): key-art header, then Overview · Games · Roster · Units. */

type TeamSection = 'overview' | 'games' | 'roster' | 'units'
const SECTIONS: { value: TeamSection; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'games', label: 'Games' },
  { value: 'roster', label: 'Roster' },
  { value: 'units', label: 'Units' }
]

export const UNIT_NAME: Record<PositionGroup, string> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
  OL: 'Offensive line',
  DL: 'Defensive line',
  LB: 'Linebackers',
  DB: 'Defensive backs',
  ST: 'Special teams'
}
const ROSTER_GROUP: Record<PositionGroup, string> = { ...UNIT_NAME, ST: 'Specialists' }

type PosterRef = { clipId: number; at: number } | null

const record = (s: TeamSummary | null) => (s ? recordLabel(s.wins, s.losses, s.ties) : '0–0')
const opponentOf = (g: { homeTeam: string; awayTeam: string }, team: string) => (g.homeTeam === team ? g.awayTeam : g.homeTeam)
const played = (g: TeamGame) => g.homeScore !== null && g.awayScore !== null
const epaRank = (s: TeamSummary | undefined, side: 'offense' | 'defense') => s?.[side].find((x) => x.key === 'epa') ?? null
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const pctOf = (s?: TeamSummary) => (s && s.wins + s.losses + s.ties ? (s.wins + s.ties / 2) / (s.wins + s.losses + s.ties) : 0)

/** The most recent game with film (for Watch Latest Film and Grade in Player Focus). */
const latestFilm = (games: TeamGame[]) => [...games].reverse().find((g) => g.clipCount > 0) ?? null
const latestPlayed = (games: TeamGame[]) => [...games].reverse().find((g) => played(g) && g.playCount > 0) ?? null

export function Team({ season, team }: { season: number; team: string }) {
  const route = links.team(season, team)
  const [section, setSection] = useRouteState<TeamSection>(route, 'section', 'overview')
  const [q, setQ] = useState('')
  const [focusGroup, setFocusGroup] = useState<PositionGroup | null>(null)
  const myTeams = useMyTeams()
  const t = TEAM_BY_ABBR[team]
  const data = useLoaded(() => api.teamOverview(season, team), [season, team])
  const summaries = useLoaded(() => api.teamSummaries(season), [season])
  // Stills for the key art and the game cards: one per game this team has film for.
  const library = useLoaded(() => api.filmLibrary().catch(() => [] as FilmLibraryItem[]), [])
  useDataEvent(['film', 'grades', 'season'], data.reload)
  useDataEvent('season', summaries.reload)
  useDataEvent(['film', 'grades'], library.reload)
  const o = data.data
  const nextGame = o?.games.find((g) => !played(g)) ?? null
  const nextOpp = nextGame ? opponentOf(nextGame, team) : null
  const posters = useMemo(() => {
    const out = new Map<string, PosterRef>()
    for (const f of library.data ?? []) if (f.team === team && f.poster) out.set(f.game.gameId, f.poster)
    return out
  }, [library.data, team])

  useCommand('file.exportCsv', () => void exportCsv(season, team))
  useCommand('view.section', (arg) => setSection(SECTIONS[Number(arg ?? 1) - 1]?.value ?? 'overview'))
  useCommand('go.matchups', () => navigate(links.matchup(season, team, nextOpp ?? undefined)))
  useDynamicMenus({ sections: SECTIONS.map((s, i) => ({ index: i + 1, label: s.label, checked: s.value === section })) })
  useEffect(() => {
    const g = o ? (latestFilm(o.games) ?? latestPlayed(o.games)) : null
    setImportContext(g ? { game: g, team } : null)
    return () => setImportContext(null)
  }, [o, team])

  return (
    <Screen name="team">
      <Toolbar
        title={t?.name ?? team}
        subtitle={`${record(o?.summary ?? null)} · ${t?.division ?? ''} · ${season}`}
        windowTitle={`${t?.name ?? team} — ${season}`}
        collapsesLargeTitle
        busy={data.busy}
        titleMenu={() => [
          { kind: 'header', label: 'My Teams' },
          ...myTeams.map((a) => ({ label: TEAM_BY_ABBR[a]?.name ?? a, checked: a === team, run: () => navigate(links.team(season, a)) })),
          { kind: 'separator' as const },
          { label: 'All Teams…', run: () => navigate(links.teams(season)) }
        ]}
        center={
          <Segmented
            size="toolbar"
            value={section}
            onChange={setSection}
            label="Section"
            options={SECTIONS.map((s) => ({ ...s, test: `team-section-${s.value}` }))}
          />
        }
        trailing={[
          { kind: 'button', command: 'go.matchups', icon: 'swords', label: 'Open Matchup', test: 'team-matchup' },
          {
            kind: 'pulldown',
            icon: 'share',
            label: 'Export',
            items: [{ label: 'Export Grades as CSV…', shortcut: '⇧⌘E', run: () => void exportCsv(season, team), test: 'export-csv' }],
            test: 'toolbar-export'
          }
        ]}
        search={{
          placeholder: 'Search players',
          value: q,
          onChange: (v) => {
            setQ(v)
            if (v && section !== 'roster') setSection('roster')
          }
        }}
      />
      <SeasonGate season={season}>
        {data.error && !o ? (
          <LoadError what="this team" error={data.error} retry={data.reload} />
        ) : !o ? (
          <Loading />
        ) : (
          <TeamContent
            o={o}
            summaries={summaries.data ?? []}
            season={season}
            team={team}
            section={section}
            setSection={setSection}
            q={q}
            reload={data.reload}
            focusGroup={focusGroup}
            setFocusGroup={setFocusGroup}
            posters={posters}
          />
        )}
      </SeasonGate>
    </Screen>
  )
}

interface ContentProps {
  o: TeamOverview
  summaries: TeamSummary[]
  season: number
  team: string
  section: TeamSection
  setSection: (s: TeamSection) => void
  q: string
  reload: () => void
  focusGroup: PositionGroup | null
  setFocusGroup: (g: PositionGroup | null) => void
  /** gameId → still, for games with film. */
  posters: Map<string, PosterRef>
}

function unitTallies(roster: TeamRosterRow[]): Record<PositionGroup, GradeTally> {
  const out = Object.fromEntries(POSITION_GROUPS.map((g) => [g, emptyTally()])) as Record<PositionGroup, GradeTally>
  for (const p of roster) out[p.group] = mergeTally(out[p.group], p.tally)
  return out
}

function TeamContent(props: ContentProps) {
  const { o, season, team, section, summaries, posters } = props
  useScrollRestore(true)
  const units = useMemo(() => unitTallies(o.roster), [o.roster])
  const teamTally = POSITION_GROUPS.reduce((t, g) => mergeTally(t, units[g]), emptyTally())
  // Key art: the latest graded game with clips, else the latest game with clips, else a quiet surface.
  const withStill = [...o.games].reverse().filter((g) => posters.has(g.gameId))
  const art = (withStill.find((g) => g.gradedPlays > 0) ?? withStill[0])?.gameId
  return (
    <>
      <TeamHeader o={o} season={season} team={team} tally={teamTally} summaries={summaries} poster={art ? (posters.get(art) ?? null) : null} />
      <div className="team-body">
        {section === 'overview' && <Overview {...props} units={units} />}
        {section === 'games' && <GamesSection {...props} />}
        {section === 'roster' && <Roster {...props} />}
        {section === 'units' && <Units {...props} units={units} />}
      </div>
    </>
  )
}

/** "1st in the NFC East" from the regular-season records, or null before any games. */
function divisionPlace(team: string, division: string, summaries: TeamSummary[]): string | null {
  const by = new Map(summaries.map((s) => [s.team, s]))
  if (!by.get(team)?.games) return null
  const diff = (s?: TeamSummary) => (s ? s.pointsFor - s.pointsAgainst : 0)
  const order = TEAMS.filter((t) => t.division === division)
    .map((t) => by.get(t.abbr))
    .sort((a, b) => pctOf(b) - pctOf(a) || diff(b) - diff(a))
  const i = order.findIndex((s) => s?.team === team)
  return i < 0 ? null : `${ordinal(i + 1)} in the ${division}`
}

function TeamHeader({
  o,
  season,
  team,
  tally,
  summaries,
  poster
}: {
  o: TeamOverview
  season: number
  team: string
  tally: GradeTally
  summaries: TeamSummary[]
  poster: PosterRef
}) {
  const t = o.team
  const s = o.summary
  const playedGames = o.games.filter(played)
  const withFilm = playedGames.filter((g) => g.clipCount > 0).length
  const score = gradeScore(tally)
  const ppg = s?.games ? s.offense.find((x) => x.key === 'ppg') : undefined
  const allowed = s?.games ? s.defense.find((x) => x.key === 'ppg') : undefined
  const place = divisionPlace(team, t.division, summaries)
  const film = playedGames.length ? (withFilm ? `Film for ${withFilm} of ${playedGames.length} games` : 'No film yet') : null
  return (
    <KeyArt poster={poster} className="team-keyart">
      <CollapsingTitle className="team-header" test="team-header">
        <div className="team-header__text">
          <span className="team-header__badge" onContextMenu={(e) => void showMenu(e, teamMenu(season, team))}>
            <TeamBadge abbr={t.abbr} size={52} />
          </span>
          <h1 className="theater-title team-header__name">{t.name}</h1>
          <div className="theater-meta">{[record(s), place ?? t.division, `${season} season`, film].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="team-header__stats">
          <KeyNumber
            test="stat-tile"
            value={ppg ? formatStat(ppg.value, ppg.format) : '—'}
            label="Points a game"
            note={ppg ? ordinal(ppg.rank) : undefined}
            title={ppg ? `${ordinal(ppg.rank)} of 32` : 'No games played yet'}
          />
          <KeyNumber
            test="stat-tile"
            value={allowed ? formatStat(allowed.value, allowed.format) : '—'}
            label="Allowed"
            note={allowed ? ordinal(allowed.rank) : undefined}
            title={allowed ? `${ordinal(allowed.rank)} of 32` : 'No games played yet'}
          />
          <KeyNumber
            test="stat-tile"
            value={score === null || !tally.graded ? '—' : Math.round(score)}
            label="Team grade"
            note={tally.graded ? plural(tally.graded, 'snap') : undefined}
            title={tally.graded ? `Team grade ${score} · ${tally.graded} graded snaps · ${tally.plus} / ${tally.zero} / ${tally.minus}` : 'No grades yet'}
          />
        </div>
      </CollapsingTitle>
    </KeyArt>
  )
}

// ── Units, as plain numbers with a thin trend ────────────────────────────────

const UNIT_GROUPS: { label: string; groups: PositionGroup[] }[] = [
  { label: 'Offense', groups: ['QB', 'RB', 'WR', 'TE', 'OL'] },
  { label: 'Defense', groups: ['DL', 'LB', 'DB'] },
  { label: 'Special teams', groups: ['ST'] }
]

function unitTrend(o: TeamOverview, g: PositionGroup): number[] {
  const out: number[] = []
  for (const u of o.unitsByGame) {
    const t = u.units[g]
    const s = t && t.graded ? gradeScore(t) : null
    if (s !== null) out.push(s)
  }
  return out
}

function UnitList({ o, units, onOpen, detailed }: { o: TeamOverview; units: Record<PositionGroup, GradeTally>; onOpen?: (g: PositionGroup) => void; detailed?: boolean }) {
  return (
    <div className={`unit-list${detailed ? ' unit-list--detailed' : ''}`}>
      {UNIT_GROUPS.map((grp) => (
        <div key={grp.label} className="unit-list__group">
          <div className="unit-list__heading">{grp.label}</div>
          {grp.groups.map((g) => {
            const tally = units[g]
            const score = tally.graded ? gradeScore(tally) : null
            return (
              <div
                key={g}
                className="unit-row"
                data-test={`unit-${g}`}
                data-clickable={onOpen ? true : undefined}
                role={onOpen ? 'button' : undefined}
                tabIndex={onOpen ? 0 : undefined}
                onClick={() => onOpen?.(g)}
                onKeyDown={(e) => {
                  if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onOpen(g)
                  }
                }}
                title={
                  tally.graded
                    ? `${UNIT_NAME[g]}: ${score} · ${tally.graded} graded snaps · ${tally.plus} / ${tally.zero} / ${tally.minus} · ${formatPct(plusRate(tally))} plus`
                    : `${UNIT_NAME[g]}: no grades yet`
                }
              >
                <span className="unit-row__name">{UNIT_NAME[g]}</span>
                {detailed && <span className="unit-row__count num">{tally.graded ? plural(tally.graded, 'snap') : 'Not graded'}</span>}
                <ThinTrend values={unitTrend(o, g)} label={`${UNIT_NAME[g]} by game`} />
                {detailed && (
                  <span className="unit-row__tally">
                    <TallyBar tally={tally} width={64} />
                  </span>
                )}
                <b className="unit-row__grade num">{score === null ? '—' : Math.round(score)}</b>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function NoGradesAction({ o, team }: { o: TeamOverview; team: string }) {
  const film = latestFilm(o.games)
  const game = latestPlayed(o.games)
  if (film) return <Button variant="borderless" size="sm" label="Watch Latest Film" onClick={() => navigate(links.tape(film.gameId, team))} />
  if (game) return <Button variant="borderless" size="sm" label="Import Film…" onClick={() => openImport({ game, team, onImported: () => navigate(links.tape(game.gameId, team)) })} />
  return null
}

// ── Game cards ───────────────────────────────────────────────────────────────

/** What opening a game does: watch its film, import film for it, or open the matchup before it's played. */
function gameActions(g: TeamGame, season: number, team: string, reload: () => void) {
  const opp = opponentOf(g, team)
  const importFilm = () => openImport({ game: g, team, onImported: () => navigate(links.tape(g.gameId, team)) })
  const open = () => {
    if (g.clipCount > 0) return navigate(links.tape(g.gameId, team))
    if (played(g) && g.playCount > 0) return importFilm()
    if (!played(g)) return navigate(links.matchup(season, team, opp))
  }
  const menu = (e: React.MouseEvent) => {
    const items = gameMenu(g, team, {
      hasFilm: g.clipCount > 0,
      importFilm,
      fixMatches: () => void fixMatches(g, team),
      revealClips: () => void revealFirstClip(g.gameId),
      onRemoved: reload
    })
    void showMenu(e, [items[0], action('Open Matchup', () => navigate(links.matchup(season, team, opp))), sep(), ...items.slice(2)])
  }
  return { open, importFilm, menu }
}

/** "Week 7 vs Bills", "Wild Card at Chiefs". */
const gameLine = (g: TeamGame, team: string) => `${weekName(g)} ${g.homeTeam === team ? 'vs' : 'at'} ${TEAM_BY_ABBR[opponentOf(g, team)]?.nickname ?? opponentOf(g, team)}`

function GameCard({ g, season, team, poster, reload }: { g: TeamGame; season: number; team: string; poster: PosterRef; reload: () => void }) {
  const r = gameOutcome(g, team)
  const { open, menu } = gameActions(g, season, team, reload)
  const opp = opponentOf(g, team)
  const hint =
    g.clipCount > 0
      ? `${g.gradedPlays} of ${g.playCount} plays graded`
      : played(g) && g.playCount > 0
        ? 'No film yet: open to import'
        : !played(g)
          ? 'Open the matchup'
          : 'No plays yet'
  return (
    <StillCard
      test="game-card"
      poster={g.clipCount > 0 ? poster : null}
      blank={<TeamLogo abbr={opp} size={40} />}
      progress={g.clipCount > 0 && g.playCount ? g.gradedPlays / g.playCount : undefined}
      title={hint}
      line1={
        r ? (
          <span className={`game-card__result num game-card__result--${r.letter}`}>
            {r.letter} {r.score}
          </span>
        ) : (
          <span className="game-card__next">Next · {gameDayLabel(g.gameday)}</span>
        )
      }
      line2={gameLine(g, team)}
      onOpen={open}
      onContextMenu={menu}
    />
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────

function Overview({ o, season, team, setSection, setFocusGroup, reload, units, posters }: ContentProps & { units: Record<PositionGroup, GradeTally> }) {
  const anyGrades = POSITION_GROUPS.some((g) => units[g].graded > 0)
  const s = o.summary
  const playedGames = o.games.filter(played)
  const next = o.games.find((g) => !played(g))
  const shelf = [...(next ? [next] : []), ...[...playedGames].reverse()]
  const top = o.roster
    .filter((p) => p.tally.graded >= 10)
    .sort((a, b) => (gradeScore(b.tally) ?? 0) - (gradeScore(a.tally) ?? 0) || b.tally.graded - a.tally.graded)
    .slice(0, 6)
  return (
    <>
      {shelf.length > 0 && (
        <Section title="Season" seeAll={() => setSection('games')} test="team-season">
          <Shelf minTile={200}>
            {shelf.map((g) => (
              <GameCard key={g.gameId} g={g} season={season} team={team} poster={posters.get(g.gameId) ?? null} reload={reload} />
            ))}
          </Shelf>
        </Section>
      )}

      <div className="team-two-col">
        <Section title="Unit grades" seeAll={() => setSection('units')}>
          {anyGrades ? (
            <UnitList
              o={o}
              units={units}
              onOpen={(g) => {
                setFocusGroup(g)
                setSection('roster')
              }}
            />
          ) : (
            <div className="team-empty-inline">
              <EmptyState small title="No unit grades yet" body={`Grade ${o.team.nickname} players in the tape room and their units are graded here.`} />
              <NoGradesAction o={o} team={team} />
            </div>
          )}
        </Section>

        {top.length > 0 && (
          <Section title="Top graded players" seeAll={() => setSection('roster')}>
            <div className="top-players" data-test="top-players">
              {top.map((p) => (
                <div
                  key={p.id}
                  className="top-player"
                  role="button"
                  tabIndex={0}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => navigate(links.player(season, p.id))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(links.player(season, p.id))
                    }
                  }}
                  onContextMenu={(e) => void showMenu(e, playerMenu(season, p))}
                  title={`${p.tally.graded} graded snaps · ${p.tally.plus} / ${p.tally.zero} / ${p.tally.minus}`}
                >
                  <Avatar url={p.headshot} name={p.name} size={32} team={p.team} />
                  <span className="top-player__text">
                    <span className="top-player__name ellipsis">{p.name}</span>
                    <span className="top-player__sub ellipsis">
                      {p.depthPos || p.position} · {plural(p.tally.graded, 'graded snap')}
                    </span>
                  </span>
                  <b className="top-player__grade num">{Math.round(gradeScore(p.tally) ?? 0)}</b>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      <Section title="All stats" className="team-all-stats">
        {s && s.games ? (
          <>
            <div className="league-ranks">
              <RankList title="Offense" stats={s.offense} />
              <RankList title="Defense" stats={s.defense} />
            </div>
            <div className="team-footnote">Regular season, ranked among 32 teams. 1st is best.</div>
          </>
        ) : (
          <div className="team-footnote">No regular-season games played yet.</div>
        )}
      </Section>
    </>
  )
}

function RankList({ title, stats }: { title: string; stats: TeamRankedStat[] }) {
  return (
    <div className="rank-list">
      <div className="rank-list__title">{title}</div>
      {stats.map((s) => (
        <div key={s.key} className="rank-list__row">
          <span className="rank-list__label">{s.label}</span>
          <span className="rank-list__value num">{formatStat(s.value, s.format).replace(/^-/, '−')}</span>
          <RankBadge rank={s.rank} neutral={s.neutral} title={`${ordinal(s.rank)} of 32`} />
        </div>
      ))}
    </div>
  )
}
// ── Games ────────────────────────────────────────────────────────────────────

function GamesTable({
  o,
  season,
  team,
  games,
  headless,
  reload,
  grouped
}: {
  o: TeamOverview
  summaries: TeamSummary[]
  season: number
  team: string
  games: TeamGame[]
  headless?: boolean
  reload: () => void
  grouped?: boolean
}) {
  const [sel, setSel] = useState<string | null>(null)
  const unitsByGame = new Map(o.unitsByGame.map((u) => [u.gameId, u]))
  const importFilm = (g: TeamGame) => gameActions(g, season, team, reload).importFilm()
  const act = (g: TeamGame) => gameActions(g, season, team, reload).open()
  const columns: Column<TeamGame>[] = [
    { id: 'wk', label: 'Wk', width: 48, render: (g) => <span className="t-callout c-label-3">{weekCode(g)}</span> },
    { id: 'date', label: 'Date', width: 96, render: (g) => <span className="t-callout c-label-2">{gameDayLabel(g.gameday)}</span> },
    {
      id: 'opp',
      label: 'Opponent',
      flex: 1,
      minWidth: 180,
      render: (g) => {
        const opp = opponentOf(g, team)
        return (
          <span className="game-opp">
            <TeamDot abbr={opp} size={8} />
            <a
              className="game-opp__label"
              onClick={(e) => {
                e.stopPropagation()
                navigate(links.team(season, opp))
              }}
            >
              {g.homeTeam === team ? 'vs' : '@'} {opp}
            </a>
            <span className="game-opp__name">{TEAM_BY_ABBR[opp]?.nickname ?? ''}</span>
          </span>
        )
      }
    },
    {
      id: 'result',
      label: 'Result',
      width: 88,
      render: (g) => {
        const r = gameOutcome(g, team)
        return r ? (
          <span className="game-result">
            <span className="game-result__letter">{r.letter}</span>
            <span className="num">{r.score}</span>
          </span>
        ) : (
          <span className="c-label-4">—</span>
        )
      }
    },
    {
      id: 'off',
      label: 'Off',
      width: 56,
      render: (g) => {
        const t = unitsByGame.get(g.gameId)?.units.OFF
        return t ? <SampleBadge score={gradeScore(t)} plays={t.graded} title={`Offense ${gradeScore(t)} · ${t.graded} graded snaps`} /> : <span className="c-label-4">—</span>
      }
    },
    {
      id: 'def',
      label: 'Def',
      width: 56,
      render: (g) => {
        const t = unitsByGame.get(g.gameId)?.units.DEF
        return t ? <SampleBadge score={gradeScore(t)} plays={t.graded} title={`Defense ${gradeScore(t)} · ${t.graded} graded snaps`} /> : <span className="c-label-4">—</span>
      }
    },
    {
      id: 'film',
      label: 'Film',
      width: 140,
      render: (g) =>
        g.clipCount > 0 ? (
          <span className="game-film">
            <ProgressBar value={g.playCount ? g.gradedPlays / g.playCount : 0} mini width={64} />
            <span className="num">
              {g.gradedPlays} of {g.playCount}
            </span>
          </span>
        ) : (
          <span className="c-label-4">—</span>
        )
    },
    {
      id: 'action',
      label: '',
      width: 112,
      align: 'right',
      render: (g) => {
        const opp = opponentOf(g, team)
        if (g.clipCount > 0) return <Button size="sm" icon="play" label="Watch" test="game-action" onClick={() => act(g)} />
        if (played(g) && g.playCount > 0) return <Button size="sm" variant="borderless" icon="folder-input" label="Import Film…" test="game-action" onClick={() => importFilm(g)} />
        if (played(g)) return <span className="t-subheadline c-label-3" data-test="game-action">No plays yet</span>
        return <Button size="sm" variant="borderless" icon="swords" label="Matchup" test="game-action" onClick={() => navigate(links.matchup(season, team, opp))} />
      }
    }
  ]
  return (
    <Table
      className={`team-games-table table--light${headless ? ' table--headless' : ''}`}
      density="tall"
      stripes={false}
      columns={columns}
      rows={games}
      rowKey={(g) => g.gameId}
      selection={sel}
      onSelect={setSel}
      onOpen={act}
      onContextMenu={(g, e) => gameActions(g, season, team, reload).menu(e)}
      groupBy={grouped ? (g) => (g.gameType === 'REG' ? 'Regular season' : 'Postseason') : undefined}
      rowTest="game-row"
      test={headless ? 'team-games-recent' : 'team-games'}
    />
  )
}

async function fixMatches(g: TeamGame, team: string) {
  const film = await api.gameFilm(g.gameId)
  openImport({ game: film.game, team, existing: film.clips.map((c) => ({ path: c.path, fileName: c.fileName, angle: c.angle, playId: c.playId })) })
}

async function revealFirstClip(gameId: string) {
  const film = await api.gameFilm(gameId)
  if (film.clips[0]) await api.revealClip(film.clips[0].path)
}

function GamesSection(props: ContentProps) {
  const { o } = props
  const playedGames = o.games.filter(played)
  const withFilm = o.games.filter((g) => g.clipCount > 0)
  const plays = withFilm.reduce((n, g) => n + g.playCount, 0)
  const graded = withFilm.reduce((n, g) => n + g.gradedPlays, 0)
  const post = o.games.some((g) => g.gameType !== 'REG')
  if (!o.games.length) return <EmptyState icon="calendar" title="No games yet" body={`The ${props.season} schedule isn’t in the data yet.`} />
  const groups = post ? (['Regular season', 'Postseason'] as const) : (['Regular season'] as const)
  return (
    <>
      {groups.map((label) => {
        const list = o.games.filter((g) => (label === 'Postseason' ? g.gameType !== 'REG' : !post || g.gameType === 'REG'))
        if (!list.length) return null
        return (
          <Section key={label} title={post ? label : 'Season'} test={label === 'Postseason' ? 'team-postseason' : 'team-game-cards'}>
            <div className="game-grid">
              {list.map((g) => (
                <GameCard key={g.gameId} g={g} season={props.season} team={props.team} poster={props.posters.get(g.gameId) ?? null} reload={props.reload} />
              ))}
            </div>
          </Section>
        )
      })}
      <Section title="All games" className="team-all-stats">
        <GamesTable {...props} games={o.games} grouped={post} />
        <div className="team-footnote">
          {withFilm.length} of {playedGames.length || o.games.length} games have film · {graded.toLocaleString()} of {plays.toLocaleString()} plays graded
        </div>
      </Section>
    </>
  )
}

// ── Roster ───────────────────────────────────────────────────────────────────

type RosterFilter = 'all' | 'offense' | 'defense' | 'special'

function Roster({ o, season, team, q, focusGroup, setFocusGroup }: ContentProps) {
  const route = links.team(season, team)
  const [filter, setFilter] = useRouteState<RosterFilter>(route, 'rosterFilter', 'all')
  const [gradedOnly, setGradedOnly] = useRouteState<boolean>(route, 'gradedOnly', false)
  const [showInactive, setShowInactive] = useRouteState<boolean>(route, 'showInactive', false)
  const [sort, setSort] = useRouteState<SortState>(route, 'rosterSort', { column: 'snaps', dir: 'desc' })
  const h = useHistory()
  const [sel, setSel] = useState<string | null>(h.entries[h.index]?.selection ?? null)
  const needle = q.trim().toLowerCase().replace(/^#/, '')
  const inFilter = (p: TeamRosterRow) =>
    filter === 'all' ? true : filter === 'offense' ? OFFENSE_GROUPS.includes(p.group) : filter === 'defense' ? DEFENSE_GROUPS.includes(p.group) : p.group === 'ST'
  const active = (p: TeamRosterRow) => p.snaps > 0 || p.tally.graded > 0 || p.status === 'ACT'
  const matches = (p: TeamRosterRow) => !needle || p.name.toLowerCase().includes(needle) || p.jersey === needle || (p.depthPos || p.position).toLowerCase() === needle
  const base = o.roster.filter((p) => inFilter(p) && matches(p) && (!gradedOnly || p.tally.graded > 0))
  const hidden = base.filter((p) => !active(p)).length
  const latest = latestFilm(o.games)

  const value = (p: TeamRosterRow): number | string => {
    switch (sort.column) {
      case 'jersey':
        return Number(p.jersey) || 0
      case 'name':
        return p.name
      case 'pos':
        return p.depthPos || p.position
      case 'graded':
        return p.tally.graded
      case 'plus':
        return p.tally.graded ? plusRate(p.tally) : -1
      case 'epa':
        return o.rosterEpa[p.id] ?? -99
      case 'grade':
        return p.tally.graded ? (gradeScore(p.tally) ?? -1) : -1
      default:
        return p.snaps
    }
  }
  const rows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return base
      .filter((p) => showInactive || active(p) || !!needle)
      .sort((a, b) => {
        const g = POSITION_GROUPS.indexOf(a.group) - POSITION_GROUPS.indexOf(b.group)
        if (g) return g
        const va = value(a)
        const vb = value(b)
        const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
        return c * dir || b.snaps - a.snaps || a.name.localeCompare(b.name)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.roster, filter, gradedOnly, showInactive, needle, sort])

  useEffect(() => {
    if (!focusGroup) return
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-group="${focusGroup}"]`)
      const content = document.getElementById('content')
      if (el && content) content.scrollTop += el.getBoundingClientRect().top - content.getBoundingClientRect().top - 60
      setFocusGroup(null)
    })
  }, [focusGroup, setFocusGroup])

  const focusGame = (p: TeamRosterRow) => {
    const own = [...o.games].reverse().find((g) => g.clipCount > 0 && (o.rosterTrend[p.id] ?? []).some((x) => x.gameId === g.gameId))
    return own ?? latest
  }

  const columns: Column<TeamRosterRow>[] = [
    { id: 'jersey', label: '#', width: 40, numeric: true, sortable: true, render: (p) => <span className="c-label-3 t-callout">{p.jersey}</span> },
    {
      id: 'name',
      label: 'Player',
      flex: 1,
      minWidth: 220,
      sortable: true,
      render: (p) => {
        const others = p.teams.filter((x) => x !== team)
        const latestTeam = p.teams[p.teams.length - 1]
        const badge = others.length ? (latestTeam !== team ? `NOW ${latestTeam}` : `FROM ${others[0]}`) : null
        return (
          <span className="roster-player">
            <Avatar url={p.headshot} name={p.name} size={32} team={p.team} />
            <a
              className="roster-player__name"
              onClick={(e) => {
                e.stopPropagation()
                navigate(links.player(season, p.id))
              }}
            >
              {p.name}
            </a>
            {badge && <TextBadge title={`Also played for ${others.join(', ')} this season`}>{badge}</TextBadge>}
          </span>
        )
      }
    },
    { id: 'pos', label: 'Pos', width: 48, sortable: true, render: (p) => <span className="t-callout c-label-2">{p.depthPos || p.position}</span> },
    { id: 'snaps', label: 'Snaps', width: 64, numeric: true, sortable: true, render: (p) => p.snaps || <span className="c-label-4">—</span> },
    { id: 'graded', label: 'Graded', width: 64, numeric: true, sortable: true, render: (p) => p.tally.graded || <span className="c-label-4">—</span> },
    {
      id: 'tally',
      label: '+ / 0 / −',
      width: 88,
      render: (p) => (
        <span title={p.tally.graded ? `${p.tally.plus} plus · ${p.tally.zero} zero · ${p.tally.minus} minus` : undefined}>
          <TallyBar tally={p.tally} width={72} />
        </span>
      )
    },
    { id: 'plus', label: '+%', width: 56, numeric: true, sortable: true, render: (p) => (p.tally.graded ? formatPct(plusRate(p.tally)) : <span className="c-label-4">—</span>) },
    { id: 'epa', label: 'EPA', width: 64, numeric: true, sortable: true, render: (p) => (o.rosterEpa[p.id] == null ? <span className="c-label-4">—</span> : formatEpa(o.rosterEpa[p.id])) },
    { id: 'grade', label: 'Grade', width: 56, align: 'right', sortable: true, render: (p) => <SampleBadge score={gradeScore(p.tally)} plays={p.tally.graded} /> },
    { id: 'trend', label: 'Trend', width: 76, render: (p) => ((o.rosterTrend[p.id] ?? []).length ? <Sparkline values={(o.rosterTrend[p.id] ?? []).map((x) => x.grade)} /> : null) },
    {
      id: 'focus',
      label: '',
      width: 28,
      render: (p) => {
        const g = focusGame(p)
        return g ? (
          <span className="roster-focus">
            <Button variant="borderless" size="sm" iconOnly icon="scan-eye" label="Grade in Player Focus" onClick={() => navigate(links.tape(g.gameId, team, { player: p.id, focus: true }))} />
          </span>
        ) : null
      }
    }
  ]
  return (
    <div data-test="team-roster">
      <div className="roster-controls">
        <Segmented
          value={filter}
          onChange={setFilter}
          label="Players"
          options={[
            { value: 'all', label: 'All', test: 'roster-filter-all' },
            { value: 'offense', label: 'Offense', test: 'roster-filter-offense' },
            { value: 'defense', label: 'Defense', test: 'roster-filter-defense' },
            { value: 'special', label: 'Special Teams', test: 'roster-filter-special' }
          ]}
        />
        <ToggleSegments<'graded'>
          values={gradedOnly ? ['graded'] : []}
          onChange={(v) => setGradedOnly(v.includes('graded'))}
          label="Graded only"
          options={[{ value: 'graded', label: 'Graded Only', test: 'roster-filter-graded' }]}
        />
        <span className="roster-controls__count">
          {rows.length} {rows.length === 1 ? 'player' : 'players'}
        </span>
      </div>
      {!o.roster.length ? (
        <EmptyState small title="No players listed" body={`nflverse has no roster for this team in ${season} yet.`} />
      ) : !rows.length ? (
        <EmptyState small title={needle ? `No Results for “${q.trim()}”` : 'No players match'} body={needle ? 'Check the spelling or try a jersey number or position.' : 'Try another filter.'} />
      ) : (
        <Table
          className="roster-table table--light"
          density="tall"
          stripes={false}
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          sort={sort}
          onSort={setSort}
          selection={sel}
          onSelect={(k) => {
            setSel(k)
            setEntrySelection(k)
          }}
          onOpen={(p) => navigate(links.player(season, p.id))}
          onContextMenu={(p, e) => void showMenu(e, playerMenu(season, p))}
          groupBy={(p) => p.group}
          groupLabel={(g, list) => (
            <span data-group={g}>
              {ROSTER_GROUP[g as PositionGroup]} <span className="c-label-3">{list.length}</span>
            </span>
          )}
          rowTest="roster-row"
          typeSelect={(p) => p.name}
        />
      )}
      {hidden > 0 && !needle && (
        <div className="team-footnote">
          {hidden} inactive {hidden === 1 ? 'player' : 'players'} {showInactive ? 'shown' : 'hidden'}
          <Button variant="borderless" size="sm" label={showInactive ? 'Hide' : 'Show'} onClick={() => setShowInactive(!showInactive)} />
        </div>
      )}
    </div>
  )
}

// ── Units ────────────────────────────────────────────────────────────────────

const HEAT_ROWS: { key: UnitKey; label: string; total?: boolean }[] = [
  { key: 'OFF', label: 'Offense', total: true },
  { key: 'QB', label: 'Quarterbacks' },
  { key: 'RB', label: 'Running backs' },
  { key: 'WR', label: 'Wide receivers' },
  { key: 'TE', label: 'Tight ends' },
  { key: 'OL', label: 'Offensive line' },
  { key: 'DEF', label: 'Defense', total: true },
  { key: 'DL', label: 'Defensive line' },
  { key: 'LB', label: 'Linebackers' },
  { key: 'DB', label: 'Defensive backs' },
  { key: 'ST', label: 'Special teams' }
]

const lineGame = (u: UnitGameLine, team: string) => ({
  gameId: u.gameId,
  season: 0,
  week: u.week,
  gameType: u.gameType,
  gameday: '',
  homeTeam: u.home ? team : u.opponent,
  awayTeam: u.home ? u.opponent : team,
  homeScore: null,
  awayScore: null
})

function Units({ o, summaries, season, team, units }: ContentProps & { units: Record<PositionGroup, GradeTally> }) {
  const anyGrades = o.unitsByGame.length > 0 || POSITION_GROUPS.some((g) => units[g].graded > 0)
  if (!anyGrades) {
    const film = latestFilm(o.games)
    const game = latestPlayed(o.games)
    return (
      <div data-test="team-units">
        <EmptyState
          icon="chart-column"
          title={`No grades for the ${o.team.nickname} yet`}
          body="Grade players in the tape room to see how each unit plays, game by game."
          primary={
            film
              ? { label: 'Watch Latest Film', run: () => navigate(links.tape(film.gameId, team)) }
              : game
                ? { label: 'Import Film…', run: () => openImport({ game, team, onImported: () => navigate(links.tape(game.gameId, team)) }) }
                : undefined
          }
        />
      </div>
    )
  }
  const columns: HeatColumn[] = o.unitsByGame.map((u) => ({
    key: u.gameId,
    top: weekShort(u),
    bottom: u.opponent,
    title: `${u.home ? 'vs' : '@'} ${u.opponent}, ${u.gameType === 'REG' ? `Week ${u.week}` : weekShort(u)}`
  }))
  const rows: HeatRow[] = HEAT_ROWS.map((r) => {
    const cells: Record<string, GradeTally | undefined> = {}
    let season = emptyTally()
    for (const u of o.unitsByGame) {
      const t = u.units[r.key]
      cells[u.gameId] = t
      if (t) season = mergeTally(season, t)
    }
    return { key: r.key, label: r.label, total: r.total, cells, season }
  })
  const byTeam = new Map(summaries.map((s) => [s.team, s]))
  const oppGames = (side: 'OFF' | 'DEF'): OpponentGame[] =>
    o.unitsByGame
      .filter((u) => u.units[side]?.graded)
      .map((u) => {
        const opp = byTeam.get(u.opponent)
        const r = epaRank(opp, side === 'OFF' ? 'defense' : 'offense')
        const tally = u.units[side]!
        const g = lineGame(u, team)
        const unit = side === 'OFF' ? 'defense' : 'offense'
        return {
          key: u.gameId,
          rank: r?.rank ?? null,
          tally,
          score: gradeScore(tally),
          opp: u.opponent,
          title: `${u.gameType === 'REG' ? `Week ${u.week}` : weekShort(u)} ${u.home ? 'vs' : '@'} ${u.opponent}`,
          rowLabel: gameLabel(g, team),
          rankLine: r ? `${u.opponent} ${unit}: ${ordinal(r.rank)}` : `${u.opponent} ${unit}: not ranked`,
          rankShort: r ? `${ordinal(r.rank)} ${unit}` : ''
        }
      })
  const off = oppGames('OFF')
  const def = oppGames('DEF')
  return (
    <div data-test="team-units">
      <Section title="Unit grades">
        <UnitList o={o} units={units} detailed />
      </Section>
      {columns.length > 0 && (
        <Section title="Grades by game">
          <UnitHeatGrid rows={rows} columns={columns} test="units-grid" onCellClick={(_, gameId) => navigate(links.tape(gameId, team))} />
          <div className="team-footnote">Grades from fewer than 5 plays are grey.</div>
        </Section>
      )}
      {(off.length > 0 || def.length > 0) && (
        <Section title="Against opponent strength">
          <div className="opp-strength">
            <OppColumn title="Offense vs opponent defenses" games={off} test="units-opp-offense" />
            <OppColumn title="Defense vs opponent offenses" games={def} test="units-opp-defense" />
          </div>
          <div className="team-footnote">Opponent ranks use the {season} regular season. 1st is the best unit.</div>
        </Section>
      )}
    </div>
  )
}

function OppColumn({ title, games, test }: { title: string; games: OpponentGame[]; test: string }) {
  const tiers = tierSummaries(games)
  return (
    <div className="opp-col">
      <div className="opp-col__title">{title}</div>
      {games.length ? <OpponentScatter games={games} height={220} test={test} /> : <EmptyState small title="No grades yet" />}
      <div className="opp-tiers">
        {tiers.map((t) => (
          <div key={t.tier} className="opp-tier">
            <span className="opp-tier__label">{t.label}</span>
            <span className="opp-tier__detail">
              {t.games} {t.games === 1 ? 'game' : 'games'} · {t.tally.graded} {t.tally.graded === 1 ? 'play' : 'plays'}
            </span>
            <SampleBadge score={t.score} plays={t.tally.graded} />
          </div>
        ))}
      </div>
    </div>
  )
}
