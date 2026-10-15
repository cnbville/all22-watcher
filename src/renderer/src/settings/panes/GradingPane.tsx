import { useEffect, useState } from 'react'
import { POSITION_GROUPS } from '@shared/teams'
import type { PositionGroup, TagDef } from '@shared/types'
import { api } from '../../api'
import { Button } from '../../ui/Button'
import { FormGroup } from '../../ui/GroupedForm'
import { Keycap } from '../../ui/Keycap'
import { PopupButton } from '../../ui/PopupButton'
import { Segmented } from '../../ui/Segmented'
import { TextField } from '../../ui/TextField'
import { errorBanner } from '../../shell/Banners'
import { Loading } from '../../shell/Screen'

/**
 * Grading tags per position group (v1 Settings › Grading tags). Every edit saves at once; rows keep their ids so a
 * rename stays a rename (01 §4).
 */
type Row = Omit<TagDef, 'id'> & { id?: number; key: string }
let seq = 0
const key = () => `t${++seq}`

const KINDS = [
  { value: 'pos' as const, label: 'Positive' },
  { value: 'neg' as const, label: 'Negative' },
  { value: 'neutral' as const, label: 'Neutral' }
]

export function GradingPane() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [group, setGroup] = useState<PositionGroup>('QB')
  const load = () => void api.tags().then((t) => setRows(t.map((x) => ({ ...x, key: key() }))))
  useEffect(load, [])
  if (!rows) return <Loading />

  const save = async (next: Row[]) => {
    setRows(next)
    try {
      const saved = await api.saveTags(next.filter((t) => t.label.trim()).map(({ id, group: g, label, kind }) => ({ id, group: g, label: label.trim(), kind })))
      // Give new rows their ids, keeping each row's key so focus stays put.
      const byLabel = new Map(saved.map((t) => [`${t.group}|${t.label}`, t]))
      setRows((cur) => (cur ?? []).filter((t) => t.label.trim()).map((t) => ({ ...t, id: byLabel.get(`${t.group}|${t.label.trim()}`)?.id ?? t.id })))
    } catch (e) {
      errorBanner('Couldn’t save the tags', e)
    }
  }

  const inGroup = rows.filter((t) => t.group === group)
  const move = (k: string, delta: number) => {
    const list = [...inGroup]
    const i = list.findIndex((t) => t.key === k)
    const j = i + delta
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    void save([...rows.filter((t) => t.group !== group), ...list])
  }
  return (
    <FormGroup
      title="Tags"
      trailing={<Segmented size="sm" value={group} onChange={setGroup} options={POSITION_GROUPS.map((g) => ({ value: g, label: g }))} label="Position group" />}
      footnote="The first ten tags in each group get the keys Q–P in the tape room."
    >
      {inGroup.map((t, i) => (
        <div className="settings-list-row" key={t.key}>
          <span className="settings-list-row__key">{i < 10 ? <Keycap small>{'QWERTYUIOP'[i]}</Keycap> : null}</span>
          <TextField
            value={t.label}
            commitOnBlur
            placeholder="Tag name"
            onCommit={(v) => v !== t.label && void save(rows.map((x) => (x.key === t.key ? { ...x, label: v } : x)))}
            style={{ flex: 1 }}
          />
          <PopupButton value={t.kind} options={KINDS} width={110} onChange={(v) => void save(rows.map((x) => (x.key === t.key ? { ...x, kind: v } : x)))} />
          <Button variant="borderless" size="sm" iconOnly icon="chevron-up" label="Move Up" disabled={i === 0} onClick={() => move(t.key, -1)} />
          <Button variant="borderless" size="sm" iconOnly icon="chevron-down" label="Move Down" disabled={i === inGroup.length - 1} onClick={() => move(t.key, 1)} />
          <Button variant="borderless" size="sm" iconOnly icon="trash-2" label="Remove" onClick={() => void save(rows.filter((x) => x.key !== t.key))} />
        </div>
      ))}
      <div className="settings-list-row settings-list-row--add">
        <Button variant="borderless" size="sm" icon="plus" label={`Add ${group} Tag`} onClick={() => setRows([...rows, { key: key(), group, label: '', kind: 'pos' }])} />
      </div>
    </FormGroup>
  )
}
