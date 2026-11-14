import { type ReactNode, useEffect, useState } from 'react'
import { fetchCatalogPoints, fetchDemo, fetchMaterials, fetchProperty, fetchRooms, searchCatalog, type DemoPair } from './api'
import { AudioLab } from './features/audio/AudioLab'
import { ambienceLayers } from './features/audio/ambience'
import { HouseVerdict, VerdictRules } from './features/decide/HouseVerdict'
import { DiscoveryPanel } from './features/discovery/DiscoveryPanel'
import { FactsCard } from './features/facts/FactsCard'
import { FurnitureEditor } from './features/furniture/FurnitureEditor'
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
import { RiskPanel } from './features/risk/RiskPanel'
import { useNoiseRisk } from './features/risk/useNoiseRisk'
import { CustomRoomForm } from './features/rooms/CustomRoomForm'
import { RoomPicker, type Slot } from './features/rooms/RoomPicker'
import { SuitabilityPanel } from './features/suitability/SuitabilityPanel'
import { TourExperience } from './features/tour/TourExperience'
import { ModelViewer } from './features/viewer/ModelViewer'
import { customRoomToRoom, parseCustomRoomId, type CustomRoomSpec, type SlotRef } from './roomRef'
import type { CatalogEntry, CatalogPoints, MaterialCatalog, MaterialSelection, Property, Room } from './types'
import { Step, StepNav, Stepper, Tag } from './ui/journey'
import { STEPS, type StepId } from './ui/steps'

/** House number and street name, ignoring suffixes like Ave/Avenue, to compare addresses. */
const streetKey = (a: string) => a.toLowerCase().split(/[\s,]+/).slice(0, 2).join(' ')
const SLOT_TONE = { A: 'sky', B: 'fuchsia' } as const

