import { type ReactNode, useEffect, useState } from 'react'
import { fetchCatalogPoints, fetchMaterials, fetchProperty, fetchRooms, searchCatalog } from './api'
import { AudioLab } from './features/audio/AudioLab'
import { DiscoveryPanel } from './features/discovery/DiscoveryPanel'
import { FactsCard } from './features/facts/FactsCard'
import { PropertyMap } from './features/map/PropertyMap'
import { MaterialEditor } from './features/materials/MaterialEditor'
import { NoisePanel } from './features/noise/NoisePanel'
import { useNoise } from './features/noise/useNoise'
import { NoiseScoutPanel } from './features/noise-scout/NoiseScoutPanel'
import { Explanation } from './features/numbers/Explanation'
import { KeyMetrics } from './features/numbers/KeyMetrics'
import { NumbersPanel } from './features/numbers/NumbersPanel'
import { useComparison } from './features/numbers/useComparison'
import { useReport } from './features/numbers/useReport'
import { CustomRoomForm } from './features/rooms/CustomRoomForm'
import { RoomPicker, type Slot } from './features/rooms/RoomPicker'
import { SuitabilityPanel } from './features/suitability/SuitabilityPanel'
import { TourExperience } from './features/tour/TourExperience'
import { customRoomToRoom, type CustomRoomSpec, type SlotRef } from './roomRef'
import type { CatalogEntry, CatalogPoints, MaterialCatalog, MaterialSelection, Property, Room } from './types'
import { Step, Stepper, Tag } from './ui/journey'
import { STEPS, type StepId, type StepState } from './ui/steps'

/** House number and street name, ignoring suffixes like Ave/Avenue, to compare addresses. */
const streetKey = (a: string) => a.toLowerCase().split(/[\s,]+/).slice(0, 2).join(' ')
const SLOT_TONE = { A: 'sky', B: 'fuchsia' } as const

