import { useEffect, useMemo, useRef, useState } from 'react'
import { posterUrl } from '@shared/api'
import { MAX_EXPORT_PLAYS, sanitizeFileName, sizeLabel, type ExportAngle, type ExportPlan, type ExportVideoRequest } from '@shared/exportVideo'
import { durationLabel } from '@shared/labels'
import type { Angle, PlayRef } from '@shared/types'
import { rawApi } from '../../api'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import type { MenuItemSpec } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { PopupButton } from '../../ui/PopupButton'
import { Sheet } from '../../ui/Sheet'
import { Spinner } from '../../ui/Spinner'
import { Checkbox } from '../../ui/Switch'
import { TextField } from '../../ui/TextField'
import { errorBanner } from '../../shell/Banners'
import { useSettings } from '../../shell/store'
import { writeLocal, readLocal } from '../shared/hooks'
import type { ExportSheetRequest } from '../shared/requests'
import { PlayerSearch, playerName, usePlayerNames } from '../cutups/PlayerPicker'
import { addPreparing, readOptions, rememberExport, removePreparing, takeRestore, type RememberedOptions } from './exportModel'
import { drawingIntervals, hasStatic, paintDrawings, paintStatic, paintTitleCard, renderOverlays, titleBar } from './overlays'


/** The Export Video sheet (03 §11.2–§11.3, §11.8). */

const PRE_ROLLS = [
  { value: 0, label: 'no time' },
  { value: 0.5, label: '0.5 seconds' },
  { value: 1, label: '1 second' },
  { value: 1.5, label: '1.5 seconds' },
  { value: 2, label: '2 seconds' },
  { value: 3, label: '3 seconds' }
]
const ENDS: { value: ExportVideoRequest['end']; label: string }[] = [
  { value: 'clip', label: 'End of Clip' },
  { value: 6, label: '6 Seconds After the Snap' },
  { value: 8, label: '8 Seconds After the Snap' },
  { value: 10, label: '10 Seconds After the Snap' }
]
const BETWEEN: { value: ExportVideoRequest['between']; label: string }[] = [
  { value: 'none', label: 'Nothing' },
  { value: 'black0.5', label: 'Half a Second of Black' },
  { value: 'black1', label: 'One Second of Black' },
  { value: 'hold1', label: 'Hold the Last Frame for 1 Second' }
]
const ANGLES: { value: ExportAngle; label: string }[] = [
  { value: 'sideline', label: 'Sideline' },
  { value: 'endzone', label: 'End Zone' },
  { value: 'main', label: 'Main' },
  { value: 'sideBySide', label: 'Side by Side' },
  { value: 'eachAngle', label: 'Each Angle in Turn' }
]
const DEFAULT_BURN: ExportVideoRequest['burnIn'] = { grade: true, name: true, caption: true, description: false, drawings: true, number: true, titleCard: false }

type Folders = Awaited<ReturnType<typeof rawApi.exportFolders>>

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
const keyOf = (r: PlayRef) => `${r.gameId}:${r.playId}`

