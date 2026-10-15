import './video.css'
import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * A short confirmation over the film for changes made with a key (02 §5.2), like the macOS volume HUD but small:
 * fades in, holds 900ms, fades out; a new toast replaces the current one.
 */

let current: { text: string; id: number } | null = null
let seq = 0
const listeners = new Set<() => void>()

export function viewerToast(text: string) {
  current = { text, id: ++seq }
  listeners.forEach((l) => l())
}

function useToast() {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current
  )
}

export function ViewerToast({ top }: { top: number }) {
  const toast = useToast()
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>('gone')
  useEffect(() => {
    if (!toast) return
    setPhase('in')
    const hold = setTimeout(() => setPhase('out'), 900 + 120)
    const gone = setTimeout(() => setPhase('gone'), 900 + 120 + 200)
    return () => {
      clearTimeout(hold)
      clearTimeout(gone)
    }
  }, [toast?.id])
  if (!toast || phase === 'gone') return null
  return (
    <div className="viewer-toast" role="status" data-test="viewer-toast" data-state={phase} style={{ top }}>
      {toast.text}
    </div>
  )
}
