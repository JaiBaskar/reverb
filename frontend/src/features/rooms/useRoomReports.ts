import { useEffect, useState } from 'react'
import { analyzeRoom } from '../../api'
import type { AcousticReport, Room } from '../../types'

const CONCURRENCY = 3

/**
 * The acoustic report of every usable room of one property (default furnishing and materials),
 * so the room list can show each room's reverb before you choose. Keyed by sid; late results
 * from a previous property are dropped.
 */
export function useRoomReports(sid: string | null, rooms: Room[] | null) {
  const [state, setState] = useState<{ sid: string | null; data: Record<string, AcousticReport | 'error'> }>({
    sid: null,
    data: {},
  })
  const ids = rooms
    ?.filter((r) => r.usable)
    .map((r) => r.id)
    .join(',')

  useEffect(() => {
    if (!sid || !ids) return
    let live = true
    const queue = ids.split(',')
    const set = (id: string, v: AcousticReport | 'error') =>
      live && setState((s) => ({ sid, data: { ...(s.sid === sid ? s.data : {}), [id]: v } }))
    const worker = async () => {
      for (let id = queue.shift(); id && live; id = queue.shift()) {
        try {
          set(id, await analyzeRoom(sid, id))
        } catch {
          set(id, 'error')
        }
      }
    }
    for (let i = 0; i < CONCURRENCY; i++) void worker()
    return () => {
      live = false
    }
  }, [sid, ids])

  return state.sid === sid ? state.data : {}
}
