import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCatalogPoints, fetchMaterials, fetchProperty, fetchRooms, searchCatalog } from './api'
import { PropertyCompare } from './features/compare/PropertyCompare'
import { Results } from './features/discovery/Results'
import { PropertyMap } from './features/map/PropertyMap'
import { useNoise } from './features/noise/useNoise'
import { PlaceView } from './features/place/PlaceView'
import { useAnalysis } from './features/place/useAnalysis'
import { RoomPage } from './features/room/RoomPage'
import { useRoomReports } from './features/rooms/useRoomReports'
import { useNoiseRisk } from './features/risk/useNoiseRisk'
import { TourExperience } from './features/tour/TourExperience'
import { customRoomToRoom, type CustomRoomSpec, type SlotRef } from './roomRef'
import type { CatalogEntry, CatalogPoints, MaterialCatalog, Property, Room } from './types'
import { Button } from './ui/kit'

type Overlay =
  | { kind: 'room'; ref: SlotRef; note?: string }
  | { kind: 'compare'; a: string; b: string }
  | { kind: 'tour'; sid: string; title: string; choose: boolean }
  | null

const CITIES = [
  { label: 'Los Angeles', value: 'Los Angeles', at: { lon: -118.33, lat: 34.06, zoom: 10 } },
  { label: 'Houston', value: 'Houston', at: { lon: -95.39, lat: 29.76, zoom: 10 } },
]
const KINDS = [
  { label: 'All', value: '' },
  { label: 'Homes', value: 'residential' },
  { label: 'Commercial', value: 'commercial' },
]

