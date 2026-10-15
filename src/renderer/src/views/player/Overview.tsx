import { type CSSProperties, useState } from 'react'
import { plusRate } from '@shared/stats'
import { formatPct } from '../../format'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { heatFor } from '../../ui/heat'
import { Section } from '../../shell/Screen'
import { PlayList } from '../shared'
import { ClipShelf } from './ClipShelf'
import { bestClips, gameBars, notesFromFilm, seasonCells, tagPolarity } from './model'
import type { PlayerCtx } from './Player'
import { WeekLine } from './WeekLine'

const first = (name: string) => name.split(/\s+/)[0] ?? name
const TAGS_SHOWN = 8

/** Player › Overview (03 §6.2), Theater layout: trend and tags, the clip shelf, then the season's numbers. */
export function Overview({ ctx }: { ctx: PlayerCtx }) {
  const { p, season } = ctx
  const notes = notesFromFilm(ctx.entries)
  const clips = bestClips(ctx.entries)
  const graded = p.games.some((g) => g.tally.graded)
  return (
    <>
      <div className="player-two-col">
        <Section title="Grade by week">
          {graded ? (
            <WeekLine games={gameBars(p, 'week')} test="grade-by-game" onSelect={(gameId) => ctx.openFilm([{ key: 'game', values: [gameId] }])} />
          ) : (
            <NotGraded ctx={ctx} />
          )}
        </Section>
        <Section title="Tags">
          <TagList ctx={ctx} />
        </Section>
      </div>
      {clips.length > 0 && (
        <Section title="Best clips" seeAll={() => ctx.setSection('film')} test="player-clips">
          <ClipShelf entries={clips} playerId={ctx.playerId} />
        </Section>
      )}
      <Section title={`${season} season`}>
        <StatStrip cells={seasonCells(p)} />
        {p.tally.graded > 0 && <GradeLine ctx={ctx} />}
      </Section>
      {notes.length > 0 && (
        <Section title="Notes from the film" seeAll={() => ctx.openFilm([{ key: 'marked', values: ['notes'] }])}>
          <PlayList entries={notes} playerId={ctx.playerId} rowTest="note-row" />
        </Section>
      )}
    </>
  )
}

export function StatStrip({ cells }: { cells: { key: string; label: string; value: string }[] }) {
  return (
    <div className="stat-strip" style={{ '--cells': cells.length } as CSSProperties}>
      {cells.map((c) => (
        <div key={c.key} className="stat-strip__cell" data-test="stat-tile">
          <div className="stat-strip__value num">{c.value}</div>
          <div className="stat-strip__label">{c.label}</div>
        </div>
      ))}
    </div>
  )
}

function NotGraded({ ctx }: { ctx: PlayerCtx }) {
  return (
    <div className="player-empty-inline">
      <EmptyState small title="Not graded yet" body={`Grade ${first(ctx.p.player.name)} in the tape room to see his grade week by week.`} />
      <Button variant="borderless" size="sm" label="Grade on Film" disabled={!ctx.filmGame} onClick={ctx.gradeOnFilm} />
    </div>
  )
}

/** Plus / zero / minus / critical and the plus rate as one quiet line of small figures. */
function GradeLine({ ctx }: { ctx: PlayerCtx }) {
  const t = ctx.p.tally
  const heat = heatFor('screen')
  const figures: { key: string; label: string; value: string; color?: string }[] = [
    { key: 'plus', label: 'Plus', value: String(t.plus), color: heat.ink(100) },
    { key: 'zero', label: 'Zero', value: String(t.zero), color: heat.ink(50) },
    { key: 'minus', label: 'Minus', value: String(t.minus), color: heat.ink(0) },
    { key: 'critical', label: 'Critical', value: String(t.critical) },
    { key: 'rate', label: 'Plus rate', value: formatPct(plusRate(t)) }
  ]
  return (
    <div className="grade-line">
      {figures.map((f) => (
        <div key={f.key} className="grade-line__figure">
          <span className="grade-line__value num">
            {f.color && <i className="grade-mark" style={{ background: f.color }} aria-hidden />}
            {f.value}
          </span>
          <span className="grade-line__label">{f.label}</span>
        </div>
      ))}
    </div>
  )
}

/** His tags as a roomy list: a muted mark for the tag's polarity, the name, the count. A click shows those plays. */
function TagList({ ctx }: { ctx: PlayerCtx }) {
  const { p } = ctx
  const [all, setAll] = useState(false)
  if (!p.tagCounts.length) return <div className="player-quiet">{p.tally.graded ? 'No tags yet.' : 'Tags you add while grading collect here.'}</div>
  const polarity = tagPolarity(ctx.tags, p.player.group)
  const heat = heatFor('screen')
  const shown = all ? p.tagCounts : p.tagCounts.slice(0, TAGS_SHOWN)
  return (
    <div className="tag-list">
      {shown.map((tag) => {
        const kind = polarity.get(tag.tag) ?? 'neutral'
        const color = kind === 'pos' ? heat.ink(100) : kind === 'neg' ? heat.ink(0) : undefined
        return (
          <button key={tag.tag} type="button" className="tag-list__row" onClick={() => ctx.openFilm([{ key: 'tag', values: [tag.tag] }])} title={`Watch the ${tag.count} ${tag.tag} plays`}>
            <span className="tag-list__name">
              <i className="grade-mark" data-none={color ? undefined : true} style={color ? { background: color } : undefined} aria-hidden />
              {tag.tag}
            </span>
            <span className="tag-list__count num">{tag.count}</span>
          </button>
        )
      })}
      {p.tagCounts.length > TAGS_SHOWN && (
        <button type="button" className="tag-list__more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${p.tagCounts.length}`}
        </button>
      )}
    </div>
  )
}
