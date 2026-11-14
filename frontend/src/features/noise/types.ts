// Mirrors backend/noise/models.py (NoiseReport). See contract/fixtures.
import type { Provenance } from '../../types'

export type ExposureLevel = 'none' | 'low' | 'moderate' | 'high'

export interface NoiseSource {
  id: string
  category: string
  subtype: string
  name: string | null
  lat: number
  lon: number
  distance_m: number
  bearing_deg: number
  bearing_compass: string
  osm_url: string
  osm_ids: string[]
  provenance: Provenance
  /** GeoJSON geometry ([lon, lat]); null in caches written before schema 2. */
  geometry?: { type: string; coordinates: unknown } | null
}

export interface CategoryExposure {
  category: string
  label: string
  radius_m: number
  count: number
  nearest_m: number | null
  level: ExposureLevel
  reason: string
}

export interface NoiseReport {
  sid: string | null
  lat: number
  lon: number
  location_provenance: Provenance
  radius_m: number
  generated_at: string
  sources: NoiseSource[]
  exposure: CategoryExposure[]
  notes: string[]
  data_source: string
  status: 'ok' | 'error'
  schema_version?: number
  categories_queried?: string[]
}
