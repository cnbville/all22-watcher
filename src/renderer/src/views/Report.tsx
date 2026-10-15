import { useEffect } from 'react'
import { plusRate } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import { api } from '../api'
import { Score, useAsync } from '../components/common'
import { downDistance, gradeSymbol, pct, quarterLabel, shortDesc } from '../format'
import { GameLog, GradeTrend, reelGameLabel, SeasonLine } from './PlayerPage'

/** A printable one-player scouting report; the main process turns this page into a PDF. */
export function Report({ season, playerId }: { season: number; playerId: string }) {
  const profile = useAsync(() => api.playerProfile(season, playerId), [season, playerId])

  useEffect(() => {
    if (!profile.loading) {
      // Let the browser lay out the page before the main process prints it.
      requestAnimationFrame(() => requestAnimationFrame(() => (document.body.dataset.ready = '1')))
    }
  }, [profile.loading])

  const p = profile.data
  if (!p) return <div className="report">{profile.loading ? 'Loading…' : 'Player not found.'}</div>
  const { player } = p
  const notes = p.reel.filter((r) => r.note.trim())
  return (
    <div className="report">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="muted">
            {season} scouting report · {TEAM_BY_ABBR[player.team]?.name ?? player.team}
          </div>
          <h1>
            {player.name}
            <span className="muted" style={{ fontSize: 16, fontWeight: 500 }}>
              {' '}
              {player.jersey ? `#${player.jersey} ` : ''}
              {player.depthPos || player.position}
            </span>
          </h1>
        </div>
        <span className="spacer" />
        <div style={{ textAlign: 'right' }}>
          <div className="muted">Grade</div>
          <div style={{ fontSize: 30, fontWeight: 800 }}>
            <Score tally={p.tally} />
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            {p.tally.graded} {p.tally.graded === 1 ? 'play' : 'plays'} · {p.tally.plus}+ / {p.tally.zero} / {p.tally.minus}– · {pct(plusRate(p.tally))} plus
          </div>
        </div>
      </div>

      <h2>Season</h2>
      <SeasonLine profile={p} />

      {p.tally.graded > 0 && (
        <>
          <h2>Grade by game</h2>
          <GradeTrend games={p.games} print />
          {p.tagCounts.length > 0 && (
            <>
              <h2>Tags</h2>
              <div>{p.tagCounts.map((t) => `${t.tag} (${t.count})`).join(' · ')}</div>
            </>
          )}
        </>
      )}

      <h2>Game log</h2>
      <GameLog profile={p} />

      {notes.length > 0 && (
        <>
          <h2>Notes from the film</h2>
          <table className="table">
            <tbody>
              {notes.map((r) => (
                <tr key={`${r.gameId}-${r.playId}`}>
                  <td style={{ width: 24, fontWeight: 800 }}>{gradeSymbol(r.grade)}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {reelGameLabel(p, r)}
                      {r.play ? ` · ${quarterLabel(r.play.qtr)} ${r.play.time} · ${downDistance(r.play)} · ${shortDesc(r.play.desc)}` : ''}
                    </div>
                    <div>{r.note}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="muted" style={{ marginTop: 28, fontSize: 10 }}>
        Grades from your own film study in All-22 Watcher. Stats from nflverse.
      </p>
    </div>
  )
}
