import { useState } from 'react'
import appIcon from '../../../../build/icon.png'
import { Button } from '../ui/Button'
import { Icon, type IconName } from '../ui/Icon'
import { useLayer } from '../ui/keyboard'

/** First-run welcome (01 §8.1). Nothing downloads until the user asks on Home. */

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'clapperboard',
    title: 'Your film, matched to every snap',
    body: 'Drop a folder of All-22 clips on the window. Each clip lines up with its play from the NFL play-by-play, sideline and end zone together.'
  },
  {
    icon: 'keyboard',
    title: 'Grade at the speed of the tape',
    body: 'Grade every player +, 0 or − from the keyboard, tag what you saw, and draw on the frame.'
  },
  {
    icon: 'chart-line',
    title: 'See who’s really winning',
    body: 'Your grades roll up into player trends, unit grades, matchups and leaderboards.'
  }
]

export function Welcome({ onContinue }: { onContinue: () => void }) {
  const [closing, setClosing] = useState(false)
  const done = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onContinue, 200)
  }
  useLayer(true, {
    kind: 'welcome',
    close: done,
    onKey: (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        done()
        return true
      }
      return e.key === 'Tab' ? false : true
    }
  })
  return (
    <div className="welcome-backdrop" data-state={closing ? 'closing' : undefined}>
      <div className="welcome" data-test="welcome" role="dialog" aria-modal aria-labelledby="welcome-title">
        <img className="welcome__icon" src={appIcon} width={96} height={96} alt="" draggable={false} />
        <h1 id="welcome-title" className="welcome__title">
          Welcome to All-22 Watcher
        </h1>
        <div className="welcome__features">
          {FEATURES.map((f) => (
            <div key={f.icon} className="welcome__feature">
              <Icon name={f.icon} size={32} className="welcome__feature-icon" />
              <div>
                <div className="welcome__feature-title">{f.title}</div>
                <div className="welcome__feature-body">{f.body}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="welcome__footnote">Schedules, plays and rosters come from nflverse’s free public data and are stored on this Mac.</p>
        <Button variant="primary" size="lg" label="Continue" onClick={done} test="welcome-continue" className="welcome__continue" autoFocus />
      </div>
    </div>
  )
}
