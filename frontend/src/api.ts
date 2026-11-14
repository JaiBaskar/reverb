import type {
  AcousticReport,
  CatalogEntry,
  CatalogPoints,
  Comparison,
  FurnitureCatalog,
  MaterialCatalog,
  MaterialSelection,
  Property,
  Room,
  TourLayout,
} from './types'
import { roomBody } from './roomRef'
import type { SuitabilityReport } from './features/suitability/types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchProperties = () => get<Property[]>('/properties')
export const fetchProperty = (sid: string) => get<Property>(`/properties/${sid}`)
export const fetchCatalogPoints = () => get<CatalogPoints>('/catalog/points')
export function searchCatalog(q: string, city: string, kind: string, limit = 50) {
  const p = new URLSearchParams({ q, limit: String(limit) })
  if (city) p.set('city', city)
  if (kind) p.set('kind', kind)
  return get<{ total: number; results: CatalogEntry[] }>(`/catalog/search?${p}`)
}
export const fetchMaterials = () => get<MaterialCatalog>('/materials')
export const fetchRooms = (sid: string) => get<Room[]>(`/properties/${sid}/rooms`)

export async function analyzeRoom(
  sid: string,
  roomId: string,
  materials?: MaterialSelection,
): Promise<AcousticReport> {
  const res = await fetch('/api/rooms/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(roomBody(sid, roomId, materials)),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(`analyze: HTTP ${res.status} ${detail.detail ?? ''}`)
  }
  return res.json() as Promise<AcousticReport>
}

export async function compareRooms(
  a: { sid: string; roomId: string; materials?: MaterialSelection },
  b: { sid: string; roomId: string; materials?: MaterialSelection },
): Promise<Comparison> {
  const body = (x: typeof a) => roomBody(x.sid, x.roomId, x.materials)
  const res = await fetch('/api/rooms/compare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: body(a), b: body(b) }),
  })
  if (!res.ok) throw new Error(`compare: HTTP ${res.status}`)
  return res.json() as Promise<Comparison>
}

export const fetchTour = (sid: string) => get<TourLayout>(`/properties/${sid}/tour`)

export async function assessSuitability(report: AcousticReport): Promise<SuitabilityReport> {
  const res = await fetch('/api/suitability', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  })
  if (!res.ok) throw new Error(`suitability: HTTP ${res.status}`)
  return res.json() as Promise<SuitabilityReport>
}

export const fetchFurniture = () => get<FurnitureCatalog>('/furniture')

export interface DemoSide {
  sid: string
  room_id: string
  label: string
  address: string
  why: string
}
export interface DemoPair {
  good: DemoSide
  bad: DemoSide
}
export const fetchDemo = () => get<DemoPair>('/demo')
