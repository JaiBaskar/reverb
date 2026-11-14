import type { Provenance } from '../../types'
import type { Fact } from './types'
import { useFacts } from './useFacts'

// Same badge colours as the room table (features/rooms/RoomPicker.tsx).
const BADGE: Record<Provenance, string> = {
  verified: 'bg-emerald-500/20 text-emerald-300',
  estimated: 'bg-amber-500/20 text-amber-300',
  assumed: 'bg-orange-500/20 text-orange-300',
  user: 'bg-violet-500/20 text-violet-300',
  missing: 'bg-zinc-600/30 text-zinc-400',
}

function show(f: Fact): string {
  if (f.value === null) return '—'
  if (typeof f.value === 'boolean') return f.value ? 'Yes' : 'No'
  if (typeof f.value === 'number' && f.key !== 'year_built') {
    return `${f.value.toLocaleString()}${f.unit ? ` ${f.unit.replace('m2', 'm²')}` : ''}`
  }
  return `${f.value}${f.unit ? ` ${f.unit}` : ''}`
}

/** CoStar facts for the selected property, each with its provenance. */
export function FactsCard({ sid }: { sid: string }) {
  const { facts, error } = useFacts(sid)
  return (
    <div className="mb-3 rounded border border-zinc-800 p-3 text-sm" data-testid="facts-card">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Property facts</h3>
        <span className="text-xs text-zinc-500">
          {facts?.kind ? `CoStar ${facts.kind} record` : 'CoStar'}
        </span>
      </div>
      {error && <div className="text-red-300">{error}</div>}
      {!facts && !error && <div className="text-zinc-500">Loading…</div>}
      {facts?.status === 'unavailable' && <div className="text-amber-300">{facts.notes.join(' ')}</div>}
      {facts?.status === 'ok' && (
        <>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {facts.facts.map((f) => (
              <div key={f.key} className="flex items-baseline justify-between gap-2" title={f.note ?? f.source ?? ''}>
                <dt className="text-zinc-400">{f.label}</dt>
                <dd className="flex items-baseline gap-1.5 text-right">
                  <span className={f.value === null ? 'text-zinc-500' : ''}>{show(f)}</span>
                  <span className={`rounded px-1 py-px text-[10px] uppercase ${BADGE[f.provenance]}`}>
                    {f.provenance}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          {facts.material_hints.length > 0 && (
            <p className="mt-2 text-xs text-zinc-400" data-testid="material-hints">
              Material hint:{' '}
              {facts.material_hints.map((h) => `${h.surface} → ${h.material_id} (${h.reason})`).join('; ')} Set it in
              the material editor below.
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            Hover a row for its note. Source: {facts.data_source}
            {facts.costar_id ? ` · record ${facts.costar_id}` : ''}.
          </p>
        </>
      )}
    </div>
  )
}
