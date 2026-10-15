import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { COMMANDS, type CommandId } from '@shared/commands'
import { TEAM_BY_ABBR } from '@shared/teams'
import { Avatar } from '../ui/Avatar'
import { Icon } from '../ui/Icon'
import { Keycap } from '../ui/Keycap'
import { TeamLogo } from '../ui/TeamChip'
import { useLayer } from '../ui/keyboard'
import { Poster } from '../views/shared/Poster'
import { api } from '../api'
import { searchIndex, type SearchIndex } from './adapters'
import { commandState, runCommand } from './commands'
import { onDataEvent } from './dataEvents'
import { links, navigate, useHistory } from './router'
import { seasonNow, settingsNow } from './store'
import { setUi } from './uiState'

/** ⌘K Quick Open (01 §6.24, 03 §17 A12). */

interface Result {
  key: string
  section: 'Top Hit' | 'Recent' | 'Teams' | 'Players' | 'Games' | 'Cut-ups' | 'Commands'
  leading: ReactNode
  title: string
  detail?: string
  score: number
  open: () => void
  /** ⌘↩: games and players open in the tape room. */
  openTape?: () => void
}

let cache: { season: number; index: Promise<SearchIndex> } | null = null
onDataEvent(['settings', 'film', 'season', 'cutups'], () => (cache = null))

type PosterRef = { clipId: number; at: number }
/** Film stills for game rows (the film library's resume poster per game), loaded once per change to the film. */
let posterCache: Promise<Map<string, PosterRef>> | null = null
onDataEvent(['film'], () => (posterCache = null))
function loadPosters(): Promise<Map<string, PosterRef>> {
  if (!posterCache)
    posterCache = api
      .filmLibrary()
      .then((list) => {
        const m = new Map<string, PosterRef>()
        for (const f of list) if (f.poster && !m.has(f.game.gameId)) m.set(f.game.gameId, f.poster)
        return m
      })
      .catch(() => new Map<string, PosterRef>())
  return posterCache
}

/** An icon in a quiet rounded tile, the size of a logo or a thumbnail's height. */
const Tile = ({ children }: { children: ReactNode }) => <span className="quick-open__tile">{children}</span>

