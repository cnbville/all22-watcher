import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { useLayer } from './keyboard'

/** True inside a sheet: commands registered here stay enabled while the sheet blocks the screen's (01 §3.1). */
export const SheetContext = createContext(false)
export const useInSheet = () => useContext(SheetContext)

export interface SheetPrimary {
  label: string
  run: () => void
  disabled?: boolean
  loading?: boolean
  test?: string
}

const WIDTHS = { S: 440, M: 600, L: 820, XL: 1080 }

/**
 * Modal task attached under the toolbar (spec 01 §6.19). Focus is trapped; ↩ runs the primary (not in a text area
 * or while a menu is open); esc and ⌘. cancel; clicking the backdrop does nothing.
 */
export function Sheet({
  title,
  subtitle,
  size = 'M',
  accessory,
  footer,
  footerLeading,
  onCancel,
  cancelLabel = 'Cancel',
  primary,
  test,
  children,
  bodyClassName
}: {
  title: ReactNode
  subtitle?: ReactNode
  size?: keyof typeof WIDTHS
  accessory?: ReactNode
  /** Replaces the whole footer. */
  footer?: ReactNode
  /** Tertiary action and status text at the footer's leading edge. */
  footerLeading?: ReactNode
  onCancel: () => void
  cancelLabel?: string | null
  primary?: SheetPrimary
  test?: string
  children: ReactNode
  bodyClassName?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const [closing, setClosing] = useState(false)

  const cancel = () => {
    setClosing(true)
    setTimeout(onCancel, 160)
  }

  useLayer(true, {
    kind: 'sheet',
    close: cancel,
    onKey: (e) => {
      if (e.key === 'Escape' || (e.key === '.' && e.metaKey)) {
        cancel()
        return true
      }
      if (e.key === 'Enter' && !e.shiftKey && primary && !primary.disabled && !primary.loading) {
        const t = e.target as HTMLElement
        if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.getAttribute('role') === 'button') return false
        // A focused table opens its selected row with ↩ (01 §6.15).
        if (t.closest('[role="grid"]')) return false
        e.preventDefault()
        primary.run()
        return true
      }
      if (e.key === 'Tab') {
        // Trap focus inside the sheet.
        const focusables = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, [tabindex="0"]') ?? [])]
        if (!focusables.length) return true
        const i = focusables.indexOf(document.activeElement as HTMLElement)
        const next = focusables[(i + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length]
        next.focus()
        return true
      }
      return false
    }
  })

  // Initial focus: the first field, else the primary button.
  useEffect(() => {
    const field = root.current?.querySelector<HTMLElement>('.sheet__body input:not([type=checkbox]):not([type=radio]), .sheet__body textarea')
    const primaryButton = root.current?.querySelector<HTMLElement>('.button--primary')
    ;(field ?? primaryButton ?? root.current)?.focus({ preventScroll: true })
  }, [])

  const onScroll = () => {
    const el = body.current
    if (!el) return
    setEdges({ top: el.scrollTop > 0, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 })
  }
  useEffect(() => {
    onScroll()
    const ro = new ResizeObserver(onScroll)
    if (body.current) ro.observe(body.current)
    return () => ro.disconnect()
  }, [])

  const layer = document.getElementById('layer-sheet') ?? document.body
  return createPortal(
    <SheetContext.Provider value={true}>
      <div className="sheet-backdrop" data-state={closing ? 'closing' : 'open'}>
        <div
          ref={root}
          className="sheet"
          role="dialog"
          aria-modal="true"
          data-test={test}
          tabIndex={-1}
          style={{ width: size === 'XL' ? 'min(1080px, calc(100vw - 64px))' : WIDTHS[size] }}
        >
          <div className="sheet__header" data-scrolled={edges.top || undefined}>
            <div className="sheet__titles">
              <div className="sheet__title">{title}</div>
              {subtitle && <div className="sheet__subtitle">{subtitle}</div>}
            </div>
            {accessory && <div className="sheet__accessory">{accessory}</div>}
          </div>
          <div ref={body} className={`sheet__body${bodyClassName ? ` ${bodyClassName}` : ''}`} onScroll={onScroll}>
            {children}
          </div>
          {footer !== null && (
            <div className="sheet__footer" data-more={edges.bottom || undefined}>
              {footer ?? (
                <>
                  <div className="sheet__footer-leading">{footerLeading}</div>
                  {cancelLabel && <Button size="md" label={cancelLabel} onClick={cancel} className="sheet__footer-button" />}
                  {primary && (
                    <Button
                      size="md"
                      variant="primary"
                      label={primary.label}
                      onClick={primary.run}
                      disabled={primary.disabled}
                      loading={primary.loading}
                      test={primary.test}
                      className="sheet__footer-button"
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </SheetContext.Provider>,
    layer
  )
}
