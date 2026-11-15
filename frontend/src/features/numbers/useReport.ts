import { useEffect, useState } from 'react'
import type { MaterialSelection } from '../../types'
import { analyzeRoom } from '../../api'
import type { AcousticReport } from '../../types'

interface State {
  key: string
  report?: AcousticReport
  error?: string
}

/** Fetches the acoustic report for a room; state is keyed so stale results are ignored. */
export function useReport(
  sid: string | null,
  roomId: string | null,
  materials?: MaterialSelection,
  /** Changes when the server-side model changes (e.g. the AI inspection finished): refetch. */
  refresh = '',
) {
  const matKey = JSON.stringify(materials ?? {})
  const key = sid && roomId ? `${sid}/${roomId}/${matKey}/${refresh}` : ''
  const [state, setState] = useState<State>({ key: '' })

  useEffect(() => {
    if (!sid || !roomId) return
    let live = true
    analyzeRoom(sid, roomId, materials)
      .then((report) => live && setState({ key, report }))
      .catch((e: Error) => live && setState({ key, error: e.message }))
    return () => {
      live = false
    }
    // materials is captured through key (its JSON)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, roomId, key])

  const current = state.key === key && key !== ''
  return {
    report: current ? state.report : undefined,
    error: current ? state.error : undefined,
    loading: key !== '' && !current,
  }
}
