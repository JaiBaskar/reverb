import { useEffect, useState } from 'react'
import type { NoiseReport } from './types'

interface State {
  sid: string | null
  report?: NoiseReport
  error?: string
}

/** Fetches GET /properties/{sid}/noise. The first call can take ~40 s (Overpass); then cached. */
export function useNoise(sid: string | null) {
  const [state, setState] = useState<State>({ sid: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!sid) return
    let live = true
    fetch(`/api/properties/${sid}/noise${attempt ? `?retry=${attempt}` : ''}`)
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          throw new Error(`noise: HTTP ${res.status} ${detail.detail ?? ''}`)
        }
        return res.json() as Promise<NoiseReport>
      })
      .then((report) => live && setState({ sid, report }))
      .catch((e: Error) => live && setState({ sid, error: e.message }))
    return () => {
      live = false
    }
  }, [sid, attempt])

  const current = sid !== null && state.sid === sid
  const retry = () => {
    setState({ sid: null })
    setAttempt((n) => n + 1)
  }
  return {
    retry,
    report: current ? state.report : undefined,
    error: current ? state.error : undefined,
    loading: sid !== null && !current,
  }
}
