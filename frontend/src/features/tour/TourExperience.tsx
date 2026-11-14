import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchTour } from '../../api'
import type { TourLayout, TourRoom } from '../../types'
import { classifyRoom, type Classification, type FitBasis, type VizMode } from '../acoustic-visualization/classify'
import { FloorPlan } from '../acoustic-visualization/FloorPlan'
import { RoomDetails } from '../acoustic-visualization/RoomDetails'
import { useHouseAcoustics } from '../acoustic-visualization/useHouseAcoustics'
import { USE_CASES } from '../acoustic-visualization/useCases'
import { HeatmapLegend, VizControls } from '../acoustic-visualization/VizControls'
import { RoomAudio } from '../audio/RoomAudio'
import type { Variant } from '../matterport/connect'
import { polygonArea, resolveCurrentRoom } from '../matterport/geometry'
import { MatterportViewer } from '../matterport/MatterportViewer'
import { createRoomOverlay, type OverlayController } from '../matterport/overlay'
import type { MpSdk } from '../matterport/sdkTypes'
import { useTourState } from '../matterport/useTourState'
import { buildFieldMesh, houseRange } from '../heatmap/field'
import { FieldPlan } from '../heatmap/FieldPlan'
import { FieldLegend, InsightPanel, MetricPicker } from '../heatmap/InsightPanel'
import { createFieldOverlay, type FieldMeshInput, type FieldOverlay } from '../heatmap/overlay3d'
import type { FieldMetric } from '../heatmap/types'
import { useInsights } from '../heatmap/useInsights'
import { roomFloorHeight } from '../matterport/geometry'

interface Props {
  sid: string
  title: string
  /** Open straight into the acoustic heatmap (dollhouse view). */
  initialHeatmap?: boolean
  onBack?: () => void
  backLabel?: string
}

type OverlayStatus = 'pending' | 'on' | 'unavailable' | 'error'

