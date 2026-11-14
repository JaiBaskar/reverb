// Mirrors backend/properties/models.py. See contract/.
export type Provenance = 'verified' | 'estimated' | 'assumed' | 'user' | 'missing'

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
  /** Decay measured from the MODELED impulse response, not from the real room. */
  ir_rt60_s: (number | null)[]
  params: Record<string, unknown>
  notes: string[]
}

export type Surface = 'floor' | 'walls' | 'ceiling'
export type MaterialSelection = Partial<Record<Surface, string>>

export interface MaterialCatalog {
  materials: Record<string, { label: string; alpha: number[] }>
  defaults: Record<Surface, string>
}

// Mirrors backend/acoustics/explain.py (Comparison).
export interface Comparison {
  mid_rt60_s: number[]
  livelier: 'A' | 'B' | null
  rt60_ratio: number
  volume_factor: number
  absorption_factor: number
  material_differences: { surface: string; a: string; b: string }[]
  schroeder_hz: number[]
  lowest_mode_hz: (number | null)[]
  first_reflection_ms: number[]
  bass_ratio: number[]
  statements: string[]
}

// Mirrors backend/catalog/models.py.
export interface CatalogEntry {
  key: string
  kind: 'commercial' | 'residential'
  costar_id: number
  sid: string
  model_ids: string[]
  address: string
  city: string | null
  state: string | null
  postcode: string | null
  lat: number | null
  lon: number | null
  coords_provenance: 'verified' | 'missing'
  type_label: string | null
  name: string | null
  demo_pick: boolean
}

export interface CatalogPoints {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { sid: string; kind: string; label: string; type: string; demo: boolean }
  }[]
}
