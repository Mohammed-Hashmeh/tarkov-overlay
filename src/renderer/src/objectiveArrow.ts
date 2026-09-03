import L from 'leaflet'
import { gameToLatLng, type TarkovMap } from './map'
import { pickNearestObjectives, type MapPoint, type NearestResult } from './nearestObjective'
import type { PlayerPosition } from '../../shared/types'

export type { MapPoint } from './nearestObjective'

/** Colour by rank; the same colour is used for the arrow, the guide line and
 *  the ring drawn around that marker, so a row can be matched to the map. */
export const OBJECTIVE_COLORS = ['#ffd54f', '#ba68c8', '#4fc3f7']
export const EXTRACT_COLOR = '#66bb6a'
const OBJECTIVE_COUNT = 3

interface Entry {
  result: NearestResult
  color: string
  kind: 'objective' | 'extract'
}

export class ObjectiveArrow {
  private chip: HTMLElement
  private overlay = L.layerGroup()
  private overlayMap: L.Map | null = null

  constructor(chip: HTMLElement) {
    this.chip = chip
  }

  private detachOverlay(): void {
    this.overlay.clearLayers()
    if (this.overlayMap) this.overlayMap.removeLayer(this.overlay)
    this.overlayMap = null
  }

  clear(): void {
    this.detachOverlay()
    this.chip.hidden = true
    this.chip.innerHTML = ''
  }

  /** Screen-space bearing so the arrow matches what the user sees, including
   *  on maps whose CRS bakes in a rotation. 0deg = up. */
  private bearing(tmap: TarkovMap, from: L.LatLng, to: L.LatLng): number {
    const zoom = tmap.leaflet.getZoom()
    const p1 = tmap.leaflet.project(from, zoom)
    const p2 = tmap.leaflet.project(to, zoom)
    return (Math.atan2(p2.x - p1.x, -(p2.y - p1.y)) * 180) / Math.PI
  }

  private renderHint(text: string): void {
    this.chip.hidden = false
    this.chip.innerHTML = ''
    const row = document.createElement('div')
    row.className = 'objective-row objective-hint'
    row.textContent = text
    this.chip.appendChild(row)
  }

  update(
    tmap: TarkovMap | null,
    playerPos: PlayerPosition | null,
    questPoints: MapPoint[],
    extractPoints: MapPoint[]
  ): void {
    this.detachOverlay()
    const hasAny = questPoints.length > 0 || extractPoints.length > 0
    if (!tmap || !hasAny) {
      this.chip.hidden = true
      this.chip.innerHTML = ''
      return
    }
    if (!playerPos) {
      this.renderHint('screenshot in game for position')
      return
    }

    const player = {
      x: playerPos.x,
      z: playerPos.z,
      floor: tmap.floorForPosition(playerPos.y, playerPos.x, playerPos.z)
    }
    const entries: Entry[] = []
    pickNearestObjectives(questPoints, player, OBJECTIVE_COUNT).forEach((result, i) => {
      entries.push({ result, color: OBJECTIVE_COLORS[i], kind: 'objective' })
    })
    for (const result of pickNearestObjectives(extractPoints, player, 1)) {
      entries.push({ result, color: EXTRACT_COLOR, kind: 'extract' })
    }
    if (!entries.length) {
      this.chip.hidden = true
      this.chip.innerHTML = ''
      return
    }

    const from = gameToLatLng(playerPos)
    this.chip.hidden = false
    this.chip.innerHTML = ''

    for (const entry of entries) {
      const { result, color } = entry
      const to = gameToLatLng(result.point)
      const angle = this.bearing(tmap, from, to)

      const row = document.createElement('div')
      row.className = `objective-row objective-${entry.kind}`

      const arrow = document.createElement('span')
      arrow.className = 'objective-arrow'
      arrow.textContent = '➤'
      arrow.style.color = color
      arrow.style.rotate = `${angle - 90}deg`

      const dist = document.createElement('span')
      dist.className = 'objective-distance'
      dist.textContent = `${Math.round(result.distanceMeters)}m`

      const name = document.createElement('span')
      name.className = 'objective-name'
      const floorNote = result.sameFloor
        ? ''
        : ` · ${result.point.floor === 'base' ? 'Ground' : result.point.floor}`
      name.textContent = `${result.point.name}${floorNote}`
      name.title = result.point.description || result.point.name

      row.append(arrow, dist, name)
      this.chip.appendChild(row)

      this.overlay.addLayer(
        L.polyline([from, to], {
          color,
          weight: 2,
          opacity: 0.85,
          dashArray: '6 6',
          interactive: false
        })
      )
      // Ring the target so the row's colour can be matched on the map.
      this.overlay.addLayer(
        L.circleMarker(to, {
          radius: 13,
          color,
          weight: 2.5,
          opacity: 0.95,
          fill: false,
          interactive: false
        })
      )
    }

    this.overlay.addTo(tmap.leaflet)
    this.overlayMap = tmap.leaflet
    console.warn(
      `[arrow] ${entries.map((e) => `${e.kind}:${Math.round(e.result.distanceMeters)}m ${e.result.point.name}`).join(' | ')}`
    )
  }
}
