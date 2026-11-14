import type { AcousticReport, FurnitureItem } from '../../types'

// Mirrors backend/acoustics/field.py (RoomField), advice.py and router.py (RoomInsight).
export interface RoomField {
  origin: [number, number]
  step: number
  nx: number
  ny: number
  c50_db: (number | null)[]
  reflection_db: (number | null)[]
  bass_spread_db: (number | null)[]
  source: [number, number]
  source_height_m: number
  listener_height_m: number
  best_spot: [number, number]
  ranges: Record<FieldMetric, [number, number]>
  notes: string[]
}

export type FieldMetric = 'c50_db' | 'bass_spread_db' | 'reflection_db'

export interface Advice {
  kind: string
  severity: 'info' | 'consider' | 'important'
  title: string
  detail: string
}

export interface RoomInsight {
  room_id: string
  label: string
  polygon: number[][]
  report: AcousticReport
  field: RoomField
  advice: Advice[]
  default_furniture: FurnitureItem[]
}

export interface HouseInsights {
  sid: string
  rooms: RoomInsight[]
  skipped: { room_id: string; label: string; reason: string }[]
}