type View = { kind: 'journey' } | { kind: 'tour'; sid: string; heatmap: boolean; title: string }

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
  const [active, setActive] = useState<StepId>('discover')
  const [view, setView] = useState<View>({ kind: 'journey' })
  const [demo, setDemo] = useState<DemoPair | null>(null)

  useEffect(() => {
    fetchCatalogPoints()
      .then(setPoints)
      .catch((e: Error) => setError(`Property map unavailable (${e.message}).`))
    fetchMaterials()
      .then(setCatalog)
      .catch((e: Error) => setError(`Material presets unavailable (${e.message}).`))
    fetchDemo()
      .then(setDemo)
      .catch(() => setDemo(null))
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
    if (active === 'discover') setActive('explore')
  }

  const noise = useNoise(selected)
  const risk = useNoiseRisk(selected, noise.report != null)
  const riskA = useNoiseRisk(picked.A?.sid ?? null, picked.A != null)
  const riskB = useNoiseRisk(picked.B?.sid ?? null, picked.B != null)
  const outside = {
    A: ambienceLayers(riskA.risk?.ranked ?? []),
    B: ambienceLayers(riskB.risk?.ranked ?? []),
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
  const address = entry ? [entry.address, entry.city].filter(Boolean).join(', ') : (prop?.address ?? selected ?? '')
  const pickedHere = {
    A: picked.A?.sid === selected ? picked.A.roomId : null,
    B: picked.B?.sid === selected ? picked.B.roomId : null,
  }
  const pick = (slot: Slot, roomId: string) => {
    const room = allRooms?.find((r) => r.id === roomId)
    if (!selected || !room) return
    setPicked((x) => ({ ...x, [slot]: { sid: selected, roomId, label: room.label, address } }))
    setMaterials((m) => ({ ...m, [slot]: {} }))
  }
  const loc =
    prop?.lat != null && prop.lon != null
      ? { lat: prop.lat, lon: prop.lon }
      : entry?.lat != null && entry.lon != null
        ? { lat: entry.lat, lon: entry.lon }
        : null
  const propLoaded = prop != null || propError != null
  const reports = { A: repA, B: repB }

  const done: Record<StepId, boolean> = {
    discover: selected != null,
    explore: propLoaded,
    configure: picked.A != null,
    analyze: repA.report != null,
    audition: picked.A != null && dryName != null,
    compare: repA.report != null && repB.report != null && !sameRoom,
    decide: repA.report != null && repB.report != null && !sameRoom,
  }
  // What each step needs before moving on (shown in the bottom bar; Next stays off until met).
  const need: Record<StepId, string | null> = {
    discover: selected ? null : 'Pick a property on the map or in the list',
    explore: null,
    configure: picked.A ? null : 'Press A on a room to choose it',
    analyze: null,
    audition: null,
    compare: null,
    decide: null,
  }
  const go = (id: StepId) => {
    setActive(id)
    document.getElementById('workspace')?.scrollTo({ top: 0 })
  }
  const openTour = (sid: string, heatmap: boolean, title: string) => setView({ kind: 'tour', sid, heatmap, title })
  const runDemo = () => {
    if (!demo) return
    const ref = (d: DemoPair['good']) => ({ sid: d.sid, roomId: d.room_id, label: d.label, address: d.address })
    setPicked({ A: ref(demo.good), B: ref(demo.bad) })
    setMaterials({ A: {}, B: {} })
    if (selected !== demo.good.sid) selectProperty(demo.good.sid)
    setView({ kind: 'journey' })
    go('audition')
  }
  const activeTitle = STEPS.find((s) => s.id === active)?.title ?? ''
  const tourRoomA = picked.A && !parseCustomRoomId(picked.A.roomId) ? picked.A : null

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 bg-zinc-950 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-black tracking-[0.2em] text-amber-400">REVERB</span>
          <span className="hidden text-xs text-zinc-400 2xl:inline">Hear a room before you sign the lease</span>
        </div>
        <Stepper
          done={done}
          active={view.kind === 'tour' ? (view.heatmap ? 'analyze' : 'explore') : active}
          onSelect={(id) => {
            setView({ kind: 'journey' })
            go(id)
          }}
        />
      </header>
      {error && (
        <div className="flex items-center justify-between bg-red-950/70 px-4 py-1.5 text-xs text-red-200">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {view.kind === 'tour' ? (
        <TourExperience
          key={`${view.sid}-${view.heatmap}`}
          sid={view.sid}
          title={view.title}
          startChoosing={view.heatmap}
          onBack={() => setView({ kind: 'journey' })}
          backLabel={`Back to ${activeTitle}`}
          onUseRoom={(slot, roomId, label) => {
            setPicked((x) => ({ ...x, [slot]: { sid: view.sid, roomId, label, address: view.title } }))
            setMaterials((m) => ({ ...m, [slot]: {} }))
            setView({ kind: 'journey' })
            go('analyze')
          }}
        />
      ) : (
        <main className="min-h-0 flex-1 overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:overflow-hidden">
          <section className="flex flex-col border-zinc-800 lg:min-h-0 lg:border-r" aria-label="Map and search">
            <div className="relative h-72 lg:h-auto lg:min-h-0 lg:flex-[3]">
              <PropertyMap
                points={points}
                selected={selected && loc ? { sid: selected, ...loc } : null}
                flyTo={flyTo}
                onSelect={selectProperty}
                noise={noise.report ?? null}
                risk={risk.risk}
              />
            </div>
            <div className="flex h-96 min-h-0 flex-col border-t border-zinc-800 lg:h-auto lg:flex-[2]">
              <div className="px-3 pt-2 text-xs text-zinc-400">
                <span className="font-semibold text-zinc-200">Find a property</span> · search, or click a dot on the
                map. You can switch property at any step (for example to pick Room B elsewhere).
              </div>
              <DiscoveryPanel
                selected={selected}
                onSelect={selectProperty}
                onCity={(at) => setFlyTo({ ...at, key: Date.now() })}
              />
            </div>
          </section>

          <section id="workspace" className="flex flex-col p-4 pb-0 lg:min-h-0 lg:overflow-auto" data-testid="workspace">
            <div className="flex-1 space-y-4 pb-4">
              {active === 'discover' && (
                <>
                  <Welcome demos={demos} onSelect={selectProperty} demo={demo} onDemo={runDemo} />
                  {selected && (
                    <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                      Selected: {address || selected}. Press <b>Next</b> to explore it.
                    </p>
                  )}
                </>
              )}

              {active === 'explore' && (
                <Step
                  id="explore"
                  state={done.explore ? 'done' : 'current'}
                  title={selected ? address || 'Loading property…' : 'Explore the property'}
                  subtitle={
                    selected
                      ? [entry?.type_label ?? entry?.kind, entry?.name, prop?.name].filter(Boolean).join(' · ')
                      : 'The 3D scan, facts and the noise risks around it.'
                  }
                  aside={selected && <Tag>Matterport + CoStar + OpenStreetMap</Tag>}
                >
                  {!selected ? (
                    <Placeholder>Pick a property first (step 1).</Placeholder>
                  ) : (
                    <div className="space-y-3">
                      {propError && (
                        <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
                          {propError} Facts and surroundings still come from CoStar; enter a room by its dimensions in
                          the next step.
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
                      {!propError && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openTour(selected, false, address || selected)}
                            className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-sky-300"
                            data-testid="open-tour"
                          >
                            Walk the 3D tour
                          </button>
                          <button
                            onClick={() => openTour(selected, true, address || selected)}
                            className="rounded-lg bg-gradient-to-r from-rose-500 via-amber-400 to-cyan-400 px-3 py-1.5 text-xs font-semibold text-black"
                            data-testid="open-heatmap"
                          >
                            Choose my music room (3D heatmap)
                          </button>
                        </div>
                      )}
                      <ModelViewer sid={selected} />
                      <RiskPanel
                        sid={selected}
                        risk={risk.risk}
                        loading={risk.loading || noise.loading}
                        error={risk.error ?? noise.error ?? null}
                        onFocus={(lon, lat) => setFlyTo({ lon, lat, zoom: 17, key: Date.now() })}
                      />
                      <FactsCard sid={selected} />
                      <details>
                        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                          Noise exposure by category and every mapped source
                        </summary>
                        <NoisePanel noise={noise} />
                      </details>
                      <details>
                        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                          Full Deep Agents research report (summary, advice, data gaps, trace)
                        </summary>
                        <NoiseScoutPanel sid={selected} />
                      </details>
                    </div>
                  )}
                </Step>
              )}

              {active === 'configure' && (
                <Step
                  id="configure"
                  state={done.configure ? 'done' : 'current'}
                  title="Choose the rooms"
                  subtitle="A Matterport room, or one you enter by its dimensions. Furniture and materials are editable."
                  aside={<Tag tone="amber">furniture and materials assumed until edited</Tag>}
                  hint={
                    !selected
                      ? undefined
                      : !picked.A
                        ? 'Press A on the room you want to hear first.'
                        : !picked.B
                          ? 'Optional: press B on a second room, here or after picking another property on the map.'
                          : undefined
                  }
                >
                  <SlotBar picked={picked} onOpen={selectProperty} onClear={(s) => setPicked((x) => ({ ...x, [s]: null }))} />
                  {!selected ? (
                    <div className="mt-3">
                      <Placeholder>Pick a property first (step 1).</Placeholder>
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
                          {usableCount === 0 ? 'No room' : `Only ${usableCount} room`} here has enough geometry to model.
                          Add a room by its dimensions, compare with a room from another property, or pick another
                          property.
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
                  {(picked.A || picked.B) && (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="selection">
                      {(['A', 'B'] as Slot[])
                        .filter((s) => picked[s])
                        .map((slot) => {
                          const rep = reports[slot].report
                          const sel = materials[slot]
                          return (
                            <div key={slot} className="space-y-2 rounded-lg border border-zinc-800 p-2">
                              <div className="flex items-center gap-2 text-xs">
                                <Tag tone={SLOT_TONE[slot]}>Room {slot}</Tag>
                                <span className="truncate text-zinc-300">{picked[slot]!.label}</span>
                              </div>
                              {catalog && (
                                <MaterialEditor
                                  slot={slot}
                                  catalog={catalog}
                                  value={sel}
                                  onChange={(v) => setMaterials((m) => ({ ...m, [slot]: v }))}
                                />
                              )}
                              {rep ? (
                                <FurnitureEditor
                                  current={rep.furniture ?? []}
                                  edited={sel.furniture !== undefined}
                                  compact
                                  onChange={(items) =>
                                    setMaterials((m) => {
                                      const { furniture: _drop, ...rest } = m[slot]
                                      void _drop
                                      return { ...m, [slot]: items === undefined ? rest : { ...rest, furniture: items } }
                                    })
                                  }
                                />
                              ) : (
                                <p className="text-xs text-zinc-500">Loading furniture…</p>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  )}
                </Step>
              )}

              {active === 'analyze' && (
                <Step
                  id="analyze"
                  state={done.analyze ? 'done' : 'current'}
                  title="Room acoustics"
                  subtitle="Calculated from the room's outline, height, materials and furniture: RT60, modes, Schroeder frequency, reflections."
                  aside={<Tag tone="amber">modeled, not measured</Tag>}
                >
                  {!picked.A && !picked.B ? (
                    <Placeholder>Pick a room in step 3 to calculate its acoustics.</Placeholder>
                  ) : (
                    <>
                      {tourRoomA && (
                        <button
                          onClick={() => openTour(tourRoomA.sid, true, tourRoomA.address)}
                          className="mb-3 w-full rounded-lg bg-gradient-to-r from-rose-500 via-amber-400 to-cyan-400 px-3 py-2 text-sm font-semibold text-black"
                          data-testid="analyze-heatmap"
                        >
                          Choose your music room in 3D and see where the sound is good or bad: {tourRoomA.address}
                        </button>
                      )}
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {(['A', 'B'] as Slot[]).map((slot) => {
                          const r = reports[slot]
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
                                  <p className="mt-2 text-[11px] text-zinc-500">
                                    {r.report.furniture?.length
                                      ? `Furnished (${r.report.furniture.length} kinds of item${
                                          r.report.furniture.some((f) => f.provenance === 'assumed') ? ', assumed' : ''
                                        }).`
                                      : 'Modeled empty.'}{' '}
                                    {r.report.geometry.wall_source === 'outline'
                                      ? 'Wall area from the Matterport outline.'
                                      : 'Rectangular box.'}
                                  </p>
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
                    </>
                  )}
                </Step>
              )}

              {active === 'audition' && (
                <Step
                  id="audition"
                  state={done.audition ? 'done' : 'current'}
                  title="Audition"
                  subtitle="Upload one dry recording; your browser convolves it with each room's modeled impulse response."
                  aside={<Tag tone="amber">modeled approximation, not a recording</Tag>}
                  hint={picked.A && !dryName ? 'Upload a dry recording (or use the test claps), then press Play.' : undefined}
                >
                  {!picked.A && !picked.B ? (
                    <Placeholder>Pick a room first (step 3); its impulse response is generated with Pyroomacoustics.</Placeholder>
                  ) : (
                    <AudioLab a={picked.A} b={picked.B} materials={materials} onDry={setDryName} outside={outside} />
                  )}
                </Step>
              )}

              {active === 'compare' && (
                <Step
                  id="compare"
                  state={done.compare ? 'done' : 'current'}
                  title="Compare A and B"
                  subtitle="Same recording, two rooms: switch Room A / Room B in the player (step 5). The explanation comes from the numbers."
                  hint={picked.A && !picked.B ? 'Pick a second room as B in step 3; it can be in another property.' : undefined}
                >
                  {sameRoom && (
                    <p className="mb-2 text-xs text-amber-300">
                      Room A and B are the same room with the same settings; pick another room or change materials or
                      furniture to hear a difference.
                    </p>
                  )}
                  {picked.A && picked.B ? (
                    <>
                      <Explanation {...cmp} />
                      <button onClick={() => go('audition')} className="mt-3 text-xs text-sky-300 hover:underline">
                        ← Listen to both again in the player
                      </button>
                    </>
                  ) : (
                    <Placeholder>Choose two rooms to compare.</Placeholder>
                  )}
                </Step>
              )}

              {active === 'decide' && (
                <Step
                  id="decide"
                  state={done.decide ? 'done' : 'current'}
                  title="Decide"
                  subtitle="Studio suitability per use, from the calculated results (furniture included). Qualitative, never a score."
                >
                  {repA.report || repB.report ? (
                    <>
                      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="house-verdicts">
                        {(['A', 'B'] as Slot[])
                          .filter((s) => picked[s])
                          .map((slot) => (
                            <HouseVerdict
                              key={slot}
                              slot={slot}
                              address={picked[slot]!.address}
                              roomLabel={picked[slot]!.label}
                              report={reports[slot].report}
                              risk={(slot === 'A' ? riskA : riskB).risk}
                              riskLoading={(slot === 'A' ? riskA : riskB).loading}
                            />
                          ))}
                      </div>
                      <VerdictRules />
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                          Suitability for every use (vocals, instruments, mixing, podcasting, guitars)
                        </summary>
                        <SuitabilityPanel a={repA.report} b={repB.report} />
                      </details>
                      {tourRoomA && (
                        <button
                          onClick={() => openTour(tourRoomA.sid, true, tourRoomA.address)}
                          className="mt-3 text-xs text-sky-300 hover:underline"
                        >
                          Where to put the mic or seat, panels and bass traps: open the 3D heatmap advice →
                        </button>
                      )}
                    </>
                  ) : (
                    <Placeholder>Suitability appears once a room is analyzed.</Placeholder>
                  )}
                </Step>
              )}

              <p className="text-xs text-zinc-500">
                Property records: CoStar. Room geometry: Matterport, or entered by you. Surroundings: OpenStreetMap
                (mapped proximity, not measured sound levels). All acoustic values and audio are modeled approximations
                from geometry, materials and furniture, not measurements.
              </p>
            </div>
            <StepNav active={active} need={need[active]} onGo={go} />
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

function Welcome({
  demos,
  onSelect,
  demo,
  onDemo,
}: {
  demos: CatalogEntry[]
  onSelect: (sid: string) => void
  demo: DemoPair | null
  onDemo: () => void
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5" data-testid="welcome">
      <h1 className="text-xl font-semibold text-zinc-100">Find a property, understand its acoustics, hear it.</h1>
      <p className="mt-1 max-w-prose text-sm text-zinc-400">
        For musicians and audio people choosing a place to record, mix or rehearse. Seven steps, one at a time; the bar
        at the bottom always says what is next.
      </p>
      <ol className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-zinc-300 sm:grid-cols-2">
        {[
          ['Discover', 'search 5,000+ CoStar properties with a Matterport scan'],
          ['Explore', '3D tour, facts and a noise-risk heatmap of the neighbourhood'],
          ['Configure', 'pick rooms; check their furniture and materials'],
          ['Analyze', 'RT60, modes, clarity, and a 3D acoustic heatmap'],
          ['Audition', 'play your dry recording through the room'],
          ['Compare', 'the same recording in a second room'],
          ['Decide', 'which room suits which use, and what to fix'],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-zinc-800 text-[10px]">{i + 1}</span>
            <span>
              <b>{t}</b>: {d}
            </span>
          </li>
        ))}
      </ol>
      {demo && (
        <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3" data-testid="demo-pair">
          <div className="text-sm font-semibold text-amber-200">Demo: a good house vs a bad house</div>
          <div className="mt-1 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div>
              <span className="font-semibold text-sky-300">A · {demo.good.address}</span>
              <div className="text-zinc-400">{demo.good.why}</div>
            </div>
            <div>
              <span className="font-semibold text-fuchsia-300">B · {demo.bad.address}</span>
              <div className="text-zinc-400">{demo.bad.why}</div>
            </div>
          </div>
          <button
            onClick={onDemo}
            className="mt-2 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-300"
            data-testid="run-demo"
          >
            Load both and listen →
          </button>
        </div>
      )}
      {demos.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs text-zinc-500">Start with a demo pick, or use the map and list on the left:</div>
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
