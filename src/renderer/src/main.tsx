import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/opsz.css'
import './styles/index.css'
import { App } from './App'

// Platform attributes before the first paint (01 §2.10).
const initial = window.shell?.initial ?? { platform: 'darwin', vibrancy: false, reduceTransparency: false, fullScreen: false, windowKind: 'main' }
const html = document.documentElement
html.dataset.platform = initial.platform
html.dataset.vibrancy = initial.vibrancy && initial.windowKind === 'main' ? 'on' : 'off'
html.dataset.reduceTransparency = String(initial.reduceTransparency)
html.dataset.windowFocused = String(document.hasFocus())
html.dataset.fullscreen = String(initial.fullScreen)
html.dataset.windowKind = initial.windowKind

// Notes save when their field loses focus, which closing, quitting or reloading never causes on its own.
window.addEventListener('beforeunload', () => (document.activeElement as HTMLElement | null)?.blur())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
