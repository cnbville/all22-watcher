import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { gameTitle, weekName } from '@shared/labels'
import type { Side } from '@shared/smartMatch'
import { FULL_GAME_SECONDS } from '@shared/splitPlan'
import type { MatchOptions } from '@shared/api'
import { TEAM_BY_ABBR } from '@shared/teams'
import type { Angle, FfmpegStatus, GameInfo, MatchPreview } from '@shared/types'
import { api } from '../../api'
import { Button } from '../../ui/Button'
import { FormGroup, FormRow } from '../../ui/GroupedForm'
import { Icon, type IconName } from '../../ui/Icon'
import { PopupButton } from '../../ui/PopupButton'
import { ProgressBar } from '../../ui/Progress'
import { Segmented } from '../../ui/Segmented'
import { Spinner } from '../../ui/Spinner'
import { Checkbox } from '../../ui/Switch'
import { Sheet } from '../../ui/Sheet'
import { banner, errorText } from '../../shell/Banners'
import { setSheetDropHandler } from '../../shell/importRequest'
import { GamePicker } from './GamePicker'
import {
  alignRows,
  ANGLE_LABEL,
  ANGLES,
  angleFolders,
  anglesWithFolder,
  guessGame,
  nameOf,
  orderedRows,
  parsedGameName,
  type SheetRow,
  summaryLine,
  countMismatch
} from './importModel'
import { ClipReview } from './ClipReview'
import { MatchTable, type MatchTableRow } from './MatchTable'
import { useSmartMatch } from './useSmartMatch'
import './import.css'

/**
 * Import Film and Fix Clip Matches (the import spec, built on 01 §6.19 and 02 §18). One sheet, two phases:
 *
 * 1. Source: the game (when nothing passed one in) and the clips, chosen or dropped. A folder named for the game
 *    ("DAL at PHI") picks the game by itself.
 * 2. Review: who you're grading, the angle each folder was read as, conversion of clips the player can't open (the
 *    built-in ffmpeg), the alignment check from clip lengths, and the match table where clips slide and relink.
 *
 * Fix Clip Matches is the review phase over the saved clips.
 */

export interface ImportedInfo {
  game: GameInfo
  team: string
  fix: boolean
}

const defaultTeam = (g: GameInfo | null, prefer?: string | null) => (g ? (prefer && (prefer === g.homeTeam || prefer === g.awayTeam) ? prefer : g.homeTeam) : (prefer ?? null))
const nickname = (abbr: string) => TEAM_BY_ABBR[abbr]?.nickname ?? abbr
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const dayLabel = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '')

