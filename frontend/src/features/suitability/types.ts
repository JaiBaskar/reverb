// Mirrors backend/suitability/models.py (SuitabilityReport). See contract/fixtures.
export type FitLevel = 'good' | 'workable' | 'poor'

export interface Check {
  id: string
  label: string
  status: 'pass' | 'caution' | 'fail'
  reason: string
  treatable: boolean
}

export interface Fit {
  use_case: string
  label: string
  level: FitLevel
  shape_level: FitLevel | null
  checks: Check[]
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
