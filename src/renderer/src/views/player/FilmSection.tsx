import { useMemo, useRef, useState } from 'react'
import { durationLabel } from '@shared/labels'
import { type FilterToken, tokensToRules } from '@shared/playQuery'
import { api } from '../../api'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { PopupButton } from '../../ui/PopupButton'
import { ToggleSegments } from '../../ui/Segmented'
import { errorBanner } from '../../shell/Banners'
import { links, navigate } from '../../shell/router'
import { useSettings } from '../../shell/store'
import { entryKey, ReelPlayer, type ReelHandle } from '../shared'
import { toSearchToken } from './filmTokens'
import { filterEntries, reelDuration, type ReelSort, sortEntries } from './model'
import type { FilmState, PlayerCtx } from './Player'

const SORTS: { value: ReelSort; label: string }[] = [
  { value: 'game', label: 'Game Order' },
  { value: 'epaBest', label: 'EPA, Best First' },
  { value: 'epaWorst', label: 'EPA, Worst First' },
  { value: 'grade', label: 'Grade' }
]

const first = (name: string) => name.split(/\s+/)[0] ?? name

/** Player › Film (03 §6.3): filter controls, then the reel with its play list. */
export function FilmSection({ ctx, film, filter }: { ctx: PlayerCtx; film: FilmState; filter: FilterToken[] }) {
  const settings = useSettings()
  const { tokens, setTokens, text, setText, sort, setSort, env } = film
  const shown = useMemo(
    () => sortEntries(filterEntries(ctx.entries, filter, text, ctx.playerId, ctx.chartFields, ctx.charts), sort),
    [ctx.entries, filter, text, sort, ctx.playerId, ctx.chartFields, ctx.charts]
  )
  const [current, setCurrent] = useState<string | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const reel = useRef<ReelHandle>(null)
  const cur = shown.some((e) => entryKey(e) === current) ? current : shown[0] ? entryKey(shown[0]) : null

  const values = (key: string) => tokens.filter((t) => t.key === key).map((t) => t.value)
  const setKey = (key: string, vals: string[]) => setTokens([...tokens.filter((t) => t.key !== key), ...vals.map((v) => toSearchToken(key, v, env))])
  const grades = values('grade')
  const critical = values('status').includes('critical')
  const flagged = values('marked').includes('flagged')
  const filtersOn = tokens.length > 0 || text.trim() !== ''
  const duration = settings ? reelDuration(shown, settings) : 0
  const name = first(ctx.p.player.name)

  const saveAsCutup = async () => {
    try {
      const rules = [{ field: 'player' as const, op: 'graded' as const, value: [ctx.playerId] }, ...tokensToRules(filter, { text, player: ctx.playerId })]
      const c = await api.createCutup({ kind: 'smart', name: `${ctx.p.player.name} · ${tokens.map((t) => t.label).join(', ') || text}`, rules: { match: 'all', rules, limit: null, order: 'game' }, focus: { playerId: ctx.playerId } })
      navigate(`${links.cutup(c.id)}?rules=1`)
    } catch (e) {
      errorBanner('Couldn’t create the cut-up', e)
    }
  }

  if (!ctx.entries.length) {
    return (
      <EmptyState
        icon="film"
        title="No graded plays yet"
        body={`Grade ${name} in the tape room and his plays collect here, ready to replay.`}
        primary={{ label: 'Grade on Film', run: ctx.gradeOnFilm, disabled: !ctx.filmGame }}
      />
    )
  }

  return (
    <div className="film-section">
      <div className="film-controls">
        <ToggleSegments<string>
          values={grades}
          onChange={(v) => setKey('grade', v)}
          label="Grade"
          options={[
            { value: '+', label: '+', test: 'reel-grade-plus', title: 'Plus plays' },
            { value: '0', label: '0', test: 'reel-grade-zero', title: 'Zero plays' },
            { value: '-', label: '−', test: 'reel-grade-minus', title: 'Minus plays' }
          ]}
        />
        <span className="film-controls__toggles">
          <Button icon="zap" label="Critical" pressed={critical} onClick={() => setKey('status', critical ? [] : ['critical'])} test="reel-critical" />
          <Button icon="flag" label="Flagged" pressed={flagged} onClick={() => setKey('marked', flagged ? values('marked').filter((v) => v !== 'flagged') : [...values('marked'), 'flagged'])} test="reel-flagged" />
        </span>
        <PopupButton<ReelSort> size="sm" variant="inline" value={sort} onChange={setSort} options={SORTS} label={`Sort: ${SORTS.find((s) => s.value === sort)?.label}`} test="reel-sort" />
        <span className="film-controls__spacer" />
        {filtersOn && <Button variant="borderless" size="sm" label="Save as Cut-up…" onClick={() => void saveAsCutup()} test="save-as-cutup" />}
        <span className="film-controls__count">
          {shown.length} of {ctx.entries.length} {ctx.entries.length === 1 ? 'play' : 'plays'}
          {duration > 0 ? ` · ${durationLabel(duration)}` : ''}
        </span>
        <Button icon="play" label="Play All" disabled={!shown.length} onClick={() => reel.current?.playAll()} test="reel-play-all" />
      </div>
      {!shown.length ? (
        <EmptyState
          icon="funnel"
          title="No plays match these filters"
          primary={{
            label: 'Clear Filters',
            run: () => {
              setTokens([])
              setText('')
            }
          }}
        />
      ) : (
        <ReelPlayer
          handle={reel}
          entries={shown}
          current={cur}
          onCurrentChange={(k) => {
            setCurrent(k)
            setSelection([k])
          }}
          selection={selection.length ? selection : cur ? [cur] : []}
          onSelectionChange={setSelection}
          playerId={ctx.playerId}
          layout="side"
          angleKey="ui.reel.angle"
        />
      )}
    </div>
  )
}
