import { downDistance, gameLabel, shortDesc } from '@shared/labels'
import type { Grade } from '@shared/types'
import { gradeGlyphScore, ink } from '../../ui/heat'
import { showMenu } from '../../shell/contextMenus'
import { links, navigate } from '../../shell/router'
import { entryKey, playMenu, Poster, type ReelEntry } from '../shared'
import { entryPoster } from './model'

const GRADE_WORD: Record<string, string> = { '1': 'Plus', '0': 'Even', '-1': 'Minus' }

/** A 6px grade mark in the muted heat ink; hollow when ungraded. */
export function GradeMark({ grade, title }: { grade: Grade | null | undefined; title?: string }) {
  const none = grade === null || grade === undefined
  return (
    <i
      className="grade-mark"
      data-none={none || undefined}
      style={none ? undefined : { background: ink(gradeGlyphScore(grade)) }}
      title={title ?? (none ? 'Not graded' : GRADE_WORD[String(grade)])}
      aria-hidden
    />
  )
}

/**
 * A shelf of film stills with plain two-line labels (Theater). A click opens the tape room at the play, in player
 * focus; the context menu is the play menu.
 */
export function ClipShelf({ entries, playerId, test }: { entries: ReelEntry[]; playerId?: string; test?: string }) {
  const open = (e: ReelEntry) => navigate(links.tape(e.ref.gameId, e.team, { play: e.ref.playId, player: playerId, focus: !!playerId }))
  return (
    <div className="clip-shelf" data-test={test}>
      {entries.map((e) => {
        const dd = e.play ? downDistance(e.play) : ''
        const title = e.play ? shortDesc(e.play.desc) : gameLabel(e.game, e.team)
        return (
          <button
            key={entryKey(e)}
            type="button"
            className="clip-shelf__item"
            data-test="clip-shelf-item"
            title={title}
            onClick={() => open(e)}
            onContextMenu={(ev) => {
              ev.preventDefault()
              void playMenu({ ...e, flagged: !!e.flagged, playerId }, {}).then((items) => showMenu(null, items))
            }}
          >
            <Poster poster={entryPoster(e)} width={480} className="clip-shelf__still" />
            <span className="clip-shelf__title">{e.tags?.length ? `${e.tags[0]} · ${title}` : title}</span>
            <span className="clip-shelf__meta">
              <span>{[gameLabel(e.game, e.team), dd].filter(Boolean).join(' · ')}</span>
              <GradeMark grade={e.grade} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
