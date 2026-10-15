import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Button } from '../../ui/Button'
import { FormGroup, FormRow } from '../../ui/GroupedForm'
import { ProgressBar } from '../../ui/Progress'
import { errorBanner } from '../../shell/Banners'
import { downloadSeason, useDownload, useSeasons } from '../../shell/store'
import { Loading } from '../../shell/Screen'

/** Data: the data folder and season downloads (v1 Settings › Your data, Home's download panel). */
export function DataPane() {
  const seasons = useSeasons()
  const [folder, setFolder] = useState('')
  useEffect(() => void api.dataFolder().then(setFolder), [])
  if (!seasons) return <Loading />
  return (
    <>
      <FormGroup title="Seasons" footnote="Schedules, every play, rosters, box scores and on-field lineups from nflverse’s free public data, saved on this Mac.">
        {seasons.map((s) => (
          <SeasonRow key={s.season} season={s.season} downloaded={s.downloaded} downloadedAt={s.downloadedAt} lineups={s.hasParticipation} />
        ))}
      </FormGroup>
      <FormGroup title="Your Data" footnote="Grades, notes and tags live in one file on this Mac, next to the downloaded nflverse data. Your clips stay where they are. Back up this folder to keep your grades safe.">
        <FormRow label="Data folder" description={<span className="t-mono-sm selectable">{folder}</span>}>
          <Button label="Show in Finder" onClick={() => void api.openDataFolder()} />
        </FormRow>
      </FormGroup>
    </>
  )
}

function SeasonRow({ season, downloaded, downloadedAt, lineups }: { season: number; downloaded: boolean; downloadedAt: string | null; lineups: boolean }) {
  const dl = useDownload(season)
  const busy = !!dl?.busy
  const run = async () => {
    if (!(await downloadSeason(season))) errorBanner(`Couldn’t download the ${season} season`, 'Check your connection and try again.')
  }
  const description = busy
    ? `${dl?.progress?.step ?? 'Starting'} · ${dl?.progress?.done ?? 0} of ${dl?.progress?.total ?? 5}`
    : downloaded
      ? `Updated ${downloadedAt ? new Date(downloadedAt).toLocaleDateString() : ''}${lineups ? '' : ' · On-field lineups not published yet'}`
      : 'Not downloaded'
  return (
    <FormRow label={`${season}`} description={description}>
      {busy ? <ProgressBar value={dl?.progress?.total ? dl.progress.done / dl.progress.total : null} style={{ width: 120 }} /> : <Button size="sm" label={downloaded ? 'Update' : 'Download'} onClick={() => void run()} />}
    </FormRow>
  )
}
