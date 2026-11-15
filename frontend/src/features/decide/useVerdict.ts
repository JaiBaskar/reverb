import type { Tone } from '../../ui/rating'
import type { AcousticReport } from '../../types'
import type { NoiseRisk } from '../risk/types'
import { useSuitability } from '../suitability/useSuitability'
import { houseVerdict, whyMixingFails, type VerdictLevel } from './verdict'

export const VERDICT_LABEL: Record<VerdictLevel, string> = { strong: 'Great for music', workable: 'Needs work', risky: 'Risky' }
export const VERDICT_TONE: Record<VerdictLevel, Tone> = { strong: 'good', workable: 'ok', risky: 'bad' }

/** The house verdict for one room (rules in verdict.ts), plus the panel count it is based on. */
export function useVerdict(report: AcousticReport | undefined, risk: NoiseRisk | null) {
  const { suitability } = useSuitability(report)
  const fit = (id: string) => suitability?.fits.find((f) => f.use_case === id)
  const mixing = fit('mixing')
  const vocal = fit('vocal')
  if (!report || !mixing || !vocal || !risk) return null
  const panels = mixing.treatment?.panels ?? 0
  const v = houseVerdict({
    mixing: mixing.potential_level,
    vocal: vocal.potential_level,
    panels,
    high: risk.ranked.filter((r) => r.level === 'high').length,
    moderate: risk.ranked.filter((r) => r.level === 'moderate').length,
    mixingWhy: whyMixingFails(mixing),
  })
  return { ...v, panels, label: VERDICT_LABEL[v.level], tone: VERDICT_TONE[v.level] }
}
