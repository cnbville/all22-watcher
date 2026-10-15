import { type ReactNode, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { type CommandId, COMMAND_BY_ID, commandTooltip } from '@shared/commands'
import type { IconName } from '@shared/icons'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { type MenuItemSpec, openMenu } from '../ui/Menu'
import { PulldownButton } from '../ui/PopupButton'
import { Spinner } from '../ui/Spinner'
import { SearchField, type SearchSuggestion, type SearchToken } from '../ui/SearchField'
import { runCommand, useCommandState } from './commands'
import { back, forward, go, setEntryTitle, useHistory } from './router'
import { toggleInspector, useUi } from './uiState'

/** The unified toolbar's slot API (01 §2.5): a screen renders one <Toolbar>; the shell draws it. */

export type ToolbarItem =
  | { kind: 'button'; command: CommandId; icon: IconName; label?: string; showLabel?: boolean; pressed?: boolean; priority?: number; test?: string }
  | { kind: 'pulldown'; icon: IconName; label: string; items: MenuItemSpec[] | (() => MenuItemSpec[]); priority?: number; test?: string }
  | { kind: 'custom'; node: ReactNode; width: number; priority?: number }
  | { kind: 'space' }

export interface ToolbarSearch {
  placeholder: string
  value: string
  onChange(value: string): void
  tokens?: SearchToken[]
  onTokensChange?(tokens: SearchToken[]): void
  suggest?(text: string): SearchSuggestion[]
  /** Home's search opens Quick Open instead of filtering. */
  onFocus?(): void
  test?: string
}

export interface ToolbarProps {
  title: string
  subtitle?: string
  collapsesLargeTitle?: boolean
  titleMenu?: () => MenuItemSpec[]
  center?: ReactNode
  trailing?: ToolbarItem[]
  search?: ToolbarSearch
  inspector?: boolean
  separator?: 'scroll' | 'always'
  windowTitle?: string
  /** A small spinner after the subtitle while the screen reloads (01 §8.3). */
  busy?: boolean
}

let current: { owner: symbol; props: ToolbarProps } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function useToolbarProps(): ToolbarProps | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current?.props ?? null
  )
}

/** Renders nothing in place; hands its parts to the shell's toolbar and sets the window title (01 §2.9). */
export function Toolbar(props: ToolbarProps) {
  const owner = useRef(Symbol('toolbar'))
  useLayoutEffect(() => {
    if (current && current.owner !== owner.current && import.meta.env.DEV) console.warn('A second <Toolbar> was mounted; the later one wins.')
    current = { owner: owner.current, props }
    notify()
  })
  useLayoutEffect(
    () => () => {
      if (current?.owner === owner.current) {
        current = null
        notify()
      }
    },
    []
  )
  const windowTitle = props.windowTitle ?? props.title
  useEffect(() => {
    document.title = windowTitle
    setEntryTitle(props.title)
  }, [windowTitle, props.title])
  return null
}

let searchInput: HTMLInputElement | null = null
/** ⌘F: focuses the screen's search field. Returns false when the screen has none (falls back to Quick Open). */
export function focusToolbarSearch(): boolean {
  if (!searchInput || !current?.props.search || current.props.search.onFocus) return false
  searchInput.focus()
  searchInput.select()
  return true
}

function HistoryButton({ dir }: { dir: 'back' | 'forward' }) {
  const h = useHistory()
  const enabled = dir === 'back' ? h.canGoBack : h.canGoForward
  const ref = useRef<HTMLButtonElement>(null)
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const showHistory = () => {
    if (!ref.current || !enabled) return
    const idx = dir === 'back' ? [...Array(h.index).keys()].reverse() : [...Array(h.entries.length - h.index - 1).keys()].map((i) => h.index + 1 + i)
    const items: MenuItemSpec[] = idx.slice(0, 10).map((i) => ({ label: h.entries[i].title || h.entries[i].route, run: () => go(i) }))
    openMenu({ anchor: ref.current, items, placement: 'below', minWidth: 200 })
  }
  const id: CommandId = dir === 'back' ? 'go.back' : 'go.forward'
  return (
    <Button
      ref={ref}
      variant="toolbar"
      size="toolbar"
      iconOnly
      icon={dir === 'back' ? 'chevron-left' : 'chevron-right'}
      label={COMMAND_BY_ID[id].label}
      title={commandTooltip(id)}
      disabled={!enabled}
      test={dir === 'back' ? 'toolbar-back' : 'toolbar-forward'}
      onPointerDown={() => {
        held.current = false
        hold.current = setTimeout(() => {
          held.current = true
          showHistory()
        }, 500)
      }}
      onPointerUp={() => hold.current && clearTimeout(hold.current)}
      onClick={() => {
        if (held.current) return
        if (dir === 'back') back()
        else forward()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        showHistory()
      }}
    />
  )
}

function CommandButton({ item }: { item: Extract<ToolbarItem, { kind: 'button' }> }) {
  const state = useCommandState(item.command)
  const def = COMMAND_BY_ID[item.command]
  const label = item.label ?? state.label ?? def.label.replace(/…$/, '')
  return (
    <Button
      variant="toolbar"
      size="toolbar"
      icon={item.icon}
      iconOnly={!item.showLabel}
      label={label}
      title={commandTooltip(item.command, label)}
      pressed={item.pressed ?? (def.type === 'checkbox' ? !!state.checked : undefined)}
      disabled={!state.enabled}
      test={item.test}
      onClick={() => runCommand(item.command)}
    />
  )
}

