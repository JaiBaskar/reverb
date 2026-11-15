import { useEffect, useRef, useState } from 'react'
import type { HouseAnalysis } from '../../api'
import type { CustomRoomSpec } from '../../roomRef'
import type { AcousticReport, CatalogEntry, Room } from '../../types'
import { roomSize, thumbUrl } from '../../ui/format'
import { Button, Dot, Fine, Stat } from '../../ui/kit'
import { friendlyTag, outsideRating, reverbRating } from '../../ui/rating'
import { midRt60 } from '../acoustic-visualization/classify'
import { CustomRoomForm } from '../rooms/CustomRoomForm'
import { RiskPanel } from '../risk/RiskPanel'
import type { NoiseRisk } from '../risk/types'
import { ModelViewer } from '../viewer/ModelViewer'

interface Props {
  sid: string
  entry: CatalogEntry | null
  address: string
  propError: string | null
  rooms: Room[] | null
  roomsError: string | null
  /** Every room analyzed by the server, best music room first. */
  analysis: { analysis: HouseAnalysis | null; loading: boolean; error: string | null }
  /** Reports for rooms the user added by size (not in the server's analysis). */
  reports: Record<string, AcousticReport | 'error'>
  risk: { risk: NoiseRisk | null; loading: boolean; error: string | null }
  onClose: () => void
  onTour: () => void
  onOpenRoom: (roomId: string, note?: string) => void
  onAddRoom: (c: CustomRoomSpec) => void
  onScan: (sid: string) => void
  onFocusMap: (lon: number, lat: number) => void
}

