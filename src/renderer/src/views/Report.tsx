import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { playCaption, shortDesc } from '@shared/labels'
import { computeSplits, type SplitRow } from '@shared/splits'
import { emptyTally, gradeScore, mergeTally, plusRate } from '@shared/stats'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { ChartField, GradeTally, PlayerProfile, PlayerSeasonLine, SeasonStatus, TagDef, TeamSummary } from '@shared/types'
import { api } from '../api'
import { experienceLabel, formatEpa, formatPct, gameOutcome, heightLabel, initials, ordinal, statColumns, weekCode } from '../format'
import { heatPrint } from '../ui/heat'
import { Icon } from '../ui/Icon'
import { teamColor } from '../format'
import { careerRange, careerSeasons, type LineState } from './player/Career'
import {
  epaByGame,
  epaFigures,
  epaPoints,
  gameBars,
  MEASURE_CHOICES,
  MEASURES,
  meanEpa,
  opponentGames,
  reelEntries,
  secondLook,
  seasonCells,
  splitPlays,
  tagPolarity,
  teamsLine
} from './player/model'
import { CareerTrend, GradeByGameChart, GradeEpaStrip, LargeTallyBar, OpponentScatter, type ReelEntry, sampleTone, SplitBar, tierSummaries } from './shared'
import '../styles/report.css'

/**
 * The printable scouting report (03 §12): a light page on white, 720px wide, that main prints to a Letter PDF once
 * `body[data-ready]` is set. No shell, no stores: everything loads here.
 */

interface ReportData {
  p: PlayerProfile
  tags: TagDef[]
  chartFields: ChartField[]
  summaries: TeamSummary[]
  seasons: SeasonStatus[]
}

const WIDTH = 720
const HALF = 348

const plays = (n: number) => `${n} ${n === 1 ? 'play' : 'plays'}`
const tallyText = (t: GradeTally) => `${t.plus} / ${t.zero} / ${t.minus}`
const exportedOn = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Waits for a promise, but no longer than `ms`. */
const within = <T,>(p: Promise<T>, ms: number): Promise<T | undefined> => Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))])

export function Report({ season, playerId }: { season: number; playerId: string }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [failed, setFailed] = useState(false)
  const [career, setCareer] = useState<Map<number, LineState> | null>(null)
  const avatar = useRef<HTMLImageElement>(null)
  const [headshotFailed, setHeadshotFailed] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.print = '1'
    let live = true
    void (async () => {
      try {
        const [p, tags, chartFields, summaries, seasons] = await Promise.all([
          api.playerProfile(season, playerId),
          api.tags().catch(() => [] as TagDef[]),
          api.chartFields().catch(() => [] as ChartField[]),
          api.teamSummaries(season).catch(() => [] as TeamSummary[]),
          api.seasons().catch(() => [] as SeasonStatus[])
        ])
        if (!live) return
        if (!p) {
          setFailed(true)
          return
        }
        setData({ p, tags, chartFields, summaries, seasons })
        // Career's season lines, at most 10 s (§12.1).
        const range = careerRange(season, p.player.yearsExp, seasons)
        const downloaded = new Set(seasons.filter((s) => s.downloaded).map((s) => s.season))
        const hint = { name: p.player.name, group: p.player.group }
        const lines = await within(
          Promise.all(
            range.map(async (s): Promise<[number, LineState]> => {
              if (!downloaded.has(s)) return [s, { state: 'notDownloaded' }]
              const line = await api.playerSeasonLine(s, playerId, hint).catch(() => null)
              return [s, line ? { state: 'line', line } : { state: 'none' }]
            })
          ),
          10_000
        )
        if (live) setCareer(new Map(lines ?? []))
      } catch {
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [season, playerId])

  // Ready once the data, Career and the headshot are in, then two frames for layout (§12).
  useEffect(() => {
    if (!failed && (!data || !career)) return
    let live = true
    void (async () => {
      const img = avatar.current
      if (img) {
        const ok = await within(
          img.decode().then(
            () => true,
            () => false
          ),
          3000
        )
        if (!ok && live) setHeadshotFailed(true)
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (live) document.body.dataset.ready = '1'
        })
      )
    })()
    return () => {
      live = false
    }
  }, [data, career, failed])

  if (failed) return <div className="report report--message">Player not found.</div>
  if (!data) return <div className="report report--message">Loading…</div>
  return <ReportBody data={data} season={season} career={career ?? new Map()} avatar={avatar} headshotFailed={headshotFailed} onHeadshotError={() => setHeadshotFailed(true)} />
}

