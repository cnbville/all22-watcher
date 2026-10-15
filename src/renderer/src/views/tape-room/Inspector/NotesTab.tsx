import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Keycap } from '../../../ui/Keycap'
import { noMouseFocus } from '../../../ui/keyboard'
import type { Room } from '../model'

/** The Notes tab (02 §6.5): the play note and the listed players' notes. */
export function NotesTab({ room }: { room: Room }) {
  const { current } = room
  const note = room.currentNote?.note ?? ''
  const [draft, setDraft] = useState(note)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setDraft(note), [note, current?.playId])
  // Grows from 120 to 240, then scrolls.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.max(120, Math.min(240, el.scrollHeight + 2))}px`
  }, [draft])
  if (!current) return null
  const commit = () => draft !== note && room.savePlayNote(draft)
  const playerNotes = room.listed
    .map((p) => ({ p, text: room.data.entryOf(current.playId, p.id)?.note.trim() ?? '' }))
    .filter((x) => x.text)

  return (
    <div className="notes-tab">
      <div className="notes-tab__header">
        <span>Play note</span>
        <Keycap small>N</Keycap>
      </div>
      <textarea
        ref={area}
        className="text-area notes-tab__area"
        data-test="play-note"
        placeholder="What did you see on this play?"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.blur()
            room.refocus()
          }
        }}
      />
      {playerNotes.length > 0 && (
        <>
          <div className="notes-tab__section">Player notes</div>
          {playerNotes.map(({ p, text }) => (
            <button
              key={p.id}
              type="button"
              className="notes-tab__player"
              onMouseDown={noMouseFocus}
              onClick={() => {
                room.setTab('grade')
                room.select(p.id)
                room.refocus()
              }}
            >
              <span className="notes-tab__name">{p.name}</span>
              <span className="notes-tab__text">{text}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
