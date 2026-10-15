import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { gameTitle, weekShort } from '@shared/labels'
import type { DataStatus, GameInfo, ImportLogEntry, WatchStatus } from '@shared/types'
import { api, rawApi } from '../api'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Popover } from '../ui/Popover'
import { ProgressBar, ProgressRing } from '../ui/Progress'
import { Switch } from '../ui/Switch'
import { errorBanner, errorText } from './Banners'
import { useDataEvent } from './dataEvents'
import { links, navigate } from './router'
import { refreshSeasons, useDownload, useSettings } from './store'
import '../views/import/status.css'

/**
 * The sidebar footer's status rows (01 §1.2): the watch folder (improvement 13) and the season data (improvement 16),
 * each with its popover. Both follow main's `watchStatus` / `dataStatus` events.
 */

export function updatedLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400000)
  if (diff === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (diff === 1) return 'yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function lastUpdatedLong(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (now.toDateString() === d.toDateString()) return `Today, ${time}`
  if (new Date(now.getTime() - 86400000).toDateString() === d.toDateString()) return `Yesterday, ${time}`
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function ago(iso: string | null): string {
  if (!iso) return 'Not yet'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} hr ago` : new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Follows main's data status for one season. */
export function useDataStatus(season: number | null): [DataStatus | null, () => void] {
  const [status, setStatus] = useState<DataStatus | null>(null)
  // As in useWatchStatus: a pushed status beats a fetch that was already in flight.
  const seq = useRef(0)
  const load = useCallback(() => {
    if (season === null) return
    const at = ++seq.current
    rawApi.dataStatus(season).then(
      (s) => at === seq.current && setStatus(s),
      () => at === seq.current && setStatus(null)
    )
  }, [season])
  useEffect(load, [load])
  useDataEvent(['season', 'settings'], load)
  useEffect(
    () =>
      rawApi.onApiEvent((e) => {
        if (e.type === 'dataStatus' && e.status.season === season) {
          seq.current++
          // Progress events carry no dates; keep the last known ones.
          setStatus((cur) => (e.status.state === 'updating' && cur ? { ...e.status, downloadedAt: cur.downloadedAt, hasParticipation: cur.hasParticipation } : e.status))
          if (e.status.state !== 'updating') void refreshSeasons()
        }
      }),
    [season]
  )
  return [status, load]
}

/** Follows main's watch-folder status. */
export function useWatchStatus(): [WatchStatus | null, () => void] {
  const [status, setStatus] = useState<WatchStatus | null>(null)
  // A pushed status is newer than any fetch already in flight (main pushes after it logs the import and sends
  // `changed`), so a fetch that started before the last push is dropped.
  const seq = useRef(0)
  const load = useCallback(() => {
    const at = ++seq.current
    rawApi.watchStatus().then(
      (s) => at === seq.current && setStatus(s),
      () => at === seq.current && setStatus(null)
    )
  }, [])
  useEffect(load, [load])
  useDataEvent(['film', 'settings'], load)
  useEffect(
    () =>
      rawApi.onApiEvent((e) => {
        if (e.type === 'watchStatus') {
          seq.current++
          setStatus(e.status)
        }
      }),
    []
  )
  return [status, load]
}

/** "Update Now" for a season: re-downloads it and reports a failure in a banner. */
export async function updateSeason(season: number): Promise<void> {
  try {
    const st = await rawApi.updateSeasonNow(season)
    if (st.state === 'failed') errorBanner(`Couldn’t update ${season} data`, st.error ?? 'The download failed.')
  } catch (e) {
    errorBanner(`Couldn’t update ${season} data`, e)
  }
  void refreshSeasons()
}

export function DataStatusRow({ season }: { season: number }) {
  const [status] = useDataStatus(season)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dl = useDownload(season)
  const settings = useSettings()
  const updating = !!dl?.busy || status?.state === 'updating'
  const done = status?.state === 'updating' ? status.done : (dl?.progress?.done ?? 0)
  const total = status?.state === 'updating' ? status.total : (dl?.progress?.total ?? 5)
  const step = status?.state === 'updating' ? (status.step ?? '') : (dl?.progress?.step ?? '')
  const failed = !updating && (status?.state === 'failed' || !!dl?.error)
  const notDownloaded = !updating && (!status || status.state === 'notDownloaded')
  let text: string
  if (updating) text = `Updating ${season} data… ${done} of ${total || 5}`
  else if (failed) text = `Couldn’t update ${season} data`
  else if (notDownloaded) text = `${season} data not downloaded`
  else text = `${season} data · Updated ${updatedLabel(status!.downloadedAt)}`
  return (
    <>
      <div
        ref={ref}
        className="sidebar-footer__row"
        data-test="data-status"
        data-state={updating ? 'updating' : failed ? 'failed' : notDownloaded ? 'notDownloaded' : 'upToDate'}
        role="button"
        aria-expanded={open}
        title={text}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        {updating ? <ProgressRing value={total ? done / total : 0} size={14} /> : <Icon name={failed ? 'circle-alert' : 'database'} size={14} className={failed ? 'c-danger' : undefined} />}
        <span className="sidebar-footer__text">{text}</span>
      </div>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="top" width={300} test="data-status-popover">
        <div className="status-popover">
          <div className="popover__title">{season} season data</div>
          <dl className="popover__rows">
            <dt>Last updated</dt>
            <dd>{notDownloaded ? 'Not downloaded' : lastUpdatedLong(status?.downloadedAt ?? null)}</dd>
            <dt>Source</dt>
            <dd>nflverse</dd>
            <dt>On-field lineups</dt>
            <dd>{status?.hasParticipation ? 'Published' : 'Not published yet'}</dd>
          </dl>
          {failed && status?.error && <p className="status-popover__error selectable">{errorText(status.error)}</p>}
          {settings && (
            <div className="popover__switch-row">
              <span>Update automatically during the season</span>
              <Switch size="sm" label="Update automatically during the season" checked={settings.autoUpdateSeasons} onChange={(v) => void api.saveSettings({ autoUpdateSeasons: v })} test="auto-update-switch" />
            </div>
          )}
          {updating ? (
            <div className="popover__progress">
              <ProgressBar value={total ? done / total : null} label={`Updating ${season} data`} />
              <span className="t-footnote c-label-2">{step ? `${step}…` : 'Updating…'}</span>
            </div>
          ) : (
            <div className="popover__actions status-popover__actions">
              <Button label={notDownloaded ? 'Download' : 'Update Now'} onClick={() => void updateSeason(season)} test="data-update-now" />
            </div>
          )}
          <SettingsLink label="Data Settings…" onClick={() => (setOpen(false), void window.shell.openSettings('data'))} />
        </div>
      </Popover>
    </>
  )
}

export function watchRowText(status: WatchStatus): { icon: ReactNode; text: string } {
  if (status.state === 'importing' && status.current) {
    const { title, done, total } = status.current
    return { icon: <ProgressRing value={total ? done / total : 0} size={14} />, text: total ? `Importing ${title}… ${done} of ${total}` : `Importing ${title}…` }
  }
  if (status.state === 'missing') return { icon: <Icon name="triangle-alert" size={14} className="c-warning" />, text: 'Watch folder not found' }
  if (status.state === 'paused') return { icon: <Icon name="folder-sync" size={14} className="c-label-4" />, text: 'Watch folder paused' }
  if (status.justImported > 0) return { icon: <Icon name="folder-sync" size={14} />, text: `${status.justImported} ${status.justImported === 1 ? 'game' : 'games'} imported` }
  return { icon: <Icon name="folder-sync" size={14} />, text: `Watching “${status.folderName ?? status.folder}”` }
}

/** The game behind each recent import, for "DAL @ PHI · Wk 1". */
function useGames(open: boolean, recent: ImportLogEntry[]): Map<string, GameInfo> {
  const [games, setGames] = useState(new Map<string, GameInfo>())
  const key = recent.map((r) => r.gameId).join()
  useEffect(() => {
    if (!open || !recent.some((r) => r.gameId && !games.has(r.gameId))) return
    rawApi.filmLibrary().then((list) => setGames(new Map(list.map((f) => [f.game.gameId, f.game]))), () => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])
  return games
}

export function RecentImportRow({ entry, game, onOpen }: { entry: ImportLogEntry; game?: GameInfo; onOpen?: () => void }) {
  const folder = entry.folder.split(/[\\/]/).filter(Boolean).pop() ?? entry.folder
  const failed = entry.state === 'failed'
  return (
    <button
      type="button"
      className="status-import-row"
      disabled={!onOpen || failed || !entry.gameId}
      title={failed ? `${folder}: ${entry.error ?? 'Couldn’t import'}` : entry.folder}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
    >
      <span className="status-import-row__icon">{failed ? <Icon name="circle-alert" size={14} className="c-danger" /> : entry.suspectClips > 0 ? <Icon name="triangle-alert" size={14} className="c-warning" /> : <Icon name="film" size={14} />}</span>
      <span className="status-import-row__text">
        <span className="status-import-row__title">{game ? gameTitle(game) : folder}</span>
        <span className="status-import-row__sub">
          {failed ? (entry.error ?? 'Couldn’t import') : [game ? weekShort(game) : null, `${entry.clipCount} clips`, entry.suspectClips ? `${entry.suspectClips} need a check` : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="status-import-row__when">{ago(entry.at)}</span>
    </button>
  )
}

export function WatchStatusRow() {
  const [status, load] = useWatchStatus()
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const games = useGames(open, status?.recent ?? [])
  if (!status || status.state === 'off' || !status.folder) return null
  const { icon, text } = watchRowText(status)
  const checkNow = async () => {
    setChecking(true)
    try {
      await rawApi.checkWatchFolder()
    } catch (e) {
      errorBanner('Couldn’t check the watch folder', e)
    }
    setChecking(false)
    load()
  }
  return (
    <>
      <div
        ref={ref}
        className="sidebar-footer__row"
        data-test="watch-status"
        data-state={status.state}
        role="button"
        aria-expanded={open}
        title={text}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        {icon}
        <span className="sidebar-footer__text">{text}</span>
      </div>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} placement="top" width={300} test="watch-status-popover">
        <div className="status-popover">
          <div className="popover__title">Watch folder</div>
          <div className="popover__path t-mono-sm selectable">{status.folder}</div>
          <dl className="popover__rows">
            <dt>Status</dt>
            <dd>{status.state === 'importing' ? 'Importing' : status.state === 'missing' ? 'Folder not found' : status.state === 'paused' ? 'Paused' : 'Watching'}</dd>
            <dt>Last checked</dt>
            <dd>{ago(status.lastChecked)}</dd>
          </dl>
          {status.state === 'importing' && status.current && (
            <div className="popover__progress status-popover__importing">
              <ProgressBar value={status.current.total ? status.current.done / status.current.total : null} label={`Importing ${status.current.title}`} />
              <span className="t-footnote c-label-2">
                Importing {status.current.title}
                {status.current.total ? `… ${status.current.done} of ${status.current.total}` : '…'}
              </span>
            </div>
          )}
          {status.unmatched.length > 0 && (
            <div className="status-popover__section">
              <div className="status-popover__heading">Not imported</div>
              {status.unmatched.slice(0, 3).map((u) => (
                <div key={u.folder} className="status-popover__unmatched" title={u.reason}>
                  <Icon name="triangle-alert" size={12} className="c-warning" />
                  <span>
                    <strong>“{u.folder}”</strong> {u.reason}
                  </span>
                </div>
              ))}
            </div>
          )}
          {status.recent.length > 0 && (
            <div className="status-popover__section">
              <div className="status-popover__heading">Recent imports</div>
              {status.recent.slice(0, 5).map((r) => (
                <RecentImportRow
                  key={r.id}
                  entry={r}
                  game={r.gameId ? games.get(r.gameId) : undefined}
                  onOpen={() => {
                    if (!r.gameId) return
                    setOpen(false)
                    navigate(links.tape(r.gameId, r.team ?? ''))
                  }}
                />
              ))}
            </div>
          )}
          <div className="popover__actions status-popover__actions">
            <Button variant="borderless" label="Show in Finder" disabled={status.state === 'missing'} onClick={() => status.folder && window.shell.showItemInFolder(status.folder)} />
            {status.state === 'paused' ? (
              <Button label="Resume" onClick={() => void api.saveSettings({ watchPaused: false })} />
            ) : (
              <Button label="Check Now" loading={checking} disabled={status.state === 'importing'} onClick={() => void checkNow()} test="watch-check-now" />
            )}
          </div>
          <SettingsLink label="Watch Folder Settings…" onClick={() => (setOpen(false), void window.shell.openSettings('film'))} />
        </div>
      </Popover>
    </>
  )
}

/** The last row of a status popover, like Control Center's "… Settings…". */
function SettingsLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="status-popover__settings" onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {label}
    </button>
  )
}
