import { useLayoutEffect, useRef } from 'react'
import type { IconName } from '@shared/icons'
import { Segmented } from '../../../ui/Segmented'
import type { InspectorTab, Room } from '../model'
import { ChartTab } from './ChartTab'
import { FocusPanel } from './FocusPanel'
import { GradeTab } from './GradeTab'
import { InfoTab } from './InfoTab'
import { NotesTab } from './NotesTab'
import { PlaySummary } from './PlaySummary'

/** The tape room's inspector (02 §6): tabs with badge dots, the pinned play summary, and the tab's body. */
export function TapeInspector({ room }: { room: Room }) {
  const { current, currentNote, tab } = room
  const tabs: { value: InspectorTab; icon: IconName; title: string; badge: boolean }[] = [
    { value: 'grade', icon: room.focus ? 'scan-eye' : 'users-round', title: 'Grade (⌥⌘1)', badge: false },
    {
      value: 'notes',
      icon: 'message-square-text',
      title: 'Notes (⌥⌘2)',
      badge: !!current && (!!currentNote?.note.trim() || room.listed.some((p) => !!room.data.entryOf(current.playId, p.id)?.note.trim()))
    },
    { value: 'chart', icon: 'clipboard-list', title: 'Chart (⌥⌘3)', badge: !!currentNote && Object.values(currentNote.chart).some((v) => !!v) },
    { value: 'info', icon: 'info', title: 'Info (⌥⌘4)', badge: false }
  ]
  // Badge dots: the segments are the shared control's, so the dot is a data attribute its CSS draws.
  const head = useRef<HTMLDivElement>(null)
  const badges = tabs.map((t) => t.badge).join()
  useLayoutEffect(() => {
    const buttons = head.current?.querySelectorAll<HTMLElement>('.segmented__item')
    buttons?.forEach((b, i) => {
      if (tabs[i]?.badge) b.dataset.badge = 'true'
      else delete b.dataset.badge
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badges])

  let body: React.ReactNode
  if (!current) body = <div className="inspector__empty">No Selection</div>
  else if (tab === 'grade') body = room.focus ? <FocusPanel room={room} /> : <GradeTab room={room} />
  else if (tab === 'notes') body = <NotesTab room={room} />
  else if (tab === 'chart') body = <ChartTab room={room} />
  else body = <InfoTab room={room} />

  return (
    <div className="inspector tape-inspector">
      <div ref={head} className="inspector__header">
        <Segmented
          size="toolbar"
          label="Inspector"
          value={tab}
          onChange={(t) => {
            room.setTab(t)
            room.refocus()
          }}
          options={tabs.map((t) => ({ value: t.value, icon: t.icon, title: t.title, test: `inspector-tab-${t.value}` }))}
        />
      </div>
      {current && <PlaySummary room={room} />}
      <div className="inspector__body tape-inspector__body" data-tab={tab}>
        {body}
      </div>
    </div>
  )
}
