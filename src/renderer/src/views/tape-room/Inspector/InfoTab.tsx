import { api } from '../../../api'
import { playKind, playTypeLabel, prettyEnum } from '../../../format'
import { InspectorForm, InspectorSection } from '../../../shell/Inspector'
import { Button } from '../../../ui/Button'
import { secondsLabel } from '../../../ui/video/time'
import { ANGLE_ORDER, angleLabel, type Room } from '../model'
import { epaText, yardsText } from './PlaySummary'

const none = <span className="info-tab__none">—</span>
const val = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? none : String(v))

/** The Info tab (02 §6.7): the play's details, its clips, and the game. */
export function InfoTab({ room }: { room: Room }) {
  const p = room.current!
  const { game } = room
  const kind = playKind(p)
  const pass = kind === 'pass'
  const typeText = kind === 'pass' ? 'Pass' : kind === 'run' ? 'Run' : playTypeLabel(p.playType)
  const yards = yardsText(p.yardsGained)
  const look = [p.shotgun ? 'Shotgun' : null, p.noHuddle ? 'No huddle' : null].filter(Boolean).join(', ')
  const coverage = p.coverage ? `${prettyEnum(p.coverage)}${p.manZone ? ` (${prettyEnum(p.manZone)})` : ''}` : null
  const rows: [React.ReactNode, React.ReactNode][] = [
    ['Result', `${typeText}${yards ? `, ${yards.replace(/^\+/, '')}` : ''}`],
    ['EPA', p.epa === null ? none : epaText(p.epa)!.replace('EPA ', '')],
    ['Formation', p.formation ? prettyEnum(p.formation) : none],
    ['Offense personnel', val(p.offPersonnel)],
    ['Defense personnel', val(p.defPersonnel)],
    ['In the box', val(p.defendersInBox)],
    ...(pass ? ([['Pass rushers', val(p.passRushers)]] as [React.ReactNode, React.ReactNode][]) : []),
    ['Coverage', val(coverage)],
    ...(pass ? ([['Pressure', p.wasPressure === null ? none : p.wasPressure ? 'Yes' : 'No']] as [React.ReactNode, React.ReactNode][]) : []),
    ...(!p.formation && look ? ([['Look', look]] as [React.ReactNode, React.ReactNode][]) : []),
    ['Drive', p.drive === null ? none : [`Drive ${p.drive}`, p.driveResult].filter(Boolean).join(' · ')],
    ['Play ID', <span className="info-tab__mono selectable">{p.playId}</span>]
  ]
  const clips = [...room.currentClips].sort((a, b) => ANGLE_ORDER.indexOf(a.angle) - ANGLE_ORDER.indexOf(b.angle))
  const date = new Date(`${game.gameday}T12:00:00`)
  const dateText = Number.isNaN(date.getTime()) ? game.gameday : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const final =
    game.homeScore === null || game.awayScore === null
      ? none
      : game.homeScore >= game.awayScore
        ? `${game.homeTeam} ${game.homeScore}, ${game.awayTeam} ${game.awayScore}`
        : `${game.awayTeam} ${game.awayScore}, ${game.homeTeam} ${game.homeScore}`

  return (
    <div className="info-tab">
      <InspectorSection id="play" title="Play">
        <InspectorForm rows={rows} />
      </InspectorSection>
      <InspectorSection id="clips" title="Clips">
        {clips.length ? (
          <div className="info-clips">
            {clips.map((c) => (
              <div key={c.id} className="info-clips__row">
                <span className="info-clips__angle">{angleLabel(c.angle)}</span>
                <span className="info-clips__file">
                  <span className="info-tab__mono selectable">{c.fileName}</span>
                  <span className="info-clips__snap">{c.snapMs !== null ? `Snap at ${secondsLabel(c.snapMs / 1000)}` : 'No snap point · Set Snap Here (⇧B)'}</span>
                </span>
                <Button variant="borderless" size="sm" icon="folder-open" iconOnly label="Show in Finder" title="Show in Finder" onClick={() => void api.revealClip(c.path)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="info-clips__none">No clips matched to this play.</div>
        )}
        <div className="info-clips__fix">
          <Button variant="borderless" size="sm" icon="arrow-down-up" label="Fix Clip Match…" onClick={() => room.fixMatches(p.playId)} />
        </div>
      </InspectorSection>
      <InspectorSection id="game" title="Game">
        <InspectorForm
          rows={[
            ['Date', dateText],
            ['Final', final]
          ]}
        />
      </InspectorSection>
    </div>
  )
}
