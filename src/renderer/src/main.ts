import './style.css'
import { loadBundledData, type BundledData, type MapData } from './data'
import { TarkovMap } from './map'
import { MarkerLayers, LAYER_DEFS, type LayerKey } from './markers'
import { PlayerLayer } from './player'
import { ObjectiveArrow } from './objectiveArrow'
import { renderQuestPanel } from './questPanel'
import { applyQuestEvents, loadQuestState } from './questState'
import { openQuestModal, openSettingsModal } from './ui'
import type { PlayerPosition, QuestLogEvent, RaidEvent } from '../../shared/types'

interface UiPrefs {
  selectedMap: string
  layers: Partial<Record<LayerKey, boolean>>
  faction: 'all' | 'pmc' | 'scav'
  availableOnly: boolean
  opacity: number
  follow: boolean
  sidebarCollapsed: boolean
}

const PREFS_KEY = 'uiPrefs.v1'

function loadPrefs(): UiPrefs {
  const defaults: UiPrefs = {
    selectedMap: 'customs',
    layers: {},
    faction: 'all',
    availableOnly: false,
    opacity: 70,
    follow: true,
    sidebarCollapsed: false
  }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

const prefs = loadPrefs()
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // non-fatal
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

let data: BundledData
let tmap: TarkovMap | null = null
let markers: MarkerLayers | null = null
let player: PlayerLayer | null = null
let arrow: ObjectiveArrow | null = null
let lastPosition: PlayerPosition | null = null

function findMap(normalizedName: string): MapData | undefined {
  return data.maps.find((m) => m.normalizedName === normalizedName)
}

function applyLayerVisibility(): void {
  if (!markers) return
  for (const def of LAYER_DEFS) {
    markers.setVisible(def.key, prefs.layers[def.key] ?? def.defaultOn)
  }
}

function refreshFloorSelect(): void {
  if (!tmap) return
  const sel = $<HTMLSelectElement>('floor-select')
  sel.innerHTML = ''
  for (const opt of tmap.floorOptions()) {
    const o = document.createElement('option')
    o.value = opt.key
    o.textContent = opt.name
    sel.appendChild(o)
  }
  sel.value = tmap.getActiveFloor()
}

function refreshArrow(): void {
  arrow?.update(tmap, lastPosition, markers?.questPoints() ?? [], markers?.extractPoints() ?? [])
}

function refreshQuestPanel(): void {
  if (!tmap) return
  renderQuestPanel(
    $('quest-quick-list'),
    data.quests,
    tmap.mapData.normalizedName,
    prefs.availableOnly,
    rebuildQuestMarkers
  )
}

let knownQuestIds: Set<string> = new Set()

function handleQuestEvents(events: QuestLogEvent[], source: string): void {
  if (!events.length) return
  const result = applyQuestEvents(events, knownQuestIds)
  rebuildQuestMarkers()
  const summary = `${result.tracked} tracked, ${result.completed} completed`
  $('status-quests').textContent = `quests ${source}: ${summary}`
  console.warn(
    `[quests] ${source} applied ${events.length} events -> ${summary} (${result.unknown} unknown)`
  )
}

export function rebuildQuestMarkers(): void {
  markers?.rebuildQuests(prefs.availableOnly)
  refreshArrow()
  refreshQuestPanel()
}

let switching = false

async function switchMap(normalizedName: string): Promise<void> {
  const mapData = findMap(normalizedName)
  if (!mapData || switching) return
  switching = true
  prefs.selectedMap = normalizedName
  savePrefs()

  tmap?.destroy()
  const container = $('map')
  container.innerHTML = ''
  try {
    tmap = await TarkovMap.create(container, mapData)
  } finally {
    switching = false
  }
  tmap.onFloorChanged = () => refreshFloorSelect()
  console.warn(`[app] switched to map: ${mapData.name}`)
  markers = new MarkerLayers(tmap, data.quests)
  markers.buildExtracts(mapData, prefs.faction)
  markers.rebuildQuests(prefs.availableOnly)
  applyLayerVisibility()
  player = new PlayerLayer(tmap)
  player.follow = document.body.classList.contains('mini-mode') ? true : prefs.follow
  lastPosition = null // stale position belongs to the previous raid/map
  arrow?.clear()
  refreshArrow()
  refreshQuestPanel()

  $<HTMLSelectElement>('map-select').value = normalizedName
  refreshFloorSelect()
  $('status-map').textContent = mapData.name
}

function buildLayerToggles(): void {
  const host = $('layer-toggles')
  host.innerHTML = ''
  for (const def of LAYER_DEFS) {
    const label = document.createElement('label')
    label.className = 'row'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = prefs.layers[def.key] ?? def.defaultOn
    cb.addEventListener('change', () => {
      prefs.layers[def.key] = cb.checked
      savePrefs()
      applyLayerVisibility()
    })
    const span = document.createElement('span')
    span.textContent = def.label
    label.append(cb, span)
    host.appendChild(label)
  }
  const follow = document.createElement('label')
  follow.className = 'row'
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = prefs.follow
  cb.addEventListener('change', () => {
    prefs.follow = cb.checked
    savePrefs()
    if (player) player.follow = cb.checked
  })
  const span = document.createElement('span')
  span.textContent = 'Follow player'
  follow.append(cb, span)
  host.appendChild(follow)
}

function applyOpacity(): void {
  document.documentElement.style.setProperty('--overlay-opacity', String(prefs.opacity / 100))
}

async function applyWindowMode(): Promise<void> {
  const state = await window.api.getWindowState()
  document.body.classList.toggle('overlay-mode', state.mode === 'overlay')
  document.body.classList.toggle('mini-mode', state.mode === 'mini')
  $('mode-normal').classList.toggle('active', state.mode === 'normal')
  $('mode-overlay').classList.toggle('active', state.mode === 'overlay')
  $('mode-mini').classList.toggle('active', state.mode === 'mini')
  $('mini-controls').hidden = state.mode !== 'mini'
  // The minimap always recenters on each screenshot regardless of the
  // follow-player preference.
  if (player) player.follow = state.mode === 'mini' ? true : prefs.follow
  if (state.mode === 'mini') {
    // small window: zoom the map out of any oversized fit
    tmap?.leaflet.invalidateSize()
  }
}

function setSidebarCollapsed(collapsed: boolean): void {
  prefs.sidebarCollapsed = collapsed
  savePrefs()
  $('sidebar').hidden = collapsed
  $('sidebar-open').hidden = !collapsed
}

function wireUi(): void {
  const mapSel = $<HTMLSelectElement>('map-select')
  for (const m of [...data.maps].sort((a, b) => a.name.localeCompare(b.name))) {
    const o = document.createElement('option')
    o.value = m.normalizedName
    o.textContent = m.name
    mapSel.appendChild(o)
  }
  mapSel.addEventListener('change', () => void switchMap(mapSel.value))

  $<HTMLSelectElement>('floor-select').addEventListener('change', (e) => {
    tmap?.setFloor((e.target as HTMLSelectElement).value)
  })

  const factionSel = $<HTMLSelectElement>('faction-select')
  factionSel.value = prefs.faction
  factionSel.addEventListener('change', () => {
    prefs.faction = factionSel.value as UiPrefs['faction']
    savePrefs()
    if (tmap && markers) markers.buildExtracts(tmap.mapData, prefs.faction)
    refreshArrow() // the nearest-extract entry follows the faction filter
  })

  buildLayerToggles()

  const availOnly = $<HTMLInputElement>('quests-available-only')
  availOnly.checked = prefs.availableOnly
  availOnly.addEventListener('change', () => {
    prefs.availableOnly = availOnly.checked
    savePrefs()
    rebuildQuestMarkers()
  })
  $('quests-expand').addEventListener('click', () => openQuestModal(data.quests, rebuildQuestMarkers))
  const syncBtn = $<HTMLButtonElement>('quests-sync')
  syncBtn.addEventListener('click', () => {
    syncBtn.disabled = true
    syncBtn.textContent = 'syncing…'
    void window.api
      .syncQuests()
      .then((events) => handleQuestEvents(events, 'synced'))
      .catch((err) => {
        console.error('Quest sync failed:', err)
        $('status-quests').textContent = 'quest sync failed'
      })
      .finally(() => {
        syncBtn.disabled = false
        syncBtn.textContent = 'sync from game logs'
      })
  })
  $('settings-expand').addEventListener('click', () => void openSettingsModal())

  $('mode-normal').addEventListener('click', () => void window.api.setWindowMode('normal'))
  $('mode-overlay').addEventListener('click', () => void window.api.setWindowMode('overlay'))
  $('mode-mini').addEventListener('click', () => void window.api.setWindowMode('mini'))
  $('mini-expand').addEventListener('click', () => void window.api.setWindowMode('normal'))
  const stepFloor = (dir: number): void => {
    if (!tmap) return
    const opts = tmap.floorOptions()
    const idx = opts.findIndex((o) => o.key === tmap!.getActiveFloor())
    const next = opts[(idx + dir + opts.length) % opts.length]
    tmap.setFloor(next.key)
  }
  $('mini-floor-up').addEventListener('click', () => stepFloor(1))
  $('mini-floor-down').addEventListener('click', () => stepFloor(-1))

  const slider = $<HTMLInputElement>('opacity-slider')
  slider.value = String(prefs.opacity)
  slider.addEventListener('input', () => {
    prefs.opacity = Number(slider.value)
    savePrefs()
    applyOpacity()
  })

  $('sidebar-collapse').addEventListener('click', () => setSidebarCollapsed(true))
  $('sidebar-open').addEventListener('click', () => setSidebarCollapsed(false))
  setSidebarCollapsed(prefs.sidebarCollapsed)

  void window.api.getSettings().then((s) => {
    $('hotkey-hint').textContent =
      `${s.hotkeyToggleOverlay}: show/hide · ${s.hotkeyToggleClickThrough}: click-through · ${s.hotkeyToggleMini}: mini map`
  })
}

function wireIpc(): void {
  window.api.onPlayerPosition((pos: PlayerPosition) => {
    console.warn(`[app] position ${pos.x}, ${pos.y}, ${pos.z} yaw ${pos.yaw.toFixed(1)}`)
    lastPosition = pos
    player?.update(pos)
    refreshArrow()
    const t = new Date(pos.timestamp).toLocaleTimeString()
    $('status-position').textContent =
      `${pos.x.toFixed(0)}, ${pos.z.toFixed(0)} (y ${pos.y.toFixed(1)}) @ ${t}`
  })
  window.api.onRaidEvent((event: RaidEvent) => {
    if (event.kind !== 'map-loading') return
    const match = data.maps.find((m) => m.scenePaths.includes(event.scenePath))
    if (match && match.normalizedName !== tmap?.mapData.normalizedName) {
      void switchMap(match.normalizedName).then(() => player?.clear())
    }
  })
  window.api.onClickThroughChanged((enabled: boolean) => {
    $('clickthrough-indicator').hidden = !enabled
    document.body.classList.toggle('click-through', enabled)
  })
  window.api.onQuestEvents((events: QuestLogEvent[]) => handleQuestEvents(events, 'live'))
  window.api.onLogWatcherStatus((status: string) => {
    $('status-logs').textContent =
      status === 'watching-logs' ? 'auto map detect: on' : 'auto map detect: logs not found'
  })
}

function showFatal(message: string): void {
  document.body.innerHTML = `<div class="fatal"><h1>Tarkov Overlay</h1><p>${message}</p></div>`
}

async function start(): Promise<void> {
  loadQuestState()
  try {
    data = await loadBundledData()
    knownQuestIds = new Set(data.quests.map((q) => q.id))
  } catch (err) {
    showFatal(
      `Map data not found (${String(err)}).<br>Run <code>npm run fetch-data</code> in the project folder, then restart.`
    )
    return
  }
  if (!data.maps.length) {
    showFatal('Map data is empty. Re-run <code>npm run fetch-data</code>.')
    return
  }
  arrow = new ObjectiveArrow($('objective-chip'))
  wireUi()
  wireIpc()
  applyOpacity()
  await applyWindowMode()
  const initial = findMap(prefs.selectedMap) ?? data.maps[0]
  await switchMap(initial.normalizedName)

  // Backfill quest progress from archived + live game logs on startup.
  const settings = await window.api.getSettings()
  if (settings.autoSyncQuests) {
    try {
      handleQuestEvents(await window.api.syncQuests(), 'synced')
    } catch (err) {
      console.error('Startup quest sync failed:', err)
    }
  }
}

void start()
