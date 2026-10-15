import type { ReactNode } from 'react'
import { EmptyState } from '../../ui/EmptyState'
import { PulldownButton } from '../../ui/PopupButton'
import { ProgressBar } from '../../ui/Progress'
import { errorText } from '../../shell/Banners'
import { seasonMenuItems } from '../../shell/Sidebar'
import { downloadSeason, setSeason, useDownload, useSeasons } from '../../shell/store'
import { Loading } from '../../shell/Screen'

/**
 * Season-scoped screens show the download empty state until their season is downloaded (01 §8.2): download,
 * downloading with the step and count, or the failure with Try Again.
 */
export function SeasonGate({ season, children }: { season: number; children: ReactNode }) {
  const seasons = useSeasons()
  const dl = useDownload(season)
  if (!seasons) return <Loading />
  const status = seasons.find((s) => s.season === season)
  if (status?.downloaded && !dl?.busy) return <>{children}</>
  return <SeasonDownload season={season} />
}

export function SeasonDownload({ season }: { season: number }) {
  const seasons = useSeasons() ?? []
  const dl = useDownload(season)
  const start = () => void downloadSeason(season)
  if (dl?.busy) {
    const p = dl.progress
    return (
      <EmptyState
        test="season-downloading"
        visual={<ProgressBar value={p?.total ? p.done / p.total : null} style={{ width: 280, marginBottom: 20 }} />}
        title={`Downloading the ${season} season`}
        body={p ? `${p.step} · ${p.done} of ${p.total}` : 'Starting…'}
      />
    )
  }
  if (dl?.error) {
    return <EmptyState icon="circle-alert" title={`Couldn’t download the ${season} season`} body={errorText(dl.error)} selectableBody primary={{ label: 'Try Again', run: start }} />
  }
  return (
    <EmptyState
      icon="database"
      title={`Download the ${season} season`}
      body="Schedules, every play, rosters, box scores and on-field lineups from nflverse’s free public data. About 60 MB, saved on this Mac so everything works offline."
      primary={{ label: `Download ${season} Season`, run: start, test: 'season-download' }}
      secondary={<PulldownButton variant="borderless" label="Choose Another Season" items={() => seasonMenuItems(seasons, season, setSeason, null)} />}
    />
  )
}
