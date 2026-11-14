import { useEffect, useState } from 'react'
import { analyzeRoom } from '../../api'
import type { AcousticReport } from '../../types'

interface State {
  key: string
  report?: AcousticReport
  error?: string
}

/** Fetches the acoustic report for a room; state is keyed so stale results are ignored. */
export function useReport(sid: string | null, roomId: string | null) {
  const key = sid && roomId ? `${sid}/${roomId}` : ''
  const [state, setState] = useState<State>({ key: '' })

  useEffect(() => {
    if (!sid || !roomId) return
    let live = true
    analyzeRoom(sid, roomId)
      .then((report) => live && setState({ key, report }))
      .catch((e: Error) => live && setState({ key, error: e.message }))
    return () => {
      live = false
    }
  }, [sid, roomId, key])

  const current = state.key === key && key !== ''
  return {
    report: current ? state.report : undefined,
    error: current ? state.error : undefined,
    loading: key !== '' && !current,
  }
}
