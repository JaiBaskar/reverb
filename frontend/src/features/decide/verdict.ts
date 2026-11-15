import type { Fit, FitLevel } from '../suitability/types'

export interface VerdictInput {
  mixing: FitLevel // best achievable (with practical treatment) for mixing
  vocal: FitLevel // best achievable for vocal recording
  panels: number // panels to reach the mixing target
  high: number // high-risk neighbours (noise-risk ranking)
  moderate: number
  /** Why mixing stays poor even with treatment (from whyMixingFails); a generic line if absent. */
  mixingWhy?: string
}

/** Plain words for the room-shape checks panels cannot change (suitability check ids). */
const FIXED_PROBLEM: Record<string, string> = {
  mode_gap: 'uneven bass from the room’s shape, which panels cannot fix',
  coincident_modes: 'booming bass notes from the room’s shape, which panels cannot fix',
  volume: 'the room is too small for mixing',
  floor_area: 'the room is too small for mixing',
  height: 'the ceiling is too low for mixing',
}

/**
 * Why a room cannot reach a workable mixing level even with treatment, read from its suitability
 * fit: a failing check that treatment cannot change (room shape, size), or reverb that would take
 * an impractical number of panels. Undefined when mixing can become workable.
 */
export function whyMixingFails(fit: Fit): string | undefined {
  if (fit.potential_level !== 'poor') return undefined
  const fixed = fit.checks.find((c) => c.status === 'fail' && !c.treatable && FIXED_PROBLEM[c.id])
  if (fixed) return FIXED_PROBLEM[fixed.id]
  if (fit.treatment?.verdict === 'impractical') return 'too much reverb for a practical number of panels'
  return undefined
}

export type VerdictLevel = 'strong' | 'workable' | 'risky'

export const PANEL_LIMIT = 20
export const MODERATE_LIMIT = 4

/** Transparent rules over the computed results; the card prints them. Not a score. */
export const VERDICT_RULES = [
  `Risky: any high-risk neighbour, or the room cannot reach "workable" for mixing even with treatment (room shape or size, or an impractical amount of reverb).`,
  `Needs work: more than ${PANEL_LIMIT} panels, more than ${MODERATE_LIMIT} moderate-risk neighbours, or vocals cannot reach "workable".`,
  'Strong candidate: everything else.',
]

export function houseVerdict(v: VerdictInput): { level: VerdictLevel; reasons: string[] } {
  const risky: string[] = []
  const work: string[] = []
  if (v.high > 0) risky.push(`${v.high} high-risk noise source${v.high > 1 ? 's' : ''} nearby`)
  if (v.mixing === 'poor') risky.push(v.mixingWhy ?? 'the room cannot reach a workable mixing level even with panels')
  if (v.panels > PANEL_LIMIT) work.push(`about ${v.panels} panels needed`)
  if (v.moderate > MODERATE_LIMIT) work.push(`${v.moderate} moderate-risk sources nearby`)
  if (v.vocal === 'poor') work.push('vocals cannot reach a workable level')
  if (risky.length) return { level: 'risky', reasons: [...risky, ...work] }
  if (work.length) return { level: 'workable', reasons: work }
  return {
    level: 'strong',
    reasons: [
      'no high-risk noise source nearby',
      v.panels ? `a practical ${v.panels} panels get it to mixing range` : 'already in mixing range',
    ],
  }
}
