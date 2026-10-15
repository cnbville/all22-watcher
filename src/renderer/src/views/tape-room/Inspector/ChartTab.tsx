import { EmptyState } from '../../../ui/EmptyState'
import { PopupButton } from '../../../ui/PopupButton'
import type { Room } from '../model'

/** The Chart tab (02 §6.6): one popup per charting field, saved at once. */
export function ChartTab({ room }: { room: Room }) {
  const fields = room.chartFields
  const chart = room.currentNote?.chart ?? {}
  if (!fields.length) {
    return <EmptyState small title="No charting fields" body="Add fields such as Front or Concept in Settings › Charting (⌘,)." />
  }
  return (
    <div className="chart-tab">
      <dl className="inspector-form">
        {fields.map((f) => (
          <div key={f.id} className="inspector-form__row">
            <dt>{f.name}</dt>
            <dd>
              <PopupButton
                size="md"
                test={`chart-field-${f.id}`}
                value={chart[f.name] ?? ''}
                options={[{ value: '', label: '—' }, ...f.options.map((o) => ({ value: o, label: o }))]}
                onChange={(v) => room.setChart(f.name, v)}
              />
            </dd>
          </div>
        ))}
      </dl>
      <div className="chart-tab__footnote">Charting fields are set up in Settings › Charting.</div>
    </div>
  )
}
