import type { CatalogEntry } from '../../types'
import { thumbUrl } from '../../ui/format'

interface Props {
  results: CatalogEntry[] | null
  total: number | null
  error: string | null
  hovered: string | null
  onHover: (sid: string | null) => void
  onOpen: (sid: string) => void
  /** Compare mode: the homes picked so far (null when not comparing). */
  picked?: string[] | null
}

/** Listing cards: scan photo, address, type. Two columns on wide panels, like a home-search results list. */
export function Results({ results, total, error, hovered, onHover, onOpen, picked = null }: Props) {
  return (
    <div className="p-4" data-testid="results">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{picked ? 'Pick two homes to compare' : 'Places with a 3D scan'}</h2>
        <span className="text-sm text-mute">{total == null ? '' : `${total.toLocaleString()} results`}</span>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      {results == null && !error && <p className="text-sm text-mute">Loading…</p>}
      {results?.length === 0 && <p className="text-sm text-mute">No matches. Try another search.</p>}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {results?.map((e) => (
          <li key={e.key}>
            <button
              onClick={() => onOpen(e.sid)}
              onMouseEnter={() => onHover(e.sid)}
              onMouseLeave={() => onHover(null)}
              className={`group w-full overflow-hidden rounded-2xl border text-left transition hover:shadow-lg ${
                picked?.includes(e.sid) ? 'border-accent ring-2 ring-accent' : hovered === e.sid ? 'border-ink' : 'border-line'
              }`}
              data-testid={`result-${e.sid}`}
            >
              <div className="relative aspect-[16/10] bg-soft">
                <img src={thumbUrl(e.sid)} alt="" loading="lazy" className="h-full w-full object-cover" />
                {picked?.includes(e.sid) && (
                  <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-paper">
                    {picked.indexOf(e.sid) === 0 ? 'Home 1' : 'Home 2'}
                  </span>
                )}
                <span className="absolute bottom-2 left-2 rounded-full bg-ink/80 px-2 py-0.5 text-[11px] font-semibold text-paper">3D</span>
              </div>
              <div className="p-3">
                <div className="truncate font-semibold">{e.address}</div>
                <div className="truncate text-sm text-mute">
                  {[e.city, e.type_label ?? (e.kind === 'residential' ? 'Home' : 'Commercial')].filter(Boolean).join(' · ')}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {results && total != null && total > results.length && (
        <p className="mt-4 text-center text-sm text-mute">Showing {results.length}. Search to narrow down.</p>
      )}
    </div>
  )
}
