import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Button } from '../../ui/Button'
import { FormGroup } from '../../ui/GroupedForm'
import { TextField } from '../../ui/TextField'
import { errorBanner } from '../../shell/Banners'
import { Loading } from '../../shell/Screen'

/** Your own per-play charting fields (v1 Settings › Charting fields). Each row commits on blur and keeps its id. */
type Row = { key: string; id?: number; name: string; options: string }
let seq = 0
const key = () => `f${++seq}`

export function ChartingPane() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const load = () => void api.chartFields().then((f) => setRows(f.map((x) => ({ key: key(), id: x.id, name: x.name, options: x.options.join(', ') }))))
  useEffect(load, [])
  if (!rows) return <Loading />

  const save = async (next: Row[]) => {
    setRows(next)
    try {
      const saved = await api.saveChartFields(
        next.filter((f) => f.name.trim()).map((f) => ({ id: f.id, name: f.name.trim(), options: f.options.split(',').map((o) => o.trim()).filter(Boolean) }))
      )
      const byName = new Map(saved.map((f) => [f.name, f.id]))
      setRows((cur) => (cur ?? []).filter((f) => f.name.trim()).map((f) => ({ ...f, id: byName.get(f.name.trim()) ?? f.id })))
    } catch (e) {
      errorBanner('Couldn’t save the charting fields', e)
    }
  }

  return (
    <FormGroup title="Charting Fields" footnote="Per-play fields like coverage shell or run concept. Separate the options with commas.">
      {rows.map((f) => (
        <div className="settings-list-row" key={f.key}>
          <TextField value={f.name} commitOnBlur placeholder="Field name" width={180} onCommit={(v) => v !== f.name && void save(rows.map((x) => (x.key === f.key ? { ...x, name: v } : x)))} />
          <TextField
            value={f.options}
            commitOnBlur
            placeholder="Option 1, Option 2, …"
            style={{ flex: 1 }}
            onCommit={(v) => v !== f.options && void save(rows.map((x) => (x.key === f.key ? { ...x, options: v } : x)))}
          />
          <Button variant="borderless" size="sm" iconOnly icon="trash-2" label="Remove" onClick={() => void save(rows.filter((x) => x.key !== f.key))} />
        </div>
      ))}
      <div className="settings-list-row settings-list-row--add">
        <Button variant="borderless" size="sm" icon="plus" label="Add Field" onClick={() => setRows([...rows, { key: key(), name: '', options: '' }])} />
      </div>
    </FormGroup>
  )
}
