import { SPEEDS } from '../../components/VideoStage'
import { Button } from '../../ui/Button'
import { FormGroup, FormRow } from '../../ui/GroupedForm'
import { PopupButton } from '../../ui/PopupButton'
import { Switch } from '../../ui/Switch'
import { saveSettings, useSettings } from '../../shell/store'
import { Loading } from '../../shell/Screen'

/**
 * General: how film plays everywhere (the tape room, reels, cut-ups and exports). Starting at the snap and the pre-roll
 * live here rather than in Grading because they change playback on every screen, not how plays are graded.
 */

const PRE_ROLLS = [0, 0.5, 1, 1.5, 2, 3]
const preRollLabel = (s: number) => (s === 0 ? 'None' : `${s} ${s === 1 ? 'second' : 'seconds'}`)

export function GeneralPane() {
  const s = useSettings()
  if (!s) return <Loading />
  return (
    <>
      <FormGroup title="Playback" footnote="Mark a clip’s snap in the tape room with Playback › Set Snap Here (⇧B).">
        <FormRow label="Start clips at the snap" description="Replays, reels, cut-ups and exported video begin at each clip’s marked snap.">
          <Switch checked={s.startAtSnap} onChange={(v) => void saveSettings({ startAtSnap: v })} label="Start clips at the snap" test="setting-start-at-snap" />
        </FormRow>
        <FormRow label="Pre-snap look" description="How much of the formation to show before the snap.">
          <PopupButton
            value={s.preRoll}
            disabled={!s.startAtSnap}
            options={PRE_ROLLS.map((v) => ({ value: v, label: preRollLabel(v) }))}
            onChange={(v) => void saveSettings({ preRoll: v })}
            width={120}
            test="setting-pre-roll"
          />
        </FormRow>
        <FormRow label="Default speed" description="The speed each clip starts at.">
          <PopupButton
            value={s.defaultSpeed}
            options={SPEEDS.map((v) => ({ value: v, label: v === 1 ? 'Normal (1×)' : `${v}×` }))}
            onChange={(v) => void saveSettings({ defaultSpeed: v })}
            width={120}
            test="setting-default-speed"
          />
        </FormRow>
      </FormGroup>
      <FormGroup title="Tape Room">
        <FormRow label="Auto-advance" description="Go to the next play after you grade the last player, or when a clip ends with Loop off.">
          <Switch checked={s.autoAdvance} onChange={(v) => void saveSettings({ autoAdvance: v })} label="Auto-advance" test="setting-auto-advance" />
        </FormRow>
      </FormGroup>
      <FormGroup title="Welcome">
        <FormRow label="Welcome window" description="The introduction shown the first time the app opens.">
          <Button size="sm" label="Show Again" onClick={() => void saveSettings({ welcomeSeen: false })} />
        </FormRow>
      </FormGroup>
    </>
  )
}
