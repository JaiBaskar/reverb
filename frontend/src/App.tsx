import { useEffect, useState } from 'react'
import { fetchMaterials, fetchProperties, fetchRooms } from './api'
import { PropertyMap } from './features/map/PropertyMap'
import { AudioLab } from './features/audio/AudioLab'
import { MaterialEditor } from './features/materials/MaterialEditor'
import { NoisePanel } from './features/noise/NoisePanel'
import { SuitabilityPanel } from './features/suitability/SuitabilityPanel'
import { Explanation } from './features/numbers/Explanation'
import { NumbersPanel } from './features/numbers/NumbersPanel'
import { useComparison } from './features/numbers/useComparison'
import { useReport } from './features/numbers/useReport'
import { RoomPicker, type Slot } from './features/rooms/RoomPicker'
import type { MaterialCatalog, MaterialSelection, Property, Room } from './types'

export default function App() {
  const [properties, setProperties] = useState<Property[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [picked, setPicked] = useState<Record<Slot, string | null>>({ A: null, B: null })
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<MaterialCatalog | null>(null)
  const [materials, setMaterials] = useState<Record<Slot, MaterialSelection>>({ A: {}, B: {} })

  useEffect(() => {
    fetchProperties()
      .then(setProperties)
      .catch((e: Error) => setError(e.message))
    fetchMaterials()
      .then(setCatalog)
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
    setRooms(null)
    setError(null)
    setPicked({ A: null, B: null })
    setMaterials({ A: {}, B: {} })
  }

  const prop = properties.find((p) => p.sid === selected)
  const repA = useReport(selected, picked.A, materials.A)
  const repB = useReport(selected, picked.B, materials.B)
  const cmp = useComparison(
    { sid: selected, roomId: picked.A, materials: materials.A },
    { sid: selected, roomId: picked.B, materials: materials.B },
  )
  const maxRt60 = Math.max(0.1, ...(repA.report?.rt60_s ?? []), ...(repB.report?.rt60_s ?? []))
  const usableCount = rooms?.filter((r) => r.usable).length ?? 0
  const sameRoom =
    picked.A != null &&
    picked.A === picked.B &&
    JSON.stringify(materials.A) === JSON.stringify(materials.B)

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-zinc-800 px-4 py-2">
        <span className="text-lg font-bold tracking-wide">REVERB</span>
        <span className="ml-3 text-sm text-zinc-400">
          Hear your future studio before you move in. Room data from Matterport; acoustics are modeled.
        </span>
      </header>
      {error && <div className="bg-red-900/50 px-4 py-2 text-sm">Error: {error}</div>}
      <main className="min-h-0 flex-1 overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:overflow-hidden">
        <section className="flex flex-col border-zinc-800 lg:min-h-0 lg:border-r">
          <div className="h-64 lg:h-auto lg:min-h-0 lg:flex-1">
            <PropertyMap properties={properties} selected={selected} onSelect={selectProperty} />
          </div>
          <ul className="max-h-56 overflow-auto border-t border-zinc-800">
            {properties.length === 0 && !error && (
              <li className="px-4 py-2 text-sm text-zinc-500">Loading properties…</li>
            )}
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
        <section className="p-4 lg:min-h-0 lg:overflow-auto">
          {!prop ? (
            <p className="text-zinc-400">Select a property on the map or list.</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold">{prop.address}</h2>
              <p className="mb-3 text-xs text-zinc-400">{prop.name}</p>
              {rooms == null ? (
                <p className="text-sm text-zinc-500">Loading rooms from Matterport…</p>
              ) : (
                <>
                  {usableCount < 2 && (
                    <p className="mb-2 rounded bg-amber-900/40 px-2 py-1 text-xs text-amber-200">
                      Only {usableCount} room(s) here have enough Matterport geometry to model. A
                      comparison needs two.
                    </p>
                  )}
                  <RoomPicker
                    rooms={rooms}
                    picked={picked}
                    onPick={(s, id) => setPicked((x) => ({ ...x, [s]: id }))}
                  />
                </>
              )}
              {sameRoom && (
                <p className="mt-2 text-xs text-amber-300">
                  Room A and B are the same room with the same materials; pick another room or change
                  materials to hear a difference.
                </p>
              )}
              <AudioLab
                sid={prop.sid}
                roomA={rooms?.find((r) => r.id === picked.A) ?? null}
                roomB={rooms?.find((r) => r.id === picked.B) ?? null}
                materials={materials}
              />
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="selection">
                {(['A', 'B'] as Slot[]).map((slot) => (
                  <div key={slot} className="min-w-0">
                    {catalog && (
                      <MaterialEditor
                        slot={slot}
                        catalog={catalog}
                        value={materials[slot]}
                        onChange={(v) => setMaterials((m) => ({ ...m, [slot]: v }))}
                      />
                    )}
                    <NumbersPanel slot={slot} {...(slot === 'A' ? repA : repB)} maxRt60={maxRt60} />
                  </div>
                ))}
              </div>
              <Explanation {...cmp} />
              <SuitabilityPanel a={repA.report} b={repB.report} />
              <NoisePanel sid={prop.sid} />
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
