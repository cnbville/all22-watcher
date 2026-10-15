import { useEffect, useMemo, useState } from 'react'
import { filmablePlays, shiftMatches } from '@shared/matching'
import type { MatchOptions } from '@shared/api'
import { TEAMS, TEAM_BY_ABBR } from '@shared/teams'
import type { ClipMatchRow, GameInfo, MatchPreview, Play, TeamGame } from '@shared/types'
import { api } from '../../api'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Switch'
import { EmptyState } from '../../ui/EmptyState'
import { Icon } from '../../ui/Icon'
import { PopupButton } from '../../ui/PopupButton'
import { Sheet } from '../../ui/Sheet'
import { banner, errorText } from '../../shell/Banners'
import { seasonNow } from '../../shell/store'
import { downDistance, playTypeLabel, quarterLabel, shortDesc, weekLabel } from '../../format'
import './import.css'

const playText = (p: Play) => `${quarterLabel(p.qtr)} ${p.time} · ${p.posteam} ${downDistance(p)} · ${shortDesc(p.desc)}`
const ANGLE_LABEL: Record<string, string> = { sideline: 'Sideline', endzone: 'End Zone', main: 'Main' }

/**
 * Import Film and Fix Clip Matches as a sheet (01 §1.7): pick a game's clips, check how they line up with the
 * play-by-play, slide or relink the ones that are off, convert what the player can't open, and save.
 */
