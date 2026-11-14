import { useState } from 'react'
import { CATEGORY_COLOR } from '../noise/colors'
import type { NoiseReport } from '../noise/types'

interface Props {
  report: NoiseReport
  enabled: string[]
  onChange: (enabled: string[]) => void
  heat?: { on: boolean; onChange: (on: boolean) => void }
}

/** Toggle noise-source categories on the main map. */
export function NoiseLegend({ report, enabled, onChange, heat }: Props) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640)
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute right-2 top-2 z-10 rounded bg-zinc-950/90 px-2 py-1 text-[11px] font-semibold text-zinc-200 shadow"
        data-testid="noise-legend-open"
      >
        Noise layers
      </button>
    )
  const counts = Object.fromEntries(report.exposure.map((e) => [e.category, e.count]))
  const cats = report.exposure.filter((e) => e.count > 0)
  return (
    <div
      className="absolute right-2 top-2 z-10 max-h-[70%] w-56 overflow-auto rounded bg-zinc-950/90 p-2 text-[11px] shadow"
      data-testid="noise-legend"
    >
      <div className="mb-1 flex items-center justify-between font-semibold text-zinc-200">
        Noise sources
        <span className="space-x-1 font-normal">
          <button className="text-zinc-400" onClick={() => setOpen(false)} aria-label="Collapse noise layers">
            ✕
          </button>
          <button className="text-sky-300" onClick={() => onChange(cats.map((c) => c.category))}>
            all
          </button>
          <button className="text-sky-300" onClick={() => onChange([])}>
            none
          </button>
        </span>
      </div>
      {heat && (
        <label className="mb-1 flex cursor-pointer items-center gap-1.5 border-b border-zinc-800 pb-1 font-medium text-zinc-200">
          <input type="checkbox" checked={heat.on} onChange={(e) => heat.onChange(e.target.checked)} data-testid="risk-heat-toggle" />
          <span className="inline-block h-2.5 w-6 rounded-sm bg-gradient-to-r from-yellow-400 via-orange-500 to-red-600" />
          Noise-risk heatmap
        </label>
      )}
      {cats.map((c) => (
        <label key={c.category} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-zinc-300">
          <input
            type="checkbox"
            checked={enabled.includes(c.category)}
            onChange={(e) =>
              onChange(e.target.checked ? [...enabled, c.category] : enabled.filter((x) => x !== c.category))
            }
          />
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[c.category] }} />
          <span className="flex-1 truncate" title={c.label}>
            {c.label}
          </span>
          <span className="text-zinc-500">{counts[c.category]}</span>
        </label>
      ))}
      {cats.length === 0 && <div className="text-zinc-500">None mapped nearby.</div>}
      <div className="mt-1 text-zinc-500">
        Dashed rings: 100, 250, 500 m. Heat = mapped sources weighted by how intrusive that kind usually is (assumed); not measured noise.
      </div>
    </div>
  )
}
