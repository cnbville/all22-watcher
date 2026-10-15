import type { CSSProperties } from 'react'
import { critCount, gradeScore, tallyOf } from '@shared/stats'
import { sideOfGroup } from '@shared/teams'
import type { Grade } from '@shared/types'
import { downDistance, lastName, quarterLabel } from '../../../format'
import { Avatar } from '../../../ui/Avatar'
import { Button } from '../../../ui/Button'
import { RingGauge } from '../../../ui/charts/RingGauge'
import { GRADE_GLYPH } from '../../../ui/Grade'
import { gradeGlyphScore, heatVars, ink } from '../../../ui/heat'
import { Keycap } from '../../../ui/Keycap'
import { noMouseFocus } from '../../../ui/keyboard'
import { ProgressBar } from '../../../ui/Progress'
import { TextField } from '../../../ui/TextField'
import { tagsFor } from '../grading'
import type { Room } from '../model'
import { SmallToggle, TagChip } from './GradingRow'

const BIG: { grade: Grade; key: string; label: string; test: string }[] = [
  { grade: -1, key: '−', label: 'Minus', test: 'grade-minus' },
  { grade: 0, key: '0', label: 'Zero', test: 'grade-zero' },
  { grade: 1, key: '=', label: 'Plus', test: 'grade-plus' }
]

/** The Focus panel (02 §9.5): the focus player's game so far and this snap's grade, toggles, tags and note. */
export function FocusPanel({ room }: { room: Room }) {
  const focus = room.focus!
  const { player } = focus
  const entries = focus.snaps.map((p) => room.data.entryOf(p.playId, player.id)).filter((e): e is NonNullable<typeof e> => !!e)
  const tally = tallyOf(entries)
  const score = gradeScore(tally)
  const crit = critCount(entries)
  const side = sideOfGroup(player.group)
  const sideText = side === 'special' ? 'special teams' : side
  const detail = [player.jersey ? `#${player.jersey}` : null, player.depthPos || player.position || null, `${player.team || room.team} ${sideText}`].filter(Boolean).join(' · ')
  const current = room.current
  const onSnap = room.onFocusSnap
  const entry = room.targetEntry
  const grade = entry?.grade ?? null
  const tags = entry?.tags ?? []
  const tagDefs = tagsFor(room.tags, player)
  const showOff = !room.film.hasParticipation || !!entry?.offField

  let snapSection: React.ReactNode
  if (!focus.snaps.length) {
    snapSection = <div className="focus-panel__none">No snaps in this game</div>
  } else if (!onSnap || !current) {
    const next = focus.snaps.find((s) => !current || room.plays.indexOf(s) > room.plays.indexOf(current)) ?? focus.snaps[0]
    snapSection = (
      <div className="focus-panel__not-snap">
        <div className="focus-panel__none">Not one of {player.name}’s snaps</div>
        <Button variant="borderless" size="sm" label="Go to Next Snap" onClick={() => room.goTo(next.playId, { mouse: true })} />
      </div>
    )
  } else {
    snapSection = (
      <>
        <div className="focus-panel__section-title">
          This snap · {quarterLabel(current.qtr)} {current.time}
          {current.down ? ` · ${downDistance(current)}` : ''}
        </div>
        <div className="big-grade" role="group" aria-label="Grade">
          {BIG.map((b) => (
            <div key={b.grade} className="big-grade__cell">
              <button
                type="button"
                className="big-grade__segment"
                aria-pressed={grade === b.grade}
                aria-label={b.label}
                title={`${b.label} (${b.key})`}
                data-test={b.test}
                style={heatVars(gradeGlyphScore(b.grade)) as CSSProperties}
                onMouseDown={noMouseFocus}
                onClick={() => room.grade(player.id, b.grade, { toggle: true })}
              >
                {GRADE_GLYPH[b.grade]}
              </button>
              <Keycap small>{b.key}</Keycap>
            </div>
          ))}
        </div>
        <div className="focus-panel__toggles">
          <SmallToggle
            size="md"
            icon="zap"
            label="Critical"
            keycap="!"
            on={!!entry?.critical}
            iconColor={entry?.critical ? (grade === null ? 'var(--label-3)' : ink(gradeGlyphScore(grade))) : undefined}
            title="Critical: counts double in the grade (!)"
            test="critical-toggle"
            onClick={() => room.toggleCritical(player.id)}
          />
          {showOff && (
            <SmallToggle
              size="md"
              icon="user-round-x"
              label="Not on Field"
              keycap="X"
              on={!!entry?.offField}
              title="Not on Field: wasn’t on the field for this snap (X)"
              test="off-field-toggle"
              onClick={() => room.toggleOffField(player.id)}
            />
          )}
        </div>
        {tagDefs.length > 0 && (
          <>
            <div className="focus-panel__label">Tags</div>
            <div className="focus-panel__tags">
              {tagDefs.map((t, i) => (
                <TagChip key={t.id} large tag={t} on={tags.includes(t.label)} keyLetter={i < 10 ? 'QWERTYUIOP'[i] : undefined} onClick={() => room.toggleTag(player.id, t)} />
              ))}
            </div>
          </>
        )}
        <div className="focus-panel__label">Note</div>
        <TextField
          size="lg"
          value={entry?.note ?? ''}
          commitOnBlur
          placeholder={`Note on ${lastName(player.name)} this snap`}
          test="player-note"
          onCommit={(v) => room.savePlayerNote(player.id, v)}
        />
      </>
    )
  }

  const count = (n: number, label: string, g: Grade | null) => (
    <div className="focus-panel__count">
      <span className="focus-panel__count-value" style={g === null ? undefined : { color: ink(gradeGlyphScore(g)) }}>
        {n}
      </span>
      <span className="focus-panel__count-label">{label}</span>
    </div>
  )

  return (
    <div className="focus-panel" data-test="focus-panel">
      <div className="focus-panel__head">
        <Avatar url={player.headshot} name={player.name} size={48} />
        <div className="focus-panel__who">
          <div className="focus-panel__name">{player.name}</div>
          <div className="focus-panel__detail">{detail}</div>
        </div>
        <Button variant="borderless" size="sm" label="Exit" title="Exit Player Focus (⇧G)" onClick={room.exitFocus} />
      </div>
      <div className="focus-panel__summary">
        <div className="focus-panel__ring">
          <RingGauge score={score} size={72} label="Game grade" />
        </div>
        <div className="focus-panel__counts">
          {count(tally.plus, 'Plus', 1)}
          {count(tally.zero, 'Zero', 0)}
          {count(tally.minus, 'Minus', -1)}
          <div className="focus-panel__count">
            <span className="focus-panel__count-value">⚡{crit}</span>
            <span className="focus-panel__count-label">Critical</span>
          </div>
        </div>
      </div>
      <div className="focus-panel__progress">
        <div className="focus-panel__progress-text">
          {focus.progress.graded} of {focus.progress.total} snaps graded
        </div>
        <ProgressBar value={focus.progress.total ? focus.progress.graded / focus.progress.total : 0} label="Graded snaps" />
      </div>
      <div className="focus-panel__snap">{snapSection}</div>
      <div className="focus-panel__footnote">Tag first, then grade: grading moves to the next snap. ↑ goes back.</div>
    </div>
  )
}
