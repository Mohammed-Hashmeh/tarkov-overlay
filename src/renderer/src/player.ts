import L from 'leaflet'
import { gameToLatLng, type TarkovMap } from './map'
import type { PlayerPosition } from '../../shared/types'

const TRAIL_LENGTH = 10

export class PlayerLayer {
  private tmap: TarkovMap
  private group = L.layerGroup()
  private markerEl: L.Marker | null = null
  private trail: L.LatLng[] = []
  private trailLine: L.Polyline | null = null
  follow = true

  constructor(tmap: TarkovMap) {
    this.tmap = tmap
    this.group.addTo(tmap.leaflet)
  }

  update(pos: PlayerPosition): void {
    const latLng = gameToLatLng(pos)

    // The facing cone is drawn in CSS and rotated by yaw, corrected by the
    // map's rotation the same way tarkov.dev does (90/270-rotated maps need an
    // extra half turn).
    let addRotation = this.tmap.mapData.render.coordinateRotation
    if (addRotation === 90 || addRotation === 270) addRotation += 180
    const screenYaw = (pos.yaw + addRotation + 360) % 360
    const html =
      `<div class="player-pulse"></div>` +
      `<div class="player-cone" style="transform: rotate(${screenYaw}deg)"></div>` +
      `<div class="player-dot"></div>`
    const icon = L.divIcon({
      className: 'player-marker',
      html,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    })

    if (!this.markerEl) {
      this.markerEl = L.marker(latLng, { icon, interactive: false, zIndexOffset: 1000 })
      this.group.addLayer(this.markerEl)
    } else {
      this.markerEl.setLatLng(latLng)
      this.markerEl.setIcon(icon)
    }

    this.trail.push(latLng)
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift()
    if (this.trailLine) this.group.removeLayer(this.trailLine)
    if (this.trail.length > 1) {
      this.trailLine = L.polyline(this.trail, {
        color: '#42a5f5',
        weight: 2,
        opacity: 0.6,
        dashArray: '4 6',
        interactive: false
      })
      this.group.addLayer(this.trailLine)
    }

    // Auto-select the floor for the player's height + position, then follow.
    this.tmap.setFloor(this.tmap.floorForPosition(pos.y, pos.x, pos.z))
    if (this.follow) {
      this.tmap.leaflet.panTo(latLng)
    }
  }

  clear(): void {
    this.group.clearLayers()
    this.markerEl = null
    this.trailLine = null
    this.trail = []
  }
}