export function ExportSheet({ req, onClose }: { req: ExportSheetRequest; onClose: () => void }) {
  const settings = useSettings()
  const restored = useMemo(() => takeRestore(), [])
  const remembered: RememberedOptions = useMemo(() => restored ?? readOptions(), [restored])
  const choices = useMemo(() => (req.choices?.length ? req.choices : [{ key: 'all', label: `All Plays (${req.source.plays.length})`, plays: req.source.plays }]), [req])
  const [choice, setChoice] = useState(() => (choices.some((c) => c.key === req.initial) ? req.initial! : choices[0].key))
  const plays = choices.find((c) => c.key === choice)?.plays ?? choices[0].plays
  const fixedPlayer = req.source.kind === 'player' ? req.source.playerId : null
  const [playerId, setPlayerId] = useState<string | null>(fixedPlayer ?? restored?.playerId ?? req.playerId ?? null)
  const [angle, setAngle] = useState<ExportAngle>(restored?.angle ?? req.angle ?? remembered.angle ?? 'sideline')
  const [startAtSnap, setStartAtSnap] = useState(remembered.startAtSnap ?? settings?.startAtSnap ?? true)
  const [preRoll, setPreRoll] = useState(remembered.preRoll ?? settings?.preRoll ?? 1)
  const [end, setEnd] = useState<ExportVideoRequest['end']>(remembered.end ?? 'clip')
  const [between, setBetween] = useState<ExportVideoRequest['between']>(remembered.between ?? 'none')
  const [burnIn, setBurnIn] = useState<ExportVideoRequest['burnIn']>({ ...DEFAULT_BURN, ...(remembered.burnIn ?? {}) })
  const [height, setHeight] = useState<ExportVideoRequest['height']>(remembered.height ?? 1080)
  const [audio, setAudio] = useState(remembered.audio ?? false)
  const [fileName, setFileName] = useState(() => restored?.fileName ?? sanitizeFileName(req.fileName ?? req.title ?? 'Untitled'))
  const [folders, setFolders] = useState<Folders | null>(null)
  const [folder, setFolder] = useState<string | null>(restored?.folder ?? null)
  const [plan, setPlan] = useState<ExportPlan | null>(null)
  const [planning, setPlanning] = useState(true)
  const [slow, setSlow] = useState(false)
  const [step, setStep] = useState(0)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)
  const [graded, setGraded] = useState<{ id: string; label: string; count: number }[]>([])
  const [angles, setAngles] = useState<Set<Angle> | null>(null)
  const [choosingPlayer, setChoosingPlayer] = useState(false)
  const playerRef = useRef<HTMLDivElement>(null)
  usePlayerNames()

  useEffect(() => {
    rawApi.exportFolders().then(
      (f) => {
        setFolders(f)
        setFolder((cur) => cur ?? readLocal<string | null>('ui.export.folder', null) ?? f.last ?? f.movies)
      },
      () => setFolders(null)
    )
  }, [])

  // Players with a grade in the plays, and the angles they have (cut-ups; the tape room passes its own player).
  useEffect(() => {
    if (req.source.kind !== 'cutup') return
    let live = true
    rawApi.cutup(req.source.cutupId).then((d) => {
      if (!live || !d) return
      const wanted = new Set(plays.map(keyOf))
      const items = d.items.filter((i) => wanted.has(keyOf(i.ref)))
      const count = new Map<string, { id: string; name: string; position: string; team: string; count: number }>()
      for (const i of items) {
        for (const e of i.entries) {
          if (e.grade === null) continue
          const c = count.get(e.playerId) ?? { id: e.playerId, name: e.name, position: e.position, team: i.team, count: 0 }
          c.count++
          count.set(e.playerId, c)
        }
      }
      setGraded(
        [...count.values()]
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
          .slice(0, 10)
          .map((c) => ({ id: c.id, label: `${c.name} · ${c.position} · ${c.team} · ${c.count}`, count: c.count }))
      )
      setAngles(new Set(items.flatMap((i) => i.clips.map((c) => c.angle))))
    }, () => {})
    return () => {
      live = false
    }
  }, [req.source, plays])

  const name = sanitizeFileName(fileName)
  const request: ExportVideoRequest | null = folder
    ? {
        source: { ...req.source, plays },
        playerId: fixedPlayer ?? playerId,
        angle,
        startAtSnap,
        preRoll,
        end,
        between,
        burnIn,
        height,
        audio,
        folder,
        fileName: name || 'Untitled'
      }
    : null
  const requestKey = JSON.stringify(request)

  // The plan, 250ms after the last change.
  useEffect(() => {
    if (!request) return
    setPlanning(true)
    let live = true
    const t = setTimeout(() => {
      rawApi.exportVideoPlan(request).then(
        (p) => {
          if (!live) return
          setPlan(p)
          setPlanning(false)
        },
        (e) => {
          if (!live) return
          setPlanning(false)
          setFolderError(null)
          errorBanner('Couldn’t prepare the export', e)
        }
      )
    }, plan ? 250 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 200)
    return () => clearTimeout(t)
  }, [])

  // Remember options except plays, player and name.
  useEffect(() => {
    writeLocal('ui.export.options', { angle, startAtSnap, preRoll, end, between, burnIn, height, audio } satisfies RememberedOptions)
  }, [angle, startAtSnap, preRoll, end, between, burnIn, height, audio])

  const steps = (burnIn.titleCard && plan?.segments.length ? 1 : 0) + (plan?.segments.length ?? 0)
  const at = Math.min(step, Math.max(0, steps - 1))
  const titleStep = burnIn.titleCard && at === 0 && !!plan?.segments.length
  const segIndex = at - (burnIn.titleCard && plan?.segments.length ? 1 : 0)
  const seg = plan && !titleStep ? plan.segments[segIndex] : undefined
  const stepLabel = titleStep ? 'Title card' : seg ? `Play ${seg.number} of ${plan!.playCount}` : '—'

  const error = !plan ? null : plan.error
  const emptyName = !name
  const tooMany = plays.length > MAX_EXPORT_PLAYS
  const blocked = !request || !plan || planning || !!error || emptyName || tooMany
  const without = plan ? plan.skipped.filter((s) => s.reason === 'noFilm').length : 0

  const start = async () => {
    if (!request || blocked) {
      setNameTouched(true)
      return
    }
    const r = request
    const sheet: ExportSheetRequest = { ...req, initial: choice, playerId: r.playerId, angle: angle === 'eachAngle' ? undefined : angle }
    writeLocal('ui.export.folder', r.folder)
    const local = addPreparing(r.fileName)
    onClose()
    try {
      const fresh = await rawApi.exportVideoPlan(r)
      if (fresh.error) throw new Error(errorMessage(fresh.error))
      const overlays = await renderOverlays(fresh, r)
      const { activityId } = await rawApi.startExportVideo(r, overlays)
      rememberExport(activityId, sheet, r)
    } catch (e) {
      errorBanner(`Couldn’t export ${r.fileName}.mp4`, e)
    } finally {
      removePreparing(local)
    }
  }

  // ── Rows ──

  const playerItems: MenuItemSpec[] = [
    { label: 'No Player', checked: !playerId, run: () => setPlayerId(null) },
    ...(graded.length ? [{ kind: 'separator' } as MenuItemSpec] : []),
    ...graded.map((g) => ({ label: g.label, checked: playerId === g.id, run: () => setPlayerId(g.id) })),
    ...(playerId && !graded.some((g) => g.id === playerId) ? [{ label: playerName(playerId) ?? 'Player', checked: true, run: () => {} } as MenuItemSpec] : []),
    { kind: 'separator' },
    { label: 'Choose Player…', run: () => setChoosingPlayer(true) }
  ]
  const noPlayer = !(fixedPlayer ?? playerId)
  const angleOptions = ANGLES.map((a) => ({ ...a, disabled: angles !== null && (a.value === 'sideline' || a.value === 'endzone' || a.value === 'main') && !angles.has(a.value as Angle) }))
  const folderItems: MenuItemSpec[] = folders
    ? [
        ...(folder && ![folders.desktop, folders.documents, folders.downloads, folders.movies].includes(folder) ? [{ label: baseName(folder), checked: true, icon: 'folder', run: () => {} } as MenuItemSpec, { kind: 'separator' } as MenuItemSpec] : []),
        { label: 'Desktop', checked: folder === folders.desktop, icon: 'folder', run: () => setFolder(folders.desktop) },
        { label: 'Documents', checked: folder === folders.documents, icon: 'folder', run: () => setFolder(folders.documents) },
        { label: 'Downloads', checked: folder === folders.downloads, icon: 'folder', run: () => setFolder(folders.downloads) },
        { label: 'Movies', checked: folder === folders.movies, icon: 'folder', run: () => setFolder(folders.movies) },
        { kind: 'separator' },
        {
          label: 'Other…',
          run: () =>
            void rawApi.chooseFolder().then((f) => {
              if (f) {
                setFolder(f)
                setFolderError(null)
              }
            })
        }
      ]
    : []
  const folderLabel = !folder || !folders ? '…' : folder === folders.movies ? 'Movies' : folder === folders.desktop ? 'Desktop' : folder === folders.documents ? 'Documents' : folder === folders.downloads ? 'Downloads' : baseName(folder)

  const status = !plan && planning ? (
    slow ? <Spinner size={12} /> : null
  ) : tooMany || error === 'tooMany' ? (
    <span className="export-sheet__error">Export up to 300 plays at a time.</span>
  ) : error === 'noFfmpeg' ? (
    <span className="export-sheet__status-row">
      <span className="export-sheet__error">Video export needs ffmpeg, and it couldn’t be found.</span>
      <Button variant="borderless" size="sm" label="Film & Import Settings…" onClick={() => void window.shell.openSettings('film')} />
    </span>
  ) : error === 'noEncoder' ? (
    <span className="export-sheet__error">This copy of ffmpeg can’t encode H.264 video.</span>
  ) : error === 'nothingToExport' ? (
    <span className="export-sheet__error">None of these plays have film.</span>
  ) : planning ? (
    <Spinner size={12} />
  ) : plan ? (
    <span>
      {sizeLabel(plan.estimateBytes)}
      {without ? ` · ${without} ${without === 1 ? 'play' : 'plays'} without film ${without === 1 ? 'is' : 'are'} skipped` : ''}
    </span>
  ) : null

  const sub = plan && !planning && plan.segments.length ? `${plan.playCount} ${plan.playCount === 1 ? 'play' : 'plays'} · ${plan.gameCount} ${plan.gameCount === 1 ? 'game' : 'games'} · ${durationLabel(plan.duration)}` : planning ? ' ' : ''

  return (
    <Sheet
      size="L"
      title="Export Video"
      subtitle={req.title}
      test="export-sheet"
      onCancel={onClose}
      footerLeading={<span className="export-sheet__status">{status}</span>}
      primary={{ label: plan?.exists ? 'Replace' : 'Export', run: () => void start(), disabled: blocked, test: 'export-start' }}
      bodyClassName="screen-export"
    >
      <div className="export-sheet" data-loading={!plan && !slow ? true : undefined}>
        <div className="export-sheet__preview-col">
          <ExportPreview plan={plan} request={request} seg={seg} titleStep={titleStep} source={req.source.kind} />
          <div className="export-sheet__stepper">
            <Button variant="borderless" size="sm" iconOnly icon="chevron-left" label="Previous Play" disabled={at <= 0} onClick={() => setStep(Math.max(0, at - 1))} />
            <span className="export-sheet__step">{stepLabel}</span>
            <Button variant="borderless" size="sm" iconOnly icon="chevron-right" label="Next Play" disabled={at >= steps - 1} onClick={() => setStep(Math.min(steps - 1, at + 1))} />
          </div>
        </div>

        <div className="export-sheet__form">
          <Row label="Plays" top>
            <div className="export-sheet__stack">
              <PopupButton width={288} value={choice} onChange={setChoice} options={choices.map((c) => ({ value: c.key, label: c.label }))} test="export-source" />
              <span className="export-sheet__sub">{sub}</span>
            </div>
          </Row>
          {!fixedPlayer && (
            <Row label="Player">
              <div ref={playerRef}>
                <PopupButton width={288} value={playerId ?? ''} options={[{ value: playerId ?? '', label: playerId ? (playerName(playerId) ?? 'Player') : 'No Player' }]} sections={playerItems} onChange={() => {}} />
              </div>
              <Popover anchor={playerRef} open={choosingPlayer} onClose={() => setChoosingPlayer(false)} width={300} padding="list">
                <PlayerSearch
                  onPick={(p) => {
                    setChoosingPlayer(false)
                    setPlayerId(p.id)
                  }}
                />
              </Popover>
            </Row>
          )}

          <div className="export-sheet__gap" />
          <Row label="Angle">
            <PopupButton width={288} value={angle} onChange={setAngle} options={angleOptions} sections={angleMenu(angleOptions, angle, setAngle)} test="export-angle" />
          </Row>
          <Row label="Start">
            <div className="export-sheet__stack">
              <span className="export-sheet__inline">
                <Checkbox checked={startAtSnap} onChange={setStartAtSnap}>
                  At the snap,
                </Checkbox>
                <PopupButton size="sm" variant="inline" value={preRoll} onChange={setPreRoll} options={PRE_ROLLS} disabled={!startAtSnap} />
                <span className={startAtSnap ? undefined : 'c-label-4'}>before</span>
              </span>
              {startAtSnap && plan && plan.noSnap > 0 && (
                <span className="export-sheet__sub">
                  {plan.noSnap} {plan.noSnap === 1 ? 'play has' : 'plays have'} no snap point and start at the beginning of the clip.
                </span>
              )}
            </div>
          </Row>
          <Row label="End">
            <PopupButton width={288} value={end} onChange={setEnd} options={ENDS} />
          </Row>
          <Row label="Between">
            <PopupButton width={288} value={between} onChange={setBetween} options={BETWEEN} />
          </Row>

          <div className="export-sheet__gap" />
          <Row label="Burn In" top>
            <div className="export-sheet__checks">
              <span title={noPlayer ? 'Choose a player to burn in a grade and name.' : undefined}>
                <Checkbox checked={burnIn.grade && !noPlayer} disabled={noPlayer} onChange={(v) => setBurnIn({ ...burnIn, grade: v })}>
                  Grade
                </Checkbox>
              </span>
              <span title={noPlayer ? 'Choose a player to burn in a grade and name.' : undefined}>
                <Checkbox checked={burnIn.name && !noPlayer} disabled={noPlayer} onChange={(v) => setBurnIn({ ...burnIn, name: v })}>
                  Player name
                </Checkbox>
              </span>
              <Checkbox checked={burnIn.caption} onChange={(v) => setBurnIn({ ...burnIn, caption: v })}>
                Play caption
              </Checkbox>
              <span className="export-sheet__indent">
                <Checkbox checked={burnIn.description && burnIn.caption} disabled={!burnIn.caption} onChange={(v) => setBurnIn({ ...burnIn, description: v })}>
                  Play description
                </Checkbox>
              </span>
              <Checkbox checked={burnIn.drawings} onChange={(v) => setBurnIn({ ...burnIn, drawings: v })}>
                Drawings
              </Checkbox>
              <Checkbox checked={burnIn.number} onChange={(v) => setBurnIn({ ...burnIn, number: v })}>
                Play number
              </Checkbox>
              <Checkbox checked={burnIn.titleCard} onChange={(v) => setBurnIn({ ...burnIn, titleCard: v })}>
                Title card
              </Checkbox>
            </div>
          </Row>

          <div className="export-sheet__gap" />
          <Row label="Size">
            <PopupButton<string>
              width={288}
              value={String(height)}
              onChange={(v) => setHeight(v === 'source' ? 'source' : (Number(v) as 720 | 1080))}
              options={[
                { value: '720', label: '720p (1280 × 720)' },
                { value: '1080', label: '1080p (1920 × 1080)' },
                { value: 'source', label: plan?.sourceHeight ? `Same as Source (${plan.sourceHeight}p)` : 'Same as Source', disabled: plan ? !plan.sourceHeight : false }
              ]}
            />
          </Row>
          <Row label="Sound">
            <Checkbox checked={audio} onChange={setAudio}>
              Include clip audio
            </Checkbox>
          </Row>

          <div className="export-sheet__gap" />
          <Row label="Save As" top>
            <div className="export-sheet__stack">
              <span className="export-sheet__inline">
                <TextField
                  size="md"
                  width={240}
                  value={fileName}
                  onChange={(v) => {
                    setFileName(v)
                    setNameTouched(true)
                  }}
                  autoFocus
                  selectOnFocus
                  invalid={emptyName && nameTouched ? 'Enter a file name.' : null}
                  ariaLabel="File name"
                  test="export-name"
                />
                <span className="export-sheet__ext">.mp4</span>
              </span>
              {plan?.exists && name && (
                <span className="export-sheet__info">
                  <Icon name="info" size={12} />“{name}.mp4” already exists in {folderLabel}. Exporting replaces it.
                </span>
              )}
            </div>
          </Row>
          <Row label="Where" top>
            <div className="export-sheet__stack">
              <FolderPopup label={folderLabel} items={folderItems} />
              {folderError && <span className="export-sheet__field-error">{folderError}</span>}
            </div>
          </Row>
        </div>
      </div>
    </Sheet>
  )
}

