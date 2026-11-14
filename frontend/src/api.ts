import type { Property, Room } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchProperties = () => get<Property[]>('/properties')
export const fetchRooms = (sid: string) => get<Room[]>(`/properties/${sid}/rooms`)
