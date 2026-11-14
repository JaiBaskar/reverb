import { useEffect, useMemo, useState } from 'react'
import { fetchObjectives } from '../../api'
import type { SlotRef } from '../../roomRef'
import { RtChart } from './RtChart'
import { TreatmentView } from './TreatmentView'
import type { HouseTreatment, Objective, TreatmentPlan } from './types'
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
  room: SlotRef
  objective: string
  onObjective: (id: string) => void
  onHearTreated: (plan: TreatmentPlan, avoidWalls: number[]) => void
}

export function TreatmentStep({ room, objective, onObjective, onHearTreated }: Props) {
  const [objectives, setObjectives] = useState<Objective[]>(FALLBACK)
  const [scenario, setScenario] = useState<Scenario>('as_scanned')
  const [avoid, setAvoid] = useState<number[]>([])
  const { plan, error, loading } = usePlan(room.sid, room.roomId, objective, scenario, avoid)
  // The last plan stays on screen while a new one is worked out, so the 3D view is not reloaded.
  const [shown, setShown] = useState<TreatmentPlan | undefined>(undefined)
  if (plan && plan !== shown) setShown(plan)
  const [wholeHouse, setWholeHouse] = useState(false)
  const house = useHousePlan(room.sid, objective, scenario, wholeHouse)
  // memoised: the 3D scene is rebuilt whenever this array changes identity
  const extraItems = useMemo(
    () =>
      wholeHouse
        ? (house.house?.rooms ?? []).filter((r) => r.status === 'ok' && r.room_id !== room.roomId).flatMap((r) => r.items)
        : [],
    [house.house, room.roomId, wholeHouse],
  )
  const toggleWall = (i: number) => setAvoid((a) => (a.includes(i) ? a.filter((x) => x !== i) : [...a, i].sort((x, y) => x - y)))

  useEffect(() => {
    fetchObjectives()
      .then(setObjectives)
      .catch(() => setObjectives(FALLBACK))
  }, [])

  const p = shown?.prediction
  const worstBefore = p?.reflections.length ? Math.max(...p.reflections.map((r) => r.before_db)) : null
  const worstAfter = p?.reflections.length ? Math.max(...p.reflections.map((r) => r.after_db)) : null

  return (
    <div className="space-y-6" data-testid="treatment-step">
      <div className="space-y-3">
        <div>
          <div className="mb-1.5 text-sm text-zinc-400">What will you use {room.label} for?</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Intended use">
            {objectives.map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={objective === o.id}
                onClick={() => onObjective(o.id)}
                className={`rounded-full px-3 py-1.5 text-sm ${objective === o.id ? 'bg-amber-400 font-semibold text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                data-testid={`objective-${o.id}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-sm text-zinc-400">Show treatment for</div>
          <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Scope">
            {(
              [
                [false, `Just ${room.label}`],
                [true, 'The whole house'],
              ] as const
            ).map(([on, label]) => (
              <button
                key={String(on)}
                role="radio"
                aria-checked={wholeHouse === on}
                onClick={() => setWholeHouse(on)}
                className={`rounded-full px-3 py-1.5 text-sm ${wholeHouse === on ? 'bg-zinc-100 font-semibold text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                data-testid={`scope-${on ? 'house' : 'room'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mb-1.5 text-sm text-zinc-400">Furniture</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Furniture scenario">
            {(
              [
                ['as_scanned', 'As in the scan'],
                ['empty', 'Empty (moving in)'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="radio"
                aria-checked={scenario === id}
                onClick={() => setScenario(id)}
                className={`rounded-full px-3 py-1.5 text-sm ${scenario === id ? 'bg-zinc-100 font-semibold text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !shown && <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">Reading the scan and working out the treatment…</p>}
      {error && <p className="rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</p>}

      {shown && p && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="plan-summary">
            <Stat
              label="Reverb time (RT60, mid)"
              value={`${p.mid_before_s.toFixed(2)} → ${p.mid_after_s.toFixed(2)} s`}
              sub={`target ${p.target_low_s[2].toFixed(2)}–${p.target_high_s[2].toFixed(2)} s`}
            />
            <Stat
              label="Loudest early reflection"
              value={worstBefore == null ? '—' : `${worstBefore.toFixed(0)} → ${worstAfter!.toFixed(0)} dB`}
              sub="relative to the direct sound, first 15 ms"
            />
            <Stat
              label="Treatment"
              value={`${shown.items.length} items`}
              sub={shown.groups.map((g) => `${g.count} ${shortName(g.product_id)}`).join(' · ')}
            />
          </div>
          <button
            onClick={() => onHearTreated(shown, avoid)}
            className="w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-black hover:bg-emerald-300"
            data-testid="hear-treated"
          >
            Hear the room before and after →
          </button>

          <section>
            <h2 className="mb-2 text-lg font-semibold">See it in the room</h2>
            {wholeHouse && house.loading && (
              <p className="mb-2 text-sm text-amber-300">Planning every room of the house (about 10-30 s the first time)…</p>
            )}
            {wholeHouse && house.error && <p className="mb-2 text-sm text-red-300">Whole-house plan failed: {house.error}</p>}
            <TreatmentView plan={shown} avoidWalls={avoid} extraItems={extraItems} />
            {wholeHouse && house.house && <HouseTable house={house.house} current={room.roomId} />}
            <div className="mt-3 rounded-xl border border-zinc-800 p-3" data-testid="keep-clear">
              <div className="text-sm text-zinc-300">
                Keep a wall clear <span className="text-zinc-500">(a window, door or built-in REVERB could not see)</span>
                {loading && <span className="ml-2 text-amber-300">re-planning…</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {shown.room.walls
                  .filter((w) => w.length_m >= 0.9)
                  .map((w) => (
                    <button
                      key={w.index}
                      onClick={() => toggleWall(w.index)}
                      aria-pressed={avoid.includes(w.index)}
                      className={`rounded-full px-3 py-1 text-sm ${avoid.includes(w.index) ? 'bg-rose-400 font-semibold text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                      data-testid={`keep-clear-${w.index}`}
                    >
                      {avoid.includes(w.index) ? '✕ ' : ''}
                      {w.name} · {w.length_m.toFixed(1)} m
                    </button>
                  ))}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-lg font-semibold">What's wrong with the room</h2>
              <ul className="space-y-2" data-testid="problems">
                {shown.problems.map((pr) => (
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
                <summary className="cursor-pointer px-3 py-2 text-sm text-zinc-300">Early reflections at the {shown.layout?.kind === 'mic' ? 'mic' : 'listening position'}</summary>
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
            {shown.layout && <p className="mb-3 text-sm text-zinc-400">{shown.layout.note}</p>}
            <div className="space-y-3" data-testid="plan-groups">
              {shown.groups.map((g) => (
                <div key={`${g.group}-${g.product_id}`} className="rounded-xl border border-zinc-800 p-3">
                  <div className="font-medium">
                    {g.count} × {g.product}
                  </div>
                  <div className="text-sm text-zinc-400">{g.why}.</div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {shown.items
                      .filter((i) => i.group === g.group && i.product_id === g.product_id)
                      .map((i) => (
                        <li key={i.key} className="text-zinc-300" data-testid={`item-${i.key}`}>
                          <span className="text-zinc-100">{i.where}.</span> <span className="text-zinc-400">{i.reason}</span>
                          {i.status === 'blocked' && (
                            <div className="mt-0.5 text-orange-300">
                              ⚠ In the way: {[...new Set(i.blocked_by.map((b) => b.label))].join(', ')}. Move{' '}
                              {i.blocked_by.length > 1 ? 'them' : 'it'} to hang this here (shown see-through in the 3D view).
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
            {shown.notes.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-200">
                {shown.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">What REVERB read from the scan</h2>
            <Found plan={shown} />
          </section>

          <div className="space-y-2">
            <More title="Other configurations the optimiser compared">
              <ul className="space-y-1 text-sm">
                {shown.alternatives.map((a) => (
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
                  {shown.items.map((i) => (
                    <tr key={i.key} className="border-t border-zinc-800">
                      <td className="py-1">{i.key}</td>
                      <td className="text-right">{i.center[0].toFixed(2)}</td>
                      <td className="text-right">{i.center[1].toFixed(2)}</td>
                      <td className="text-right">{(i.center[2] - shown.room.floor_z).toFixed(2)}</td>
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
                {[...shown.assumptions, ...shown.limitations].map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </More>
          </div>
        </>
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

function HouseTable({ house, current }: { house: HouseTreatment; current: string }) {
  const ok = house.rooms.filter((r) => r.status === 'ok')
  const skipped = house.rooms.filter((r) => r.status !== 'ok')
  return (
    <div className="mt-3 rounded-xl border border-zinc-800 p-3 text-sm" data-testid="house-table">
      <div className="mb-2 font-medium">
        Every room: {house.total_items} items in {ok.length} rooms
      </div>
      <table className="w-full text-xs tabular-nums">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-1 text-left">Room</th>
            <th className="text-right">RT60 now</th>
            <th className="text-right">With plan</th>
            <th className="text-right">Target</th>
            <th className="text-right">Items</th>
            <th className="text-right">Furniture in the way</th>
            <th className="text-right">Inspected</th>
          </tr>
        </thead>
        <tbody>
          {ok.map((r) => (
            <tr key={r.room_id} className={`border-t border-zinc-800 ${r.room_id === current ? 'text-amber-200' : ''}`}>
              <td className="py-1">
                {r.label}
                {r.area_m2 ? <span className="text-zinc-500"> · {r.area_m2.toFixed(0)} m²</span> : null}
              </td>
              <td className="text-right">{r.mid_before_s?.toFixed(2)} s</td>
              <td className="text-right text-emerald-300">{r.mid_after_s?.toFixed(2)} s</td>
              <td className="text-right text-zinc-400">
                {r.target_mid ? `${r.target_mid[0].toFixed(2)}–${r.target_mid[1].toFixed(2)}` : '—'}
              </td>
              <td className="text-right">{r.item_count}</td>
              <td className="text-right">{r.blocked ? <span className="text-orange-300">{r.blocked}</span> : '—'}</td>
              <td className="text-right">{r.vision_status === 'ok' ? '✓' : <span className="text-zinc-500">assumed</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {skipped.length > 0 && (
        <details className="mt-2 text-xs text-zinc-500">
          <summary className="cursor-pointer">{skipped.length} spaces not planned</summary>
          <ul className="mt-1 space-y-0.5">
            {skipped.map((r) => (
              <li key={r.room_id}>
                {r.label}: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Each room is planned on its own for this use. "Assumed" rooms have not been inspected by the vision agents yet
        (open that room's own plan to inspect it); they use typical materials and furniture plus the scan's geometry and
        furniture.
      </p>
    </div>
  )
}

const shortName = (id: string) =>
  ({ panel_50: 'thin panels', panel_50_square: 'half-size panels', panel_100: 'thick panels', bass_trap: 'bass traps', cloud_100: 'cloud', diffuser_qrd: 'diffusers' })[id] ?? id

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 p-3">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="truncate text-xs text-zinc-500" title={sub}>
        {sub}
      </div>
    </div>
  )
}

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
