import { useEffect, useState } from 'react'
import { analyzeRoom, assessSuitability } from '../../api'
import type { TourRoom } from '../../types'
import type { RoomData } from './classify'

const CONCURRENCY = 3

/**
 * Acoustic report + suitability for every usable room of a property (default materials), so the
 * whole house can be coloured. Results are keyed by sid; a property change discards late results.
 */
export function useHouseAcoustics(sid: string, rooms: TourRoom[] | null) {
  const [state, setState] = useState<{ sid: string; data: Record<string, RoomData> }>({ sid: '', data: {} })

  useEffect(() => {
    if (!rooms) return
    let live = true
    const usable = rooms.filter((r) => r.usable)
    // Rooms with no entry yet are shown as loading by classifyRoom.
    const set = (id: string, d: RoomData) =>
      live && setState((s) => ({ sid, data: { ...(s.sid === sid ? s.data : {}), [id]: d } }))

    const queue = [...usable]
    const worker = async () => {
      for (let r = queue.shift(); r && live; r = queue.shift()) {
        try {
          const report = await analyzeRoom(sid, r.room_id)
          set(r.room_id, { report, loading: true })
          const suitability = await assessSuitability(report)
          set(r.room_id, { report, suitability, loading: false })
        } catch (e) {
          set(r.room_id, { loading: false, error: (e as Error).message })
        }
      }
    }
    for (let i = 0; i < CONCURRENCY; i++) void worker()
    return () => {
      live = false
    }
  }, [sid, rooms])

  return state.sid === sid ? state.data : {}
}
