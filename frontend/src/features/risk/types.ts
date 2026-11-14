// Mirrors backend/noise/risk.py and noise/router.py (NoiseRiskResponse).
export interface RankedSource {
  id: string
  name: string | null
  category: string
  subtype: string
  distance_m: number
  bearing_compass: string
  lat: number
  lon: number
  osm_url: string
  intensity: number
  proximity: number
  risk: number
  level: 'low' | 'moderate' | 'high'
  when: string
  why: string
}

export interface NoiseRisk {
  sid: string
  status: string
  lat: number
  lon: number
  location_provenance: string
  ranked: RankedSource[]
  heat: { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: { type: 'Point'; coordinates: number[] }; properties: { weight: number; category: string; id: string } }[] }
  notes: string[]
}
