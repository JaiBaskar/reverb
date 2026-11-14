import { useEffect, useState } from 'react'
import type { AcousticReport } from '../../types'
import type { UseCaseVerdict } from './types'

/** Which room suits each use better (deterministic, backend /suitability/compare). */
export function useVerdicts(a: AcousticReport | undefined, b: AcousticReport | undefined) {
  const [state, setState] = useState<{ a?: AcousticReport; b?: AcousticReport; v?: UseCaseVerdict[] }>({})
  useEffect(() => {
    if (!a || !b) return
    let live = true
    fetch('/api/suitability/compare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a, b }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((out: { verdicts: UseCaseVerdict[] }) => live && setState({ a, b, v: out.verdicts }))
      .catch(() => live && setState({ a, b, v: [] }))
    return () => {
      live = false
    }
  }, [a, b])
  return a && b && state.a === a && state.b === b ? state.v : undefined
}
