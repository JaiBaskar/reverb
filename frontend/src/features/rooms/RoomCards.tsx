import { useState } from 'react'
import type { AcousticReport, Field, Room } from '../../types'
import { midRt60, RT60_BINS } from '../acoustic-visualization/classify'

export type Slot = 'A' | 'B'

const FT = 3.28084
const ft = (m: number) => `${Math.round(m * FT)}`
const exact = (f: Field) => f.provenance === 'verified' || f.provenance === 'user'

/** "14 × 11 ft · 9 ft ceiling", from whichever dimensions Matterport gave; ≈ when any is estimated. */
function roomSize(r: Room): string {
  const parts: string[] = []
  const { width_m: w, depth_m: d, height_m: h, area_m2: a } = r
  if (w.value != null && d.value != null) parts.push(`${ft(w.value)} × ${ft(d.value)} ft`)
  else if (a.value != null) parts.push(`${Math.round(a.value * FT * FT)} sq ft`)
  if (h.value != null) parts.push(`${ft(h.value)} ft ceiling`)
  if (!parts.length) return 'size unknown'
  const approx = [w, d, h, a].some((f) => f.value != null && !exact(f))
  return `${approx ? '≈ ' : ''}${parts.join(' · ')}`
}

const SLOT_STYLE = {
  A: { ring: 'ring-sky-400', chip: 'bg-sky-400 text-black' },
  B: { ring: 'ring-fuchsia-400', chip: 'bg-fuchsia-400 text-black' },
}

interface Props {
  rooms: Room[]
  reports: Record<string, AcousticReport | 'error'>
  /** Which room of this property sits in each slot. */
  picked: Record<Slot, string | null>
  /** The slot a click fills. */
  target: Slot
  onChoose: (roomId: string) => void
}

/** Each room as a card with its size and reverb time; one click puts it in the target slot. */
export function RoomCards({ rooms, reports, picked, target, onChoose }: Props) {
  const [showAll, setShowAll] = useState(false)
  const usable = rooms.filter((r) => r.usable)
  const hidden = rooms.length - usable.length
  const shown = showAll ? rooms : usable

  return (
    <div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="room-cards">
        {shown.map((r) => {
          const rep = reports[r.id]
          const slot = picked.A === r.id ? 'A' : picked.B === r.id ? 'B' : null
          const mid = rep && rep !== 'error' ? midRt60(rep) : null
          const bin = mid != null ? RT60_BINS.find((b) => mid < b.max) : null
          return (
            <li key={r.id}>
              <button
                onClick={() => onChoose(r.id)}
                disabled={!r.usable}
                className={`flex w-full items-start justify-between gap-3 rounded-xl bg-zinc-900 p-3 text-left ring-1 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 ${
                  slot ? `ring-2 ${SLOT_STYLE[slot].ring}` : 'ring-zinc-800'
                }`}
                data-testid={`room-${r.id}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-100">{r.label}</div>
                  <div className="truncate text-xs text-zinc-400">{r.usable ? roomSize(r) : r.issues.join('; ') || 'not enough geometry'}</div>
                  {r.usable && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs" title="Mid-band reverb time (500 Hz-1 kHz), modeled with typical furniture">
                      {mid == null ? (
                        <span className="text-zinc-500">{rep === 'error' ? 'could not model' : 'calculating reverb…'}</span>
                      ) : (
                        <>
                          <span className="h-2 w-2 rounded-full" style={{ background: bin?.color }} />
                          <span className="tabular-nums text-zinc-200">RT60 {mid.toFixed(2)} s</span>
                          <span className="text-zinc-500">{bin?.label.toLowerCase()}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {slot ? (
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${SLOT_STYLE[slot].chip}`}>Room {slot}</span>
                ) : (
                  r.usable && <span className="shrink-0 text-xs text-zinc-500">Use as {target}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {hidden > 0 && (
        <button className="mt-2 text-xs text-zinc-500 underline decoration-dotted hover:text-zinc-300" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide' : 'Show'} {hidden} space{hidden > 1 ? 's' : ''} without enough measurements
        </button>
      )}
    </div>
  )
}
