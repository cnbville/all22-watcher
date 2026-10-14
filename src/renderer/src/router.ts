import { useEffect, useState } from 'react'

export interface Route {
  path: string[]
  query: URLSearchParams
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  return { path: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs ?? '') }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(to: string) {
  window.location.hash = to
}

export const links = {
  home: () => '/',
  team: (season: number, team: string) => `/team/${season}/${team}`,
  film: (gameId: string, team: string, playId?: number) =>
    `/film/${gameId}?team=${team}${playId !== undefined ? `&play=${playId}` : ''}`,
  player: (season: number, playerId: string) => `/player/${season}/${encodeURIComponent(playerId)}`,
  settings: () => '/settings'
}
