import type { Field, Provenance, Room } from '../../types'

export type Slot = 'A' | 'B'

const BADGE: Record<Provenance, string> = {
  verified: 'bg-emerald-500/20 text-emerald-300',
  estimated: 'bg-amber-500/20 text-amber-300',
  assumed: 'bg-orange-500/20 text-orange-300',
  missing: 'bg-zinc-600/30 text-zinc-400',
}

function Cell({ f, unit }: { f: Field; unit: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={f.note ?? f.provenance}>
      <span>{f.value == null ? '—' : `${f.value.toFixed(2)} ${unit}`}</span>
      <span className={`rounded px-1 text-[10px] uppercase ${BADGE[f.provenance]}`}>
        {f.provenance}
      </span>
    </span>
  )
}

interface Props {
  rooms: Room[]
  picked: Record<Slot, string | null>
  onPick: (slot: Slot, roomId: string) => void
}

export function RoomPicker({ rooms, picked, onPick }: Props) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2 text-xs text-zinc-400">
        Dimension provenance:
        {(Object.keys(BADGE) as Provenance[]).map((p) => (
          <span key={p} className={`rounded px-1 uppercase ${BADGE[p]}`}>
            {p}
          </span>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-400">
          <tr>
            <th className="py-1">Room</th>
            <th>Area</th>
            <th>Width</th>
            <th>Depth</th>
            <th>Height</th>
            <th>Pick</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id} className={`border-t border-zinc-800 ${r.usable ? '' : 'opacity-40'}`}>
              <td className="py-1.5">
                {r.label}
                {!r.usable && <div className="text-[11px] text-zinc-500">{r.issues.join('; ')}</div>}
              </td>
              <td><Cell f={r.area_m2} unit="m²" /></td>
              <td><Cell f={r.width_m} unit="m" /></td>
              <td><Cell f={r.depth_m} unit="m" /></td>
              <td><Cell f={r.height_m} unit="m" /></td>
              <td className="space-x-1 whitespace-nowrap">
                {(['A', 'B'] as Slot[]).map((s) => (
                  <button
                    key={s}
                    disabled={!r.usable}
                    onClick={() => onPick(s, r.id)}
                    className={`rounded px-2 py-0.5 text-xs font-semibold disabled:cursor-not-allowed ${
                      picked[s] === r.id ? 'bg-amber-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
