import L from 'leaflet'
import { gameToLatLng, type TarkovMap } from './map'
import type { MapData, Quest, Vec3 } from './data'
import { trackedCount, visibleQuests } from './questState'
import type { MapPoint } from './nearestObjective'

export type LayerKey =
  | 'extracts'
  | 'transits'
  | 'spawns'
  | 'bosses'
  | 'loot'
  | 'locks'
  | 'hazards'
  | 'switches'
  | 'quests'

export const LAYER_DEFS: { key: LayerKey; label: string; defaultOn: boolean }[] = [
  { key: 'extracts', label: 'Extracts', defaultOn: true },
  { key: 'transits', label: 'Transits', defaultOn: false },
  { key: 'spawns', label: 'Spawns', defaultOn: false },
  { key: 'bosses', label: 'Bosses', defaultOn: true },
  { key: 'loot', label: 'Loot containers', defaultOn: false },
  { key: 'locks', label: 'Locked doors', defaultOn: false },
  { key: 'hazards', label: 'Hazards', defaultOn: false },
  { key: 'switches', label: 'Switches', defaultOn: false },
  { key: 'quests', label: 'Quest objectives', defaultOn: true }
]

function icon(cls: string, glyph: string): L.DivIcon {
  return L.divIcon({
    className: `mk ${cls}`,
    html: `<span>${glyph}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12]
  })
}

const ICONS = {
  extractPmc: icon('mk-extract-pmc', '⬆'),
  extractScav: icon('mk-extract-scav', '⬆'),
  extractShared: icon('mk-extract-shared', '⬆'),
  transit: icon('mk-transit', '⇄'),
  spawn: icon('mk-spawn', '•'),
  boss: icon('mk-boss', '☠'),
  loot: icon('mk-loot', '▣'),
  lock: icon('mk-lock', '🔑'),
  hazard: icon('mk-hazard', '☢'),
  switch: icon('mk-switch', '⚡'),
  quest: icon('mk-quest', '!')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function marker(pos: Vec3, ic: L.DivIcon, popupHtml: string, label?: string): L.Marker {
  const m = L.marker(gameToLatLng(pos), { icon: ic })
  m.bindPopup(popupHtml, { maxWidth: 260 })
  if (label) {
    // Permanent name bubble; CSS hides .marker-label in overlay/mini modes.
    m.bindTooltip(label, {
      permanent: true,
      direction: 'top',
      offset: [0, -10],
      className: 'marker-label'
    })
  }
  return m
}

function outlinePolygon(outline: Vec3[], color: string): L.Polygon {
  return L.polygon(
    outline.map((p) => gameToLatLng(p)),
    { color, weight: 1.5, fillOpacity: 0.12, interactive: false }
  )
}

export class MarkerLayers {
  private groups = new Map<LayerKey, L.LayerGroup>()
  private tmap: TarkovMap
  private quests: Quest[]
  private currentQuestPoints: MapPoint[] = []
  private currentExtractPoints: MapPoint[] = []

  constructor(tmap: TarkovMap, quests: Quest[]) {
    this.tmap = tmap
    this.quests = quests
    for (const def of LAYER_DEFS) this.groups.set(def.key, L.layerGroup())
    this.build(tmap.mapData)
  }

  private group(key: LayerKey): L.LayerGroup {
    return this.groups.get(key)!
  }

  private build(m: MapData): void {
    this.buildExtracts(m, 'all')
    for (const t of m.transits ?? []) {
      this.group('transits').addLayer(
        marker(t.position, ICONS.transit, `<b>Transit</b><br>${esc(t.description ?? '')}`)
      )
    }
    for (const s of m.spawns ?? []) {
      const sides = (s.sides ?? []).join(', ')
      const cats = (s.categories ?? []).join(', ')
      this.group('spawns').addLayer(
        marker(s.position, ICONS.spawn, `<b>Spawn</b><br>${esc(sides)}<br>${esc(cats)}`)
      )
    }
    // Bosses have no reliable per-location positions in the API; show as a note
    // pinned to spawn zones when present via spawns categories instead. Boss
    // spawn *chance* info goes on boss-category spawn points.
    for (const s of m.spawns ?? []) {
      if ((s.categories ?? []).includes('boss')) {
        const bossList = (m.bosses ?? [])
          .map((b) => `${esc(b.name)} — ${Math.round(b.spawnChance * 100)}%`)
          .join('<br>')
        this.group('bosses').addLayer(
          marker(s.position, ICONS.boss, `<b>Boss spawn</b><br>${bossList || 'unknown'}`)
        )
      }
    }
    for (const c of m.lootContainers ?? []) {
      this.group('loot').addLayer(marker(c.position, ICONS.loot, `<b>${esc(c.name)}</b>`))
    }
    for (const lock of m.locks ?? []) {
      const key = lock.keyName ? `Key: ${esc(lock.keyName)}` : 'Unknown key'
      const power = lock.needsPower ? '<br>Needs power' : ''
      this.group('locks').addLayer(
        marker(lock.position, ICONS.lock, `<b>Locked ${esc(lock.lockType ?? 'door')}</b><br>${key}${power}`)
      )
    }
    for (const h of m.hazards ?? []) {
      this.group('hazards').addLayer(marker(h.position, ICONS.hazard, `<b>${esc(h.name ?? 'Hazard')}</b>`))
    }
    for (const sw of m.switches ?? []) {
      this.group('switches').addLayer(marker(sw.position, ICONS.switch, `<b>Switch</b><br>${esc(sw.name ?? '')}`))
    }
    this.rebuildQuests(false)
  }

  buildExtracts(m: MapData, faction: 'all' | 'pmc' | 'scav'): void {
    const g = this.group('extracts')
    g.clearLayers()
    this.currentExtractPoints = []
    let labelCount = 0
    for (const e of m.extracts ?? []) {
      if (faction !== 'all' && e.faction !== faction && e.faction !== 'shared') continue
      const ic =
        e.faction === 'pmc' ? ICONS.extractPmc : e.faction === 'scav' ? ICONS.extractScav : ICONS.extractShared
      const switches = e.switches?.length ? `<br>Requires switch: ${esc(e.switches.join(', '))}` : ''
      g.addLayer(
        marker(
          e.position,
          ic,
          `<b>${esc(e.name)}</b><br>${e.faction.toUpperCase()} extract${switches}`,
          e.name // extract names always label in normal mode
        )
      )
      if (e.outline?.length) {
        const color = e.faction === 'pmc' ? '#4caf50' : e.faction === 'scav' ? '#ff9800' : '#03a9f4'
        g.addLayer(outlinePolygon(e.outline, color))
      }
      this.currentExtractPoints.push({
        x: e.position.x,
        y: e.position.y,
        z: e.position.z,
        floor: this.tmap.floorForPosition(e.position.y, e.position.x, e.position.z),
        name: e.name,
        description: `${e.faction.toUpperCase()} extract`
      })
      labelCount++
    }
    console.warn(`[labels] extracts=${labelCount}`)
  }

  /** Re-derive quest markers from the checklist state. */
  rebuildQuests(availableOnly: boolean): void {
    const g = this.group('quests')
    g.clearLayers()
    this.currentQuestPoints = []
    const mapName = this.tmap.mapData.normalizedName
    // Quest markers get name bubbles only while the map is filtered to
    // tracked quests (normal mode only, via CSS).
    const labelQuests = trackedCount() > 0
    for (const q of visibleQuests(this.quests, availableOnly)) {
      for (const obj of q.objectives) {
        for (const mk of obj.markers ?? []) {
          if (mk.map !== mapName) continue
          const p = mk.position
          const floor = this.tmap.floorForPosition(p.y, p.x, p.z)
          const floorLabel = floor === 'base' ? 'Ground' : floor
          g.addLayer(
            marker(
              p,
              ICONS.quest,
              `<b>${esc(q.name)}</b><br>${esc(q.trader ?? '')}<br>${esc(obj.description ?? '')}<br>Floor: ${esc(floorLabel)}`,
              labelQuests ? q.name : undefined
            )
          )
          if (mk.outline?.length) g.addLayer(outlinePolygon(mk.outline, '#ab47bc'))
          this.currentQuestPoints.push({
            x: p.x,
            y: p.y,
            z: p.z,
            floor,
            name: q.name,
            description: obj.description ?? ''
          })
        }
      }
    }
    console.warn(`[labels] quests=${labelQuests ? this.currentQuestPoints.length : 0}`)
  }

  /** Objective points currently shown on this map (for the nearest arrow). */
  questPoints(): MapPoint[] {
    return this.currentQuestPoints
  }

  /** Extracts currently shown, i.e. already filtered by the faction setting. */
  extractPoints(): MapPoint[] {
    return this.currentExtractPoints
  }

  setVisible(key: LayerKey, visible: boolean): void {
    const g = this.group(key)
    if (visible) g.addTo(this.tmap.leaflet)
    else this.tmap.leaflet.removeLayer(g)
  }
}
