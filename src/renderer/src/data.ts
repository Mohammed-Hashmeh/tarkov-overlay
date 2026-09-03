// Types for the bundled data produced by scripts/fetch-data.mjs.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ImageSource {
  kind: 'tiles' | 'svg'
  /** Relative under data/, tiles keep {z}/{x}/{y} placeholders. */
  path: string
  maxNativeZoom?: number | null
  /** For SVG floors: id of the <g> group inside the base SVG file. */
  svgLayer?: string | null
}

export interface FloorLayer {
  name: string
  show?: boolean
  base: ImageSource
  /** bounds entries are [[x1,z1],[x2,z2],"optional label"] in game coords. */
  extents?: { height: [number, number]; bounds?: unknown[][] }[]
}

export interface MapRender {
  transform: [number, number, number, number]
  coordinateRotation: number
  bounds: [[number, number], [number, number]]
  /** Some SVGs (Reserve) cover a different rect than the playable bounds. */
  svgBounds?: [[number, number], [number, number]] | null
  minZoom: number
  maxZoom: number
  tileSize?: number | null
  heightRange?: [number, number] | null
  base: ImageSource
  layers?: FloorLayer[]
  labels?: {
    position: [number, number]
    text: string
    size?: number | null
    rotation?: number | null
    top?: number | null
    bottom?: number | null
  }[]
}

export interface Extract {
  id: string
  name: string
  faction: 'pmc' | 'scav' | 'shared'
  position: Vec3
  outline?: Vec3[]
  top?: number | null
  bottom?: number | null
  switches?: string[]
}

export interface MapData {
  id: string
  name: string
  normalizedName: string
  scenePaths: string[]
  render: MapRender
  extracts: Extract[]
  transits?: { id: string; description?: string; position: Vec3 }[]
  spawns?: { zoneName?: string; position: Vec3; sides?: string[]; categories?: string[] }[]
  bosses?: {
    name: string
    normalizedName?: string
    spawnChance: number
    locations?: { name?: string; chance?: number }[]
  }[]
  lootContainers?: { name: string; normalizedName?: string; position: Vec3 }[]
  locks?: { lockType?: string; needsPower?: boolean; keyId?: string; keyName?: string; position: Vec3 }[]
  hazards?: { name?: string; position: Vec3 }[]
  switches?: { id?: string; name?: string; position: Vec3 }[]
}

export interface QuestMarker {
  map: string
  position: Vec3
  outline?: Vec3[]
  top?: number | null
  bottom?: number | null
}

export interface QuestObjective {
  id: string
  type?: string
  description?: string
  optional?: boolean
  maps?: string[]
  markers?: QuestMarker[]
}

export interface Quest {
  id: string
  name: string
  trader?: string
  minPlayerLevel?: number
  kappaRequired?: boolean
  wikiLink?: string
  prerequisites?: string[]
  objectives: QuestObjective[]
}

export interface BundledData {
  maps: MapData[]
  quests: Quest[]
}

export async function loadBundledData(): Promise<BundledData> {
  const [mapsRes, questsRes] = await Promise.all([
    fetch(window.api.dataUrl('maps.json')),
    fetch(window.api.dataUrl('quests.json'))
  ])
  if (!mapsRes.ok) throw new Error(`maps.json: HTTP ${mapsRes.status}`)
  if (!questsRes.ok) throw new Error(`quests.json: HTTP ${questsRes.status}`)
  const mapsJson = await mapsRes.json()
  const questsJson = await questsRes.json()
  return { maps: mapsJson.maps ?? [], quests: questsJson.quests ?? [] }
}

export function assetUrl(relPath: string): string {
  return window.api.dataUrl(relPath)
}
