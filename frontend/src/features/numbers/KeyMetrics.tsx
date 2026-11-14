import type { AcousticReport } from '../../types'

const mid = (r: AcousticReport) => {
  const i500 = r.bands_hz.indexOf(500)
  const i1k = r.bands_hz.indexOf(1000)
  return (r.rt60_s[i500] + r.rt60_s[i1k]) / 2
}
const lowestMode = (r: AcousticReport) =>
  r.modes.length ? Math.min(...r.modes.map((m) => m.freq_hz)) : null
const firstReflection = (r: AcousticReport) =>
  r.early_reflections.length ? Math.min(...r.early_reflections.map((e) => e.delay_ms)) : null

/** The few numbers that matter first, per room; the full report sits behind "details". */
export function KeyMetrics({ slot, report: r }: { slot: 'A' | 'B'; report: AcousticReport }) {
  const lm = lowestMode(r)
  const fr = firstReflection(r)
  const accent = slot === 'A' ? 'text-sky-300' : 'text-fuchsia-300'
  const items: { label: string; value: string; help: string }[] = [
    {
      label: 'Reverb time (RT60, mid)',
      value: `${mid(r).toFixed(2)} s`,
      help: 'Average of the 500 Hz and 1 kHz bands: how long a sound takes to fade by 60 dB.',
    },
    { label: 'Volume', value: `${r.geometry.volume_m3.toFixed(0)} m³`, help: 'Floor area × ceiling height.' },
    {
      label: 'Schroeder frequency',
      value: `${r.schroeder_hz.toFixed(0)} Hz`,
      help: 'Below this, individual room modes (boomy notes) dominate.',
    },
    {
      label: 'Lowest room mode',
      value: lm == null ? '—' : `${lm.toFixed(0)} Hz`,
      help: 'The deepest axial resonance of the equivalent box.',
    },
    {
      label: 'First reflection',
      value: fr == null ? '—' : `${fr.toFixed(1)} ms`,
      help: 'Delay of the earliest surface reflection after the direct sound.',
    },
  ]
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid={`key-metrics-${slot}`}>
      {items.map((it, i) => (
        <div key={it.label} className={`rounded-lg bg-zinc-950/60 p-2 ${i === 0 ? 'col-span-2 sm:col-span-1' : ''}`} title={it.help}>
          <dt className="text-[11px] text-zinc-400">{it.label}</dt>
          <dd className={`text-lg font-semibold tabular-nums ${i === 0 ? accent : 'text-zinc-100'}`}>{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}
