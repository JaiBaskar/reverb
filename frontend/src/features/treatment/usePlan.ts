import { useEffect, useState } from 'react'
import { fetchHouseTreatment, fetchTreatment } from '../../api'
import type { HouseTreatment, TreatmentPlan } from './types'

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


/** Plans for every room of the property (fetched only when `on`). */
export function useHousePlan(sid: string, objective: string, scenario: Scenario, on: boolean) {
  const key = on ? `${sid}/${objective}/${scenario}` : ''
  const [state, setState] = useState<{ key: string; house?: HouseTreatment; error?: string }>({ key: '' })
  useEffect(() => {
    if (!on) return
    let live = true
    fetchHouseTreatment(sid, objective, scenario)
      .then((house) => live && setState({ key, house }))
      .catch((e: Error) => live && setState({ key, error: e.message }))
    return () => {
      live = false
    }
  }, [sid, objective, scenario, on, key])
  const cur = state.key === key && key !== ''
  return { house: cur ? state.house : undefined, error: cur ? state.error : undefined, loading: on && !cur }
}