function ReportBody({
  data,
  season,
  career,
  avatar,
  headshotFailed,
  onHeadshotError
}: {
  data: ReportData
  season: number
  career: Map<number, LineState>
  avatar: React.RefObject<HTMLImageElement | null>
  headshotFailed: boolean
  onHeadshotError: () => void
}) {
  const { p } = data
  const entries = useMemo(() => reelEntries(p), [p])
  const graded = p.tally.graded > 0
  return (
    <div className="report" data-test="report">
      <Header p={p} season={season} avatar={avatar} headshotFailed={headshotFailed} onHeadshotError={onHeadshotError} />
      <StatStrip cells={seasonCells(p)} />
      {graded && <Breakdown data={data} />}
      {graded && <Situations data={data} />}
      {graded && <ByOpponent data={data} season={season} />}
      {graded && <GradeVsEpa p={p} entries={entries} />}
      <CareerBlock p={p} season={season} lines={career} />
      <GameLog p={p} />
      <Notes entries={entries} />
      <p className="report__credit">
        Grades from your own film study in All-22 Watcher. Stats, rosters and EPA from nflverse. Exported {exportedOn(new Date())}.
      </p>
    </div>
  )
}

function Block({ title, children, className, long }: { title: string; children: ReactNode; className?: string; long?: boolean }) {
  return (
    <section className={`report__block${long ? ' report__block--long' : ''}${className ? ` ${className}` : ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

// ── 1. Header ────────────────────────────────────────────────────────────────

function Header({
  p,
  season,
  avatar,
  headshotFailed,
  onHeadshotError
}: {
  p: PlayerProfile
  season: number
  avatar: React.RefObject<HTMLImageElement | null>
  headshotFailed: boolean
  onHeadshotError: () => void
}) {
  const player = p.player
  const team = TEAM_BY_ABBR[player.team]
  const t = p.tally
  const bio = [player.college, heightLabel(player.height), player.weight ? `${player.weight} lb` : '', experienceLabel(player.yearsExp)].filter(Boolean).join(' · ')
  const moved = teamsLine(p)
  return (
    <header className="report__header" style={{ '--team-raw': teamColor(player.team) } as CSSProperties}>
      <div className="report__rule" />
      <div className="report__eyebrow">
        {season} scouting report · {team?.name ?? player.team}
      </div>
      <div className="report__head-row">
        <span className="report__avatar">
          {player.headshot && !headshotFailed ? <img ref={avatar} src={player.headshot} alt="" onError={onHeadshotError} /> : <span>{initials(player.name)}</span>}
        </span>
        <div className="report__head-text">
          <h1>{player.name}</h1>
          <div className="report__line">
            {player.jersey ? `#${player.jersey} · ` : ''}
            {player.depthPos || player.position} · {team?.name ?? player.team}
          </div>
          {bio && <div className="report__bio">{bio}</div>}
          {moved && (
            <div className="report__bio">
              {moved.before}
              {moved.link?.text}
              {moved.after}
            </div>
          )}
        </div>
        <div className="report__grade">
          <PrintRing score={t.graded ? gradeScore(t) : null} />
          <div className="report__caption">{t.graded ? `${plays(t.graded)} graded · ${formatPct(plusRate(t))} plus` : 'Not graded yet'}</div>
        </div>
      </div>
    </header>
  )
}

/** The ring gauge at 88 in print ink (01 §6.30 geometry: a 270° arc from the bottom-left). */
function PrintRing({ score }: { score: number | null }) {
  const size = 88
  const stroke = 9
  const r = (size - stroke) / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r
  const arc = (circumference * 270) / 360
  const value = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100
  return (
    <span className="report-ring" role="img" aria-label={score === null ? 'Not graded' : `Grade ${Math.round(score)}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="report-ring__track" cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc} ${circumference}`} transform={`rotate(135 ${c} ${c})`} />
        {score !== null && value > 0 && (
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={heatPrint.ink(score)}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc * value} ${circumference}`}
            transform={`rotate(135 ${c} ${c})`}
          />
        )}
      </svg>
      <span className="report-ring__center">
        <span className="report-ring__value" style={score === null ? undefined : { color: heatPrint.ink(score) }}>
          {score === null ? '—' : Math.round(score)}
        </span>
        <span className="report-ring__label">Grade</span>
      </span>
    </span>
  )
}

// ── 2. Season strip ──────────────────────────────────────────────────────────

function StatStrip({ cells }: { cells: { key: string; label: string; value: string }[] }) {
  return (
    <div className="report__strip" style={{ '--cells': cells.length } as CSSProperties}>
      {cells.map((c) => (
        <div key={c.key} className="report__strip-cell">
          <div className="report__strip-label">{c.label}</div>
          <div className="report__strip-value">{c.value}</div>
        </div>
      ))}
    </div>
  )
}

// ── 3. Grade Breakdown and Grade by Game ─────────────────────────────────────

function Breakdown({ data }: { data: ReportData }) {
  const { p } = data
  const t = p.tally
  const polarity = tagPolarity(data.tags, p.player.group)
  const bars = gameBars(p, p.games.filter((g) => g.tally.graded).length > 8 ? 'week' : 'opp')
  return (
    <div className="report__pair">
      <Block title="Grade Breakdown">
        <div className="report__figures">
          <Figure label="Plus" value={t.plus} color={heatPrint.ink(100)} />
          <Figure label="Zero" value={t.zero} color={heatPrint.ink(50)} />
          <Figure label="Minus" value={t.minus} color={heatPrint.ink(0)} />
          <Figure label="Critical" value={t.critical} />
          <Figure label="Plus rate" value={formatPct(plusRate(t))} />
        </div>
        <div className="report__tally">
          <LargeTallyBar tally={t} palette="print" />
        </div>
        {p.tagCounts.length > 0 && (
          <>
            <div className="report__subhead">Tags</div>
            <div className="report__chips">
              {p.tagCounts.map((tag) => {
                const kind = polarity.get(tag.tag) ?? 'neutral'
                const style =
                  kind === 'pos'
                    ? { background: heatPrint.tint(100), color: heatPrint.ink(100) }
                    : kind === 'neg'
                      ? { background: heatPrint.tint(0), color: heatPrint.ink(0) }
                      : undefined
                return (
                  <span key={tag.tag} className="report__chip" style={style}>
                    {tag.tag} <b>{tag.count}</b>
                  </span>
                )
              })}
            </div>
          </>
        )}
      </Block>
      <Block title="Grade by Game">
        <GradeByGameChart games={bars} width={HALF} height={140} palette="print" animate={false} valueLabelMax={17} />
      </Block>
    </div>
  )
}

function Figure({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="report__figure">
      <div className="report__figure-label">{label}</div>
      <div className="report__figure-value" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}

function PrintGrade({ score, plays: n }: { score: number | null; plays: number }) {
  const tone = sampleTone(n)
  if (score === null || tone === 'none') return <span className="report__dash">—</span>
  return <span className={`report__grade-num${tone === 'small' ? ' report__grade-num--small' : ''}`} style={tone === 'full' ? { color: heatPrint.ink(score) } : undefined}>{Math.round(score)}</span>
}

const Dash = () => <span className="report__dash">—</span>

// ── 4. Situations ────────────────────────────────────────────────────────────

function Situations({ data }: { data: ReportData }) {
  const { p } = data
  const groups = useMemo(() => computeSplits(splitPlays(p), { type: 'all', hasParticipation: p.hasParticipation, chartFields: [] }), [p])
  const wanted = ['type', 'down', 'pressure', 'manZone', 'coverage']
  const shown = wanted
    .map((k) => groups.find((g) => g.key === k))
    .filter((g): g is NonNullable<typeof g> => !!g && !g.notPublished)
    .map((g) => {
      let rows = g.rows.filter((r) => r.tally.graded > 0)
      if (g.key === 'coverage') rows = [...rows].sort((a, b) => b.tally.graded - a.tally.graded).slice(0, 4)
      return { key: g.key, label: g.label, rows }
    })
    .filter((g) => g.rows.length)
  if (!shown.length) return null
  return (
    <Block title="Situations" long>
      <table className="report-table">
        <thead>
          <tr>
            <th>Split</th>
            <th className="num w44">Plays</th>
            <th className="num w64">+ / 0 / −</th>
            <th className="num w44">Grade</th>
            <th className="w120" />
            <th className="num w56">EPA / play</th>
            <th className="num w52">Success</th>
          </tr>
        </thead>
        {shown.map((g) => (
          <tbody key={g.key}>
            <tr className="report-table__group">
              <td colSpan={7}>{g.label}</td>
            </tr>
            {g.rows.map((r: SplitRow) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="num">{r.tally.graded}</td>
                <td className="num muted">{tallyText(r.tally)}</td>
                <td className="num">
                  <PrintGrade score={r.grade} plays={r.tally.graded} />
                </td>
                <td>
                  <SplitBar score={r.grade} plays={r.tally.graded} width={120} palette="print" />
                </td>
                <td className="num">{r.epa === null ? <Dash /> : formatEpa(r.epa)}</td>
                <td className="num">{r.success === null ? <Dash /> : formatPct(r.success)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="report__footnote">Grades from fewer than 5 plays are grey.</p>
    </Block>
  )
}

// ── 5. By Opponent ───────────────────────────────────────────────────────────

function ByOpponent({ data, season }: { data: ReportData; season: number }) {
  const { p } = data
  const measure = MEASURE_CHOICES[p.player.group][0]
  const m = MEASURES[measure]
  const games = useMemo(() => opponentGames(p, data.summaries, measure), [p, data.summaries, measure])
  const epa = useMemo(() => epaByGame(p), [p])
  const lines = new Map(p.games.map((g) => [g.game.gameId, g]))
  if (!games.length) return null
  const tiers = tierSummaries(games)
  return (
    <Block title="By Opponent" long>
      {games.length >= 4 && (
        <div className="report__chart">
          <OpponentScatter games={games} width={WIDTH} height={160} palette="print" animate={false} />
        </div>
      )}
      <div className="report__tiers">
        {tiers.map((t) => (
          <div key={t.tier} className="report__tier">
            <span>{t.label}</span>
            <span className="report__tier-grade">
              <PrintGrade score={t.score} plays={t.tally.graded} />
            </span>
            <span className="muted">{t.games ? `${t.games} ${t.games === 1 ? 'game' : 'games'}` : 'No games'}</span>
          </div>
        ))}
      </div>
      <table className="report-table">
        <thead>
          <tr>
            <th className="w40">Wk</th>
            <th>Opponent</th>
            <th className="w88">{m.column}</th>
            <th className="num w44">Plays</th>
            <th className="num w64">+ / 0 / −</th>
            <th className="num w44">Grade</th>
            <th className="num w56">EPA / play</th>
            <th className="w72">Result</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const line = lines.get(g.key)!
            const o = gameOutcome(line.game, line.team)
            const e = epa.get(g.key)
            return (
              <tr key={g.key}>
                <td className="muted">{weekCode(line.game)}</td>
                <td>
                  {line.team === line.game.homeTeam ? 'vs' : '@'} {g.opp} <span className="muted">{TEAM_BY_ABBR[g.opp]?.nickname}</span>
                </td>
                <td>{g.rank ? ordinal(g.rank) : <Dash />}</td>
                <td className="num">{g.tally.graded}</td>
                <td className="num muted">{tallyText(g.tally)}</td>
                <td className="num">
                  <PrintGrade score={g.score} plays={g.tally.graded} />
                </td>
                <td className="num">{e == null ? <Dash /> : formatEpa(e)}</td>
                <td>{o ? `${o.letter} ${o.score}` : <Dash />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="report__footnote">
        Opponent strength is each opponent’s {season} regular-season rank in {m.noun} (1st is the best unit).
      </p>
    </Block>
  )
}

// ── 6. Grade vs EPA ──────────────────────────────────────────────────────────

function GradeVsEpa({ p, entries }: { p: PlayerProfile; entries: ReelEntry[] }) {
  const points = useMemo(() => epaPoints(entries), [entries])
  if (points.length < 5) return null
  const figs = epaFigures(points)
  const look = secondLook(entries, 3)
  const team = TEAM_BY_ABBR[p.player.team]
  return (
    <Block title="Grade vs EPA">
      <div className="report__chart">
        <GradeEpaStrip points={points} teamName={team?.nickname ?? p.player.team} width={WIDTH} height={168} palette="print" animate={false} />
      </div>
      <div className="report__figures report__figures--four">
        {figs.lanes.map((l) => (
          <div key={l.grade} className="report__figure">
            <div className="report__figure-label">{l.grade === 1 ? '+ plays' : l.grade === 0 ? '0 plays' : '− plays'}</div>
            <div className="report__figure-value">{l.mean === null ? '—' : formatEpa(l.mean)}</div>
            <div className="report__caption">average EPA · {plays(l.plays)}</div>
          </div>
        ))}
        <div className="report__figure">
          <div className="report__figure-label">Agreement</div>
          <div className="report__figure-value">{figs.agreement === null ? '—' : formatPct(figs.agreement)}</div>
          <div className="report__caption">of + and − plays where EPA agrees</div>
        </div>
      </div>
      {look.length > 0 && (
        <>
          <div className="report__subhead">Worth a Second Look</div>
          {look.map((e) => (
            <div key={`${e.ref.gameId}:${e.ref.playId}`} className="report__note">
              <Glyph grade={e.grade ?? 0} critical={e.critical} />
              <div className="report__note-body">
                <div className="report__caption">{playCaption(e.game, e.team, e.play)}</div>
                <div className="report__note-text">{e.play ? shortDesc(e.play.desc) : ''}</div>
              </div>
              <div className="report__note-epa">{e.teamEpa == null ? '' : `EPA ${formatEpa(e.teamEpa)}`}</div>
            </div>
          ))}
        </>
      )}
    </Block>
  )
}

function Glyph({ grade, critical }: { grade: -1 | 0 | 1; critical?: boolean }) {
  const score = grade === 1 ? 100 : grade === -1 ? 0 : 50
  return (
    <span className="report__glyph" style={{ color: heatPrint.ink(score) }}>
      {grade === 1 ? '+' : grade === -1 ? '−' : '0'}
      {critical && <Icon name="zap" size={10} />}
    </span>
  )
}

// ── 7. Career ────────────────────────────────────────────────────────────────

function CareerBlock({ p, season, lines }: { p: PlayerProfile; season: number; lines: Map<number, LineState> }) {
  const withLines = [...lines.entries()].filter((e): e is [number, { state: 'line'; line: PlayerSeasonLine }] => e[1].state === 'line')
  if (withLines.length < 2) return null
  const seasons = careerSeasons(lines)
  const missing = [...lines.entries()].filter(([, s]) => s.state === 'notDownloaded').map(([s]) => s).sort((a, b) => a - b)
  const total = withLines.reduce((t, [, s]) => mergeTally(t, s.line.tally), emptyTally())
  const and = (xs: number[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
  return (
    <Block title="Career" long>
      {seasons.length >= 2 && (
        <div className="report__chart">
          <CareerTrend seasons={seasons} width={WIDTH} height={120} palette="print" animate={false} />
        </div>
      )}
      <table className="report-table">
        <thead>
          <tr>
            <th className="w56">Season</th>
            <th>Team</th>
            <th className="w44">Pos</th>
            <th className="num w52">Games</th>
            <th className="num w52">Snaps</th>
            <th className="num w52">Graded</th>
            <th className="num w64">+ / 0 / −</th>
            <th className="num w44">Grade</th>
          </tr>
        </thead>
        <tbody>
          {withLines
            .sort((a, b) => b[0] - a[0])
            .map(([s, { line }]) => (
              <tr key={s} className={s === season ? 'report-table__current' : undefined}>
                <td>{s}</td>
                <td>{line.teams.join(', ') || line.player.team}</td>
                <td>{line.player.depthPos || line.player.position}</td>
                <td className="num">{line.games || <Dash />}</td>
                <td className="num">{line.snaps || <Dash />}</td>
                <td className="num">{line.tally.graded || <Dash />}</td>
                <td className="num muted">{line.tally.graded ? tallyText(line.tally) : <Dash />}</td>
                <td className="num">
                  <PrintGrade score={line.tally.graded ? gradeScore(line.tally) : null} plays={line.tally.graded} />
                </td>
              </tr>
            ))}
          {total.graded > 0 && (
            <tr className="report-table__total">
              <td>Career</td>
              <td />
              <td />
              <td />
              <td />
              <td className="num">{total.graded}</td>
              <td className="num muted">{tallyText(total)}</td>
              <td className="num">
                <PrintGrade score={gradeScore(total)} plays={total.graded} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {missing.length > 0 && (
        <p className="report__footnote">
          {and(missing)} {missing.length === 1 ? 'isn’t' : 'aren’t'} downloaded, so {missing.length === 1 ? 'it isn’t' : 'they aren’t'} included.
        </p>
      )}
    </Block>
  )
}

// ── 8. Game Log ──────────────────────────────────────────────────────────────

function GameLog({ p }: { p: PlayerProfile }) {
  if (!p.games.length) return null
  const cols = statColumns(p.player.group)
  const epa = epaByGame(p)
  const seasonEpa = meanEpa(p)
  const traded = p.teams.length > 1
  const snapsOf = (s: (typeof p.games)[number]['snaps']) => (s ? s.offense + s.defense + s.special : null)
  const totalSnaps = p.games.reduce((n, g) => n + (snapsOf(g.snaps) ?? 0), 0)
  return (
    <Block title="Game Log" long>
      <table className="report-table report-table--log">
        <thead>
          <tr>
            <th className="w36">Wk</th>
            <th>Opponent</th>
            {traded && <th className="w40">Team</th>}
            <th className="w64">Result</th>
            <th className="num w40">Snaps</th>
            {cols.map((c) => (
              <th key={c.key} className="num w40">
                {c.label}
              </th>
            ))}
            <th className="num w64">+ / 0 / −</th>
            <th className="num w40">Grade</th>
            <th className="num w52">EPA / play</th>
          </tr>
        </thead>
        <tbody>
          {p.games.map((l) => {
            const o = gameOutcome(l.game, l.team)
            const e = epa.get(l.game.gameId)
            const n = snapsOf(l.snaps)
            return (
              <tr key={l.game.gameId}>
                <td className="muted">{weekCode(l.game)}</td>
                <td>
                  {l.team === l.game.homeTeam ? 'vs' : '@'} {l.opponent}
                </td>
                {traded && <td>{l.team}</td>}
                <td>{o ? `${o.letter} ${o.score}` : <Dash />}</td>
                <td className="num">{n ?? <Dash />}</td>
                {cols.map((c) => (
                  <td key={c.key} className="num">
                    {Object.keys(l.stats).length ? c.value(l.stats) : <Dash />}
                  </td>
                ))}
                <td className="num muted">{l.tally.graded ? tallyText(l.tally) : <Dash />}</td>
                <td className="num">
                  <PrintGrade score={l.tally.graded ? gradeScore(l.tally) : null} plays={l.tally.graded} />
                </td>
                <td className="num">{e == null ? <Dash /> : formatEpa(e)}</td>
              </tr>
            )
          })}
          <tr className="report-table__total">
            <td>Season</td>
            <td className="muted">{p.games.length} games</td>
            {traded && <td />}
            <td />
            <td className="num">{totalSnaps || <Dash />}</td>
            {cols.map((c) => (
              <td key={c.key} className="num">
                {c.value(p.totals)}
              </td>
            ))}
            <td className="num muted">{p.tally.graded ? tallyText(p.tally) : <Dash />}</td>
            <td className="num">
              <PrintGrade score={p.tally.graded ? gradeScore(p.tally) : null} plays={p.tally.graded} />
            </td>
            <td className="num">{seasonEpa == null ? <Dash /> : formatEpa(seasonEpa)}</td>
          </tr>
        </tbody>
      </table>
    </Block>
  )
}

// ── 9. Notes from the Film ───────────────────────────────────────────────────

function Notes({ entries }: { entries: ReelEntry[] }) {
  const notes = entries.filter((e) => (e.note ?? '').trim() || (e.playNote ?? '').trim()).reverse()
  if (!notes.length) return null
  return (
    <Block title="Notes from the Film" long>
      {notes.map((e) => (
        <div key={`${e.ref.gameId}:${e.ref.playId}`} className="report__note">
          <Glyph grade={e.grade ?? 0} critical={e.critical} />
          <div className="report__note-body">
            <div className="report__caption">
              {playCaption(e.game, e.team, e.play)}
              {e.play ? ` · ${shortDesc(e.play.desc)}` : ''}
            </div>
            {(e.note ?? '').trim() && <div className="report__note-text">{e.note}</div>}
            {(e.playNote ?? '').trim() && <div className="report__note-text report__note-text--play">{e.playNote}</div>}
          </div>
        </div>
      ))}
    </Block>
  )
}
