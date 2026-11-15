import type { Field, Room } from '../types'

/** The scan's public Matterport thumbnail (a real photo of the place). */
export const thumbUrl = (sid: string, width = 480) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=${width}`

const FT = 3.28084
const exact = (f: Field) => f.provenance === 'verified' || f.provenance === 'user'

/** "14 × 11 ft", from whichever dimensions Matterport gave; ≈ when any is estimated. */
export function roomSize(r: Room): string {
  const { width_m: w, depth_m: d, area_m2: a } = r
  let s = ''
  if (w.value != null && d.value != null) s = `${Math.round(w.value * FT)} × ${Math.round(d.value * FT)} ft`
  else if (a.value != null) s = `${Math.round(a.value * FT * FT)} sq ft`
  if (!s) return ''
  return [w, d, a].some((f) => f.value != null && !exact(f)) ? `≈ ${s}` : s
}
