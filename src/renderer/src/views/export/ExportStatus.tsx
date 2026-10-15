import { useEffect, useRef, useState } from 'react'
import { rawApi } from '../../api'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Popover } from '../../ui/Popover'
import { ProgressBar, ProgressRing } from '../../ui/Progress'
import { cancelExport, dismissExport, exportFileName, type ExportRun, progressOf, tryAgain, useExports } from './exportModel'

/**
 * The sidebar footer's third row (03 §11.7, 01 amendment A6): the running export with its progress, queued ones,
 * and the last result for 10 minutes. Its popover cancels, reveals, plays or retries.
 */
export function ExportStatusRow() {
  const runs = useExports()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [, tick] = useState(0)
  const running = runs.filter((r) => r.activity.state === 'running')
  const active = running.find((r) => r.activity.detail !== 'Waiting…') ?? null
  const waiting = running.filter((r) => r !== active)
  const last = [...runs].reverse().find((r) => r.activity.state !== 'running') ?? null

  // Time-left estimates refresh every few seconds while one runs.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => tick((n) => n + 1), 2000)
    return () => clearInterval(t)
  }, [active])

  if (!runs.length) return null
  const name = (r: ExportRun) => exportFileName(r).replace(/\.mp4$/, '')
  let icon = <Icon name="circle-check" size={14} className="c-label-3" />
  let text = ''
  let state = 'done'
  if (active) {
    const pct = Math.round(progressOf(active.activity) * 100)
    icon = <ProgressRing value={progressOf(active.activity)} size={14} />
    text = active.activity.detail === 'Preparing…' ? `Exporting “${name(active)}”…` : `Exporting “${name(active)}”… ${pct}%`
    state = 'running'
  } else if (waiting.length) {
    icon = <ProgressRing value={0} size={14} />
    text = `${waiting.length} ${waiting.length === 1 ? 'export' : 'exports'} waiting`
    state = 'running'
  } else if (last?.activity.state === 'failed') {
    icon = <Icon name="circle-alert" size={14} className="c-danger" />
    text = 'Export failed'
    state = 'failed'
  } else if (last) {
    text = `Exported “${name(last)}”`
  }

  const close = () => {
    setOpen(false)
    // Clicking a finished row acknowledges it.
    if (!running.length) runs.forEach((r) => dismissExport(r.activity.id))
  }

  return (
    <>
      <div
        ref={ref}
        className="sidebar-footer__row"
        data-test="export-status"
        data-state={state}
        role="button"
        aria-expanded={open}
        title={text}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {icon}
        <span className="sidebar-footer__text">{text}</span>
      </div>
      <Popover anchor={ref} open={open} onClose={close} placement="top" width={300} test="export-status-popover">
        <div className="screen-export-status">
          <div className="popover__title">Export</div>
          {[...(active ? [active] : []), ...waiting, ...runs.filter((r) => r.activity.state !== 'running').reverse()].slice(0, 4).map((r) => (
            <RunItem key={r.activity.id} run={r} />
          ))}
        </div>
      </Popover>
    </>
  )
}

function timeLeft(run: ExportRun): string {
  const p = progressOf(run.activity)
  const elapsed = (Date.now() - run.startedAt) / 1000
  if (elapsed < 5 || p <= 0.01) return ''
  const left = (elapsed / p) * (1 - p)
  if (left < 45) return 'less than a minute left'
  const min = Math.round(left / 60)
  return `about ${min} min left`
}

function RunItem({ run }: { run: ExportRun }) {
  const a = run.activity
  const file = exportFileName(run)
  if (a.state === 'running') {
    const waiting = a.detail === 'Waiting…' || a.detail === 'Preparing…'
    const left = waiting ? '' : timeLeft(run)
    return (
      <div className="export-status__item">
        <span className="export-status__file">{file}</span>
        <ProgressBar value={waiting ? null : progressOf(a)} label={`Exporting ${file}`} />
        <span className="export-status__detail">{[a.detail, left].filter(Boolean).join(' · ')}</span>
        {!a.id.startsWith('local-') && (
          <div className="export-status__actions">
            <Button label="Cancel Export" onClick={() => cancelExport(a.id)} test="export-cancel" />
          </div>
        )}
      </div>
    )
  }
  if (a.state === 'failed') {
    return (
      <div className="export-status__item">
        <span className="export-status__file">{file}</span>
        <span className="export-status__error">{a.error ?? 'The export failed.'}</span>
        {run.sheet && (
          <div className="export-status__actions">
            <Button label="Try Again" onClick={() => tryAgain(run)} />
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="export-status__item">
      <span className="export-status__file">{file}</span>
      {a.detail && <span className="export-status__detail">{a.detail}</span>}
      {a.resultPath && (
        <div className="export-status__actions">
          <Button label="Show in Finder" onClick={() => void rawApi.revealPath(a.resultPath!)} />
          <Button variant="borderless" label="Play" onClick={() => void rawApi.openPath(a.resultPath!).catch(() => {})} />
        </div>
      )}
    </div>
  )
}
