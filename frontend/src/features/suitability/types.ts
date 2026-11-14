// Mirrors backend/suitability/models.py (SuitabilityReport). See contract/fixtures.
export type FitLevel = 'good' | 'workable' | 'poor'

export interface Check {
  id: string
  label: string
  status: 'pass' | 'caution' | 'fail'
  reason: string
  treatable: boolean
}

export interface Treatment {
  verdict: 'none_needed' | 'add_absorption' | 'too_dead' | 'impractical'
  target_s: [number | null, number | null]
  current_mid_s: number
  added_sabins: number
  panel_area_m2: number
  panels: number
  coverage: number
  reason: string
  assumptions: string[]
}

export interface Fit {
  use_case: string
  label: string
  level: FitLevel
  shape_level: FitLevel | null
  checks: Check[]
  treatment: Treatment | null
  potential_level: FitLevel
}

export interface UseCaseVerdict {
  use_case: string
  label: string
  better: 'A' | 'B' | null
  reason: string
}

export interface SuitabilityReport {
  sid: string
  room_id: string
  label: string
  fits: Fit[]
  assumptions: string[]
  missing: string[]
  method: string
}
