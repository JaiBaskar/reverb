import { describe, expect, it } from 'vitest'
import type { TourLayout, TourRoom } from '../../types'
import { modelToSdk, resolveCurrentRoom, roomFloorHeight } from './geometry'

const room = (id: string, extra: Partial<TourRoom> = {}): TourRoom => ({
  room_id: id,
  label: id,
  usable: true,
  floor_index: 0,
  polygon: [[0, 0], [1, 0], [1, 1]],
  polygon_provenance: 'verified',
  sweep_ids: [],
  entry_sweep_id: null,
  entry_sweep_provenance: 'missing',
  navigable: false,
  issues: [],
  ...extra,
})

const layout: TourLayout = {
  sid: 's',
  coordinate_note: '',
  floors: [{ id: 'f0', label: 'Floor 1', index: 0 }],
  rooms: [room('living'), room('bath'), room('upstairs', { floor_index: 1 })],
  sweeps: [
    { id: 'a', room_id: 'living', floor_index: 0, position: [0, 0, 0.02] },
    { id: 'b', room_id: 'living', floor_index: 0, position: [1, 1, 0.04] },
    { id: 'c', room_id: 'living', floor_index: 0, position: [1, 1, 0.03] },
    { id: 'd', room_id: null, floor_index: 1, position: [1, 1, 3.1] },
  ],
}

describe('modelToSdk', () => {
  it('matches the verified zvKHR9DHNjJ sweep (model y -> sdk -z, model z -> sdk y)', () => {
    // Model API: tgx6gn9g... at (0.00995, -0.01778, 0.02184); SDK reported z = 0.01778.
    const p = modelToSdk([0.00995, -0.01778, 0.02184])
    expect(p.x).toBeCloseTo(0.00995)
    expect(p.y).toBeCloseTo(0.02184)
    expect(p.z).toBeCloseTo(0.01778)
  })
})

describe('roomFloorHeight', () => {
  it('uses the median of the room sweeps', () => {
    expect(roomFloorHeight(layout.rooms[0], layout)).toBeCloseTo(0.03)
  })
  it('falls back to sweeps on the same floor, then 0', () => {
    expect(roomFloorHeight(layout.rooms[2], layout)).toBeCloseTo(3.1)
    expect(roomFloorHeight(room('x', { floor_index: 7 }), layout)).toBe(0)
  })
})

describe('resolveCurrentRoom', () => {
  it('prefers SDK Room.current ids that Reverb knows', () => {
    expect(resolveCurrentRoom(['unknown', 'bath'], 'a', layout)).toEqual({
      roomId: 'bath',
      source: 'room',
      ambiguous: false,
    })
  })
  it('flags overlapping rooms as ambiguous', () => {
    expect(resolveCurrentRoom(['living', 'bath'], null, layout).ambiguous).toBe(true)
  })
  it('falls back to the sweep room from the Model API', () => {
    expect(resolveCurrentRoom([], 'b', layout)).toMatchObject({ roomId: 'living', source: 'sweep' })
  })
  it('reports unknown rather than guessing', () => {
    expect(resolveCurrentRoom(null, 'd', layout)).toMatchObject({ roomId: null, source: 'none' })
    expect(resolveCurrentRoom(null, null, layout).roomId).toBeNull()
  })
})
