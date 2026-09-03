import type { Quest } from './data'
import { isTracked, questsOnMap, setCompleted, setTracked } from './questState'

/**
 * Sidebar quick panel: quests with objectives on the current map, each with a
 * track (★) and a check-off (✓) button. `onChange` re-renders the map layer,
 * the arrow, and this panel.
 */
export function renderQuestPanel(
  host: HTMLElement,
  quests: Quest[],
  mapNormalizedName: string,
  availableOnly: boolean,
  onChange: () => void
): void {
  host.innerHTML = ''
  const list = questsOnMap(quests, mapNormalizedName, availableOnly)
  console.warn(`[panel] ${list.length} open quests on ${mapNormalizedName}`)
  if (!list.length) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'No open quests on this map'
    host.appendChild(empty)
    return
  }
  const title = document.createElement('p')
  title.className = 'qq-title'
  title.textContent = `On this map (${list.length})`
  host.appendChild(title)

  for (const q of list) {
    const row = document.createElement('div')
    row.className = 'qq-row'
    row.classList.toggle('tracked', isTracked(q.id))

    const track = document.createElement('button')
    track.className = 'track-btn'
    track.type = 'button'
    track.title = 'Track this quest'
    track.textContent = isTracked(q.id) ? '★' : '☆'
    track.addEventListener('click', () => {
      setTracked(q.id, !isTracked(q.id))
      onChange()
    })

    const done = document.createElement('button')
    done.className = 'done-btn'
    done.type = 'button'
    done.title = 'Check off (mark completed)'
    done.textContent = '✓'
    done.addEventListener('click', () => {
      setCompleted(q.id, true)
      onChange()
    })

    const name = document.createElement('span')
    name.className = 'qq-name'
    name.textContent = q.name
    name.title = q.name

    const trader = document.createElement('small')
    trader.textContent = q.trader ?? ''

    row.append(track, done, name, trader)
    host.appendChild(row)
  }
}
