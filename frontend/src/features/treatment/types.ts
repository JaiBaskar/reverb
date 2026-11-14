// Mirrors backend/treatment/service.py (TreatmentPlan) and roomintel models. Model space:
// metres, z up (convert to the Showcase SDK with sdk (x, y, z) = model (x, z, -y)).
import type { FurnitureItem } from '../../types'

export type V3 = [number, number, number]

export interface Objective {
  id: string
  label: string
  layout: 'monitoring' | 'mic'
  needs_rfz: boolean
  rfz_db: number
  allow_diffusion: boolean
  basis: string
}

export interface PlacedItem {
  key: string
  product_id: string
  group: 'first_reflection' | 'ceiling' | 'front_wall' | 'rear_wall' | 'corner' | 'coverage'
  center: V3
  normal: V3
  up: V3
  width_m: number
  height_m: number
  depth_m: number
  wall: number | null
  where: string
  reason: string
  /** moved / replaced to clear the building; blocked = furniture or wall objects in the way */
  status: 'ok' | 'moved' | 'replaced' | 'blocked'
  adjustment: string | null
  blocked_by: Blocker[]
}

export interface Blocker {
  id: string
  label: string
  kind: 'furniture' | 'wall_object' | 'fixture'
  min: V3
  max: V3
}

export interface Layout {
  kind: 'monitoring' | 'mic'
  listener: V3
  sources: V3[]
  source_names: string[]
  facing: [number, number]
  front_wall: number | null
  note: string
}

export interface Viewpoint {
  scan_id: string
  position: V3
  yaw_deg: number
  pitch_deg: number
  hfov_deg: number
  items_in_view: string[]
  floor_in_view: number
  corner_distance_m: number
  reason: string
}

export interface Problem {
  id: string
  title: string
  detail: string
  severity: 'high' | 'medium' | 'low'
  addressed_by: string[]
  after: string
}

export interface ReflectionResult {
  source: string
  surface: string
  delay_ms: number
  before_db: number
  after_db: number
  treated_by: string | null
}

export interface Prediction {
  bands_hz: number[]
  before_rt60_s: number[]
  after_rt60_s: number[]
  target_low_s: number[]
  target_high_s: number[]
  mid_before_s: number
  mid_after_s: number
  bass_ratio_before: number
  bass_ratio_after: number
  schroeder_before_hz: number
  schroeder_after_hz: number
  reflections: ReflectionResult[]
}

export interface ItemGroup {
  group: string
  product_id: string
  product: string
  count: number
  why: string
}

export interface Alternative {
  summary: string
  items: number
  mid_rt60_s: number
  score: number
  chosen: boolean
}

export interface AgentRunSummary {
  agent: 'walls' | 'furniture' | 'surroundings' | string
  status: 'ok' | 'unavailable' | 'error'
  model: string | null
  seconds: number | null
  reason: string | null
}

export interface WallFinding {
  wall: number
  name: string
  material_id: string | null
  finish: string | null
  confidence: number | null
  features: { kind: string; category: 'building' | 'movable' | 'other'; along: [number, number]; z: [number, number]; covering: string; confidence: number }[]
}

export interface PieceFinding {
  kind: string
  covering: string
  label: string
  count: number
  furniture_id: string | null
  position: [number, number] | null
  width_m: number | null
  height_m: number | null
  confidence: number
}

export interface FurnitureObject {
  id: string
  min: V3
  max: V3
  points: number
  mounting: 'floor' | 'wall' | 'ceiling'
  label: string
  named_by: 'furniture_agent' | 'geometry'
}

export interface MaterialAssignment {
  surface: 'floor' | 'walls' | 'ceiling'
  material_id: string
  label: string
  alpha: number[]
  provenance: 'observed' | 'assumed' | 'user'
  confidence: number | null
  basis: string
}

export interface RoomSummary {
  polygon: [number, number][]
  floor_z: number
  height_m: number
  height_provenance: string
  area_m2: number
  volume_m3: number
  geometry_source: 'mesh+outline' | 'outline' | 'box'
  walls: { index: number; name: string; length_m: number; coverage: number | null; openings: [number, number][] }[]
  materials: MaterialAssignment[]
  furniture: FurnitureItem[]
  furniture_basis: string
  vision_status: 'ok' | 'partial' | 'unavailable' | 'error'
  vision_reason: string | null
  agents: AgentRunSummary[]
  wall_findings: WallFinding[]
  pieces: PieceFinding[]
  hazards: { kind: string; note: string; wall: number | null; wall_name: string | null; confidence: number }[]
  furniture_objects: FurnitureObject[]
  absorption_notes: string[]
}

export interface TreatmentPlan {
  sid: string
  room_id: string
  label: string
  objective: Objective
  scenario: 'as_scanned' | 'empty'
  layout: Layout | null
  items: PlacedItem[]
  groups: ItemGroup[]
  problems: Problem[]
  prediction: Prediction
  alternatives: Alternative[]
  viewpoint: Viewpoint | null
  room: RoomSummary
  notes: string[]
  assumptions: string[]
  limitations: string[]
}
