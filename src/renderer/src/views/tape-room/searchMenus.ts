import type { FilterToken } from '@shared/playQuery'
import { type MenuItemSpec, openMenu } from '../../ui/Menu'
import type { SearchToken } from '../../ui/SearchField'
import {
  KEY_LABEL,
  type LineupOptions,
  setTokenValues,
  SINGLE_KEYS,
  TAPE_KEYS,
  type TapeKey,
  tokenValues,
  valueOptions
} from './filters'

export { buildSuggestions } from './filters'

/** Clicking a token: that key's values as checkbox (or radio) items, plus "Remove Filter". */
export function tokenMenu(
  tok: SearchToken,
  anchor: HTMLElement,
  team: string,
  tokens: readonly FilterToken[],
  lineup: LineupOptions,
  setTokens: (t: FilterToken[]) => void
) {
  if (!(TAPE_KEYS as string[]).includes(tok.key)) return
  const key = tok.key as TapeKey
  const have = tokenValues(tokens, key)
  const single = SINGLE_KEYS.has(key)
  const items: MenuItemSpec[] = [
    { kind: 'header', label: KEY_LABEL[key] },
    ...valueOptions(key, team, lineup).map(
      (o): MenuItemSpec => ({
        label: o.label,
        checked: have.includes(o.value),
        run: () => {
          if (single) return setTokens(setTokenValues(tokens, key, [o.value]))
          const next = have.includes(o.value) ? have.filter((v) => v !== o.value) : [...have, o.value]
          setTokens(setTokenValues(tokens, key, next))
        }
      })
    ),
    { kind: 'separator' },
    { label: 'Remove Filter', run: () => setTokens(setTokenValues(tokens, key, [])) }
  ]
  openMenu({ anchor, items, placement: 'below', minWidth: 200 })
}
