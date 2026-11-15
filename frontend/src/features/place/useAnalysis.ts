import { useEffect, useState } from 'react'
import { fetchAnalysis, type HouseAnalysis } from '../../api'

/** The whole-house analysis (every room, best music room first) for one property. */
export function useAnalysis(sid: string | null) {
  const [state, setState] = useState<{ sid: string; data?: HouseAnalysis; error?: string } | null>(null)
  useEffect(() => {
    if (!sid) return
    let live = true
    fetchAnalysis(sid)
      .then((data) => live && setState({ sid, data }))
      .catch((e: Error) => live && setState({ sid, error: e.message }))
    return () => {
      live = false
    }
  }, [sid])
  const cur = state?.sid === sid ? state : null
  return { analysis: cur?.data ?? null, error: cur?.error ?? null, loading: !!sid && !cur }
}
