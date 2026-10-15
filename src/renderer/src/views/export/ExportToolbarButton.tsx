import { useRef } from 'react'
import { commandTooltip } from '@shared/commands'
import { Icon } from '../../ui/Icon'
import { openMenu } from '../../ui/Menu'
import { ProgressRing } from '../../ui/Progress'
import { cancelExport, progressOf, useRunningExportFor } from './exportModel'

/**
 * The toolbar's Export button (03 §11.7): `share`, or a progress ring while an export started from this screen runs;
 * then a click shows "Cancel Export" above "Export Video…".
 */
export function ExportToolbarButton({ route, disabled, onExport, test, label = 'Export Video…' }: { route: string; disabled?: boolean; onExport: () => void; test?: string; label?: string }) {
  const run = useRunningExportFor(route)
  const ref = useRef<HTMLButtonElement>(null)
  const pct = run ? Math.round(progressOf(run.activity) * 100) : 0
  const title = run ? `Exporting… ${pct}%` : disabled ? `${commandTooltip('file.exportVideo', label)} · No film for these plays` : commandTooltip('file.exportVideo', label)
  return (
    <button
      ref={ref}
      type="button"
      className="button button--toolbar button--toolbar button--icon"
      aria-label={label}
      title={title}
      disabled={disabled && !run}
      data-test={test}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (!run) return onExport()
        openMenu({
          anchor: ref.current!,
          placement: 'below',
          items: [
            { label: 'Cancel Export', disabled: run.activity.id.startsWith('local-'), run: () => cancelExport(run.activity.id) },
            { kind: 'separator' },
            { label, disabled, run: onExport }
          ]
        })
      }}
    >
      {run ? <ProgressRing value={progressOf(run.activity)} size={14} /> : <Icon name="share" size={16} />}
    </button>
  )
}