/** One place, listing-page style: 3D model, ONE big "Analyze this home" button, facts, rooms, noise. */
export function PlaceView(p: Props) {
  const [allNoise, setAllNoise] = useState(false)
  const [wantOpen, setWantOpen] = useState(false)
  const a = p.analysis.analysis
  const best = a?.best ?? null
  const bestNote = a && best ? `Best of ${a.rooms.filter((r) => r.eligible).length} music-room candidates` : undefined
  const usable = (p.rooms ?? []).filter((r) => r.usable)
  const byId = new Map((p.rooms ?? []).map((r) => [r.id, r]))
  const custom = usable.filter((r) => !a?.rooms.some((x) => x.room_id === r.id))
  const ranked = p.risk.risk?.ranked ?? []
  const outside = p.risk.risk ? outsideRating(ranked) : null

  // Clicked while the house was still being analyzed: open the best room as soon as it is known.
  const pending = useRef(false)
  const analyze = () => {
    if (best) return p.onOpenRoom(best.room_id, bestNote)
    pending.current = true
    setWantOpen(true)
  }
  useEffect(() => {
    if (pending.current && best) {
      pending.current = false
      p.onOpenRoom(best.room_id, bestNote)
    }
  }, [best]) // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = wantOpen && !best && !a

  const analyzeLabel = p.analysis.error
    ? 'Analysis unavailable'
    : waiting
      ? 'Analyzing every room…'
      : a && !best
        ? 'No music room found'
        : 'Analyze this home'

  return (
    <div className="pb-16" data-testid="place">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper px-4 py-2.5">
        <button onClick={p.onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-soft" aria-label="Back to results" data-testid="place-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <span className="text-sm text-mute">Results</span>
        <div className="ml-auto">
          {!p.propError && (
            <Button size="sm" onClick={p.onTour} data-testid="open-tour">
              3D tour
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-5 p-4">
        {p.propError ? (
          <img src={thumbUrl(p.sid, 960)} alt="" className="aspect-video w-full rounded-2xl bg-soft object-cover" />
        ) : (
          <ModelViewer sid={p.sid} />
        )}

        <div>
          <h1 className="text-2xl font-bold leading-tight" data-testid="place-address">{p.address || 'Loading…'}</h1>
          <div className="mt-1 text-sm text-mute">
            {[p.entry?.city, p.entry?.type_label ?? (p.entry?.kind === 'residential' ? 'Home' : p.entry ? 'Commercial' : null), p.rooms && `${usable.length} rooms`]
              .filter(Boolean)
              .join(' · ')}
          </div>
          {p.entry && p.entry.model_ids.length > 1 && (
            <div className="mt-2 flex items-center gap-1 text-xs text-mute" data-testid="scans">
              Scans
              {p.entry.model_ids.map((sid, i) => (
                <button
                  key={sid}
                  onClick={() => p.onScan(sid)}
                  className={`h-6 min-w-6 rounded-full px-2 font-semibold ${sid === p.sid ? 'bg-ink text-paper' : 'bg-soft text-ink'}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={analyze}
          disabled={!!p.analysis.error || (!!a && !best)}
          className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-accent text-lg font-bold text-paper shadow-lg transition hover:brightness-110 disabled:opacity-40"
          data-testid="analyze-home"
        >
          {waiting && <span className="h-3 w-3 animate-pulse rounded-full bg-paper" />}
          {analyzeLabel}
          {!waiting && best && <span className="text-sm font-medium opacity-80">→ {best.label}</span>}
        </button>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Outside" testId="fact-outside" value={outside?.label ?? (p.risk.error ? 'Unknown' : '…')} tone={outside?.tone} sub={outside?.detail} />
          <button
            onClick={() => best && p.onOpenRoom(best.room_id, bestNote)}
            disabled={!best}
            className="min-w-0 rounded-2xl text-left transition hover:bg-soft disabled:hover:bg-transparent"
            data-testid="fact-best"
            title={a?.rule}
          >
            <Stat
              label="Best room →"
              value={best ? best.label : a ? 'None' : '…'}
              tone={best ? reverbRating(best.mid_rt60_s).tone : undefined}
              sub={best ? `${best.mid_rt60_s.toFixed(2)} s reverb · ${reverbRating(best.mid_rt60_s).label}` : undefined}
            />
          </button>
        </div>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Rooms</h2>
          {p.propError && <p className="mb-2 text-sm text-mute">No scan data. Add a room by size.</p>}
          {p.roomsError && !p.propError && <p className="mb-2 text-sm text-mute">No room measurements. Add a room by size.</p>}
          {!a && !p.analysis.error && !p.propError && <p className="text-sm text-mute">Analyzing rooms…</p>}
          <ul className="divide-y divide-line rounded-2xl border border-line" data-testid="room-list">
            {a?.rooms.map((x) => {
              const rate = reverbRating(x.mid_rt60_s)
              const room = byId.get(x.room_id)
              return (
                <li key={x.room_id}>
                  <button
                    onClick={() => p.onOpenRoom(x.room_id, x.room_id === best?.room_id ? bestNote : undefined)}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-soft ${x.eligible ? '' : 'opacity-50'}`}
                    title={x.reason ?? undefined}
                    data-testid={`room-${x.room_id}`}
                  >
                    <Dot tone={rate.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {x.label}
                        {x.room_id === best?.room_id && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Best</span>}
                      </span>
                      <span className="block truncate text-xs text-mute">
                        {[room && roomSize(room), `${x.mid_rt60_s.toFixed(2)} s · ${rate.label}`, x.reason && 'not a music room'].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <svg className="shrink-0 text-mute" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </li>
              )
            })}
            {custom.map((r) => {
              const rep = p.reports[r.id]
              const mid = rep && rep !== 'error' ? midRt60(rep) : null
              return (
                <li key={r.id}>
                  <button onClick={() => p.onOpenRoom(r.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-soft" data-testid={`room-${r.id}`}>
                    <Dot tone={mid != null ? reverbRating(mid).tone : undefined} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.label}</span>
                      <span className="block truncate text-xs text-mute">{[roomSize(r), mid != null ? `${mid.toFixed(2)} s` : 'measuring…', 'added by you'].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              )
            })}
            {p.rooms != null && (
              <li className="px-3 py-2.5">
                <CustomRoomForm key={p.sid} prominent={usable.length === 0} onAdd={p.onAddRoom} />
              </li>
            )}
          </ul>
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Nearby noise</h2>
            {ranked.length > 0 && (
              <button className="text-sm font-semibold text-accent" onClick={() => setAllNoise((v) => !v)} data-testid="noise-more">
                {allNoise ? 'Less' : 'Details'}
              </button>
            )}
          </div>
          {p.risk.loading && !p.risk.risk && <p className="text-sm text-mute">Checking the map…</p>}
          {p.risk.error && <p className="text-sm text-mute">Unavailable right now.</p>}
          {p.risk.risk && ranked.length === 0 && <p className="text-sm text-mute">Nothing noisy mapped nearby.</p>}
          {allNoise && p.risk.risk ? (
            <RiskPanel sid={p.sid} risk={p.risk.risk} loading={p.risk.loading} error={p.risk.error} onFocus={p.onFocusMap} />
          ) : (
            <ul className="space-y-2" data-testid="noise-top">
              {ranked.slice(0, 4).map((r) => (
                <li key={r.id}>
                  <button onClick={() => p.onFocusMap(r.lon, r.lat)} className="flex w-full items-center gap-3 text-left text-sm">
                    <Dot tone={r.level === 'high' ? 'bad' : r.level === 'moderate' ? 'ok' : 'good'} />
                    <span className="min-w-0 flex-1 truncate">{r.name ?? friendlyTag(r.subtype)}</span>
                    <span className="shrink-0 tabular-nums text-mute">{Math.round(r.distance_m)} m</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Fine>Acoustics and audio are modeled, not measured. CoStar · Matterport · OpenStreetMap.</Fine>
      </div>
    </div>
  )
}
