import { describe, expect, it } from 'vitest'
import { buildFieldMesh, houseRange, METRICS, normalise, ramp } from './field'
import type { RoomField } from './types'

// 3 x 2 nodes, step 1: one row of two cells; node (2, 1) is outside the room.
const field: RoomField = {
  origin: [10, 20],
  step: 1,
  nx: 3,
  ny: 2,
  c50_db: [0, 2, 4, 1, 3, null],
  reflection_db: [-20, -20, -20, -20, -20, null],
  bass_spread_db: [10, 6, 2, 8, 4, null],
  source: [10, 20],
  source_height_m: 1.2,
  listener_height_m: 1.2,
  best_spot: [11, 21],
  ranges: { c50_db: [0, 4], reflection_db: [-20, -20], bass_spread_db: [2, 10] },
  notes: [],
}

describe('field metrics', () => {
  it('maps good values to 1 and bad values to 0 for each metric direction', () => {
    expect(normalise('c50_db', 4, [0, 4])).toBe(1) // higher clarity is better
    expect(normalise('bass_spread_db', 2, [2, 10])).toBe(1) // smoother bass is better
    expect(normalise('bass_spread_db', 10, [2, 10])).toBe(0)
    expect(normalise('reflection_db', -20, [-20, -20])).toBe(1) // flat range: neutral good
  })

  it('has a label and explanation for every metric', () => {
    for (const m of Object.values(METRICS)) expect(m.label && m.explain).toBeTruthy()
  })

  it('takes the range across all rooms so colours compare between rooms', () => {
    expect(houseRange([field, { ...field, ranges: { ...field.ranges, c50_db: [-3, 2] } }], 'c50_db')).toEqual([-3, 4])
  })

  it('ramps from red (bad) to cyan (good)', () => {
    const [r0, , b0] = ramp(0)
    const [r1, , b1] = ramp(1)
    expect(r0).toBeGreaterThan(r1)
    expect(b1).toBeGreaterThan(b0)
  })
})

describe('buildFieldMesh', () => {
  it('emits two triangles only for cells with all four corners inside', () => {
    const mesh = buildFieldMesh(field, 0, 'bass_spread_db', [2, 10])
    expect(mesh.positions.length).toBe(1 * 2 * 3 * 3) // one complete cell
    expect(mesh.colors.length).toBe(mesh.positions.length)
  })

  it('places vertices in SDK space (x, z, -y) with bad spots raised', () => {
    const m = buildFieldMesh(field, 1.5, 'bass_spread_db', [2, 10])
    const verts: number[][] = []
    for (let i = 0; i < m.positions.length; i += 3) verts.push(m.positions.slice(i, i + 3))
    const at = (x: number, y: number) => verts.find((v) => v[0] === x && v[2] === -y)!
    expect(at(10, 20)[1]).toBeGreaterThan(at(11, 20)[1]) // 10 dB spread (bad) is higher than 6 dB
    expect(Math.min(...verts.map((v) => v[1]))).toBeGreaterThanOrEqual(1.5)
  })
})
