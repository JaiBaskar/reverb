import type { AcousticReport } from '../../types'
import type { NoiseRisk } from '../risk/types'
import { useSuitability } from '../suitability/useSuitability'
import { houseVerdict, VERDICT_RULES, type VerdictLevel } from './verdict'

const STYLE: Record<VerdictLevel, { label: string; cls: string }> = {
  strong: { label: 'Strong candidate', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' },
  workable: { label: 'Workable, needs work', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/40' },
  risky: { label: 'Risky for music', cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/40' },
}

interface Props {
  slot: 'A' | 'B'
  address: string
  roomLabel: string
  report?: AcousticReport
  risk: NoiseRisk | null
  riskLoading: boolean
}

/** One house as a music space: the room (as modeled, with furniture) and what is outside. */
export function HouseVerdict({ slot, address, roomLabel, report, risk, riskLoading }: Props) {
  const { suitability } = useSuitability(report)
  const fit = (id: string) => suitability?.fits.find((f) => f.use_case === id)
  const mixing = fit('mixing')
  const vocal = fit('vocal')
  const ranked = risk?.ranked ?? []
  const high = ranked.filter((r) => r.level === 'high')
  const moderate = ranked.filter((r) => r.level === 'moderate')
  const ready = report && mixing && vocal && risk
  const v = ready
    ? houseVerdict({
        mixing: mixing.potential_level,
        vocal: vocal.potential_level,
        panels: mixing.treatment?.panels ?? 0,
        high: high.length,
        moderate: moderate.length,
      })
    : null
  const mid = report ? (report.rt60_s[2] + report.rt60_s[3]) / 2 : null

  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-zinc-800 bg-zinc-950/40 p-4" data-testid={`verdict-${slot}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Room {slot}</div>
      <div className="truncate text-sm font-semibold text-zinc-100">{address}</div>
      <div className="mb-3 truncate text-xs text-zinc-400">Music room: {roomLabel}</div>
      {v ? (
        <div className={`mb-3 rounded-lg px-3 py-2 ring-1 ${STYLE[v.level].cls}`}>
          <div className="text-base font-bold">{STYLE[v.level].label}</div>
          <div className="text-xs opacity-90">{v.reasons.join('; ')}.</div>
        </div>
      ) : (
        <div className="mb-3 text-xs text-zinc-500">{riskLoading ? 'Checking the surroundings…' : 'Calculating…'}</div>
      )}
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-zinc-900 p-2">
          <dt className="text-zinc-400">Reverb (RT60, mid)</dt>
          <dd className="text-lg font-semibold tabular-nums">{mid != null ? `${mid.toFixed(2)} s` : '—'}</dd>
        </div>
        <div className="rounded-lg bg-zinc-900 p-2">
          <dt className="text-zinc-400">Panels for mixing</dt>
          <dd className="text-lg font-semibold tabular-nums">{mixing ? (mixing.treatment?.panels ?? 0) : '—'}</dd>
        </div>
        <div className="rounded-lg bg-zinc-900 p-2">
          <dt className="text-zinc-400">Mixing / vocals (with treatment)</dt>
          <dd className="font-semibold capitalize">
            {mixing && vocal ? `${mixing.potential_level} / ${vocal.potential_level}` : '—'}
          </dd>
        </div>
        <div className="rounded-lg bg-zinc-900 p-2">
          <dt className="text-zinc-400">Noise risks nearby</dt>
          <dd className="font-semibold">
            {risk ? (
              <>
                <span className="text-rose-300">{high.length} high</span> ·{' '}
                <span className="text-amber-300">{moderate.length} moderate</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>
      {ranked.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-zinc-300">
          {ranked.slice(0, 3).map((r) => (
            <li key={r.id} className="truncate">
              <span className={r.level === 'high' ? 'text-rose-300' : r.level === 'moderate' ? 'text-amber-300' : 'text-zinc-500'}>
                ●
              </span>{' '}
              {r.name ?? r.subtype}, {Math.round(r.distance_m)} m {r.bearing_compass} · {r.when}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function VerdictRules() {
  return (
    <details className="text-[11px] text-zinc-500">
      <summary className="cursor-pointer">How the verdict is decided</summary>
      <ul className="ml-4 mt-1 list-disc">
        {VERDICT_RULES.map((r) => (
          <li key={r}>{r}</li>
        ))}
        <li>
          Room levels are the best achievable with practical panels, from the modeled room (furniture included). Noise
          risk is a relative ranking of mapped sources, not a sound level.
        </li>
      </ul>
    </details>
  )
}
