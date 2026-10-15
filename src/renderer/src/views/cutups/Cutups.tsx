import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '../../ui/EmptyState'
import { ListRow } from '../../ui/ListRow'
import { Icon } from '../../ui/Icon'
import { PlainCount } from '../../ui/Badge'
import * as adapters from '../../shell/adapters'
import type { CutupSummary } from '../../shell/adapters'
import { runCommand } from '../../shell/commands'
import { useDataEvent } from '../../shell/dataEvents'
import { links, navigate } from '../../shell/router'
import { LargeTitle, Loading, Screen } from '../../shell/Screen'
import { Toolbar } from '../../shell/Toolbar'

function useCutups() {
  const [list, setList] = useState<CutupSummary[] | null>(null)
  const load = useCallback(() => {
    adapters.cutups().then(setList, () => setList([]))
  }, [])
  useEffect(load, [load])
  useDataEvent('cutups', load)
  return list
}

/** Cut-ups index placeholder (03 §10.1 fills it in). */
export function Cutups() {
  const list = useCutups()
  return (
    <Screen name="cutups">
      <Toolbar title="Cut-ups" subtitle={list ? `${list.length} ${list.length === 1 ? 'cut-up' : 'cut-ups'}` : undefined} trailing={[{ kind: 'button', command: 'file.newCutup', icon: 'list-plus', label: 'New Cut-up' }]} />
      {!list ? (
        <Loading />
      ) : !list.length ? (
        <EmptyState
          icon="list-video"
          title="No cut-ups yet"
          body="Collect plays from any game into a cut-up, like “3rd-down pressures”, and replay them any time."
          primary={adapters.cutupsAvailable() ? { label: 'New Cut-up', run: () => runCommand('file.newCutup') } : undefined}
        />
      ) : (
        <>
          <LargeTitle>Cut-ups</LargeTitle>
          {list.map((c) => (
            <ListRow
              key={c.cutup.id}
              height={44}
              leading={<Icon name={c.cutup.kind === 'smart' ? 'list-filter' : 'list-video'} size={16} />}
              title={c.cutup.name}
              subtitle={`${c.playCount} plays · ${c.gameCount} games`}
              trailing={<PlainCount count={c.playCount} />}
              onClick={() => navigate(links.cutup(c.cutup.id))}
            />
          ))}
        </>
      )}
    </Screen>
  )
}

/** One cut-up placeholder (03 §10 fills in the player and the list). */
export function Cutup({ id }: { id: string }) {
  const list = useCutups()
  const c = list?.find((x) => x.cutup.id === id)
  return (
    <Screen name="cutup">
      <Toolbar title={c?.cutup.name ?? 'Cut-up'} subtitle={c ? `${c.playCount} plays · ${c.gameCount} games` : undefined} windowTitle={c?.cutup.name ?? 'Cut-up'} />
      {!list ? (
        <Loading />
      ) : !c ? (
        <EmptyState icon="list-video" title="This cut-up was deleted" body="Choose another cut-up in the sidebar." />
      ) : (
        <EmptyState
          icon="list-video"
          title={c.playCount ? `${c.playCount} plays` : 'No plays yet'}
          body={c.playCount ? 'The cut-up player arrives with the cut-ups screen.' : 'Drag plays onto this cut-up in the sidebar, or press ⌘D in the tape room.'}
        />
      )}
    </Screen>
  )
}
