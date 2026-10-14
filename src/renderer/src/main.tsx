import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Notes save when their field loses focus, which closing, quitting or reloading never causes on its own.
window.addEventListener('beforeunload', () => (document.activeElement as HTMLElement | null)?.blur())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
