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

// Mirrors backend/acoustics/report.py (AcousticReport). See contract/fixtures.
export interface AcousticReport {
  sid: string
  room_id: string
  label: string
  bands_hz: number[]
  geometry: {
    width_m: Field
    depth_m: Field
    height_m: Field
    area_m2: Field
    equivalent_width_m: number
    equivalent_depth_m: number
    volume_m3: number
    note: string | null
  }
  surfaces: { floor_m2: number; ceiling_m2: number; walls_m2: number }
  materials: { surface: string; id: string; label: string; alpha: number[]; provenance: string }[]
  absorption_sabins: number[]
  rt60_s: number[]
  schroeder_hz: number
  modes: { axis: string; order: number; freq_hz: number }[]
  source_position_m: number[]
  listener_position_m: number[]
  early_reflections: { surface: string; path_m: number; delay_ms: number }[]
  assumptions: string[]
  warnings: string[]
  method: string
}

// Mirrors backend/ir/service.py (IrResponse).
export interface IrResponse {
  sid: string
  room_id: string
  label: string
  sample_rate: number
  duration_s: number
  wav_base64: string
  bands_hz: number[]
  sabine_rt60_s: number[]
  measured_rt60_s: (number | null)[]
  params: Record<string, unknown>
  notes: string[]
}
