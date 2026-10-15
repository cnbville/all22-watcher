import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Icon, type IconName } from './Icon'
import { pushLayer } from './keyboard'

/** HTML menus for popup buttons, pull-downs, title menus and suggestions (spec 01 §6.20). */
export type MenuItemSpec =
  | { kind?: 'item'; label: string; icon?: IconName; shortcut?: string; checked?: boolean; disabled?: boolean; run(): void; test?: string }
  | { kind: 'header'; label: string }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; items: MenuItemSpec[]; disabled?: boolean; icon?: IconName }

export interface OpenMenuOptions {
  anchor: Element | DOMRect
  items: MenuItemSpec[]
  /** 'below' (pull-downs, 4px under the anchor) or 'checked' (popup buttons: the checked item sits over the anchor). */
  placement?: 'below' | 'checked' | 'above'
  align?: 'start' | 'end'
  minWidth?: number
  width?: number
  test?: string
  /** Leaves focus where it is (search suggestions). */
  keepFocus?: boolean
  onClose?: () => void
}

interface OpenMenu extends OpenMenuOptions {
  id: number
}

let current: OpenMenu | null = null
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let lastClosed: { anchor: Element | DOMRect; at: number } | null = null

/** Opens a menu and returns a function that closes it. Opening the same anchor right after closing it does nothing. */
export function openMenu(opts: OpenMenuOptions): () => void {
  if (lastClosed && lastClosed.anchor === opts.anchor && performance.now() - lastClosed.at < 250) return () => {}
  current?.onClose?.()
  const id = ++seq
  current = { ...opts, id }
  emit()
  return () => {
    if (current?.id === id) closeMenu()
  }
}

export function closeMenu() {
  if (!current) return
  const was = current
  current = null
  lastClosed = { anchor: was.anchor, at: performance.now() }
  emit()
  was.onClose?.()
}

const isItem = (it: MenuItemSpec): it is Extract<MenuItemSpec, { run(): void }> => it.kind === undefined || it.kind === 'item'
const selectable = (it: MenuItemSpec) => (isItem(it) || it.kind === 'submenu') && !it.disabled

const rectOf = (a: Element | DOMRect) => (a instanceof Element ? a.getBoundingClientRect() : a)

/** Renders the open menu. Mounted once per window by the shell. */
export function MenuHost() {
  const menu = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current
  )
  if (!menu) return null
  return <MenuPanel key={menu.id} menu={menu} />
}

