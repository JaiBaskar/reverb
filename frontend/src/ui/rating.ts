import { MODERATE_LIMIT } from '../features/decide/verdict'
import type { RankedSource } from '../features/risk/types'

export type Tone = 'good' | 'ok' | 'bad'
export interface Rating {
  tone: Tone
  label: string
  detail?: string
}

/** Display grades for a music room's modeled mid-band RT60 (500 Hz-1 kHz). Target is ~0.3-0.5 s. */
export function reverbRating(midS: number): Rating {
  if (midS < 0.2) return { tone: 'ok', label: 'Very dry' }
  if (midS <= 0.6) return { tone: 'good', label: 'Balanced' }
  if (midS <= 1.0) return { tone: 'ok', label: 'Lively' }
  return { tone: 'bad', label: 'Echoey' }
}

/** OSM tag "highway=primary" -> "Primary". */
export const friendlyTag = (tag: string) => {
  const v = (tag.split('=').pop() ?? tag).replace(/_/g, ' ')
  return v.charAt(0).toUpperCase() + v.slice(1)
}

/** The surroundings in one word, from the noise-risk ranking (same thresholds as the verdict). */
export function outsideRating(ranked: RankedSource[]): Rating {
  const high = ranked.filter((r) => r.level === 'high')
  const moderate = ranked.filter((r) => r.level === 'moderate')
  const top = high[0] ?? ranked[0]
  const detail = top ? `${top.name ?? friendlyTag(top.subtype)} · ${Math.round(top.distance_m)} m` : 'Nothing mapped nearby'
  if (high.length) return { tone: 'bad', label: 'Noisy', detail }
  if (moderate.length > MODERATE_LIMIT) return { tone: 'ok', label: 'Some noise', detail }
  return { tone: 'good', label: 'Quiet', detail }
}

export const TONE_BG: Record<Tone, string> = { good: 'bg-good', ok: 'bg-ok', bad: 'bg-bad' }
export const TONE_TEXT: Record<Tone, string> = { good: 'text-good', ok: 'text-ok', bad: 'text-bad' }
