import { useEffect, useState } from 'react'
import { fetchTreatment } from '../../api'
import type { TreatmentPlan } from './types'

type Scenario = 'as_scanned' | 'empty'

/** The treatment plan for a room, use and furniture scenario; stale results are ignored. */
export function usePlan(sid: string | null, roomId: string | null, objective: string, scenario: Scenario, avoid: number[]) {
  const avoidKey = avoid.join(',')
  const key = sid && roomId ? `${sid}/${roomId}/${objective}/${scenario}/${avoidKey}` : ''
  const [state, setState] = useState<{ key: string; plan?: TreatmentPlan; error?: string }>({ key: '' })
  useEffect(() => {
    if (!sid || !roomId) return
    let live = true
    fetchTreatment(sid, roomId, objective, scenario, avoidKey ? avoidKey.split(',').map(Number) : [])
      .then((plan) => live && setState({ key, plan }))
      .catch((e: Error) => live && setState({ key, error: e.message }))
    return () => {
      live = false
    }
  }, [sid, roomId, objective, scenario, avoidKey, key])
  const cur = state.key === key
  return { plan: cur ? state.plan : undefined, error: cur ? state.error : undefined, loading: key !== '' && !cur }
}

