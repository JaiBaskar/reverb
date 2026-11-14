import { useEffect, useRef, useState } from 'react'
import { decodeAudioBlob, MAX_DRY_SECONDS, peakLevel } from './engine'

export type RecorderState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'processing' }
  | { kind: 'error'; message: string }

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const MIN_SECONDS = 0.3
const SILENCE_PEAK = 1e-3 // about -60 dBFS: nothing was captured

export const recordingSupported = () =>
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

function pickMime(): string | undefined {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m))
}

function describe(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone permission was denied. Allow it in the browser’s site settings and try again.'
  if (name === 'NotFoundError') return 'No microphone was found.'
  if (name === 'NotReadableError') return 'The microphone is in use by another app.'
  return (e as Error)?.message || 'Recording failed.'
}

/**
 * Records a dry take with MediaRecorder. Browser voice processing (echo cancellation, noise
 * suppression, AGC) is turned off so the take stays as dry and unaltered as the mic allows.
 * Stops on its own at MAX_DRY_SECONDS. Calls onTake with the decoded buffer.
 */
export function useRecorder(onTake: (buf: AudioBuffer, seconds: number) => void) {
  const [state, setState] = useState<RecorderState>({ kind: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTakeRef = useRef(onTake)
  useEffect(() => {
    onTakeRef.current = onTake
  }, [onTake])

  const release = () => {
    if (limit.current) clearTimeout(limit.current)
    limit.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }

  useEffect(() => {
    if (state.kind !== 'recording') return
    const id = setInterval(() => setElapsed((performance.now() - state.startedAt) / 1000), 100)
    return () => clearInterval(id)
  }, [state])

  useEffect(
    () => () => {
      // unmount: stop the mic without delivering a take
      if (rec.current && rec.current.state !== 'inactive') {
        rec.current.ondataavailable = null
        rec.current.onstop = null
        rec.current.stop()
      }
      release()
    },
    [],
  )

  const start = async () => {
    if (!recordingSupported()) {
      setState({ kind: 'error', message: 'This browser cannot record audio (no MediaRecorder). Upload a file instead.' })
      return
    }
    setState({ kind: 'requesting' })
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      stream.current = s
      const mime = pickMime()
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
      const chunks: Blob[] = []
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      r.onerror = () => {
        release()
        setState({ kind: 'error', message: 'The recorder stopped with an error.' })
      }
      r.onstop = async () => {
        release()
        setState({ kind: 'processing' })
        const blob = new Blob(chunks, { type: r.mimeType || mime || 'audio/webm' })
        if (!blob.size) return setState({ kind: 'error', message: 'The recording is empty.' })
        try {
          const { buffer } = await decodeAudioBlob(blob)
          if (buffer.duration < MIN_SECONDS) throw new Error('The recording is too short.')
          if (peakLevel(buffer) < SILENCE_PEAK) throw new Error('The recording is silent. Check the input device.')
          onTakeRef.current(buffer, buffer.duration)
          setState({ kind: 'idle' })
        } catch (e) {
          const msg = (e as Error).message
          setState({
            kind: 'error',
            message: /recording/i.test(msg) ? msg : `Could not decode the recording (${r.mimeType || 'unknown format'}).`,
          })
        }
      }
      rec.current = r
      r.start(250)
      setElapsed(0)
      setState({ kind: 'recording', startedAt: performance.now() })
      limit.current = setTimeout(() => r.state !== 'inactive' && r.stop(), MAX_DRY_SECONDS * 1000)
    } catch (e) {
      release()
      setState({ kind: 'error', message: describe(e) })
    }
  }

  const stop = () => {
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
  }

  return { state, elapsed, start, stop, supported: recordingSupported() }
}
