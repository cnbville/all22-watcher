import { describe, expect, it } from 'vitest'
import { acceleratorGlyphs, bindingMatches, COMMAND_IDS, COMMANDS, EXCLUSIVE_BINDINGS, KEYMAP, type CommandId } from './commands'

const exclusive = (a: CommandId, b: CommandId) =>
  EXCLUSIVE_BINDINGS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

describe('command registry', () => {
  it('has exactly one COMMANDS entry per CommandId', () => {
    for (const id of COMMAND_IDS) expect(COMMANDS.filter((c) => c.id === id)).toHaveLength(1)
    expect(COMMANDS).toHaveLength(COMMAND_IDS.length)
  })

  it('never gives one accelerator to two commands that can be enabled at once', () => {
    const byAccel = new Map<string, CommandId[]>()
    for (const c of COMMANDS) {
      if (!c.accelerator) continue
      const key = c.accelerator.toLowerCase()
      byAccel.set(key, [...(byAccel.get(key) ?? []), c.id])
    }
    for (const [accel, ids] of byAccel) {
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          expect(exclusive(ids[i], ids[j]), `${accel}: ${ids[i]} and ${ids[j]}`).toBe(true)
        }
    }
  })

  it('marks exactly the accelerators without ⌘/⌃ as plain', () => {
    for (const c of COMMANDS) {
      if (!c.accelerator) {
        expect(c.plain, c.id).toBeFalsy()
        continue
      }
      const hasCommand = /(CmdOrCtrl|Cmd|Command|Ctrl|Control)\+/i.test(c.accelerator)
      expect(!!c.plain, c.id).toBe(!hasCommand)
    }
  })

  it('binds keys only to commands that exist', () => {
    const ids = new Set(COMMANDS.map((c) => c.id))
    for (const b of KEYMAP) expect(ids.has(b.command), b.command).toBe(true)
    for (const [a, b] of EXCLUSIVE_BINDINGS) expect(ids.has(a) && ids.has(b)).toBe(true)
  })

  it('matches keys like the tape room expects', () => {
    const key = (k: string, mods: Partial<{ shiftKey: boolean; altKey: boolean; code: string }> = {}) => ({
      key: k,
      code: mods.code ?? '',
      shiftKey: !!mods.shiftKey,
      altKey: !!mods.altKey
    })
    const first = (e: ReturnType<typeof key>) => KEYMAP.find((b) => bindingMatches(b, e))?.command
    expect(first(key(' '))).toBe('play.toggle')
    expect(first(key('B'))).toBe('play.toSnap') // Caps Lock
    expect(first(key('B', { shiftKey: true }))).toBe('play.setSnap')
    expect(first(key(')', { shiftKey: true, code: 'Digit0' }))).toBe('grade.fillZeros')
    expect(first(key('=', { shiftKey: true, code: 'Digit0' }))).toBe('grade.fillZeros')
    expect(first(key('!', { shiftKey: true }))).toBe('grade.critical')
    expect(first(key('ArrowDown', { altKey: true }))).toBe('play.nextUngraded')
    expect(first(key('ArrowLeft', { shiftKey: true }))).toBe('play.secondBack')
  })

  it('writes shortcuts with macOS glyphs', () => {
    expect(acceleratorGlyphs('Shift+CmdOrCtrl+E', true)).toBe('⇧⌘E')
    expect(acceleratorGlyphs('Ctrl+CmdOrCtrl+S', true)).toBe('⌃⌘S')
    expect(acceleratorGlyphs('Alt+Down', true)).toBe('⌥↓')
    expect(acceleratorGlyphs('-', true)).toBe('−')
    expect(acceleratorGlyphs('CmdOrCtrl+[', false)).toBe('Ctrl+[')
  })
})
