import type { ReactNode } from 'react'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'

/**
 * What is missing and the one action that fixes it (spec 01 §6.26). `small` is the compact variant for inspectors,
 * popovers and short lists: no icon, no button.
 */
export function EmptyState({
  icon,
  visual,
  title,
  body,
  primary,
  secondary,
  small,
  test,
  selectableBody
}: {
  icon?: IconName
  /** Replaces the icon (the downloading state shows a progress bar here). */
  visual?: ReactNode
  title: ReactNode
  body?: ReactNode
  primary?: { label: string; run: () => void; test?: string; disabled?: boolean; loading?: boolean }
  secondary?: ReactNode
  small?: boolean
  test?: string
  selectableBody?: boolean
}) {
  return (
    <div className={`empty-state${small ? ' empty-state--small' : ''}`} data-test={test}>
      <div className="empty-state__inner">
        {!small && (visual ?? (icon && <Icon name={icon} size={48} className="empty-state__icon" />))}
        <div className="empty-state__title">{title}</div>
        {body && <div className={`empty-state__body${selectableBody ? ' selectable' : ''}`}>{body}</div>}
        {!small && primary && (
          <div className="empty-state__actions">
            <Button variant="primary" size="lg" label={primary.label} onClick={primary.run} test={primary.test} disabled={primary.disabled} loading={primary.loading} />
            {secondary && <div className="empty-state__secondary">{secondary}</div>}
          </div>
        )}
        {!small && !primary && secondary && <div className="empty-state__secondary">{secondary}</div>}
      </div>
    </div>
  )
}
