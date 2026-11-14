import type { FitBasis, VizMode } from './classify'
import { legendFor } from './classify'
import { USE_CASES } from './useCases'


const MODES: { id: VizMode; label: string }[] = [
  { id: 'fit', label: 'Suitability' },
  { id: 'rt60', label: 'Reverb (RT60)' },
  { id: 'bass', label: 'Bass / modes' },
]

interface Props {
  mode: VizMode
  useCase: string
  basis: FitBasis
  onMode: (m: VizMode) => void
  onUseCase: (u: string) => void
  /** Omit to hide the as-modeled / room-shape toggle. */
  onBasis?: (b: FitBasis) => void
}

const seg = (on: boolean) =>
  `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${on ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:bg-zinc-800'}`

export function VizControls({ mode, useCase, basis, onMode, onUseCase, onBasis }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="viz-controls">
      <div className="flex rounded-lg bg-zinc-900/90 p-0.5 ring-1 ring-zinc-800" role="radiogroup" aria-label="Heatmap view">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={seg(mode === m.id)} onClick={() => onMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'fit' && (
        <>
          <select
            value={useCase}
            onChange={(e) => onUseCase(e.target.value)}
            aria-label="Use case"
            className="rounded-lg bg-zinc-900/90 px-2 py-1.5 text-xs ring-1 ring-zinc-800"
            data-testid="use-case"
          >
            {USE_CASES.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
          {onBasis && (
          <div className="flex rounded-lg bg-zinc-900/90 p-0.5 ring-1 ring-zinc-800" role="radiogroup" aria-label="Fit basis">
            <button
              role="radio"
              aria-checked={basis === 'modeled'}
              className={seg(basis === 'modeled')}
              onClick={() => onBasis('modeled')}
              title="Every check, for the empty room with the assumed materials (what you hear)"
            >
              As modeled
            </button>
            <button
              role="radio"
              aria-checked={basis === 'shape'}
              className={seg(basis === 'shape')}
              onClick={() => onBasis('shape')}
              title="Only checks treatment cannot change: size, height, bass-mode spacing, reflection timing"
            >
              Room shape only
            </button>
          </div>
          )}
        </>
      )}
    </div>
  )
}

export function HeatmapLegend({ mode, basis }: { mode: VizMode; basis: FitBasis }) {
  const caption =
    mode === 'fit'
      ? basis === 'modeled'
        ? 'Rule-of-thumb fit for the empty room with assumed materials.'
        : 'Only what treatment cannot change: size, height, bass modes, reflection timing.'
      : mode === 'rt60'
        ? 'Mid-band (500 Hz–1 kHz) Eyring RT60. Colour groups values; it is not a verdict.'
        : 'Schroeder frequency: below it, individual room modes dominate.'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" data-testid="heatmap-legend">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {legendFor(mode).map((b) => (
          <span key={b.key} className="flex items-center gap-1.5" title={b.hint}>
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-zinc-400">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-zinc-500" />
          Not modeled
        </span>
      </div>
      <div className="text-zinc-400">{caption} One colour per room, not a point-by-point map.</div>
    </div>
  )
}
