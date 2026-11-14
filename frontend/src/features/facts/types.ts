// Mirrors backend/costar/models.py (PropertyFacts). See contract/fixtures.
import type { Provenance } from '../../types'

export interface Fact {
  key: string
  label: string
  value: string | number | boolean | null
  unit: string | null
  provenance: Provenance
  source: string | null
  note: string | null
}

export interface MaterialHint {
  surface: 'floor' | 'walls' | 'ceiling'
  material_id: string
  reason: string
  provenance: Provenance
}

export interface PropertyFacts {
  sid: string
  status: 'ok' | 'unavailable'
  kind: 'residential' | 'commercial' | null
  costar_id: number | null
  facts: Fact[]
  material_hints: MaterialHint[]
  notes: string[]
  data_source: string
}
