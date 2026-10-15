import { useState } from 'react'
import { clipUrl } from '@shared/api'
import { playCaption, shortDesc } from '@shared/labels'
import { clipStartTime } from '@shared/snap'
import { PreviewPanel } from '../../ui/PreviewPanel'
import { showMenu } from '../../shell/contextMenus'
import { links, navigate } from '../../shell/router'
import { useSettings } from '../../shell/store'
import { playMenu } from './playMenu'
import { PlayRow } from './PlayRow'
import { entryKey, type ReelEntry } from './ReelPlayer'

/**
 * A short list of Play rows (Notes from the Film, Worth a Second Look): single click selects, Space previews
 * (01 §6.23), double-click or ↩ opens the tape room at the play, in player focus when `playerId` is set.
 */
export function PlayList({ entries, playerId, rowTest, showEpa = true }: { entries: ReelEntry[]; playerId?: string; rowTest: string; showEpa?: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const settings = useSettings()
  const index = entries.findIndex((e) => entryKey(e) === sel)
  const current = index >= 0 ? entries[index] : null
  const open = (e: ReelEntry) => navigate(links.tape(e.ref.gameId, e.team, { play: e.ref.playId, player: playerId, focus: !!playerId }))
  const move = (dir: -1 | 1) => {
    const next = entries[Math.max(0, Math.min(entries.length - 1, index + dir))]
    if (next) setSel(entryKey(next))
  }
  const clip = current ? (current.clips.find((c) => c.playId === current.ref.playId && c.angle === 'sideline') ?? current.clips.find((c) => c.playId === current.ref.playId)) : null
  return (
    <div
      className="play-list"
      role="listbox"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          if (index < 0 && entries[0]) setSel(entryKey(entries[0]))
          else move(e.key === 'ArrowDown' ? 1 : -1)
        } else if (e.key === ' ' && current) {
          e.preventDefault()
          setPreview(true)
        } else if (e.key === 'Enter' && current) {
          e.preventDefault()
          open(current)
        }
      }}
    >
      {entries.map((e) => (
        <PlayRow
          key={entryKey(e)}
          item={{ ...e, hasNote: !!(e.note || e.playNote), teamEpa: showEpa ? e.teamEpa : undefined }}
          selected={sel === entryKey(e)}
          test={rowTest}
          onClick={() => setSel(entryKey(e))}
          onDoubleClick={() => open(e)}
          onContextMenu={(ev) => {
            ev.preventDefault()
            setSel(entryKey(e))
            void playMenu({ ...e, flagged: !!e.flagged, playerId }, { preview: () => setPreview(true) }).then((items) => showMenu(null, items))
          }}
        />
      ))}
      {preview && current && (
        <PreviewPanel
          label={playCaption(current.game, current.team, current.play)}
          src={clip ? clipUrl(clip.id) : null}
          start={clip && settings ? clipStartTime(clip, settings) : 0}
          footer={current.play ? shortDesc(current.play.desc) : undefined}
          onClose={() => setPreview(false)}
          onMove={move}
          onOpen={() => open(current)}
        />
      )}
    </div>
  )
}
