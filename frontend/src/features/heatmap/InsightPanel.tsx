import { FurnitureEditor } from '../furniture/FurnitureEditor'
import { METRICS, rampCss } from './field'
import type { FieldMetric, RoomInsight } from './types'

const SEVERITY: Record<string, string> = {
  important: 'border-rose-400/60',
  consider: 'border-amber-400/60',
  info: 'border-zinc-600',
}

export function MetricPicker({ metric, onChange }: { metric: FieldMetric; onChange: (m: FieldMetric) => void }) {
  return (
    <div className="flex rounded-lg bg-zinc-900 p-0.5 text-xs ring-1 ring-zinc-800" role="radiogroup" aria-label="Heatmap layer">
      {(Object.keys(METRICS) as FieldMetric[]).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={metric === m}
          onClick={() => onChange(m)}
          className={`rounded-md px-2.5 py-1 font-medium ${metric === m ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:bg-zinc-800'}`}
        >
          {METRICS[m].short}
        </button>
      ))}
    </div>
  )
}

export function FieldLegend({ metric, range }: { metric: FieldMetric; range: [number, number] }) {
  const m = METRICS[metric]
  const [bad, good] = m.good === 'high' ? range : [range[1], range[0]]
  return (
    <div className="text-xs" data-testid="field-legend">
      <div className="mb-1 flex items-center justify-between text-zinc-400">
        <span>
          {m.label} · {m.unit}
        </span>
        <span>modeled, not measured</span>
      </div>
      <div
        className="h-2.5 rounded-full"
        style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(rampCss).join(',')})` }}
      />
      <div className="mt-0.5 flex justify-between tabular-nums text-zinc-400">
        <span>worse · {bad.toFixed(1)}</span>
        <span>{good.toFixed(1)} · better</span>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">{m.explain} ★ best spot · ● sound source.</p>
    </div>
  )
}

interface Props {
  room: RoomInsight
  pending: boolean
  furnitureEdited: boolean
  sourceMoved: boolean
  placing: boolean
  onFurniture: (items: RoomInsight['report']['furniture'] | undefined) => void
  onPlacing: (on: boolean) => void
  onResetSource: () => void
}

/** Why the selected room looks the way it does, what to do about it, and its furniture. */
export function InsightPanel({ room, pending, furnitureEdited, sourceMoved, placing, onFurniture, onPlacing, onResetSource }: Props) {
  const r = room.report
  const mid = (r.rt60_s[2] + r.rt60_s[3]) / 2
  return (
    <div className="space-y-3" data-testid="insight-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{room.label}</h3>
        <span className="text-xs tabular-nums text-zinc-400">
          RT60 {mid.toFixed(2)} s · {r.geometry.volume_m3.toFixed(0)} m³{pending ? ' · updating…' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button
          onClick={() => onPlacing(!placing)}
          className={`rounded-md px-2.5 py-1 ${placing ? 'bg-amber-400 font-semibold text-black' : 'bg-zinc-800 hover:bg-zinc-700'}`}
          data-testid="place-source"
        >
          {placing ? 'Click in the plan to place the source' : 'Move the sound source'}
        </button>
        {sourceMoved && (
          <button className="rounded-md bg-zinc-800 px-2.5 py-1 hover:bg-zinc-700" onClick={onResetSource}>
            Reset source
          </button>
        )}
      </div>
      <ul className="space-y-2" data-testid="advice">
        {room.advice.map((a) => (
          <li key={a.title} className={`border-l-2 pl-2 text-xs ${SEVERITY[a.severity]}`}>
            <div className="font-medium text-zinc-200">{a.title}</div>
            <div className="text-zinc-400">{a.detail}</div>
          </li>
        ))}
      </ul>
      <FurnitureEditor current={r.furniture} edited={furnitureEdited} onChange={onFurniture} />
      <details className="text-[11px] text-zinc-500">
        <summary className="cursor-pointer">How the maps are calculated</summary>
        <ul className="ml-4 mt-1 list-disc space-y-0.5">
          {room.field.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          {r.geometry.note && <li>{r.geometry.note}</li>}
        </ul>
      </details>
    </div>
  )
}
