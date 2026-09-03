// Pure nearest-point selection — no DOM/leaflet imports so Node tests can
// import it directly. Used for both quest objectives and extracts.

export interface MapPoint {
  x: number
  y: number
  z: number
  /** Floor key from TarkovMap.floorForPosition ('base' or layer name). */
  floor: string
  name: string
  description: string
}

export interface NearestResult {
  point: MapPoint
  distanceMeters: number
  /** Whether this point is on the player's current floor. */
  sameFloor: boolean
}

function distance(p: MapPoint, player: { x: number; z: number }): number {
  return Math.hypot(p.x - player.x, p.z - player.z)
}

/**
 * The `count` nearest points, closest first. Points on the player's floor are
 * preferred over closer ones elsewhere; if the floor has fewer than `count`,
 * the rest are filled from other floors (flagged sameFloor: false) rather than
 * returning a short list.
 *
 * Results are unique by name, so a quest with several objective markers
 * contributes only its closest one — three entries mean three different
 * quests, not three markers of the same quest.
 */
export function pickNearestObjectives(
  points: MapPoint[],
  player: { x: number; z: number; floor: string },
  count: number
): NearestResult[] {
  if (count <= 0) return []
  const byDistance = (a: MapPoint, b: MapPoint): number => distance(a, player) - distance(b, player)
  const sameFloor = points.filter((p) => p.floor === player.floor).sort(byDistance)
  const otherFloor = points.filter((p) => p.floor !== player.floor).sort(byDistance)
  const results: NearestResult[] = []
  const seen = new Set<string>()
  for (const point of [...sameFloor, ...otherFloor]) {
    if (seen.has(point.name)) continue
    seen.add(point.name)
    results.push({
      point,
      distanceMeters: distance(point, player),
      sameFloor: point.floor === player.floor
    })
    if (results.length === count) break
  }
  return results
}

/** The single nearest point, or null when there are none. */
export function pickNearestObjective(
  points: MapPoint[],
  player: { x: number; z: number; floor: string }
): NearestResult | null {
  return pickNearestObjectives(points, player, 1)[0] ?? null
}
