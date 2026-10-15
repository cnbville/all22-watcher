import type { Settings } from '@shared/types'
import { SPEEDS } from '../../components/VideoStage'
import { Button } from '../../ui/Button'
import { FormGroup, FormRow } from '../../ui/GroupedForm'
import { PopupButton } from '../../ui/PopupButton'
import { Switch } from '../../ui/Switch'
import { saveSettings, useSettings } from '../../shell/store'
import { Loading } from '../../shell/Screen'

/** General: tape room playback defaults (v1 Settings › Tape room). Changes apply immediately. */
export function GeneralPane() {
  const s = useSettings()
  if (!s) return <Loading />
  const extra = s as Settings & { startAtSnap?: boolean }
  return (
    <>
      <FormGroup title="Tape Room">
        <FormRow label="Auto-Advance" description="Go to the next play after grading the last player, or when a clip ends with Loop off.">
          <Switch checked={s.autoAdvance} onChange={(v) => void saveSettings({ autoAdvance: v })} label="Auto-Advance" test="setting-auto-advance" />
        </FormRow>
        {'startAtSnap' in extra && (
          <FormRow label="Start clips at the snap" description="Replays, reels and exports begin at each clip’s snap point.">
            <Switch checked={!!extra.startAtSnap} onChange={(v) => void saveSettings({ startAtSnap: v } as Partial<Settings>)} label="Start clips at the snap" />
          </FormRow>
        )}
        <FormRow label="Default speed">
          <PopupButton
            value={s.defaultSpeed}
            options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))}
            onChange={(v) => void saveSettings({ defaultSpeed: v })}
            width={96}
            test="setting-default-speed"
          />
        </FormRow>
      </FormGroup>
      <FormGroup title="Welcome">
        <FormRow label="Show the welcome window again" description="It opens over the main window.">
          <Button label="Show Welcome" onClick={() => void saveSettings({ welcomeSeen: false })} />
        </FormRow>
      </FormGroup>
    </>
  )
}