function loadIndex(season: number): Promise<SearchIndex> {
  if (!cache || cache.season !== season) cache = { season, index: searchIndex(season, settingsNow()?.myTeams ?? []) }
  return cache.index
}

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** 3 = exact, 2 = a word starts with the query, 1 = substring, 0 = no match. */
export function matchScore(text: string, q: string): number {
  const t = norm(text)
  if (!q) return 0
  if (t === q) return 3
  if (t.startsWith(q) || t.split(/[\s\-.'’]+/).some((w) => w.startsWith(q))) return 2
  return t.includes(q) ? 1 : 0
}

const SECTIONS: Result['section'][] = ['Top Hit', 'Recent', 'Teams', 'Players', 'Games', 'Cut-ups', 'Commands']

function teamDetail(t: SearchIndex['teams'][number]) {
  const rec = `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ''}`
  return `${rec} · ${t.division}`
}

export function QuickOpen({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [index, setIndex] = useState<SearchIndex | null>(null)
  const [posters, setPosters] = useState<Map<string, PosterRef>>(() => new Map())
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const h = useHistory()
  const season = seasonNow() ?? new Date().getFullYear()

  useEffect(() => {
    let live = true
    loadIndex(season).then((i) => live && setIndex(i), () => live && setIndex({ season, teams: [], players: [], games: [], cutups: [] }))
    return () => {
      live = false
    }
  }, [season])
  useEffect(() => {
    let live = true
    void loadPosters().then((m) => live && setPosters(m))
    return () => {
      live = false
    }
  }, [])

  const results = useMemo((): Result[] => {
    const query = norm(q.trim())
    if (!query) {
      const seen = new Set<string>()
      const recent: Result[] = []
      for (let i = h.entries.length - 1; i >= 0 && recent.length < 8; i--) {
        const e = h.entries[i]
        if (seen.has(e.route) || i === h.index) continue
        seen.add(e.route)
        recent.push({ key: `r${i}`, section: 'Recent', leading: <Tile><Icon name="clock" size={15} /></Tile>, title: e.title || e.route, score: 0, open: () => navigate(e.route) })
      }
      return recent
    }
    const out: Result[] = []
    const words = query.split(/\s+/)
    if (index) {
      for (const t of index.teams) {
        const abbr = norm(t.abbr) === query ? 10 : 0
        const s = abbr || Math.max(matchScore(t.name, query), matchScore(t.nickname, query), matchScore(t.abbr, query))
        if (s) out.push({ key: `t${t.abbr}`, section: 'Teams', leading: <TeamLogo abbr={t.abbr} size={30} />, title: t.name, detail: teamDetail(t), score: s + 0.5, open: () => navigate(links.team(season, t.abbr)) })
      }
      for (const p of index.players) {
        const s = matchScore(p.name, query)
        if (!s) continue
        const team = TEAM_BY_ABBR[p.team]?.nickname ?? p.team
        out.push({
          key: `p${p.id}${p.season}`,
          section: 'Players',
          leading: <Avatar url={p.headshot} name={p.name} size={32} />,
          title: p.name,
          detail: `${p.jersey ? `#${p.jersey} ` : ''}${p.position} · ${team} · ${p.season}`,
          score: s + (p.season === season ? 0.4 : 0) + Math.min(0.2, p.graded / 1000),
          open: () => navigate(links.player(p.season, p.id)),
          openTape: () => {
            const g = index.games.filter((x) => x.studiedTeam === p.team || x.homeTeam === p.team || x.awayTeam === p.team).sort((a, b) => b.season - a.season || b.week - a.week)[0]
            navigate(g ? links.tape(g.gameId, p.team, { player: p.id, focus: true }) : links.player(p.season, p.id))
          }
        })
      }
      for (const g of index.games) {
        const terms = [g.homeTeam, g.awayTeam, TEAM_BY_ABBR[g.homeTeam]?.nickname ?? '', TEAM_BY_ABBR[g.awayTeam]?.nickname ?? '', `week ${g.week}`, `wk ${g.week}`]
        const ok = words.every((w) => terms.some((t) => matchScore(t, w)) || (/^\d+$/.test(w) && Number(w) === g.week) || w === '@' || w === 'vs' || w === 'at')
        if (!ok) continue
        const team = g.studiedTeam ?? g.homeTeam
        out.push({
          key: `g${g.gameId}`,
          section: 'Games',
          leading: posters.get(g.gameId) ? <Poster poster={posters.get(g.gameId)!} width={160} className="quick-open__still" /> : <Tile><Icon name="film" size={15} /></Tile>,
          title: `${g.awayTeam} @ ${g.homeTeam}`,
          detail: `Week ${g.week}, ${g.season} · ${g.gradedPlays} of ${g.playCount} graded`,
          score: 2,
          open: () => navigate(links.tape(g.gameId, team)),
          openTape: () => navigate(links.tape(g.gameId, team))
        })
      }
      for (const c of index.cutups) {
        const s = matchScore(c.name, query)
        if (s) out.push({ key: `c${c.id}`, section: 'Cut-ups', leading: <Tile><Icon name={c.kind === 'smart' ? 'list-filter' : 'list-video'} size={15} /></Tile>, title: c.name, detail: `${c.playCount} plays`, score: s, open: () => navigate(links.cutup(c.id)) })
      }
      // "PHI vs DAL", "PHI DAL", "PHI DAL matchup" (03 §17 A12).
      const abbrs = words.filter((w) => w !== 'vs' && w !== 'matchup' && w !== '@').map((w) => w.toUpperCase())
      if (abbrs.length === 2 && TEAM_BY_ABBR[abbrs[0]] && TEAM_BY_ABBR[abbrs[1]] && abbrs[0] !== abbrs[1]) {
        out.push({ key: 'matchup', section: 'Commands', leading: <Tile><Icon name="swords" size={15} /></Tile>, title: `Matchup: ${abbrs[0]} vs ${abbrs[1]}`, score: 3, open: () => navigate(links.matchup(season, abbrs[0], abbrs[1])) })
      }
    }
    for (const c of COMMANDS) {
      if (!c.quickOpen || !commandState(c.id).enabled) continue
      const label = commandState(c.id).label ?? c.label
      const s = matchScore(label, query)
      if (s) out.push({ key: `x${c.id}`, section: 'Commands', leading: <Tile>{c.icon ? <Icon name={c.icon} size={15} /> : null}</Tile>, title: label.replace(/…$/, ''), score: s, open: () => runCommand(c.id as CommandId) })
    }
    // Top hit, then up to 5 per section, 20 in all.
    const best = [...out].sort((a, b) => b.score - a.score)[0]
    const grouped: Result[] = []
    if (best) grouped.push({ ...best, section: 'Top Hit' })
    for (const sec of SECTIONS.slice(2)) {
      const items = out.filter((r) => r.section === sec && r !== best).sort((a, b) => b.score - a.score).slice(0, 5)
      grouped.push(...items)
    }
    return grouped.slice(0, 20)
  }, [q, index, h, season, posters])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (r: Result | undefined, tape = false) => {
    if (!r) return
    onClose()
    if (tape && r.openTape) r.openTape()
    else r.open()
  }

  useLayer(true, {
    kind: 'quickOpen',
    close: onClose,
    onKey: (e) => {
      if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1))
      else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
      else if (e.key === 'Enter') choose(results[active], e.metaKey)
      else if (e.key === 'Escape') onClose()
      else return false
      return true
    }
  })

  useEffect(() => input.current?.focus(), [])

  let lastSection = ''
  return (
    <div className="quick-open-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick-open" data-test="quick-open" role="dialog" aria-label="Quick Open">
        <div className="quick-open__field">
          <Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams, players, games and cut-ups" spellCheck={false} aria-label="Search" />
        </div>
        {results.length > 0 ? (
          <div ref={listRef} className="quick-open__results" role="listbox">
            {results.map((r, i) => {
              const header = r.section !== lastSection ? r.section : null
              lastSection = r.section
              return (
                <div key={`${r.section}${r.key}`}>
                  {header && <div className="quick-open__section">{header}</div>}
                  <div
                    className="quick-open__row"
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => choose(r, e.metaKey)}
                  >
                    <span className="quick-open__leading">{r.leading}</span>
                    <span className="quick-open__text">
                      <span className="quick-open__title">{r.title}</span>
                      {r.detail && <span className="quick-open__detail">{r.detail}</span>}
                    </span>
                    {i === active && (
                      <span className="quick-open__hint">
                        Open <Keycap small>↩</Keycap>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : q.trim() ? (
          <div className="quick-open__empty">
            <div className="quick-open__empty-title">No results for “{q.trim()}”</div>
            <div className="quick-open__empty-body">Check the spelling or try a team, player or week.</div>
          </div>
        ) : null}
        <div className="quick-open__footer">
          <span>
            <Keycap small>↑</Keycap>
            <Keycap small>↓</Keycap> to move
          </span>
          <span>
            <Keycap small>↩</Keycap> to open
          </span>
          <span>
            <Keycap small>⌘↩</Keycap> in the tape room
          </span>
          <span className="quick-open__footer-end">
            <Keycap small>esc</Keycap> to close
          </span>
        </div>
      </div>
    </div>
  )
}

export function openQuickOpen() {
  setUi({ quickOpen: true })
}
