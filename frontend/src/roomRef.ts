import type { MaterialSelection, Room } from './types'

/** A room entered by hand (metres). Mirrors backend/properties/custom.py. */
export interface CustomRoomSpec {
  label: string
  width_m: number
  depth_m: number
  height_m: number
}

export const LIMITS = { side: [1, 60], height: [1.8, 15] } as const
const PREFIX = 'custom:'

export const customRoomId = (c: CustomRoomSpec) =>
  `${PREFIX}${encodeURIComponent(c.label)}|${c.width_m}|${c.depth_m}|${c.height_m}`

export function parseCustomRoomId(id: string): CustomRoomSpec | null {
  if (!id.startsWith(PREFIX)) return null
  const [label, w, d, h] = id.slice(PREFIX.length).split('|')
  return { label: decodeURIComponent(label), width_m: +w, depth_m: +d, height_m: +h }
}

/** Request body fragment for a room: a Matterport room id or the hand-entered dimensions. */
export function roomPayload(roomId: string): { room_id: string } | { custom_room: CustomRoomSpec } {
  const custom = parseCustomRoomId(roomId)
  return custom ? { custom_room: custom } : { room_id: roomId }
}

export function customRoomToRoom(c: CustomRoomSpec): Room {
  const user = (value: number) => ({ value, provenance: 'user' as const, note: 'entered by the user' })
  return {
    id: customRoomId(c),
    label: c.label,
    label_confidence: null,
    area_m2: user(c.width_m * c.depth_m),
    width_m: user(c.width_m),
    depth_m: user(c.depth_m),
    height_m: user(c.height_m),
    usable: true,
    issues: [],
  }
}

/** One side of the A/B comparison: a room of any property (or a hand-entered room). */
export interface SlotRef {
  sid: string
  roomId: string
  label: string
  address: string
}

/**
 * Request body for /rooms/analyze, /rooms/ir and /rooms/compare. Every room is modeled with its
 * furniture (typical for the room type unless edited) and, for Matterport rooms, the wall area of
 * its real outline.
 */
export function roomBody(sid: string, roomId: string, sel?: MaterialSelection) {
  const { furniture, treatment, treatment_avoid, room_model, ...materials } = sel ?? {}
  return {
    sid,
    ...roomPayload(roomId),
    materials,
    furnished: true,
    use_outline: true,
    ...(furniture ? { furniture } : {}),
    ...(treatment ? { treatment_objective: treatment, treatment_avoid_walls: treatment_avoid ?? [] } : {}),
    ...(room_model ? { use_room_model: true } : {}),
  }
}
