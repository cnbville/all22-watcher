import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Spinner'
import { errorText } from './Banners'
import { historyState, useHistory } from './router'
import { loadInspector, readTapeRoomSidebar, setUi } from './uiState'

/**
 * A screen's root (01 §2.2, §2.8): sets `.screen-<name>` and `data-test="screen-<name>"`, tells the shell whether it
 * has an inspector, tracks scrolling for the toolbar separator and restores scroll position on Back/Forward.
 */
export function Screen({
  name,
  scroll = 'page',
  inspector,
  inspectorWidth,
  inspectorMin,
  takeover,
  children,
  className
}: {
  name: string
  /** 'page': `.shell-content` scrolls with the page column; 'none': the screen lays itself out (tape room). */
  scroll?: 'page' | 'none'
  inspector?: ReactNode
  inspectorWidth?: number
  inspectorMin?: number
  /** The tape room takes over the window: the sidebar collapses unless the user keeps it (01 §1.5). */
  takeover?: boolean
  children: ReactNode
  className?: string
}) {
  const hasInspector = inspector !== undefined
  useLayoutEffect(() => {
    setUi({ screen: name, hasInspector, scrolled: false, largeTitleVisible: true })
    if (hasInspector) loadInspector(name, inspectorWidth, inspectorMin)
  }, [name, hasInspector, inspectorWidth, inspectorMin])

  useLayoutEffect(() => {
    if (!takeover) return
    setUi({ tapeRoomSidebar: readTapeRoomSidebar() })
    return () => setUi({ tapeRoomSidebar: null, filmOnly: false })
  }, [takeover])

  useLayoutEffect(() => {
    const content = document.getElementById('content')
    if (!content) return
    content.dataset.scroll = scroll
    if (scroll === 'none') return
    const onScroll = () => setUi({ scrolled: content.scrollTop > 0 })
    content.addEventListener('scroll', onScroll, { passive: true })
    return () => content.removeEventListener('scroll', onScroll)
  }, [scroll])

  return (
    <div className={`screen screen-${name}${className ? ` ${className}` : ''}`} data-test={`screen-${name}`}>
      {scroll === 'page' ? <div className="page">{children}</div> : children}
      {hasInspector && <InspectorPortal>{inspector}</InspectorPortal>}
    </div>
  )
}

function InspectorPortal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setEl(document.getElementById('inspector-slot')), [])
  return el ? createPortal(children, el) : null
}

/**
 * Restores the scroll position of the current history entry once the screen's content is ready (on Back/Forward),
 * otherwise starts at the top. Call with `ready` true once data has rendered.
 */
export function useScrollRestore(ready: boolean) {
  const { index, via } = useHistory()
  const done = useRef(-1)
  useLayoutEffect(() => {
    if (!ready || done.current === index) return
    done.current = index
    const content = document.getElementById('content')
    if (!content) return
    const top = via === 'back' || via === 'forward' || via === 'load' ? historyState().entries[index]?.scrollTop ?? 0 : 0
    content.scrollTop = top
    setUi({ scrolled: top > 0 })
  }, [ready, index, via])
}

/** 26/32 bold page title; the toolbar title fades in once it scrolls under the toolbar (01 §2.4). */
export function LargeTitle({ children, test }: { children: ReactNode; test?: string }) {
  return (
    <CollapsingTitle className="large-title t-large-title" test={test}>
      {children}
    </CollapsingTitle>
  )
}

/** Any header that counts as the large title (team and player headers). */
export function CollapsingTitle({ children, className, test }: { children: ReactNode; className?: string; test?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    const root = document.getElementById('content')
    if (!el || !root) return
    const io = new IntersectionObserver(([e]) => setUi({ largeTitleVisible: e.isIntersecting }), { root, rootMargin: '-52px 0px 0px 0px', threshold: 0 })
    io.observe(el)
    return () => {
      io.disconnect()
      setUi({ largeTitleVisible: false })
    }
  }, [])
  return (
    <div ref={ref} className={className} data-test={test}>
      {children}
    </div>
  )
}

/** Page section: title-2 header row with an optional "See All" (01 §2.8). */
export function Section({
  title,
  seeAll,
  trailing,
  children,
  className,
  test
}: {
  title?: ReactNode
  seeAll?: () => void
  trailing?: ReactNode
  children: ReactNode
  className?: string
  test?: string
}) {
  return (
    <section className={`page-section${className ? ` ${className}` : ''}`} data-test={test}>
      {(title || seeAll || trailing) && (
        <div className="page-section__header">
          <h2 className="t-title-2">{title}</h2>
          {trailing}
          {seeAll && (
            <button type="button" className="see-all" onMouseDown={(e) => e.preventDefault()} onClick={seeAll}>
              See All
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}
        </div>
      )}
      {children}
    </section>
  )
}

/** Nothing for 200ms, then a 20px spinner with "Loading…" (01 §8.3). */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 200)
    return () => clearTimeout(t)
  }, [])
  if (!show) return <div className="loading" />
  return (
    <div className="loading" role="status">
      <Spinner size={20} />
      <span className="loading__label">{label}</span>
    </div>
  )
}

/** A screen's data failed to load (01 §8.4). */
export function LoadError({ what, error, retry }: { what: string; error: unknown; retry?: () => void }) {
  return (
    <EmptyState
      icon="circle-alert"
      title={`Couldn’t load ${what}`}
      body={errorText(error)}
      selectableBody
      primary={retry ? { label: 'Try Again', run: retry } : undefined}
    />
  )
}
