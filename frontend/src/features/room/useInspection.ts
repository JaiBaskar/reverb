import { useCallback, useEffect, useState } from 'react'
import type { MaterialAssignment, PieceFinding } from '../treatment/types'

// Mirrors backend/treatment/router.py (InspectStatus) and roomintel/model.py (RoomModel, subset).
export interface Inspection {
  orchestrator: 'deepagents' | 'direct'
  coordinator_model: string | null
  vision_model: string | null
  summary: string | null
  cross_checks: string[]
  rechecked: string[]
  gaps: string[]
  seconds: number | null
  reason: string | null
}
export interface InspectedRoom {
  vision_status: 'ok' | 'partial' | 'unavailable' | 'error'
  vision_reason: string | null
  materials: MaterialAssignment[]
  pieces: PieceFinding[]
  hazards: { kind: string; note: string; wall: number | null; confidence: number }[]
  walls: { wall: number; material_id: string | null; finish: string | null; confidence: number | null }[]
  agents: { agent: string; status: string; model: string | null; seconds: number | null; reason: string | null }[]
  inspection: Inspection | null
}
export interface InspectStatus {
  state: 'idle' | 'running' | 'done' | 'error'
  elapsed_s: number | null
  error: string | null
  model: InspectedRoom | null
}

const POLL_MS = 4000

/** The Deep Agents vision inspection of one room: status, start, and polling while it runs. */
export function useInspection(sid: string, roomId: string, enabled: boolean) {
  const [status, setStatus] = useState<InspectStatus | null>(null)
  const url = `/api/properties/${sid}/rooms/${roomId}/inspect`
  const running = status?.state === 'running'

  useEffect(() => {
    if (!enabled) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const poll = () =>
      fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<InspectStatus>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((s) => {
          if (!live) return
          setStatus(s)
          if (s.state === 'running') timer = setTimeout(poll, POLL_MS)
        })
        .catch((e: Error) => live && setStatus({ state: 'error', elapsed_s: null, error: e.message, model: null }))
    void poll()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [url, enabled, running])

  const start = useCallback(
    (fresh = false) =>
      fetch(`${url}${fresh ? '?fresh=true' : ''}`, { method: 'POST' })
        .then((r) => r.json() as Promise<InspectStatus>)
        .then(setStatus)
        .catch((e: Error) => setStatus({ state: 'error', elapsed_s: null, error: e.message, model: null })),
    [url],
  )

  return { status, start }
}

/** Did the agents establish anything (so the room should be modelled from what they saw)? */
export const seen = (s: InspectStatus | null) =>
  s?.state === 'done' && (s.model?.vision_status === 'ok' || s.model?.vision_status === 'partial')
