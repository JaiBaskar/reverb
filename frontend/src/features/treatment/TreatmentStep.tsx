import { useEffect, useMemo, useState } from 'react'
import { fetchObjectives, fetchTour } from '../../api'
import type { SlotRef } from '../../roomRef'
import type { TourLayout } from '../../types'
import { reverbRating, TONE_BG } from '../../ui/rating'
import { useAnalysis } from '../place/useAnalysis'
import { HousePlan, type PlanRoomInfo } from './HousePlan'
import { RtChart } from './RtChart'
import { ITEM_COLORS } from './colors'
import { TreatmentView } from './TreatmentView'
import type { Objective, PlacedItem, TreatmentPlan } from './types'
import { useHousePlan, usePlan } from './usePlan'

type Scenario = 'as_scanned' | 'empty'

const FALLBACK: Objective[] = [
  { id: 'mixing', label: 'Mixing', layout: 'monitoring', needs_rfz: true, rfz_db: 10, allow_diffusion: true, basis: '' },
  { id: 'music_production', label: 'Music production', layout: 'monitoring', needs_rfz: true, rfz_db: 6, allow_diffusion: true, basis: '' },
  { id: 'critical_listening', label: 'Critical listening', layout: 'monitoring', needs_rfz: true, rfz_db: 10, allow_diffusion: true, basis: '' },
  { id: 'recording', label: 'Recording vocals and instruments', layout: 'mic', needs_rfz: false, rfz_db: 0, allow_diffusion: true, basis: '' },
  { id: 'podcasting', label: 'Podcasting and voice', layout: 'mic', needs_rfz: false, rfz_db: 0, allow_diffusion: false, basis: '' },
]

const SEVERITY = { high: 'bg-rose-500/15 text-rose-300', medium: 'bg-amber-500/15 text-amber-300', low: 'bg-zinc-800 text-zinc-300' }
const PROV = {
  observed: 'bg-emerald-500/15 text-emerald-300',
  verified: 'bg-emerald-500/15 text-emerald-300',
  estimated: 'bg-sky-500/15 text-sky-300',
  assumed: 'bg-amber-500/15 text-amber-300',
  user: 'bg-violet-500/15 text-violet-300',
  missing: 'bg-zinc-800 text-zinc-400',
} as Record<string, string>

function Badge({ p }: { p: string }) {
  return <span className={`rounded px-1.5 py-px text-[10px] uppercase tracking-wide ${PROV[p] ?? PROV.missing}`}>{p}</span>
}

interface Props {
  /** The room whose page this is: the plan opens on it. */
  room: SlotRef
  objective: string
  onObjective: (id: string) => void
  onHearTreated: (plan: TreatmentPlan, avoidWalls: number[]) => void
  /** Hear another room: opens that room's page. */
  onOpenRoom?: (roomId: string, label: string) => void
  /** A room was picked on the plan or in the list: the page above follows it. */
  onPick?: (roomId: string, label: string) => void
}

/** Short names and one-line meaning for each use, so the choice reads at a glance. */
const USE: Record<string, { label: string; hint: string }> = {
  mixing: { label: 'Mixing', hint: 'Hear your mix as it really is: speakers, no room colour.' },
  music_production: { label: 'Producing', hint: 'Writing and producing at the desk, a little more forgiving than mixing.' },
  critical_listening: { label: 'Listening', hint: 'Hi-fi or reference listening from one sweet spot.' },
  recording: { label: 'Recording', hint: 'Vocals and instruments into a mic, without the room in the take.' },
  podcasting: { label: 'Podcast', hint: 'Clear speech: dead and quiet, no echo.' },
}

