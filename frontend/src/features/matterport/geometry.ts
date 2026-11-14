import type { TourLayout, TourRoom } from '../../types'

/**
 * Matterport Model API positions are model space with z up. The Showcase SDK's three.js scene
 * is y up. Verified on zvKHR9DHNjJ by matching sweep positions from both APIs:
 * sdk (x, y, z) = model (x, z, -y).
 */
export function modelToSdk([x, y, z = 0]: number[]): { x: number; y: number; z: number } {
  return { x, y: z, z: -y }
}

/** Height of a room's floor in model space: median puck height of its sweeps, else its floor's. */
export function roomFloorHeight(room: TourRoom, layout: TourLayout): number {
  const own = layout.sweeps.filter((s) => s.room_id === room.room_id)
  const pool = own.length
    ? own
    : layout.sweeps.filter((s) => s.floor_index != null && s.floor_index === room.floor_index)
  if (!pool.length) return 0
  const zs = pool.map((s) => s.position[2] ?? 0).sort((a, b) => a - b)
  const mid = Math.floor(zs.length / 2)
  return zs.length % 2 ? zs[mid] : (zs[mid - 1] + zs[mid]) / 2
}

export function centroid(poly: number[][]): [number, number] {
  const n = poly.length
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n]
}

export function polygonArea(poly: number[][]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i === 0 ? poly.length - 1 : i - 1]
    const [x1, y1] = poly[i]
    s += x1 * y0 - x0 * y1
  }
  return Math.abs(s) / 2
}

/** Bounding box of all room polygons, in model space. */
export function layoutBounds(rooms: TourRoom[]) {
  const pts = rooms.flatMap((r) => r.polygon ?? [])
  if (!pts.length) return null
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/**
 * Which Reverb room the visitor is in. Prefers the SDK's Room.current (same ids as Reverb);
 * falls back to the current sweep's room from the Model API. Returns null when unknown.
 */
export function resolveCurrentRoom(
  sdkRoomIds: string[] | null,
  sweepId: string | null,
  layout: TourLayout,
): { roomId: string | null; source: 'room' | 'sweep' | 'none'; ambiguous: boolean } {
  const known = new Set(layout.rooms.map((r) => r.room_id))
  const fromSdk = (sdkRoomIds ?? []).filter((id) => known.has(id))
  if (fromSdk.length) return { roomId: fromSdk[0], source: 'room', ambiguous: fromSdk.length > 1 }
  const sweep = sweepId ? layout.sweeps.find((s) => s.id === sweepId) : undefined
  if (sweep?.room_id && known.has(sweep.room_id)) {
    return { roomId: sweep.room_id, source: 'sweep', ambiguous: false }
  }
  return { roomId: null, source: 'none', ambiguous: false }
}
