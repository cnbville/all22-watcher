import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gradeScore } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { GameInfo, MatchupData, MatchupSide, SearchIndex, TeamGame } from '@shared/types'
import { api } from '../../api'
import { recordLabel, weekCode } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { Button } from '../../ui/Button'
import { GradeBadge } from '../../ui/Grade'
import { Icon } from '../../ui/Icon'
import type { MenuItemSpec } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { PopupButton } from '../../ui/PopupButton'
import { ProgressBar } from '../../ui/Progress'
import { TeamBadge, TeamLogo } from '../../ui/TeamChip'
import { useCommand } from '../../shell/commands'
import { gameMenu, playerMenu, showMenu, teamMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { openImport } from '../../shell/importRequest'
import { links, navigate } from '../../shell/router'
import { LargeTitle, Loading, LoadError, Screen, Section, useScrollRestore } from '../../shell/Screen'
import { TeamPicker } from '../../shell/Sidebar'
import { useMyTeams } from '../../shell/store'
import { persist } from '../../shell/uiState'
import { Toolbar } from '../../shell/Toolbar'
import { readLocal, useLoaded, VersusRow, writeLocal } from '../shared'
import { SeasonGate } from '../shared/SeasonGate'
import {
  better,
  centerLines,
  dayLabel,
  defaultWeek,
  GRADE_ROWS,
  gradeSide,
  hasGradedUnit,
  type IndexGame,
  keyMeeting,
  matchupSubtitle,
  orient,
  played,
  playersToWatch,
  pushRecent,
  RANK_ROWS,
  rankSide,
  type RecentMatchup,
  resultLine,
  statLeaders,
  todayIso,
  unitTally,
  weekGames,
  weekName,
  weeksOf
} from './matchupModel'
import './matchups.css'

const RECENT_KEY = 'ui.matchups.recent'
const readRecent = () => readLocal<RecentMatchup[]>(RECENT_KEY, []).filter((r) => TEAM_BY_ABBR[r.left] && TEAM_BY_ABBR[r.right])
const nick = (abbr: string) => TEAM_BY_ABBR[abbr]?.nickname ?? abbr

/** Opens a matchup: remembers it for the sidebar (`ui.matchup.last`, "PHI|DAL") and the Recent list. */
function openMatchup(season: number, left: string, right: string, replace = true) {
  persist('ui.matchup.last', `${left}|${right}`)
  writeLocal(RECENT_KEY, pushRecent(readRecent(), { left, right, season }))
  navigate(links.matchup(season, left, right), { replace })
}

const toGameInfo = (g: IndexGame): GameInfo => ({
  gameId: g.gameId,
  season: g.season,
  week: g.week,
  gameType: g.gameType,
  gameday: g.gameday,
  homeTeam: g.homeTeam,
  awayTeam: g.awayTeam,
  homeScore: null,
  awayScore: null
})

/** Matchups (03 §8): the two-team picker, or one matchup. */
export function Matchups({ season, team, opp }: { season: number; team?: string; opp?: string }) {
  const valid = (a?: string) => !!a && !!TEAM_BY_ABBR[a]
  if (valid(team) && valid(opp) && team !== opp) return <MatchupPage key={`${team}|${opp}`} season={season} left={team!} right={opp!} />
  return <Picker key={team ?? ''} season={season} initialLeft={valid(team) ? team : undefined} />
}

// ── Picker ─────────────────────────────────────────────────────────────────

function Picker({ season, initialLeft }: { season: number; initialLeft?: string }) {
  const [left, setLeft] = useState<string | undefined>(initialLeft)
  const [right, setRight] = useState<string | undefined>()
  const index = useSeasonIndex(season)
  useEffect(() => {
    if (left && right) openMatchup(season, left, right)
  }, [left, right, season])
  return (
    <Screen name="matchup">
      <Toolbar title="Matchups" subtitle="Choose two teams" windowTitle="Matchups" collapsesLargeTitle />
      <SeasonGate season={season}>
        <LargeTitle>Matchups</LargeTitle>
        <div className="matchup-picker">
          <Well side="left" team={left} other={right} index={index.data} onPick={setLeft} />
          <span className="matchup-picker__vs">vs</span>
          <Well side="right" team={right} other={left} index={index.data} onPick={setRight} />
        </div>
        <PickerLists season={season} index={index} />
      </SeasonGate>
    </Screen>
  )
}

function Well({ side, team, other, index, onPick }: { side: 'left' | 'right'; team?: string; other?: string; index: SearchIndex | null; onPick: (t: string | undefined) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const t = team ? TEAM_BY_ABBR[team] : undefined
  const rec = team ? index?.teams.find((x) => x.abbr === team) : undefined
  return (
    <>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        className="matchup-well"
        data-filled={t ? true : undefined}
        data-test={`matchup-pick-${side}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {t ? (
          <>
            <TeamBadge abbr={t.abbr} size={56} />
            <div className="matchup-well__text">
              <div className="matchup-well__name">{t.name}</div>
              <div className="matchup-well__sub">{[rec ? recordLabel(rec.wins, rec.losses, rec.ties) : '', t.division].filter(Boolean).join(' · ')}</div>
            </div>
            <button
              type="button"
              className="matchup-well__clear"
              aria-label="Clear"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                onPick(undefined)
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </>
        ) : (
          <div className="matchup-well__empty">
            <Icon name="shield" size={32} />
            <span>Choose team</span>
          </div>
        )}
      </div>
      <Popover anchor={ref} open={open} onClose={close} width={300} padding="list" test="matchup-team-picker">
        <TeamPicker
          exclude={other ? [other] : []}
          onPick={(a) => {
            setOpen(false)
            onPick(a)
          }}
        />
      </Popover>
    </>
  )
}

function useSeasonIndex(season: number) {
  const loaded = useLoaded(() => api.searchIndex(season), [season])
  useDataEvent(['season', 'film', 'grades'], loaded.reload)
  return loaded
}

function PickerLists({ season, index }: { season: number; index: ReturnType<typeof useSeasonIndex> }) {
  const myTeams = useMyTeams()
  const games = useMemo(() => (index.data?.games ?? []).filter((g) => g.season === season), [index.data, season])
  const weeks = weeksOf(games)
  const [week, setWeek] = useState<number | null>(null)
  const shownWeek = week ?? defaultWeek(games, todayIso())
  const list = shownWeek === null ? [] : weekGames(games, shownWeek, myTeams)
  const recent = readRecent()
  const rec = (abbr: string) => {
    const r = index.data?.teams.find((t) => t.abbr === abbr)
    return r ? recordLabel(r.wins, r.losses, r.ties) : ''
  }
  useScrollRestore(index.data !== null)
  if (index.error && !index.data) return <LoadError what="the schedule" error={index.error} retry={index.reload} />
  if (!index.data) return <Loading />
  const sample = list[0]
  return (
    <>
      {shownWeek !== null && (
        <Section
          title={sample ? `${weekName(sample)} games` : `Week ${shownWeek} games`}
          className="matchup-section"
          trailing={
            <PopupButton<string>
              size="sm"
              value={String(shownWeek)}
              label={sample ? weekName(sample) : `Week ${shownWeek}`}
              options={weeks.map((w) => {
                const g = games.find((x) => x.week === w)!
                return { value: String(w), label: weekName(g) }
              })}
              onChange={(v) => setWeek(Number(v))}
              test="matchup-week"
            />
          }
        >
          <div className="matchup-list" data-test="matchup-week-games">
            {list.map((g) => {
              const [l, r] = orient(g, myTeams)
              return (
                <button key={g.gameId} type="button" className="matchup-list__row" data-test="matchup-game" onClick={() => openMatchup(season, l, r, false)}>
                  <span className="matchup-list__teams">
                    <TeamLogo abbr={g.awayTeam} size={20} />
                    <span>
                      {g.awayTeam} @ {g.homeTeam}
                    </span>
                    <TeamLogo abbr={g.homeTeam} size={20} />
                  </span>
                  <span className="matchup-list__date">{dayLabel(g.gameday)}</span>
                  <span className="matchup-list__records num">
                    {rec(g.awayTeam)} · {rec(g.homeTeam)}
                  </span>
                  <Icon name="chevron-right" size={12} className="matchup-list__chevron" />
                </button>
              )
            })}
          </div>
        </Section>
      )}
      {recent.length > 0 && (
        <Section title="Recent" className="matchup-section">
          <div className="matchup-list" data-test="matchup-recent">
            {recent.map((m) => (
              <button key={`${m.left}|${m.right}|${m.season}`} type="button" className="matchup-list__row" onClick={() => openMatchup(m.season, m.left, m.right, false)}>
                <span className="matchup-list__teams">
                  <TeamLogo abbr={m.left} size={20} />
                  <span>
                    {m.left} vs {m.right}
                  </span>
                  <TeamLogo abbr={m.right} size={20} />
                </span>
                <span className="matchup-list__date">{m.season}</span>
                <span />
                <Icon name="chevron-right" size={12} className="matchup-list__chevron" />
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// ── Matchup ────────────────────────────────────────────────────────────────

function MatchupPage({ season, left, right }: { season: number; left: string; right: string }) {
  const data = useLoaded(() => api.matchup(season, left, right), [season, left, right])
  const index = useSeasonIndex(season)
  useDataEvent(['grades', 'film', 'season'], data.reload)
  useEffect(() => {
    persist('ui.matchup.last', `${left}|${right}`)
    writeLocal(RECENT_KEY, pushRecent(readRecent(), { left, right, season }))
  }, [left, right, season])
  const swap = () => openMatchup(season, right, left)
  useCommand('view.swapTeams', swap)
  const titleMenu = (): MenuItemSpec[] => {
    const recent = readRecent().filter((r) => !(r.left === left && r.right === right && r.season === season))
    return [
      { label: 'Choose Teams…', run: () => navigate(links.matchup(season, left)) },
      ...(recent.length
        ? ([{ kind: 'separator' }, { kind: 'header', label: 'Recent' }, ...recent.map((r) => ({ label: `${r.left} vs ${r.right}${r.season !== season ? ` · ${r.season}` : ''}`, run: () => openMatchup(r.season, r.left, r.right, false) }))] as MenuItemSpec[])
        : [])
    ]
  }
  const m = data.data
  return (
    <Screen name="matchup">
      <Toolbar
        title={`${left} vs ${right}`}
        subtitle={m ? matchupSubtitle(m) : String(season)}
        windowTitle={`${left} vs ${right} — Matchup`}
        titleMenu={titleMenu}
        busy={data.busy}
        trailing={[{ kind: 'button', command: 'view.swapTeams', icon: 'arrow-left-right', label: 'Swap Teams', test: 'matchup-swap' }]}
      />
      <SeasonGate season={season}>
        {data.error && !m ? (
          <LoadError what="the matchup" error={data.error} retry={data.reload} />
        ) : !m ? (
          <Loading />
        ) : (
          <MatchupBody m={m} season={season} index={index.data} />
        )}
      </SeasonGate>
    </Screen>
  )
}

function MatchupBody({ m, season, index }: { m: MatchupData; season: number; index: SearchIndex | null }) {
  useScrollRestore(true)
  const today = todayIso()
  const latestPlayed = (abbr: string) =>
    (index?.games ?? [])
      .filter((g) => g.season === season && (g.homeTeam === abbr || g.awayTeam === abbr) && g.gameday < today)
      .sort((a, b) => b.gameday.localeCompare(a.gameday))[0]
  const filmAction = (side: MatchupSide) => {
    const film = side.film.withFilm[0]
    if (film) return { label: 'Watch Latest Film', run: () => navigate(links.tape(film.gameId, side.team.abbr)) }
    const g = latestPlayed(side.team.abbr)
    if (g) return { label: 'Import Film…', run: () => openImport({ game: toGameInfo(g), team: side.team.abbr }) }
    return null
  }
  return (
    <>
      <Header m={m} season={season} />
      <Possession m={m} season={season} offense="left" filmAction={filmAction} />
      <Possession m={m} season={season} offense="right" filmAction={filmAction} />
      <FilmBlock m={m} season={season} latestPlayed={latestPlayed} />
    </>
  )
}

function Header({ m, season }: { m: MatchupData; season: number }) {
  const center = centerLines(m)
  const k = keyMeeting(m)
  const leftAbbr = m.left.team.abbr
  return (
    <div className="matchup-header" data-test="matchup-header">
      <HeaderTeam side={m.left} season={season} dir="left" other={m.right.team.abbr} />
      <div className="matchup-header__center">
        {center ? (
          <>
            <div className="matchup-header__line1">{center[0]}</div>
            <div className="matchup-header__line2">{center[1]}</div>
          </>
        ) : (
          <div className="matchup-header__line2">No game in {season}</div>
        )}
        {k && !k.next && k.clipCount > 0 && (
          <Button size="sm" icon="play" label="Watch Last Meeting" onClick={() => navigate(links.tape(k.game.gameId, leftAbbr))} test="matchup-watch-last" />
        )}
        {k && !k.next && k.clipCount === 0 && played(k.game) && (
          <Button size="sm" variant="borderless" label="Import Film…" onClick={() => openImport({ game: k.game, team: leftAbbr })} test="matchup-import-last" />
        )}
      </div>
      <HeaderTeam side={m.right} season={season} dir="right" other={leftAbbr} />
    </div>
  )
}

function HeaderTeam({ side, season, dir, other }: { side: MatchupSide; season: number; dir: 'left' | 'right'; other: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const t = side.team
  const s = side.summary
  return (
    <div className={`matchup-header__team matchup-header__team--${dir}`}>
      <button
        ref={ref}
        type="button"
        className="matchup-header__pick"
        data-test={`matchup-team-${dir}`}
        title="Change Team"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => void showMenu(e, teamMenu(season, t.abbr))}
      >
        <TeamBadge abbr={t.abbr} size={64} />
        <span className="matchup-header__names">
          <span className="matchup-header__name">{t.name}</span>
          <span className="matchup-header__sub">{[s ? recordLabel(s.wins, s.losses, s.ties) : '', t.division].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      <Popover anchor={ref} open={open} onClose={close} width={300} padding="list" test="matchup-team-picker">
        <TeamPicker
          exclude={[other]}
          onPick={(a) => {
            setOpen(false)
            if (dir === 'left') openMatchup(season, a, other)
            else openMatchup(season, other, a)
          }}
        />
      </Popover>
    </div>
  )
}

function Possession({
  m,
  season,
  offense,
  filmAction
}: {
  m: MatchupData
  season: number
  offense: 'left' | 'right'
  filmAction: (side: MatchupSide) => { label: string; run: () => void } | null
}) {
  const off = offense === 'left' ? m.left : m.right
  const L = m.left
  const R = m.right
  // The left team always stays on the left: its offense when it has the ball, its defense otherwise.
  const leftUnit = offense === 'left' ? 'offense' : 'defense'
  const rightUnit = offense === 'left' ? 'defense' : 'offense'
  const gradeRows = GRADE_ROWS.map((row) => {
    const lt = unitTally(L.units, leftUnit === 'offense' ? row.off : row.def)
    const rt = unitTally(R.units, rightUnit === 'offense' ? row.off : row.def)
    const missing = [!lt.graded ? nick(L.team.abbr) : '', !rt.graded ? nick(R.team.abbr) : ''].filter(Boolean)
    const sub = leftUnit === 'offense' ? row.sub : row.sub.split(' · ').reverse().join(' · ')
    return { row, lt, rt, sub: missing.length ? `${sub} · Not graded` : sub, label: row.label }
  })
  const ungraded = [L, R].filter((s, i) => !hasGradedUnit(s.players, (i === 0 ? leftUnit : rightUnit) as 'offense' | 'defense'))
  return (
    <Section title={`When the ${nick(off.team.abbr)} have the ball`} className="matchup-section" test={`matchup-possession-${offense}`}>
      <div className="matchup-sub">League ranks</div>
      <div className="matchup-versus">
        {RANK_ROWS.map((r) => {
          const l = rankSide(L.summary, leftUnit, r.key)
          const rr = rankSide(R.summary, rightUnit, r.key)
          return <VersusRow key={r.key} label={r.label} left={l} right={rr} better={better(l.score, rr.score)} test="matchup-rank-row" />
        })}
      </div>
      <div className="matchup-sub matchup-sub--spaced">Your grades</div>
      <div className="matchup-versus">
        {gradeRows.map(({ row, lt, rt, sub }) => {
          const l = gradeSide(lt)
          const r = gradeSide(rt)
          return <VersusRow key={row.label} label={row.label} sublabel={sub} left={l} right={r} better={better(gradeScore(lt), gradeScore(rt))} test="matchup-grade-row" />
        })}
      </div>
      {ungraded.map((s) => {
        const act = filmAction(s)
        return (
          <div key={s.team.abbr} className="matchup-note">
            <Icon name="info" size={14} />
            <span>No {nick(s.team.abbr)} grades yet.</span>
            {act && <Button variant="borderless" size="sm" label={act.label} onClick={act.run} />}
          </div>
        )
      })}
      <div className="matchup-sub matchup-sub--spaced">Players to watch</div>
      <div className="matchup-players">
        <WatchList side={L} unit={leftUnit} season={season} />
        <WatchList side={R} unit={rightUnit} season={season} />
      </div>
    </Section>
  )
}

function WatchList({ side, unit, season }: { side: MatchupSide; unit: 'offense' | 'defense'; season: number }) {
  const { strengths, weak } = playersToWatch(side.players, unit)
  const title = `${nick(side.team.abbr)} ${unit === 'offense' ? 'offense' : 'defense'}`
  if (!strengths.length && !weak.length) {
    const leaders = statLeaders(side, unit)
    return (
      <div className="matchup-watch">
        <div className="matchup-watch__title">{title}</div>
        <div className="matchup-watch__label">Stat leaders</div>
        {leaders.length ? (
          leaders.map((l) => (
            <PlayerRow key={`${l.key}:${l.player.id}`} season={season} player={l.player} meta={l.player.depthPos || l.player.position} trailing={<span className="matchup-watch__stat num">{l.text}</span>} />
          ))
        ) : (
          <div className="matchup-watch__none">No stats yet.</div>
        )}
      </div>
    )
  }
  return (
    <div className="matchup-watch">
      <div className="matchup-watch__title">{title}</div>
      {strengths.map((p) => (
        <PlayerRow key={p.player.id} season={season} player={p.player} meta={p.player.depthPos || p.player.position} snaps={p.tally.graded} trailing={<GradeBadge score={p.grade} />} />
      ))}
      {!strengths.length && <div className="matchup-watch__none">No one grades 60 or better yet.</div>}
      {weak.length > 0 && (
        <>
          <div className="matchup-watch__label">Weak spots</div>
          {weak.map((p) => (
            <PlayerRow key={p.player.id} season={season} player={p.player} meta={p.player.depthPos || p.player.position} snaps={p.tally.graded} trailing={<GradeBadge score={p.grade} />} />
          ))}
        </>
      )}
    </div>
  )
}

function PlayerRow({ season, player, meta, snaps, trailing }: { season: number; player: MatchupSide['players'][number]['player']; meta: string; snaps?: number; trailing: React.ReactNode }) {
  return (
    <div className="matchup-player" data-test="key-player" onContextMenu={(e) => void showMenu(e, playerMenu(season, player))} onDoubleClick={() => navigate(links.player(season, player.id))}>
      <Avatar url={player.headshot} name={player.name} size={24} team={player.team} />
      <a className="matchup-player__name" onClick={() => navigate(links.player(season, player.id))}>
        {player.name}
      </a>
      <span className="matchup-player__pos">{meta}</span>
      {snaps !== undefined && <span className="matchup-player__snaps num">{snaps} snaps</span>}
      <span className="matchup-player__trailing">{trailing}</span>
    </div>
  )
}

function FilmBlock({ m, season, latestPlayed }: { m: MatchupData; season: number; latestPlayed: (abbr: string) => IndexGame | undefined }) {
  return (
    <Section title="Film" className="matchup-section" test="matchup-film">
      <div className="matchup-players">
        <FilmColumn side={m.left} season={season} latestPlayed={latestPlayed} />
        <FilmColumn side={m.right} season={season} latestPlayed={latestPlayed} />
      </div>
      <div className="matchup-sub matchup-sub--spaced">Previous meetings</div>
      {m.meetings.filter((x) => played(x.game)).length === 0 ? (
        <div className="matchup-watch__none">These teams haven’t met in your downloaded seasons.</div>
      ) : (
        <div className="matchup-list" data-test="matchup-meetings">
          {m.meetings
            .filter((x) => played(x.game))
            .map((x) => {
              const g = x.game
              const team = x.studiedTeam ?? m.left.team.abbr
              const importFilm = () => openImport({ game: g, team })
              return (
                <div
                  key={g.gameId}
                  className="matchup-meeting"
                  data-test="matchup-meeting"
                  onContextMenu={(e) => void showMenu(e, gameMenu(g, team, { hasFilm: x.clipCount > 0, importFilm }))}
                  onDoubleClick={() => (x.clipCount > 0 ? navigate(links.tape(g.gameId, team)) : undefined)}
                >
                  <span className="matchup-meeting__when">
                    {g.season} · {weekName(g)}
                  </span>
                  <span className="matchup-list__teams">
                    <TeamLogo abbr={g.awayTeam} size={20} />
                    <span>
                      {g.awayTeam} @ {g.homeTeam}
                    </span>
                  </span>
                  <span className="matchup-meeting__result num">{resultLine(g)}</span>
                  <span className="matchup-meeting__film">{x.clipCount > 0 ? `Film · ${x.gradedPlays} graded` : 'No film'}</span>
                  <span className="matchup-meeting__action">
                    {x.clipCount > 0 ? (
                      <Button size="sm" icon="play" label="Watch" onClick={() => navigate(links.tape(g.gameId, team))} />
                    ) : (
                      <Button size="sm" variant="borderless" label="Import Film…" onClick={importFilm} />
                    )}
                  </span>
                </div>
              )
            })}
        </div>
      )}
    </Section>
  )
}

function FilmColumn({ side, season, latestPlayed }: { side: MatchupSide; season: number; latestPlayed: (abbr: string) => IndexGame | undefined }) {
  const abbr = side.team.abbr
  const films = side.film.withFilm
  const plays = films.reduce((n, g) => n + g.playCount, 0)
  const graded = films.reduce((n, g) => n + g.gradedPlays, 0)
  const seeAll = () => {
    try {
      sessionStorage.setItem(`ui.route.${links.team(season, abbr)}.section`, JSON.stringify('games'))
    } catch {
      // Opens on Overview instead.
    }
    navigate(links.team(season, abbr))
  }
  const g = latestPlayed(abbr)
  return (
    <div className="matchup-watch" data-test="matchup-film-column">
      <div className="matchup-watch__title matchup-film__title">
        <span>{side.team.name}</span>
        <button type="button" className="see-all" onMouseDown={(e) => e.preventDefault()} onClick={seeAll}>
          See All
          <Icon name="chevron-right" size={12} />
        </button>
      </div>
      {films.length ? (
        <>
          <div className="matchup-film__summary">
            {films.length} of {side.film.gamesPlayed} games with film{plays ? ` · ${Math.round((graded / plays) * 100)}% graded` : ''}
          </div>
          {films.slice(0, 5).map((game) => (
            <FilmRow key={game.gameId} game={game} team={abbr} />
          ))}
        </>
      ) : (
        <div className="matchup-note">
          <span>No film for the {nick(abbr)} yet.</span>
          {g && <Button variant="borderless" size="sm" label="Import Film…" onClick={() => openImport({ game: toGameInfo(g), team: abbr })} />}
        </div>
      )}
    </div>
  )
}

function FilmRow({ game, team }: { game: TeamGame; team: string }) {
  const opp = game.homeTeam === team ? game.awayTeam : game.homeTeam
  const frac = game.playCount ? game.gradedPlays / game.playCount : 0
  return (
    <div className="matchup-film-row" data-test="matchup-film-row" onDoubleClick={() => navigate(links.tape(game.gameId, team))}>
      <span className="matchup-film-row__week">{weekCode(game)}</span>
      <span className="matchup-list__teams">
        <TeamLogo abbr={opp} size={20} />
        <span>
          {game.homeTeam === team ? 'vs' : '@'} {opp}
        </span>
      </span>
      <span className="matchup-film-row__progress">
        <ProgressBar value={frac} mini width={64} />
        <span className="num">
          {game.gradedPlays} of {game.playCount}
        </span>
      </span>
      <Button size="sm" icon="play" label="Watch" onClick={() => navigate(links.tape(game.gameId, team))} />
    </div>
  )
}
