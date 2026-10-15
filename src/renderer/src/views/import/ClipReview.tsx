import { useEffect, useMemo, useRef, useState } from 'react'
import { fileUrl } from '@shared/api'
import type { Play } from '@shared/types'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { downDistance } from '../../format'
import { ANGLE_LABEL, clipName, clockLabel, lengthLabel, playLine, type SheetRow } from './importModel'
import { candidatePlays, type SmartMatch } from './useSmartMatch'
import './review.css'

/**
 * Check Clips: one clip at a time, playing, beside the plays it can be. For clips cut by hand, where order and length
 * can't settle every match. The likeliest play is highlighted; ↩ takes it, 1–9 takes another, ⌫ says the clip isn't a
 * play. Each pick pins that clip and the clips around it are placed again, so the next suggestion is usually right.
 * Only the clips smart matching wasn't sure of are stepped through; ← and → go through all of them.
 */

const SHOWN = 30

export function ClipReview({
  rows,
  match,
  durations,
  startPath,
  onClose
}: {
  rows: SheetRow[]
  match: SmartMatch
  durations: Record<string, number | null>
  startPath?: string | null
  onClose: () => void
}) {
  const [path, setPath] = useState<string | null>(() => startPath ?? rows.find((r) => match.needsLook.has(r.path))?.path ?? rows[0]?.path ?? null)
  const [everyPlay, setEveryPlay] = useState(false)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const index = rows.findIndex((r) => r.path === path)
  const row = index >= 0 ? rows[index] : null
  const angleRows = row ? rows.filter((r) => r.angle === row.angle) : []
  const angleIndex = row ? angleRows.indexOf(row) : -1
  const placement = row ? match.placements?.get(row.path) : undefined
  const left = match.needsLook.size

  const pool = useMemo(() => (everyPlay ? match.plays.filter((p) => p.playType !== '') : match.ordered), [everyPlay, match.plays, match.ordered])
  const candidates = useMemo(() => {
    if (index < 0) return []
    const all = candidatePlays(rows, index, pool, match.anchors)
    const shown = all.slice(0, SHOWN)
    // The suggestion is always listed, even past the first few.
    const sug = row?.playId ?? null
    if (sug !== null && !shown.some((p) => p.playId === sug)) {
      const p = all.find((x) => x.playId === sug) ?? match.plays.find((x) => x.playId === sug)
      if (p) shown.push(p)
    }
    return shown
  }, [rows, index, pool, match.anchors, row?.playId, match.plays])

  // A new clip highlights its suggestion and starts from the top.
  useEffect(() => {
    setHighlight(row?.playId ?? candidates[0]?.playId ?? null)
    setPaused(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  useEffect(() => {
    if (highlight === null) return
    list.current?.querySelector(`[data-play="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  // After a pick, move on once the other clips are placed again: to the next clip still worth a look, else the next.
  const [advanceFrom, setAdvanceFrom] = useState<number | null>(null)
  useEffect(() => {
    if (advanceFrom === null) return
    setAdvanceFrom(null)
    const order = [...rows.slice(advanceFrom + 1), ...rows.slice(0, advanceFrom + 1)]
    const next = order.find((r) => match.needsLook.has(r.path))?.path ?? rows[advanceFrom + 1]?.path
    if (next) setPath(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceFrom])

  const pick = (playId: number | null) => {
    if (!row) return
    match.link(index, playId)
    setAdvanceFrom(index)
  }

  const step = (delta: number) => {
    const next = rows[index + delta]
    if (next) setPath(next.path)
  }

  const togglePlay = () => {
    const v = video.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return
      const ids = candidates.map((p) => p.playId)
      const at = highlight === null ? -1 : ids.indexOf(highlight)
      let handled = true
      if (e.key === 'Enter') pick(highlight)
      else if (/^[1-9]$/.test(e.key) && candidates[Number(e.key) - 1]) pick(candidates[Number(e.key) - 1].playId)
      else if (e.key === 'Backspace' || e.key === 'Delete') pick(null)
      else if (e.key === 'ArrowDown') setHighlight(ids[Math.min(ids.length - 1, at + 1)] ?? null)
      else if (e.key === 'ArrowUp') setHighlight(ids[Math.max(0, at - 1)] ?? null)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === ' ') togglePlay()
      else if (e.key === 'Escape') onClose()
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!row) return null
  const length = durations[row.path]
  const pinned = match.anchors.has(row.path)
  const status = pinned ? 'Matched by you' : placement && !placement.sure ? 'Needs a look' : 'Placed from order and length'

  return (
    <div className="clip-review" data-test="clip-review">
      <div className="clip-review__head">
        <Button size="sm" variant="borderless" icon="chevron-left" label="All Clips" onClick={onClose} test="clip-review-done" />
        <div className="clip-review__title">
          <span className="clip-review__name" title={row.path}>
            {clipName(row)}
          </span>
          <span className="clip-review__meta">
            {ANGLE_LABEL[row.angle]} clip {angleIndex + 1} of {angleRows.length}
            {length ? ` · ${lengthLabel(length)}` : ''} · {status}
          </span>
        </div>
        <span className="clip-review__left" data-test="clip-review-left">
          {left ? `${left} ${left === 1 ? 'clip' : 'clips'} to check` : (
            <>
              <Icon name="circle-check" size={12} /> Every clip is placed
            </>
          )}
        </span>
      </div>

      <div className="clip-review__body">
        <div className="clip-review__stage">
          <video
            key={row.path}
            ref={video}
            className="clip-review__video"
            src={fileUrl(row.path)}
            autoPlay
            muted
            loop
            playsInline
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onClick={togglePlay}
          />
          <div className="clip-review__transport">
            <Button size="sm" variant="borderless" iconOnly icon="chevron-left" label="Previous Clip" title="Previous clip (←)" disabled={index === 0} onClick={() => step(-1)} />
            <Button size="sm" variant="borderless" iconOnly icon={paused ? 'play' : 'pause'} label={paused ? 'Play' : 'Pause'} title="Play or pause (Space)" onClick={togglePlay} />
            <Button size="sm" variant="borderless" iconOnly icon="chevron-right" label="Next Clip" title="Next clip (→)" disabled={index === rows.length - 1} onClick={() => step(1)} />
          </div>
        </div>

        <div className="clip-review__plays">
          <div className="clip-review__plays-head">
            <span>Which play is this?</span>
            <Button size="sm" variant="borderless" label={everyPlay ? 'Plays You Cut' : 'Every Play'} title={everyPlay ? 'Only the plays your clips were cut from' : 'Include special teams, penalties and both teams’ snaps'} onClick={() => setEveryPlay(!everyPlay)} />
          </div>
          <div className="clip-review__list" ref={list} role="listbox" aria-label="Plays">
            {candidates.length === 0 && <div className="clip-review__empty">No plays fit between the clips around this one. Try Every Play, or mark it as not a play.</div>}
            {candidates.map((p, i) => (
              <PlayOption
                key={p.playId}
                play={p}
                n={i < 9 ? i + 1 : null}
                suggested={p.playId === row.playId && !pinned}
                current={pinned && p.playId === match.anchors.get(row.path)}
                highlighted={p.playId === highlight}
                onHover={() => setHighlight(p.playId)}
                onPick={() => pick(p.playId)}
              />
            ))}
          </div>
          <div className="clip-review__foot">
            <button type="button" className="clip-review__none" onClick={() => pick(null)} data-test="clip-review-none">
              Not a play <kbd>⌫</kbd>
            </button>
            <span className="clip-review__hint">
              <kbd>↩</kbd> highlighted · <kbd>1</kbd>–<kbd>9</kbd> pick · <kbd>←</kbd><kbd>→</kbd> clips
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PlayOption({
  play,
  n,
  suggested,
  current,
  highlighted,
  onHover,
  onPick
}: {
  play: Play
  n: number | null
  suggested: boolean
  current: boolean
  highlighted: boolean
  onHover: () => void
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={highlighted}
      className="clip-review__play"
      data-play={play.playId}
      data-highlighted={highlighted || undefined}
      data-test="clip-review-play"
      onMouseMove={onHover}
      onClick={onPick}
    >
      <span className="clip-review__key">{n ?? ''}</span>
      <span className="clip-review__clock">{clockLabel(play)}</span>
      <span className="clip-review__team">{play.posteam}</span>
      <span className="clip-review__down">{downDistance(play)}</span>
      <span className="clip-review__desc" title={play.desc}>
        {playLine(play)}
      </span>
      {(suggested || current) && <span className="clip-review__tag">{current ? 'Yours' : 'Likely'}</span>}
    </button>
  )
}
