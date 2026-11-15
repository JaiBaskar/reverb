import { type ReactNode, useEffect, useState } from 'react'
import { fetchCatalogPoints, fetchDemo, fetchMaterials, fetchProperty, fetchRooms, searchCatalog, type DemoPair } from './api'
import { AudioLab } from './features/audio/AudioLab'
import { ambienceLayers } from './features/audio/ambience'
import { HouseVerdict, VerdictRules } from './features/decide/HouseVerdict'
import { DiscoveryPanel } from './features/discovery/DiscoveryPanel'
import { FurnitureEditor } from './features/furniture/FurnitureEditor'
import { PropertyMap } from './features/map/PropertyMap'
import { MaterialEditor } from './features/materials/MaterialEditor'
import { useNoise } from './features/noise/useNoise'
import { Explanation } from './features/numbers/Explanation'
import { NumbersPanel } from './features/numbers/NumbersPanel'
import { useComparison } from './features/numbers/useComparison'
import { useReport } from './features/numbers/useReport'
import { useNoiseRisk } from './features/risk/useNoiseRisk'
import { CustomRoomForm } from './features/rooms/CustomRoomForm'
import { RoomCards, type Slot } from './features/rooms/RoomCards'
import { useRoomReports } from './features/rooms/useRoomReports'
import { SuitabilityPanel } from './features/suitability/SuitabilityPanel'
import { TourExperience } from './features/tour/TourExperience'
import { TreatmentStep } from './features/treatment/TreatmentStep'
import type { TreatmentPlan } from './features/treatment/types'
import { customRoomToRoom, parseCustomRoomId, type CustomRoomSpec, type SlotRef } from './roomRef'
import type { AcousticReport, CatalogEntry, CatalogPoints, MaterialCatalog, MaterialSelection, Property, Room } from './types'
import { StepHeader, StepNav, Stepper, Tag } from './ui/journey'
import { type StepId } from './ui/steps'

const SLOT_STYLE = {
  A: { box: 'border-sky-500/50 bg-sky-500/5', on: 'ring-2 ring-sky-400', text: 'text-sky-300' },
  B: { box: 'border-fuchsia-500/50 bg-fuchsia-500/5', on: 'ring-2 ring-fuchsia-400', text: 'text-fuchsia-300' },
}

