import type { RefObject } from 'react'
import { Button } from '../../ui/Button'
import { Popover } from '../../ui/Popover'
import { PopupButton } from '../../ui/PopupButton'
import { Segmented, ToggleSegments } from '../../ui/Segmented'
import { KEY_LABEL, setTokenValues, type TapeKey, tokenValues, valueOptions } from './filters'
import type { Room } from './model'

/** The play list's filter popover (02 §4.4). Changes apply live and show as tokens in the search field. */

const TOGGLE_KEYS: TapeKey[] = ['type', 'down', 'distance', 'quarter', 'situation', 'status', 'marked', 'result']
const POPUP_KEYS: TapeKey[] = ['formation', 'personnel', 'coverage']

export function FilterPopover({ room, anchor, onClose }: { room: Room; anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const { tokens, team, lineup } = room
  const set = (key: TapeKey, values: string[]) => room.setTokens(setTokenValues(tokens, key, values))
  const side = tokenValues(tokens, 'side')[0] ?? 'both'
  const hasLineups = room.film.hasParticipation && (lineup.formation.length > 0 || lineup.personnel.length > 0 || lineup.coverage.length > 0)
  const anything = tokens.length > 0 || room.text.trim().length > 0
  const total = room.baseList.length

  return (
    <Popover anchor={anchor} open onClose={onClose} width={360} test="filter-popover">
      <div className="filter-popover">
        <div className="filter-popover__head">
          <span className="filter-popover__title">Filter Plays</span>
          <Button
            variant="borderless"
            size="sm"
            label="Clear All"
            disabled={!anything}
            onClick={() => {
              room.setTokens([])
              room.setText('')
            }}
          />
        </div>
        <div className="filter-popover__grid">
          <span className="filter-popover__label">Side</span>
          <Segmented
            size="sm"
            label="Side"
            value={side}
            onChange={(v) => set('side', v === 'both' ? [] : [v])}
            options={[{ value: 'both', label: 'Both' }, ...valueOptions('side', team).map((o) => ({ value: o.value, label: o.label }))]}
          />
          {TOGGLE_KEYS.map((key) => (
            <FilterRow key={key} label={KEY_LABEL[key]}>
              <ToggleSegments
                size="sm"
                label={KEY_LABEL[key]}
                values={tokenValues(tokens, key)}
                onChange={(v) => set(key, v)}
                options={valueOptions(key, team).map((o) => ({ value: o.value, label: o.short ?? o.label }))}
              />
            </FilterRow>
          ))}
        </div>
        {hasLineups && (
          <>
            <div className="filter-popover__sep" />
            <div className="filter-popover__grid">
              {POPUP_KEYS.map((key) => (
                <FilterRow key={key} label={KEY_LABEL[key]}>
                  <PopupButton
                    size="md"
                    value={tokenValues(tokens, key)[0] ?? ''}
                    onChange={(v) => set(key, v ? [v] : [])}
                    options={[{ value: '', label: 'Any' }, ...valueOptions(key, team, lineup).map((o) => ({ value: o.value, label: o.label }))]}
                  />
                </FilterRow>
              ))}
            </div>
          </>
        )}
        <div className="filter-popover__sep" />
        <div className="filter-popover__count">{anything ? `${room.visible.length} of ${total} plays` : `${total} plays`}</div>
      </div>
    </Popover>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="filter-popover__label">{label}</span>
      {children}
    </>
  )
}
