import { useMemo } from 'react'
import { gameLabel, weekName } from '@shared/labels'
import { gradeScore } from '@shared/stats'
import { DIVISIONS, TEAM_BY_ABBR, TEAMS } from '@shared/teams'
import type { CutupSummary, FilmLibraryItem, RecentFilm, RecentPlayer, TeamCard, TeamSummary } from '@shared/types'
import { api } from '../../api'
import { gameDayLabel, gameOutcome, recordLabel, relativeDay } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { TextBadge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { ProgressBar } from '../../ui/Progress'
import { TeamLogo } from '../../ui/TeamChip'
import { Tile } from '../../ui/Tile'
import { runCommand } from '../../shell/commands'
import { gameMenu, playerMenu, showMenu, teamMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { openImport } from '../../shell/importRequest'
import { links, navigate } from '../../shell/router'
import { CollapsingTitle, LargeTitle, Loading, Screen, Section, useScrollRestore } from '../../shell/Screen'
import { cutupMenu, SeasonPopup } from '../../shell/Sidebar'
import { useMyTeams, useSeason } from '../../shell/store'
import { Toolbar } from '../../shell/Toolbar'
import { setUi, sidebarShown, useUi } from '../../shell/uiState'
import { KeyArt, Shelf, StillCard, useLoaded } from '../shared'
import { SeasonDownload } from '../shared/SeasonGate'
import './home.css'

/** Home (03 §3): opens on the game being graded as key art, then shelves of film stills, then every team. */
export function Home() {
  const { season, downloaded } = useSeason()
  const ui = useUi()
  return (
    <Screen name="home">
      <Toolbar
        title="Home"
        subtitle={season ? `${season} season` : undefined}
        collapsesLargeTitle
        center={!sidebarShown(ui) || ui.narrow ? <SeasonPopup test="home-season-popup" /> : undefined}
        trailing={[{ kind: 'button', command: 'file.importFilm', icon: 'folder-input', label: 'Import', showLabel: true, test: 'toolbar-import' }]}
        search={{ placeholder: 'Search', value: '', onChange: () => {}, onFocus: () => setUi({ quickOpen: true }) }}
      />
      {season ? <HomeBody season={season} downloaded={downloaded} /> : <Loading />}
    </Screen>
  )
}

const nickname = (abbr: string) => TEAM_BY_ABBR[abbr]?.nickname ?? abbr
const opponentOf = (g: { homeTeam: string; awayTeam: string }, team: string) => (g.homeTeam === team ? g.awayTeam : g.homeTeam)
/** "Bills vs Chiefs" at home, "Bills at Chiefs" away, from the side being graded. */
const matchTitle = (g: RecentFilm['game'], team: string) => `${nickname(team)} ${g.homeTeam === team ? 'vs' : 'at'} ${nickname(opponentOf(g, team))}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function HomeBody({ season, downloaded }: { season: number; downloaded: boolean }) {
  const myTeams = useMyTeams()
  const recent = useLoaded(() => api.recentFilm(), [])
  const graded = useLoaded(() => api.recentlyGraded(8), [])
  const cards = useLoaded(() => (downloaded && myTeams.length ? api.teamCards(season, myTeams) : Promise.resolve([] as TeamCard[])), [season, downloaded, myTeams.join(',')])
  const cutups = useLoaded(() => api.cutups(), [])
  const summaries = useLoaded(() => (downloaded ? api.teamSummaries(season) : Promise.resolve([] as TeamSummary[])), [season, downloaded])
  // Stills for the team cards: each team's latest game with film this season.
  const library = useLoaded(() => api.filmLibrary().catch(() => [] as FilmLibraryItem[]), [])
  useDataEvent(['film', 'grades'], () => {
    recent.reload()
    graded.reload()
    cards.reload()
    library.reload()
  })
  useDataEvent(['cutups', 'grades', 'notes', 'film', 'season'], cutups.reload)
  useDataEvent('season', () => {
    cards.reload()
    summaries.reload()
  })
  useDataEvent('settings', cards.reload)
  const anything = recent.data || graded.data || cutups.data
  useScrollRestore(!!anything)

  const teamPosters = useMemo(() => {
    const out = new Map<string, FilmLibraryItem>()
    for (const f of library.data ?? []) {
      if (f.game.season !== season || !f.poster) continue
      const cur = out.get(f.team)
      if (!cur || f.game.gameday > cur.game.gameday) out.set(f.team, f)
    }
    return out
  }, [library.data, season])

  const hero = recent.data?.[0] ?? null
  const rest = recent.data ?? []
  const noFilm = recent.data !== null && recent.data.length === 0
  return (
    <>
      {hero && <HomeHero film={hero} season={season} />}
      <div className="home">
        {!hero && <LargeTitle>Home</LargeTitle>}
        {!anything && !recent.error && <Loading />}

        {recent.error ? (
          <SectionError what="continue watching" retry={recent.reload} />
        ) : rest.length ? (
          <Section title="Continue watching" seeAll={() => navigate(links.film())} test="continue-watching">
            <Shelf minTile={240}>
              {rest.map((r) => (
                <ContinueTile key={`${r.game.gameId}:${r.team}`} film={r} season={season} />
              ))}
            </Shelf>
          </Section>
        ) : noFilm && downloaded ? (
          <section className="page-section">
            <EmptyState
              test="home-get-started"
              icon="clapperboard"
              title="Start with a game"
              body="Import a game’s All-22 clips and each one lines up with its play. Games you’re grading show up here."
              primary={{ label: 'Import Film…', run: () => runCommand('file.importFilm') || openImport() }}
              secondary={<Button variant="borderless" label="Browse Teams" onClick={() => navigate(links.teams(season))} />}
            />
          </section>
        ) : null}

        {!downloaded ? (
          <div className="home-download">
            <SeasonDownload season={season} />
          </div>
        ) : (
          <>
            {cards.error ? (
              <SectionError what="your teams" retry={cards.reload} />
            ) : cards.data?.length ? (
              <Section title="My teams" test="my-teams">
                <Shelf minTile={220}>
                  {cards.data.map((c) => (
                    <MyTeamTile key={c.team} card={c} season={season} poster={teamPosters.get(c.team)?.poster ?? null} />
                  ))}
                </Shelf>
              </Section>
            ) : null}

            {cutups.error ? (
              <SectionError what="cut-ups" retry={cutups.reload} />
            ) : cutups.data?.length ? (
              <Section title="Cut-ups" seeAll={() => navigate(links.cutups())} test="home-cutups">
                <Shelf minTile={240}>
                  {cutups.data.map((c) => (
                    <CutupTile key={c.cutup.id} c={c} />
                  ))}
                </Shelf>
              </Section>
            ) : null}
          </>
        )}

        {graded.error ? (
          <SectionError what="recently graded" retry={graded.reload} />
        ) : graded.data?.length ? (
          <Section title="Recently graded" test="recently-graded">
            <div className="home-players">
              {graded.data.map((p) => (
                <RecentPlayerTile key={`${p.season}:${p.playerId}`} p={p} season={season} />
              ))}
            </div>
          </Section>
        ) : null}

        {downloaded && summaries.data && (
          <Section title="All teams" seeAll={() => navigate(links.teams(season))} test="all-teams">
            <AllTeams season={season} summaries={summaries.data} />
          </Section>
        )}
      </div>
    </>
  )
}

function SectionError({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div className="home-error" role="alert">
      <Icon name="circle-alert" size={14} />
      <span>Couldn’t load {what}</span>
      <Button variant="borderless" size="sm" label="Try Again" onClick={retry} />
    </div>
  )
}

const filmMenu = (e: React.MouseEvent, film: RecentFilm) =>
  void showMenu(
    e,
    gameMenu(film.game, film.team, {
      hasFilm: true,
      importFilm: () => openImport({ game: film.game, team: film.team }),
      revealClips: undefined
    })
  )

/** The game last being graded, as key art: title, a meta line, thin progress, Resume and a way to its team. */
function HomeHero({ film, season }: { film: RecentFilm; season: number }) {
  const g = film.game
  const outcome = gameOutcome(g, film.team)
  const week = g.season === season ? weekName(g) : `${weekName(g)}, ${g.season}`
  const allGraded = film.playCount > 0 && film.gradedPlays >= film.playCount
  const frac = film.playCount ? film.gradedPlays / film.playCount : 0
  const result = outcome ? `${outcome.letter === 'W' ? 'Won' : outcome.letter === 'L' ? 'Lost' : 'Tied'} ${outcome.score}` : ''
  const resume = () => navigate(links.tape(g.gameId, film.team, { play: film.resumePlayId ?? undefined }))
  return (
    <KeyArt poster={film.poster} size="lg" test="home-hero" onContextMenu={(e) => filmMenu(e, film)}>
      <CollapsingTitle className="home-hero">
        <span className="theater-eyebrow">
          {allGraded ? 'Graded' : film.openedAt === null ? 'New film' : 'Continue grading'}
        </span>
        <h1 className="theater-title">{matchTitle(g, film.team)}</h1>
        <span className="theater-meta">{[week, gameDayLabel(g.gameday), result, `${nickname(film.team)} film`].filter(Boolean).join(' · ')}</span>
        <div className="home-hero__progress">
          <ProgressBar value={frac} mini width={220} label="Plays graded" />
          <span className="num">{allGraded ? `All ${film.playCount} plays graded` : `${film.gradedPlays} of ${film.playCount} plays graded`}</span>
        </div>
        <div className="home-hero__actions">
          <Button variant="primary" size="lg" icon="play" label={allGraded ? 'Watch' : 'Resume'} onClick={resume} test="home-hero-resume" />
          <Button size="lg" label="Team details" onClick={() => navigate(links.team(g.season, film.team))} />
        </div>
      </CollapsingTitle>
    </KeyArt>
  )
}

function ContinueTile({ film, season }: { film: RecentFilm; season: number }) {
  const g = film.game
  const week = g.season === season ? weekName(g) : `${weekName(g)}, ${g.season}`
  const allGraded = film.playCount > 0 && film.gradedPlays >= film.playCount
  return (
    <StillCard
      test="home-continue-tile"
      poster={film.poster}
      progress={film.playCount ? film.gradedPlays / film.playCount : 0}
      title={`${film.gradedPlays} of ${film.playCount} plays graded`}
      line1={
        <>
          <span className="ellipsis">{matchTitle(g, film.team)}</span>
          {film.openedAt === null && <TextBadge>New</TextBadge>}
        </>
      }
      line2={allGraded ? `${week} · All ${film.playCount} graded` : `${week} · ${film.gradedPlays} of ${film.playCount} graded`}
      onOpen={() => navigate(links.tape(g.gameId, film.team, { play: film.resumePlayId ?? undefined }))}
      onContextMenu={(e) => filmMenu(e, film)}
    />
  )
}

function CutupTile({ c }: { c: CutupSummary }) {
  return (
    <StillCard
      test="home-cutup-tile"
      poster={c.poster}
      line1={
        <>
          <Icon name={c.cutup.kind === 'smart' ? 'list-filter' : 'list-video'} size={12} className="home-kind" />
          <span className="ellipsis">{c.cutup.name}</span>
        </>
      }
      line2={`${plural(c.playCount, 'play')} · ${plural(c.gameCount, 'game')} · ${durationOf(c.duration)}`}
      onOpen={() => navigate(links.cutup(c.cutup.id))}
      onContextMenu={(e) => void showMenu(e, cutupMenu(c, () => navigate(links.cutup(c.cutup.id))))}
    />
  )
}

const durationOf = (sec: number) => {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function MyTeamTile({ card, season, poster }: { card: TeamCard; season: number; poster: { clipId: number; at: number } | null }) {
  const t = TEAM_BY_ABBR[card.team]
  const next = card.nextGame
  const last = card.lastGame
  const opp = next ? opponentOf(next, card.team) : null
  const outcome = last ? gameOutcome(last, card.team) : null
  const frac = card.playCount ? card.gradedPlays / card.playCount : 0
  const game = next
    ? `Next ${gameLabel(next, card.team)}, ${gameDayLabel(next.gameday)}`
    : last && outcome
      ? `Last ${gameLabel(last, card.team)}, ${outcome.letter} ${outcome.score}`
      : 'Schedule not out yet'
  return (
    <StillCard
      test="home-team-card"
      poster={poster}
      blank={<TeamLogo abbr={card.team} size={48} />}
      progress={card.gamesWithFilm ? frac : undefined}
      title={card.gamesWithFilm ? `${plural(card.gamesWithFilm, 'game')} with film · ${Math.round(frac * 100)}% graded` : 'No film yet'}
      line1={
        <>
          <TeamLogo abbr={card.team} size={18} className="team-logo--inline" />
          <span className="ellipsis">{t?.name ?? card.team}</span>
        </>
      }
      line2={`${recordLabel(card.wins, card.losses, card.ties)} · ${game}`}
      overlay={
        opp && (
          <Button
            variant="borderless"
            size="sm"
            iconOnly
            icon="swords"
            label="Open Matchup"
            onClick={(e?: React.MouseEvent) => {
              e?.stopPropagation()
              navigate(links.matchup(season, card.team, opp))
            }}
          />
        )
      }
      onOpen={() => navigate(links.team(season, card.team))}
      onContextMenu={(e) => void showMenu(e, teamMenu(season, card.team))}
    />
  )
}

function RecentPlayerTile({ p, season }: { p: RecentPlayer; season: number }) {
  const team = TEAM_BY_ABBR[p.team]
  const day = relativeDay(p.lastGradedAt)
  const graded = day === 'Today' || day === 'Yesterday' ? `Graded ${day.toLowerCase()}` : day ? `Graded ${day}` : ''
  const score = gradeScore(p.tally)
  return (
    <Tile
      test="home-recent-player"
      className="home-player"
      onOpen={() => navigate(links.player(p.season, p.playerId))}
      onContextMenu={(e) => void showMenu(e, playerMenu(p.season, { id: p.playerId, name: p.name, team: p.team }))}
    >
      <Avatar url={p.headshot} name={p.name} size={44} team={p.team} />
      <div className="home-player__text">
        <div className="home-player__name ellipsis">{p.name}</div>
        <div className="home-player__sub ellipsis">
          {[p.position, team?.nickname ?? p.team, p.season !== season ? String(p.season) : '', graded].filter(Boolean).join(' · ')}
        </div>
      </div>
      <span className="home-player__grade num" title={`${p.tally.graded} plays graded · ${p.tally.plus} / ${p.tally.zero} / ${p.tally.minus}`}>
        {score === null ? '—' : Math.round(score)}
      </span>
    </Tile>
  )
}

function AllTeams({ season, summaries }: { season: number; summaries: TeamSummary[] }) {
  const by = new Map(summaries.map((s) => [s.team, s]))
  return (
    <div className="home-divisions">
      {DIVISIONS.map((div) => (
        <div key={div} className="home-division">
          <div className="home-division__title">{div}</div>
          {TEAMS.filter((t) => t.division === div).map((t) => {
            const s = by.get(t.abbr)
            return (
              <a
                key={t.abbr}
                className="home-team-link"
                data-test="home-team-link"
                href={`#${links.team(season, t.abbr)}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(links.team(season, t.abbr))
                }}
                onContextMenu={(e) => void showMenu(e, teamMenu(season, t.abbr))}
              >
                <TeamLogo abbr={t.abbr} size={20} className="team-logo--inline" />
                <span className="home-team-link__name ellipsis">{t.nickname}</span>
                <span className="home-team-link__record num">{s ? recordLabel(s.wins, s.losses, s.ties) : '0–0'}</span>
              </a>
            )
          })}
        </div>
      ))}
    </div>
  )
}
