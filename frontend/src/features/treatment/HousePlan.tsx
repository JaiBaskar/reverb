import type { TourRoom } from '../../types'
import type { Tone } from '../../ui/rating'
import { centroid, layoutBounds, polygonArea } from '../matterport/geometry'

const PAD = 0.5
const TONE_HEX: Record<Tone, string> = { good: '#16a34a', ok: '#d97706', bad: '#dc2626' }

export interface PlanRoomInfo {
  tone?: Tone
  /** Short text under the name, e.g. "0.71 s". */
  value?: string
  /** A music-room candidate (others are drawn grey but can still be picked). */
  candidate: boolean
}

interface Props {
  rooms: TourRoom[]
  info: Record<string, PlanRoomInfo>
  selectedId: string | null
  /** The room whose page this is (marked with a dot). */
  homeId?: string
  names: Record<string, string>
  onSelect: (roomId: string) => void
}

/** Top-down plan of one floor from Matterport's room outlines; click a room to pick it. */
export function HousePlan({ rooms, info, selectedId, homeId, names, onSelect }: Props) {
  const drawn = rooms.filter((r) => r.polygon && r.label.toLowerCase() !== 'void')
  const b = layoutBounds(drawn)
  if (!b) return <p className="p-4 text-sm text-mute">No room outlines for this floor.</p>
  const w = b.maxX - b.minX + 2 * PAD
  const h = b.maxY - b.minY + 2 * PAD
  const sx = (x: number) => x - b.minX + PAD
  const sy = (y: number) => b.maxY - y + PAD
  const font = Math.max(0.22, Math.min(0.42, Math.max(w, h) / 38))

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label="Floor plan: click a room" data-testid="house-plan">
      {drawn.map((r) => {
        const i = info[r.room_id]
        const sel = r.room_id === selectedId
        const pick = r.usable
        const fill = sel ? '#2563eb' : i?.candidate && i.tone ? TONE_HEX[i.tone] : '#d4d4d8'
        const [cx, cy] = centroid(r.polygon!)
        const area = polygonArea(r.polygon!)
        return (
          <g
            key={r.room_id}
            onClick={() => pick && onSelect(r.room_id)}
            className={pick ? 'cursor-pointer' : 'cursor-not-allowed'}
            data-room={r.room_id}
            data-testid={`plan-room-${r.room_id}`}
          >
            <title>{`${names[r.room_id] ?? r.label}${i?.value ? ` · ${i.value}` : ''}${pick ? '' : ' · not enough geometry to plan'}`}</title>
            <polygon
              points={r.polygon!.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}
              fill={fill}
              fillOpacity={sel ? 0.35 : i?.candidate ? 0.22 : 0.18}
              stroke={sel ? '#2563eb' : '#ffffff'}
              strokeWidth={sel ? font * 0.35 : font * 0.15}
              strokeLinejoin="round"
            />
            {area >= 5 && (
              <text x={sx(cx)} y={sy(cy)} textAnchor="middle" fontSize={font} fontWeight={sel ? 700 : 500} fill="#111114" style={{ pointerEvents: 'none' }}>
                {names[r.room_id] ?? r.label}
                {i?.value && (
                  <tspan x={sx(cx)} dy={font * 1.2} fontSize={font * 0.8} fill="#6b6b73" fontWeight={400}>
                    {i.value}
                  </tspan>
                )}
              </text>
            )}
            {r.room_id === homeId && <circle cx={sx(cx)} cy={sy(cy) - font * 1.4} r={font * 0.35} fill="#111114" />}
          </g>
        )
      })}
    </svg>
  )
}
