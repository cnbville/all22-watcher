import { type ReactNode, useEffect } from 'react'
import { CommandProvider } from './shell/commands'
import { useRoute } from './shell/router'
import { Shell } from './shell/Shell'
import { startStores } from './shell/store'
import { SettingsApp } from './settings/SettingsApp'
import { Report } from './views/Report'
import { Home } from './views/home/Home'
import { Teams } from './views/teams/Teams'
import { Team } from './views/team/Team'
import { PlayerPage } from './views/player/Player'
import { TapeRoom } from './views/tape-room/TapeRoom'
import { Film } from './views/film/Film'
import { Leaderboards } from './views/leaderboards/Leaderboards'
import { Matchups } from './views/matchups/Matchups'
import { Cutup, Cutups } from './views/cutups/Cutups'

export { useSeason } from './shell/store'

function Screens() {
  const route = useRoute()
  const [head, a, b, c] = route.path
  let view: ReactNode
  switch (head) {
    case 'film':
      view = a ? (
        <TapeRoom
          key={a}
          gameId={a}
          team={route.query.get('team') ?? ''}
          initialPlay={route.query.get('play') ? Number(route.query.get('play')) : null}
        />
      ) : (
        <Film />
      )
      break
    case 'teams':
      view = <Teams key={a} season={Number(a)} />
      break
    case 'team':
      view = <Team key={`${a}-${b}`} season={Number(a)} team={b} />
      break
    case 'player':
      view = <PlayerPage key={`${a}-${b}`} season={Number(a)} playerId={b} />
      break
    case 'leaders':
      view = <Leaderboards season={Number(a)} pos={b ?? 'QB'} />
      break
    case 'matchup':
      view = <Matchups season={Number(a)} team={b ?? route.query.get('team') ?? undefined} opp={c} />
      break
    case 'cutups':
      view = <Cutups />
      break
    case 'cutup':
      view = <Cutup key={a} id={a} />
      break
    default:
      view = <Home />
  }
  return view
}

export function App() {
  const route = useRoute()
  const kind = window.shell?.initial.windowKind ?? 'main'
  useEffect(() => {
    if (route.path[0] !== 'report') startStores()
  }, [route.path])
  if (route.path[0] === 'report') return <Report season={Number(route.path[1])} playerId={route.path[2]} />
  if (kind === 'settings' || route.path[0] === 'settings') {
    return (
      <CommandProvider>
        <SettingsApp />
      </CommandProvider>
    )
  }
  return (
    <CommandProvider>
      <Shell>
        <Screens />
      </Shell>
    </CommandProvider>
  )
}
