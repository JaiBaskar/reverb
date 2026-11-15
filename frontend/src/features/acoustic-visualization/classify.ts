import type { AcousticReport } from '../../types'
import type { Check, FitLevel, SuitabilityReport } from '../suitability/types'

/**
 * Room-level heatmap classes. Every class comes from a number the Python engine produced:
 * - fit: the qualitative level from /suitability for one use case (as modeled, or the
 *   shape-only level that ignores what treatment can change);
 * - rt60: the room's mid-band (500 Hz-1 kHz) Eyring RT60, binned for display only;
 * - bass: the room's Schroeder frequency, binned for display only.
 * One colour per room. Nothing here is a spatial field or a score.
 */

export type VizMode = 'fit' | 'rt60' | 'bass'
export type FitBasis = 'modeled' | 'shape'

export interface RoomData {
  report?: AcousticReport
  suitability?: SuitabilityReport
  loading: boolean
  error?: string
}

export interface Bin {
  key: string
  label: string
  color: string
  hint: string
}

export interface Classification {
  key: string
  color: string
  /** Short label for the legend / chip. */
  label: string
  /** Value shown on the chip, e.g. "1.99 s". */
  value?: string
  /** Why this room has this colour, in plain words with the numbers. */
  why: string[]
}

export const NEUTRAL = '#6b7280'
export const FIT_BINS: Record<FitLevel, Bin> = {
  good: { key: 'good', label: 'Good fit', color: '#3fae7a', hint: 'every check passes' },
  workable: { key: 'workable', label: 'Workable', color: '#d6a23a', hint: 'at least one check is a caution' },
  poor: { key: 'poor', label: 'Poor fit', color: '#cf5a4c', hint: 'at least one check fails' },
}

// Display bins only: the thresholds group values for colour, they are not quality judgements.
export const RT60_BINS: (Bin & { max: number })[] = [
  { key: 'dry', label: 'Dry', max: 0.3, color: '#9bd2e8', hint: 'mid RT60 under 0.3 s' },
  { key: 'controlled', label: 'Controlled', max: 0.6, color: '#5fa8d3', hint: '0.3-0.6 s' },
  { key: 'live', label: 'Live', max: 1.0, color: '#6c7fd1', hint: '0.6-1.0 s' },
  { key: 'very-live', label: 'Very live', max: Infinity, color: '#9a6ad0', hint: '1.0 s or more' },
]
export const BASS_BINS: (Bin & { max: number })[] = [
  { key: 'low', label: 'Under 100 Hz', max: 100, color: '#9bd2e8', hint: 'modes matter only in the lowest bass' },
  { key: 'mid', label: '100-150 Hz', max: 150, color: '#5fa8d3', hint: 'modes shape the bass' },
  { key: 'high', label: '150-200 Hz', max: 200, color: '#6c7fd1', hint: 'modes reach the low mids' },
  { key: 'very-high', label: '200 Hz or more', max: Infinity, color: '#9a6ad0', hint: 'modes colour much of a guitar\'s range' },
]

export const midRt60 = (r: AcousticReport): number => {
  const i500 = r.bands_hz.indexOf(500)
  const i1k = r.bands_hz.indexOf(1000)
  return (r.rt60_s[i500] + r.rt60_s[i1k]) / 2
}

const binFor = <B extends { max: number }>(bins: B[], v: number): B => bins.find((b) => v < b.max) ?? bins[bins.length - 1]

const problemReasons = (checks: Check[], basis: FitBasis): string[] => {
  const relevant = basis === 'shape' ? checks.filter((c) => !c.treatable) : checks
  const bad = relevant.filter((c) => c.status !== 'pass')
  if (!bad.length) return ['Every check passes.']
  const order = { fail: 0, caution: 1, pass: 2 }
  return bad.sort((a, b) => order[a.status] - order[b.status]).map((c) => `${c.label}: ${c.reason}`)
}

export function classifyRoom(
  data: RoomData | undefined,
  usable: boolean,
  mode: VizMode,
  useCase: string,
  basis: FitBasis,
): Classification {
  if (!usable) {
    return { key: 'unmodeled', color: NEUTRAL, label: 'Not modeled', why: ['Matterport geometry is too incomplete to model this room.'] }
  }
  if (!data || data.loading) return { key: 'loading', color: NEUTRAL, label: 'Calculating…', why: [] }
  if (data.error || !data.report) {
    return { key: 'error', color: NEUTRAL, label: 'No result', why: [data.error ?? 'No acoustic report.'] }
  }
  const r = data.report
  if (mode === 'rt60') {
    const mid = midRt60(r)
    const b = binFor(RT60_BINS, mid)
    return {
      key: b.key,
      color: b.color,
      label: b.label,
      value: `${mid.toFixed(2)} s`,
      why: [`Mid RT60 (500 Hz-1 kHz) is ${mid.toFixed(2)} s for ${r.geometry.volume_m3.toFixed(0)} m³ with the assumed materials.`],
    }
  }
  if (mode === 'bass') {
    const b = binFor(BASS_BINS, r.schroeder_hz)
    const lowest = Math.min(...r.modes.map((m) => m.freq_hz))
    return {
      key: b.key,
      color: b.color,
      label: b.label,
      value: `${r.schroeder_hz.toFixed(0)} Hz`,
      why: [
        `Schroeder frequency ${r.schroeder_hz.toFixed(0)} Hz: below it, individual room modes dominate the sound.`,
        Number.isFinite(lowest) ? `Lowest axial mode ${lowest.toFixed(0)} Hz.` : 'No axial modes reported.',
      ],
    }
  }
  const fit = data.suitability?.fits.find((f) => f.use_case === useCase)
  if (!fit) {
    return data.suitability
      ? { key: 'error', color: NEUTRAL, label: 'No result', why: [`No "${useCase}" profile in the suitability report.`] }
      : { key: 'loading', color: NEUTRAL, label: 'Calculating…', why: [] }
  }
  const level = basis === 'shape' ? fit.shape_level : fit.level
  if (!level) {
    return { key: 'n/a', color: NEUTRAL, label: 'n/a', why: ['This profile has no checks that depend only on room shape.'] }
  }
  const b = FIT_BINS[level]
  return { key: level, color: b.color, label: b.label, why: problemReasons(fit.checks, basis) }
}

export function legendFor(mode: VizMode): Bin[] {
  if (mode === 'rt60') return RT60_BINS
  if (mode === 'bass') return BASS_BINS
  return [FIT_BINS.good, FIT_BINS.workable, FIT_BINS.poor]
}
