import { useEffect, useState } from 'react'
import type { NoiseRisk } from './types'

/**
 * GET /properties/{sid}/noise-risk once the plain noise report has loaded (it is then cached on
 * the server, so this does not hit OpenStreetMap a second time).
 */
export function useNoiseRisk(sid: string | null, ready: boolean) {
  const [state, setState] = useState<{ sid: string; risk?: NoiseRisk; error?: string } | null>(null)
  useEffect(() => {
    if (!sid || !ready) return
    let live = true
    fetch(`/api/properties/${sid}/noise-risk`)
      .then((r) => (r.ok ? (r.json() as Promise<NoiseRisk>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((risk) => live && setState({ sid, risk }))
      .catch((e: Error) => live && setState({ sid, error: e.message }))
    return () => {
      live = false
    }
  }, [sid, ready])
  const cur = state?.sid === sid ? state : null
  return { risk: cur?.risk ?? null, error: cur?.error ?? null, loading: !!sid && !cur }
}
