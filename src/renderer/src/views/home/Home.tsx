import { useCallback, useEffect, useState } from 'react'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { RecentFilm, TeamSummary } from '@shared/types'
import { api } from '../../api'
import { TeamChip } from '../../ui/TeamChip'
import { Tile } from '../../ui/Tile'
import { gameMenu, showMenu, teamMenu } from '../../shell/contextMenus'
import { useDataEvent } from '../../shell/dataEvents'
import { openImport } from '../../shell/importRequest'
import { links, navigate } from '../../shell/router'
import { LargeTitle, Screen, Section, useScrollRestore } from '../../shell/Screen'
import { SeasonPopup } from '../../shell/Sidebar'
import { useMyTeams, useSeason } from '../../shell/store'
import { Toolbar } from '../../shell/Toolbar'
import { setUi, sidebarShown, useUi } from '../../shell/uiState'
import { opponentLabel, weekLabel } from '../../format'
import { SeasonGate } from '../shared/SeasonGate'
import './home.css'

/** Home (01 §2.6 baseline; 03 §3 refines it): Continue Watching and My Teams for the global season. */
export function Home() {
  const { season } = useSeason()
  const ui = useUi()
  return (
    <Screen name="home">
      <Toolbar
        title="Home"
        subtitle={season ? `${season} season` : undefined}
        collapsesLargeTitle
        center={!sidebarShown(ui) ? <SeasonPopup test="toolbar-season-popup" /> : undefined}
        trailing={[{ kind: 'button', command: 'file.importFilm', icon: 'folder-input', label: 'Import', showLabel: true, test: 'toolbar-import' }]}
        search={{ placeholder: 'Search', value: '', onChange: () => {}, onFocus: () => setUi({ quickOpen: true }) }}
      />
      {season && (
        <SeasonGate season={season}>
          <HomeContent season={season} />
        </SeasonGate>
      )}
    </Screen>
  )
}

function HomeContent({ season }: { season: number }) {
  const [recent, setRecent] = useState<RecentFilm[] | null>(null)
  const [summaries, setSummaries] = useState<Map<string, TeamSummary>>(new Map())
  const myTeams = useMyTeams()
  const load = useCallback(() => {
    api.recentFilm().then(setRecent, () => setRecent([]))
    api.teamSummaries(season).then((s) => setSummaries(new Map(s.map((x) => [x.team, x]))), () => undefined)
  }, [season])
  useEffect(load, [load])
  useDataEvent(['film', 'grades', 'season'], load)
  useScrollRestore(recent !== null)
  return (
    <>
      <LargeTitle>Home</LargeTitle>
      {recent && recent.length > 0 && (
        <Section title="Continue Watching" test="continue-watching">
          <div className="home-grid">
            {recent.map((r) => (
              <Tile
                key={r.game.gameId}
                test="continue-tile"
                className="home-film-tile"
                progress={r.playCount ? r.gradedPlays / r.playCount : null}
                title={`${r.gradedPlays} of ${r.playCount} plays graded`}
                onOpen={() => navigate(links.tape(r.game.gameId, r.team))}
                onContextMenu={(e) =>
                  void showMenu(e, gameMenu(r.game, r.team, { hasFilm: true, importFilm: () => openImport({ game: r.game, team: r.team }), fixMatches: () => navigate(links.tape(r.game.gameId, r.team)) }))
                }
              >
                <TeamChip abbr={r.team} size="md" />
                <div className="home-film-tile__text">
                  <div className="home-film-tile__title">
                    {r.game.awayTeam} @ {r.game.homeTeam}
                  </div>
                  <div className="home-film-tile__sub">
                    {weekLabel(r.game)} · {r.game.season} · {r.team} {opponentLabel(r.game, r.team)}
                  </div>
                </div>
                <div className="home-film-tile__count">
                  {r.gradedPlays}
                  <span> / {r.playCount}</span>
                </div>
              </Tile>
            ))}
          </div>
        </Section>
      )}
      <Section title="My Teams" seeAll={() => navigate(links.teams(season))}>
        {myTeams.length ? (
          <div className="home-grid home-grid--teams">
            {myTeams.map((abbr) => {
              const t = TEAM_BY_ABBR[abbr]
              const s = summaries.get(abbr)
              return (
                <Tile key={abbr} test="home-team-tile" className="home-team-tile" onOpen={() => navigate(links.team(season, abbr))} onContextMenu={(e) => void showMenu(e, teamMenu(season, abbr))}>
                  <TeamChip abbr={abbr} size="md" />
                  <div className="home-film-tile__text">
                    <div className="home-film-tile__title">{t?.nickname ?? abbr}</div>
                    <div className="home-film-tile__sub">{t?.division ?? ''}</div>
                  </div>
                  <div className="home-film-tile__count">{s ? `${s.wins}–${s.losses}${s.ties ? `–${s.ties}` : ''}` : '0–0'}</div>
                </Tile>
              )
            })}
          </div>
        ) : (
          <p className="home-hint">Teams you import film for or grade show up here. Add one from the sidebar’s My Teams, or open a team from Teams (⌘3).</p>
        )}
      </Section>
    </>
  )
}
