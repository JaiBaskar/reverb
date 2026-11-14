import { useEffect, useState } from 'react'
import { fetchCatalogPoints, fetchMaterials, fetchProperty, fetchRooms, searchCatalog } from './api'
import { PropertyMap } from './features/map/PropertyMap'
import { AudioLab } from './features/audio/AudioLab'
import { DiscoveryPanel } from './features/discovery/DiscoveryPanel'
import { FactsCard } from './features/facts/FactsCard'
import { MaterialEditor } from './features/materials/MaterialEditor'
import { NoisePanel } from './features/noise/NoisePanel'
import { NoiseScoutPanel } from './features/noise-scout/NoiseScoutPanel'
import { SuitabilityPanel } from './features/suitability/SuitabilityPanel'
import { Explanation } from './features/numbers/Explanation'
import { NumbersPanel } from './features/numbers/NumbersPanel'
import { useComparison } from './features/numbers/useComparison'
import { useReport } from './features/numbers/useReport'
import { CustomRoomForm } from './features/rooms/CustomRoomForm'
import { RoomPicker, type Slot } from './features/rooms/RoomPicker'
import { customRoomToRoom, type CustomRoomSpec, type SlotRef } from './roomRef'
import type {
  CatalogEntry,
  CatalogPoints,
  MaterialCatalog,
  MaterialSelection,
  Property,
  Room,
} from './types'