export default function App() {
  const [step, setStep] = useState<StepId>('find')
  const [tour, setTour] = useState<{ sid: string; title: string } | null>(null)
  const [points, setPoints] = useState<CatalogPoints | null>(null)
  const [demo, setDemo] = useState<DemoPair | null>(null)
  const [catalog, setCatalog] = useState<MaterialCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; zoom: number; key: number } | null>(null)

  // The place being looked at.
  const [selected, setSelected] = useState<string | null>(null)
  const [prop, setProp] = useState<Property | null>(null)
  const [propError, setPropError] = useState<string | null>(null)
  const [entry, setEntry] = useState<CatalogEntry | null>(null)
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [customRooms, setCustomRooms] = useState<CustomRoomSpec[]>([])

  // The two rooms being compared (they can be in different places).
  const [picked, setPicked] = useState<Record<Slot, SlotRef | null>>({ A: null, B: null })
  const [target, setTarget] = useState<Slot>('A')
  const [materials, setMaterials] = useState<Record<Slot, MaterialSelection>>({ A: {}, B: {} })
  const [objective, setObjective] = useState('mixing')
  const [planned, setPlanned] = useState(false)

  useEffect(() => {
    fetchCatalogPoints()
      .then(setPoints)
      .catch((e: Error) => setError(`The property map is unavailable (${e.message}).`))
    fetchMaterials()
      .then(setCatalog)
      .catch(() => setCatalog(null))
    fetchDemo()
      .then(setDemo)
      .catch(() => setDemo(null))
  }, [])

  useEffect(() => {
    if (!selected) return
    let live = true
    fetchProperty(selected)
      .then((p) => live && setProp(p))
      .catch((e: Error) => live && setPropError(`Matterport did not return this scan (${e.message}).`))
    fetchRooms(selected)
      .then((r) => live && setRooms(r))
      .catch(() => {
        if (!live) return
        setRooms([])
        setRoomsError('Matterport has no room measurements for this scan. Enter a room by its dimensions instead.')
      })
    searchCatalog(selected, '', '', 1)
      .then((r) => live && setEntry(r.results[0] ?? null))
      .catch(() => live && setEntry(null))
    return () => {
      live = false
    }
  }, [selected])

  const selectPlace = (sid: string) => {
    if (sid === selected) return
    setSelected(sid)
    setProp(null)
    setPropError(null)
    setEntry(null)
    setRooms(null)
    setRoomsError(null)
    setCustomRooms([])
  }

  const allRooms = rooms == null ? null : [...rooms, ...customRooms.map(customRoomToRoom)]
  const roomReports = useRoomReports(selected, allRooms)
  const address = entry ? [entry.address, entry.city].filter(Boolean).join(', ') : (prop?.address ?? '')
  const loc =
    prop?.lat != null && prop.lon != null
      ? { lat: prop.lat, lon: prop.lon }
      : entry?.lat != null && entry.lon != null
        ? { lat: entry.lat, lon: entry.lon }
        : null

  const noise = useNoise(selected)
  const risk = useNoiseRisk(selected, noise.report != null)
  const riskA = useNoiseRisk(picked.A?.sid ?? null, picked.A != null)
  const riskB = useNoiseRisk(picked.B?.sid ?? null, picked.B != null)
  const repA = useReport(picked.A?.sid ?? null, picked.A?.roomId ?? null, materials.A)
  const repB = useReport(picked.B?.sid ?? null, picked.B?.roomId ?? null, materials.B)
  const reports = { A: repA, B: repB }
  const cmp = useComparison(
    { sid: picked.A?.sid ?? null, roomId: picked.A?.roomId ?? null, materials: materials.A },
    { sid: picked.B?.sid ?? null, roomId: picked.B?.roomId ?? null, materials: materials.B },
  )

  const setSlot = (slot: Slot, ref: SlotRef | null) => {
    setPicked((x) => ({ ...x, [slot]: ref }))
    setMaterials((m) => ({ ...m, [slot]: {} }))
  }
  const choose = (roomId: string) => {
    const room = allRooms?.find((r) => r.id === roomId)
    if (!selected || !room) return
    setSlot(target, { sid: selected, roomId, label: room.label, address })
    // After the first room, the next click offers the comparison room.
    if (target === 'A' && !picked.B) setTarget('B')
  }

  const go = (id: StepId) => {
    setTour(null)
    setStep(id)
    document.getElementById('workspace')?.scrollTo({ top: 0 })
  }
  const runDemo = () => {
    if (!demo) return
    const ref = (d: DemoPair['good']) => ({ sid: d.sid, roomId: d.room_id, label: d.label, address: d.address })
    setPicked({ A: ref(demo.good), B: ref(demo.bad) })
    setMaterials({ A: {}, B: {} })
    selectPlace(demo.good.sid)
    go('listen')
  }
  /** Room A as the plan modelled it, and the same room with the plan installed as Room B. */
  const hearTreated = (plan: TreatmentPlan, avoidWalls: number[]) => {
    if (!picked.A) return
    const sel: MaterialSelection = {
      ...Object.fromEntries(plan.room.materials.map((m) => [m.surface, m.material_id])),
      furniture: plan.room.furniture,
      room_model: true,
    }
    setPicked((x) => ({ ...x, B: { ...x.A!, label: `${x.A!.label}, treated for ${plan.objective.label.toLowerCase()}` } }))
    setMaterials({ A: sel, B: { ...sel, treatment: plan.objective.id, treatment_avoid: avoidWalls } })
    setPlanned(true)
    go('listen')
  }
  const startOver = () => {
    setPicked({ A: null, B: null })
    setMaterials({ A: {}, B: {} })
    setTarget('A')
    setPlanned(false)
    go('find')
  }

  const done: Record<StepId, boolean> = {
    find: selected != null,
    room: picked.A != null,
    treat: planned,
    listen: picked.A != null && repA.report != null,
    verdict: false,
  }
  const reachable: Record<StepId, boolean> = {
    find: true,
    room: selected != null,
    treat: picked.A != null,
    listen: picked.A != null,
    verdict: picked.A != null,
  }
  const need: Record<StepId, string | null> = {
    find: selected ? null : 'Pick a place on the map or in the list',
    room: picked.A ? null : 'Choose a room',
    treat: null,
    listen: null,
    verdict: null,
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 px-4 py-2.5">
        <button onClick={startOver} className="flex items-baseline gap-2" title="Start over">
          <span className="text-lg font-black tracking-[0.2em] text-amber-400">REVERB</span>
          <span className="hidden text-xs text-zinc-400 xl:inline">Hear a room before you sign the lease</span>
        </button>
        <Stepper done={done} reachable={reachable} active={step} onSelect={go} />
      </header>
      {error && (
        <div className="flex items-center justify-between bg-red-950/70 px-4 py-1.5 text-xs text-red-200">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {/* The steps stay mounted under the tour, so a loaded recording survives a visit to it. */}
      {tour && (
        <TourExperience
          key={tour.sid}
          sid={tour.sid}
          title={tour.title}
          onBack={() => setTour(null)}
          backLabel="Back to the rooms"
          onUseRoom={(slot, roomId, label) => {
            setSlot(slot, { sid: tour.sid, roomId, label, address: tour.title })
            go('listen')
          }}
        />
      )}
      {step === 'find' ? (
        <main
          className={
            tour ? 'hidden' : 'min-h-0 flex-1 overflow-auto lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:overflow-hidden'
          }
        >
          <div className="relative h-72 lg:h-auto">
            <PropertyMap
              points={points}
              selected={selected && loc ? { sid: selected, ...loc } : null}
              flyTo={flyTo}
              onSelect={selectPlace}
              noise={noise.report ?? null}
              risk={risk.risk}
            />
          </div>
          <section className="flex min-h-0 flex-col border-zinc-800 lg:border-l" data-testid="workspace">
            <div className="space-y-3 p-4">
              <StepHeader title="Find a place">
                Pick a home or studio space with a 3D scan. You'll choose the room you'd play in, hear your own
                recording in it, and get a verdict.
              </StepHeader>
              {selected ? (
                <div className="rounded-xl border border-amber-400/50 bg-amber-400/5 p-4" data-testid="selected-place">
                  <div className="text-xs uppercase tracking-wide text-amber-300">Selected</div>
                  <div className="truncate text-lg font-semibold">{address || 'Loading…'}</div>
                  <div className="truncate text-sm text-zinc-400">
                    {[entry?.type_label ?? entry?.kind, prop && `${prop.usable_room_count} measurable rooms`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <button
                    onClick={() => go('room')}
                    className="mt-3 w-full rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-300"
                    data-testid="to-rooms"
                  >
                    Choose a room here →
                  </button>
                </div>
              ) : (
                demo && (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4" data-testid="demo-pair">
                    <div className="font-semibold">New here? Try the demo</div>
                    <p className="mt-1 text-sm text-zinc-400">
                      A quiet house vs a noisy one: <span className="text-sky-300">{demo.good.address}</span> and{' '}
                      <span className="text-fuchsia-300">{demo.bad.address}</span>.
                    </p>
                    <button
                      onClick={runDemo}
                      className="mt-3 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-black hover:bg-white"
                      data-testid="run-demo"
                    >
                      Load both and listen →
                    </button>
                  </div>
                )
              )}
            </div>
            <DiscoveryPanel selected={selected} onSelect={selectPlace} onCity={(at) => setFlyTo({ ...at, key: Date.now() })} />
          </section>
        </main>
      ) : (
        <main id="workspace" className={`min-h-0 flex-1 overflow-auto ${tour ? 'hidden' : ''}`} data-testid="workspace">
          <div className="mx-auto max-w-4xl px-4 py-6">
            {step === 'room' && selected && (
              <>
                <StepHeader
                  title="Choose a room"
                  aside={
                    <button onClick={() => go('find')} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
                      Change place
                    </button>
                  }
                >
                  Pick the room you'd record or rehearse in. Add a second room to compare: another room here, or one in
                  another place (choose Room B, then Change place).
                </StepHeader>

                <SlotBar picked={picked} target={target} onTarget={setTarget} onClear={(s) => setSlot(s, null)} />

                <div className="mt-6 mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{address || 'Loading…'}</h2>
                    {entry && entry.model_ids.length > 1 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-zinc-400" data-testid="scans">
                        {entry.model_ids.length} scans of this place:
                        {entry.model_ids.map((sid, i) => (
                          <button
                            key={sid}
                            onClick={() => selectPlace(sid)}
                            className={`rounded px-1.5 py-0.5 ${sid === selected ? 'bg-amber-400 text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                          >
                            {i + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {!propError && (
                    <button
                      onClick={() => setTour({ sid: selected, title: address || selected })}
                      className="rounded-lg bg-sky-400 px-3 py-1.5 text-sm font-semibold text-black hover:bg-sky-300"
                      data-testid="open-tour"
                    >
                      Walk through in 3D
                    </button>
                  )}
                </div>

                {propError && <Note>{propError} You can still enter a room by its dimensions.</Note>}
                {roomsError && <Note>{roomsError}</Note>}
                {allRooms == null ? (
                  <Placeholder>Loading rooms from Matterport…</Placeholder>
                ) : (
                  <RoomCards
                    rooms={allRooms}
                    reports={roomReports}
                    picked={{
                      A: picked.A?.sid === selected ? picked.A.roomId : null,
                      B: picked.B?.sid === selected ? picked.B.roomId : null,
                    }}
                    target={target}
                    onChoose={choose}
                  />
                )}
                <CustomRoomForm
                  key={selected}
                  prominent={allRooms != null && allRooms.filter((r) => r.usable).length === 0}
                  onAdd={(c) =>
                    setCustomRooms((cs) => (cs.some((x) => customRoomToRoom(x).id === customRoomToRoom(c).id) ? cs : [...cs, c]))
                  }
                />

                {(picked.A || picked.B) && (
                  <details className="mt-6 rounded-xl border border-zinc-800" data-testid="adjust">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-200">
                      Adjust furniture and surfaces <span className="font-normal text-zinc-500">(optional: typical for the room type until you change them)</span>
                    </summary>
                    <div className="grid grid-cols-1 gap-3 px-4 pb-4 md:grid-cols-2">
                      {(['A', 'B'] as Slot[])
                        .filter((s) => picked[s])
                        .map((slot) => (
                          <Adjust
                            key={slot}
                            slot={slot}
                            label={picked[slot]!.label}
                            catalog={catalog}
                            report={reports[slot].report}
                            value={materials[slot]}
                            onChange={(v) => setMaterials((m) => ({ ...m, [slot]: v }))}
                          />
                        ))}
                    </div>
                  </details>
                )}
              </>
            )}

            {step === 'treat' && picked.A && (
              <>
                <StepHeader title="Treatment plan" aside={<Tag tone="amber">simulated, not measured</Tag>}>
                  REVERB reads the scan, works out what is wrong with {picked.A.label} for the use you pick, and places
                  each panel, bass trap and cloud where it does the most good.
                </StepHeader>
                {parseCustomRoomId(picked.A.roomId) ? (
                  <Placeholder>A treatment plan needs a scanned room; a room entered by its dimensions has no walls to place panels on.</Placeholder>
                ) : (
                  <TreatmentStep
                    key={`${picked.A.sid}/${picked.A.roomId}`}
                    room={picked.A}
                    objective={objective}
                    onObjective={setObjective}
                    onHearTreated={hearTreated}
                  />
                )}
              </>
            )}

            {/* Kept mounted from here on, so your recording and playhead survive moving between steps. */}
            {picked.A && (
              <div className={step === 'listen' ? '' : 'hidden'}>
                <StepHeader title="Listen" aside={<Tag tone="amber">modeled, not a recording</Tag>}>
                  Upload a dry take (close-miked, little room sound) and press Play. Switch between the original and each
                  room while it plays; your place in the track is kept.
                </StepHeader>
                <AudioLab
                  a={picked.A}
                  b={picked.B}
                  materials={materials}
                  active={step === 'listen'}
                  outside={{ A: ambienceLayers(riskA.risk?.ranked ?? []), B: ambienceLayers(riskB.risk?.ranked ?? []) }}
                />
                <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(['A', 'B'] as Slot[]).map((s) =>
                    picked[s] ? <RoomSummary key={s} slot={s} ref_={picked[s]!} report={reports[s].report} /> : null,
                  )}
                </div>
                {picked.B ? (
                  <div className="mt-4">
                    <Explanation {...cmp} />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-zinc-500">
                    Want a comparison? Go back and choose a Room B.
                  </p>
                )}
              </div>
            )}

            {step === 'verdict' && picked.A && (
              <>
                <StepHeader title="Verdict">
                  Each place as a music space: the room (with treatment you could realistically add) and the noise around
                  it.
                </StepHeader>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="house-verdicts">
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
                <div className="mt-3">
                  <VerdictRules />
                </div>
                <div className="mt-6 space-y-2">
                  <More title="Fit for each use: vocals, acoustic and electric guitar, mixing, podcasting…">
                    <SuitabilityPanel a={repA.report} b={repB.report} />
                  </More>
                  <More title="All the numbers: RT60 by band, room modes, early reflections">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {(['A', 'B'] as Slot[])
                        .filter((s) => picked[s])
                        .map((s) => (
                          <NumbersPanel
                            key={s}
                            slot={s}
                            {...reports[s]}
                            maxRt60={Math.max(0.1, ...(repA.report?.rt60_s ?? []), ...(repB.report?.rt60_s ?? []))}
                          />
                        ))}
                    </div>
                  </More>
                  {!parseCustomRoomId(picked.A.roomId) && (
                    <button
                      onClick={() => setTour({ sid: picked.A!.sid, title: picked.A!.address })}
                      className="w-full rounded-xl border border-zinc-800 px-4 py-3 text-left text-sm text-sky-300 hover:bg-zinc-900"
                    >
                      Where to put the mic, panels and bass traps in Room A: open the 3D heatmap →
                    </button>
                  )}
                </div>
              </>
            )}

            <p className="mt-10 text-xs text-zinc-600">
              All acoustic values and audio are modeled from the room's geometry, materials and furniture, not measured.
              Property records: CoStar. Room geometry: Matterport. Surroundings: OpenStreetMap.
            </p>
          </div>
        </main>
      )}

      {!tour && (
        <StepNav
          active={step}
          need={need[step]}
          onGo={go}
          last={
            <button onClick={startOver} className="rounded-lg bg-zinc-100 px-5 py-2 text-sm font-semibold text-black hover:bg-white" data-testid="start-over">
              Start over
            </button>
          }
        />
      )}
    </div>
  )
}

function SlotBar({
  picked,
  target,
  onTarget,
  onClear,
}: {
  picked: Record<Slot, SlotRef | null>
  target: Slot
  onTarget: (s: Slot) => void
  onClear: (s: Slot) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="slots">
      {(['A', 'B'] as Slot[]).map((slot) => {
        const ref = picked[slot]
        const st = SLOT_STYLE[slot]
        return (
          <div
            key={slot}
            role="button"
            tabIndex={0}
            onClick={() => onTarget(slot)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onTarget(slot)}
            className={`flex cursor-pointer items-start justify-between gap-2 rounded-xl border px-4 py-3 ${st.box} ${target === slot ? st.on : ''}`}
            data-testid={`slot-${slot}`}
          >
            <div className="min-w-0">
              <div className={`text-xs font-semibold uppercase tracking-wide ${st.text}`}>
                Room {slot} {slot === 'A' ? '· your room' : '· to compare (optional)'}
              </div>
              {ref ? (
                <>
                  <div className="truncate font-medium">{ref.label}</div>
                  <div className="truncate text-xs text-zinc-400">{ref.address}</div>
                </>
              ) : (
                <div className="text-sm text-zinc-500">{target === slot ? 'Click a room below' : 'Empty'}</div>
              )}
            </div>
            {ref && (
              <button
                className="text-sm text-zinc-500 hover:text-zinc-200"
                onClick={(e) => {
                  e.stopPropagation()
                  onClear(slot)
                }}
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

function Adjust({
  slot,
  label,
  catalog,
  report,
  value,
  onChange,
}: {
  slot: Slot
  label: string
  catalog: MaterialCatalog | null
  report?: AcousticReport
  value: MaterialSelection
  onChange: (v: MaterialSelection) => void
}) {
  return (
    <div className="space-y-2 rounded-lg bg-zinc-900/60 p-3">
      <div className={`text-xs font-semibold ${SLOT_STYLE[slot].text}`}>
        Room {slot}: {label}
      </div>
      {catalog && <MaterialEditor slot={slot} catalog={catalog} value={value} onChange={onChange} />}
      {report ? (
        <FurnitureEditor
          current={report.furniture ?? []}
          edited={value.furniture !== undefined}
          compact
          onChange={(items) => {
            const { furniture: _drop, ...rest } = value
            void _drop
            onChange(items === undefined ? rest : { ...rest, furniture: items })
          }}
        />
      ) : (
        <p className="text-xs text-zinc-500">Loading furniture…</p>
      )}
    </div>
  )
}

/** The three numbers a musician reads first, per room. */
function RoomSummary({ slot, ref_, report }: { slot: Slot; ref_: SlotRef; report?: AcousticReport }) {
  const mid = report ? (report.rt60_s[report.bands_hz.indexOf(500)] + report.rt60_s[report.bands_hz.indexOf(1000)]) / 2 : null
  const lowest = report?.modes.length ? Math.min(...report.modes.map((m) => m.freq_hz)) : null
  return (
    <div className="rounded-xl border border-zinc-800 p-3" data-testid={`summary-${slot}`}>
      <div className={`text-xs font-semibold ${SLOT_STYLE[slot].text}`}>Room {slot}</div>
      <div className="truncate text-sm font-medium">{ref_.label}</div>
      <div className="truncate text-xs text-zinc-500">{ref_.address}</div>
      {report ? (
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <Metric label="RT60 (mid)" value={`${mid!.toFixed(2)} s`} help="How long the room rings: time for a sound to fade by 60 dB, 500 Hz-1 kHz." />
          <Metric label="Schroeder" value={`${report.schroeder_hz.toFixed(0)} Hz`} help="Below this, room modes (boomy notes) dominate the bass." />
          <Metric label="Lowest mode" value={lowest == null ? '—' : `${lowest.toFixed(0)} Hz`} help="The deepest resonance of the room." />
        </dl>
      ) : (
        <div className="mt-2 text-xs text-zinc-500">Calculating…</div>
      )}
    </div>
  )
}

function Metric({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div title={help}>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-zinc-100">{value}</dd>
    </div>
  )
}

function More({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-zinc-800">
      <summary className="cursor-pointer px-4 py-3 text-sm text-zinc-300">{title}</summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mb-3 rounded-lg bg-amber-900/30 px-3 py-2 text-sm text-amber-200">{children}</p>
}

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">{children}</p>
}
