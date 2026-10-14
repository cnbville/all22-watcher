import { useEffect, useMemo, useRef, useState } from 'react'
import { clipUrl } from '@shared/api'
import { gradeScore, plusRate } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { Angle, PlayerGameLine, PlayerProfile, ReelItem } from '@shared/types'
import { api } from '../api'
import { Crumbs } from '../App'
import { ErrorBox, GradeBar, GradeSymbol, Headshot, Loading, Score, TeamChip, toast, useAsync } from '../components/common'
import { downDistance, pct, quarterLabel, shortDesc, statColumns } from '../format'
import { links, navigate } from '../router'

export function PlayerPage({ season, playerId }: { season: number; playerId: string }) {
  const profile = useAsync(() => api.playerProfile(season, playerId), [season, playerId])
  const [exporting, setExporting] = useState(false)
  if (profile.error) return <div className="page"><ErrorBox error={profile.error} /></div>
  if (profile.loading && !profile.data) return <Loading />
  if (!profile.data) return <div className="page"><div className="empty">Player not found in the {season} data.</div></div>
  const p = profile.data
  const { player } = p
  const team = TEAM_BY_ABBR[player.team]

  const exportReport = async () => {
    setExporting(true)
    try {
      const path = await api.exportPlayerReport(season, playerId)
      if (path) toast(`Saved ${path.split('/').pop()}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page">
      <Crumbs>
        <span className="sep">/</span>
        <a onClick={() => navigate(links.home())}>{season}</a>
        <span className="sep">/</span>
        <a onClick={() => navigate(links.team(season, player.team))}>{team?.name ?? player.team}</a>
        <span className="sep">/</span>
        <span>{player.name}</span>
      </Crumbs>
      <div className="page-narrow">
        <div className="player-hero">
          <Headshot url={player.headshot} name={player.name} />
          <div>
            <h1>{player.name}</h1>
            <div className="row muted" style={{ marginTop: 4 }}>
              <TeamChip abbr={player.team} size="sm" />
              <span>
                {player.jersey ? `#${player.jersey} · ` : ''}
                {player.depthPos || player.position} · {team?.name ?? player.team}
              </span>
            </div>
            <div className="faint" style={{ marginTop: 4 }}>
              {[
                player.college,
                player.height && `${Math.floor(Number(player.height) / 12)}'${Number(player.height) % 12}"`,
                player.weight && `${player.weight} lb`,
                player.yearsExp !== '' && (player.yearsExp === '0' ? 'Rookie' : `${player.yearsExp} yrs exp`)
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <span className="spacer" />
          <div className="big-grade">
            <h4>Your grade</h4>
            <div className="v">
              <Score tally={p.tally} />
            </div>
            <div className="faint" style={{ fontSize: 11 }}>
              {p.tally.graded} {p.tally.graded === 1 ? 'play' : 'plays'} graded
            </div>
          </div>
          <button className="btn" onClick={exportReport} disabled={exporting}>
            {exporting ? 'Saving…' : 'Export report (PDF)'}
          </button>
        </div>

        <SeasonLine profile={p} />

        <div className="stat-grid">
          <div className="card">
            <div className="card-title">
              <h3>Grade breakdown</h3>
            </div>
            {p.tally.graded ? (
              <>
                <div className="row" style={{ gap: 18, marginBottom: 10 }}>
                  <Count label="Plus" value={p.tally.plus} color="var(--plus)" />
                  <Count label="Zero" value={p.tally.zero} color="var(--zero)" />
                  <Count label="Minus" value={p.tally.minus} color="var(--minus)" />
                  <Count label="Plus rate" value={pct(plusRate(p.tally))} />
                  <Count label="Net" value={(p.tally.plus - p.tally.minus).toString()} />
                </div>
                <GradeBar tally={p.tally} />
                <h4 style={{ margin: '16px 0 8px' }}>Tags</h4>
                <div className="tags">
                  {p.reel.length === 0 || p.tagCounts.length === 0 ? (
                    <span className="faint">No tags yet.</span>
                  ) : (
                    p.tagCounts.map((t) => (
                      <span className="tag static" key={t.tag}>
                        {t.tag} <b style={{ color: 'var(--text)' }}>{t.count}</b>
                      </span>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="faint">Grade {player.name.split(' ')[0]} in the tape room to see a breakdown here.</div>
            )}
          </div>
          <div className="card">
            <div className="card-title">
              <h3>Grade by game</h3>
              <span className="faint">0–100, 50 is neutral</span>
            </div>
            <GradeTrend games={p.games} />
          </div>
        </div>

        {p.reel.length > 0 && <Reel profile={p} />}

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            <h3>Game log</h3>
          </div>
          <GameLog profile={p} />
        </div>
      </div>
    </div>
  )
}

function Count({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  )
}

export function SeasonLine({ profile }: { profile: PlayerProfile }) {
  const cols = statColumns(profile.player.group)
  const tiles = [
    ...(profile.totals.snaps ? [{ key: 'snaps', label: 'Snaps', value: String(profile.totals.snaps) }] : []),
    { key: 'games', label: 'Games', value: String(profile.games.filter((g) => Object.keys(g.stats).length || g.snaps).length) },
    ...cols.map((c) => ({ key: c.key, label: c.label, value: c.value(profile.totals) }))
  ]
  return (
    <div className="stat-list" style={{ gridTemplateColumns: `repeat(${Math.min(tiles.length, 9)}, 1fr)`, marginBottom: 16 }}>
      {tiles.map((t) => (
        <div className="stat-tile" key={t.key}>
          <div className="label">{t.label}</div>
          <div className="value">{t.value}</div>
        </div>
      ))}
    </div>
  )
}

/** One bar per graded game, growing up (green) or down (red) from the neutral 50 line. */
export function GradeTrend({ games, print }: { games: PlayerGameLine[]; print?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const graded = games.filter((g) => g.tally.graded)
  if (!graded.length) return <div className="faint">No graded games yet.</div>
  const W = 520
  const H = 170
  const pad = { l: 28, r: 8, t: 10, b: 22 }
  const innerH = H - pad.t - pad.b
  const y = (v: number) => pad.t + innerH * (1 - v / 100)
  const slot = (W - pad.l - pad.r) / graded.length
  const bw = Math.min(26, slot * 0.6)
  const ink = print ? '#666' : 'var(--text-3)'
  const grid = print ? '#ddd' : 'var(--line)'
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Grade by game">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={grid} strokeWidth={v === 50 ? 1.5 : 1} strokeDasharray={v === 50 ? '' : '3 3'} />
            <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill={ink}>
              {v}
            </text>
          </g>
        ))}
        {graded.map((g, i) => {
          const s = gradeScore(g.tally)!
          const cx = pad.l + slot * (i + 0.5)
          const top = Math.min(y(s), y(50))
          const h = Math.max(2, Math.abs(y(s) - y(50)))
          const up = s >= 50
          return (
            <g key={g.game.gameId} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={innerH} fill="transparent" />
              <path d={roundedBar(cx - bw / 2, top, bw, h, up)} fill={up ? '#35c46a' : '#ff5a5a'} opacity={hover === null || hover === i ? 1 : 0.45} />
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill={ink}>
                {g.opponent}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && !print && (
        <div
          className="badge"
          style={{
            position: 'absolute',
            top: 0,
            left: `${((pad.l + slot * (hover + 0.5)) / W) * 100}%`,
            transform: 'translateX(-50%)',
            background: 'var(--panel-2)',
            color: 'var(--text)'
          }}
        >
          Wk {graded[hover].game.week} vs {graded[hover].opponent}: {gradeScore(graded[hover].tally)} ({graded[hover].tally.plus}+ /{' '}
          {graded[hover].tally.zero} / {graded[hover].tally.minus}–)
        </div>
      )}
    </div>
  )
}

/** A bar with 4px rounding only on its data end; the end touching the 50 line stays square. */
function roundedBar(x: number, y: number, w: number, h: number, up: boolean) {
  const r = Math.min(4, h / 2, w / 2)
  if (up) {
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
  }
  return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`
}

export function GameLog({ profile }: { profile: PlayerProfile }) {
  const cols = statColumns(profile.player.group)
  if (!profile.games.length) return <div className="faint">No games for this player in the {profile.season} data.</div>
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Wk</th>
          <th>Opp</th>
          <th className="num">Snaps</th>
          {cols.map((c) => (
            <th key={c.key} className="num">
              {c.label}
            </th>
          ))}
          <th className="num">+ / 0 / –</th>
          <th className="num">Grade</th>
        </tr>
      </thead>
      <tbody>
        {profile.games.map((g) => {
          const snaps = g.snaps ? g.snaps.offense + g.snaps.defense + g.snaps.special : null
          return (
            <tr key={g.game.gameId}>
              <td className="faint">{g.game.week}</td>
              <td>
                {g.team === g.game.homeTeam ? 'vs' : '@'} {g.opponent}
              </td>
              <td className="num">{snaps ?? <span className="faint">—</span>}</td>
              {cols.map((c) => (
                <td key={c.key} className="num">
                  {Object.keys(g.stats).length ? c.value(g.stats) : <span className="faint">—</span>}
                </td>
              ))}
              <td className="num">
                {g.tally.graded ? `${g.tally.plus} / ${g.tally.zero} / ${g.tally.minus}` : <span className="faint">—</span>}
              </td>
              <td className="num">
                <Score tally={g.tally} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const ANGLE_PREF: Angle[] = ['sideline', 'main', 'endzone']

function Reel({ profile }: { profile: PlayerProfile }) {
  const [gradeFilter, setGradeFilter] = useState<'all' | 'plus' | 'zero' | 'minus'>('all')
  const [tag, setTag] = useState('')
  const [index, setIndex] = useState(0)
  const [angle, setAngle] = useState<Angle>('sideline')
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(
    () =>
      profile.reel.filter((r) => {
        if (gradeFilter === 'plus' && r.grade !== 1) return false
        if (gradeFilter === 'zero' && r.grade !== 0) return false
        if (gradeFilter === 'minus' && r.grade !== -1) return false
        if (tag && !r.tags.includes(tag)) return false
        return true
      }),
    [profile.reel, gradeFilter, tag]
  )
  useEffect(() => setIndex(0), [gradeFilter, tag])
  useEffect(() => {
    listRef.current?.querySelector('.reel-item.current')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const item: ReelItem | undefined = items[index]
  const clip = item ? item.clips.find((c) => c.angle === angle) ?? [...item.clips].sort((a, b) => ANGLE_PREF.indexOf(a.angle) - ANGLE_PREF.indexOf(b.angle))[0] : undefined
  const angles = item ? [...new Set(item.clips.map((c) => c.angle))] : []
  const next = () => setIndex((i) => (i + 1 < items.length ? i + 1 : i))

  return (
    <div className="card">
      <div className="card-title">
        <h3>Film reel</h3>
        <span className="faint">{items.length} graded plays</span>
        <span className="spacer" />
        <div className="seg">
          {(['all', 'plus', 'zero', 'minus'] as const).map((g) => (
            <button key={g} className={gradeFilter === g ? 'on' : ''} onClick={() => setGradeFilter(g)}>
              {{ all: 'All', plus: '+', zero: '0', minus: '–' }[g]}
            </button>
          ))}
        </div>
        <select className="input" style={{ height: 28 }} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Any tag</option>
          {profile.tagCounts.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </option>
          ))}
        </select>
      </div>
      <div className="reel">
        <div>
          <div className="reel-video">
            {clip ? (
              <video key={clip.id} src={clipUrl(clip.id)} autoPlay muted playsInline controls onEnded={next} />
            ) : (
              <div className="no-clip">{item ? 'No clip linked to this play.' : 'No plays match.'}</div>
            )}
          </div>
          {item && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn small" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                ◀︎ Prev
              </button>
              <button className="btn small" disabled={index >= items.length - 1} onClick={next}>
                Next ▶︎
              </button>
              {angles.length > 1 && (
                <button className="btn small" onClick={() => setAngle(clip?.angle === 'endzone' ? 'sideline' : 'endzone')}>
                  {clip?.angle === 'endzone' ? 'Sideline' : 'End zone'} view
                </button>
              )}
              <span className="faint" style={{ marginLeft: 6 }}>
                {index + 1} / {items.length}
              </span>
              <span className="spacer" />
              <a onClick={() => navigate(links.film(item.gameId, item.team, item.playId))}>
                Open in tape room
              </a>
            </div>
          )}
          {item?.note && <div className="play-desc" style={{ marginTop: 8 }}>“{item.note}”</div>}
        </div>
        <div className="reel-list" ref={listRef}>
          {items.map((r, i) => (
            <div key={`${r.gameId}-${r.playId}`} className={`reel-item ${i === index ? 'current' : ''}`} onClick={() => setIndex(i)}>
              <GradeSymbol grade={r.grade} />
              <div style={{ minWidth: 0 }}>
                <div className="faint" style={{ fontSize: 11 }}>
                  Wk {r.week} vs {r.opponent}
                  {r.play ? ` · ${quarterLabel(r.play.qtr)} ${r.play.time} · ${downDistance(r.play)}` : ''}
                </div>
                <div className="desc" style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.play ? shortDesc(r.play.desc) : `Play ${r.playId}`}
                </div>
                {r.tags.length > 0 && <div className="faint" style={{ fontSize: 11 }}>{r.tags.join(' · ')}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