export default function App() {
  const [points, setPoints] = useState<CatalogPoints | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [prop, setProp] = useState<Property | null>(null)
  const [entry, setEntry] = useState<CatalogEntry | null>(null)
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; zoom: number; key: number } | null>(null)
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [customRooms, setCustomRooms] = useState<CustomRoomSpec[]>([])
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<Slot, SlotRef | null>>({ A: null, B: null })
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<MaterialCatalog | null>(null)
  const [materials, setMaterials] = useState<Record<Slot, MaterialSelection>>({ A: {}, B: {} })

  useEffect(() => {
    fetchCatalogPoints()
      .then(setPoints)
      .catch((e: Error) => setError(e.message))
    fetchMaterials()
      .then(setCatalog)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!selected) return
    let live = true
    fetchProperty(selected)
      .then((p) => live && setProp(p))
      .catch((e: Error) => live && setError(`Could not load this property from Matterport (${e.message}).`))
    fetchRooms(selected)
      .then((r) => live && setRooms(r))
      .catch((e: Error) => {
        if (!live) return
        setRooms([])
        setRoomsError(`No room geometry from Matterport (${e.message}). Enter rooms by hand below.`)
      })
    searchCatalog(selected, '', '', 1)
      .then((r) => live && setEntry(r.results[0] ?? null))
      .catch(() => live && setEntry(null))
    return () => {
      live = false
    }
  }, [selected])

  // Switching property keeps the A/B slots, so rooms from different properties can be compared.
  const selectProperty = (sid: string) => {
    setSelected(sid)
    setProp(null)
    setRooms(null)
    setCustomRooms([])
    setRoomsError(null)
    setError(null)
  }

  const repA = useReport(picked.A?.sid ?? null, picked.A?.roomId ?? null, materials.A)
  const repB = useReport(picked.B?.sid ?? null, picked.B?.roomId ?? null, materials.B)
  const cmp = useComparison(
    { sid: picked.A?.sid ?? null, roomId: picked.A?.roomId ?? null, materials: materials.A },
    { sid: picked.B?.sid ?? null, roomId: picked.B?.roomId ?? null, materials: materials.B },
  )
  const maxRt60 = Math.max(0.1, ...(repA.report?.rt60_s ?? []), ...(repB.report?.rt60_s ?? []))
  const allRooms = rooms == null ? null : [...rooms, ...customRooms.map(customRoomToRoom)]
  const usableCount = allRooms?.filter((r) => r.usable).length ?? 0
  const sameRoom =
    picked.A != null &&
    picked.B != null &&
    picked.A.sid === picked.B.sid &&
    picked.A.roomId === picked.B.roomId &&
    JSON.stringify(materials.A) === JSON.stringify(materials.B)
  const address = entry?.address ?? prop?.address ?? selected ?? ''
  const pickedHere = {
    A: picked.A?.sid === selected ? picked.A.roomId : null,
    B: picked.B?.sid === selected ? picked.B.roomId : null,
  }
  const pick = (slot: Slot, roomId: string) => {
    const room = allRooms?.find((r) => r.id === roomId)
    if (!selected || !room) return
    setPicked((x) => ({ ...x, [slot]: { sid: selected, roomId, label: room.label, address } }))
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-zinc-800 px-4 py-2">
        <span className="text-lg font-bold tracking-wide">REVERB</span>
        <span className="ml-3 text-sm text-zinc-400">
          Hear your future studio before you move in. Properties from CoStar, rooms from Matterport or
          your own measurements; acoustics are modeled.
        </span>
      </header>
      {error && <div className="bg-red-900/50 px-4 py-2 text-sm">Error: {error}</div>}
      <main className="min-h-0 flex-1 overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:overflow-hidden">
        <section className="flex flex-col border-zinc-800 lg:min-h-0 lg:border-r">
          <div className="h-64 lg:h-auto lg:min-h-0 lg:flex-[3]">
            <PropertyMap
              points={points}
              selected={
                prop?.lat != null && prop.lon != null ? { sid: prop.sid, lat: prop.lat, lon: prop.lon } : null
              }
              flyTo={flyTo}
              onSelect={selectProperty}
            />
          </div>
          <div className="flex h-80 min-h-0 flex-col lg:h-auto lg:flex-[2]">
            <DiscoveryPanel
              selected={selected}
              onSelect={selectProperty}
              onCity={(at) => setFlyTo({ ...at, key: Date.now() })}
            />
          </div>
        </section>
        <section className="p-4 lg:min-h-0 lg:overflow-auto">
          {!selected ? (
            <p className="text-zinc-400">
              Search or click any of the 5,000+ CoStar properties with a Matterport scan, or start
              with a DEMO pick.
            </p>
          ) : !prop ? (
            <p className="text-sm text-zinc-500">{error ? '' : 'Loading property from Matterport…'}</p>
          ) : (
            <>
              <h2 className="text-lg font-semibold">
                {entry ? [entry.address, entry.city, entry.state].filter(Boolean).join(', ') : prop.address}
              </h2>
              {entry && prop.address && !prop.address.toLowerCase().startsWith(entry.address.toLowerCase()) && (
                <p className="text-xs text-amber-300" data-testid="address-mismatch">
                  This Matterport scan reports its address as {prop.address}; CoStar lists the property
                  as {entry.address}. Both are shown as recorded.
                </p>
              )}
              <p className="text-xs text-zinc-400">
                {[entry?.type_label ?? entry?.kind, entry?.name, prop.name].filter(Boolean).join(' · ')}
              </p>
              {entry && entry.model_ids.length > 1 && (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs" data-testid="scans">
                  <span className="text-zinc-400">Matterport scans of this property:</span>
                  {entry.model_ids.map((sid, i) => (
                    <button
                      key={sid}
                      onClick={() => selectProperty(sid)}
                      className={`rounded px-1.5 py-0.5 ${sid === selected ? 'bg-amber-500 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
              <div className="mb-3" />
              <FactsCard sid={prop.sid} />
              {allRooms == null ? (
                <p className="text-sm text-zinc-500">Loading rooms from Matterport…</p>
              ) : (
                <>
                  {roomsError && <p className="mb-2 text-xs text-amber-300">{roomsError}</p>}
                  {usableCount < 2 && (
                    <p className="mb-2 rounded bg-amber-900/40 px-2 py-1 text-xs text-amber-200">
                      Only {usableCount} room(s) here have enough geometry to model. Add rooms by their
                      dimensions below, compare with a room from another property, or pick another
                      property.
                    </p>
                  )}
                  <p className="mb-1 text-xs text-zinc-400">
                    Pick a room as A or B. Slots stay filled when you switch property, so you can compare
                    rooms across properties.
                  </p>
                  <RoomPicker rooms={allRooms} picked={pickedHere} onPick={pick} />
                  <CustomRoomForm
                    key={selected}
                    prominent={usableCount < 2}
                    onAdd={(c) =>
                      setCustomRooms((cs) =>
                        cs.some((x) => customRoomToRoom(x).id === customRoomToRoom(c).id) ? cs : [...cs, c],
                      )
                    }
                  />
                </>
              )}
            </>
          )}

          {(picked.A || picked.B) && (
            <div className="mt-5 border-t border-zinc-800 pt-4" data-testid="comparison">
              <div className="mb-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2" data-testid="slots">
                {(['A', 'B'] as Slot[]).map((slot) => {
                  const ref = picked[slot]
                  return (
                    <div
                      key={slot}
                      className={`flex items-start justify-between rounded border px-2 py-1.5 ${
                        slot === 'A' ? 'border-sky-500/40' : 'border-fuchsia-500/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-zinc-400">Room {slot}</div>
                        {ref ? (
                          <>
                            <div className="truncate font-medium">{ref.label}</div>
                            <button
                              className="block truncate text-left text-xs text-zinc-400 hover:text-zinc-200"
                              onClick={() => selectProperty(ref.sid)}
                              title="Open this property"
                            >
                              {ref.address}
                            </button>
                          </>
                        ) : (
                          <div className="text-zinc-500">pick a room above</div>
                        )}
                      </div>
                      {ref && (
                        <button
                          className="text-xs text-zinc-500 hover:text-zinc-200"
                          onClick={() => setPicked((x) => ({ ...x, [slot]: null }))}
                          aria-label={`Clear room ${slot}`}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              {sameRoom && (
                <p className="mb-2 text-xs text-amber-300">
                  Room A and B are the same room with the same materials; pick another room or change
                  materials to hear a difference.
                </p>
              )}
              <AudioLab a={picked.A} b={picked.B} materials={materials} />
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
            </div>
          )}

          {prop && (
            <>
              <NoisePanel sid={prop.sid} />
              <NoiseScoutPanel sid={prop.sid} />
            </>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            All acoustic values are modeled approximations from room geometry and assumed materials, not
            measurements.
          </p>
        </section>
      </main>
    </div>
  )
}
