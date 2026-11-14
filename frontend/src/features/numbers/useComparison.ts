import { useEffect, useState } from 'react'
import { compareRooms } from '../../api'
import type { Comparison, MaterialSelection } from '../../types'

interface Side {
  sid: string | null
  roomId: string | null
  materials: MaterialSelection
}

export function useComparison(a: Side, b: Side) {
  const ok = a.sid && a.roomId && b.sid && b.roomId
  const key = ok ? JSON.stringify([a, b]) : ''
  const [state, setState] = useState<{ key: string; value?: Comparison; error?: string }>({ key: '' })

  useEffect(() => {
    if (!ok) return
    let live = true
    compareRooms(
      { sid: a.sid!, roomId: a.roomId!, materials: a.materials },
      { sid: b.sid!, roomId: b.roomId!, materials: b.materials },
    )
      .then((value) => live && setState({ key, value }))
      .catch((e: Error) => live && setState({ key, error: e.message }))
    return () => {
      live = false
    }
    // a and b are captured through key (their JSON)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const current = state.key === key && key !== ''
  return {
    comparison: current ? state.value : undefined,
    error: current ? state.error : undefined,
    loading: key !== '' && !current,
  }
}
