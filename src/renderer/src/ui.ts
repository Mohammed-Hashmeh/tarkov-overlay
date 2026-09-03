import type { Quest } from './data'
import { isAvailable, isCompleted, isTracked, setCompleted, setTracked } from './questState'

function modalShell(title: string): { root: HTMLElement; body: HTMLElement; close: () => void } {
  const root = document.getElementById('modal-root')!
  root.hidden = false
  root.innerHTML = ''
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  const box = document.createElement('div')
  box.className = 'modal-box'
  const header = document.createElement('header')
  const h = document.createElement('h2')
  h.textContent = title
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '✕'
  closeBtn.className = 'modal-close'
  header.append(h, closeBtn)
  const body = document.createElement('div')
  body.className = 'modal-body'
  box.append(header, body)
  backdrop.appendChild(box)
  root.appendChild(backdrop)
  const close = (): void => {
    root.hidden = true
    root.innerHTML = ''
  }
  closeBtn.addEventListener('click', close)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })
  return { root, body, close }
}

export function openQuestModal(quests: Quest[], onChange: () => void): void {
  const { body } = modalShell('Quest checklist')

  const search = document.createElement('input')
  search.type = 'search'
  search.placeholder = 'Filter quests…'
  search.className = 'quest-search'
  body.appendChild(search)

  const list = document.createElement('div')
  list.className = 'quest-list'
  body.appendChild(list)

  const byTrader = new Map<string, Quest[]>()
  for (const q of quests) {
    const trader = q.trader ?? 'Other'
    if (!byTrader.has(trader)) byTrader.set(trader, [])
    byTrader.get(trader)!.push(q)
  }

  const render = (): void => {
    const filter = search.value.toLowerCase()
    list.innerHTML = ''
    for (const [trader, tQuests] of byTrader) {
      const matching = tQuests
        .filter((q) => q.name.toLowerCase().includes(filter))
        .sort((a, b) => Number(isTracked(b.id)) - Number(isTracked(a.id)))
      if (!matching.length) continue
      const details = document.createElement('details')
      details.open = Boolean(filter)
      const summary = document.createElement('summary')
      const done = matching.filter((q) => isCompleted(q.id)).length
      summary.textContent = `${trader} (${done}/${matching.length})`
      details.appendChild(summary)
      for (const q of matching) {
        const row = document.createElement('label')
        row.className = 'quest-row'
        row.classList.toggle('tracked', isTracked(q.id))
        const track = document.createElement('button')
        track.className = 'track-btn'
        track.type = 'button'
        track.title = 'Track this quest (map shows only tracked quests)'
        track.textContent = isTracked(q.id) ? '★' : '☆'
        track.addEventListener('click', (e) => {
          e.preventDefault() // don't toggle the row's checkbox
          const next = !isTracked(q.id)
          setTracked(q.id, next)
          track.textContent = next ? '★' : '☆'
          row.classList.toggle('tracked', next)
          onChange()
        })
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = isCompleted(q.id)
        cb.addEventListener('change', () => {
          setCompleted(q.id, cb.checked)
          onChange()
          const doneNow = matching.filter((qq) => isCompleted(qq.id)).length
          summary.textContent = `${trader} (${doneNow}/${matching.length})`
          row.classList.toggle('done', cb.checked)
          if (cb.checked) {
            track.textContent = '☆' // completing untracks
            row.classList.remove('tracked')
          }
        })
        const name = document.createElement('span')
        name.textContent = q.name
        row.classList.toggle('done', cb.checked)
        if (!isAvailable(q) && !isCompleted(q.id)) row.classList.add('locked')
        const meta = document.createElement('small')
        const mapNames = new Set<string>()
        for (const o of q.objectives) for (const mk of o.markers ?? []) mapNames.add(mk.map)
        meta.textContent = [
          q.minPlayerLevel ? `lvl ${q.minPlayerLevel}` : '',
          q.kappaRequired ? 'kappa' : '',
          [...mapNames].join(', ')
        ]
          .filter(Boolean)
          .join(' · ')
        row.append(track, cb, name, meta)
        details.appendChild(row)
      }
      list.appendChild(details)
    }
  }
  search.addEventListener('input', render)
  render()
}

export async function openSettingsModal(): Promise<void> {
  const settings = await window.api.getSettings()
  const { body, close } = modalShell('Settings')

  const form = document.createElement('div')
  form.className = 'settings-form'

  const field = (label: string, value: string, placeholder = ''): HTMLInputElement => {
    const wrap = document.createElement('label')
    wrap.className = 'settings-field'
    const span = document.createElement('span')
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.placeholder = placeholder
    wrap.append(span, input)
    form.appendChild(wrap)
    return input
  }

  const screenshots = field('Screenshots folder', settings.screenshotsPath)
  const logs = field('EFT Logs folder (empty = auto-detect)', settings.logsPath, 'auto-detect')
  const hotkeyOverlay = field('Hotkey: show/hide overlay', settings.hotkeyToggleOverlay)
  const hotkeyClick = field('Hotkey: toggle click-through', settings.hotkeyToggleClickThrough)
  const hotkeyMini = field('Hotkey: toggle mini map', settings.hotkeyToggleMini)

  const checkbox = (label: string, checked: boolean): HTMLInputElement => {
    const wrap = document.createElement('label')
    wrap.className = 'row'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = checked
    const span = document.createElement('span')
    span.textContent = label
    wrap.append(cb, span)
    form.appendChild(wrap)
    return cb
  }

  const delCb = checkbox('Delete screenshots after reading position', settings.deleteScreenshots)
  const syncCb = checkbox('Auto-sync quests from game logs', settings.autoSyncQuests)
  const archiveCb = checkbox('Archive game logs (keeps quest history)', settings.archiveLogs)

  const save = document.createElement('button')
  save.textContent = 'Save'
  save.className = 'primary'
  save.addEventListener('click', () => {
    void window.api
      .saveSettings({
        screenshotsPath: screenshots.value.trim(),
        logsPath: logs.value.trim(),
        hotkeyToggleOverlay: hotkeyOverlay.value.trim() || 'F9',
        hotkeyToggleClickThrough: hotkeyClick.value.trim() || 'F10',
        hotkeyToggleMini: hotkeyMini.value.trim() || 'F8',
        deleteScreenshots: delCb.checked,
        autoSyncQuests: syncCb.checked,
        archiveLogs: archiveCb.checked
      })
      .then(close)
  })
  form.appendChild(save)
  body.appendChild(form)
}
