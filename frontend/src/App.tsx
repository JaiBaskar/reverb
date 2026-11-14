import { useEffect, useState } from 'react'
import { fetchProperties, fetchRooms } from './api'
import { PropertyMap } from './features/map/PropertyMap'
import { NumbersPanel } from './features/numbers/NumbersPanel'
import { useReport } from './features/numbers/useReport'
import { RoomPicker, type Slot } from './features/rooms/RoomPicker'
import type { Property, Room } from './types'

export default function App() {
  const [properties, setProperties] = useState<Property[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [picked, setPicked] = useState<Record<Slot, string | null>>({ A: null, B: null })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchProperties()
      .then(setProperties)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!selected) return
    fetchRooms(selected)
      .then(setRooms)
      .catch((e: Error) => setError(e.message))
  }, [selected])

  const selectProperty = (sid: string) => {
    setSelected(sid)
    setRooms([])
    setPicked({ A: null, B: null })
  }

  const prop = properties.find((p) => p.sid === selected)
  const repA = useReport(selected, picked.A)
  const repB = useReport(selected, picked.B)
  const maxRt60 = Math.max(0.1, ...(repA.report?.rt60_s ?? []), ...(repB.report?.rt60_s ?? []))

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-zinc-800 px-4 py-2">
        <span className="text-lg font-bold tracking-wide">REVERB</span>
        <span className="ml-3 text-sm text-zinc-400">
          Hear your future studio before you move in. Room data from Matterport; acoustics are modeled.
        </span>
      </header>
      {error && <div className="bg-red-900/50 px-4 py-2 text-sm">Error: {error}</div>}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="flex min-h-0 flex-col border-r border-zinc-800">
          <div className="min-h-0 flex-1"><PropertyMap properties={properties} selected={selected} onSelect={selectProperty} /></div>
          <ul className="max-h-56 overflow-auto border-t border-zinc-800">
            {properties.map((p) => (
              <li key={p.sid}>
                <button
                  onClick={() => selectProperty(p.sid)}
                  className={`w-full px-4 py-2 text-left hover:bg-zinc-900 ${p.sid === selected ? 'bg-zinc-900' : ''}`}
                >
                  <div className="text-sm font-medium">{p.address ?? p.name}</div>
                  <div className="text-xs text-zinc-400">
                    {p.name} · {p.usable_room_count}/{p.room_count} usable rooms
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-h-0 overflow-auto p-4">
          {!prop ? (
            <p className="text-zinc-400">Select a property on the map or list.</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold">{prop.address}</h2>
              <p className="mb-3 text-xs text-zinc-400">{prop.name}</p>
              <RoomPicker rooms={rooms} picked={picked} onPick={(s, id) => setPicked((x) => ({ ...x, [s]: id }))} />
              <div className="mt-4 grid grid-cols-2 gap-3" data-testid="selection">
                <NumbersPanel slot="A" {...repA} maxRt60={maxRt60} />
                <NumbersPanel slot="B" {...repB} maxRt60={maxRt60} />
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                All acoustic values are modeled approximations from room geometry and assumed materials, not measurements.
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
