import { downDistance, quarterLabel } from '../../format'
import { CriticalMark, GradeControl } from '../../ui/Grade'
import type { Room } from './model'

/**
 * Film Only's floating grading panel (02 §5.9): the selected player (the focus player in Player Focus), a HUD grade
 * control, the critical mark, the tags that are on, and progress. Clicking a segment grades without advancing.
 */
export function GradingHud({ room, hidden }: { room: Room; hidden: boolean }) {
  const { current, target, focus } = room
  if (!current || !target || (!focus && !room.listed.length)) return null
  const entry = room.targetEntry
  const index = room.visible.findIndex((p) => p.playId === current.playId)
  const position = index >= 0 ? `Play ${index + 1}/${room.visible.length}` : null
  const line1 = [`${quarterLabel(current.qtr)} ${current.time}`, current.down ? downDistance(current) : null, position].filter(Boolean).join(' · ')
  const hotkey = focus ? null : room.listed.findIndex((p) => p.id === target.id) + 1
  const tags = entry?.tags ?? []
  let progress: string
  if (focus) progress = `${focus.progress.graded} of ${focus.progress.total} snaps graded`
  else {
    const pr = room.progressOf(current)
    progress = `${pr.done} of ${pr.listed} graded`
  }
  return (
    <div className="hud grading-hud" data-test="grading-hud" data-state={hidden ? 'hidden' : 'shown'} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="grading-hud__meta">{line1}</div>
      <div className="grading-hud__player">
        {hotkey !== null && hotkey > 0 && hotkey <= 9 && <span className="grading-hud__key">{hotkey}</span>}
        <span className="grading-hud__name">{target.name}</span>
        <span className="grading-hud__pos">{target.depthPos || target.position}</span>
      </div>
      <div className="grading-hud__controls">
        <GradeControl size="hud" value={entry?.grade ?? null} onChange={(g) => room.grade(target.id, g, { toggle: true })} />
        <span className="grading-hud__critical" title={entry?.critical ? 'Critical' : undefined}>
          {entry?.critical && <CriticalMark grade={entry.grade} />}
        </span>
      </div>
      {tags.length > 0 && <div className="grading-hud__tags">{tags.join(' · ')}</div>}
      <div className="grading-hud__progress">{progress}</div>
    </div>
  )
}
