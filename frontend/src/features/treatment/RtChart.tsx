import type { Prediction } from './types'

/** RT60 per octave band: before, after, and the target band. */
export function RtChart({ p }: { p: Prediction }) {
  const W = 520
  const H = 200
  const pad = { l: 40, r: 12, t: 12, b: 26 }
  const max = Math.max(0.2, ...p.before_rt60_s, ...p.after_rt60_s, ...p.target_high_s) * 1.1
  const n = p.bands_hz.length
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (n - 1)
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const line = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  const band =
    p.target_high_s.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ') +
    [...p.target_low_s]
      .map((v, i) => [v, i] as const)
      .reverse()
      .map(([v, i]) => `L${x(i)},${y(v)}`)
      .join(' ') +
    'Z'
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 10) / 10)
  return (
    <figure className="w-full" data-testid="rt-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Reverberation time by frequency before and after treatment">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#27272a" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#71717a">
              {t.toFixed(1)}s
            </text>
          </g>
        ))}
        <path d={band} fill="#10b98122" stroke="none" />
        <path d={line(p.before_rt60_s)} fill="none" stroke="#fb7185" strokeWidth="2.5" />
        <path d={line(p.after_rt60_s)} fill="none" stroke="#34d399" strokeWidth="2.5" />
        {p.bands_hz.map((f, i) => (
          <text key={f} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#a1a1aa">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-xs text-zinc-400">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-rose-400 align-middle" />Now</span>
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-emerald-400 align-middle" />With the plan</span>
        <span><span className="mr-1 inline-block h-2 w-4 bg-emerald-500/20 align-middle" />Target</span>
        <span>Hz · RT60 (Sabine, modeled)</span>
      </figcaption>
    </figure>
  )
}
