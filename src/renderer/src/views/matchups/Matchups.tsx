import { TEAMS, TEAM_BY_ABBR } from '@shared/teams'
import { EmptyState } from '../../ui/EmptyState'
import { PopupButton } from '../../ui/PopupButton'
import { links, navigate } from '../../shell/router'
import { Screen } from '../../shell/Screen'
import { persist } from '../../shell/uiState'
import { Toolbar } from '../../shell/Toolbar'
import { SeasonGate } from '../shared/SeasonGate'

/** Matchups placeholder (03 §8 fills it in): the two-team picker and its empty state. */
export function Matchups({ season, team, opp }: { season: number; team?: string; opp?: string }) {
  const options = TEAMS.map((t) => ({ value: t.abbr, label: t.name }))
  const set = (a?: string, b?: string) => {
    if (a && b) persist('ui.matchup.last', `${a}|${b}`)
    navigate(links.matchup(season, a, b), { replace: true })
  }
  const both = team && opp
  return (
    <Screen name="matchups">
      <Toolbar
        title={both ? `${team} vs ${opp}` : 'Matchups'}
        subtitle={both ? `${season}` : 'Choose two teams'}
        windowTitle={both ? `${team} vs ${opp} — Matchup` : 'Matchups'}
      />
      <SeasonGate season={season}>
        <EmptyState
          icon="swords"
          title={both ? `${TEAM_BY_ABBR[team!]?.nickname} vs ${TEAM_BY_ABBR[opp!]?.nickname}` : 'Choose two teams'}
          body={both ? 'Unit-by-unit grades for this matchup appear here once both teams have graded film.' : 'Pick a team and its opponent to compare their units from your film grades.'}
          secondary={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <PopupButton value={team ?? ''} width={200} label={team ? TEAM_BY_ABBR[team]?.name : 'Choose a Team'} options={options} onChange={(v) => set(v, opp)} />
              <span className="c-label-3">vs</span>
              <PopupButton value={opp ?? ''} width={200} label={opp ? TEAM_BY_ABBR[opp]?.name : 'Choose an Opponent'} options={options.filter((o) => o.value !== team)} onChange={(v) => set(team, v)} />
            </div>
          }
        />
      </SeasonGate>
    </Screen>
  )
}
