import { useEffect, useState } from 'react'
import { searchCatalog } from '../../api'
import type { CatalogEntry } from '../../types'

const CITIES = [
  { label: 'All cities', value: '', at: null },
  { label: 'Los Angeles', value: 'Los Angeles', at: { lon: -118.33, lat: 34.06, zoom: 10 } },
  { label: 'Houston', value: 'Houston', at: { lon: -95.39, lat: 29.76, zoom: 10 } },
]

interface Props {
  selected: string | null
  onSelect: (sid: string) => void
  onCity: (at: { lon: number; lat: number; zoom: number }) => void
}

/** Search every CoStar property that has a Matterport scan (Houston and Los Angeles). */
export function DiscoveryPanel({ selected, onSelect, onCity }: Props) {
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [kind, setKind] = useState('')
  const [res, setRes] = useState<{ total: number; results: CatalogEntry[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      searchCatalog(q, city, kind)
        .then((r) => live && (setRes(r), setError(null)))
        .catch((e: Error) => live && setError(e.message))
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, city, kind])

  return (
    <div className="flex min-h-0 flex-col border-t border-zinc-800" data-testid="discovery">
      <div className="space-y-1.5 p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search address, ZIP, building name…"
          className="w-full rounded bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
          data-testid="search"
        />
        <div className="flex gap-1.5 text-xs">
          <select
            value={city}
            onChange={(e) => {
              setCity(e.target.value)
              const at = CITIES.find((c) => c.value === e.target.value)?.at
              if (at) onCity(at)
            }}
            className="rounded bg-zinc-900 px-1 py-1"
          >
            {CITIES.map((c) => (
              <option key={c.label} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded bg-zinc-900 px-1 py-1">
            <option value="">Homes and commercial</option>
            <option value="residential">Homes</option>
            <option value="commercial">Commercial</option>
          </select>
          <span className="ml-auto self-center text-zinc-500">
            {res ? `${res.total.toLocaleString()} with scans` : '…'}
          </span>
        </div>
        {error && <div className="text-xs text-red-300">{error}</div>}
      </div>
      <ul className="min-h-0 flex-1 overflow-auto" data-testid="results">
        {res?.results.map((e) => (
          <li key={e.key}>
            <button
              onClick={() => onSelect(e.sid)}
              className={`w-full px-3 py-1.5 text-left hover:bg-zinc-900 ${
                e.model_ids.includes(selected ?? '') ? 'bg-zinc-900' : ''
              }`}
            >
              <div className="flex items-center gap-1.5 text-sm">
                {e.demo_pick && <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">DEMO</span>}
                <span className="truncate">{e.address}</span>
              </div>
              <div className="truncate text-xs text-zinc-400">
                {[e.city, e.type_label ?? e.kind, e.name].filter(Boolean).join(' · ')} ·{' '}
                {e.model_ids.length} scan{e.model_ids.length > 1 ? 's' : ''}
                {e.coords_provenance === 'missing' && ' · no coordinates'}
              </div>
            </button>
          </li>
        ))}
        {res && res.total > res.results.length && (
          <li className="px-3 py-1.5 text-xs text-zinc-500">
            Showing {res.results.length} of {res.total.toLocaleString()}; refine the search.
          </li>
        )}
      </ul>
      <div className="border-t border-zinc-800 px-3 py-1 text-[11px] text-zinc-500">
        Properties and coordinates: CoStar hackathon kit. Room geometry loads from Matterport on
        selection.
      </div>
    </div>
  )
}
