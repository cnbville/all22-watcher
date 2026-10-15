import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../ui/Icon'
import { ProgressBar } from '../../ui/Progress'
import { prefersReducedMotion, useMeasure } from './hooks'
import { Poster } from './Poster'

/**
 * Theater building blocks: key art behind a page header, shelves of film stills with plain two-line labels, and a
 * thin trend line for a grade. Calm by design: one neutral palette, stills are the only imagery.
 */

type PosterRef = { clipId: number; at: number } | null

/**
 * A darkened film still behind a page header, fading left-to-right and at the bottom into the page. Without a still
 * it is a quiet dark surface. Put it first in the page: `.page:has(> .theater-keyart)` lets it run full width and
 * keeps the rest of the page in the usual column.
 */
export function KeyArt({
  poster,
  children,
  size = 'md',
  test,
  className,
  onContextMenu
}: {
  poster: PosterRef
  children: ReactNode
  /** md: team and player headers; lg: the home hero. */
  size?: 'md' | 'lg'
  test?: string
  className?: string
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className={`theater-keyart theater-keyart--${size}${poster ? '' : ' theater-keyart--blank'}${className ? ` ${className}` : ''}`}
      data-test={test}
      onContextMenu={onContextMenu}
    >
      {poster && <Poster poster={poster} width={1600} className="theater-keyart__still" />}
      <div className="theater-keyart__shade" aria-hidden />
      <div className="theater-keyart__content">{children}</div>
    </div>
  )
}

/** A horizontally scrolling row of cards that snap to their start, with paging buttons on hover. */
export function Shelf({ children, minTile = 220, gap = 20, test }: { children: ReactNode; minTile?: number; gap?: number; test?: string }) {
  const [measure, width] = useMeasure<HTMLDivElement>(1136)
  const n = Math.max(2, Math.floor((width + gap) / (minTile + gap)))
  const tileW = Math.max(0, (width - (n - 1) * gap) / n)
  const ref = useRef<HTMLDivElement | null>(null)
  const [can, setCan] = useState({ left: false, right: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCan({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }, [])
  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [update, children])
  const page = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * (tileW + gap) * n, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }
  return (
    <div className="theater-shelf" ref={measure} data-test={test} style={{ '--shelf-tile': `${tileW}px`, '--shelf-gap': `${gap}px` } as CSSProperties}>
      <div
        ref={ref}
        className="theater-shelf__track"
        onScroll={update}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          const items = Array.from(ref.current?.children ?? []) as HTMLElement[]
          const i = items.findIndex((x) => x.contains(document.activeElement))
          if (i < 0) return
          const next = items[i + (e.key === 'ArrowRight' ? 1 : -1)]
          if (next) {
            e.preventDefault()
            e.stopPropagation()
            ;((next.matches('[tabindex]') ? next : next.querySelector('[tabindex]')) as HTMLElement | null)?.focus()
            next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
          }
        }}
      >
        {children}
      </div>
      <button type="button" className="theater-shelf__page theater-shelf__page--left" data-shown={can.left || undefined} aria-label="Previous" tabIndex={-1} onClick={() => page(-1)}>
        <Icon name="chevron-left" size={14} />
      </button>
      <button type="button" className="theater-shelf__page theater-shelf__page--right" data-shown={can.right || undefined} aria-label="Next" tabIndex={-1} onClick={() => page(1)}>
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  )
}

/**
 * A film still with two plain lines under it. Without a still, `blank` (a logo, say) sits on a quiet surface.
 * `overlay` draws over the still (a small button that shows on hover).
 */
export function StillCard({
  poster,
  blank,
  progress,
  line1,
  line2,
  overlay,
  onOpen,
  onContextMenu,
  test,
  title,
  className
}: {
  poster: PosterRef
  blank?: ReactNode
  progress?: number
  line1: ReactNode
  line2?: ReactNode
  overlay?: ReactNode
  onOpen: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  test?: string
  title?: string
  className?: string
}) {
  const extras = (
    <>
      {progress !== undefined && <ProgressBar value={progress} mini style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} />}
      {overlay && <span className="still-card__overlay">{overlay}</span>}
    </>
  )
  return (
    <div
      className={`still-card${className ? ` ${className}` : ''}`}
      role="button"
      tabIndex={0}
      data-test={test}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onOpen()
        }
      }}
    >
      {poster || blank === undefined ? (
        <Poster poster={poster} className="still-card__still">
          {extras}
        </Poster>
      ) : (
        <div className="still-card__still still-card__still--blank">
          <span className="still-card__blank">{blank}</span>
          {extras}
        </div>
      )}
      <div className="still-card__line1">{line1}</div>
      {line2 !== undefined && <div className="still-card__line2">{line2}</div>}
    </div>
  )
}

/** A thin line through a run of 0–100 grades, scaled to its own range so the shape reads. */
export function ThinTrend({ values, label }: { values: number[]; label?: string }) {
  if (values.length < 2) return <span className="thin-trend thin-trend--empty" aria-hidden />
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = Math.max(20, hi - lo)
  const mid = (lo + hi) / 2
  const y = (v: number) => 2 + (1 - (v - (mid - span / 2)) / span) * 18
  const pts = values.map((v, i) => `${(i * 100) / (values.length - 1)},${y(v).toFixed(2)}`).join(' ')
  return (
    <svg className="thin-trend" viewBox="0 0 100 22" preserveAspectRatio="none" role="img" aria-label={label ?? `Trend, last ${Math.round(values[values.length - 1])}`}>
      <polyline points={pts} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** A label over a figure: the few numbers that matter on a page, with an optional quiet note (a league rank). */
export function KeyNumber({ value, label, note, test, title }: { value: ReactNode; label: ReactNode; note?: ReactNode; test?: string; title?: string }) {
  return (
    <div className="key-number" data-test={test} title={title}>
      <div className="key-number__value num">{value}</div>
      <div className="key-number__label">
        {label}
        {note && <span className="key-number__note"> {note}</span>}
      </div>
    </div>
  )
}
