import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ToastHost } from './components/common'
import { links, navigate, useRoute } from './router'
import { Home } from './views/Home'
import { PlayerPage } from './views/PlayerPage'
import { Report } from './views/Report'
import { SettingsPage } from './views/Settings'
import { TapeRoom } from './views/TapeRoom'
import { TeamPage } from './views/TeamPage'

interface SeasonCtx {
  season: number | null
  setSeason: (s: number) => void
}

const SeasonContext = createContext<SeasonCtx>({ season: null, setSeason: () => {} })

export const useSeason = () => useContext(SeasonContext)

function storedSeason(): number | null {
  try {
    const v = Number(localStorage.getItem('season'))
    return v > 2000 ? v : null
  } catch {
    return null
  }
}

/** Renders breadcrumbs into the top bar from inside any view. */
export function Crumbs({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => setEl(document.getElementById('crumbs')), [])
  return el ? createPortal(children, el) : null
}

export function App() {
  const route = useRoute()
  const [season, setSeasonState] = useState<number | null>(storedSeason)
  const setSeason = (s: number) => {
    setSeasonState(s)
    try {
      localStorage.setItem('season', String(s))
    } catch {
      // Storage can be unavailable; the season just won't be remembered.
    }
  }

  // Hand focus back to the page after using a control, so hotkeys (Space, arrows) keep driving the film
  // instead of re-pressing the last button or changing the last dropdown.
  useEffect(() => {
    const onClick = (e: Event) => {
      const button = (e.target as HTMLElement | null)?.closest?.('button')
      if (button) button.blur()
    }
    const onChange = (e: Event) => {
      const t = e.target
      if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && (t.type === 'range' || t.type === 'checkbox'))) {
        t.blur()
      }
    }
    document.addEventListener('click', onClick)
    document.addEventListener('change', onChange, true)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('change', onChange, true)
    }
  }, [])

  const [head, a, b] = route.path
  if (head === 'report') return <Report season={Number(a)} playerId={b} />

  let view: ReactNode
  switch (head) {
    case 'team':
      view = <TeamPage key={`${a}-${b}`} season={Number(a)} team={b} />
      break
    case 'film':
      view = (
        <TapeRoom
          key={a}
          gameId={a}
          team={route.query.get('team') ?? ''}
          initialPlay={route.query.get('play') ? Number(route.query.get('play')) : null}
        />
      )
      break
    case 'player':
      view = <PlayerPage key={`${a}-${b}`} season={Number(a)} playerId={b} />
      break
    case 'settings':
      view = <SettingsPage />
      break
    default:
      view = <Home />
  }

  return (
    <SeasonContext.Provider value={{ season, setSeason }}>
      <div className="app">
        <header className="topbar">
          <div className="brand" onClick={() => navigate(links.home())}>
            <span className="brand-mark">22</span>
            All-22 Watcher
          </div>
          <nav className="crumbs" id="crumbs" />
          <span className="spacer" />
          <button className={`btn ghost small ${head === 'settings' ? 'active' : ''}`} onClick={() => navigate(links.settings())}>
            Settings
          </button>
        </header>
        {view}
        <ToastHost />
      </div>
    </SeasonContext.Provider>
  )
}
