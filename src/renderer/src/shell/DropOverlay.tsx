import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'

/**
 * Finder drops onto the window (01 §1.4.5): a full-window overlay while files are over it; on drop, the Import Film
 * sheet opens with the dropped paths. The document never lets a drop navigate.
 */
export function DropOverlay({ onDrop }: { onDrop: (paths: string[]) => void }) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop
  useEffect(() => {
    const isFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth.current++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    }
    const overDoc = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer && isFiles(e)) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((f) => window.shell.pathForFile(f)).filter(Boolean)
      if (paths.length) dropRef.current(paths)
    }
    document.addEventListener('dragenter', enter)
    document.addEventListener('dragleave', leave)
    document.addEventListener('dragover', overDoc)
    document.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('dragenter', enter)
      document.removeEventListener('dragleave', leave)
      document.removeEventListener('dragover', overDoc)
      document.removeEventListener('drop', drop)
    }
  }, [])
  if (!over) return null
  return (
    <div className="drop-overlay">
      <div className="drop-overlay__panel">
        <Icon name="folder-input" size={48} className="drop-overlay__icon" />
        <div className="drop-overlay__title">Import Film</div>
        <div className="drop-overlay__body">Drop a game’s clips, or the folder they’re in.</div>
      </div>
    </div>
  )
}
