import type { AcousticReport } from '../../types'

interface Props {
  slot: 'A' | 'B'
  report?: AcousticReport
  error?: string
  loading: boolean
  maxRt60: number
}

export function NumbersPanel({ slot, report, error, loading, maxRt60 }: Props) {
  return (
    <div className="rounded border border-zinc-800 p-3 text-sm" data-testid={`numbers-${slot}`}>
      <div className="text-xs text-zinc-400">Room {slot}</div>
      {error && <div className="text-red-300">{error}</div>}
      {loading && <div className="text-zinc-500">Calculating…</div>}
      {!report && !loading && !error && <div className="text-zinc-500">not chosen</div>}
      {report && <Report slot={slot} report={report} maxRt60={maxRt60} />}
    </div>
  )
}

function Report({
  slot,
  report: r,
  maxRt60,
}: {
  slot: 'A' | 'B'
  report: AcousticReport
  maxRt60: number
}) {
  const g = r.geometry
  return (
    <div className="space-y-3">
      <div>
        <div className="font-medium">{r.label}</div>
        <div className="text-xs text-zinc-400">
          {g.area_m2.value?.toFixed(1)} m² × {g.height_m.value?.toFixed(2)} m ={' '}
          <b className="text-zinc-200">{g.volume_m3.toFixed(1)} m³</b> · equivalent box{' '}
          {g.equivalent_width_m.toFixed(2)} × {g.equivalent_depth_m.toFixed(2)} m
        </div>
        {g.note && <div className="mt-1 text-xs text-amber-300">{g.note}</div>}
      </div>

      <div>
        <div className="mb-1 text-xs text-zinc-400">
          RT60 by octave band (Sabine, modeled) · materials:{' '}
          {r.materials.map((m) => `${m.surface}: ${m.label}${m.provenance === 'user' ? ' (your choice)' : ''}`).join(' · ')}
        </div>
        <div className="space-y-0.5">
          {r.bands_hz.map((hz, i) => (
            <div key={hz} className="flex items-center gap-2 text-xs">
              <span className="w-12 text-right text-zinc-400">{hz} Hz</span>
              <div className="h-3 flex-1 rounded bg-zinc-900">
                <div
                  className={`h-3 rounded ${slot === 'A' ? 'bg-sky-500' : 'bg-fuchsia-500'}`}
                  style={{ width: `${Math.min(100, (r.rt60_s[i] / maxRt60) * 100)}%` }}
                />
              </div>
              <span className="w-12 tabular-nums">{r.rt60_s[i].toFixed(2)} s</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs">
        Schroeder frequency: <b className="text-zinc-200">{r.schroeder_hz.toFixed(0)} Hz</b>
        <span className="text-zinc-400"> (below this, room modes dominate)</span>
      </div>

      <div className="text-xs">
        <span className="text-zinc-400">Axial modes below 100 Hz: </span>
        {r.modes
          .filter((m) => m.freq_hz < 100)
          .map((m) => `${m.freq_hz.toFixed(1)} (${m.axis})`)
          .join(', ') || 'none'}
      </div>

      <div className="text-xs">
        <div className="text-zinc-400">First-order reflections after the direct sound</div>
        <div className="grid grid-cols-3 gap-x-3">
          {r.early_reflections.map((e) => (
            <span key={e.surface}>
              {e.surface}: {e.delay_ms.toFixed(1)} ms
            </span>
          ))}
        </div>
      </div>

      <details className="text-xs text-zinc-400">
        <summary className="cursor-pointer">Assumptions and warnings</summary>
        <ul className="ml-4 list-disc">
          {r.assumptions.map((a) => <li key={a}>{a}</li>)}
          {r.warnings.map((w) => <li key={w} className="text-amber-300">{w}</li>)}
        </ul>
        <div className="mt-1">{r.method}</div>
      </details>
    </div>
  )
}
