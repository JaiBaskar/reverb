// Mirrors backend/noise_scout/models.py (NoiseScoutResult).
export interface ScoutEvidence {
  id: string
  name: string | null
  kind: string
  subtype: string | null
  distance_m: number | null
  bearing_compass: string | null
  osm_url: string
  tags: Record<string, string>
  source_tool: string
  distance_note: string | null
}

export interface ScoutFinding {
  title: string
  detail: string
  category: string
  significance: 'low' | 'moderate' | 'high'
  evidence: ScoutEvidence[]
  warnings: string[]
}

export interface NoiseScoutResult {
  sid: string
  status: 'ok' | 'not_run' | 'unavailable' | 'error'
  generated_at: string
  model: string | null
  subagent_model: string | null
  summary: string | null
  findings: ScoutFinding[]
  recording_advice: string[]
  data_gaps: string[]
  rejected: { title: string; reason: string }[]
  subagents_used: string[]
  tool_calls: number
  files: Record<string, string>
  trace: { project: string | null; run_id: string | null; url: string | null }
  notes: string[]
}
