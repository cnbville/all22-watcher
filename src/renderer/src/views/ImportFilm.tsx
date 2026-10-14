import { useEffect, useMemo, useState } from 'react'
import { filmablePlays, shiftMatches } from '@shared/matching'
import type { ClipMatchRow, GameInfo, MatchPreview, Play } from '@shared/types'
import { api } from '../api'
import { ErrorBox, Modal, toast } from '../components/common'
import { downDistance, playTypeLabel, quarterLabel, shortDesc } from '../format'

const playText = (p: Play) => `${quarterLabel(p.qtr)} ${p.time} · ${p.posteam} ${downDistance(p)} · ${shortDesc(p.desc)}`

/** Pick a game's clips, check how they line up with the play-by-play, fix any that are off, and save. */
export function ImportFilm({
  game,
  team,
  existing,
  onClose,
  onImported
}: {
  game: GameInfo
  team: string
  existing?: ClipMatchRow[]
  onClose: () => void
  onImported: () => void
}) {
  const [paths, setPaths] = useState<string[]>(existing?.map((r) => r.path) ?? [])
  const [preview, setPreview] = useState<MatchPreview | null>(null)
  const [rows, setRows] = useState<ClipMatchRow[]>(existing ?? [])
  const [editing, setEditing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [canConvert, setCanConvert] = useState(false)
  const [converting, setConverting] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    void api.canConvert().then(setCanConvert)
    return api.onConvertProgress(setConverting)
  }, [])

  const convert = async () => {
    if (!preview) return
    setConverting({ done: 0, total: preview.unsupported.length })
    setError(null)
    try {
      const res = await api.convertClips(game.gameId, preview.unsupported)
      if (res.failed.length) setError(new Error(`${res.failed.length} clip(s) couldn’t be converted: ${res.failed[0].error}`))
      // Re-match with the same choices, keeping any matches already fixed by hand.
      const next = await api.previewMatch(game.gameId, paths, {
        includeSpecialTeams: preview.includeSpecialTeams,
        includeNoPlays: preview.includeNoPlays
      })
      const kept = new Map(rows.map((r) => [r.path, r.playId]))
      setPreview(next)
      setRows(next.rows.map((r) => (kept.has(r.path) ? { ...r, playId: kept.get(r.path)! } : r)))
    } catch (e) {
      setError(e)
    } finally {
      setConverting(null)
    }
  }

  const load = async (ps: string[], opts?: { includeSpecialTeams: boolean; includeNoPlays: boolean }, keepRows = false) => {
    setBusy(true)
    setError(null)
    try {
      const p = await api.previewMatch(game.gameId, ps, opts)
      setPreview(p)
      if (!keepRows) setRows(p.rows)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  // In "fix matches" mode, fetch the play list once but keep the saved assignments.
  useEffect(() => {
    if (existing?.length) void load(existing.map((r) => r.path), undefined, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = async () => {
    const picked = await api.pickClips()
    if (!picked?.length) return
    setPaths(picked)
    await load(picked)
  }

  const allPlays = useMemo(() => [...(preview?.plays ?? [])].sort((a, b) => a.playId - b.playId), [preview])
  const playById = useMemo(() => new Map(allPlays.map((p) => [p.playId, p])), [allPlays])
  const ordered = useMemo(
    () => (preview ? filmablePlays(preview.plays, preview.includeSpecialTeams, preview.includeNoPlays) : []),
    [preview]
  )
  const angles = [...new Set(rows.map((r) => r.angle))]
  const linked = rows.filter((r) => r.playId !== null).length

  const save = async () => {
    setBusy(true)
    try {
      await api.importClips(game.gameId, team, rows)
      toast(`Saved ${rows.length} clips`)
      onImported()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  const title = `${existing ? 'Fix clip matches' : 'Import film'} · ${game.awayTeam} @ ${game.homeTeam}, week ${game.week}`

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={choose} disabled={busy}>
            {paths.length ? 'Choose different clips…' : 'Choose clips…'}
          </button>
          {preview && (
            <span className="muted">
              {rows.length} clips{angles.length > 1 ? ` across ${angles.length} angles` : ''} · {linked} linked to plays
            </span>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !rows.length}>
            Save film
          </button>
        </>
      }
    >
      {!paths.length && (
        <div className="empty">
          <p>Pick the clips for this game, one clip per play, or just pick the folder they’re in.</p>
          <p className="faint">
            Clips are matched to plays in filename order. If you have sideline and end zone angles, keep them in folders
            or names with “sideline”/“SL” and “end zone”/“EZ” and each angle is matched separately.
          </p>
          <button className="btn primary" onClick={choose}>
            Choose clips…
          </button>
        </div>
      )}
      {!!error && <ErrorBox error={error} />}
      {preview && (
        <div className="col" style={{ gap: 12 }}>
          <div className="row wrap">
            <label className="row">
              <input
                type="checkbox"
                checked={preview.includeSpecialTeams}
                onChange={(e) => load(paths, { includeSpecialTeams: e.target.checked, includeNoPlays: preview.includeNoPlays })}
              />
              Clips include special teams
            </label>
            <label className="row" style={{ marginLeft: 16 }}>
              <input
                type="checkbox"
                checked={preview.includeNoPlays}
                onChange={(e) => load(paths, { includeSpecialTeams: preview.includeSpecialTeams, includeNoPlays: e.target.checked })}
              />
              Clips include plays wiped out by penalties
            </label>
            <span className="spacer" />
            <span className="faint">{ordered.length} plays to match</span>
          </div>
          {preview.warnings.map((w) => (
            <div className="warn" key={w}>
              {w}
            </div>
          ))}
          {!!preview.unsupported.length && (
            <div className="warn">
              <div className="row">
                <span>
                  {preview.unsupported.length} file{preview.unsupported.length > 1 ? 's are' : ' is'} in a format the player
                  can’t open ({[...new Set(preview.unsupported.map((p) => p.split('.').pop()))].join(', ')}).{' '}
                  {canConvert
                    ? 'The app can make MP4 copies; your originals aren’t touched.'
                    : 'Install ffmpeg (brew install ffmpeg) and reopen this window to convert them here, or convert them to MP4 yourself.'}
                </span>
                <span className="spacer" />
                {canConvert && (
                  <button className="btn small primary" onClick={convert} disabled={!!converting}>
                    {converting ? `Converting ${converting.done}/${converting.total}…` : 'Convert to MP4'}
                  </button>
                )}
              </div>
            </div>
          )}
          <p className="faint" style={{ margin: 0 }}>
            Spot-check a few rows. If a clip is missing or extra mid-game, use the arrows on the first wrong row to slide it
            and every clip after it by one play.
          </p>
          <table className="table match-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Clip</th>
                {angles.length > 1 && <th>Angle</th>}
                <th>Play</th>
                <th>Shift</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const play = r.playId !== null ? playById.get(r.playId) : undefined
                return (
                  <tr key={r.path}>
                    <td className="faint mono">{i + 1}</td>
                    <td className="file" title={r.path}>
                      {r.fileName}
                    </td>
                    {angles.length > 1 && <td className="muted">{r.angle}</td>}
                    <td className="play">
                      {editing === i ? (
                        <select
                          className="input"
                          autoFocus
                          value={r.playId ?? ''}
                          onBlur={() => setEditing(null)}
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
                        <a onClick={() => setEditing(i)} title={play ? play.desc : 'Click to link a play'}>
                          {play ? (
                            <span style={{ color: 'var(--text)' }}>
                              <span className="faint">{playTypeLabel(play.playType)} · </span>
                              {playText(play)}
                            </span>
                          ) : (
                            <span className="faint">Not linked, click to choose a play</span>
                          )}
                        </a>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="btn small ghost" title="Slide this and later clips one play earlier" onClick={() => setRows(shiftMatches(rows, i, -1, ordered))}>
                          ↑
                        </button>
                        <button className="btn small ghost" title="Slide this and later clips one play later" onClick={() => setRows(shiftMatches(rows, i, 1, ordered))}>
                          ↓
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
