import type { AcousticReport, Property, Room } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchProperties = () => get<Property[]>('/properties')
export const fetchRooms = (sid: string) => get<Room[]>(`/properties/${sid}/rooms`)

export async function analyzeRoom(
  sid: string,
  roomId: string,
  materials?: Record<string, string>,
): Promise<AcousticReport> {
  const res = await fetch('/api/rooms/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sid, room_id: roomId, materials }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(`analyze: HTTP ${res.status} ${detail.detail ?? ''}`)
  }
  return res.json() as Promise<AcousticReport>
}
