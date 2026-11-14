import { useEffect, useState } from 'react'
import type { MaterialSelection } from '../../types'
import { fetchIr, type LoadedIr } from './engine'

interface State {
  key: string
  roomKey: string
  ir?: LoadedIr
  error?: string
}

/**
 * Loads the impulse response for a room + materials. While a new IR for the SAME room is loading
 * (materials changed), the previous one is kept so playback never drops to silence.
 */
export function useIr(sid: string | null, roomId: string | null, materials?: MaterialSelection) {
  const roomKey = sid && roomId ? `${sid}/${roomId}` : ''
  const key = roomKey ? `${roomKey}/${JSON.stringify(materials ?? {})}` : ''
  const [state, setState] = useState<State>({ key: '', roomKey: '' })

  useEffect(() => {
    if (!sid || !roomId) return
    let live = true
    fetchIr(sid, roomId, materials)
      .then((ir) => live && setState({ key, roomKey, ir }))
      .catch((e: Error) => live && setState({ key, roomKey, error: e.message }))
    return () => {
      live = false
    }
    // materials is captured through key (its JSON)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, roomId, key])

  const sameRoom = roomKey !== '' && state.roomKey === roomKey
  const current = state.key === key && key !== ''
  return {
    ir: sameRoom ? state.ir : undefined,
    error: current ? state.error : undefined,
    loading: key !== '' && !current,
  }
}
