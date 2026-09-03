import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { assetUrl, type MapData, type FloorLayer, type ImageSource, type Vec3 } from './data'

// Coordinate system matching tarkov.dev's interactive maps (see
// the-hideout/tarkov-dev src/pages/map/index.jsx): game (x, z) is used directly
// as Leaflet (lng, lat); the CRS applies the per-map affine transform plus an
// optional rotation so the image lines up.

function rotate(latLng: L.LatLng, rotation: number): L.LatLng {
  if (!latLng.lng && !latLng.lat) return L.latLng(0, 0)
  if (!rotation) return latLng
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const { lng: x, lat: y } = latLng
  return L.latLng(x * sin + y * cos, x * cos - y * sin)
}

function buildCRS(transform: [number, number, number, number], rotation: number): L.CRS {
  const scaleX = transform[0]
  const marginX = transform[1]
  const scaleY = transform[2] * -1
  const marginY = transform[3]
  return L.Util.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(scaleX, marginX, scaleY, marginY),
    projection: L.Util.extend({}, L.Projection.LonLat, {
      project: (latLng: L.LatLng) => L.Projection.LonLat.project(rotate(latLng, rotation)),
      unproject: (point: L.Point) => rotate(L.Projection.LonLat.unproject(point), -rotation)
    })
  }) as L.CRS
}

export function gameToLatLng(pos: Vec3 | { x: number; z: number }): L.LatLng {
  return L.latLng(pos.z, pos.x)
}

function boundsToLatLng(bounds: [[number, number], [number, number]]): L.LatLngBounds {
  // bounds are [[x, z], [x, z]] in game coordinates
  return L.latLngBounds(
    L.latLng(bounds[0][1], bounds[0][0]),
    L.latLng(bounds[1][1], bounds[1][0])
  )
}

/** Extent bounds entries look like [[x1,z1],[x2,z2],"optional label"]. */
function rectContains(entry: unknown[], x: number, z: number): boolean {
  const a = entry[0]
  const b = entry[1]
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  const [x1, z1] = a as [number, number]
  const [x2, z2] = b as [number, number]
  return (
    x >= Math.min(x1, x2) &&
    x <= Math.max(x1, x2) &&
    z >= Math.min(z1, z2) &&
    z <= Math.max(z1, z2)
  )
}

export interface FloorOption {
  key: string // 'base' or layer name
  name: string
}

interface RuntimeLayer {
  def: FloorLayer
  tileLayer: L.TileLayer | null // for kind === 'tiles'
  svgGroupId: string | null // for kind === 'svg' (group inside the base SVG)
}

export class TarkovMap {
  readonly leaflet: L.Map
  readonly mapData: MapData
  private layers: Map<string, RuntimeLayer> = new Map()
  private svgRoot: SVGSVGElement | null = null
  private activeFloor = 'base'
  onFloorChanged: ((floor: string) => void) | null = null

  private constructor(container: HTMLElement, mapData: MapData) {
    this.mapData = mapData
    const r = mapData.render
    const maxZoom = Math.max(7, r.maxZoom) // tarkov.dev upscales past native zoom
    this.leaflet = L.map(container, {
      crs: buildCRS(r.transform, r.coordinateRotation),
      minZoom: r.minZoom,
      maxZoom,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      attributionControl: false,
      zoomControl: false
    })
  }

  static async create(container: HTMLElement, mapData: MapData): Promise<TarkovMap> {
    const tmap = new TarkovMap(container, mapData)
    const r = mapData.render

    if (r.base.kind === 'svg') {
      // Floor layers live as <g> groups inside the base SVG, so it is loaded
      // inline (not as an <img>) to allow toggling group visibility.
      const res = await fetch(assetUrl(r.base.path))
      const text = await res.text()
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
      const svg = doc.documentElement as unknown as SVGSVGElement
      const svgBounds = r.svgBounds ?? r.bounds
      L.svgOverlay(svg, boundsToLatLng(svgBounds), { interactive: false }).addTo(tmap.leaflet)
      tmap.svgRoot = svg
    } else {
      tmap.createTileLayer(r.base).addTo(tmap.leaflet)
    }

    for (const def of r.layers ?? []) {
      const rt: RuntimeLayer = { def, tileLayer: null, svgGroupId: null }
      if (def.base.kind === 'svg' && def.base.svgLayer) {
        rt.svgGroupId = def.base.svgLayer
      } else if (def.base.kind === 'tiles') {
        rt.tileLayer = tmap.createTileLayer(def.base)
      }
      tmap.layers.set(def.name, rt)
    }

    tmap.applyFloorVisibility()
    // The data's place-name labels ("Sushi Huyushi", "Tarducks") are
    // deliberately not rendered: the only names on the map are extract names
    // and quest objective names.
    tmap.leaflet.fitBounds(boundsToLatLng(r.bounds))
    return tmap
  }

  private createTileLayer(src: ImageSource): L.TileLayer {
    const r = this.mapData.render
    return L.tileLayer(assetUrl(src.path), {
      tileSize: r.tileSize ?? 256,
      minZoom: r.minZoom,
      maxZoom: Math.max(7, r.maxZoom),
      maxNativeZoom: src.maxNativeZoom ?? r.maxZoom,
      bounds: boundsToLatLng(r.bounds)
    })
  }

  private setSvgGroupVisible(groupId: string, visible: boolean): void {
    const el = this.svgRoot?.getElementById(groupId) as SVGElement | null
    if (el) el.style.display = visible ? '' : 'none'
  }

  private applyFloorVisibility(): void {
    for (const [name, rt] of this.layers) {
      const visible = name === this.activeFloor
      if (rt.svgGroupId) this.setSvgGroupVisible(rt.svgGroupId, visible)
      if (rt.tileLayer) {
        if (visible) rt.tileLayer.addTo(this.leaflet)
        else this.leaflet.removeLayer(rt.tileLayer)
      }
    }
  }

  floorOptions(): FloorOption[] {
    const opts: FloorOption[] = [{ key: 'base', name: 'Ground' }]
    for (const name of this.layers.keys()) opts.push({ key: name, name })
    return opts
  }

  getActiveFloor(): string {
    return this.activeFloor
  }

  setFloor(key: string): void {
    if (key === this.activeFloor) return
    this.activeFloor = key
    this.applyFloorVisibility()
    this.onFloorChanged?.(key)
  }

  /**
   * Pick the floor for a player position: an extent matches when the height is
   * in range and, if the extent has area bounds, the (x, z) point is inside one
   * of them (mirrors tarkov.dev's markerIsOnLayer).
   */
  floorForPosition(y: number, x: number, z: number): string {
    for (const [name, rt] of this.layers) {
      for (const extent of rt.def.extents ?? []) {
        if (y < extent.height[0] || y > extent.height[1]) continue
        const areas = extent.bounds
        if (!areas?.length) return name
        for (const area of areas) {
          if (rectContains(area as unknown[], x, z)) return name
        }
      }
    }
    return 'base'
  }

  destroy(): void {
    this.leaflet.remove()
  }
}
