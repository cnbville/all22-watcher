import { useEffect, useState } from 'react'
import { api } from '../../api'
import { FormGroup, FormRow } from '../../ui/GroupedForm'
import { Icon } from '../../ui/Icon'

/**
 * Film & Import: the frame with what v1 already knows (clip conversion). The watch folder, bundled ffmpeg status
 * and import defaults are filled in by the import work.
 */
export function FilmPane() {
  const [canConvert, setCanConvert] = useState<boolean | null>(null)
  useEffect(() => void api.canConvert().then(setCanConvert, () => setCanConvert(false)), [])
  return (
    <>
      <FormGroup title="Converting Clips" footnote="Clips in formats the player can’t open (MKV, AVI and others) are copied to MP4 when you import them. Your originals aren’t touched.">
        <FormRow
          label="ffmpeg"
          description={canConvert === null ? 'Checking…' : canConvert ? 'Ready to convert clips during import.' : 'Not found. Install ffmpeg (brew install ffmpeg) to convert clips here.'}
        >
          {canConvert !== null && <Icon name={canConvert ? 'circle-check' : 'circle-alert'} size={16} className={canConvert ? 'c-label-2' : 'c-danger'} />}
        </FormRow>
      </FormGroup>
      <FormGroup title="Importing" footnote="Drop a game’s clips, or the folder they’re in, anywhere on the main window to import them.">
        <FormRow label="Matching" description="Clips are matched to plays in filename order. Keep sideline and end zone clips in folders or names with “sideline”/“SL” and “end zone”/“EZ” so each angle is matched separately." />
      </FormGroup>
    </>
  )
}
