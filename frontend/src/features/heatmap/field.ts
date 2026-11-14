import type { FieldMetric, RoomField } from './types'

/** What each heatmap layer means, and which direction is good. */
export const METRICS: Record<FieldMetric, { label: string; short: string; unit: string; good: 'high' | 'low'; explain: string }> = {
  bass_spread_db: {
    label: 'Bass evenness',
    short: 'Bass',
    unit: 'dB spread',
    good: 'low',
    explain:
      'How uneven the 30-200 Hz response is at each spot (room modes). Red hills: boomy or thin bass that changes note to note. Cyan: smooth bass, good for a listening seat.',
  },
  c50_db: {
    label: 'Clarity (C50)',
    short: 'Clarity',
    unit: 'dB',
    good: 'high',
    explain:
      'Early versus late sound energy at 1 kHz from the source marker. Cyan: direct sound dominates, clear and close; red: reverberation dominates, washy.',
  },
  reflection_db: {
    label: 'Early wall reflections',
    short: 'Reflections',
    unit: 'dB vs direct',
    good: 'low',
    explain:
      'Wall reflections arriving within ~5 ms of the direct sound. Red bands along walls and corners: comb filtering, keep mics and the seat out of them.',
  },
}

export function normalise(metric: FieldMetric, v: number, [lo, hi]: [number, number]): number {
  if (hi - lo < 1e-9) return 1
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return METRICS[metric].good === 'high' ? t : 1 - t
}

export function houseRange(fields: RoomField[], metric: FieldMetric): [number, number] {
  const lo = Math.min(...fields.map((f) => f.ranges[metric][0]))
  const hi = Math.max(...fields.map((f) => f.ranges[metric][1]))
  return [lo, hi]
}

// Bad -> good: rose, orange, yellow, green, cyan.
const STOPS: [number, number, number][] = [
  [225, 29, 72],
  [249, 115, 22],
  [250, 204, 21],
  [52, 211, 153],
  [34, 211, 238],
]

/** RGB 0-255 for t in [0, 1] (0 = bad, 1 = good). */
export function ramp(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const [a, b] = [STOPS[i], STOPS[i + 1]]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

export const rampCss = (t: number) => {
  const [r, g, b] = ramp(t)
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

export const BASE_LIFT_M = 0.05
export const RELIEF_M = 0.55

/**
 * Continuous surface for one room: two triangles per grid cell whose four corners are inside the
 * room, vertex colours from the metric (interpolated across each triangle, so the colour field is
 * smooth), and height raised where the sound is worse. Model space (z up) is converted to the
 * Showcase SDK's three.js space: sdk (x, y, z) = model (x, z, -y).
 */
export function buildFieldMesh(
  f: RoomField,
  floorZ: number,
  metric: FieldMetric,
  range: [number, number],
  relief = RELIEF_M,
) {
  const values = f[metric]
  const positions: number[] = []
  const colors: number[] = []
  const node = (i: number, j: number) => {
    const v = values[j * f.nx + i]
    if (v == null) return null
    const t = normalise(metric, v, range)
    const [r, g, b] = ramp(t)
    return {
      p: [f.origin[0] + i * f.step, floorZ + BASE_LIFT_M + relief * (1 - t), -(f.origin[1] + j * f.step)],
      c: [r / 255, g / 255, b / 255],
    }
  }
  for (let j = 0; j < f.ny - 1; j++) {
    for (let i = 0; i < f.nx - 1; i++) {
      const a = node(i, j)
      const b = node(i + 1, j)
      const c = node(i + 1, j + 1)
      const d = node(i, j + 1)
      if (!a || !b || !c || !d) continue
      for (const v of [a, b, c, a, c, d]) {
        positions.push(...v.p)
        colors.push(...v.c)
      }
    }
  }
  return { positions, colors }
}
