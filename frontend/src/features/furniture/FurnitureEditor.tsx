import { useState } from 'react'
import type { FurnitureItem } from '../../types'
import { useFurnitureCatalog } from './useFurnitureCatalog'

interface Props {
  /** What the model currently uses (the report's furniture, defaults included). */
  current: FurnitureItem[]
  /** True when the user has edited the list (sent explicitly to the backend). */
  edited: boolean
  onChange: (items: FurnitureItem[] | undefined) => void
  compact?: boolean
}

/**
 * Furniture counts toward absorption (sofas, beds, rugs, curtains) and so changes RT60, the
 * heatmap and the advice. Matterport does not detect furniture for these scans, so the default
 * is typical for the room type (assumed); look at the 3D tour and correct it.
 */
export function FurnitureEditor({ current, edited, onChange, compact }: Props) {
  const cat = useFurnitureCatalog()
  const [adding, setAdding] = useState('')
  const set = (items: FurnitureItem[]) =>
    onChange(items.filter((i) => i.count > 0).map((i) => ({ id: i.id, count: i.count, provenance: 'user' })))
  const bump = (id: string, d: number) => {
    const has = current.some((i) => i.id === id)
    set(has ? current.map((i) => (i.id === id ? { ...i, count: i.count + d } : i)) : [...current, { id, count: 1 }])
  }

  return (
    <div className={`text-xs ${compact ? '' : 'rounded-lg bg-zinc-950/50 p-3'}`} data-testid="furniture-editor">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-zinc-200">Furniture</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
            edited ? 'bg-violet-500/20 text-violet-300' : 'bg-orange-500/20 text-orange-300'
          }`}
        >
          {edited ? 'your list' : 'assumed for this room type'}
        </span>
      </div>
      {current.length === 0 ? (
        <p className="mb-1.5 text-zinc-500">Empty room: no furniture counted.</p>
      ) : (
        <ul className="mb-1.5 space-y-1">
          {current.map((it) => (
            <li key={it.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-zinc-300">{cat?.[it.id]?.label ?? it.id}</span>
              <button className="h-5 w-5 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => bump(it.id, -1)} aria-label={`One less ${it.id}`}>
                −
              </button>
              <span className="w-4 text-center tabular-nums">{it.count}</span>
              <button className="h-5 w-5 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => bump(it.id, 1)} aria-label={`One more ${it.id}`}>
                +
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={adding}
          onChange={(e) => {
            if (e.target.value) bump(e.target.value, 1)
            setAdding('')
          }}
          className="rounded bg-zinc-900 px-1.5 py-1"
          aria-label="Add furniture"
        >
          <option value="">+ Add item…</option>
          {Object.entries(cat ?? {}).map(([id, f]) => (
            <option key={id} value={id}>
              {f.label}
            </option>
          ))}
        </select>
        <button className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700" onClick={() => onChange([])}>
          Empty room
        </button>
        {edited && (
          <button className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700" onClick={() => onChange(undefined)}>
            Reset to typical
          </button>
        )}
      </div>
      {!compact && (
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Matterport does not detect furniture in these scans; compare with the 3D tour and correct the list.
          Typical absorption per item, not measured.
        </p>
      )}
    </div>
  )
}
