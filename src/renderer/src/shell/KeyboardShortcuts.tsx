import { useEffect, useMemo, useRef, useState } from 'react'
import { acceleratorGlyphs, COMMANDS, type CommandDef } from '@shared/commands'
import { Keycap } from '../ui/Keycap'
import { SearchField } from '../ui/SearchField'
import { Sheet } from '../ui/Sheet'

/** Keyboard Shortcuts sheet (01 §6.25), generated from COMMANDS; replaces v1's Hotkeys modal. */

interface Row {
  label: string
  keys: string[]
}

interface Group {
  title: string
  tape?: boolean
  rows: Row[]
  footnote?: string
}

/** One row per action: a second key for the same action joins the first row ("= or +"). */
function merged(rows: Row[]): Row[] {
  const out: Row[] = []
  for (const r of rows) {
    const same = out.find((o) => o.label === r.label)
    if (same) same.keys = [...same.keys, 'or', ...r.keys]
    else out.push({ ...r, keys: [...r.keys] })
  }
  return out
}

const rowOf = (c: CommandDef): Row => ({ label: c.label.replace(/…$/, ''), keys: [acceleratorGlyphs(c.accelerator)] })
const pick = (pred: (c: CommandDef) => boolean) => COMMANDS.filter((c) => c.accelerator && pred(c)).map(rowOf)

function groups(): Group[] {
  return [
    {
      title: 'Navigation',
      rows: [...pick((c) => c.menu === 'go'), ...pick((c) => c.id === 'edit.find')]
    },
    {
      title: 'Window',
      rows: pick((c) => ['view', 'app', 'window', 'help', 'file', 'edit'].includes(c.menu) && c.id !== 'edit.find' && !c.plain && c.id !== 'view.section')
    },
    {
      title: 'Playback',
      tape: true,
      rows: [...pick((c) => c.menu === 'playback'), { label: 'Next Play', keys: ['↩'] }]
    },
    {
      title: 'Grading',
      tape: true,
      rows: [...pick((c) => c.menu === 'grade' && c.id.startsWith('grade.') && c.id !== 'grade.toggleTag'), { label: 'Plus', keys: ['+'] }, { label: 'Select Player 1–9', keys: ['1', '…', '9'] }],
      footnote:
        'Grading a player moves to the next one, so a play goes: watch, then = / 0 / − down the list, then ↓. Turn on Auto-Advance to move to the next play after the last player. Mark Critical (!) or tags before the grade, since the grade moves on.'
    },
    {
      title: 'Tags',
      tape: true,
      rows: [{ label: 'Toggle the selected player’s tags 1–10', keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'] }]
    },
    {
      title: 'Drawing',
      tape: true,
      rows: [...pick((c) => c.id.startsWith('draw.')), { label: 'Choose a tool (while drawing)', keys: ['1', '…', '8'] }]
    },
    {
      title: 'Lists and tables',
      rows: [
        { label: 'Move the selection', keys: ['↑', '↓'] },
        { label: 'Open', keys: ['↩'] },
        { label: 'Preview a play', keys: ['Space'] },
        { label: 'Remove from Cut-up', keys: ['⌫'] },
        { label: 'Jump to a row', keys: ['Type its name'] }
      ]
    }
  ]
}

export function KeyboardShortcuts({ filter, onClose }: { filter?: string; onClose: () => void }) {
  const [q, setQ] = useState('')
  const all = useMemo(groups, [])
  const body = useRef<HTMLDivElement>(null)
  const needle = q.trim().toLowerCase()
  const shown = all
    .map((g) => ({ ...g, rows: merged(g.rows) }))
    .map((g) => ({ ...g, rows: needle ? g.rows.filter((r) => r.label.toLowerCase().includes(needle) || g.title.toLowerCase().includes(needle)) : g.rows }))
    .filter((g) => g.rows.length)
  useEffect(() => {
    if (filter === 'tape') body.current?.querySelector('[data-tape]')?.scrollIntoView({ block: 'start' })
  }, [filter])
  return (
    <Sheet
      title="Keyboard Shortcuts"
      size="L"
      onCancel={onClose}
      cancelLabel={null}
      primary={{ label: 'Done', run: onClose }}
      accessory={<SearchField size="md" width={200} value={q} onChange={setQ} placeholder="Search shortcuts" />}
      test="keyboard-shortcuts"
    >
      <div ref={body} className="shortcuts">
        {shown.map((g) => (
          <section key={g.title} className="shortcuts__group" data-tape={g.tape && filter === 'tape' ? true : undefined}>
            <h3 className="shortcuts__title">{g.title}</h3>
            {g.rows.map((r, i) => (
              <div key={i} className="shortcuts__row">
                <span className="shortcuts__label">{r.label}</span>
                <span className="shortcuts__keys">
                  {r.keys.map((k, j) => (k === '…' || k === 'or' ? <span key={j} className="c-label-3">{k}</span> : <Keycap key={j} small>{k}</Keycap>))}
                </span>
              </div>
            ))}
            {g.footnote && <p className="shortcuts__footnote">{g.footnote}</p>}
          </section>
        ))}
      </div>
    </Sheet>
  )
}
