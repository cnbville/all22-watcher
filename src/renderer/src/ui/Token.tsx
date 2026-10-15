import { Icon } from './Icon'

/** A filter inside a search field: "Down: 3rd" (spec 01 §6.8). */
export function Token({
  keyLabel,
  label,
  selected,
  onRemove,
  onClick
}: {
  keyLabel: string
  label: string
  selected?: boolean
  onRemove?: () => void
  /** Clicking the token (not its remove button), e.g. to open its values in a menu. */
  onClick?: (anchor: HTMLElement) => void
}) {
  return (
    <span
      className="token"
      aria-selected={selected}
      data-clickable={onClick ? true : undefined}
      onMouseDown={
        onClick
          ? (e) => {
              if ((e.target as HTMLElement).closest('.token__remove')) return
              e.preventDefault()
              e.stopPropagation()
              onClick(e.currentTarget)
            }
          : undefined
      }
    >
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