function TrailingItem({ item }: { item: ToolbarItem }) {
  switch (item.kind) {
    case 'button':
      return <CommandButton item={item} />
    case 'pulldown':
      return <PulldownButton variant="toolbar" size="toolbar" iconOnly icon={item.icon} label={item.label} items={item.items} test={item.test} />
    case 'custom':
      return <div style={{ width: item.width, display: 'flex' }}>{item.node}</div>
    case 'space':
      return <span className="shell-toolbar__space" />
  }
}

/** Over 5 trailing controls before the search field, the lowest-priority ones move into "More" (01 §2.4 rule 3). */
function withOverflow(items: ToolbarItem[]): ToolbarItem[] {
  const controls = items.filter((i): i is Exclude<ToolbarItem, { kind: 'space' }> => i.kind !== 'space')
  if (controls.length <= 5) return items
  const ranked = controls
    .map((item, i) => ({ item, i, p: (item as { priority?: number }).priority ?? 0 }))
    .sort((a, b) => a.p - b.p || b.i - a.i)
  const moved = new Set<ToolbarItem>(ranked.slice(0, controls.length - 4).map((r) => r.item))
  const more: MenuItemSpec[] = []
  for (const item of controls) {
    if (!moved.has(item)) continue
    if (item.kind === 'button') {
      const def = COMMAND_BY_ID[item.command]
      more.push({ label: item.label ?? def.label, icon: item.icon, run: () => runCommand(item.command) })
    } else if (item.kind === 'pulldown') {
      more.push({ kind: 'submenu', label: item.label, icon: item.icon, items: typeof item.items === 'function' ? item.items() : item.items })
    }
  }
  const kept = items.filter((i) => !moved.has(i))
  return [...kept, { kind: 'pulldown', icon: 'ellipsis', label: 'More', items: more }]
}

/** The shell's toolbar (01 §2.4). */
export function ShellToolbar() {
  const props = useToolbarProps()
  const ui = useUi()
  const titleRef = useRef<HTMLButtonElement>(null)
  const inspectorState = useCommandState('view.inspector')
  const hideTitle = !!props?.collapsesLargeTitle && ui.largeTitleVisible
  const separator = props?.separator === 'always' || ui.scrolled
  const trailing = withOverflow(props?.trailing ?? [])
  const titleBlock = props && (
    <>
      <span className="shell-toolbar__title-text">
        {props.title}
        {props.titleMenu && <Icon name="chevron-down" size={10} className="shell-toolbar__title-chevron" />}
      </span>
      {props.subtitle && (
        <span className="shell-toolbar__subtitle">
          {props.subtitle}
          {props.busy && <Spinner size={12} />}
        </span>
      )}
    </>
  )
  return (
    <header className="shell-toolbar" data-test="toolbar" data-separator={separator ? 'on' : undefined} onDoubleClick={onToolbarDoubleClick}>
      <div className="shell-toolbar__leading">
        <div className="shell-toolbar__history">
          <HistoryButton dir="back" />
          <HistoryButton dir="forward" />
        </div>
        {props &&
          (props.titleMenu ? (
            <button
              ref={titleRef}
              type="button"
              className="shell-toolbar__title"
              data-menu
              data-hidden={hideTitle ? true : undefined}
              onMouseDown={(e) => {
                e.preventDefault()
                if (titleRef.current) openMenu({ anchor: titleRef.current, items: props.titleMenu!(), placement: 'below', minWidth: 220 })
              }}
            >
              {titleBlock}
            </button>
          ) : (
            <div className="shell-toolbar__title" data-hidden={hideTitle ? true : undefined}>
              {titleBlock}
            </div>
          ))}
      </div>
      <div className="shell-toolbar__center">{props?.center}</div>
      <div className="shell-toolbar__trailing">
        {trailing.map((item, i) => (
          <TrailingItem key={i} item={item} />
        ))}
        {props?.search && (
          <SearchField
            key={ui.screen}
            ref={(el) => {
              searchInput = el
            }}
            size="toolbar"
            placeholder={props.search.placeholder}
            value={props.search.value}
            onChange={props.search.onChange}
            tokens={props.search.tokens}
            onTokensChange={props.search.onTokensChange}
            suggest={props.search.suggest}
            onFocus={props.search.onFocus}
            test={props.search.test}
          />
        )}
        {props?.inspector && (
          <Button
            variant="toolbar"
            size="toolbar"
            iconOnly
            icon="panel-right"
            label={inspectorState.label ?? 'Inspector'}
            title={commandTooltip('view.inspector', ui.inspectorVisible ? 'Hide Inspector' : 'Show Inspector')}
            pressed={ui.inspectorVisible}
            onClick={toggleInspector}
          />
        )}
      </div>
    </header>
  )
}

/** Double-click on an empty part of the toolbar zooms the window (01 §2.3); macOS does this itself for drag regions. */
function onToolbarDoubleClick(e: React.MouseEvent) {
  if (window.shell?.initial.platform === 'darwin') return
  const t = e.target as HTMLElement
  if (t.closest('button, input, a, [role=button], [role=tab], [role=radio], .segmented, .popup-button, .search-field')) return
  window.shell?.zoomWindow()
}