function angleMenu(options: { value: ExportAngle; label: string; disabled?: boolean }[], value: ExportAngle, set: (a: ExportAngle) => void): MenuItemSpec[] {
  const item = (o: (typeof options)[number]): MenuItemSpec => ({ label: o.label, checked: o.value === value, disabled: o.disabled, run: () => set(o.value) })
  return [...options.slice(0, 3).map(item), { kind: 'separator' }, ...options.slice(3).map(item)]
}

function FolderPopup({ label, items }: { label: string; items: MenuItemSpec[] }) {
  return (
    <span className="export-sheet__folder">
      <PopupButton width={288} value={label} options={[{ value: label, label }]} sections={items} onChange={() => {}} label={label} />
      <Icon name="folder" size={14} className="export-sheet__folder-icon" />
    </span>
  )
}

function Row({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <div className={`export-sheet__row${top ? ' export-sheet__row--top' : ''}`}>
      <span className="export-sheet__label">{label}</span>
      <div className="export-sheet__control">{children}</div>
    </div>
  )
}

export function errorMessage(e: NonNullable<ExportPlan['error']>): string {
  return e === 'noFfmpeg'
    ? 'Video export needs ffmpeg, and it couldn’t be found.'
    : e === 'noEncoder'
      ? 'This copy of ffmpeg can’t encode H.264 video.'
      : e === 'tooMany'
        ? 'Export up to 300 plays at a time.'
        : 'None of these plays have film.'
}

