import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { gradeScore } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { Grade, GradeTally } from '@shared/types'
import { gradeSymbol, initials } from '../format'

export function TeamChip({ abbr, size }: { abbr: string; size?: 'sm' | 'lg' }) {
  const t = TEAM_BY_ABBR[abbr]
  const bg = t ? `linear-gradient(135deg, ${t.color} 0%, ${t.color} 60%, ${t.color2} 140%)` : '#333'
  return (
    <span className={`team-chip ${size ?? ''}`} style={{ background: bg }} title={t?.name ?? abbr}>
      {abbr}
    </span>
  )
}

export function GradeBar({ tally }: { tally: GradeTally }) {
  if (!tally.graded) return <div className="grade-bar" />
  const w = (n: number) => `${(100 * n) / tally.graded}%`
  return (
    <div className="grade-bar" title={`${tally.plus} plus · ${tally.zero} zero · ${tally.minus} minus`}>
      <div className="p" style={{ width: w(tally.plus) }} />
      <div className="z" style={{ width: w(tally.zero) }} />
      <div className="m" style={{ width: w(tally.minus) }} />
    </div>
  )
}

export function Score({ tally }: { tally: GradeTally }) {
  const s = gradeScore(tally)
  if (s === null) return <span className="faint">—</span>
  return <span className={`score ${s >= 60 ? 'hi' : s < 45 ? 'lo' : ''}`}>{s}</span>
}

export function GradeSymbol({ grade }: { grade: Grade | null }) {
  const cls = grade === null ? 'n' : grade > 0 ? 'p' : grade < 0 ? 'm' : 'z'
  return <span className={`gsym ${cls}`}>{gradeSymbol(grade)}</span>
}

export function Headshot({ url, name, size = 84 }: { url: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size, fontSize: size * 0.32 }
  if (!url || failed) return <div className="headshot" style={style}>{initials(name)}</div>
  return <img className="headshot" style={style} src={url} alt="" onError={() => setFailed(true)} />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method 'api': (Error: )?/, '') : String(error)
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true })
  const counter = useRef(0)
  const run = useCallback(() => {
    const id = ++counter.current
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then(
      (data) => id === counter.current && setState({ data, error: null, loading: false }),
      (error) => id === counter.current && setState({ data: null, error, loading: false })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(run, [run])
  return { ...state, reload: run, setData: (d: T) => setState({ data: d, error: null, loading: false }) }
}
