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
    wall_source?: 'box' | 'outline'
  }
  surfaces: { floor_m2: number; ceiling_m2: number; walls_m2: number }
  materials: { surface: string; id: string; label: string; alpha: number[]; provenance: string }[]
  furniture: FurnitureItem[]
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
/** One furniture entry; mirrors backend/acoustics/furniture.py (FurnitureItem). */
export interface FurnitureItem {
  id: string
  count: number
  provenance?: 'assumed' | 'observed' | 'user'
}
export type FurnitureCatalog = Record<string, { label: string; sabins: number[] }>

/**
 * A room's settings: surface materials, plus its furniture when the user edited it
 * (absent = the typical furnishing for the room type, marked assumed by the backend).
 * Kept in one object so every hook that keys on it re-runs when either changes.
 */
export type MaterialSelection = Partial<Record<Surface, string>> & {
  furniture?: FurnitureItem[]
  /** Install REVERB's treatment plan for this use (objective id) before modelling the room. */
  treatment?: string
  /** Walls the treatment plan must keep clear (indices from the plan). */
  treatment_avoid?: number[]
  /** Model the room with what the scan and the vision agents found (height, windows, doors, finishes). */
  room_model?: boolean
}

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

// Mirrors backend/properties/models.py (TourLayout). See contract/fixtures/tour_zvKHR9DHNjJ.json.
// Positions are Matterport model space (metres, z up); the Showcase SDK uses (x, z, -y).
export interface TourRoom {
  room_id: string
  label: string
  usable: boolean
  floor_index: number | null
  /** [[x, y], ...] wall centrelines; null when Matterport gives no closed outline. */
  polygon: number[][] | null
  polygon_provenance: Provenance
  sweep_ids: string[]
  entry_sweep_id: string | null
  entry_sweep_provenance: Provenance
  navigable: boolean
  issues: string[]
}

export interface TourSweep {
  id: string
  room_id: string | null
  floor_index: number | null
  position: number[]
}

export interface TourLayout {
  sid: string
  coordinate_note: string
  floors: { id: string; label: string | null; index: number }[]
  rooms: TourRoom[]
  sweeps: TourSweep[]
}