// ── Preview ────────────────────────────────────────────────────────────────

const PW = 360
const PH = 203

/** The selected play's poster frame(s) with the burn-ins drawn by the export's own painters. */
function ExportPreview({ plan, request, seg, titleStep, source }: { plan: ExportPlan | null; request: ExportVideoRequest | null; seg: ExportPlan['segments'][number] | undefined; titleStep: boolean; source: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const item = useMemo(() => (plan && seg ? plan.items.find((i) => keyOf(i.ref) === keyOf(seg.ref)) : undefined), [plan, seg])
  // Drawings: preview the first moment with shapes, and the poster at that moment.
  const interval = useMemo(() => (plan && seg && request?.burnIn.drawings && item?.drawing ? (drawingIntervals(seg, item.drawing, plan.fps)[0] ?? null) : null), [plan, seg, request?.burnIn.drawings, item])
  const at = interval ? interval.from + Math.min(0.2, (interval.to - interval.from) / 2) : 0

  useEffect(() => {
    const c = canvas.current
    if (!c || !plan || !request) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(PW * dpr)
    c.height = Math.round(PH * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    let live = true
    const draw = () => {
      if (!live) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, c.width, c.height)
      const s = (PW * dpr) / plan.width
      ctx.setTransform(s, 0, 0, s, 0, 0)
      if (titleStep) {
        paintTitleCard(ctx, plan.width, plan.height, plan.titleCard, source === 'player' ? titleBar(plan) : null)
        return
      }
      if (!seg) return
      const input = { W: plan.width, H: plan.height, seg, item, total: plan.playCount, burnIn: request.burnIn, player: !!request.playerId }
      if (interval) paintDrawings(ctx, seg, interval, plan.fps)
      if (hasStatic(input)) paintStatic(ctx, input)
    }
    void document.fonts.ready.then(draw)
    draw()
    return () => {
      live = false
    }
  }, [plan, request, seg, item, interval, titleStep, source])

  const s = PW / (plan?.width ?? 1920)
  return (
    <div className="export-preview" aria-label="Preview">
      {!titleStep &&
        seg?.parts.map((p) => (
          <img
            key={`${p.clipId}:${p.in}`}
            className="export-preview__poster"
            src={posterUrl(p.clipId, Math.max(0, p.in + at), 640)}
            alt=""
            draggable={false}
            style={{ left: p.rect.x * s, top: p.rect.y * s, width: p.rect.w * s, height: p.rect.h * s }}
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
          />
        ))}
      {(!plan || (!seg && !titleStep)) && (
        <div className="export-preview__placeholder">
          <Icon name="film" size={24} />
        </div>
      )}
      <canvas ref={canvas} className="export-preview__overlay" />
    </div>
  )
}


