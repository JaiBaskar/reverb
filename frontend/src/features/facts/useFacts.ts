import { useEffect, useState } from 'react'
import type { PropertyFacts } from './types'

export function useFacts(sid: string | null) {
  const [state, setState] = useState<{ sid: string | null; facts?: PropertyFacts; error?: string }>({
    sid: null,
  })

  useEffect(() => {
    if (!sid) return
    let live = true
    fetch(`/api/properties/${sid}/facts`)
      .then((res) => {
        if (!res.ok) throw new Error(`facts: HTTP ${res.status}`)
        return res.json() as Promise<PropertyFacts>
      })
      .then((facts) => live && setState({ sid, facts }))
      .catch((e: Error) => live && setState({ sid, error: e.message }))
    return () => {
      live = false
    }
  }, [sid])

  const current = sid !== null && state.sid === sid
  return { facts: current ? state.facts : undefined, error: current ? state.error : undefined }
}
