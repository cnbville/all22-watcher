import { useLayoutEffect, useRef, useState } from 'react'
import type { Play } from '@shared/types'
import { downDistance, playKind, playTypeLabel, quarterLabel, shortDesc } from '../../../format'
import { Icon } from '../../../ui/Icon'
import { noMouseFocus } from '../../../ui/keyboard'
import type { Room } from '../model'
import { readPref, writePref } from '../prefs'

/** "−1 yd", "1 yd", "+8 yds", "No gain". */
export function yardsText(y: number | null): string | null {
  if (y === null) return null
  if (y === 0) return 'No gain'
  const abs = Math.abs(y)
  return `${y > 0 ? (abs === 1 ? '' : '+') : '−'}${abs} ${abs === 1 ? 'yd' : 'yds'}`
}

export function epaText(epa: number | null): string | null {
  if (epa === null) return null
  return `EPA ${epa >= 0 ? '+' : '−'}${Math.abs(epa).toFixed(2)}`
}

/** "2nd & Goal at DAL 3", "Kickoff at DAL 35", "1st & 10 at midfield". */
export function situationText(p: Play): string {
  const base = p.down ? downDistance(p) : playTypeLabel(p.playType)
  if (!p.yrdln) return base
  return /^(?:[A-Z]+ )?50$/.test(p.yrdln.trim()) ? `${base} at midfield` : `${base} at ${p.yrdln}`
}

/** The pinned play summary (02 §6.2): situation and Flag toggle, the result line, and the description. */
export function PlaySummary({ room }: { room: Room }) {
  const p = room.current!
  const flagged = !!room.currentNote?.flagged
  const kind = playKind(p)
  const parts = [
    `${p.posteam} ball`,
    kind === 'pass' ? 'Pass' : kind === 'run' ? 'Run' : playTypeLabel(p.playType),
    p.touchdown ? 'Touchdown' : null,
    p.turnover ? 'Turnover' : null,
    p.sack ? 'Sack' : null,
    p.penalty ? 'Penalty' : null,
    yardsText(p.yardsGained),
    epaText(p.epa)
  ].filter(Boolean)

  const [expanded, setExpanded] = useState(() => readPref('ui.tape.summary.expanded', false, 'session'))
  const desc = useRef<HTMLDivElement>(null)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = desc.current
    if (!el) return
    setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [p.playId, expanded])
  const toggleMore = () => {
    writePref('ui.tape.summary.expanded', !expanded, 'session')
    setExpanded(!expanded)
  }

  return (
    <div className="play-summary" data-test="play-summary">
      <div className="play-summary__a">
        <span className="play-summary__clock">
          {quarterLabel(p.qtr)} {p.time}
        </span>
        <span className="play-summary__sep"> · </span>
        <span className="play-summary__situation">{situationText(p)}</span>
        <span className="play-summary__spacer" />
        <button
          type="button"
          className="flag-toggle"
          data-test="flag-toggle"
          aria-pressed={flagged}
          title={flagged ? 'Unflag Play (F)' : 'Flag Play (F)'}
          onMouseDown={noMouseFocus}
          onClick={room.toggleFlag}
        >
          <Icon name="flag" size={12} filled={flagged} />
          <span>{flagged ? 'Flagged' : 'Flag'}</span>
        </button>
      </div>
      <div className="play-summary__b">{parts.join(' · ')}</div>
      <div ref={desc} className="play-summary__c selectable" data-expanded={expanded || undefined}>
        {shortDesc(p.desc)}
      </div>
      {(clamped || expanded) && (
        <button type="button" className="play-summary__more" onMouseDown={noMouseFocus} onClick={toggleMore}>
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  )
}
