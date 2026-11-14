import { useEffect, useState } from 'react'
import { fetchIr, type LoadedIr } from './engine'

interface State {
  key: string
  ir?: LoadedIr
  error?: string
}

export function useIr(sid: string | null, roomId: string | null) {
  const key = sid && roomId ? `${sid}/${roomId}` : ''
  const [state, setState] = useState<State>({ key: '' })

  useEffect(() => {
    if (!sid || !roomId) return
    let live = true
    fetchIr(sid, roomId)
      .then((ir) => live && setState({ key, ir }))
      .catch((e: Error) => live && setState({ key, error: e.message }))
    return () => {
      live = false
    }
  }, [sid, roomId, key])

  const current = state.key === key && key !== ''
  return {
    ir: current ? state.ir : undefined,
    error: current ? state.error : undefined,
    loading: key !== '' && !current,
  }
}
