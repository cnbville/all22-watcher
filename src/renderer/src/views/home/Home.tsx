import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { gameLabel, gameTitle, weekName } from '@shared/labels'
import { gradeScore } from '@shared/stats'
import { DIVISIONS, TEAM_BY_ABBR, TEAMS } from '@shared/teams'
import type { CutupSummary, RecentFilm, RecentPlayer, TeamCard, TeamSummary } from '@shared/types'
import { api } from '../../api'
import { gameDayLabel, gameOutcome, recordLabel, relativeDay } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { TextBadge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { RingGauge } from '../../ui/charts/RingGauge'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { ProgressBar } from '../../ui/Progress'
import { TeamDot } from '../../ui/TeamChip'
import { Tile } from '../../ui/Tile'
import { runCommand } from '../../shell/commands'
import { gameMenu, playerMenu, showMenu, teamMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { openImport } from '../../shell/importRequest'
import { links, navigate } from '../../shell/router'
import { LargeTitle, Loading, Screen, Section, useScrollRestore } from '../../shell/Screen'
import { cutupMenu, SeasonPopup } from '../../shell/Sidebar'
import { useMyTeams, useSeason } from '../../shell/store'
import { Toolbar } from '../../shell/Toolbar'
import { setUi, sidebarShown, useUi } from '../../shell/uiState'
import { Poster, prefersReducedMotion, useLoaded, useMeasure } from '../shared'
import { SeasonDownload } from '../shared/SeasonGate'
import './home.css'

/** Home (03 §3): shelves of things to resume, then a quiet index of every team. */
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

/** n = max(3, floor((column + 24) / 264)) tiles per row (§3.2). */
function useTiles(): [(el: HTMLDivElement | null) => void, number, number] {
  const [ref, width] = useMeasure<HTMLDivElement>(1136)
  const n = Math.max(3, Math.floor((width + 24) / 264))
  return [ref, n, (width - (n - 1) * 24) / n]
}

function HomeBody({ season, downloaded }: { season: number; downloaded: boolean }) {
  const myTeams = useMyTeams()
  const recent = useLoaded(() => api.recentFilm(), [])
  const graded = useLoaded(() => api.recentlyGraded(8), [])
  const cards = useLoaded(() => (downloaded && myTeams.length ? api.teamCards(season, myTeams) : Promise.resolve([] as TeamCard[])), [season, downloaded, myTeams.join(',')])
  const cutups = useLoaded(() => api.cutups(), [])
  const summaries = useLoaded(() => (downloaded ? api.teamSummaries(season) : Promise.resolve([] as TeamSummary[])), [season, downloaded])
  useDataEvent(['film', 'grades'], () => {
    recent.reload()
    graded.reload()
    cards.reload()
  })
  useDataEvent('cutups', cutups.reload)
  useDataEvent('season', () => {
    cards.reload()
    summaries.reload()
  })
  useDataEvent('settings', cards.reload)
  const [colRef, n, tileW] = useTiles()
  const anything = recent.data || graded.data || cutups.data
  useScrollRestore(!!anything)

  const noFilm = recent.data !== null && recent.data.length === 0
  return (
    <div ref={colRef} className="home" style={{ '--tile-w': `${tileW}px`, '--tiles': n } as CSSProperties}>
      <LargeTitle>Home</LargeTitle>
      {!anything && !recent.error && <Loading />}

      {recent.error ? (
        <SectionError what="continue watching" retry={recent.reload} />
      ) : recent.data?.length ? (
        <Section title="Continue Watching" seeAll={() => navigate(links.film())} test="continue-watching">
          <Shelf n={n}>
            {recent.data.map((r) => (
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

      {graded.error ? (
        <SectionError what="recently graded" retry={graded.reload} />
      ) : graded.data?.length ? (
        <Section title="Recently Graded" test="recently-graded">
          <div className="home-grid">
            {graded.data.slice(0, n * 2).map((p) => (
              <RecentPlayerTile key={`${p.season}:${p.playerId}`} p={p} season={season} />
            ))}
          </div>
        </Section>
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
            <Section title="My Teams" test="my-teams">
              <div className="home-grid">
                {cards.data.slice(0, n * 2).map((c) => (
                  <MyTeamTile key={c.team} card={c} season={season} />
                ))}
              </div>
            </Section>
          ) : null}

          {cutups.error ? (
            <SectionError what="cut-ups" retry={cutups.reload} />
          ) : cutups.data?.length ? (
            <Section title="Cut-ups" seeAll={() => navigate(links.cutups())} test="home-cutups">
              <Shelf n={n}>
                {cutups.data.map((c) => (
                  <CutupTile key={c.cutup.id} c={c} />
                ))}
              </Shelf>
            </Section>
          ) : null}

          {summaries.data && (
            <Section title="All Teams" seeAll={() => navigate(links.teams(season))} test="all-teams">
              <AllTeams season={season} summaries={summaries.data} />
            </Section>
          )}
        </>
      )}
    </div>
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

/** A horizontally scrolling row of tiles that snap to their start, with paging buttons on hover (§3.3). */
function Shelf({ n, children }: { n: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [can, setCan] = useState({ left: false, right: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCan({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }, [])
  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [update, children])
  const page = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    const tile = el.firstElementChild as HTMLElement | null
    const stepW = tile ? tile.offsetWidth + 24 : el.clientWidth
    el.scrollBy({ left: dir * stepW * n, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }
  return (
    <div className="shelf">
      <div
        ref={ref}
        className="shelf__track"
        onScroll={update}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          const items = Array.from(ref.current?.children ?? []) as HTMLElement[]
          const i = items.findIndex((x) => x.contains(document.activeElement))
          const next = items[i + (e.key === 'ArrowRight' ? 1 : -1)]
          if (next) {
            e.preventDefault()
            e.stopPropagation()
            ;(next.querySelector('[tabindex]') as HTMLElement | null)?.focus()
            next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
          }
        }}
      >
        {children}
      </div>
      <button type="button" className="shelf__page shelf__page--left" data-shown={can.left || undefined} aria-label="Previous" tabIndex={-1} onClick={() => page(-1)}>
        <Icon name="chevron-left" size={14} />
      </button>
      <button type="button" className="shelf__page shelf__page--right" data-shown={can.right || undefined} aria-label="Next" tabIndex={-1} onClick={() => page(1)}>
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  )
}

/** A poster tile (01 §6.27 variant): poster with an optional progress edge, then two lines of text. */
function PosterTile({
  poster,
  progress,
  line1,
  line2,
  onOpen,
  onContextMenu,
  test,
  title
}: {
  poster: { clipId: number; at: number } | null
  progress?: number
  line1: ReactNode
  line2: ReactNode
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
  test: string
  title?: string
}) {
  return (
    <div className="poster-tile">
      <div
        className="poster-tile__hit"
        role="button"
        tabIndex={0}
        data-test={test}
        title={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onOpen()
          }
        }}
      >
        <Poster poster={poster} className="poster-tile__poster">
          <span className="poster-tile__play" aria-hidden>
            <Icon name="play" size={18} filled />
          </span>
          {progress !== undefined && <ProgressBar value={progress} mini style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} />}
        </Poster>
        <div className="poster-tile__line1">{line1}</div>
        <div className="poster-tile__line2">{line2}</div>
      </div>
    </div>
  )
}

function ContinueTile({ film, season }: { film: RecentFilm; season: number }) {
  const g = film.game
  const week = g.season === season ? weekName(g) : `${weekName(g)}, ${g.season}`
  const allGraded = film.playCount > 0 && film.gradedPlays >= film.playCount
  return (
    <PosterTile
      test="home-continue-tile"
      poster={film.poster}
      progress={film.playCount ? film.gradedPlays / film.playCount : 0}
      title={`${film.gradedPlays} of ${film.playCount} plays graded`}
      line1={
        <>
          <TeamDot abbr={film.team} size={8} />
          <span className="poster-tile__title ellipsis">{gameTitle(g)}</span>
          {film.openedAt === null && <TextBadge>NEW</TextBadge>}
        </>
      }
      line2={allGraded ? `${week} · ${film.team} · All ${film.playCount} graded` : `${week} · ${film.team} · ${film.gradedPlays} of ${film.playCount} graded`}
      onOpen={() => navigate(links.tape(g.gameId, film.team, { play: film.resumePlayId ?? undefined }))}
      onContextMenu={(e) =>
        void showMenu(
          e,
          gameMenu(g, film.team, {
            hasFilm: true,
            importFilm: () => openImport({ game: g, team: film.team }),
            revealClips: undefined
          })
        )
      }
    />
  )
}

function CutupTile({ c }: { c: CutupSummary }) {
  return (
    <PosterTile
      test="home-cutup-tile"
      poster={c.poster}
      line1={
        <>
          <Icon name={c.cutup.kind === 'smart' ? 'list-filter' : 'list-video'} size={12} className="poster-tile__kind" />
          <span className="poster-tile__title ellipsis">{c.cutup.name}</span>
        </>
      }
      line2={`${c.playCount} ${c.playCount === 1 ? 'play' : 'plays'} · ${c.gameCount} ${c.gameCount === 1 ? 'game' : 'games'} · ${durationOf(c.duration)}`}
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

function RecentPlayerTile({ p, season }: { p: RecentPlayer; season: number }) {
  const team = TEAM_BY_ABBR[p.team]
  const day = relativeDay(p.lastGradedAt)
  const graded = day === 'Today' || day === 'Yesterday' ? `Graded ${day.toLowerCase()}` : day ? `Graded ${day}` : ''
  return (
    <Tile
      test="home-recent-player"
      className="home-player-tile"
      onOpen={() => navigate(links.player(p.season, p.playerId))}
      onContextMenu={(e) => void showMenu(e, playerMenu(p.season, { id: p.playerId, name: p.name, team: p.team }))}
    >
      <Avatar url={p.headshot} name={p.name} size={48} team={p.team} />
      <div className="home-tile-text">
        <div className="home-tile-title ellipsis">{p.name}</div>
        <div className="home-tile-sub ellipsis">
          {[p.position, team?.nickname ?? p.team, p.season !== season ? String(p.season) : ''].filter(Boolean).join(' · ')}
        </div>
        <div className="home-tile-meta ellipsis">{graded}</div>
      </div>
      <span title={`${p.tally.graded} plays graded · ${p.tally.plus} / ${p.tally.zero} / ${p.tally.minus}`}>
        <RingGauge score={gradeScore(p.tally)} size={44} animate={false} />
      </span>
    </Tile>
  )
}

function MyTeamTile({ card, season }: { card: TeamCard; season: number }) {
  const t = TEAM_BY_ABBR[card.team]
  const next = card.nextGame
  const last = card.lastGame
  const opp = next ? (next.homeTeam === card.team ? next.awayTeam : next.homeTeam) : null
  const outcome = last ? gameOutcome(last, card.team) : null
  const line2 = next
    ? `Next: ${gameLabel(next, card.team)} · ${gameDayLabel(next.gameday)}`
    : last && outcome
      ? `Last: ${gameLabel(last, card.team)} · ${outcome.letter} ${outcome.score}`
      : 'Schedule not out yet'
  const frac = card.playCount ? card.gradedPlays / card.playCount : 0
  return (
    <Tile test="home-team-card" className="home-team-card" onOpen={() => navigate(links.team(season, card.team))} onContextMenu={(e) => void showMenu(e, teamMenu(season, card.team))}>
      <div className="home-team-card__line1">
        <TeamDot abbr={card.team} size={10} />
        <span className="home-team-card__name ellipsis">{t?.nickname ?? card.team}</span>
        <span className="home-team-card__record num">{recordLabel(card.wins, card.losses, card.ties)}</span>
      </div>
      <div className="home-team-card__line2 ellipsis">{line2}</div>
      <div className="home-team-card__line3">
        {card.gamesWithFilm ? (
          <>
            <ProgressBar value={frac} mini width={120} />
            <span>
              {card.gamesWithFilm} {card.gamesWithFilm === 1 ? 'game' : 'games'} · {Math.round(frac * 100)}% graded
            </span>
          </>
        ) : (
          <span>No film yet</span>
        )}
      </div>
      {opp && (
        <span className="home-team-card__matchup">
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
        </span>
      )}
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
                <TeamDot abbr={t.abbr} size={8} />
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
