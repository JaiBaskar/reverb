import { useEffect, useState } from 'react'
import type { ModeValue, MpSdk, Subscription } from './sdkTypes'

export interface TourState {
  sweepId: string | null
  /** Room ids from SDK Room.current; null until reported or if room tracking is unavailable. */
  roomIds: string[] | null
  roomTracking: 'pending' | 'ok' | 'unavailable'
  mode: ModeValue | null
}

const INITIAL: TourState = { sweepId: null, roomIds: null, roomTracking: 'pending', mode: null }

/**
 * Subscribes to sweep, room and mode changes. Room tracking is its own subscription so a model
 * without room data cannot break sweep tracking. Everything is cancelled on sdk change/unmount.
 */
export function useTourState(sdk: MpSdk | null): TourState {
  const [keyed, setKeyed] = useState<{ sdk: MpSdk | null; state: TourState }>({ sdk: null, state: INITIAL })

  useEffect(() => {
    if (!sdk) return
    const setState = (f: (x: TourState) => TourState) =>
      setKeyed((k) => ({ sdk, state: f(k.sdk === sdk ? k.state : INITIAL) }))
    // Room.current follows the camera, so during a fly-through (Sweep.current.sid is '' in
    // transit) it walks through every room on the way. Verified on zvKHR9DHNjJ: Living Room ->
    // Kitchen passes Closet, Bedroom, Dining Room and Hallway. Only publish rooms on arrival.
    let latestRooms: string[] | null = null
    let atSweep = false
    const subs: Subscription[] = []
    subs.push(
      sdk.Sweep.current.subscribe((s) => {
        atSweep = !!s.sid
        setState((x) => ({
          ...x,
          sweepId: s.sid || null,
          roomIds: atSweep && latestRooms ? latestRooms : x.roomIds,
        }))
      }),
    )
    subs.push(sdk.Mode.current.subscribe((m) => setState((x) => ({ ...x, mode: m }))))
    try {
      subs.push(
        sdk.Room.current.subscribe((r) => {
          latestRooms = (r.rooms ?? []).map((room) => room.id)
          setState((x) => ({ ...x, roomTracking: 'ok', roomIds: atSweep ? latestRooms : x.roomIds }))
        }),
      )
    } catch {
      setState((x) => ({ ...x, roomTracking: 'unavailable' }))
    }
    return () => subs.forEach((s) => s.cancel())
  }, [sdk])

  return sdk && keyed.sdk === sdk ? keyed.state : INITIAL
}
