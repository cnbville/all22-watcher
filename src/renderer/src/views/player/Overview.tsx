import type { CSSProperties } from 'react'
import { plusRate } from '@shared/stats'
import { formatPct } from '../../format'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { heatFor } from '../../ui/heat'
import { Icon } from '../../ui/Icon'
import { Section } from '../../shell/Screen'
import { GradeByGameChart, LargeTallyBar, PlayList } from '../shared'
import { gameBars, notesFromFilm, seasonCells, tagPolarity } from './model'
import type { PlayerCtx } from './Player'

const first = (name: string) => name.split(/\s+/)[0] ?? name

/** Player › Overview (03 §6.2). */
export function Overview({ ctx }: { ctx: PlayerCtx }) {
  const { p, season } = ctx
  const notes = notesFromFilm(ctx.entries)
  return (
    <>
      <Section title={`${season} Season`}>
        <StatStrip cells={seasonCells(p)} />
      </Section>
      <div className="player-two-col">
        <Section title="Grade Breakdown">
          <Breakdown ctx={ctx} />
        </Section>
        <Section title="Grade by Game">
          {p.games.some((g) => g.tally.graded) ? (
            <GradeByGameChart
              games={gameBars(p)}
              height={200}
              test="grade-by-game"
              onSelect={(gameId) => {
                ctx.openFilm([{ key: 'game', values: [gameId] }])
              }}
            />
          ) : (
            <div className="player-quiet">No graded games yet.</div>
          )}
        </Section>
      </div>
      {notes.length > 0 && (
        <Section title="Notes from the Film" seeAll={() => ctx.openFilm([{ key: 'marked', values: ['notes'] }])}>
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
          <div className="stat-strip__label">{c.label}</div>
          <div className="stat-strip__value num">{c.value}</div>
        </div>
      ))}
    </div>
  )
}

function Breakdown({ ctx }: { ctx: PlayerCtx }) {
  const { p } = ctx
  const t = p.tally
  const heat = heatFor('screen')
  if (!t.graded) {
    return (
      <div className="player-empty-inline">
        <EmptyState small title="Not graded yet" body={`Grade ${first(p.player.name)} in the tape room to see a breakdown here.`} />
        <Button variant="borderless" size="sm" label="Grade on Film" disabled={!ctx.filmGame} onClick={ctx.gradeOnFilm} />
      </div>
    )
  }
  const polarity = tagPolarity(ctx.tags, p.player.group)
  return (
    <div className="breakdown">
      <div className="breakdown__figures">
        <Figure label="Plus" value={t.plus} color={heat.ink(100)} />
        <Figure label="Zero" value={t.zero} color={heat.ink(50)} />
        <Figure label="Minus" value={t.minus} color={heat.ink(0)} />
        <Figure
          label="Critical"
          value={
            <>
              <Icon name="zap" size={14} className="breakdown__zap" />
              {t.critical}
            </>
          }
        />
        <Figure label="Plus rate" value={formatPct(plusRate(t))} />
      </div>
      <div className="breakdown__bar">
        <LargeTallyBar tally={t} />
      </div>
      <div className="breakdown__tags-title">Tags</div>
      {p.tagCounts.length ? (
        <div className="tag-chips">
          {p.tagCounts.map((tag) => {
            const kind = polarity.get(tag.tag) ?? 'neutral'
            const style =
              kind === 'pos'
                ? ({ '--chip-bg': heat.tint(100), '--chip-fg': heat.ink(100) } as CSSProperties)
                : kind === 'neg'
                  ? ({ '--chip-bg': heat.tint(0), '--chip-fg': heat.ink(0) } as CSSProperties)
                  : undefined
            return (
              <button key={tag.tag} type="button" className="tag-chip" style={style} onClick={() => ctx.openFilm([{ key: 'tag', values: [tag.tag] }])} title={`Watch the ${tag.count} ${tag.tag} plays`}>
                <span>{tag.tag}</span>
                <span className="tag-chip__count">{tag.count}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="player-quiet">No tags yet.</div>
      )}
    </div>
  )
}

function Figure({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="figure">
      <div className="figure__label">{label}</div>
      <div className="figure__value num" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}