export function ImportFilm({
  game: initialGame,
  team: initialTeam,
  initialPaths,
  existing,
  onClose,
  onImported
}: {
  game: GameInfo | null
  team: string | null
  initialPaths?: string[]
  existing?: ClipMatchRow[]
  onClose: () => void
  onImported: () => void
}) {
  const [game, setGame] = useState<GameInfo | null>(initialGame)
  const [team, setTeam] = useState<string | null>(initialTeam ?? initialGame?.homeTeam ?? null)
  const [paths, setPaths] = useState<string[]>(existing?.map((r) => r.path) ?? initialPaths ?? [])
  const [preview, setPreview] = useState<MatchPreview | null>(null)
  const [rows, setRows] = useState<ClipMatchRow[]>(existing ?? [])
  const [editing, setEditing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [canConvert, setCanConvert] = useState(false)
  const [converting, setConverting] = useState<{ done: number; total: number } | null>(null)
  const [chosen, setChosen] = useState<MatchOptions>({})
  const [savedAngles, setSavedAngles] = useState(() => (existing?.length ? Object.fromEntries(existing.map((r) => [r.path, r.angle])) : undefined))
  const locked = busy || !!converting

  useEffect(() => {
    void api.canConvert().then(setCanConvert)
    return api.onConvertProgress(setConverting)
  }, [])

  const load = async (g: GameInfo, ps: string[], opts?: MatchOptions, keepRows = false) => {
    setBusy(true)
    setError(null)
    try {
      const p = await api.previewMatch(g.gameId, ps, opts)
      setPreview(p)
      if (!keepRows) setRows(p.rows)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  // Fix Clip Matches keeps the saved assignments; a drop or a chosen game with paths matches at once.
  useEffect(() => {
    if (!game || !paths.length || preview) return
    void load(game, paths, undefined, !!existing?.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game])

  const choose = async () => {
    const picked = await api.pickClips()
    if (!picked?.length) return
    setPaths(picked)
    setChosen({})
    setSavedAngles(undefined)
    if (game) await load(game, picked)
  }

  const convert = async () => {
    if (!preview || !game) return
    setConverting({ done: 0, total: preview.unsupported.length })
    setEditing(null)
    setError(null)
    try {
      const res = await api.convertClips(game.gameId, preview.unsupported)
      if (res.failed.length) setError(new Error(`${res.failed.length} clip(s) couldn’t be converted: ${res.failed[0].error}`))
      const next = await api.previewMatch(game.gameId, paths, { ...chosen, angles: savedAngles })
      const auto = new Map(preview.rows.map((r) => [r.path, r.playId]))
      const kept = new Map(rows.filter((r) => auto.get(r.path) !== r.playId).map((r) => [r.path, r.playId]))
      setPreview(next)
      setRows(next.rows.map((r) => (kept.has(r.path) ? { ...r, playId: kept.get(r.path)! } : r)))
    } catch (e) {
      setError(e)
    } finally {
      setConverting(null)
    }
  }

  const allPlays = useMemo(() => [...(preview?.plays ?? [])].sort((a, b) => a.playId - b.playId), [preview])
  const playById = useMemo(() => new Map(allPlays.map((p) => [p.playId, p])), [allPlays])
  const ordered = useMemo(() => (preview ? filmablePlays(preview.plays, preview.includeSpecialTeams, preview.includeNoPlays) : []), [preview])
  const angles = [...new Set(rows.map((r) => r.angle))]
  const linked = rows.filter((r) => r.playId !== null).length

  const save = async () => {
    if (!game || !team) return
    setBusy(true)
    try {
      await api.importClips(game.gameId, team, rows)
      banner({ title: existing ? 'Film updated' : `Saved ${rows.length} clips`, kind: 'success' })
      onImported()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  const setOption = (o: MatchOptions) => {
    if (!preview || !game) return
    setChosen({ ...chosen, ...o })
    void load(game, paths, { includeSpecialTeams: preview.includeSpecialTeams, includeNoPlays: preview.includeNoPlays, ...o, angles: savedAngles })
  }

  const title = existing ? 'Fix Clip Matches' : 'Import Film'
  const subtitle = game ? `${game.awayTeam} @ ${game.homeTeam} · ${weekLabel(game)}, ${game.season}` : 'Choose the game these clips are from.'

  return (
    <Sheet
      title={title}
      subtitle={subtitle}
      size="XL"
      onCancel={onClose}
      test="import-sheet"
      primary={{ label: existing ? 'Save Matches' : 'Save Film', run: () => void save(), disabled: locked || !rows.length || !game || !team, loading: busy && !!preview, test: 'import-save' }}
      footerLeading={
        <>
          <Button label={paths.length ? 'Choose Different Clips…' : 'Choose Clips…'} onClick={() => void choose()} disabled={locked} test={paths.length ? 'choose-clips' : undefined} />
          {preview && (
            <span>
              {rows.length} clips{angles.length > 1 ? ` across ${angles.length} angles` : ''} · {linked} linked to plays
            </span>
          )}
        </>
      }
    >
      {!initialGame && <GamePicker team={team} game={game} onTeam={setTeam} onGame={(g) => setGame(g)} />}
      {!paths.length && (
        <EmptyState
          small={false}
          icon="folder-input"
          title="Choose this game’s clips"
          body="One clip per play, or pick the folder they’re in. Clips match plays in filename order; keep sideline and end zone clips in folders or names with “sideline”/“SL” and “end zone”/“EZ” so each angle matches separately."
          primary={{ label: 'Choose Clips…', run: () => void choose(), test: 'choose-clips' }}
        />
      )}
      {!!error && (
        <div className="import-error selectable" role="alert">
          <Icon name="circle-alert" size={14} />
          {errorText(error)}
        </div>
      )}
      {paths.length > 0 && !preview && busy && <div className="import-note">Matching clips…</div>}
      {preview && (
        <div className="import-body">
          <div className="import-options">
            <Checkbox checked={preview.includeSpecialTeams} disabled={locked} onChange={(v) => setOption({ includeSpecialTeams: v })}>
              Clips include special teams
            </Checkbox>
            <Checkbox checked={preview.includeNoPlays} disabled={locked} onChange={(v) => setOption({ includeNoPlays: v })}>
              Clips include plays wiped out by penalties
            </Checkbox>
            <span className="import-options__count">{ordered.length} plays to match</span>
          </div>
          {preview.warnings.map((w) => (
            <div className="import-warning" key={w}>
              <Icon name="triangle-alert" size={14} />
              {w}
            </div>
          ))}
          {!!preview.unsupported.length && (
            <div className="import-warning">
              <Icon name="triangle-alert" size={14} />
              <span className="import-warning__text">
                {preview.unsupported.length} {preview.unsupported.length > 1 ? 'files are' : 'file is'} in a format the player can’t open (
                {[...new Set(preview.unsupported.map((p) => p.split('.').pop()))].join(', ')}).{' '}
                {canConvert ? 'The app can make MP4 copies; your originals aren’t touched.' : 'Install ffmpeg (brew install ffmpeg) and reopen this sheet to convert them here, or convert them to MP4 yourself.'}
              </span>
              {canConvert && <Button size="sm" variant="primary" label={converting ? `Converting ${converting.done} of ${converting.total}…` : 'Convert to MP4'} onClick={() => void convert()} disabled={locked} />}
            </div>
          )}
          <p className="import-note">Spot-check a few rows. If a clip is missing or extra mid-game, use the arrows on the first wrong row to slide it and every clip after it by one play.</p>
          <table className="match-table" data-test="match-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Clip</th>
                {angles.length > 1 && <th>Angle</th>}
                <th>Play</th>
                <th className="match-table__shift">Shift</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const play = r.playId !== null ? playById.get(r.playId) : undefined
                return (
                  <tr key={r.path}>
                    <td className="num c-label-3">{i + 1}</td>
                    <td className="match-table__file" title={r.path}>
                      {r.fileName}
                    </td>
                    {angles.length > 1 && <td className="c-label-2">{ANGLE_LABEL[r.angle] ?? r.angle}</td>}
                    <td className="match-table__play">
                      {editing === i ? (
                        <select
                          className="match-table__select"
                          autoFocus
                          value={r.playId ?? ''}
                          onBlur={() => setTimeout(() => setEditing((cur) => (cur === i ? null : cur)))}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value)
                            setRows(rows.map((x, j) => (j === i ? { ...x, playId: v } : x)))
                            setEditing(null)
                          }}
                        >
                          <option value="">Not a play / skip</option>
                          {allPlays.map((p) => (
                            <option key={p.playId} value={p.playId}>
                              {playText(p)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button type="button" className="match-table__link" disabled={locked} onClick={() => setEditing(i)} title={play ? play.desc : 'Click to link a play'}>
                          {play ? (
                            <>
                              <span className="c-label-3">{playTypeLabel(play.playType)} · </span>
                              {playText(play)}
                            </>
                          ) : (
                            <span className="c-label-3">Not linked · click to choose a play</span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="match-table__shift">
                      <Button variant="borderless" size="sm" iconOnly icon="chevron-up" label="Slide this and later clips one play earlier" disabled={locked} onClick={() => setRows(shiftMatches(rows, i, -1, ordered))} />
                      <Button variant="borderless" size="sm" iconOnly icon="chevron-down" label="Slide this and later clips one play later" disabled={locked} onClick={() => setRows(shiftMatches(rows, i, 1, ordered))} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  )
}

/** No game in context (File › Import Film…, a drop on Home): choose the team and the game first. */
function GamePicker({ team, game, onTeam, onGame }: { team: string | null; game: GameInfo | null; onTeam: (t: string) => void; onGame: (g: GameInfo) => void }) {
  const season = seasonNow() ?? new Date().getFullYear()
  const [games, setGames] = useState<TeamGame[]>([])
  useEffect(() => {
    if (!team) return
    api.teamOverview(season, team).then((o) => setGames(o.games.filter((g) => g.homeScore !== null && g.playCount > 0)), () => setGames([]))
  }, [team, season])
  return (
    <div className="import-picker">
      <label className="import-picker__field">
        <span>Team</span>
        <PopupButton
          value={team ?? ''}
          width={220}
          label={team ? TEAM_BY_ABBR[team]?.name : 'Choose a Team'}
          options={TEAMS.map((t) => ({ value: t.abbr, label: t.name }))}
          onChange={(v) => onTeam(v)}
        />
      </label>
      <label className="import-picker__field">
        <span>Game</span>
        <PopupButton
          value={game?.gameId ?? ''}
          width={260}
          disabled={!team || !games.length}
          label={game ? `${weekLabel(game)} · ${game.awayTeam} @ ${game.homeTeam}` : team ? (games.length ? 'Choose a Game' : `No ${season} games with plays`) : 'Choose a team first'}
          options={games.map((g) => ({ value: g.gameId, label: `${weekLabel(g)} · ${g.awayTeam} @ ${g.homeTeam}` }))}
          onChange={(id) => {
            const g = games.find((x) => x.gameId === id)
            if (g) onGame(g)
          }}
        />
      </label>
    </div>
  )
}
