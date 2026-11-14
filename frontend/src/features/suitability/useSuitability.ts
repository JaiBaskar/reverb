import { useEffect, useState } from 'react'
import type { AcousticReport } from '../../types'
import type { SuitabilityReport } from './types'

/** POSTs the room's AcousticReport to /suitability; re-runs whenever the report changes. */
export function useSuitability(report: AcousticReport | undefined) {
  const [state, setState] = useState<{ src?: AcousticReport; out?: SuitabilityReport; error?: string }>({})

  useEffect(() => {
    if (!report) return
    let live = true
    fetch('/api/suitability', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`suitability: HTTP ${res.status}`)
        return res.json() as Promise<SuitabilityReport>
      })
      .then((out) => live && setState({ src: report, out }))
      .catch((e: Error) => live && setState({ src: report, error: e.message }))
    return () => {
      live = false
    }
  }, [report])

  const current = report !== undefined && state.src === report
  return { suitability: current ? state.out : undefined, error: current ? state.error : undefined }
}
