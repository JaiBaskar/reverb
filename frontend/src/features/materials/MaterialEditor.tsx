import type { MaterialCatalog, MaterialSelection, Surface } from '../../types'

const SURFACES: Surface[] = ['floor', 'walls', 'ceiling']

interface Props {
  slot: 'A' | 'B'
  catalog: MaterialCatalog
  value: MaterialSelection
  onChange: (v: MaterialSelection) => void
}

/** Assumed surface materials for a room; changing one re-runs the numbers and the impulse response. */
export function MaterialEditor({ slot, catalog, value, onChange }: Props) {
  return (
    <div className="mb-2 rounded border border-zinc-800 p-2 text-xs" data-testid={`materials-${slot}`}>
      <div className="mb-1 text-zinc-400">
        Room {slot} materials <span className="text-orange-300">(assumed, edit to explore)</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SURFACES.map((s) => {
          const current = value[s] ?? catalog.defaults[s]
          return (
            <label key={s} className="block">
              <span className="capitalize text-zinc-400">{s}</span>
              <select
                value={current}
                onChange={(e) => onChange({ ...value, [s]: e.target.value })}
                className={`mt-0.5 w-full rounded bg-zinc-900 px-1 py-1 ${
                  current !== catalog.defaults[s] ? 'ring-1 ring-amber-500' : ''
                }`}
              >
                {Object.entries(catalog.materials).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </div>
  )
}
