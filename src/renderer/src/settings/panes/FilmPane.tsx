import { useCallback, useEffect, useState } from 'react'
import type { FfmpegStatus, FilmLibraryItem, ImportLogEntry } from '@shared/types'
import { api, rawApi } from '../../api'
import { Button } from '../../ui/Button'
import { FormGroup, FormRow } from '../../ui/GroupedForm'
import { Icon } from '../../ui/Icon'
import { ProgressBar } from '../../ui/Progress'
import { Switch } from '../../ui/Switch'
import { errorBanner } from '../../shell/Banners'
import { Loading } from '../../shell/Screen'
import { ago, RecentImportRow, useWatchStatus } from '../../shell/StatusRows'
import { saveSettings, useSettings } from '../../shell/store'
import { links } from '../../shell/router'

/**
 * Film & Import: the watch folder (improvement 13) with its status and the last imports, and the built-in ffmpeg
 * that converts clips and exports video (improvement 15).
 */
export function FilmPane() {
  const settings = useSettings()
  const [watch, reloadWatch] = useWatchStatus()
  const [log, setLog] = useState<ImportLogEntry[] | null>(null)
  const [films, setFilms] = useState<Map<string, FilmLibraryItem>>(new Map())
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null | undefined>(undefined)
  const [checking, setChecking] = useState(false)

  const loadLog = useCallback(() => {
    rawApi.importLog(6).then(setLog, () => setLog([]))
    rawApi.filmLibrary().then((list) => setFilms(new Map(list.map((f) => [f.game.gameId, f]))), () => undefined)
  }, [])
  useEffect(loadLog, [loadLog])
  useEffect(() => {
    rawApi.ffmpegStatus().then(setFfmpeg, () => setFfmpeg(null))
  }, [])
  // Imports finish in main; the log follows the watch status and film changes.
  useEffect(
    () =>
      rawApi.onApiEvent((e) => {
        if ((e.type === 'changed' && e.kinds.includes('film')) || (e.type === 'activity' && e.activity.kind === 'import' && e.activity.state !== 'running')) loadLog()
      }),
    [loadLog]
  )
  if (!settings) return <Loading />

  const folder = settings.watchFolder
  const choose = async () => {
    try {
      await api.chooseWatchFolder()
      reloadWatch()
    } catch (e) {
      errorBanner('Couldn’t set the watch folder', e)
    }
  }
  const checkNow = async () => {
    setChecking(true)
    try {
      await rawApi.checkWatchFolder()
    } catch (e) {
      errorBanner('Couldn’t check the watch folder', e)
    }
    setChecking(false)
    reloadWatch()
    loadLog()
  }

  return (
    <>
      <FormGroup
        title="Watch Folder"
        footnote="Put each game in its own folder inside the watch folder, named for the game: “DAL at PHI” or “2025 Wk 1 DAL @ PHI”. A game is imported once its clips stop changing, and its film is updated when clips are added later."
      >
        <FormRow
          label="Watch folder"
          description={folder ? <span className="t-mono-sm selectable settings-path">{folder}</span> : 'Off. Choose a folder and new games in it are imported automatically.'}
          test="watch-folder-row"
        >
          {folder && <Button size="sm" variant="borderless" label="Stop Watching" onClick={() => void saveSettings({ watchFolder: null, watchPaused: false })} test="watch-clear" />}
          <Button size="sm" label={folder ? 'Change…' : 'Choose…'} onClick={() => void choose()} test="watch-choose" />
        </FormRow>
        {folder && (
          <>
            <FormRow label="Pause watching" description="New folders wait until you resume.">
              <Switch checked={settings.watchPaused} onChange={(v) => void saveSettings({ watchPaused: v })} label="Pause watching" test="watch-pause" />
            </FormRow>
            <FormRow label="Status" description={watchDescription()} test="watch-status-row">
              <Button size="sm" label="Check Now" loading={checking} disabled={!watch || watch.state === 'paused' || watch.state === 'importing'} onClick={() => void checkNow()} />
            </FormRow>
          </>
        )}
      </FormGroup>

      {((log && log.length > 0) || (watch?.unmatched.length ?? 0) > 0) && (
        <FormGroup title="Recent Imports" footnote="Click a game to open its film in the main window.">
          {watch?.unmatched.map((u) => (
            <FormRow
              key={u.folder}
              label={
                <span className="settings-unmatched">
                  <Icon name="triangle-alert" size={14} className="c-warning" />“{u.folder}” wasn’t imported
                </span>
              }
              description={u.reason}
            />
          ))}
          <div className="settings-imports">
            {log?.map((entry) => (
              <RecentImportRow
                key={entry.id}
                entry={entry}
                game={entry.gameId ? films.get(entry.gameId)?.game : undefined}
                onOpen={entry.gameId ? () => window.shell.showInMain(links.tape(entry.gameId!, entry.team ?? films.get(entry.gameId!)?.team ?? '')) : undefined}
              />
            ))}
          </div>
        </FormGroup>
      )}

      <FormGroup title="Converting and Exporting" footnote="Clips the player can’t open (MKV, AVI, TS and others) are copied to MP4 when you import them; your originals aren’t touched. The same ffmpeg exports reels and cut-ups as video.">
        <FormRow label="Converter" description={ffmpegDescription(ffmpeg)} test="ffmpeg-status">
          {ffmpeg !== undefined && <Icon name={ffmpeg?.path ? 'circle-check' : 'circle-alert'} size={16} className={ffmpeg?.path ? 'c-label-2' : 'c-danger'} />}
        </FormRow>
        {ffmpeg?.path && (
          <FormRow
            label="Video encoding"
            description={
              ffmpeg.encoders.h264_videotoolbox
                ? 'Hardware H.264 on this Mac’s media engine (VideoToolbox).'
                : ffmpeg.encoders.libx264
                  ? 'Software H.264 (libx264). Exports take longer than with hardware encoding.'
                  : 'No H.264 encoder: clips can be converted, but video can’t be exported.'
            }
          >
            <Icon
              name={ffmpeg.encoders.h264_videotoolbox || ffmpeg.encoders.libx264 ? 'circle-check' : 'triangle-alert'}
              size={16}
              className={ffmpeg.encoders.h264_videotoolbox || ffmpeg.encoders.libx264 ? 'c-label-2' : 'c-warning'}
            />
          </FormRow>
        )}
      </FormGroup>
    </>
  )

  function watchDescription() {
    if (!watch) return <>Checking…</>
    if (watch.state === 'importing' && watch.current) {
      const { title, done, total } = watch.current
      return (
        <span className="settings-progress">
          <ProgressBar value={total ? done / total : null} width={180} label={`Importing ${title}`} />
          <span>
            Importing {title}
            {total ? `… ${done} of ${total}` : '…'}
          </span>
        </span>
      )
    }
    if (watch.state === 'missing') return <span className="c-warning">The folder can’t be found. Reconnect its drive or choose another folder.</span>
    if (watch.state === 'paused') return <>Paused</>
    return <>Watching · Last checked {ago(watch.lastChecked).toLowerCase()}</>
  }
}

function ffmpegDescription(f: FfmpegStatus | null | undefined): string {
  if (f === undefined) return 'Checking…'
  if (!f?.path) return 'Not available. Clips in other formats can’t be converted here; convert them to MP4 before importing.'
  const version = f.version ? ` ${f.version}` : ''
  if (f.source === 'bundled') return `Built-in ffmpeg${version}. Ready.`
  if (f.source === 'env') return `ffmpeg${version} from ${f.path} (set by ALL22_FFMPEG). Ready.`
  return `ffmpeg${version} installed on this Mac (${f.path}). Ready.`
}