export default function App() {
  const [points, setPoints] = useState<CatalogPoints | null>(null)
  const [demos, setDemos] = useState<CatalogEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [prop, setProp] = useState<Property | null>(null)
  const [propError, setPropError] = useState<string | null>(null)
  const [entry, setEntry] = useState<CatalogEntry | null>(null)
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; zoom: number; key: number } | null>(null)
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [customRooms, setCustomRooms] = useState<CustomRoomSpec[]>([])
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<Slot, SlotRef | null>>({ A: null, B: null })
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<MaterialCatalog | null>(null)
  const [materials, setMaterials] = useState<Record<Slot, MaterialSelection>>({ A: {}, B: {} })
  const [dryName, setDryName] = useState<string | null>(null)
  const [view, setView] = useState<'analysis' | 'tour'>('analysis')

  useEffect(() => {
    fetchCatalogPoints()
      .then(setPoints)
      .catch((e: Error) => setError(`Property map unavailable (${e.message}).`))
    fetchMaterials()
      .then(setCatalog)
      .catch((e: Error) => setError(`Material presets unavailable (${e.message}).`))
    searchCatalog('', '', '', 50)
      .then((r) => setDemos(r.results.filter((e) => e.demo_pick)))
      .catch(() => setDemos([]))
  }, [])

  useEffect(() => {
    if (!selected) return
    let live = true
    fetchProperty(selected)
      .then((p) => live && setProp(p))
      .catch((e: Error) => live && setPropError(`Matterport did not return this scan (${e.message}).`))
    fetchRooms(selected)
      .then((r) => live && setRooms(r))
      .catch((e: Error) => {
        if (!live) return
        setRooms([])
        setRoomsError(`No room geometry from Matterport (${e.message}). Enter a room by its dimensions instead.`)
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
    if (sid === selected) return
    setSelected(sid)
    setProp(null)
    setPropError(null)
    setEntry(null)
    setRooms(null)
    setCustomRooms([])
    setRoomsError(null)
    setView('analysis')
  }

  const noise = useNoise(selected)
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
  const address = entry ? [entry.address, entry.city].filter(Boolean).join(', ') : (prop?.address ?? selected ?? '')
  const pickedHere = {
    A: picked.A?.sid === selected ? picked.A.roomId : null,
    B: picked.B?.sid === selected ? picked.B.roomId : null,
  }
  const pick = (slot: Slot, roomId: string) => {
    const room = allRooms?.find((r) => r.id === roomId)
    if (!selected || !room) return
    setPicked((x) => ({ ...x, [slot]: { sid: selected, roomId, label: room.label, address } }))
  }
  const loc =
    prop?.lat != null && prop.lon != null
      ? { lat: prop.lat, lon: prop.lon }
      : entry?.lat != null && entry.lon != null
        ? { lat: entry.lat, lon: entry.lon }
        : null
  const propLoaded = prop != null || propError != null

  const done: Record<StepId, boolean> = {
    discover: selected != null,
    explore: propLoaded,
    configure: picked.A != null,
    analyze: repA.report != null,
    audition: picked.A != null && dryName != null,
    compare: repA.report != null && repB.report != null && !sameRoom,
    decide: repA.report != null && repB.report != null && !sameRoom,
  }
  const current = STEPS.find((s) => !done[s.id])?.id
  const state = (id: StepId): StepState => (done[id] ? 'done' : id === current ? 'current' : 'todo')

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 bg-zinc-950 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-black tracking-[0.2em] text-amber-400">REVERB</span>
          <span className="hidden text-xs text-zinc-400 xl:inline">Hear a room before you sign the lease</span>
        </div>
        <Stepper done={done} />
        {selected && !propError && (
          <nav className="ml-auto flex rounded-lg bg-zinc-900 p-0.5 text-xs ring-1 ring-zinc-800" aria-label="View">
            {(['analysis', 'tour'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-md px-3 py-1 font-medium ${view === v ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:bg-zinc-800'}`}
                data-testid={`view-${v}`}
              >
                {v === 'analysis' ? 'Journey' : '3D acoustic tour'}
              </button>
            ))}
          </nav>
        )}
      </header>
      {error && (
        <div className="flex items-center justify-between bg-red-950/70 px-4 py-1.5 text-xs text-red-200">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {selected && !propError && view === 'tour' ? (
        <TourExperience key={selected} sid={selected} title={address || selected} />
      ) : (
      <main className="min-h-0 flex-1 overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:overflow-hidden">
        <section className="flex flex-col border-zinc-800 lg:min-h-0 lg:border-r" aria-label="Discover">
          <div className="relative h-72 lg:h-auto lg:min-h-0 lg:flex-[3]">
            <PropertyMap
              points={points}
              selected={selected && loc ? { sid: selected, ...loc } : null}
              flyTo={flyTo}
              onSelect={selectProperty}
              noise={noise.report ?? null}
            />
          </div>
          <div className="flex h-96 min-h-0 flex-col border-t border-zinc-800 lg:h-auto lg:flex-[2]" id="step-discover">
            <div className="flex items-center gap-2 px-3 pt-2 text-sm font-semibold">
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                  done.discover ? 'bg-emerald-500 text-black' : 'bg-amber-400 text-black'
                }`}
              >
                {done.discover ? '✓' : 1}
              </span>
              Discover
              <span className="font-normal text-zinc-500">· search, or click a dot on the map</span>
            </div>
            <DiscoveryPanel
              selected={selected}
              onSelect={selectProperty}
              onCity={(at) => setFlyTo({ ...at, key: Date.now() })}
            />
          </div>
        </section>

        <section className="space-y-4 p-4 lg:min-h-0 lg:overflow-auto" data-testid="workspace">
          {!selected && <Welcome demos={demos} onSelect={selectProperty} />}

          <Step
            id="explore"
            state={state('explore')}
            title={selected ? address || 'Loading property…' : 'Explore the property'}
            subtitle={
              selected
                ? [entry?.type_label ?? entry?.kind, entry?.name, prop?.name].filter(Boolean).join(' · ')
                : 'Facts from CoStar and the noise sources around it.'
            }
            aside={selected && <Tag>CoStar + OpenStreetMap</Tag>}
            hint={selected ? 'Check the surroundings on the map, then pick a room below.' : undefined}
          >
            {!selected ? (
              <Placeholder>Select a property on the map or from the list to see its facts and surroundings.</Placeholder>
            ) : (
              <div className="space-y-3">
                {!propError && (
                  <button
                    onClick={() => setView('tour')}
                    className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-sky-300"
                    data-testid="open-tour"
                  >
                    Walk the Matterport tour with an acoustic heatmap →
                  </button>
                )}
                {propError && (
                  <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
                    {propError} Property facts and surroundings still come from CoStar; enter a room by its
                    dimensions in step 3.
                  </p>
                )}
                {entry && prop?.address && streetKey(prop.address) !== streetKey(entry.address) && (
                  <p className="text-xs text-amber-300" data-testid="address-mismatch">
                    This Matterport scan reports its address as {prop.address}; CoStar lists the property as{' '}
                    {entry.address}. Both are shown as recorded.
                  </p>
                )}
                {entry && entry.model_ids.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1 text-xs" data-testid="scans">
                    <span className="text-zinc-400">{entry.model_ids.length} Matterport scans of this property:</span>
                    {entry.model_ids.map((sid, i) => (
                      <button
                        key={sid}
                        onClick={() => selectProperty(sid)}
                        className={`rounded px-1.5 py-0.5 ${sid === selected ? 'bg-amber-400 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                <FactsCard sid={selected} />
                <NoisePanel noise={noise} />
                <details>
                  <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                    Deeper noise research (optional AI agent that cites OpenStreetMap)
                  </summary>
                  <NoiseScoutPanel sid={selected} />
                </details>
              </div>
            )}
          </Step>

          <Step
            id="configure"
            state={state('configure')}
            title="Configure the rooms"
            subtitle="A Matterport room, or one you enter by its dimensions, plus assumed surface materials."
            aside={<Tag tone="amber">materials assumed</Tag>}
            hint={
              !selected
                ? undefined
                : !picked.A
                  ? 'Choose the room you want to hear first: press A on its row.'
                  : !picked.B
                    ? 'Now pick a second room as B, here or after selecting another property on the map.'
                    : undefined
            }
          >
            <SlotBar picked={picked} onOpen={selectProperty} onClear={(s) => setPicked((x) => ({ ...x, [s]: null }))} />
            {!selected ? (
              <div className="mt-3">
                <Placeholder>Select a property first.</Placeholder>
              </div>
            ) : allRooms == null ? (
              <div className="mt-3">
                <Placeholder>Loading rooms from Matterport…</Placeholder>
              </div>
            ) : (
              <div className="mt-3">
                {roomsError && <p className="mb-2 text-xs text-amber-300">{roomsError}</p>}
                {usableCount < 2 && (
                  <p className="mb-2 rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
                    {usableCount === 0 ? 'No room' : `Only ${usableCount} room`} here has enough geometry to
                    model. Add a room by its dimensions, compare with a room from another property, or pick
                    another property.
                  </p>
                )}
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
              </div>
            )}
            {catalog && (picked.A || picked.B) && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                  Surface materials: assumed hardwood floor and painted drywall unless you change them
                </summary>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="selection">
                  {(['A', 'B'] as Slot[])
                    .filter((s) => picked[s])
                    .map((slot) => (
                      <MaterialEditor
                        key={slot}
                        slot={slot}
                        catalog={catalog}
                        value={materials[slot]}
                        onChange={(v) => setMaterials((m) => ({ ...m, [slot]: v }))}
                      />
                    ))}
                </div>
              </details>
            )}
          </Step>

          <Step
            id="analyze"
            state={state('analyze')}
            title="Room acoustics"
            subtitle="Calculated from geometry and materials: Sabine RT60, room modes, Schroeder frequency, reflections."
            aside={<Tag tone="amber">modeled, not measured</Tag>}
          >
            {!picked.A && !picked.B ? (
              <Placeholder>Pick a room in step 3 to calculate its acoustics.</Placeholder>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {(['A', 'B'] as Slot[]).map((slot) => {
                  const r = slot === 'A' ? repA : repB
                  return (
                    <div key={slot} className="min-w-0 rounded-lg border border-zinc-800 p-3" data-testid={`analysis-${slot}`}>
                      <div className="mb-2 flex items-center gap-2 text-xs">
                        <Tag tone={SLOT_TONE[slot]}>Room {slot}</Tag>
                        <span className="truncate text-zinc-300">{picked[slot]?.label ?? 'not chosen'}</span>
                      </div>
                      {r.loading && <div className="text-xs text-zinc-500">Calculating…</div>}
                      {r.error && <div className="text-xs text-red-300">{r.error}</div>}
                      {!picked[slot] && <div className="text-xs text-zinc-500">Pick a room as {slot} to fill this side.</div>}
                      {r.report && (
                        <>
                          <KeyMetrics slot={slot} report={r.report} />
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                              Full analysis: RT60 by band, modes, reflections, assumptions
                            </summary>
                            <div className="mt-2">
                              <NumbersPanel slot={slot} {...r} maxRt60={maxRt60} />
                            </div>
                          </details>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Step>

          <Step
            id="audition"
            state={state('audition')}
            title="Audition"
            subtitle="Upload one dry recording; your browser convolves it with each room's modeled impulse response."
            aside={<Tag tone="amber">modeled approximation, not a recording</Tag>}
            hint={picked.A && !dryName ? 'Upload a dry recording (or use the test claps), then press Play.' : undefined}
          >
            {!picked.A && !picked.B ? (
              <Placeholder>Pick a room first; its impulse response is generated with Pyroomacoustics.</Placeholder>
            ) : (
              <AudioLab a={picked.A} b={picked.B} materials={materials} onDry={setDryName} />
            )}
          </Step>

          <Step
            id="compare"
            state={state('compare')}
            title="Compare A and B"
            subtitle="Same recording, two rooms. Switch Room A / Room B in the player above; the explanation comes from the numbers."
            hint={
              picked.A && !picked.B
                ? 'Pick a second room as B in step 3. It can be in another property: select it on the map.'
                : undefined
            }
          >
            {sameRoom && (
              <p className="mb-2 text-xs text-amber-300">
                Room A and B are the same room with the same materials; pick another room or change materials
                to hear a difference.
              </p>
            )}
            {picked.A && picked.B ? <Explanation {...cmp} /> : <Placeholder>Choose two rooms to compare.</Placeholder>}
          </Step>

          <Step
            id="decide"
            state={state('decide')}
            title="Decide"
            subtitle="Studio suitability per use, from the calculated results. Qualitative, never a score."
          >
            {repA.report || repB.report ? (
              <SuitabilityPanel a={repA.report} b={repB.report} />
            ) : (
              <Placeholder>Suitability appears once a room is analyzed.</Placeholder>
            )}
          </Step>

          <p className="pb-4 text-xs text-zinc-500">
            Property records: CoStar. Room geometry: Matterport, or entered by you. Surroundings:
            OpenStreetMap (mapped proximity, not measured sound levels). All acoustic values and audio are
            modeled approximations from geometry and assumed materials, not measurements.
          </p>
        </section>
      </main>
      )}
    </div>
  )
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">{children}</p>
  )
}

function Welcome({ demos, onSelect }: { demos: CatalogEntry[]; onSelect: (sid: string) => void }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5" data-testid="welcome">
      <h1 className="text-xl font-semibold text-zinc-100">Find a property, understand its acoustics, hear it.</h1>
      <p className="mt-1 max-w-prose text-sm text-zinc-400">
        For musicians and audio people choosing a place to record, mix or rehearse. Pick any of 5,000+
        CoStar properties with a Matterport scan, choose a room, and play your own dry recording through a
        model of it. Then compare it with another room.
      </p>
      {demos.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs text-zinc-500">Start with a demo pick:</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {demos.map((d) => (
              <button
                key={d.key}
                onClick={() => onSelect(d.sid)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left hover:border-amber-400/60"
              >
                <div className="truncate text-sm text-zinc-100">{d.address}</div>
                <div className="truncate text-xs text-zinc-500">
                  {[d.city, d.type_label ?? d.kind].filter(Boolean).join(' · ')}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SlotBar({
  picked,
  onOpen,
  onClear,
}: {
  picked: Record<Slot, SlotRef | null>
  onOpen: (sid: string) => void
  onClear: (slot: Slot) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2" data-testid="slots">
      {(['A', 'B'] as Slot[]).map((slot) => {
        const ref = picked[slot]
        return (
          <div
            key={slot}
            className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 ${
              slot === 'A' ? 'border-sky-500/40 bg-sky-500/5' : 'border-fuchsia-500/40 bg-fuchsia-500/5'
            }`}
          >
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Room {slot}</div>
              {ref ? (
                <>
                  <div className="truncate font-medium">{ref.label}</div>
                  <button
                    className="block max-w-full truncate text-left text-xs text-zinc-400 hover:text-zinc-200"
                    onClick={() => onOpen(ref.sid)}
                    title="Open this property"
                  >
                    {ref.address}
                  </button>
                </>
              ) : (
                <div className="text-xs text-zinc-500">empty: press {slot} on a room below</div>
              )}
            </div>
            {ref && (
              <button
                className="text-xs text-zinc-500 hover:text-zinc-200"
                onClick={() => onClear(slot)}
                aria-label={`Clear room ${slot}`}
              >
                ✕
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
