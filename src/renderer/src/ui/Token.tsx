import { Icon } from './Icon'

/** A filter inside a search field: "Down: 3rd" (spec 01 §6.8). */
export function Token({ keyLabel, label, selected, onRemove }: { keyLabel: string; label: string; selected?: boolean; onRemove?: () => void }) {
  return (
    <span className="token" aria-selected={selected}>
      {keyLabel && <span className="token__key">{keyLabel}</span>}
      <span className="token__value">{label}</span>
      {onRemove && (
        <button type="button" className="token__remove" aria-label={`Remove ${keyLabel} ${label}`} onMouseDown={(e) => e.preventDefault()} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  )
}
