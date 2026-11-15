import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchTour } from '../../api'
import type { TourLayout, TourRoom } from '../../types'
import { classifyRoom, type Classification, type FitBasis, type VizMode } from '../acoustic-visualization/classify'
import { FloorPlan } from '../acoustic-visualization/FloorPlan'
import { RoomDetails } from '../acoustic-visualization/RoomDetails'
import { useHouseAcoustics } from '../acoustic-visualization/useHouseAcoustics'
import { USE_CASES } from '../acoustic-visualization/useCases'
import { HeatmapLegend, VizControls } from '../acoustic-visualization/VizControls'
import type { Variant } from '../matterport/connect'
import { polygonArea, resolveCurrentRoom } from '../matterport/geometry'
import { MatterportViewer } from '../matterport/MatterportViewer'
import type { MpSdk } from '../matterport/sdkTypes'
import { useTourState } from '../matterport/useTourState'
import { houseRange } from '../heatmap/field'
import { FieldPlan } from '../heatmap/FieldPlan'
import { FieldLegend, InsightPanel, MetricPicker } from '../heatmap/InsightPanel'
import type { FieldMetric } from '../heatmap/types'
import { useInsights } from '../heatmap/useInsights'
import { fetchTreatment } from '../../api'
import { createTreatmentScene, goToViewpoint, type TreatmentScene } from '../treatment/scene'

interface Props {
  sid: string
  title: string
  /** Open straight into "choose your music room" (top-down view). */
  startChoosing?: boolean
  /** Make the chosen music room Room A or B in the journey. */
  onUseRoom?: (slot: 'A' | 'B', roomId: string, label: string) => void
  onBack?: () => void
  backLabel?: string
}

/**
 * Matterport tour + 2D acoustic plan, for one property. The 3D model is never tinted: room
 * colours and the music room's heatmap live on the 2D plan only, so the scan stays clean
 * wherever you look. The treatment plan can be installed in the 3D model as an overlay.
 */
