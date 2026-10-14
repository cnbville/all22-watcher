import { useEffect, useState } from 'react'
import { POSITION_GROUPS } from '@shared/teams'
import type { ChartField, PositionGroup, Settings, TagDef } from '@shared/types'
import { api } from '../api'
import { Crumbs } from '../App'
import { ErrorBox, Loading, toast, useAsync } from '../components/common'
import { SPEEDS } from '../components/VideoStage'

type DraftTag = Omit<TagDef, 'id'> & { key: string }
type DraftField = { key: string; name: string; options: string }

let keySeq = 0
const nextKey = () => `k${++keySeq}`

export function SettingsPage() {
  const data = useAsync(
    () => Promise.all([api.settings(), api.tags(), api.chartFields(), api.dataFolder(), api.seasons()]),
    []
  )
  if (data.error) return <div className="page"><ErrorBox error={data.error} /></div>
  if (!data.data) return <Loading />
  const [settings, tags, fields, folder, seasons] = data.data
  return (
    <div className="page">
      <Crumbs>
        <span className="sep">/</span>
        <span>Settings</span>
      </Crumbs>
      <div className="page-narrow col" style={{ gap: 16 }}>
        <PlaybackSettings initial={settings} />
        <TagEditor initial={tags} />
        <ChartFieldEditor initial={fields} />
        <div className="card">
          <div className="card-title">
            <h3>Your data</h3>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Grades, notes, and tags live in one file on this Mac, next to the downloaded nflverse data. Your video clips stay
            where they are; the app only remembers their location. Back up this folder to keep your grades safe.
          </p>
          <div className="row">
            <code className="mono faint" style={{ userSelect: 'text' }}>{folder}</code>
            <button className="btn small" onClick={() => api.openDataFolder()}>
              Show in Finder
            </button>
          </div>
          <h4 style={{ margin: '16px 0 8px' }}>Downloaded seasons</h4>
          <div className="row wrap">
            {seasons.filter((s) => s.downloaded).length === 0 && <span className="faint">None yet.</span>}
            {seasons
              .filter((s) => s.downloaded)
              .map((s) => (
                <span className="badge" key={s.season} title={s.hasParticipation ? 'Includes on-field lineups' : 'On-field lineups not published yet'}>
                  {s.season}
                  {s.hasParticipation ? '' : ' · no lineups'}
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlaybackSettings({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial)
  const save = async (patch: Partial<Settings>) => setS(await api.saveSettings(patch))
  return (
    <div className="card">
      <div className="card-title">
        <h3>Tape room</h3>
      </div>
      <div className="col">
        <label className="row">
          <input type="checkbox" checked={s.autoAdvance} onChange={(e) => save({ autoAdvance: e.target.checked })} />
          Auto-advance: go to the next play after grading the last player, or when a clip ends with loop off
        </label>
        <label className="row">
          Default speed
          <select className="input" value={s.defaultSpeed} onChange={(e) => save({ defaultSpeed: Number(e.target.value) })}>
            {SPEEDS.map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

function TagEditor({ initial }: { initial: TagDef[] }) {
  const [group, setGroup] = useState<PositionGroup>('QB')
  const [draft, setDraft] = useState<DraftTag[]>(() => initial.map((t) => ({ ...t, key: nextKey() })))
  const [dirty, setDirty] = useState(false)
  const update = (next: DraftTag[]) => {
    setDraft(next)
    setDirty(true)
  }
  const inGroup = draft.filter((t) => t.group === group)
  const save = async () => {
    const saved = await api.saveTags(draft.filter((t) => t.label.trim()).map(({ group, label, kind }) => ({ group, label: label.trim(), kind })))
    setDraft(saved.map((t) => ({ ...t, key: nextKey() })))
    setDirty(false)
    toast('Tags saved')
  }
  return (
    <div className="card">
      <div className="card-title">
        <h3>Grading tags</h3>
        <span className="faint">The first ten in each group get hotkeys Q–P in the tape room.</span>
        <span className="spacer" />
        <button className="btn small primary" disabled={!dirty} onClick={save}>
          Save tags
        </button>
      </div>
      <div className="seg" style={{ marginBottom: 12 }}>
        {POSITION_GROUPS.map((g) => (
          <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>
            {g}
          </button>
        ))}
      </div>
      <div className="col" style={{ gap: 6 }}>
        {inGroup.map((t, i) => (
          <div className="row" key={t.key}>
            <span className="kbd" style={{ width: 22 }}>{'QWERTYUIOP'[i] ?? ''}</span>
            <input
              className="input"
              style={{ flex: 1 }}
              value={t.label}
              onChange={(e) => update(draft.map((x) => (x.key === t.key ? { ...x, label: e.target.value } : x)))}
            />
            <select
              className="input"
              value={t.kind}
              onChange={(e) => update(draft.map((x) => (x.key === t.key ? { ...x, kind: e.target.value as TagDef['kind'] } : x)))}
            >
              <option value="pos">Positive</option>
              <option value="neg">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <button className="btn small ghost" disabled={i === 0} onClick={() => update(move(draft, t.key, -1, group))} title="Move up">
              ↑
            </button>
            <button className="btn small ghost danger" onClick={() => update(draft.filter((x) => x.key !== t.key))}>
              Remove
            </button>
          </div>
        ))}
        <div>
          <button className="btn small" onClick={() => update([...draft, { key: nextKey(), group, label: '', kind: 'pos' }])}>
            + Add {group} tag
          </button>
        </div>
      </div>
    </div>
  )
}

function move(list: DraftTag[], key: string, delta: number, group: PositionGroup): DraftTag[] {
  const groupItems = list.filter((t) => t.group === group)
  const i = groupItems.findIndex((t) => t.key === key)
  const j = i + delta
  if (j < 0 || j >= groupItems.length) return list
  ;[groupItems[i], groupItems[j]] = [groupItems[j], groupItems[i]]
  return [...list.filter((t) => t.group !== group), ...groupItems]
}

function ChartFieldEditor({ initial }: { initial: ChartField[] }) {
  const [draft, setDraft] = useState<DraftField[]>(() => initial.map((f) => ({ key: nextKey(), name: f.name, options: f.options.join(', ') })))
  const [dirty, setDirty] = useState(false)
  useEffect(() => setDirty(false), [])
  const update = (next: DraftField[]) => {
    setDraft(next)
    setDirty(true)
  }
  const save = async () => {
    const saved = await api.saveChartFields(
      draft
        .filter((f) => f.name.trim())
        .map((f) => ({ name: f.name.trim(), options: f.options.split(',').map((o) => o.trim()).filter(Boolean) }))
    )
    setDraft(saved.map((f) => ({ key: nextKey(), name: f.name, options: f.options.join(', ') })))
    setDirty(false)
    toast('Charting fields saved')
  }
  return (
    <div className="card">
      <div className="card-title">
        <h3>Charting fields</h3>
        <span className="faint">Your own per-play fields, like coverage shell or run concept. Options are comma separated.</span>
        <span className="spacer" />
        <button className="btn small primary" disabled={!dirty} onClick={save}>
          Save fields
        </button>
      </div>
      <div className="col" style={{ gap: 6 }}>
        {draft.map((f) => (
          <div className="row" key={f.key}>
            <input
              className="input"
              style={{ width: 180 }}
              placeholder="Field name"
              value={f.name}
              onChange={(e) => update(draft.map((x) => (x.key === f.key ? { ...x, name: e.target.value } : x)))}
            />
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Option 1, Option 2, …"
              value={f.options}
              onChange={(e) => update(draft.map((x) => (x.key === f.key ? { ...x, options: e.target.value } : x)))}
            />
            <button className="btn small ghost danger" onClick={() => update(draft.filter((x) => x.key !== f.key))}>
              Remove
            </button>
          </div>
        ))}
        <div>
          <button className="btn small" onClick={() => update([...draft, { key: nextKey(), name: '', options: '' }])}>
            + Add field
          </button>
        </div>
      </div>
    </div>
  )
}
