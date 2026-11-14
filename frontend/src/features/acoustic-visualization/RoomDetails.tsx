import type { Field, Provenance, TourRoom } from '../../types'
import type { Classification, RoomData, VizMode } from './classify'
import { midRt60 } from './classify'

interface Props {
  room: TourRoom
  data?: RoomData
  cls: Classification
  mode: VizMode
  useCaseLabel: string
}

const PROV: Record<Provenance, string> = {
  verified: 'bg-emerald-900/60 text-emerald-200',
  estimated: 'bg-sky-900/60 text-sky-200',
  assumed: 'bg-amber-900/60 text-amber-200',
  missing: 'bg-zinc-800 text-zinc-400',
}

export function Badge({ p, title }: { p: Provenance; title?: string | null }) {
  return (
    <span className={`rounded px-1 py-px text-[10px] uppercase tracking-wide ${PROV[p]}`} title={title ?? undefined}>
      {p}
    </span>
  )
}

const dim = (label: string, f: Field, unit: string) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-zinc-400">{label}</span>
    <span className="flex items-center gap-1.5 tabular-nums">
      {f.value == null ? '—' : `${f.value.toFixed(2)} ${unit}`}
      <Badge p={f.provenance} title={f.note} />
    </span>
  </div>
)

const STATUS = { pass: 'text-emerald-300', caution: 'text-amber-300', fail: 'text-red-300' }
const STATUS_ICON = { pass: '✓', caution: '!', fail: '✕' }

export function RoomDetails({ room, data, cls, mode, useCaseLabel }: Props) {
  const r = data?.report
  const fit = data?.suitability?.fits
  return (
    <div className="space-y-4 text-xs" data-testid="room-details">
      <div className="rounded-lg p-3 ring-1 ring-zinc-800" style={{ background: `${cls.color}22` }}>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ background: cls.color }} />
          <span className="text-sm font-semibold">{cls.label}</span>
          {cls.value && <span className="tabular-nums text-zinc-300">{cls.value}</span>}
          <span className="ml-auto text-zinc-400">
            {mode === 'fit' ? useCaseLabel : mode === 'rt60' ? 'Reverberation' : 'Bass / modes'}
          </span>
        </div>
        {cls.why.length > 0 && (
          <ul className="mt-2 space-y-1 text-zinc-300">
            {cls.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      {!room.usable && (
        <p className="text-zinc-400">
          Not modeled: {room.issues.length ? room.issues.join('; ') : 'Matterport geometry is incomplete'}.
        </p>
      )}
      {data?.error && <p className="text-red-300">{data.error}</p>}
      {room.usable && !r && !data?.error && <p className="text-zinc-500">Calculating the acoustic report…</p>}

      {r && (
        <>
          <section className="space-y-1">
            <h4 className="font-semibold text-zinc-300">Geometry</h4>
            {dim('Floor area', r.geometry.area_m2, 'm²')}
            {dim('Width', r.geometry.width_m, 'm')}
            {dim('Depth', r.geometry.depth_m, 'm')}
            {dim('Height', r.geometry.height_m, 'm')}
            <div className="flex justify-between">
              <span className="text-zinc-400">Volume</span>
              <span className="flex items-center gap-1.5 tabular-nums">
                {r.geometry.volume_m3.toFixed(1)} m³ <Badge p="estimated" title="floor area × height" />
              </span>
            </div>
            {r.geometry.note && <p className="text-zinc-500">{r.geometry.note}</p>}
          </section>

          <section>
            <h4 className="mb-1 font-semibold text-zinc-300">
              RT60 by band <span className="font-normal text-zinc-500">(Sabine, mid {midRt60(r).toFixed(2)} s)</span>
            </h4>
            <div className="space-y-0.5">
              {r.bands_hz.map((hz, i) => {
                const max = Math.max(...r.rt60_s, 0.1)
                return (
                  <div key={hz} className="flex items-center gap-2">
                    <span className="w-12 text-right tabular-nums text-zinc-400">{hz >= 1000 ? `${hz / 1000}k` : hz} Hz</span>
                    <div className="h-2 flex-1 rounded bg-zinc-800">
                      <div className="h-2 rounded bg-sky-400/80" style={{ width: `${(100 * r.rt60_s[i]) / max}%` }} />
                    </div>
                    <span className="w-12 tabular-nums">{r.rt60_s[i].toFixed(2)} s</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="font-semibold text-zinc-300">Schroeder</h4>
              <div className="tabular-nums">{r.schroeder_hz.toFixed(0)} Hz</div>
            </div>
            <div>
              <h4 className="font-semibold text-zinc-300">Lowest axial modes</h4>
              <div className="tabular-nums text-zinc-300">
                {[...r.modes]
                  .sort((a, b) => a.freq_hz - b.freq_hz)
                  .slice(0, 6)
                  .map((m) => `${m.freq_hz.toFixed(0)}`)
                  .join(', ')}{' '}
                Hz
              </div>
            </div>
          </section>

          <section>
            <h4 className="font-semibold text-zinc-300">First reflections after the direct sound</h4>
            <div className="mt-1 grid grid-cols-3 gap-x-3 gap-y-0.5 tabular-nums text-zinc-300">
              {[...r.early_reflections]
                .sort((a, b) => a.delay_ms - b.delay_ms)
                .map((x) => (
                  <span key={x.surface}>
                    <span className="text-zinc-500">{x.surface}</span> {x.delay_ms.toFixed(1)} ms
                  </span>
                ))}
            </div>
          </section>

          <section>
            <h4 className="font-semibold text-zinc-300">Materials</h4>
            {r.materials.map((m) => (
              <div key={m.surface} className="flex justify-between">
                <span className="text-zinc-400">{m.surface}</span>
                <span className="flex items-center gap-1.5">
                  {m.label} <Badge p="assumed" />
                </span>
              </div>
            ))}
          </section>

          {fit && (
            <details className="rounded-lg ring-1 ring-zinc-800">
              <summary className="cursor-pointer px-3 py-2 font-semibold text-zinc-300">All use cases</summary>
              <div className="space-y-1 px-3 pb-3">
                {fit.map((f) => (
                  <details key={f.use_case}>
                    <summary className="cursor-pointer">
                      {f.label}: <b>{f.level}</b>
                      {f.shape_level && <span className="text-zinc-500"> · shape {f.shape_level}</span>}
                    </summary>
                    <ul className="ml-3 mt-1 space-y-0.5">
                      {f.checks.map((c) => (
                        <li key={c.id} className={STATUS[c.status]}>
                          {STATUS_ICON[c.status]} {c.label}: <span className="text-zinc-300">{c.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </details>
          )}

          <details className="rounded-lg ring-1 ring-zinc-800">
            <summary className="cursor-pointer px-3 py-2 font-semibold text-zinc-300">Assumptions and limits</summary>
            <ul className="list-disc space-y-1 px-6 pb-3 text-zinc-400">
              {[...r.assumptions, ...r.warnings].map((a) => (
                <li key={a}>{a}</li>
              ))}
              <li>{r.method}</li>
            </ul>
          </details>
        </>
      )}

      <section className="space-y-0.5 text-zinc-500">
        <div className="flex items-center gap-1.5">
          Outline <Badge p={room.polygon_provenance} /> · tour sweeps {room.sweep_ids.length}
          {room.entry_sweep_id && (
            <>
              {' '}
              · entry point <Badge p={room.entry_sweep_provenance} title="the room's sweep nearest its outline centre" />
            </>
          )}
        </div>
        {room.issues.map((i) => (
          <div key={i}>{i}</div>
        ))}
      </section>
    </div>
  )
}
