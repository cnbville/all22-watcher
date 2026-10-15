import { acceleratorGlyphs } from '@shared/commands'

/** A key as macOS draws it in help: one cap per combo ("⌘K"), one per key in a sequence (spec 01 §6.30). */
export function Keycap({ children, small }: { children: string; small?: boolean }) {
  return <kbd className={`keycap${small ? ' keycap--sm' : ''}`}>{children}</kbd>
}

/** Renders an Electron accelerator ('Shift+CmdOrCtrl+E') as one keycap. */
export function Shortcut({ accelerator, small }: { accelerator: string; small?: boolean }) {
  return <Keycap small={small}>{acceleratorGlyphs(accelerator)}</Keycap>
}