/** Matterport tour + room-level acoustic heatmap + room audio, for one property. */
export function TourExperience({ sid, title, initialHeatmap = false, onBack, backLabel }: Props) {
  const [heat, setHeat] = useState(initialHeatmap)
  const [metric, setMetric] = useState<FieldMetric>('bass_spread_db')
  const [placing, setPlacing] = useState(false)
  const fieldOverlay = useRef<FieldOverlay | null>(null)
  const [fieldReady, setFieldReady] = useState<object | null>(null)
  const [loaded, setLoaded] = useState<{ sid: string; layout?: TourLayout; error?: string } | null>(null)
  const [conn, setConn] = useState<{ sdk: MpSdk; variant: Variant } | null>(null)
  const [mode, setMode] = useState<VizMode>('fit')
  const [useCase, setUseCase] = useState('acoustic_guitar')
  const [basis, setBasis] = useState<FitBasis>('modeled')
  // A manual pick holds until the visitor walks into another room (when following the tour).
  const [pick, setPick] = useState<{ id: string; whileIn: string | null } | null>(null)
  const [follow, setFollow] = useState(true)
  const [overlayState, setOverlayState] = useState<{ conn: object; status: OverlayStatus } | null>(null)
  const [navError, setNavError] = useState<string | null>(null)
  const overlay = useRef<OverlayController | null>(null)

  useEffect(() => {
    let live = true
    fetchTour(sid)
      .then((layout) => live && setLoaded({ sid, layout }))
      .catch((e: Error) => live && setLoaded({ sid, error: e.message }))
    return () => {
      live = false
    }
  }, [sid])
  const layout = loaded?.sid === sid ? (loaded.layout ?? null) : null
  const layoutError = loaded?.sid === sid ? (loaded.error ?? null) : null

  const tour = useTourState(conn?.sdk ?? null)
  const insights = useInsights(sid, heat)
  const acoustics = useHouseAcoustics(sid, layout?.rooms ?? null)
  const current = useMemo(
    () => (layout ? resolveCurrentRoom(tour.roomIds, tour.sweepId, layout) : null),
    [layout, tour.roomIds, tour.sweepId],
  )

  // Follow the visitor through the house unless they picked a room since entering this one.
  const currentId = current?.roomId ?? null
  const selectedId =
    pick && (!follow || pick.whileIn === currentId) ? pick.id : follow ? (currentId ?? pick?.id ?? null) : null

  const classes = useMemo(() => {
    const out: Record<string, Classification> = {}
    for (const r of layout?.rooms ?? []) out[r.room_id] = classifyRoom(acoustics[r.room_id], r.usable, mode, useCase, basis)
    return out
  }, [layout, acoustics, mode, useCase, basis])

  // 3D floor tints (Bundle SDK only).
  useEffect(() => {
    if (!conn || !layout) return
    let live = true
    createRoomOverlay(conn.sdk, layout)
      .then((ctl) => {
        if (!live) return ctl?.dispose()
        overlay.current = ctl
        setOverlayState({ conn, status: ctl ? 'on' : 'unavailable' })
      })
      .catch(() => live && setOverlayState({ conn, status: 'error' }))
    return () => {
      live = false
      overlay.current?.dispose()
      overlay.current = null
    }
  }, [conn, layout])

  const overlayStatus: OverlayStatus = overlayState && overlayState.conn === conn ? overlayState.status : 'pending'
  useEffect(() => {
    if (overlayStatus !== 'on') return
    const paints: Record<string, { color: string; selected: boolean; hidden?: boolean }> = {}
    for (const [id, c] of Object.entries(classes)) paints[id] = { color: c.color, selected: id === selectedId, hidden: heat }
    overlay.current?.paint(paints)
  }, [classes, selectedId, overlayStatus, heat])

  // Heatmap: dollhouse view + continuous field overlay (Bundle SDK). Created once per connection.
  useEffect(() => {
    if (!conn || !heat) return
    conn.sdk.Mode.moveTo(conn.sdk.Mode.Mode.DOLLHOUSE).catch(() => undefined)
  }, [conn, heat])
  useEffect(() => {
    if (!conn) return
    let live = true
    createFieldOverlay(conn.sdk)
      .then((ctl) => {
        if (!live) return ctl?.dispose()
        fieldOverlay.current = ctl
        setFieldReady(ctl ? conn : null)
      })
      .catch(() => live && setFieldReady(null))
    return () => {
      live = false
      fieldOverlay.current?.dispose()
      fieldOverlay.current = null
    }
  }, [conn])
  const fieldRooms = insights.rooms
  const range = useMemo(() => {
    const fs = Object.values(fieldRooms).map((r) => r.field)
    return fs.length ? houseRange(fs, metric) : ([0, 1] as [number, number])
  }, [fieldRooms, metric])
  useEffect(() => {
    const ctl = fieldOverlay.current
    if (!ctl || !layout || fieldReady !== conn) return
    const inside = tour.mode === 'mode.inside'
    ctl.setVisible(heat && !inside)
    if (!heat) return
    const meshes: Record<string, FieldMeshInput> = {}
    for (const r of layout.rooms) {
      const ins = fieldRooms[r.room_id]
      if (!ins) continue
      const z = roomFloorHeight(r, layout)
      const mesh = buildFieldMesh(ins.field, z, metric, range)
      const top = z + 0.65
      meshes[r.room_id] = {
        ...mesh,
        markers: [
          { x: ins.field.best_spot[0], y: top, z: -ins.field.best_spot[1], color: '#fafafa', size: 0.22 },
          { x: ins.field.source[0], y: top, z: -ins.field.source[1], color: '#18181b', size: 0.16 },
        ],
      }
    }
    ctl.update(meshes)
  }, [fieldRooms, metric, range, heat, layout, conn, fieldReady, tour.mode])

  const onConnected = useCallback((sdk: MpSdk, variant: Variant) => {
    // Dev-only handle for inspecting the SDK from the browser console.
    if (import.meta.env.DEV) (window as unknown as { __reverbSdk?: MpSdk }).__reverbSdk = sdk
    setConn({ sdk, variant })
  }, [])
  const onDisconnected = useCallback(() => setConn(null), [])

  const selectRoom = (room: TourRoom) => {
    setPick({ id: room.room_id, whileIn: currentId })
    setNavError(null)
    if (!conn || !room.entry_sweep_id || heat) return // heatmap: stay in dollhouse view
    conn.sdk.Sweep.moveTo(room.entry_sweep_id, { transition: conn.sdk.Sweep.Transition.FLY }).catch((e: Error) =>
      setNavError(`Could not move the tour to ${room.label}: ${e.message}`),
    )
  }

  const rooms = useMemo(() => sortRooms(layout?.rooms ?? []), [layout])
  const names = useMemo(() => roomNames(rooms), [rooms])
  const selected = rooms.find((r) => r.room_id === selectedId) ?? null
  const useCaseLabel = USE_CASES.find((u) => u.id === useCase)?.label ?? useCase

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden" data-testid="tour-experience">
      <div className="flex shrink-0 flex-col lg:min-h-0 lg:flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-700" data-testid="tour-back">
                ← {backLabel ?? 'Back'}
              </button>
            )}
            <button
              onClick={() => {
                setHeat((h) => !h)
                setPlacing(false)
              }}
              aria-pressed={heat}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                heat ? 'bg-amber-400 text-black' : 'bg-gradient-to-r from-rose-500 via-amber-400 to-cyan-400 text-black'
              }`}
              data-testid="heatmap-toggle"
            >
              {heat ? 'Hide acoustic heatmap' : 'Show acoustic heatmap'}
            </button>
            {heat ? (
              <MetricPicker metric={metric} onChange={setMetric} />
            ) : (
              <VizControls mode={mode} useCase={useCase} basis={basis} onMode={setMode} onUseCase={setUseCase} onBasis={setBasis} />
            )}
          </div>
          <TrackingPill conn={conn} current={current} names={names} overlayStatus={overlayStatus} tourMode={tour.mode} />
        </div>
        <div className="relative h-[60vh] lg:h-auto lg:min-h-0 lg:flex-1">
          <MatterportViewer sid={sid} onConnected={onConnected} onDisconnected={onDisconnected} />
        </div>
        <div className="border-t border-zinc-800 px-3 py-2">
          {heat ? <FieldLegend metric={metric} range={range} /> : <HeatmapLegend mode={mode} basis={basis} />}
        </div>
      </div>

      <aside className="min-h-0 space-y-5 overflow-auto border-zinc-800 p-4 lg:w-[420px] lg:border-l">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">3D acoustic tour</div>
          <h2 className="text-base font-semibold">{title}</h2>
        </div>

        {layoutError && <div className="rounded bg-red-900/40 px-2 py-1 text-xs">Tour layout: {layoutError}</div>}
        {!layout && !layoutError && <div className="text-xs text-zinc-500">Loading rooms and tour locations…</div>}

        {heat && (insights.loading || insights.error) && (
          <p className="text-xs text-zinc-400">
            {insights.error ? `Heatmap unavailable: ${insights.error}` : 'Calculating the acoustic field for every room…'}
          </p>
        )}
        {heat && layout && Object.keys(fieldRooms).length > 0 && (
          <div className="h-64 rounded-xl bg-zinc-900/60 p-2 ring-1 ring-zinc-800">
            <FieldPlan
              layout={layout}
              rooms={fieldRooms}
              metric={metric}
              range={range}
              selectedId={selectedId}
              placing={placing}
              onSelect={(id) => {
                const r = rooms.find((x) => x.room_id === id)
                if (r) selectRoom(r)
              }}
              onPlaceSource={(id, xy) => {
                insights.setOverride(id, { source: xy })
                setPlacing(false)
              }}
            />
          </div>
        )}
        {heat && conn && tour.mode === 'mode.inside' && (
          <button
            onClick={() => conn.sdk.Mode.moveTo(conn.sdk.Mode.Mode.DOLLHOUSE).catch(() => undefined)}
            className="w-full rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black"
          >
            The 3D heatmap shows in dollhouse view: go back to it
          </button>
        )}
        {heat && fieldReady === null && conn && (
          <p className="text-[11px] text-zinc-500">3D heatmap needs the Bundle SDK (npm run setup:matterport); the plan above shows it.</p>
        )}
        {!heat && layout && (
          <div className="h-52 rounded-xl bg-zinc-900/60 p-2 ring-1 ring-zinc-800">
            <FloorPlan
              layout={layout}
              classes={classes}
              selectedId={selectedId}
              currentId={currentId}
              sweepId={tour.sweepId}
              onSelect={(id) => {
                const r = rooms.find((x) => x.room_id === id)
                if (r) selectRoom(r)
              }}
            />
          </div>
        )}

        {layout && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Rooms</h3>
              <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                Follow the tour
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1.5" role="listbox" aria-label="Rooms">
              {rooms.filter((r) => r.label.toLowerCase() !== 'void').map((r) => {
                const c = classes[r.room_id]
                const sel = r.room_id === selectedId
                return (
                  <button
                    key={r.room_id}
                    role="option"
                    aria-selected={sel}
                    onClick={() => selectRoom(r)}
                    title={r.navigable ? `Go to ${names[r.room_id]} in the tour` : `${names[r.room_id]}: no tour location, analysis only`}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ring-1 transition-colors ${
                      sel ? 'bg-zinc-800 ring-zinc-400' : 'ring-zinc-800 hover:bg-zinc-900'
                    } ${r.usable ? '' : 'opacity-60'}`}
                    data-testid="room-option"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c?.color }} />
                    <span className="min-w-0 flex-1 truncate">{names[r.room_id]}</span>
                    {c?.value && <span className="tabular-nums text-zinc-400">{c.value}</span>}
                    {!r.navigable && <span className="text-zinc-500" aria-label="not in tour">⌀</span>}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-500">⌀ no tour location: analysis and audio only. Picking a room flies the tour there.</p>
            {navError && <p className="mt-1 text-xs text-red-300">{navError}</p>}
          </section>
        )}

        <section className="rounded-xl bg-zinc-900/60 p-3 ring-1 ring-zinc-800">
          <RoomAudio
            sid={sid}
            room={selected ? { id: selected.room_id, label: names[selected.room_id], usable: selected.usable } : null}
            prefetchRoomIds={rooms.filter((r) => r.usable && r.navigable).map((r) => r.room_id)}
          />
        </section>

        {heat && selected && fieldRooms[selected.room_id] ? (
          <section className="rounded-xl bg-zinc-900/60 p-3 ring-1 ring-zinc-800">
            <InsightPanel
              room={fieldRooms[selected.room_id]}
              pending={insights.pending}
              furnitureEdited={insights.overrides[selected.room_id]?.furniture !== undefined}
              sourceMoved={insights.overrides[selected.room_id]?.source !== undefined}
              placing={placing}
              onPlacing={setPlacing}
              onFurniture={(items) => insights.setOverride(selected.room_id, { furniture: items })}
              onResetSource={() => insights.setOverride(selected.room_id, { source: undefined })}
            />
          </section>
        ) : heat && layout && Object.keys(fieldRooms).length > 0 ? (
          <p className="text-xs text-zinc-400">Pick a room (in the plan or the list) for its advice and furniture.</p>
        ) : selected ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">{names[selected.room_id]}</h3>
            <RoomDetails
              room={selected}
              data={acoustics[selected.room_id]}
              cls={classes[selected.room_id]}
              mode={mode}
              useCaseLabel={useCaseLabel}
            />
          </section>
        ) : (
          layout && <p className="text-xs text-zinc-500">Walk into a room or pick one above to see why it has its colour.</p>
        )}

        <p className="text-[11px] text-zinc-500">
          Acoustic values are modeled from Matterport room geometry and assumed materials (empty rooms, equivalent
          rectangular box), not measured. Fit levels are rules of thumb, not standards.
        </p>
      </aside>
    </div>
  )
}

