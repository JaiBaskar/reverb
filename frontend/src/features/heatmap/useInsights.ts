import { useEffect, useState } from 'react'
import type { FurnitureItem } from '../../types'
import type { HouseInsights, RoomInsight } from './types'

export interface RoomOverride {
  furniture?: FurnitureItem[]
  source?: [number, number]
}

/**
 * Field maps and advice for every usable room (GET /properties/{sid}/insights, furnished by
 * default), with per-room edits (furniture, source position) recomputed by POST /rooms/insight.
 */
export function useInsights(sid: string, enabled: boolean) {
  const [house, setHouse] = useState<{ sid: string; data?: HouseInsights; error?: string } | null>(null)
  const [overrides, setOverrides] = useState<Record<string, RoomOverride>>({})
  const [edited, setEdited] = useState<Record<string, { key: string; room?: RoomInsight; error?: string }>>({})

  useEffect(() => {
    if (!enabled) return
    let live = true
    fetch(`/api/properties/${sid}/insights`)
      .then((r) => (r.ok ? (r.json() as Promise<HouseInsights>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => live && setHouse({ sid, data }))
      .catch((e: Error) => live && setHouse({ sid, error: e.message }))
    return () => {
      live = false
    }
  }, [sid, enabled])

  useEffect(() => {
    let live = true
    for (const [roomId, o] of Object.entries(overrides)) {
      const key = JSON.stringify(o)
      if (edited[roomId]?.key === key) continue
      fetch('/api/rooms/insight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid, room_id: roomId, furniture: o.furniture ?? null, source: o.source ?? null }),
      })
        .then((r) => (r.ok ? (r.json() as Promise<RoomInsight>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((room) => live && setEdited((e) => ({ ...e, [roomId]: { key, room } })))
        .catch((err: Error) => live && setEdited((e) => ({ ...e, [roomId]: { key, error: err.message } })))
    }
    return () => {
      live = false
    }
  }, [sid, overrides]) // eslint-disable-line react-hooks/exhaustive-deps

  const data = house?.sid === sid ? house.data : undefined
  const rooms: Record<string, RoomInsight> = {}
  for (const r of data?.rooms ?? []) {
    const e = edited[r.room_id]
    const o = overrides[r.room_id]
    rooms[r.room_id] = o && e?.key === JSON.stringify(o) && e.room ? e.room : r
  }
  const pending = Object.entries(overrides).some(([id, o]) => edited[id]?.key !== JSON.stringify(o))
  return {
    rooms,
    skipped: data?.skipped ?? [],
    loading: enabled && !data && !(house?.sid === sid && house.error),
    error: house?.sid === sid ? (house.error ?? null) : null,
    pending,
    overrides,
    setOverride: (roomId: string, patch: RoomOverride | null) =>
      setOverrides((o) => {
        const next = { ...o }
        if (patch === null) delete next[roomId]
        else next[roomId] = { ...o[roomId], ...patch }
        return next
      }),
  }
}
