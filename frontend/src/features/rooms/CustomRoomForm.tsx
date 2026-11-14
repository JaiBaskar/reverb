import { useState } from 'react'
import { LIMITS, type CustomRoomSpec } from '../../roomRef'

const FT = 0.3048

/** Enter a room by its dimensions when no usable Matterport geometry exists. */
export function CustomRoomForm({ onAdd, prominent }: { onAdd: (c: CustomRoomSpec) => void; prominent: boolean }) {
  const [open, setOpen] = useState(prominent)
  const [unit, setUnit] = useState<'m' | 'ft'>('ft')
  const [label, setLabel] = useState('Spare room')
  const [dims, setDims] = useState({ w: '', d: '', h: '' })
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const k = unit === 'ft' ? FT : 1
    const [w, d, h] = [dims.w, dims.d, dims.h].map((v) => Math.round(parseFloat(v) * k * 100) / 100)
    const [smin, smax] = LIMITS.side
    const [hmin, hmax] = LIMITS.height
    if ([w, d, h].some((v) => !Number.isFinite(v))) return setError('Enter width, depth and height.')
    if (w < smin || w > smax || d < smin || d > smax)
      return setError(`Width and depth must be ${smin}–${smax} m (${(smin / FT).toFixed(0)}–${(smax / FT).toFixed(0)} ft).`)
    if (h < hmin || h > hmax)
      return setError(`Ceiling height must be ${hmin}–${hmax} m (${(hmin / FT).toFixed(1)}–${(hmax / FT).toFixed(0)} ft).`)
    setError(null)
    onAdd({ label: label.trim() || 'Custom room', width_m: w, depth_m: d, height_m: h })
    setDims({ w: '', d: '', h: '' })
  }

  if (!open)
    return (
      <button className="mt-2 text-xs text-violet-300 underline decoration-dotted" onClick={() => setOpen(true)}>
        + Add a room by its dimensions (from a floor plan or tape measure)
      </button>
    )

  const field = (k: 'w' | 'd' | 'h', ph: string) => (
    <input
      inputMode="decimal"
      value={dims[k]}
      onChange={(e) => setDims({ ...dims, [k]: e.target.value })}
      placeholder={ph}
      aria-label={ph}
      className="w-20 rounded bg-zinc-900 px-1.5 py-1"
    />
  )

  return (
    <div className="mt-2 rounded border border-violet-500/30 p-2 text-xs" data-testid="custom-room-form">
      <div className="mb-1.5 text-zinc-300">
        Add a room by its dimensions <span className="text-violet-300">(user-provided)</span>
        <span className="text-zinc-500"> · modeled as a rectangular box; useful when there is no usable scan</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="Room name"
          className="w-28 rounded bg-zinc-900 px-1.5 py-1"
        />
        {field('w', 'Width')}×{field('d', 'Depth')}×{field('h', 'Height')}
        <select value={unit} onChange={(e) => setUnit(e.target.value as 'm' | 'ft')} className="rounded bg-zinc-900 px-1 py-1">
          <option value="ft">ft</option>
          <option value="m">m</option>
        </select>
        <button onClick={submit} className="rounded bg-violet-500 px-2 py-1 font-semibold text-black">
          Add room
        </button>
      </div>
      {error && <div className="mt-1 text-red-300">{error}</div>}
    </div>
  )
}
