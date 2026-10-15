import { useEffect, useState } from 'react'
import { DIVISIONS, TEAMS } from '@shared/teams'
import type { DataProgress, SeasonStatus, TeamSummary } from '@shared/types'
import { api } from '../api'
import { useSeason } from '../App'
import { ErrorBox, Loading, TeamChip, useAsync } from '../components/common'
import { opponentLabel, weekLabel } from '../format'
import { links, navigate } from '../router'

export function Home() {
  const { season, setSeason } = useSeason()
  const statuses = useAsync(() => api.seasons(), [])

  useEffect(() => {
    if (season || !statuses.data) return
    const downloaded = statuses.data.find((s) => s.downloaded)
    setSeason(downloaded?.season ?? statuses.data[0].season)
  }, [season, statuses.data, setSeason])

  if (statuses.error) return <div className="page"><ErrorBox error={statuses.error} /></div>
  if (!statuses.data || !season) return <Loading />
  const status = statuses.data.find((s) => s.season === season) ?? statuses.data[0]
  // Changes when a season is downloaded again, so the views below remount and fetch the new numbers.
  const dataStamp = statuses.data.map((s) => s.downloadedAt).join()

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="season-hero">
          <div>
            <h4>Season</h4>
            <h1>{season} NFL season</h1>
          </div>
          <select className="input" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
            {statuses.data.map((s) => (
              <option key={s.season} value={s.season}>
                {s.season}
                {s.downloaded ? '' : ' (not downloaded)'}
              </option>
            ))}
          </select>
          <span className="spacer" />
          {status.downloaded && <DataStatus status={status} onDone={statuses.reload} />}
        </div>
        <RecentFilmRow key={`recent ${dataStamp}`} />
        {status.downloaded ? (
          <TeamGrid key={`grid ${dataStamp}`} season={season} />
        ) : (
          <DownloadPanel season={season} onDone={statuses.reload} />
        )}
      </div>
    </div>
  )
}

function useDownload(season: number, onDone: () => void) {
  const [progress, setProgress] = useState<DataProgress | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => api.onDataProgress((p) => p.season === season && setProgress(p)), [season])
  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.downloadSeason(season)
      onDone()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }
  return { progress, error, busy, start }
}

function DownloadPanel({ season, onDone }: { season: number; onDone: () => void }) {
  const dl = useDownload(season, onDone)
  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h2>Download the {season} season</h2>
      <p className="muted">
        Grabs the schedule, every play, rosters, box scores, and who was on the field for each snap from nflverse’s free
        public data. It’s around 60 MB and is saved on your Mac, so everything works offline afterwards.
      </p>
      {dl.busy ? (
        <div className="col">
          <div className="progress">
            <div style={{ width: `${((dl.progress?.done ?? 0) / (dl.progress?.total ?? 5)) * 100}%` }} />
          </div>
          <span className="muted">{dl.progress ? `Downloading ${dl.progress.step.toLowerCase()}…` : 'Starting…'}</span>
        </div>
      ) : (
        <button className="btn primary" onClick={dl.start}>
          Download {season} data
        </button>
      )}
      {!!dl.error && <div style={{ marginTop: 12 }}><ErrorBox error={dl.error} /></div>}
    </div>
  )
}

function DataStatus({ status, onDone }: { status: SeasonStatus; onDone: () => void }) {
  const dl = useDownload(status.season, onDone)
  const when = status.downloadedAt ? new Date(status.downloadedAt).toLocaleDateString() : ''
  return (
    <div className="row">
      {dl.busy ? (
        <span className="muted">Updating {dl.progress?.step.toLowerCase() ?? ''}…</span>
      ) : (
        <>
          <span className="faint">Data from {when}</span>
          <button className="btn small" onClick={dl.start} title="Re-download to pick up the latest games">
            Update
          </button>
        </>
      )}
      {!!dl.error && <ErrorBox error={dl.error} />}
    </div>
  )
}

function RecentFilmRow() {
  const recent = useAsync(() => api.recentFilm(), [])
  if (!recent.data?.length) return null
  return (
    <div style={{ marginBottom: 24 }}>
      <h4 style={{ marginBottom: 8 }}>Continue watching</h4>
      <div className="row wrap" style={{ gap: 10 }}>
        {recent.data.map((r) => (
          <div
            key={r.game.gameId}
            className="team-card"
            style={{ width: 250, marginBottom: 0 }}
            onClick={() => navigate(links.film(r.game.gameId, r.team))}
          >
            <TeamChip abbr={r.team} />
            <div style={{ minWidth: 0 }}>
              <div className="name">
                {r.team} {opponentLabel(r.game, r.team)}
              </div>
              <div className="faint" style={{ fontSize: 11 }}>
                {r.game.season} {weekLabel(r.game)} · {r.gradedPlays}/{r.playCount} plays graded
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TeamGrid({ season }: { season: number }) {
  const summaries = useAsync(() => api.teamSummaries(season), [season])
  if (summaries.error) return <ErrorBox error={summaries.error} />
  const byTeam = new Map<string, TeamSummary>((summaries.data ?? []).map((s) => [s.team, s]))
  return (
    <div className="division-grid">
      {DIVISIONS.map((div) => (
        <div className="division" key={div}>
          <h4>{div}</h4>
          {TEAMS.filter((t) => t.division === div).map((t) => {
            const s = byTeam.get(t.abbr)
            return (
              <div className="team-card" key={t.abbr} onClick={() => navigate(links.team(season, t.abbr))}>
                <TeamChip abbr={t.abbr} />
                <div>
                  <div className="name">{t.nickname}</div>
                  <div className="faint" style={{ fontSize: 11 }}>{t.name.replace(` ${t.nickname}`, '')}</div>
                </div>
                <span className="rec">{s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` : ''}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
