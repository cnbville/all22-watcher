import { useEffect, useState } from 'react'
import { onAddToCutupRequest, onExportVideoRequest, registerCutupWriters, type AddToCutupRequest, type ExportSheetRequest } from './shared/requests'
import { AddToCutupPopover, anchorRect } from './cutups/AddToCutup'
import { addPlaysTo, newCutupWith, useRulesSheet } from './cutups/actions'
import { RulesSheet } from './cutups/RulesSheet'
import { ExportSheet } from './export/ExportSheet'
import { useExportTracking } from './export/exportModel'
import './cutups/sheets.css'
import './export/export.css'

/**
 * The analysis features' window-wide parts, mounted once by the shell: the single owner of Add to Cut-up (03 §9.5)
 * and Export Video (03 §11) requests, and the rules sheet (03 §9.4). Every caller, the tape room included, goes
 * through `requestAddToCutup` / `requestExportVideo`.
 */
export function AnalysisHost() {
  const rules = useRulesSheet()
  const [add, setAdd] = useState<{ req: AddToCutupRequest; rect: DOMRect; n: number } | null>(null)
  const [exp, setExp] = useState<{ req: ExportSheetRequest; n: number } | null>(null)
  useExportTracking()

  useEffect(() => {
    const offAdd = onAddToCutupRequest((req) => setAdd((cur) => ({ req, rect: anchorRect(req.anchor), n: (cur?.n ?? 0) + 1 })))
    const offExport = onExportVideoRequest((req) => setExp((cur) => ({ req, n: (cur?.n ?? 0) + 1 })))
    const offWriters = registerCutupWriters({ addTo: addPlaysTo, newWith: (plays) => newCutupWith(plays) })
    return () => {
      offAdd()
      offExport()
      offWriters()
    }
  }, [])

  return (
    <>
      {rules && <RulesSheet key={JSON.stringify([rules.mode, rules.cutup?.id, rules.template])} req={rules} />}
      {exp && !rules && <ExportSheet key={exp.n} req={exp.req} onClose={() => setExp(null)} />}
      {add && <AddToCutupPopover key={add.n} plays={add.req.plays} anchor={add.rect} onClose={() => setAdd(null)} />}
    </>
  )
}
