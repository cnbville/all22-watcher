import type { CSSProperties } from 'react'
import type { GradeEntry, RosterPlayer, TagDef } from '@shared/types'
import { lastName } from '../../../format'
import { CriticalMark, GradeControl } from '../../../ui/Grade'
import { gradeGlyphScore, ink, tint } from '../../../ui/heat'
import { Icon, type IconName } from '../../../ui/Icon'
import { Keycap } from '../../../ui/Keycap'
import { noMouseFocus } from '../../../ui/keyboard'
import { TextField } from '../../../ui/TextField'
import { tagsFor } from '../grading'
import type { Room } from '../model'

/** One player's grading row (02 §6.3.3), expanded when selected (§6.3.4). */
export function GradingRow({
  room,
  player,
  index,
  selected,
  entry,
  narrow
}: {
  room: Room
  player: RosterPlayer
  index: number
  selected: boolean
  entry: GradeEntry | undefined
  narrow: boolean
}) {
  const grade = entry?.grade ?? null
  const critical = !!entry?.critical
  const offField = !!entry?.offField
  const starred = room.pinned.includes(player.id)
  const tagDefs = tagsFor(room.tags, player)
  const tags = entry?.tags ?? []
  const note = entry?.note ?? ''
  const showOffField = !room.film.hasParticipation || !(room.current?.offensePlayers.length || room.current?.defensePlayers.length) || offField
  const second = !selected && (tags.length > 0 || !!note.trim() || offField)

  return (
    <div
      className="grading-row"
      role="option"
      data-test="grading-row"
      data-player-id={player.id}
      aria-selected={selected}
      data-critical={critical ? 'true' : 'false'}
      data-off-field={offField ? 'true' : 'false'}
      data-two-line={second || undefined}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input, [contenteditable]')) noMouseFocus(e)
      }}
      onClick={(e) => {
        if (e.metaKey) return room.enterFocus(player.id)
        if ((e.target as HTMLElement).closest('button, input, a')) return
        room.select(player.id)
        room.refocus()
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, a')) return
        room.enterFocus(player.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        room.gradingRowMenu(e, player)
      }}
    >
      <div className="grading-row__main">
        <span className="grading-row__key">{!room.drawMode && index < 9 ? index + 1 : ''}</span>
        <span className="grading-row__jersey">{player.jersey}</span>
        <span className="grading-row__name-cell">
          <a
            className="grading-row__name"
            data-test="grading-player-name"
            href={`#player/${player.id}`}
            onClick={(e) => {
              e.preventDefault()
              if (e.metaKey) return room.enterFocus(player.id)
              room.openPlayer(player.id)
            }}
          >
            {player.name}
          </a>
          {starred && <Icon name="star" size={10} filled className="grading-row__star" />}
        </span>
        {!narrow && <span className="grading-row__pos">{player.depthPos || player.position}</span>}
        <span className="grading-row__critical" data-test={critical ? 'critical-mark' : undefined}>
          {critical && <CriticalMark grade={grade} />}
        </span>
        <span className="grading-row__control" data-off={offField || undefined}>
          <GradeControl
            value={grade}
            onChange={(g) => {
              room.select(player.id)
              room.grade(player.id, g, { toggle: true })
              room.refocus()
            }}
          />
        </span>
      </div>
      {second && (
        <div className="grading-row__second">
          {offField ? (
            'Not on field'
          ) : (
            <>
              {tags.join(' · ')}
              {note.trim() && (
                <span className="grading-row__note">
                  {tags.length > 0 && ' '}
                  <Icon name="message-square-text" size={10} /> {note.split('\n')[0]}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {selected && (
        <div className="grading-row__detail">
          {(tagDefs.length > 0 || tags.length > 0) && (
            <div className="grading-row__tags">
              {tagDefs.map((t, i) => (
                <TagChip key={t.id} tag={t} on={tags.includes(t.label)} keyLetter={i < 10 ? 'QWERTYUIOP'[i] : undefined} onClick={() => room.toggleTag(player.id, t)} />
              ))}
              {tags
                .filter((l) => !tagDefs.some((t) => t.label === l))
                .map((l) => (
                  <TagChip
                    key={`stale-${l}`}
                    tag={{ id: -1, group: player.group, label: l, kind: 'neutral' }}
                    on
                    stale
                    onClick={() => room.toggleTag(player.id, { id: -1, group: player.group, label: l, kind: 'neutral' })}
                  />
                ))}
            </div>
          )}
          <div className="grading-row__toggles">
            <SmallToggle
              icon="zap"
              label="Critical"
              keycap="!"
              on={critical}
              iconColor={critical ? (grade === null ? 'var(--label-3)' : ink(gradeGlyphScore(grade))) : undefined}
              title="Critical: counts double in the grade (!)"
              test="critical-toggle"
              onClick={() => room.toggleCritical(player.id)}
            />
            {showOffField && (
              <SmallToggle
                icon="user-round-x"
                label="Not on Field"
                keycap="X"
                on={offField}
                title="Not on Field: wasn’t on the field for this snap (X)"
                test="off-field-toggle"
                onClick={() => room.toggleOffField(player.id)}
              />
            )}
            <SmallToggle
              icon="star"
              label={starred ? 'Starred' : 'Star'}
              on={starred}
              filled={starred}
              title="Star: always list this player when lineups aren’t published"
              test="star-toggle"
              onClick={() => room.toggleStar(player.id)}
            />
          </div>
          <TextField
            size="sm"
            value={note}
            commitOnBlur
            placeholder={`Note on ${lastName(player.name)} this play`}
            test="player-note"
            onCommit={(v) => room.savePlayerNote(player.id, v)}
          />
        </div>
      )}
    </div>
  )
}

/** A tag chip (02 §6.3.4). */
export function TagChip({
  tag,
  on,
  keyLetter,
  stale,
  large,
  onClick
}: {
  tag: TagDef
  on: boolean
  keyLetter?: string
  stale?: boolean
  large?: boolean
  onClick: () => void
}) {
  const score = tag.kind === 'pos' ? 100 : tag.kind === 'neg' ? 0 : null
  const style: CSSProperties | undefined =
    on && score !== null ? ({ '--chip-bg': tint(score), '--chip-ink': ink(score) } as CSSProperties) : undefined
  return (
    <button
      type="button"
      className={`tag-chip${large ? ' tag-chip--lg' : ''}`}
      data-test="tag-chip"
      aria-pressed={on}
      data-kind={on ? (score === null ? 'neutral' : 'heat') : undefined}
      data-stale={stale || undefined}
      title={stale ? `“${tag.label}” was removed in Settings. Click to remove it from this grade.` : undefined}
      style={style}
      onMouseDown={noMouseFocus}
      onClick={onClick}
    >
      {keyLetter && !stale && <span className="tag-chip__key">{keyLetter}</span>}
      {tag.label}
    </button>
  )
}

/** A borderless toggle with a keycap (Critical, Not on Field, Star). */
export function SmallToggle({
  icon,
  label,
  keycap,
  on,
  filled,
  iconColor,
  title,
  test,
  size = 'sm',
  onClick
}: {
  icon: IconName
  label: string
  keycap?: string
  on: boolean
  filled?: boolean
  iconColor?: string
  title: string
  test: string
  size?: 'sm' | 'md'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`small-toggle small-toggle--${size}`}
      aria-pressed={on}
      title={title}
      data-test={test}
      onMouseDown={noMouseFocus}
      onClick={onClick}
    >
      <Icon name={icon} size={size === 'md' ? 14 : 12} filled={filled} style={iconColor ? { color: iconColor } : undefined} />
      <span>{label}</span>
      {keycap && <Keycap small>{keycap}</Keycap>}
    </button>
  )
}