export function ImportFilm({
  game: initialGame,
  team: initialTeam,
  initialPaths,
  existing,
  focusPlayId,
  onlySuspects: initialOnlySuspects,
  onClose,
  onImported
}: {
  game: GameInfo | null
  team: string | null
  initialPaths?: string[]
  existing?: SheetRow[]
  focusPlayId?: number
  onlySuspects?: boolean
  onClose: () => void
  onImported: (info: ImportedInfo) => void
}) {
  const fix = !!existing?.length
  const [game, setGame] = useState<GameInfo | null>(initialGame)
  const [team, setTeam] = useState<string | null>(defaultTeam(initialGame, initialTeam))
  const [paths, setPaths] = useState<string[]>(existing?.map((r) => r.path) ?? initialPaths ?? [])
  const [preview, setPreview] = useState<MatchPreview | null>(null)
  const [rows, setRows] = useState<SheetRow[]>(() => orderedRows(existing ?? []))
  const [matching, setMatching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [durations, setDurations] = useState<Record<string, number | null>>({})
  const [reading, setReading] = useState(false)
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null)
  const [convert, setConvert] = useState<{ done: number; total: number; activityId?: string } | null>(null)
  const [convertFailed, setConvertFailed] = useState<{ path: string; error: string }[]>([])
  const [filter, setFilter] = useState<'all' | Angle>('all')
  const [onlySuspects, setOnlySuspects] = useState(!!initialOnlySuspects)
  const [selection, setSelection] = useState<string | null>(null)
  const [angles, setAngles] = useState<Record<string, Angle> | undefined>(() => (fix ? Object.fromEntries(existing!.map((r) => [r.path, r.angle])) : undefined))
  const [guess, setGuess] = useState<{ state: 'idle' | 'looking' | 'none'; name?: string; team?: string }>({ state: 'idle' })
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const seq = useRef(0)
  const converted = useRef(new Set<string>())
  const focused = useRef(false)
  const [reviewing, setReviewing] = useState(false)
  const [split, setSplit] = useState<{ done: number; total: number } | null>(null)
  const match = useSmartMatch({ preview, team, rows, setRows, durations, reading, fix })

  const converting = !!convert
  const locked = saving || converting || matching || !!split

  useEffect(() => {
    api.ffmpegStatus().then(setFfmpeg, () => setFfmpeg(null))
  }, [])

  const load = async (g: GameInfo, ps: string[], o: MatchOptions, keep = false) => {
    const my = ++seq.current
    setMatching(true)
    setError(null)
    try {
      const p = await api.previewMatch(g.gameId, ps, o)
      if (my !== seq.current) return
      setPreview(p)
      if (!keep) setRows(orderedRows(p.rows))
    } catch (e) {
      if (my === seq.current) setError(e)
    } finally {
      if (my === seq.current) setMatching(false)
    }
  }

  // Match as soon as there are clips and a game. Fix Clip Matches keeps the saved assignments.
  useEffect(() => {
    if (!game || !paths.length || preview) return
    void load(game, paths, { angles }, fix)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.gameId, paths])

  // Clips without a game: a folder named for the game picks it, from the newest downloaded season that has it.
  useEffect(() => {
    if (game || !paths.length) return
    const parsed = parsedGameName(paths)
    if (!parsed) {
      setGuess({ state: 'none' })
      return
    }
    setGuess({ state: 'looking', name: parsed.name, team: parsed.teams[1] })
    let live = true
    void (async () => {
      const downloaded = (await api.seasons()).filter((s) => s.downloaded).map((s) => s.season)
      const seasons = parsed.season ? downloaded.filter((s) => s === parsed.season) : downloaded
      for (const season of seasons) {
        const o = await api.teamOverview(season, parsed.teams[0]).catch(() => null)
        if (!live) return
        const g = o && guessGame(parsed.name, o.games.filter((x) => x.playCount > 0))
        if (g) {
          setGame(g)
          setTeam((t) => defaultTeam(g, t ?? initialTeam))
          setGuess({ state: 'idle' })
          return
        }
      }
      if (live) setGuess({ state: 'none', name: parsed.name, team: parsed.teams[1] })
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, game])

  // Clip lengths, read once per clip, for the Length column and the alignment check.
  const pathKey = rows.map((r) => r.path).join('\n')
  useEffect(() => {
    if (!game || !rows.length) return
    const missing = rows.filter((r) => !(r.path in durations))
    if (!missing.length) return
    let live = true
    setReading(true)
    api.checkAlignmentRows(game.gameId, missing).then(
      (res) => {
        if (!live) return
        setDurations((d) => ({ ...d, ...Object.fromEntries(missing.map((r) => [r.path, res.durations?.[r.path] ?? null])) }))
        setReading(false)
      },
      () => {
        if (!live) return
        setDurations((d) => ({ ...d, ...Object.fromEntries(missing.map((r) => [r.path, null])) }))
        setReading(false)
      }
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.gameId, pathKey])

  // Clips the player can't open are converted with the built-in ffmpeg as soon as they show up (improvement 15).
  const unsupported = preview?.unsupported ?? []
  useEffect(() => {
    if (!game || !preview || converting || !ffmpeg?.path) return
    const todo = unsupported.filter((p) => !converted.current.has(p))
    if (!todo.length) return
    todo.forEach((p) => converted.current.add(p))
    void runConvert(game, todo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, ffmpeg])

  const runConvert = async (g: GameInfo, todo: string[]) => {
    setConvert({ done: 0, total: todo.length })
    setConvertFailed([])
    const offProgress = api.onConvertProgress((p) => setConvert((c) => (c ? { ...c, done: p.done, total: p.total } : c)))
    const offEvents = api.onApiEvent((e) => {
      if (e.type === 'activity' && e.activity.kind === 'convert' && e.activity.state === 'running') setConvert((c) => (c ? { ...c, activityId: e.activity.id } : c))
    })
    try {
      const res = await api.convertClips(g.gameId, todo)
      setConvertFailed(res.failed)
      const before = preview
      const next = await api.previewMatch(g.gameId, paths, { includeSpecialTeams: preview?.includeSpecialTeams, includeNoPlays: preview?.includeNoPlays, angles })
      // Keep the matches the user changed by hand; everything else takes the new matching.
      const auto = new Map((before?.rows ?? []).map((r) => [r.path, r.playId]))
      const kept = new Map(rowsRef.current.filter((r) => auto.has(r.path) && auto.get(r.path) !== r.playId).map((r) => [r.path, r.playId]))
      setPreview(next)
      setRows(orderedRows(next.rows).map((r) => (kept.has(r.path) ? { ...r, playId: kept.get(r.path)! } : r)))
    } catch (e) {
      setError(e)
    } finally {
      offProgress()
      offEvents()
      setConvert(null)
    }
  }

  const usePaths = (picked: string[]) => {
    if (!picked.length) return
    seq.current++
    setPaths(picked)
    setPreview(null)
    setRows([])
    setAngles(undefined)
    setFilter('all')
    setOnlySuspects(false)
    setSelection(null)
    setReviewing(false)
    setConvertFailed([])
    setError(null)
    setMatching(false)
    if (!initialGame && !fix) setGuess({ state: 'idle' })
  }

  const choose = async () => {
    const picked = await api.pickClips()
    if (picked?.length) usePaths(picked)
  }

  // Finder drops while the sheet is open replace the clips here instead of opening another sheet.
  const dropRef = useRef(usePaths)
  dropRef.current = usePaths
  useEffect(() => {
    setSheetDropHandler((ps) => {
      if (!locked) dropRef.current(ps)
    })
    return () => setSheetDropHandler(null)
  }, [locked])

  const chooseGame = (g: GameInfo) => {
    if (g.gameId === game?.gameId) return
    seq.current++
    setGame(g)
    setTeam((t) => defaultTeam(g, t ?? initialTeam))
    setPreview(null)
    setRows([])
    setDurations({})
    setMatching(false)
  }

  const reload = (o: MatchOptions, keep = false) => {
    if (!game || !preview) return
    void load(game, paths, { includeSpecialTeams: preview.includeSpecialTeams, includeNoPlays: preview.includeNoPlays, angles, ...o }, keep)
  }

  const ordered = match.ordered
  const allPlays = match.plays
  const folders = useMemo(() => angleFolders(rows), [pathKey, rows.map((r) => r.angle).join()])
  const alignment = useMemo(
    () => (game && preview && rows.length && !reading ? alignRows(game.gameId, rows, durations, preview.plays) : null),
    [game, preview, rows, durations, reading]
  )
  const suspects = useMemo(() => new Map((alignment?.suspects ?? []).map((s) => [s.path, s])), [alignment])
  const anglesShown = ANGLES.filter((a) => rows.some((r) => r.angle === a))
  const mismatch = useMemo(() => countMismatch(rows, ordered.length), [rows, ordered.length])

  const items = useMemo(() => {
    const counters = new Map<Angle, number>()
    const all: MatchTableRow[] = rows.map((row, index) => {
      const n = (counters.get(row.angle) ?? 0) + 1
      counters.set(row.angle, n)
      return { row, index, n, duration: row.path in durations ? durations[row.path] : undefined, suspect: suspects.get(row.path) }
    })
    return all.filter((it) => (filter === 'all' || it.row.angle === filter) && (!onlySuspects || it.suspect))
  }, [rows, durations, suspects, filter, onlySuspects])

  // Fix Clip Matches opened for a play: select its first clip and bring it into view.
  useEffect(() => {
    if (focused.current || focusPlayId === undefined || !preview || !rows.length) return
    focused.current = true
    const hit = rows.find((r) => r.playId === focusPlayId) ?? null
    if (!hit) return
    setSelection(hit.path)
    requestAnimationFrame(() => document.querySelector(`[data-row-key="${CSS.escape(hit.path)}"]`)?.scrollIntoView({ block: 'center' }))
  }, [preview, rows, focusPlayId])

  // The filter "Only Suspect Clips" turns itself off when nothing is left to show.
  useEffect(() => {
    if (onlySuspects && alignment && !alignment.suspects.length) setOnlySuspects(false)
  }, [alignment, onlySuspects])

  const shift = match.shift
  const link = match.link

  // One long video is a whole game: offer to split it into plays at its camera cuts.
  const fullGame = rows.length === 1 && (durations[rows[0].path] ?? 0) >= FULL_GAME_SECONDS ? rows[0] : null
  const runSplit = async () => {
    if (!game || !fullGame) return
    setSplit({ done: 0, total: 100 })
    setError(null)
    const off = api.onConvertProgress((p) => setSplit({ done: p.done, total: p.total }))
    try {
      const res = await api.splitGame(game.gameId, fullGame.path)
      banner({ title: `Found ${plural(res.plays, 'play')} in the film`, body: res.angles > 1 ? 'Each play’s sideline and end zone shots were paired up.' : undefined, kind: 'success' })
      usePaths([res.folder])
    } catch (e) {
      if (!/cancel/i.test(errorText(e))) setError(e)
    } finally {
      off()
      setSplit(null)
    }
  }

  const save = async () => {
    if (!game || !team || !rows.length) return
    setSaving(true)
    setError(null)
    try {
      await api.importClips(game.gameId, team, rows)
      const linked = rows.filter((r) => r.playId !== null)
      banner({
        title: fix ? 'Film updated' : `Imported ${gameTitle(game)}`,
        body: fix ? undefined : `${plural(linked.length, 'clip')} matched to ${plural(new Set(linked.map((r) => r.playId)).size, 'play')}`,
        kind: 'success'
      })
      onImported({ game, team, fix })
    } catch (e) {
      setError(e)
      setSaving(false)
    }
  }

  const phase: 'source' | 'matching' | 'review' = !game || !paths.length ? 'source' : !preview ? 'matching' : 'review'
  const title = fix ? 'Fix Clip Matches' : 'Import Film'
  const subtitle = game ? `${gameTitle(game)} · ${weekName(game)}, ${game.season}` : 'Choose the clips and the game they’re from.'
  const linked = rows.filter((r) => r.playId !== null).length

  return (
    <Sheet
      title={title}
      subtitle={subtitle}
      size={phase === 'review' ? 'XL' : 'L'}
      onCancel={onClose}
      test="import-sheet"
      bodyClassName="screen-import"
      primary={{
        label: fix ? 'Save Matches' : 'Save Film',
        run: () => void save(),
        disabled: locked || phase !== 'review' || !rows.length || !team || !linked,
        loading: saving,
        test: 'import-save'
      }}
      footerLeading={
        phase === 'review' ? (
          <>
            <Button label="Choose Different Clips…" onClick={() => void choose()} disabled={locked} test="choose-clips" />
            <span className="import-footer-status" data-test="import-summary">
              {summaryLine(rows)}
            </span>
          </>
        ) : null
      }
    >
      {!!error && (
        <Notice icon="circle-alert" tone="danger" title={fix ? 'Couldn’t save the matches' : 'Something went wrong'} body={errorText(error)} selectable />
      )}
      {phase === 'source' && (
        <div className="import-source">
          <DropZone paths={paths} onChoose={() => void choose()} />
          {!initialGame && (
            <FormGroup
              title="Game"
              footnote={
                guess.state === 'none' && guess.name
                  ? `Couldn’t tell which game “${guess.name}” is. Choose it here.`
                  : 'A folder named for the game, like “DAL at PHI” or “2025 Wk 1 DAL @ PHI”, picks it for you.'
              }
            >
              <GamePicker key={guess.team ?? 'none'} game={game} team={team ?? guess.team} onGame={chooseGame} busy={guess.state === 'looking'} />
            </FormGroup>
          )}
        </div>
      )}
      {phase === 'matching' && (
        <div className="import-matching">
          <Spinner size={20} />
          <span>Matching {plural(paths.length > 1 ? paths.length : 1, 'item')} to the play-by-play…</span>
        </div>
      )}
      {phase === 'review' && preview && game && (
        <div className="import-review">
          <div className="import-setup">
            <FormGroup title="Game">
              {!initialGame && !fix ? (
                <GamePicker game={game} team={team ?? undefined} onGame={chooseGame} compact disabled={locked} />
              ) : (
                <FormRow label="Game" description={`${weekName(game)} · ${dayLabel(game.gameday)}`}>
                  <span className="import-setup__value">{gameTitle(game)}</span>
                </FormRow>
              )}
              <FormRow label="Grading" description="The team whose players you grade on this film.">
                <Segmented
                  size="sm"
                  label="Team you’re grading"
                  value={team ?? game.homeTeam}
                  onChange={(t) => setTeam(t)}
                  options={[game.awayTeam, game.homeTeam].map((abbr) => ({ value: abbr, label: nickname(abbr), test: `import-team-${abbr}` }))}
                  test="import-team"
                />
              </FormRow>
            </FormGroup>
            <FormGroup title="Clips" trailing={fix ? <Button size="sm" variant="borderless" label="Match Again" title="Place every clip on a play again from its order and length" disabled={locked} onClick={match.matchAgain} /> : undefined}>
              {folders.length === 0 && <FormRow label="No clips" description="None of these files can be matched." />}
              {folders.slice(0, 3).map((f) => (
                <FormRow key={f.dir} label={<span className="import-folder" title={f.dir}><Icon name="folder-open" size={14} className="c-label-3" />{f.label}</span>} description={plural(f.count, 'clip')}>
                  <PopupButton
                    size="sm"
                    width={112}
                    value={f.angle}
                    disabled={locked}
                    options={ANGLES.map((a) => ({ value: a, label: ANGLE_LABEL[a], test: `angle-option-${a}` }))}
                    onChange={(a) => {
                      if (a === f.angle) return
                      const next = anglesWithFolder(rows, f, a)
                      setAngles(next)
                      reload({ angles: next })
                    }}
                    test="import-angle"
                  />
                </FormRow>
              ))}
              {folders.length > 3 && <FormRow label={`${plural(folders.length - 3, 'more folder')}`} description={folders.slice(3).map((f) => `${f.label} (${ANGLE_LABEL[f.angle]})`).join(', ')} />}
              <FormRow label="Cut from" description={`${plural(ordered.length, 'play')} to match`}>
                <PopupButton
                  size="sm"
                  width={150}
                  value={match.scope.side}
                  disabled={locked}
                  options={(['all', 'offense', 'defense'] as Side[]).map((side) => ({
                    value: side,
                    label: side === 'all' ? 'Every snap' : `${nickname(team ?? game.homeTeam)} ${side}`,
                    test: `scope-side-${side}`
                  }))}
                  onChange={(side) => match.setScope({ ...match.scope, side })}
                  test="import-scope-side"
                />
                <Checkbox checked={match.scope.includeSpecialTeams} disabled={locked} onChange={(v) => match.setScope({ ...match.scope, includeSpecialTeams: v })}>
                  Special teams
                </Checkbox>
                <Checkbox checked={match.scope.includeNoPlays} disabled={locked} onChange={(v) => match.setScope({ ...match.scope, includeNoPlays: v })}>
                  Penalty no-plays
                </Checkbox>
              </FormRow>
            </FormGroup>
          </div>

          {(converting || unsupported.length > 0 || convertFailed.length > 0) && (
            <ConversionNotice
              unsupported={unsupported}
              convert={convert}
              failed={convertFailed}
              ffmpeg={ffmpeg}
              onCancel={() => convert?.activityId && void api.cancelActivity(convert.activityId)}
              onRetry={() => {
                converted.current.clear()
                void runConvert(game, unsupported)
              }}
            />
          )}
          {!preview.plays.length ? (
            <Notice icon="circle-alert" tone="warning" title="No play-by-play for this game yet" body="Clips can’t be matched to plays until nflverse publishes it. Update the season data later and import again." />
          ) : (
            fullGame ? (
              <Notice
                icon={split ? 'spinner' : 'film'}
                tone="info"
                test="split-notice"
                title={split ? 'Splitting the film into plays…' : 'This looks like a whole game'}
                body={
                  split
                    ? 'Finding the camera cuts, then cutting a clip for each play and angle. Your original isn’t touched.'
                    : 'Split it into one clip per play at its camera cuts. Each play’s sideline and end zone shots are paired up, then matched to the play-by-play.'
                }
                progress={split ? <ProgressBar value={split.total ? split.done / split.total : null} style={{ marginTop: 8 }} label="Splitting" /> : undefined}
                action={split ? undefined : <Button size="sm" label="Split Into Plays" disabled={locked || !ffmpeg?.path} onClick={() => void runSplit()} test="split-game" />}
              />
            ) : match.smart ? (
              match.needsLook.size > 0 && !reviewing && (
                <Notice
                  icon="info"
                  tone="info"
                  test="needs-look-notice"
                  title={`${plural(match.needsLook.size, 'clip needs', 'clips need')} a look`}
                  body="Order and length couldn’t settle which play these show. Watch them one at a time and pick the play; each pick helps place the clips around it."
                  action={<Button size="sm" label="Check Clips" disabled={locked} onClick={() => setReviewing(true)} test="check-clips" />}
                />
              )
            ) : (
              mismatch && (
                <Notice
                  icon="info"
                  tone="info"
                  test="count-notice"
                  title={`${mismatch.map((m) => `${plural(m.clips, `${anglesShown.length > 1 ? `${ANGLE_LABEL[m.angle].toLowerCase()} ` : ''}clip`)}`).join(' and ')} for ${plural(ordered.length, 'play')}`}
                  body="These clips keep the matches they were saved with. Match Again places every clip from its order and length, skipping plays that weren’t cut."
                />
              )
            )
          )}
          {alignment && alignment.suspects.length > 0 && !reviewing && !fullGame && (
            <Notice
              icon="triangle-alert"
              tone="warning"
              test="alignment-notice"
              title={`${plural(alignment.suspects.length, 'clip')} may be matched to the wrong play`}
              body="Their lengths don’t fit the plays they’re on. Check them, then slide or move the ones that are off."
              action={
                <Button
                  size="sm"
                  label={onlySuspects ? 'Show All Clips' : 'Show Only These'}
                  pressed={onlySuspects}
                  onClick={() => {
                    setOnlySuspects(!onlySuspects)
                    setFilter('all')
                  }}
                />
              }
            />
          )}

          {reviewing ? (
            <ClipReview rows={rows} match={match} durations={durations} startPath={selection && match.needsLook.has(selection) ? selection : undefined} onClose={() => setReviewing(false)} />
          ) : (
          <>
          <div className="import-tablebar">
            {anglesShown.length > 1 ? (
              <Segmented
                size="sm"
                label="Angle"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all' as const, label: `All ${rows.length}` },
                  ...anglesShown.map((a) => ({ value: a, label: `${ANGLE_LABEL[a]} ${rows.filter((r) => r.angle === a).length}` }))
                ]}
                test="import-angle-filter"
              />
            ) : (
              <span className="import-tablebar__title">{plural(rows.length, 'clip')}</span>
            )}
            <span className="import-tablebar__status">
              {reading ? (
                <>
                  <Spinner size={12} /> Checking clip lengths…
                </>
              ) : alignment && !alignment.suspects.length && alignment.checked > 0 ? (
                <>
                  <Icon name="circle-check" size={12} /> Every clip’s length fits its play
                </>
              ) : matching ? (
                <>
                  <Spinner size={12} /> Matching…
                </>
              ) : null}
            </span>
            <span className="import-tablebar__hint">
              Select a clip and press <kbd>⇧↑</kbd> or <kbd>⇧↓</kbd> to slide it{match.smart ? '; the clips after it follow' : ' and every later clip'}
            </span>
            <Button size="sm" variant="borderless" label="Watch Clips" title="Step through the clips, watching each one, and pick its play" disabled={locked || !rows.length} onClick={() => setReviewing(true)} test="watch-clips" />
          </div>
          <MatchTable
            items={items}
            plays={allPlays}
            ordered={ordered}
            showAngle={anglesShown.length > 1 && filter === 'all'}
            showCheck={!!alignment?.suspects.length}
            selection={selection}
            onSelect={setSelection}
            onShift={shift}
            onLink={link}
            needsLook={match.needsLook}
            disabled={locked}
          />
          </>
          )}
        </div>
      )}
    </Sheet>
  )
}

/** An inline status panel inside the sheet (not a banner: it stays until the condition is gone). */
function Notice({
  icon,
  tone,
  title,
  body,
  action,
  progress,
  selectable,
  test
}: {
  icon: IconName | 'spinner'
  tone: 'info' | 'warning' | 'danger'
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  progress?: ReactNode
  selectable?: boolean
  test?: string
}) {
  return (
    <div className="import-notice" data-tone={tone} data-test={test} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="import-notice__icon">{icon === 'spinner' ? <Spinner size={16} /> : <Icon name={icon} size={16} />}</span>
      <div className="import-notice__text">
        <div className="import-notice__title">{title}</div>
        {body && <div className={`import-notice__body${selectable ? ' selectable' : ''}`}>{body}</div>}
        {progress}
      </div>
      {action && <div className="import-notice__action">{action}</div>}
    </div>
  )
}

function ConversionNotice({
  unsupported,
  convert,
  failed,
  ffmpeg,
  onCancel,
  onRetry
}: {
  unsupported: string[]
  convert: { done: number; total: number; activityId?: string } | null
  failed: { path: string; error: string }[]
  ffmpeg: FfmpegStatus | null
  onCancel: () => void
  onRetry: () => void
}) {
  const kinds = [...new Set(unsupported.map((p) => (p.split('.').pop() ?? '').toUpperCase()))].join(', ')
  if (convert) {
    return (
      <Notice
        icon="spinner"
        tone="info"
        test="convert-progress"
        title={`Converting ${plural(convert.total, 'clip')} to MP4…`}
        body={`${convert.done} of ${convert.total} · Your originals aren’t touched.`}
        progress={<ProgressBar value={convert.total ? convert.done / convert.total : null} style={{ marginTop: 8 }} label="Converting" />}
        action={convert.activityId ? <Button size="sm" label="Stop" onClick={onCancel} /> : undefined}
      />
    )
  }
  if (failed.length) {
    return (
      <Notice
        icon="circle-alert"
        tone="danger"
        title={`Couldn’t convert ${plural(failed.length, 'clip')}`}
        body={`${nameOf(failed[0].path)}: ${failed[0].error}`}
        selectable
        action={unsupported.length ? <Button size="sm" label="Try Again" onClick={onRetry} /> : undefined}
      />
    )
  }
  if (!unsupported.length) return null
  if (ffmpeg && !ffmpeg.path) {
    return (
      <Notice
        icon="triangle-alert"
        tone="warning"
        title={`${plural(unsupported.length, 'clip is', 'clips are')} ${kinds}, which the player can’t open`}
        body="The built-in converter isn’t available on this Mac. Convert them to MP4, then choose the clips again; the rest can be saved now."
      />
    )
  }
  return <Notice icon="spinner" tone="info" title={`Preparing to convert ${plural(unsupported.length, 'clip')}…`} />
}

/** The big target for clips: drop here, or Choose Clips…. */
function DropZone({ paths, onChoose }: { paths: string[]; onChoose: () => void }) {
  const [over, setOver] = useState(false)
  const chosen = paths.length > 0
  return (
    <div
      className="import-drop"
      data-over={over || undefined}
      onDragEnter={() => setOver(true)}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={() => setOver(false)}
    >
      <Icon name="folder-input" size={40} className="import-drop__icon" />
      {chosen ? (
        <>
          <div className="import-drop__title">{paths.length === 1 ? `“${nameOf(paths[0])}”` : `${paths.length} items chosen`}</div>
          <div className="import-drop__body">Choose the game above and the clips are matched to its plays.</div>
          <Button label="Choose Different Clips…" onClick={onChoose} test="choose-clips" />
        </>
      ) : (
        <>
          <div className="import-drop__title">Drop a game’s clips here</div>
          <div className="import-drop__body">
            Clips you cut, the folder they’re in, or a whole game’s film to split into plays. Plays you skipped are fine; clips are placed on plays by their order and length.
          </div>
          <Button variant="primary" label="Choose Clips…" onClick={onChoose} test="choose-clips" />
        </>
      )}
    </div>
  )
}
