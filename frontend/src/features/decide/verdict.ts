import type { FitLevel } from '../suitability/types'

export interface VerdictInput {
  mixing: FitLevel // best achievable (with practical treatment) for mixing
  vocal: FitLevel // best achievable for vocal recording
  panels: number // panels to reach the mixing target
  high: number // high-risk neighbours (noise-risk ranking)
  moderate: number
}

export type VerdictLevel = 'strong' | 'workable' | 'risky'

export const PANEL_LIMIT = 20
export const MODERATE_LIMIT = 4

/** Transparent rules over the computed results; the card prints them. Not a score. */
export const VERDICT_RULES = [
  `Risky: any high-risk neighbour, or the room cannot reach "workable" for mixing even with treatment.`,
  `Needs work: more than ${PANEL_LIMIT} panels, more than ${MODERATE_LIMIT} moderate-risk neighbours, or vocals cannot reach "workable".`,
  'Strong candidate: everything else.',
]

export function houseVerdict(v: VerdictInput): { level: VerdictLevel; reasons: string[] } {
  const risky: string[] = []
  const work: string[] = []
  if (v.high > 0) risky.push(`${v.high} high-risk noise source${v.high > 1 ? 's' : ''} nearby`)
  if (v.mixing === 'poor') risky.push('the room cannot reach a workable mixing level even with panels')
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
