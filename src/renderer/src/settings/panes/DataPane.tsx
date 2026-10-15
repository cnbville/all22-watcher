import { useCallback, useEffect, useState } from 'react'
import type { DataStatus, SeasonStatus } from '@shared/types'
import { api, rawApi } from '../../api'
import { Button } from '../../ui/Button'
import { FormGroup, FormRow } from '../../ui/GroupedForm'
import { PulldownButton } from '../../ui/PopupButton'
import { ProgressBar } from '../../ui/Progress'
import { Switch } from '../../ui/Switch'
import { errorBanner, errorText } from '../../shell/Banners'
import { refreshSeasons, downloadSeason, saveSettings, useDownload, useSeasons, useSettings } from '../../shell/store'
import { Loading } from '../../shell/Screen'
import { lastUpdatedLong, updateSeason } from '../../shell/StatusRows'

/**
 * Data (improvement 16 and v1's season downloads): the seasons on this Mac with their size and age, update and
 * remove, other seasons to download, the in-season auto-update switch and the data folder.
 */

export function sizeLabel(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`
  return `${(bytes / 1e9).toFixed(1)} GB`
}

/** Progress of every season updating in main, whichever window started it. */
function useUpdating(): Record<number, DataStatus> {
  const [map, setMap] = useState<Record<number, DataStatus>>({})
  useEffect(
    () =>
      rawApi.onApiEvent((e) => {
        if (e.type === 'dataStatus') {
          setMap((m) => {
            const next = { ...m }
            if (e.status.state === 'updating') next[e.status.season] = e.status
            else delete next[e.status.season]
            return next
          })
          if (e.status.state !== 'updating') void refreshSeasons()
        } else if (e.type === 'changed' && e.kinds.includes('season')) void refreshSeasons()
      }),
    []
  )
  return map
}

export function DataPane() {
  const seasons = useSeasons()
  const settings = useSettings()
  const updating = useUpdating()
  const [folder, setFolder] = useState('')
  const [sizes, setSizes] = useState<Record<number, number>>({})
  const [current, setCurrent] = useState<DataStatus | null>(null)
  const loadSizes = useCallback(() => void rawApi.seasonStorage().then(setSizes, () => undefined), [])
  useEffect(() => void api.dataFolder().then(setFolder), [])
  useEffect(loadSizes, [loadSizes, seasons])
  useEffect(() => void rawApi.dataStatus().then(setCurrent, () => undefined), [seasons, settings?.autoUpdateSeasons])
  if (!seasons || !settings) return <Loading />

  const downloaded = seasons.filter((s) => s.downloaded)
  const others = seasons.filter((s) => !s.downloaded)
  const total = Object.values(sizes).reduce((a, b) => a + b, 0)

  return (
    <>
      <FormGroup
        title="Seasons"
        trailing={
          others.length > 0 && (
            <PulldownButton
              size="sm"
              label="Download Season"
              test="data-download-season"
              items={() => others.map((s) => ({ label: `${s.season} Season`, test: `data-download-${s.season}`, run: () => void download(s.season) }))}
            />
          )
        }
        footnote={`Schedules, every play, rosters, box scores and on-field lineups from nflverse’s free public data, saved on this Mac so everything works offline.${total ? ` ${sizeLabel(total)} in all.` : ''} Removing a season keeps your grades and film.`}
      >
        {downloaded.length === 0 && <FormRow label="No seasons downloaded" description="Download a season to see its teams, games and players." />}
        {downloaded.map((s) => (
          <SeasonRow key={s.season} status={s} size={sizes[s.season]} live={updating[s.season]} current={current?.season === s.season} onRemoved={loadSizes} />
        ))}
        {others
          .filter((s) => updating[s.season])
          .map((s) => (
            <SeasonRow key={s.season} status={s} live={updating[s.season]} current={false} onRemoved={loadSizes} />
          ))}
      </FormGroup>

      <FormGroup
        title="Updates"
        footnote="From August through February the current season is refreshed when the app opens and every 6 hours, so new games, stats and on-field lineups show up on their own."
      >
        <FormRow label="Update automatically during the season" description={autoDescription(current, settings.autoUpdateSeasons)}>
          <Switch checked={settings.autoUpdateSeasons} onChange={(v) => void saveSettings({ autoUpdateSeasons: v })} label="Update automatically during the season" test="setting-auto-update" />
        </FormRow>
      </FormGroup>

      <FormGroup title="Your Data" footnote="Grades, notes, tags and cut-ups live in one file in this folder, next to the downloaded data. Your clips stay where they are. Back up this folder to keep your grades safe.">
        <FormRow label="Data folder" description={<span className="t-mono-sm selectable settings-path">{folder}</span>}>
          <Button size="sm" label="Show in Finder" onClick={() => void api.openDataFolder()} />
        </FormRow>
      </FormGroup>
    </>
  )
}

function autoDescription(current: DataStatus | null, on: boolean): string {
  if (!current) return ''
  if (!on) return 'Off. Use Update Now or File › Update Season Data (⌥⌘R) to refresh.'
  if (!current.inSeason) return 'It’s the off-season: updates resume in August.'
  if (current.state === 'notDownloaded') return `On. Download the ${current.season} season and it stays up to date.`
  return `On. The ${current.season} season is checked every 6 hours.`
}

async function download(season: number) {
  if (!(await downloadSeason(season))) errorBanner(`Couldn’t download the ${season} season`, 'Check your connection and try again.')
}

function SeasonRow({ status, size, live, current, onRemoved }: { status: SeasonStatus; size?: number; live?: DataStatus; current: boolean; onRemoved: () => void }) {
  const dl = useDownload(status.season)
  const busy = !!dl?.busy || !!live
  const done = live?.done ?? dl?.progress?.done ?? 0
  const totalSteps = live?.total ?? dl?.progress?.total ?? 5
  const step = live?.step ?? dl?.progress?.step ?? 'Starting'
  const failed = !busy && dl?.error
  const remove = async () => {
    const ok = await window.shell.confirm({
      message: `Remove the ${status.season} season data?`,
      detail: `${sizeLabel(size) || 'Its data'} is deleted from this Mac. Your grades, notes and film for ${status.season} stay, and come back when you download the season again.`,
      confirmLabel: 'Remove'
    })
    if (!ok) return
    try {
      await api.removeSeason(status.season)
      await refreshSeasons()
      onRemoved()
    } catch (e) {
      errorBanner(`Couldn’t remove the ${status.season} season`, e)
    }
  }
  const description = busy ? (
    <span className="settings-progress">
      <ProgressBar value={totalSteps ? done / totalSteps : null} width={180} label={`Downloading ${status.season}`} />
      <span>
        {step} · {done} of {totalSteps}
      </span>
    </span>
  ) : failed ? (
    <span className="c-danger selectable">{errorText(dl?.error)}</span>
  ) : (
    [`Updated ${lastUpdatedLong(status.downloadedAt).replace(/^Today/, 'today').replace(/^Yesterday/, 'yesterday')}`, sizeLabel(size), status.hasParticipation ? null : 'On-field lineups not published yet'].filter(Boolean).join(' · ')
  )
  return (
    <FormRow label={<span className="settings-season">{status.season} Season{current && <span className="settings-season__badge">Current</span>}</span>} description={description} test={`data-season-${status.season}`}>
      {!busy && (
        <>
          <Button size="sm" label={status.downloaded ? 'Update' : 'Download'} onClick={() => void (status.downloaded ? updateSeason(status.season) : download(status.season))} test={`data-update-${status.season}`} />
          {status.downloaded && <Button size="sm" variant="borderless" iconOnly icon="trash-2" label={`Remove ${status.season} Data…`} onClick={() => void remove()} />}
        </>
      )}
    </FormRow>
  )
}
