export type SwitchState<K> =
  | { kind: 'idle' }
  | { kind: 'loading'; key: K }
  | { kind: 'ready'; key: K }
  | { kind: 'error'; key: K; message: string }

/**
 * Loads a resource per room and applies only the most recently requested one, so rapid room
 * changes can never leave a stale impulse response playing. Loads that finish out of order are
 * dropped. Pure logic, no Web Audio, so it is unit-tested.
 */
export function createRoomSwitcher<K, T>(
  load: (key: K) => Promise<T>,
  apply: (key: K | null, value: T | null) => void,
  onState: (s: SwitchState<K>) => void,
) {
  let seq = 0
  return {
    request(key: K | null) {
      const token = ++seq
      if (key === null) {
        apply(null, null)
        onState({ kind: 'idle' })
        return
      }
      onState({ kind: 'loading', key })
      load(key).then(
        (value) => {
          if (token !== seq) return
          apply(key, value)
          onState({ kind: 'ready', key })
        },
        (e: Error) => {
          if (token !== seq) return
          onState({ kind: 'error', key, message: e.message })
        },
      )
    },
    cancel() {
      seq++
    },
  }
}
