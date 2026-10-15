import { type Ref, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { type MenuItemSpec, openMenu } from './Menu'
import { Token } from './Token'

export interface SearchToken {
  key: string
  /** Shown in --label-3 before the value: "Down:" */
  keyLabel: string
  value: string
  label: string
}

export interface SearchSuggestion {
  section?: string
  token: SearchToken
  /** Runs instead of adding the token, and keeps the typed text ("Search descriptions for …"). */
  run?: () => void
  /** Shown after the token in the menu only: a count ("6"). */
  detail?: string
}

/**
 * Search field with optional filter tokens and suggestions (spec 01 §6.7–6.8). Typing filters live (debounced 120ms);
 * esc clears, a second esc blurs; ⌫ in an empty field selects then removes the last token.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  size = 'toolbar',
  width,
  tokens = [],
  onTokensChange,
  suggest,
  onFocus,
  onTokenClick,
  test,
  ref,
  autoFocus
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  size?: 'toolbar' | 'md'
  width?: number | string
  tokens?: SearchToken[]
  onTokensChange?: (t: SearchToken[]) => void
  suggest?: (text: string) => SearchSuggestion[]
  onFocus?: () => void
  /** A click on a token (the tape room opens that key's values in a menu under it). */
  onTokenClick?: (token: SearchToken, anchor: HTMLElement) => void
  test?: string
  ref?: Ref<HTMLInputElement>
  autoFocus?: boolean
}) {
  const [text, setText] = useState(value)
  const [selectedToken, setSelectedToken] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const closeMenu = useRef<(() => void) | null>(null)
  useEffect(() => setText(value), [value])

  const setRefs = (el: HTMLInputElement | null) => {
    input.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = el
  }

  const showSuggestions = (t: string) => {
    closeMenu.current?.()
    closeMenu.current = null
    if (!suggest || !t.trim() || !wrap.current) return
    const list = suggest(t)
    if (!list.length) return
    const items: MenuItemSpec[] = []
    let section: string | undefined
    for (const s of list) {
      if (s.section && s.section !== section) {
        section = s.section
        items.push({ kind: 'header', label: s.section })
      }
      items.push({
        label: `${[s.token.keyLabel, s.token.label].filter(Boolean).join(' ')}${s.detail ? ` · ${s.detail}` : ''}`,
        run: () => {
          if (s.run) {
            s.run()
            input.current?.focus()
            return
          }
          onTokensChange?.([...tokens, s.token])
          setText('')
          onChange('')
          input.current?.focus()
        }
      })
    }
    closeMenu.current = openMenu({ anchor: wrap.current, items, minWidth: Math.max(260, wrap.current.offsetWidth), keepFocus: true })
  }

  const change = (t: string) => {
    setText(t)
    setSelectedToken(null)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(t), 120)
    showSuggestions(t)
  }

  return (
    <div
      ref={wrap}
      className={`search-field search-field--${size}`}
      style={{ width }}
      data-test={test}
      onMouseDown={(e) => {
        if (e.target !== input.current) {
          e.preventDefault()
          input.current?.focus()
        }
      }}
    >
      <Icon name="search" size={14} className="search-field__glass" />
      {tokens.slice(0, 3).map((t, i) => (
        <Token
          key={`${t.key}:${t.value}`}
          keyLabel={t.keyLabel}
          label={t.label}
          selected={selectedToken === i}
          onClick={onTokenClick ? (el) => onTokenClick(t, el) : undefined}
          onRemove={() => onTokensChange?.(tokens.filter((_, j) => j !== i))}
        />
      ))}
      {tokens.length > 3 && <Token keyLabel="" label={`+${tokens.length - 3}`} />}
      <input
        ref={setRefs}
        className="search-field__input"
        value={text}
        placeholder={tokens.length ? '' : placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label={placeholder}
        onFocus={onFocus}
        onBlur={() => setSelectedToken(null)}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            if (text || tokens.length) {
              if (timer.current) clearTimeout(timer.current)
              setText('')
              onChange('')
            } else e.currentTarget.blur()
          } else if (e.key === 'Backspace' && !text && tokens.length) {
            e.preventDefault()
            if (selectedToken === null) setSelectedToken(tokens.length - 1)
            else {
              onTokensChange?.(tokens.filter((_, j) => j !== selectedToken))
              setSelectedToken(null)
            }
          } else if (e.key === 'Enter') {
            if (timer.current) clearTimeout(timer.current)
            onChange(text)
          }
        }}
      />
      {(text || tokens.length > 0) && (
        <button
          type="button"
          className="search-field__clear"
          aria-label="Clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setText('')
            onChange('')
            onTokensChange?.([])
          }}
        >
          <Icon name="circle-x" size={14} />
        </button>
      )}
    </div>
  )
}
