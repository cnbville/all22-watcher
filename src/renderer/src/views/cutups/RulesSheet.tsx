import { useEffect, useMemo, useRef, useState } from 'react'
import { defPersonnelLabel, durationLabel, enumLabel, personnelLabel } from '@shared/labels'
import { ruleComplete } from '@shared/playQuery'
import { TEAMS, TEAM_BY_ABBR } from '@shared/teams'
import type { CutupFocus, CutupPreview, CutupRules, PlayRule, RuleField, RuleOp, RuleOptions } from '@shared/types'
import { api, rawApi } from '../../api'
import { Button } from '../../ui/Button'
import { Checkbox, Radio } from '../../ui/Switch'
import { Disclosure } from '../../ui/Disclosure'
import { Icon } from '../../ui/Icon'
import type { MenuItemSpec } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { PopupButton, PulldownButton } from '../../ui/PopupButton'
import { Segmented, ToggleSegments } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { Spinner } from '../../ui/Spinner'
import { Stepper } from '../../ui/Stepper'
import { TextField } from '../../ui/TextField'
import { errorBanner } from '../../shell/Banners'
import { links, navigate } from '../../shell/router'
import { PlayRow } from '../shared/PlayRow'
import { readLocal, writeLocal } from '../shared/hooks'
import { closeRulesSheet, plural, type RulesSheetRequest } from './actions'
import { type PickedPlayer, PlayerField, PlayerSearch, playerName, usePlayerNames } from './PlayerPicker'
import { FIELDS, fieldDef, newRule, OP_LABEL, opsFor, studiedTeam, TEMPLATES, templateRules, isTemplateName, valueKind, weekValueLabel, withOp } from './rules'

/** The smart cut-up rules sheet (03 §9.4): New Smart Cut-up, Edit Rules and Save as Cut-up. */

const ORDERS: { value: CutupRules['order']; label: string }[] = [
  { value: 'game', label: 'Game Order' },
  { value: 'newest', label: 'Newest Games First' },
  { value: 'epa-desc', label: 'EPA, Best First' },
  { value: 'epa-asc', label: 'EPA, Worst First' }
]

const SECTIONS = ['Game', 'Situation', 'Lineup', 'Result', 'Your grading'] as const