function TrackingPill({
  conn,
  current,
  names,
  overlayStatus,
  tourMode,
}: {
  conn: { variant: Variant } | null
  current: ReturnType<typeof resolveCurrentRoom> | null
  names: Record<string, string>
  overlayStatus: OverlayStatus
  tourMode: string | null
}) {
  if (!conn) return null
  let where: string
  if (tourMode && tourMode !== 'mode.inside') where = 'Overview: pick a room or step inside'
  else if (current?.roomId)
    where = `You are in: ${names[current.roomId]}${current.source === 'sweep' ? ' (from tour location)' : ''}${current.ambiguous ? ' (overlapping rooms)' : ''}`
  else where = 'This spot is not inside a mapped room'
  const overlayNote =
    overlayStatus === 'on'
      ? 'Floor tint on'
      : overlayStatus === 'unavailable'
        ? 'Embed SDK: no 3D tint (run npm run setup:matterport)'
        : overlayStatus === 'error'
          ? '3D tint failed; floor plan still shows the heatmap'
          : null
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="tracking">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      <span className="font-medium">{where}</span>
      {overlayNote && <span className="text-zinc-500">· {overlayNote}</span>}
    </div>
  )
}

/** Usable rooms first, then by size, so the main rooms lead the list. */
function sortRooms(rooms: TourRoom[]): TourRoom[] {
  const area = (r: TourRoom) => (r.polygon ? polygonArea(r.polygon) : 0)
  return [...rooms].sort((a, b) => Number(b.usable) - Number(a.usable) || area(b) - area(a))
}

/** Disambiguate repeated labels ("Living Room" x2) with the outline area. */
function roomNames(rooms: TourRoom[]): Record<string, string> {
  const count: Record<string, number> = {}
  for (const r of rooms) count[r.label] = (count[r.label] ?? 0) + 1
  const seen: Record<string, number> = {}
  const out: Record<string, string> = {}
  for (const r of rooms) {
    const area = r.polygon ? polygonArea(r.polygon) : null
    seen[r.label] = (seen[r.label] ?? 0) + 1
    out[r.room_id] =
      count[r.label] < 2 ? r.label : area ? `${r.label} · ${area.toFixed(0)} m²` : `${r.label} ${seen[r.label]}`
  }
  return out
}
