import { useRef } from 'react'
import { layoutBounds } from '../matterport/geometry'
import type { TourLayout } from '../../types'
import { normalise, rampCss } from './field'
import type { FieldMetric, RoomInsight } from './types'

interface Props {
  layout: TourLayout
  rooms: Record<string, RoomInsight>
  metric: FieldMetric
  range: [number, number]
  selectedId: string | null
  placing: boolean
  onSelect: (roomId: string) => void
  onPlaceSource: (roomId: string, xy: [number, number]) => void
}

const PAD = 0.6

/** Top-down heatmap of every room: blurred cells clipped to each room's outline. */
export function FieldPlan({ layout, rooms, metric, range, selectedId, placing, onSelect, onPlaceSource }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const outlined = layout.rooms.filter((r) => r.polygon)
  const b = layoutBounds(outlined)
  if (!b) return null
  const w = b.maxX - b.minX + 2 * PAD
  const h = b.maxY - b.minY + 2 * PAD
  const sx = (x: number) => x - b.minX + PAD
  const sy = (y: number) => b.maxY - y + PAD

  const toModel = (e: React.MouseEvent): [number, number] | null => {
    const el = svg.current
    const ctm = el?.getScreenCTM()
    if (!el || !ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    return [p.x + b.minX - PAD, b.maxY + PAD - p.y]
  }

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${w} ${h}`}
      className={`h-full w-full ${placing ? 'cursor-crosshair' : ''}`}
      role="img"
      aria-label="Acoustic heatmap floor plan"
      data-testid="field-plan"
    >
      <defs>
        <filter id="field-blur" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="0.14" />
        </filter>
        {outlined.map((r) => (
          <clipPath key={r.room_id} id={`clip-${r.room_id}`}>
            <polygon points={r.polygon!.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} />
          </clipPath>
        ))}
      </defs>
      {outlined.map((r) => {
        const ins = rooms[r.room_id]
        const pts = r.polygon!.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')
        const sel = r.room_id === selectedId
        return (
          <g
            key={r.room_id}
            onClick={(e) => {
              if (placing && ins) {
                const p = toModel(e)
                if (p) onPlaceSource(r.room_id, p)
              } else onSelect(r.room_id)
            }}
            className="cursor-pointer"
          >
            <title>{ins ? `${r.label}` : `${r.label}: not modeled`}</title>
            <polygon points={pts} fill="#ececee" />
            {ins && (
              <g clipPath={`url(#clip-${r.room_id})`}>
                <g filter="url(#field-blur)">
                  {ins.field[metric].map((v, k) => {
                    if (v == null) return null
                    const f = ins.field
                    const x = f.origin[0] + (k % f.nx) * f.step
                    const y = f.origin[1] + Math.floor(k / f.nx) * f.step
                    return (
                      <rect
                        key={k}
                        x={sx(x) - f.step / 2 - 0.02}
                        y={sy(y) - f.step / 2 - 0.02}
                        width={f.step + 0.04}
                        height={f.step + 0.04}
                        fill={rampCss(normalise(metric, v, range))}
                      />
                    )
                  })}
                </g>
              </g>
            )}
            <polygon
              points={pts}
              fill="none"
              stroke={sel ? '#111114' : '#ffffff'}
              strokeWidth={sel ? 0.1 : 0.06}
              strokeLinejoin="round"
            />
            {ins && (
              <>
                <circle cx={sx(ins.field.source[0])} cy={sy(ins.field.source[1])} r={0.16} fill="#fafafa" stroke="#09090b" strokeWidth={0.04}>
                  <title>Sound source (click "Move the source" to change)</title>
                </circle>
                <path
                  d={star(sx(ins.field.best_spot[0]), sy(ins.field.best_spot[1]), 0.28)}
                  fill="#fafafa"
                  stroke="#09090b"
                  strokeWidth={0.04}
                >
                  <title>Best spot for the mic or listening seat</title>
                </path>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function star(cx: number, cy: number, r: number) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    return `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`
  })
  return `M${pts.join('L')}Z`
}
