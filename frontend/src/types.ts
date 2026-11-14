// Mirrors backend/properties/models.py. See contract/.
export type Provenance = 'verified' | 'estimated' | 'assumed' | 'missing'

export interface Field {
  value: number | null
  provenance: Provenance
  note?: string | null
}

export interface Room {
  id: string
  label: string
  label_confidence: number | null
  area_m2: Field
  width_m: Field
  depth_m: Field
  height_m: Field
  usable: boolean
  issues: string[]
}

export interface Property {
  sid: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  lat: number | null
  lon: number | null
  usable_room_count: number
  room_count: number
}