export function TreatmentStep({ room, objective, onObjective, onHearTreated, onOpenRoom, onPick }: Props) {
  const [objectives, setObjectives] = useState<Objective[]>(FALLBACK)
  const [scenario, setScenario] = useState<Scenario>('as_scanned')
  const [roomId, setRoomId] = useState(room.roomId)
  const [avoidBy, setAvoidBy] = useState<Record<string, number[]>>({})
  const avoid = avoidBy[roomId] ?? NONE
  const [showAll, setShowAll] = useState(false)
  const [floor, setFloor] = useState<number | null>(null)
  const [showOthers, setShowOthers] = useState(false)
  const [hoverItem, setHoverItem] = useState<string | null>(null)
  const { plan, error, loading } = usePlan(room.sid, roomId, objective, scenario, avoid)
  // The last plan stays on screen while a new one is worked out, so the 3D view is not reloaded.
  const [shown, setShown] = useState<TreatmentPlan | undefined>(undefined)
  if (plan && plan !== shown) setShown(plan)
  const house = useHousePlan(room.sid, objective, scenario, showAll)
  const analysis = useAnalysis(room.sid).analysis
  const [layout, setLayout] = useState<TourLayout | null>(null)
  useEffect(() => {
    fetchObjectives()
      .then(setObjectives)
      .catch(() => setObjectives(FALLBACK))
    fetchTour(room.sid)
      .then(setLayout)
      .catch(() => setLayout(null))
  }, [room.sid])

  const extraItems = useMemo(
    () => (showAll ? (house.house?.rooms ?? []).filter((r) => r.status === 'ok' && r.room_id !== roomId).flatMap((r) => r.items) : NONE_ITEMS),
    [house.house, roomId, showAll],
  )
  const toggleWall = (i: number) =>
    setAvoidBy((m) => {
      const cur = m[roomId] ?? []
      return { ...m, [roomId]: cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((x, y) => x - y) }
    })

  // Rooms: the server's analysis (best music room first), names disambiguated, grouped by floor.
  const ranked = useMemo(() => analysis?.rooms ?? [], [analysis])
  const names = useMemo(() => {
    const out: Record<string, string> = {}
    const count: Record<string, number> = {}
    for (const r of ranked) count[r.label] = (count[r.label] ?? 0) + 1
    const seen: Record<string, number> = {}
    for (const r of ranked) {
      seen[r.label] = (seen[r.label] ?? 0) + 1
      out[r.room_id] = count[r.label] > 1 ? `${r.label} ${seen[r.label]}` : r.label
    }
    return out
  }, [ranked])
  const info = useMemo(() => {
    const out: Record<string, PlanRoomInfo> = {}
    for (const r of ranked) out[r.room_id] = { tone: reverbRating(r.mid_rt60_s).tone, value: `${r.mid_rt60_s.toFixed(2)} s`, candidate: r.eligible }
    return out
  }, [ranked])
  const floors = (layout?.floors ?? []).filter((f) => layout!.rooms.some((r) => r.floor_index === f.index && r.polygon))
  const selectedFloor = layout?.rooms.find((r) => r.room_id === roomId)?.floor_index ?? null
  const floorShown = floor ?? selectedFloor ?? floors[0]?.index ?? null
  const planRooms = (layout?.rooms ?? []).filter((r) => floors.length < 2 || r.floor_index === floorShown)
  const pick = (id: string) => {
    setRoomId(id)
    const lr = layout?.rooms.find((r) => r.room_id === id)
    if (lr?.floor_index != null) setFloor(lr.floor_index)
    onPick?.(id, names[id] ?? lr?.label ?? id)
  }
  const candidates = ranked.filter((r) => r.eligible)
  const others = ranked.filter((r) => !r.eligible)
  const pickedName = names[roomId] ?? shown?.label ?? room.label
  const isHome = roomId === room.roomId
  const use = USE[objective] ?? { label: objectives.find((o) => o.id === objective)?.label ?? objective, hint: '' }

  const p = shown?.room_id === roomId ? shown.prediction : undefined
  const current = shown?.room_id === roomId ? shown : undefined
  const inTarget = (v: number) => p && v >= p.target_low_s[2] && v <= p.target_high_s[2]

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]" data-testid="treatment-step">
      {/* Left: the house. Click any room to plan its treatment. */}
      <aside className="space-y-3 lg:sticky lg:top-16 lg:self-start" data-testid="treatment-rooms">
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold">Pick a room</h3>
          {floors.length > 1 && (
            <div className="flex gap-1">
              {floors.map((f) => (
                <button
                  key={f.index}
                  onClick={() => setFloor(f.index)}
                  className={`h-7 rounded-full px-2.5 text-xs font-semibold ${floorShown === f.index ? 'bg-ink text-paper' : 'border border-line'}`}
                >
                  {f.label || `Floor ${f.index + 1}`}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="aspect-square w-full rounded-2xl border border-line bg-soft p-2">
          {layout ? (
            <HousePlan rooms={planRooms} info={info} selectedId={roomId} homeId={room.roomId} names={names} onSelect={pick} />
          ) : (
            <p className="p-4 text-sm text-mute">Loading the floor plan…</p>
          )}
        </div>
        <ul className="space-y-1" data-testid="treatment-room-list">
          {[...candidates, ...(showOthers ? others : [])].map((r) => (
            <li key={r.room_id}>
              <button
                onClick={() => pick(r.room_id)}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                  r.room_id === roomId ? 'bg-accent text-paper' : 'hover:bg-soft'
                } ${r.eligible ? '' : 'opacity-60'}`}
                data-testid={`treat-room-${r.room_id}`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.room_id === roomId ? 'bg-paper' : TONE_BG[reverbRating(r.mid_rt60_s).tone]}`} />
                <span className="min-w-0 flex-1 truncate font-medium">{names[r.room_id]}</span>
                {r.room_id === room.roomId && <span className="text-[11px] opacity-70">this page</span>}
                <span className="tabular-nums opacity-70">{r.mid_rt60_s.toFixed(2)} s</span>
              </button>
            </li>
          ))}
        </ul>
        {others.length > 0 && (
          <button className="text-xs font-semibold text-mute hover:text-ink" onClick={() => setShowOthers((v) => !v)}>
            {showOthers ? 'Hide' : 'Show'} {others.length} other rooms (bathrooms, halls…)
          </button>
        )}
      </aside>

      {/* Right: the picked room's treatment. */}
      <div className="min-w-0 space-y-5">
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-mute">1 · What will you do in {pickedName}?</div>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Intended use">
              {objectives.map((o) => (
                <button
                  key={o.id}
                  role="radio"
                  aria-checked={objective === o.id}
                  onClick={() => onObjective(o.id)}
                  className={`h-9 rounded-full px-4 text-sm font-semibold transition ${objective === o.id ? 'bg-ink text-paper' : 'border border-line hover:bg-soft'}`}
                  data-testid={`objective-${o.id}`}
                >
                  {USE[o.id]?.label ?? o.label}
                </button>
              ))}
            </div>
            {use.hint && <p className="mt-1.5 text-xs text-mute">{use.hint}</p>}
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-mute">2 · Furniture</div>
            <div className="inline-flex rounded-full bg-soft p-1" role="radiogroup" aria-label="Furniture scenario">
              {(
                [
                  ['as_scanned', 'As it is now'],
                  ['empty', 'Empty (moving in)'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={scenario === id}
                  onClick={() => setScenario(id)}
                  className={`h-8 rounded-full px-4 text-sm font-semibold transition ${scenario === id ? 'bg-paper shadow-sm' : 'text-mute hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="rounded-xl bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</p>}
        {!current && !error && (
          <p className="rounded-2xl border border-dashed border-line px-3 py-10 text-center text-sm text-mute">
            Working out the treatment for {pickedName}…
          </p>
        )}

        {current && p && (
          <>
            <div className="rounded-2xl border border-line p-4" data-testid="plan-summary">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">
                  {pickedName} for {use.label.toLowerCase()}
                </h3>
                {loading && <span className="text-xs text-mute">updating…</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <div className="text-xs text-mute">Reverb now → treated</div>
                  <div className="flex items-center gap-2 text-2xl font-bold tabular-nums">
                    <span className={inTarget(p.mid_before_s) ? 'text-good' : 'text-bad'}>{p.mid_before_s.toFixed(2)} s</span>
                    <span className="text-mute">→</span>
                    <span className={inTarget(p.mid_after_s) ? 'text-good' : 'text-ok'}>{p.mid_after_s.toFixed(2)} s</span>
                  </div>
                  <div className="text-xs text-mute">
                    goal {p.target_low_s[2].toFixed(2)}–{p.target_high_s[2].toFixed(2)} s for {use.label.toLowerCase()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-mute">You'd add</div>
                  <div className="text-2xl font-bold">{current.items.length} items</div>
                  <div className="text-xs text-mute">{itemSummary(current)}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {isHome ? (
                  <button
                    onClick={() => onHearTreated(current, avoid)}
                    className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-paper hover:brightness-110"
                    data-testid="hear-treated"
                  >
                    ▶ Hear it before and after
                  </button>
                ) : (
                  onOpenRoom && (
                    <button
                      onClick={() => onOpenRoom(roomId, current.label)}
                      className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-paper hover:brightness-110"
                      data-testid="open-treated-room"
                    >
                      Open {pickedName} to hear it →
                    </button>
                  )
                )}
                <label className="flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm">
                  <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-[var(--color-accent)]" data-testid="show-all-rooms" />
                  Show every room's panels in 3D
                </label>
              </div>
              {showAll && house.loading && <p className="mt-2 text-xs text-mute">Planning the other rooms (10-30 s the first time)…</p>}
              {showAll && house.error && <p className="mt-2 text-xs text-bad">Could not plan the other rooms: {house.error}</p>}
            </div>

            <div>
              <TreatmentView plan={current} extraItems={extraItems} focusKey={hoverItem} />
              <ItemLegend plan={current} />
            </div>

            <div className="rounded-2xl border border-line p-3" data-testid="keep-clear">
              <div className="text-sm">
                <span className="font-semibold">Something on a wall we missed?</span>{' '}
                <span className="text-mute">Tap that wall to keep it clear (window, door, built-in).</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {current.room.walls
                  .filter((w) => w.length_m >= 0.9)
                  .map((w) => (
                    <button
                      key={w.index}
                      onClick={() => toggleWall(w.index)}
                      aria-pressed={avoid.includes(w.index)}
                      className={`h-8 rounded-full px-3 text-[13px] ${avoid.includes(w.index) ? 'bg-ink font-semibold text-paper' : 'border border-line hover:bg-soft'}`}
                      data-testid={`keep-clear-${w.index}`}
                    >
                      {avoid.includes(w.index) ? '✕ ' : ''}
                      {w.name} · {w.length_m.toFixed(1)} m
                    </button>
                  ))}
              </div>
            </div>

            <details className="rounded-2xl border border-line" data-testid="plan-why">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Why these items, and where exactly</summary>
              <div className="space-y-6 px-4 pb-4">
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-lg font-semibold">What's wrong with the room</h2>
              <ul className="space-y-2" data-testid="problems">
                {current.problems.map((pr) => (
                  <li key={pr.id} className="rounded-xl border border-zinc-800 p-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-px text-[10px] uppercase ${SEVERITY[pr.severity]}`}>{pr.severity}</span>
                      <span className="font-medium">{pr.title}</span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-300">{pr.detail}</p>
                    <p className="mt-1 text-sm text-emerald-300">{pr.after}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="mb-2 text-lg font-semibold">How it changes</h2>
              <RtChart p={p} />
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <Kv k="Bass ratio (125-250 Hz vs mids)" v={`${p.bass_ratio_before.toFixed(2)} → ${p.bass_ratio_after.toFixed(2)}`} />
                <Kv k="Schroeder frequency" v={`${p.schroeder_before_hz.toFixed(0)} → ${p.schroeder_after_hz.toFixed(0)} Hz`} />
              </dl>
              <details className="mt-3 rounded-xl border border-zinc-800">
                <summary className="cursor-pointer px-3 py-2 text-sm text-zinc-300">Early reflections at the {current.layout?.kind === 'mic' ? 'mic' : 'listening position'}</summary>
                <table className="w-full text-xs">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="px-3 py-1 text-left">From</th>
                      <th className="text-left">Off</th>
                      <th className="text-right">Delay</th>
                      <th className="text-right">Now</th>
                      <th className="px-3 text-right">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.reflections.map((r, i) => (
                      <tr key={i} className="border-t border-zinc-800">
                        <td className="px-3 py-1">{r.source}</td>
                        <td>{r.surface}</td>
                        <td className="text-right tabular-nums">{r.delay_ms.toFixed(1)} ms</td>
                        <td className="text-right tabular-nums">{r.before_db.toFixed(1)} dB</td>
                        <td className={`px-3 text-right tabular-nums ${r.treated_by ? 'text-emerald-300' : 'text-zinc-400'}`}>{r.after_db.toFixed(1)} dB</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">The plan</h2>
            {current.layout && <p className="mb-3 text-sm text-zinc-400">{current.layout.note}</p>}
            <div className="space-y-3" data-testid="plan-groups">
              {current.groups.map((g) => (
                <div key={`${g.group}-${g.product_id}`} className="rounded-xl border border-zinc-800 p-3">
                  <div className="font-medium">
                    {g.count} × {g.product}
                  </div>
                  <div className="text-sm text-zinc-400">{g.why}.</div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {current.items
                      .filter((i) => i.group === g.group && i.product_id === g.product_id)
                      .map((i) => (
                        <li
                          key={i.key}
                          className="-mx-1 rounded px-1 text-zinc-300 hover:bg-soft"
                          data-testid={`item-${i.key}`}
                          onMouseEnter={() => setHoverItem(i.key)}
                          onMouseLeave={() => setHoverItem((k) => (k === i.key ? null : k))}
                        >
                          <span className="text-zinc-100">{i.where}.</span> <span className="text-zinc-400">{i.reason}</span>
                          {i.status === 'blocked' && (
                            <div className="mt-0.5 text-orange-300">
                              ⚠ In the way: {[...new Set(i.blocked_by.map((b) => b.label))].join(', ')}. Move{' '}
                              {i.blocked_by.length > 1 ? 'them' : 'it'} to hang this here (dashed in the 3D view where it is hidden).
                            </div>
                          )}
                          {(i.status === 'moved' || i.status === 'replaced') && i.adjustment && (
                            <div className="mt-0.5 text-sky-300">↳ {i.adjustment.charAt(0).toUpperCase() + i.adjustment.slice(1)}.</div>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            {current.notes.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-200">
                {current.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">What REVERB read from the scan</h2>
            <Found plan={current} />
          </section>

          <div className="space-y-2">
            <More title="Other configurations the optimiser compared">
              <ul className="space-y-1 text-sm">
                {current.alternatives.map((a) => (
                  <li key={a.summary} className={a.chosen ? 'text-emerald-300' : 'text-zinc-400'}>
                    {a.chosen ? '✓ ' : ''}
                    {a.summary}: {a.items} items, mid RT60 {a.mid_rt60_s.toFixed(2)} s (score {a.score})
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">
                Score = how far each band is outside the target + early reflections still too loud + a small cost per item.
                Lowest wins.
              </p>
            </More>
            <More title="Exact positions (Matterport model coordinates, metres)">
              <table className="w-full text-xs tabular-nums">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 text-left">Item</th>
                    <th className="text-right">x</th>
                    <th className="text-right">y</th>
                    <th className="text-right">height above floor</th>
                    <th className="text-right">size</th>
                  </tr>
                </thead>
                <tbody>
                  {current.items.map((i) => (
                    <tr key={i.key} className="border-t border-zinc-800">
                      <td className="py-1">{i.key}</td>
                      <td className="text-right">{i.center[0].toFixed(2)}</td>
                      <td className="text-right">{i.center[1].toFixed(2)}</td>
                      <td className="text-right">{(i.center[2] - current.room.floor_z).toFixed(2)}</td>
                      <td className="text-right">
                        {i.width_m.toFixed(2)} × {i.height_m.toFixed(2)} × {i.depth_m.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </More>
            <More title="Assumptions and limits">
              <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-400">
                {[...current.assumptions, ...current.limitations].map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </More>
          </div>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}

/** "2 thick panels · 1 bass trap": counts per product name across groups. */
function itemSummary(plan: TreatmentPlan): string {
  const n = new Map<string, number>()
  for (const g of plan.groups) n.set(shortName(g.product_id), (n.get(shortName(g.product_id)) ?? 0) + g.count)
  return [...n].map(([k, v]) => `${v} ${v === 1 ? k.replace(/s$/, '').replace(/traps$/, 'trap') : k}`).join(' · ')
}

const NONE: number[] = []
const NONE_ITEMS: PlacedItem[] = []

const GROUP_LABEL: Record<string, string> = {
  first_reflection: 'First-reflection panels',
  ceiling: 'Ceiling cloud',
  front_wall: 'Front-wall panels',
  rear_wall: 'Rear-wall panels',
  corner: 'Bass traps',
  coverage: 'Extra absorption',
}

/** What is drawn in the 3D view, by colour (scene.ts COLORS). */
function ItemLegend({ plan }: { plan: TreatmentPlan }) {
  const blocked = plan.items.filter((i) => i.status === 'blocked').length
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="item-legend">
      {plan.groups.map((g) => (
        <span key={`${g.group}-${g.product_id}`} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
          <span className="h-3 w-3 rounded-sm" style={{ background: ITEM_COLORS[g.product_id] ?? '#6b7079' }} />
          {g.count} × {GROUP_LABEL[g.group] ?? g.product}
        </span>
      ))}
      {blocked > 0 && (
        <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-mute">
          <span className="h-3 w-3 rounded-sm border-2 border-dashed border-b" />
          {blocked} behind furniture (dashed where hidden)
        </span>
      )}
    </div>
  )
}

function Found({ plan }: { plan: TreatmentPlan }) {
  const r = plan.room
  const openings = r.walls.reduce((n, w) => n + w.openings.length, 0)
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="found">
      <div className="space-y-1.5 rounded-xl border border-zinc-800 p-3 text-sm">
        <div className="font-medium">Geometry</div>
        <Row k="Floor area" v={`${r.area_m2.toFixed(1)} m²`} p={r.geometry_source === 'box' ? 'estimated' : 'verified'} />
        <Row k="Ceiling height" v={`${r.height_m.toFixed(2)} m`} p={r.height_provenance} />
        <Row k="Volume" v={`${r.volume_m3.toFixed(1)} m³`} p="estimated" />
        <Row
          k="Walls"
          v={`${r.walls.length}, ${openings} opening${openings === 1 ? '' : 's'}`}
          p={r.geometry_source === 'mesh+outline' ? 'verified' : 'estimated'}
        />
        <p className="pt-1 text-xs text-zinc-500">
          {r.geometry_source === 'mesh+outline'
            ? 'Outline from Matterport, checked against the scan mesh (height and openings).'
            : r.geometry_source === 'outline'
              ? 'Outline from Matterport; no mesh, so openings are unknown.'
              : 'No outline: a rectangle from Matterport’s room size.'}
        </p>
      </div>
      <div className="space-y-1.5 rounded-xl border border-zinc-800 p-3 text-sm">
        <div className="font-medium">Surfaces and furniture</div>
        {r.materials.map((m) => (
          <Row key={m.surface} k={m.surface} v={m.label} p={m.provenance} title={m.basis} />
        ))}
        <div className="pt-1 text-zinc-300">
          {r.furniture.length ? r.furniture.map((f) => `${f.count > 1 ? `${f.count} × ` : ''}${f.id.replace('_', ' ')}`).join(', ') : 'No furniture'}
        </div>
        <p className="text-xs text-zinc-500">{plan.scenario === 'empty' ? 'Empty room (moving-in scenario).' : r.furniture_basis}</p>
      </div>
      <div className="space-y-2 rounded-xl border border-zinc-800 p-3 text-sm md:col-span-2" data-testid="agents">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Vision agents</span>
          {r.agents.map((a) => (
            <span
              key={a.agent}
              title={a.reason ?? a.model ?? ''}
              className={`rounded px-1.5 py-px text-[10px] uppercase ${a.status === 'ok' ? PROV.observed : a.status === 'error' ? 'bg-red-500/15 text-red-300' : PROV.missing}`}
            >
              {a.agent} {a.status === 'ok' ? '✓' : a.status}
            </span>
          ))}
        </div>
        {r.vision_status === 'unavailable' || r.vision_status === 'error' ? (
          <p className="text-amber-200">
            Not inspected: {r.vision_reason ?? 'no vision model'} Materials and furniture are typical for the room type
            instead, and marked assumed.
          </p>
        ) : (
          <>
            {r.wall_findings.some((w) => w.features.length || w.material_id) && (
              <ul className="space-y-0.5 text-zinc-300">
                {r.wall_findings
                  .filter((w) => w.features.length || w.material_id)
                  .map((w) => (
                    <li key={w.wall}>
                      <span className="capitalize text-zinc-400">{w.name}:</span> {w.finish ?? 'finish not identified'}
                      {w.features.length > 0 &&
                        ' · ' +
                          w.features
                            .map((f) => `${f.kind.replace(/_/g, ' ')} ${f.along[0].toFixed(1)}–${f.along[1].toFixed(1)} m along, ${f.z[0].toFixed(1)}–${f.z[1].toFixed(1)} m up`)
                            .join('; ')}
                    </li>
                  ))}
              </ul>
            )}
            {r.pieces.length > 0 && (
              <div className="text-zinc-300">
                <span className="text-zinc-400">Furniture:</span>{' '}
                {r.pieces
                  .map((p) => `${p.label}${p.count > 1 ? ` ×${p.count}` : ''} (${p.covering}${p.furniture_id ? '' : ', not counted'})`)
                  .join(', ')}
              </div>
            )}
            {r.furniture_objects.length > 0 && (
              <div className="text-xs text-zinc-500">
                {r.furniture_objects.length} pieces of furniture located in the 3D scan (furnished minus empty mesh), used to
                check every item for overlaps.
              </div>
            )}
            {r.absorption_notes.length > 0 && (
              <div className="text-xs text-zinc-500">Counted in the acoustics: {r.absorption_notes.join('; ')}.</div>
            )}
            {r.vision_reason && <div className="text-xs text-amber-300">{r.vision_reason}</div>}
          </>
        )}
      </div>
    </div>
  )
}

const shortName = (id: string) =>
  ({ panel_50: 'thin panels', panel_50_square: 'half-size panels', panel_100: 'thick panels', bass_trap: 'bass traps', cloud_100: 'cloud', diffuser_qrd: 'diffusers' })[id] ?? id

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 p-2">
      <dt className="text-xs text-zinc-400">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  )
}

function Row({ k, v, p, title }: { k: string; v: string; p: string; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-2" title={title}>
      <span className="capitalize text-zinc-400">{k}</span>
      <span className="flex items-center gap-1.5 text-right">
        {v} <Badge p={p} />
      </span>
    </div>
  )
}

function More({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-zinc-800">
      <summary className="cursor-pointer px-4 py-3 text-sm text-zinc-300">{title}</summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}
