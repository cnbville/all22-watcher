import type { ReactNode } from 'react'

/** A titled group box of settings-like rows (spec 01 §6.17). */
export function FormGroup({ title, footnote, children, trailing }: { title?: ReactNode; footnote?: ReactNode; children: ReactNode; trailing?: ReactNode }) {
  return (
    <section className="form-group">
      {(title || trailing) && (
        <div className="form-group__title-row">
          {title && <h3 className="form-group__title">{title}</h3>}
          {trailing}
        </div>
      )}
      <div className="form-group__box">{children}</div>
      {footnote && <p className="form-group__footnote">{footnote}</p>}
    </section>
  )
}

/** One row: label (and optional description) on the left, the control right-aligned. */
export function FormRow({ label, description, children, test, stacked }: { label: ReactNode; description?: ReactNode; children?: ReactNode; test?: string; stacked?: boolean }) {
  return (
    <div className={`form-row${stacked ? ' form-row--stacked' : ''}`} data-test={test}>
      <div className="form-row__text">
        <div className="form-row__label">{label}</div>
        {description && <div className="form-row__description">{description}</div>}
      </div>
      {children !== undefined && <div className="form-row__control">{children}</div>}
    </div>
  )
}

/** Inspector-style key/value grid: 96px labels and values (spec 01 §2.7). */
export function InfoGrid({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="info-grid">
      {rows.map(([k, v], i) => (
        <div key={i} className="info-grid__row">
          <dt>{k}</dt>
          <dd className="selectable">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export { FormGroup as GroupedForm }