export function TourExperience({ sid, title, startChoosing = false, onBack, backLabel, onUseRoom }: Props) {
  // Tour first; then "Choose my music room" switches to the top-down view, and the room you click
  // gets the heatmap (one room only, so the rest of the model stays clean).
  const [choosing, setChoosing] = useState(startChoosing)
  const [musicRoom, setMusicRoom] = useState<string | null>(null)
  const heat = musicRoom != null
  const [metric, setMetric] = useState<FieldMetric>('bass_spread_db')
  const [placing, setPlacing] = useState(false)
  const [panels, setPanels] = useState<{ room: string; status: 'loading' | 'on' | 'error'; message?: string; count?: number } | null>(null)
  const panelScene = useRef<TreatmentScene | null>(null)
  const [loaded, setLoaded] = useState<{ sid: string; layout?: TourLayout; error?: string } | null>(null)
  const [conn, setConn] = useState<{ sdk: MpSdk; variant: Variant } | null>(null)
  const [mode, setMode] = useState<VizMode>('fit')
  const [useCase, setUseCase] = useState('acoustic_guitar')
  const basis: FitBasis = 'modeled'
  // A manual pick holds until the visitor walks into another room (when following the tour).
  const [pick, setPick] = useState<{ id: string; whileIn: string | null } | null>(null)
  const [follow, setFollow] = useState(true)
  const [navError, setNavError] = useState<string | null>(null)

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
  const insights = useInsights(sid, heat || choosing)
  // The showcase has settled into a view (its opening fly-in is a transition too); switching
  // views before that makes Matterport throw ViewmodeActiveTransition.
  const settled = tour.mode != null && tour.mode !== 'mode.transitioning'
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

  const fieldRooms = insights.rooms
  const range = useMemo(() => {
    const fs = Object.values(fieldRooms).map((r) => r.field)
    return fs.length ? houseRange(fs, metric) : ([0, 1] as [number, number])
  }, [fieldRooms, metric])
  // Treatment panels installed in the 3D model for the music room (Bundle SDK scene objects).
  const panelsOn = panels?.room === musicRoom ? panels : null
  useEffect(() => {
    if (!conn || !panelsOn || panelsOn.status !== 'loading' || !musicRoom) return
    let live = true
    fetchTreatment(sid, musicRoom, 'mixing', 'as_scanned')
      .then(async (plan) => {
        if (!live) return
        if (conn.variant !== 'bundle' || !conn.sdk.Scene) throw new Error('needs the Bundle SDK (npm run setup:matterport)')
        const scene = await createTreatmentScene(conn.sdk, plan.items)
        if (!live) return scene?.dispose()
        panelScene.current = scene
        setPanels({ room: musicRoom, status: 'on', count: plan.items.length })
        if (plan.viewpoint) await goToViewpoint(conn.sdk, plan.viewpoint).catch(() => undefined)
      })
      .catch((e: Error) => live && setPanels({ room: musicRoom, status: 'error', message: e.message }))
    return () => {
      live = false
    }
  }, [conn, sid, musicRoom, panelsOn?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (panelsOn) return
    panelScene.current?.dispose()
    panelScene.current = null
  }, [panelsOn])
  useEffect(() => () => panelScene.current?.dispose(), [])

  const onConnected = useCallback((sdk: MpSdk, variant: Variant) => {
    // Dev-only handle for inspecting the SDK from the browser console.
    if (import.meta.env.DEV) (window as unknown as { __reverbSdk?: MpSdk }).__reverbSdk = sdk
    setConn({ sdk, variant })
  }, [])
  const onDisconnected = useCallback(() => setConn(null), [])

  const selectRoom = (room: TourRoom) => {
    setPick({ id: room.room_id, whileIn: currentId })
    setNavError(null)
    if (choosing || heat) {
      if (room.usable) {
        setMusicRoom(room.room_id)
        setChoosing(false)
        setPlacing(false)
        // Look at that part of the house in 3D; its heatmap is on the 2D plan beside it.
        if (conn && room.entry_sweep_id && settled)
          conn.sdk.Sweep.moveTo(room.entry_sweep_id, { transition: conn.sdk.Sweep.Transition.FLY }).catch(() => undefined)
      }
      return
    }
    if (!conn || !room.entry_sweep_id) return
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
                if (heat || choosing) {
                  setMusicRoom(null)
                  setChoosing(false)
                  setPlacing(false)
                  setPanels(null)
                } else setChoosing(true)
              }}
              aria-pressed={heat || choosing}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                heat || choosing ? 'border border-line text-ink' : 'bg-accent text-paper'
              }`}
              data-testid="heatmap-toggle"
            >
              {heat || choosing ? 'Back to walking the tour' : 'Choose my music room'}
            </button>
            {heat && (
              <button
                onClick={() => setPanels(panelsOn ? null : { room: musicRoom!, status: 'loading' })}
                aria-pressed={!!panelsOn}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${panelsOn ? 'bg-ink text-paper' : 'bg-accent text-paper'}`}
                data-testid="tour-panels"
              >
                {panelsOn?.status === 'loading' ? 'Placing panels…' : panelsOn ? 'Hide panels' : 'Show treatment panels'}
              </button>
            )}
            {heat && (
              <button
                onClick={() => {
                  setMusicRoom(null)
                  setChoosing(true)
                  setPanels(null)
                }}
                className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs hover:bg-zinc-700"
              >
                Pick another room
              </button>
            )}
            {heat ? (
              <MetricPicker metric={metric} onChange={setMetric} />
            ) : (
              <VizControls mode={mode} useCase={useCase} basis={basis} onMode={setMode} onUseCase={setUseCase} />
            )}
          </div>
          <TrackingPill conn={conn} current={current} names={names} tourMode={tour.mode} />
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

        {choosing && (
          <div className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100 ring-1 ring-amber-400/40" data-testid="choose-hint">
            <b>Choose your music room</b> in the plan or the list. The plan shows its heatmap; the 3D view takes you there.
          </div>
        )}
        {heat && (insights.loading || insights.error) && (
          <p className="text-xs text-zinc-400">
            {insights.error ? `Heatmap unavailable: ${insights.error}` : 'Calculating the acoustic field for every room…'}
          </p>
        )}
        {heat && layout && Object.keys(fieldRooms).length > 0 && (
          <div className="h-80 rounded-xl bg-zinc-900/60 p-2 ring-1 ring-zinc-800" data-testid="field-plan">
            <FieldPlan
              layout={layout}
              rooms={musicRoom && fieldRooms[musicRoom] ? { [musicRoom]: fieldRooms[musicRoom] } : {}}
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
        {panelsOn?.status === 'on' && (
          <p className="text-xs text-mute" data-testid="tour-panels-note">
            {panelsOn.count} treatment items drawn in the 3D model at their calculated positions (mixing plan). A visualization, not a photo.
          </p>
        )}
        {panelsOn?.status === 'error' && <p className="text-xs text-bad">Panels unavailable: {panelsOn.message}</p>}
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
            <p className="mt-1.5 text-[11px] text-zinc-500">Click a room to go there. ⌀ = not reachable in the tour.</p>
            {navError && <p className="mt-1 text-xs text-red-300">{navError}</p>}
          </section>
        )}


        {heat && musicRoom && fieldRooms[musicRoom] ? (
          <section className="space-y-3 rounded-xl bg-zinc-900/60 p-3 ring-1 ring-zinc-800" data-testid="music-room">
            <div className="text-[11px] uppercase tracking-wider text-amber-300">Your music room</div>
            <InsightPanel
              room={fieldRooms[musicRoom]}
              pending={insights.pending}
              furnitureEdited={insights.overrides[musicRoom]?.furniture !== undefined}
              sourceMoved={insights.overrides[musicRoom]?.source !== undefined}
              placing={placing}
              onPlacing={setPlacing}
              onFurniture={(items) => insights.setOverride(musicRoom, { furniture: items })}
              onResetSource={() => insights.setOverride(musicRoom, { source: undefined })}
            />
            {onUseRoom && (
              <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
                <button
                    onClick={() => onUseRoom('A', musicRoom, names[musicRoom] ?? fieldRooms[musicRoom].label)}
                    className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-paper"
                    data-testid="use-room"
                  >
                    Analyze and listen →
                  </button>
              </div>
            )}
          </section>
        ) : heat && musicRoom && !fieldRooms[musicRoom] && !insights.loading ? (
          <p className="text-xs text-amber-300">This room has no Matterport outline, so it has no heatmap; pick another.</p>
        ) : selected && !choosing ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">{names[selected.room_id]}</h3>
            {onUseRoom && selected.usable && (
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                    onClick={() => onUseRoom('A', selected.room_id, names[selected.room_id] ?? selected.label)}
                    className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-paper"
                    data-testid="pick-room"
                  >
                    Analyze and listen →
                  </button>
              </div>
            )}
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
          Modeled from the scan's room geometry and typical materials, not measured. Fit levels are rules of thumb.
        </p>
      </aside>
    </div>
  )
}

function TrackingPill({
  conn,
  current,
  names,
  tourMode,
}: {
  conn: { variant: Variant } | null
  current: ReturnType<typeof resolveCurrentRoom> | null
  names: Record<string, string>
  tourMode: string | null
}) {
  if (!conn) return null
  let where: string
  if (tourMode && tourMode !== 'mode.inside') where = 'Overview: pick a room or step inside'
  else if (current?.roomId)
    where = `You are in: ${names[current.roomId]}${current.source === 'sweep' ? ' (from tour location)' : ''}${current.ambiguous ? ' (overlapping rooms)' : ''}`
  else where = 'This spot is not inside a mapped room'
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="tracking">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      <span className="font-medium">{where}</span>
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