export default function App() {
  // Search
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [kind, setKind] = useState('')
  const [res, setRes] = useState<{ total: number; results: CatalogEntry[] } | null>(null)
  const [resError, setResError] = useState<string | null>(null)
  const [points, setPoints] = useState<CatalogPoints | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [flyTo, setFlyTo] = useState<{ lon: number; lat: number; zoom: number; key: number } | null>(null)
  const [catalog, setCatalog] = useState<MaterialCatalog | null>(null)

  // The open place
  const [selected, setSelected] = useState<string | null>(null)
  const [prop, setProp] = useState<Property | null>(null)
  const [propError, setPropError] = useState<string | null>(null)
  const [entry, setEntry] = useState<CatalogEntry | null>(null)
  const [entryDone, setEntryDone] = useState(false)
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [roomsError, setRoomsError] = useState<string | null>(null)
  const [customRooms, setCustomRooms] = useState<CustomRoomSpec[]>([])

  // Compare mode (click two homes in a row) and full-screen pages
  const [picks, setPicks] = useState<string[] | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)

  useEffect(() => {
    fetchCatalogPoints().then(setPoints).catch(() => setPoints(null))
    fetchMaterials().then(setCatalog).catch(() => setCatalog(null))
  }, [])

  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      searchCatalog(q, city, kind)
        .then((r) => live && (setRes(r), setResError(null)))
        .catch((e: Error) => live && setResError(e.message))
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, city, kind])

  useEffect(() => {
    if (!selected) return
    let live = true
    fetchProperty(selected)
      .then((p) => live && setProp(p))
      .catch((e: Error) => live && setPropError(e.message))
    fetchRooms(selected)
      .then((r) => live && setRooms(r))
      .catch(() => {
        if (!live) return
        setRooms([])
        setRoomsError('none')
      })
    searchCatalog(selected, '', '', 1)
      .then((r) => live && setEntry(r.results[0] ?? null))
      .catch(() => live && setEntry(null))
      .finally(() => live && setEntryDone(true))
    return () => {
      live = false
    }
  }, [selected])

  // Re-opening the place that is already open must not clear it: the fetch effect only runs when
  // the id changes, so clearing would leave the page on "Loading…" for good.
  const selectedRef = useRef<string | null>(null)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])
  const openPlace = useCallback((sid: string | null) => {
    document.getElementById('panel')?.scrollTo({ top: 0 })
    if (sid === selectedRef.current) return
    selectedRef.current = sid
    setSelected(sid)
    setEntryDone(false)
    setProp(null)
    setPropError(null)
    setEntry(null)
    setRooms(null)
    setRoomsError(null)
    setCustomRooms([])
  }, [])

  const allRooms = rooms == null ? null : [...rooms, ...customRooms.map(customRoomToRoom)]
  const analysis = useAnalysis(selected)
  // Scanned rooms come analyzed from the server; only rooms added by size are analyzed here.
  const reports = useRoomReports(selected, rooms == null ? null : customRooms.map(customRoomToRoom))
  const address = entry
    ? [entry.address, entry.city].filter(Boolean).join(', ')
    : (prop?.address ?? (entryDone && (prop || propError) ? 'Address unavailable' : ''))
  const loc =
    prop?.lat != null && prop.lon != null
      ? { lat: prop.lat, lon: prop.lon }
      : entry?.lat != null && entry.lon != null
        ? { lat: entry.lat, lon: entry.lon }
        : null
  const noise = useNoise(selected)
  // Asked for as soon as a place opens (the server fetches its surroundings once for both calls).
  const risk = useNoiseRisk(selected, true)
  const roomRisk = useNoiseRisk(overlay?.kind === 'room' ? overlay.ref.sid : null, true)

  const refFor = (sid: string, roomId: string, label?: string, addr?: string): SlotRef | null => {
    const room = sid === selected ? allRooms?.find((r) => r.id === roomId) : undefined
    const l = label ?? room?.label
    return l ? { sid, roomId, label: l, address: addr ?? address } : null
  }
  const labelOf = (sid: string) =>
    res?.results.find((e) => e.sid === sid)?.address ?? points?.features.find((f) => f.properties.sid === sid)?.properties.label ?? sid
  /** In compare mode a click picks the home; the second pick opens the comparison. */
  const pickOrOpen = (sid: string) => {
    if (picks == null) return openPlace(sid)
    if (picks.includes(sid)) return setPicks(picks.filter((x) => x !== sid))
    const next = [...picks, sid]
    if (next.length < 2) return setPicks(next)
    setPicks(null)
    setOverlay({ kind: 'compare', a: next[0], b: next[1] })
  }
  const home = () => {
    setOverlay(null)
    openPlace(null)
  }

  return (
    <div className="flex h-full flex-col bg-paper text-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <button onClick={home} className="order-1 text-xl font-bold tracking-tight" data-testid="logo">
          reverb<span className="text-accent">.</span>
        </button>
        <div className="relative order-3 w-full sm:order-2 sm:w-auto sm:min-w-72 sm:flex-1 lg:max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (selected) openPlace(null)
            }}
            placeholder="Address, ZIP or building"
            className="h-10 w-full rounded-full border border-line bg-paper pl-9 pr-4 text-sm outline-none focus:border-ink"
            data-testid="search"
          />
        </div>
        <div className="order-4 flex w-full items-center gap-1.5 overflow-x-auto sm:order-3 sm:w-auto">
          {KINDS.map((k) => (
            <Chip key={k.value} on={kind === k.value} onClick={() => setKind(k.value)}>
              {k.label}
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          {CITIES.map((c) => (
            <Chip
              key={c.value}
              on={city === c.value}
              onClick={() => {
                const next = city === c.value ? '' : c.value
                setCity(next)
                if (next) setFlyTo({ ...c.at, key: Date.now() })
              }}
            >
              {c.label}
            </Chip>
          ))}
        </div>
        <div className="order-2 ml-auto sm:order-4">
          <Button
            kind={picks ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setPicks(picks ? null : selected ? [selected] : [])}
            data-testid="compare-mode"
          >
            {picks ? 'Cancel compare' : 'Compare'}
          </Button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[38vh] shrink-0 lg:h-auto lg:flex-1">
          <PropertyMap
            points={points}
            selected={selected && loc ? { sid: selected, ...loc } : null}
            flyTo={flyTo}
            onSelect={pickOrOpen}
            noise={noise.report ?? null}
            hovered={hovered}
            risk={risk.risk}
            riskState={!selected ? 'idle' : risk.risk ? 'ready' : risk.error ? 'error' : 'loading'}
          />
        </div>
        <section id="panel" className="relative min-h-0 flex-1 overflow-auto border-line lg:w-[560px] lg:flex-none lg:border-l" data-testid="workspace">
          {selected ? (
            <PlaceView
              sid={selected}
              entry={entry}
              address={address}
              propError={propError}
              rooms={allRooms}
              roomsError={roomsError}
              analysis={analysis}
              reports={reports}
              risk={risk}
              onClose={() => openPlace(null)}
              onTour={() => setOverlay({ kind: 'tour', sid: selected, title: address || selected, choose: false })}
              onOpenRoom={(id, note) => {
                const ref = refFor(selected, id, analysis.analysis?.rooms.find((r) => r.room_id === id)?.label)
                if (ref) setOverlay({ kind: 'room', ref, note })
              }}
              onAddRoom={(c) =>
                setCustomRooms((cs) => (cs.some((x) => customRoomToRoom(x).id === customRoomToRoom(c).id) ? cs : [...cs, c]))
              }
              onScan={openPlace}
              onFocusMap={(lon, lat) => setFlyTo({ lon, lat, zoom: 17, key: Date.now() })}
            />
          ) : (
            <Results results={res?.results ?? null} total={res?.total ?? null} error={resError} hovered={hovered} onHover={setHovered} onOpen={pickOrOpen} picked={picks} />
          )}
        </section>
      </main>

      {picks && !overlay && (
        <CompareBar picks={picks.map((sid) => ({ sid, label: labelOf(sid) }))} onRemove={(sid) => setPicks(picks.filter((x) => x !== sid))} onCancel={() => setPicks(null)} />
      )}

      {overlay?.kind === 'room' && (
        <RoomPage
          key={`${overlay.ref.sid}/${overlay.ref.roomId}`}
          room={overlay.ref}
          risk={roomRisk.risk}
          catalog={catalog}
          note={overlay.note}
          onOpenRoom={(roomId, label) => setOverlay({ kind: 'room', ref: { ...overlay.ref, roomId, label } })}
          onHeatmap={() => setOverlay({ kind: 'tour', sid: overlay.ref.sid, title: overlay.ref.address, choose: true })}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === 'compare' && (
        <PropertyCompare
          a={{ sid: overlay.a, address: labelOf(overlay.a) }}
          b={{ sid: overlay.b, address: labelOf(overlay.b) }}
          onOpen={(ref, note) => setOverlay({ kind: 'room', ref, note })}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === 'tour' && (
        <div className="fixed inset-0 z-40 flex flex-col bg-paper" data-testid="tour-page">
          <TourExperience
            key={overlay.sid}
            sid={overlay.sid}
            title={overlay.title}
            startChoosing={overlay.choose}
            onBack={() => setOverlay(null)}
            backLabel="Back"
            onUseRoom={(_slot, roomId, label) =>
              setOverlay({ kind: 'room', ref: { sid: overlay.sid, roomId, label, address: overlay.title } })
            }
          />
        </div>
      )}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold transition ${on ? 'bg-ink text-paper' : 'border border-line hover:bg-soft'}`}
      data-testid={`chip-${children.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {children}
    </button>
  )
}

/** Shown while comparing: the homes picked so far. The second pick opens the comparison. */
function CompareBar({ picks, onRemove, onCancel }: { picks: { sid: string; label: string }[]; onRemove: (sid: string) => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4" data-testid="compare-bar">
      <div className="flex max-w-full items-center gap-2 rounded-full border border-line bg-paper p-1.5 pl-4 text-[13px] shadow-xl">
        <span className="shrink-0 font-semibold">{picks.length === 0 ? 'Click two homes to compare' : 'Now click a second home'}</span>
        {picks.map((p, i) => (
          <span key={p.sid} className="flex min-w-0 items-center gap-1.5 rounded-full bg-soft px-2.5 py-1">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? 'bg-a' : 'bg-b'}`} />
            <span className="max-w-40 truncate">{p.label}</span>
            <button onClick={() => onRemove(p.sid)} className="text-mute hover:text-ink" aria-label={`Remove ${p.label}`}>
              ✕
            </button>
          </span>
        ))}
        <Button size="sm" kind="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