function MenuPanel({ menu }: { menu: OpenMenu }) {
  const [active, setActive] = useState<number>(-1)
  const [sub, setSub] = useState<number | null>(null)
  const [subActive, setSubActive] = useState(-1)
  const [blink, setBlink] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' })
  const panel = useRef<HTMLDivElement>(null)
  const subPanel = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const items = menu.items

  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const a = rectOf(menu.anchor)
    const w = Math.max(menu.width ?? 0, menu.minWidth ?? 180, el.offsetWidth)
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = menu.align === 'end' ? a.right - w : a.left
    let top = a.bottom + 4
    if (menu.placement === 'checked') {
      const checked = el.querySelector<HTMLElement>('[aria-checked="true"]')
      top = a.top + (a.height - 22) / 2 - (checked ? checked.offsetTop : 4)
      left = a.left - 12
    } else if (menu.placement === 'above' || top + h > vh - 8) {
      if (a.top - 4 - h >= 8) top = a.top - 4 - h
    }
    left = Math.max(8, Math.min(left, vw - w - 8))
    top = Math.max(8, Math.min(top, vh - Math.min(h, vh - 16) - 8))
    setPos({ left, top, minWidth: w, maxHeight: vh - top - 8 })
  }, [menu])

  const choose = (it: MenuItemSpec) => {
    if (!isItem(it) || it.disabled) return
    // macOS blinks the chosen row once before the menu fades (01 §5.8).
    setBlink(true)
    setTimeout(() => setBlink(false), 60)
    setTimeout(() => {
      closeMenu()
      it.run()
    }, 120)
  }

  // Keyboard and outside clicks.
  useEffect(() => {
    const move = (list: MenuItemSpec[], from: number, dir: number) => {
      for (let i = 1; i <= list.length; i++) {
        const j = (from + dir * i + list.length * 2) % list.length
        if (selectable(list[j])) return j
      }
      return from
    }
    const pop = pushLayer({
      kind: 'menu',
      close: closeMenu,
      onKey: (e) => {
        const inSub = sub !== null && items[sub]?.kind === 'submenu'
        const list = inSub ? (items[sub!] as Extract<MenuItemSpec, { kind: 'submenu' }>).items : items
        const idx = inSub ? subActive : active
        const setIdx = inSub ? setSubActive : setActive
        switch (e.key) {
          case 'ArrowDown':
            setIdx(move(list, idx < 0 ? -1 : idx, 1))
            return true
          case 'ArrowUp':
            setIdx(move(list, idx < 0 ? list.length : idx, -1))
            return true
          case 'ArrowRight':
            if (!inSub && active >= 0 && items[active].kind === 'submenu') {
              setSub(active)
              setSubActive(move((items[active] as Extract<MenuItemSpec, { kind: 'submenu' }>).items, -1, 1))
              return true
            }
            return !menu.keepFocus
          case 'ArrowLeft':
            if (inSub) {
              setSub(null)
              return true
            }
            return !menu.keepFocus
          case 'Enter':
          case ' ':
            if (menu.keepFocus && e.key === ' ') return false
            if (idx >= 0) {
              const it = list[idx]
              if (it.kind === 'submenu') {
                setSub(idx)
                setSubActive(move(it.items, -1, 1))
              } else choose(it)
              return true
            }
            return !menu.keepFocus
          case 'Escape':
            if (inSub) setSub(null)
            else closeMenu()
            return true
        }
        if (menu.keepFocus) return false
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          const now = performance.now()
          typed.current = { text: (now - typed.current.at < 1000 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
          const j = list.findIndex((it) => selectable(it) && 'label' in it && it.label.toLowerCase().startsWith(typed.current.text))
          if (j >= 0) setIdx(j)
          return true
        }
        return true
      }
    })
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || subPanel.current?.contains(t)) return
      closeMenu()
    }
    const onBlur = () => closeMenu()
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      pop()
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [items, active, sub, subActive, menu.keepFocus])

  const subItem = sub !== null && items[sub]?.kind === 'submenu' ? (items[sub] as Extract<MenuItemSpec, { kind: 'submenu' }>) : null
  const [subPos, setSubPos] = useState<CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    if (sub === null || !panel.current || !subPanel.current) return
    const row = panel.current.querySelectorAll<HTMLElement>('.menu__row')[sub]
    if (!row) return
    const r = row.getBoundingClientRect()
    const w = subPanel.current.offsetWidth
    const h = subPanel.current.offsetHeight
    let left = r.right + 2
    if (left + w > window.innerWidth - 8) left = r.left - w - 2
    const top = Math.max(8, Math.min(r.top - 4, window.innerHeight - h - 8))
    setSubPos({ left, top })
  }, [sub])

  return (
    <>
      <MenuList
        ref={panel}
        items={items}
        active={active}
        blink={blink}
        style={pos}
        test={menu.test}
        onHover={(i) => {
          setActive(i)
          setSub(i >= 0 && items[i]?.kind === 'submenu' ? i : null)
          setSubActive(-1)
        }}
        onChoose={choose}
      />
      {subItem && (
        <MenuList ref={subPanel} items={subItem.items} active={subActive} blink={blink} style={subPos} onHover={setSubActive} onChoose={choose} />
      )}
    </>
  )
}

function MenuList({
  items,
  active,
  blink,
  style,
  test,
  onHover,
  onChoose,
  ref
}: {
  items: MenuItemSpec[]
  active: number
  blink: boolean
  style: CSSProperties
  test?: string
  onHover: (i: number) => void
  onChoose: (it: MenuItemSpec) => void
  ref: React.Ref<HTMLDivElement>
}) {
  const hasChecks = true
  return (
    <div ref={ref} className="menu" role="menu" style={style} data-test={test} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.kind === 'separator') return <div key={i} className="menu__separator" role="separator" />
        if (it.kind === 'header') return <div key={i} className="menu__header">{it.label}</div>
        const disabled = !!it.disabled
        const isSub = it.kind === 'submenu'
        const checked = isItem(it) ? it.checked : undefined
        const role = isSub ? 'menuitem' : checked !== undefined ? 'menuitemradio' : 'menuitem'
        return (
          <div
            key={i}
            className="menu__row"
            role={role}
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            aria-haspopup={isSub ? 'menu' : undefined}
            data-state={i === active && !disabled && !blink ? 'highlighted' : undefined}
            data-test={isItem(it) ? it.test : undefined}
            onMouseEnter={() => onHover(disabled ? -1 : i)}
            onMouseLeave={() => !isSub && onHover(-1)}
            onClick={() => !disabled && !isSub && onChoose(it)}
          >
            {hasChecks && <span className="menu__check">{checked && <Icon name="check" size={12} />}</span>}
            {'icon' in it && it.icon && <Icon name={it.icon} size={14} className="menu__icon" />}
            <span className="menu__label">{it.label}</span>
            {isItem(it) && it.shortcut && <span className="menu__shortcut">{it.shortcut}</span>}
            {isSub && <Icon name="chevron-right" size={10} className="menu__submenu" />}
          </div>
        )
      })}
    </div>
  )
}
