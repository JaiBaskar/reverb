import type { TourLayout } from '../../types'
import { centroid, layoutBounds, polygonArea } from '../matterport/geometry'
import type { Classification } from './classify'

interface Props {
  layout: TourLayout
  classes: Record<string, Classification>
  selectedId: string | null
  currentId: string | null
  sweepId: string | null
  onSelect: (roomId: string) => void
}

const PAD = 0.6

/**
 * Top-down plan from Matterport's own room outlines (model space, y flipped for SVG).
 * Always aligned because it uses the same polygons as the 3D tint; also the fallback view when
 * the Bundle SDK overlay is not available.
 */
export function FloorPlan({ layout, classes, selectedId, currentId, sweepId, onSelect }: Props) {
  const rooms = layout.rooms.filter((r) => r.polygon)
  const b = layoutBounds(rooms)
  if (!b) return <div className="p-3 text-xs text-zinc-500">Matterport gave no room outlines for this model.</div>
  const w = b.maxX - b.minX + 2 * PAD
  const h = b.maxY - b.minY + 2 * PAD
  const sx = (x: number) => x - b.minX + PAD
  const sy = (y: number) => b.maxY - y + PAD
  const sweep = sweepId ? layout.sweeps.find((s) => s.id === sweepId) : undefined

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label="Floor plan coloured by acoustics" data-testid="floor-plan">
      {rooms.map((r) => {
        const pts = r.polygon!.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')
        const c = classes[r.room_id]
        const sel = r.room_id === selectedId
        const [cx, cy] = centroid(r.polygon!)
        const small = polygonArea(r.polygon!) < 6 // label would not fit; the tooltip still names it
        return (
          <g key={r.room_id} onClick={() => onSelect(r.room_id)} className="cursor-pointer" data-room={r.room_id}>
            <title>{`${r.label}: ${c?.label ?? ''}${c?.value ? ` (${c.value})` : ''}`}</title>
            <polygon
              points={pts}
              fill={c?.color ?? '#6b7280'}
              fillOpacity={sel ? 0.85 : 0.5}
              stroke={sel ? '#f4f4f5' : '#18181b'}
              strokeWidth={sel ? 0.09 : 0.05}
              strokeLinejoin="round"
            />
            {!small && (
              <text x={sx(cx)} y={sy(cy)} textAnchor="middle" fontSize={0.32} fill="#f4f4f5" style={{ pointerEvents: 'none' }}>
                {r.label}
                {c?.value && (
                  <tspan x={sx(cx)} dy={0.38} fontSize={0.26} fill="#d4d4d8">
                    {c.value}
                  </tspan>
                )}
              </text>
            )}
            {r.room_id === currentId && (
              <circle cx={sx(cx)} cy={sy(cy) - 0.55} r={0.12} fill="#f4f4f5" stroke="#18181b" strokeWidth={0.03} />
            )}
          </g>
        )
      })}
      {sweep && (
        <circle cx={sx(sweep.position[0])} cy={sy(sweep.position[1])} r={0.2} fill="none" stroke="#fafafa" strokeWidth={0.07}>
          <title>You are here (current tour position)</title>
        </circle>
      )}
    </svg>
  )
}