export function RulesSheet({ req }: { req: RulesSheetRequest }) {
  const editing = req.mode === 'edit' ? req.cutup! : null
  const initialRules = editing?.rules
  const [name, setName] = useState(editing?.name ?? req.name ?? '')
  const [match, setMatch] = useState<'all' | 'any'>(initialRules?.match ?? 'all')
  const [rules, setRules] = useState<PlayRule[]>(() => initialRules?.rules.map((r) => ({ ...r })) ?? req.rules?.map((r) => ({ ...r })) ?? [newRule('down')])
  const [limitOn, setLimitOn] = useState(initialRules?.limit != null)
  const [limit, setLimit] = useState(initialRules?.limit ?? 50)
  const [order, setOrder] = useState<CutupRules['order']>(initialRules?.order ?? 'game')
  const [focus, setFocus] = useState<CutupFocus | null>(editing?.focus ?? req.focus ?? null)
  const [keep, setKeep] = useState<'smart' | 'fixed'>('smart')
  const [touched, setTouched] = useState<Set<number>>(new Set())
  const [attempted, setAttempted] = useState(false)
  const [options, setOptions] = useState<RuleOptions | null>(null)
  const [preview, setPreview] = useState<CutupPreview | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [showPlays, setShowPlays] = useState(() => readLocal('ui.cutupSheet.preview', false))
  const [saving, setSaving] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null)
  const templatesRef = useRef<HTMLDivElement>(null)
  const players = usePlayerNames()
  const fixed = req.mode === 'filters' && keep === 'fixed'

  useEffect(() => {
    rawApi.cutupRuleOptions().then(setOptions, () => setOptions(null))
  }, [])

  const applyTemplate = (id: string, player?: PickedPlayer) => {
    const t = TEMPLATES.find((x) => x.id === id)
    if (!t) return
    if (t.needsPlayer && !player) return setPendingTemplate(id)
    const r = templateRules(t, player)
    setRules(r.rules)
    setMatch('all')
    setTouched(new Set())
    setAttempted(false)
    setName((n) => (isTemplateName(n) ? r.name : n))
  }
  useEffect(() => {
    if (req.template) applyTemplate(req.template)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const complete = rules.every(ruleComplete)
  const effectiveFocus: CutupFocus | null = useMemo(() => {
    const team = studiedTeam(rules)
    if (!team || focus?.team) return focus
    return { ...(focus ?? {}), team }
  }, [focus, rules])
  const cutupRules: CutupRules = { match, rules, limit: limitOn ? limit : null, order }
  const rulesKey = JSON.stringify([cutupRules, effectiveFocus])

  // Live count: 250ms after the last change.
  useEffect(() => {
    if (!complete || fixed) {
      setWaiting(false)
      return
    }
    setWaiting(true)
    let live = true
    const t = setTimeout(() => {
      rawApi.previewCutupRules(cutupRules, effectiveFocus).then(
        (p) => live && (setPreview(p), setWaiting(false)),
        () => live && setWaiting(false)
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesKey, complete, fixed])

  const setRule = (i: number, r: PlayRule) => setRules((list) => list.map((x, j) => (j === i ? r : x)))
  const chartFields = options?.chartFields ?? []

  const submit = async () => {
    setAttempted(true)
    if (!fixed && !complete) return
    setSaving(true)
    const finalName = name.trim().slice(0, 80)
    try {
      if (editing) {
        await api.updateCutup(editing.id, { name: finalName || editing.name, rules: cutupRules, focus: effectiveFocus })
        closeRulesSheet()
      } else if (fixed) {
        const c = await api.createCutup({ kind: 'manual', name: finalName || undefined, plays: req.fixedPlays ?? [], focus: effectiveFocus ?? undefined })
        closeRulesSheet()
        navigate(links.cutup(c.id))
      } else {
        const c = await api.createCutup({ kind: 'smart', name: finalName || undefined, rules: cutupRules, focus: effectiveFocus ?? undefined })
        closeRulesSheet()
        navigate(links.cutup(c.id))
      }
    } catch (e) {
      setSaving(false)
      errorBanner(editing ? 'Couldn’t save the rules' : 'Couldn’t create the cut-up', e)
    }
  }

  const title = editing ? 'Edit Rules' : req.mode === 'filters' ? 'Save as Cut-up' : 'New Smart Cut-up'
  const subtitle = editing ? editing.name : 'Plays that match these rules are added as you import and grade.'
  const lineupFields = new Set<RuleField>(['formation', 'personnel', 'coverage', 'manZone', 'pressure', 'passRushers', 'box'])
  const noLineup = (preview?.noLineupSeasons ?? options?.noLineupSeasons ?? []).filter(() => rules.some((r) => lineupFields.has(r.field)))
  const skipped = preview?.skippedSeasons ?? []

  const status = fixed ? (
    <span>{plural(req.fixedPlays?.length ?? 0, 'play')}</span>
  ) : !complete && (attempted || touched.size > 0) ? (
    <span className="rules-sheet__status--error">Finish the highlighted rule</span>
  ) : waiting || (!preview && complete) ? (
    <Spinner size={12} />
  ) : !complete ? (
    <span />
  ) : preview && preview.playCount ? (
    <span>
      {plural(preview.playCount, 'play')} in {plural(preview.gameCount, 'game')} · {durationLabel(preview.duration)}
    </span>
  ) : (
    <span>No plays match yet</span>
  )

  return (
    <Sheet
      size="L"
      title={title}
      subtitle={subtitle}
      test={req.mode === 'filters' ? 'cutup-from-filters' : 'cutup-rules-sheet'}
      accessory={
        editing ? undefined : (
          <div ref={templatesRef}>
            <PulldownButton
              size="sm"
              label="Templates"
              test="cutup-templates"
              items={TEMPLATES.map((t) => ({ label: t.label, run: () => applyTemplate(t.id) }))}
            />
          </div>
        )
      }
      onCancel={closeRulesSheet}
      footerLeading={<span className="rules-sheet__status">{status}</span>}
      primary={{ label: editing ? 'Save' : 'Create', run: () => void submit(), disabled: (!fixed && !complete && attempted) || saving, loading: saving, test: 'cutup-create' }}
      bodyClassName="screen-cutup-rules"
    >
      <div className="rules-sheet__form" data-test={req.mode === 'filters' ? 'cutup-rules-sheet' : undefined}>
        {req.mode === 'filters' && (
          <div className="rules-sheet__row">
            <span className="rules-sheet__label">Keep</span>
            <span className="rules-sheet__radios">
              <Radio checked={keep === 'smart'} onChange={() => setKeep('smart')} name="keep">
                Smart: keep adding plays that match
              </Radio>
              <Radio checked={keep === 'fixed'} onChange={() => setKeep('fixed')} name="keep">
                Fixed: just these {plural(req.fixedPlays?.length ?? 0, 'play')}
              </Radio>
            </span>
          </div>
        )}
        <div className="rules-sheet__row">
          <span className="rules-sheet__label">Name</span>
          <TextField size="lg" width={480} value={name} onChange={setName} placeholder={req.mode === 'filters' && fixed ? 'Untitled Cut-up' : 'Untitled Smart Cut-up'} autoFocus selectOnFocus test="cutup-name" />
        </div>

        <div className="rules-sheet__rules" data-dimmed={fixed || undefined} aria-disabled={fixed || undefined}>
          <div className="rules-sheet__match">
            {rules.length === 1 ? (
              'Match the following rule:'
            ) : (
              <>
                Match
                <PopupButton
                  size="sm"
                  variant="inline"
                  value={match}
                  onChange={setMatch}
                  options={[
                    { value: 'all', label: 'all' },
                    { value: 'any', label: 'any' }
                  ]}
                />
                of the following rules:
              </>
            )}
          </div>
          <div className="rules-sheet__box">
            {rules.map((r, i) => (
              <RuleRow
                key={i}
                rule={r}
                options={options}
                focusPlayer={focus?.playerId ?? null}
                invalid={!ruleComplete(r) && (attempted || touched.has(i))}
                onBlur={() => setTouched((t) => new Set(t).add(i))}
                onChange={(next) => setRule(i, next)}
                canRemove={rules.length > 1}
                canAdd={rules.length < 12}
                onRemove={() => setRules((list) => list.filter((_, j) => j !== i))}
                onAdd={() => setRules((list) => [...list.slice(0, i + 1), { field: r.field, op: opsFor(r.field)[0] === r.op ? r.op : opsFor(r.field)[0], value: newRule(r.field, chartFields).value }, ...list.slice(i + 1)])}
                chartFieldsLabel={chartFields}
              />
            ))}
          </div>
          {noLineup.length > 0 && (
            <div className="rules-sheet__note">
              <Icon name="info" size={12} />
              Coverage, pressure and personnel aren’t published for {noLineup.join(', ')} yet, so these rules match no {noLineup.join(' or ')} plays.
            </div>
          )}
          {skipped.map((s) => (
            <div key={s} className="rules-sheet__note">
              <Icon name="info" size={12} />
              Plays from {s} aren’t included because that season isn’t downloaded.
            </div>
          ))}

          <div className="rules-sheet__row rules-sheet__row--spaced">
            <span className="rules-sheet__label" />
            <span className="rules-sheet__inline">
              <Checkbox checked={limitOn} onChange={setLimitOn}>
                Limit to
              </Checkbox>
              <Stepper value={limit} onChange={setLimit} min={1} max={500} ariaLabel="Limit" />
              <span>plays</span>
            </span>
          </div>
          <div className="rules-sheet__row">
            <span className="rules-sheet__label">Order by</span>
            <PopupButton width={200} value={order} onChange={setOrder} options={ORDERS} />
          </div>
          <div className="rules-sheet__row">
            <span className="rules-sheet__label">Show grades for</span>
            <FocusPopup focus={effectiveFocus} onChange={setFocus} />
          </div>
          <div className="rules-sheet__row">
            <span className="rules-sheet__label" />
            <button
              type="button"
              className="rules-sheet__disclosure"
              aria-expanded={showPlays}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                writeLocal('ui.cutupSheet.preview', !showPlays)
                setShowPlays(!showPlays)
              }}
            >
              <Disclosure expanded={showPlays} />
              Show Matching Plays
            </button>
          </div>
          {showPlays && (
            <div className="rules-sheet__preview">
              {!preview || !complete ? (
                <div className="rules-sheet__preview-empty">{complete ? 'Looking for plays…' : 'Finish the rules to see matching plays.'}</div>
              ) : !preview.sample.length ? (
                <div className="rules-sheet__preview-empty">No plays match yet</div>
              ) : (
                <>
                  {preview.sample.map((s) => {
                    const mine = s.entries.filter((e) => e.grade !== null)
                    return (
                      <PlayRow
                        key={`${s.ref.gameId}:${s.ref.playId}`}
                        item={{ ref: s.ref, game: s.game, team: s.team, play: s.play, tags: [...new Set(mine.flatMap((e) => e.tags))], flagged: s.flagged, hasNote: !!s.playNote, teamEpa: s.teamEpa }}
                      />
                    )
                  })}
                  {preview.playCount > preview.sample.length && <div className="rules-sheet__more">and {preview.playCount - preview.sample.length} more</div>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <Popover anchor={templatesRef} open={pendingTemplate !== null} onClose={() => setPendingTemplate(null)} width={300} padding="list">
        <PlayerSearch
          onPick={(p) => {
            const t = pendingTemplate
            setPendingTemplate(null)
            if (t) applyTemplate(t, p)
          }}
        />
      </Popover>
      {/* Player names resolve once loaded; referenced so the summary re-renders. */}
      <span hidden>{Object.keys(players).length}</span>
    </Sheet>
  )
}

/** "Show grades for": Studied Team, the 32 teams, Player… */
function FocusPopup({ focus, onChange }: { focus: CutupFocus | null; onChange: (f: CutupFocus | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [picking, setPicking] = useState(false)
  const value = focus?.playerId ? `p:${focus.playerId}` : focus?.team ? `t:${focus.team}` : 'studied'
  const label = focus?.playerId ? (playerName(focus.playerId) ?? 'Player') : focus?.team ? (TEAM_BY_ABBR[focus.team]?.nickname ?? focus.team) : 'Studied Team'
  const items: MenuItemSpec[] = [
    { label: 'Studied Team', checked: value === 'studied', run: () => onChange(null) },
    { kind: 'separator' },
    ...[...TEAMS].sort((a, b) => a.nickname.localeCompare(b.nickname)).map((t) => ({ label: t.nickname, checked: value === `t:${t.abbr}`, run: () => onChange({ team: t.abbr }) })),
    { kind: 'separator' },
    ...(focus?.playerId ? [{ label: playerName(focus.playerId) ?? 'Player', checked: true, run: () => {} } as MenuItemSpec] : []),
    { label: 'Player…', run: () => setPicking(true) }
  ]
  return (
    <div ref={ref}>
      <PopupButton width={200} value={value} options={[{ value, label }]} sections={items} onChange={() => {}} label={label} />
      <Popover anchor={ref} open={picking} onClose={() => setPicking(false)} width={300} padding="list">
        <PlayerSearch
          onPick={(p) => {
            setPicking(false)
            onChange({ playerId: p.id })
          }}
        />
      </Popover>
    </div>
  )
}

function fieldMenu(current: RuleField, options: RuleOptions | null, pick: (f: RuleField) => void): MenuItemSpec[] {
  const out: MenuItemSpec[] = []
  for (const section of SECTIONS) {
    if (out.length) out.push({ kind: 'separator' })
    out.push({ kind: 'header', label: section })
    for (const f of FIELDS.filter((x) => x.section === section)) out.push({ label: f.label, checked: f.field === current, run: () => pick(f.field as RuleField) })
    if (section === 'Your grading') {
      for (const cf of options?.chartFields ?? []) {
        const key = `chart:${cf.id}` as RuleField
        out.push({ label: cf.name, checked: key === current, run: () => pick(key) })
      }
    }
  }
  return out
}

function RuleRow({
  rule,
  options,
  focusPlayer,
  invalid,
  onBlur,
  onChange,
  canRemove,
  canAdd,
  onRemove,
  onAdd,
  chartFieldsLabel
}: {
  rule: PlayRule
  options: RuleOptions | null
  focusPlayer: string | null
  invalid: boolean
  onBlur: () => void
  onChange: (r: PlayRule) => void
  canRemove: boolean
  canAdd: boolean
  onRemove: () => void
  onAdd: () => void
  chartFieldsLabel: RuleOptions['chartFields']
}) {
  const cf = chartFieldsLabel
  const def = fieldDef(rule.field, cf)
  const ops = opsFor(rule.field)
  return (
    <div className="rule-row" data-test="rule-row">
      <PopupButton
        width={200}
        value={rule.field}
        label={def.label}
        options={[{ value: rule.field, label: def.label }]}
        sections={fieldMenu(rule.field, options, (f) => onChange(newRule(f, cf)))}
        onChange={() => {}}
        test="rule-field"
      />
      <PopupButton<RuleOp> width={140} value={rule.op} options={ops.map((o) => ({ value: o, label: OP_LABEL[o] }))} onChange={(op) => onChange(withOp(rule, op, cf))} disabled={ops.length < 2} test="rule-op" />
      <div className="rule-row__value" data-invalid={invalid || undefined} onBlur={onBlur}>
        <ValueControl rule={rule} options={options} onChange={onChange} />
        {def.scoped && <ScopePopup player={rule.player ?? null} focusPlayer={focusPlayer} onChange={(p) => onChange(p ? { ...rule, player: p } : (({ player: _, ...rest }) => rest)(rule))} />}
      </div>
      <span className="rule-row__buttons">
        <Button variant="borderless" size="sm" iconOnly icon="circle-minus" label="Remove Rule" disabled={!canRemove} onClick={onRemove} />
        <Button variant="borderless" size="sm" iconOnly icon="circle-plus" label="Add Rule" title={canAdd ? 'Add Rule' : 'Up to 12 rules'} disabled={!canAdd} onClick={onAdd} />
      </span>
    </div>
  )
}

/** "for": Anyone, the focus player, Choose Player… */
function ScopePopup({ player, focusPlayer, onChange }: { player: string | null; focusPlayer: string | null; onChange: (id: string | null) => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [picking, setPicking] = useState(false)
  const label = player ? (playerName(player) ?? 'Player') : 'Anyone'
  const items: MenuItemSpec[] = [
    { label: 'Anyone', checked: !player, run: () => onChange(null) },
    { kind: 'separator' },
    ...(focusPlayer ? [{ label: playerName(focusPlayer) ?? 'Focus player', checked: player === focusPlayer, run: () => onChange(focusPlayer) } as MenuItemSpec] : []),
    ...(player && player !== focusPlayer ? [{ label, checked: true, run: () => {} } as MenuItemSpec] : []),
    { label: 'Choose Player…', run: () => setPicking(true) }
  ]
  return (
    <span ref={ref} className="rule-row__scope">
      <span className="rule-row__for">for</span>
      <PopupButton size="sm" variant="inline" value={player ?? ''} options={[{ value: player ?? '', label }]} sections={items} onChange={() => {}} label={label} />
      <Popover anchor={ref} open={picking} onClose={() => setPicking(false)} width={300} padding="list">
        <PlayerSearch
          onPick={(p) => {
            setPicking(false)
            onChange(p.id)
          }}
        />
      </Popover>
    </span>
  )
}

function ValueControl({ rule, options, onChange }: { rule: PlayRule; options: RuleOptions | null; onChange: (r: PlayRule) => void }) {
  const cf = options?.chartFields ?? []
  const def = fieldDef(rule.field, cf)
  const kind = valueKind(rule, cf)
  const v = rule.value
  const set = (value: PlayRule['value']) => onChange({ ...rule, value })
  const list = Array.isArray(v) ? v.map(String) : v === '' ? [] : [String(v)]
  const one = list[0] ?? ''
  const pair = (Array.isArray(v) && v.length === 2 ? v.map(Number) : [Number(v) || 0, Number(v) || 0]) as [number, number]
  const choose = (placeholder: string, opts: { value: string; label: string }[], sections?: MenuItemSpec[]) => (
    <PopupButton<string>
      width={200}
      value={one}
      label={opts.find((o) => o.value === one)?.label ?? (one ? enumLabel(one) : placeholder)}
      options={opts}
      sections={sections}
      onChange={(x) => set([x])}
    />
  )
  switch (kind) {
    case 'seasons': {
      const seasons = (options?.seasons ?? []).map((s) => ({ value: String(s), label: String(s) }))
      if (rule.op === 'between') {
        const [a, b] = Array.isArray(v) && v.length === 2 ? v.map(String) : ['', '']
        return (
          <span className="rule-row__inline">
            <PopupButton width={88} value={a} label={a || 'Season'} options={seasons} onChange={(x) => set([Number(x), Number(b || x)])} />
            and
            <PopupButton width={88} value={b} label={b || 'Season'} options={seasons} onChange={(x) => set([Number(a || x), Number(x)])} />
          </span>
        )
      }
      return choose('Choose Season', seasons)
    }
    case 'team':
      return choose(
        'Choose Team',
        [...TEAMS].sort((a, b) => a.nickname.localeCompare(b.nickname)).map((t) => ({ value: t.abbr, label: t.nickname }))
      )
    case 'game':
      return choose('Choose Game', (options?.games ?? []).map((g) => ({ value: g.gameId, label: g.label })))
    case 'week':
    case 'stepper': {
      const unit = def.unit ? <span>{def.unit}</span> : null
      const label = kind === 'week' && rule.op !== 'between' ? <span className="rule-row__hint">{WEEK_HINT(Number(Array.isArray(v) ? v[0] : v))}</span> : null
      if (rule.op === 'between') {
        return (
          <span className="rule-row__inline">
            <Stepper value={pair[0]} min={def.min} max={def.max} onChange={(x) => set([x, Math.max(x, pair[1])])} />
            and
            <Stepper value={pair[1]} min={def.min} max={def.max} onChange={(x) => set([Math.min(pair[0], x), x])} />
          </span>
        )
      }
      return (
        <span className="rule-row__inline">
          <Stepper value={Number(Array.isArray(v) ? v[0] : v) || 0} min={def.min} max={def.max} onChange={(x) => set(x)} />
          {unit}
          {label}
        </span>
      )
    }
    case 'segmented':
      return <Segmented size="sm" value={one} onChange={(x) => set([x])} options={(def.choices ?? []).map((c) => ({ value: c.value, label: c.label }))} />
    case 'toggles':
      return <ToggleSegments size="sm" values={list} onChange={(x) => set(x)} options={(def.choices ?? []).map((c) => ({ value: c.value, label: c.label }))} />
    case 'popup': {
      const values = rule.field === 'formation' ? options?.formations : options?.coverages
      return choose('Choose…', (values ?? []).map((x) => ({ value: x, label: enumLabel(x) })))
    }
    case 'personnel': {
      const sections: MenuItemSpec[] = [
        { kind: 'header', label: 'Offense' },
        ...(options?.offPersonnel ?? []).map((p) => ({ label: personnelLabel(p), checked: one === p, run: () => set([p]) })),
        { kind: 'separator' },
        { kind: 'header', label: 'Defense' },
        ...(options?.defPersonnel ?? []).map((p) => ({ label: defPersonnelLabel(p), checked: one === p, run: () => set([p]) }))
      ]
      return (
        <PopupButton
          width={200}
          value={one}
          label={one ? (options?.defPersonnel.includes(one) ? defPersonnelLabel(one) : personnelLabel(one)) : 'Choose…'}
          options={[{ value: one, label: one }]}
          sections={sections}
          onChange={() => {}}
        />
      )
    }
    case 'epa': {
      const num = (x: number, onX: (n: number) => void) => <EpaField value={x} onChange={onX} />
      if (rule.op === 'between') return <span className="rule-row__inline">{num(pair[0], (x) => set([x, pair[1]]))}and{num(pair[1], (x) => set([pair[0], x]))}</span>
      return num(Number(Array.isArray(v) ? v[0] : v) || 0, (x) => set(x))
    }
    case 'text':
      return <TextField width={200} value={typeof v === 'string' ? v : ''} onChange={(x) => set(x)} placeholder={rule.field === 'note' ? 'Note text' : 'Words in the description'} />
    case 'player':
      return <PlayerField value={one || null} onChange={(p) => set([p.id])} />
    case 'tag': {
      const groups = [...new Set((options?.tags ?? []).map((t) => t.group))]
      const sections: MenuItemSpec[] = groups.flatMap((g, i) => [
        ...(i ? [{ kind: 'separator' } as MenuItemSpec] : []),
        { kind: 'header', label: g } as MenuItemSpec,
        ...(options?.tags ?? []).filter((t) => t.group === g).map((t) => ({ label: t.label, checked: one === t.label, run: () => set([t.label]) }))
      ])
      return <PopupButton width={200} value={one} label={one || 'Choose Tag'} options={[{ value: one, label: one }]} sections={sections.length ? sections : [{ label: 'No tags yet', disabled: true, run: () => {} }]} onChange={() => {}} />
    }
    case 'chart':
      return choose('Choose…', def.choices ?? [])
    default:
      return null
  }
}

const WEEK_HINT = (w: number) => (w >= 19 ? weekValueLabel(w) : '')

function EpaField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      className="text-field text-field--md rule-row__epa num"
      value={text}
      inputMode="decimal"
      aria-label="EPA"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text.replace('−', '-'))
        if (Number.isFinite(n)) onChange(Math.max(-10, Math.min(10, Math.round(n * 10) / 10)))
        else setText(String(value))
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(Math.max(-10, Math.min(10, Math.round((value + (e.key === 'ArrowUp' ? 0.1 : -0.1)) * 10) / 10)))
        }
      }}
    />
  )
}
