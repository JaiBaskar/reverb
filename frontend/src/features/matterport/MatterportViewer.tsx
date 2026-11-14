import { useEffect, useRef, useState } from 'react'
import { bundleAvailable, connectSdk, iframeSrc, revealBundleView, SDK_KEY, type Variant } from './connect'
import type { MpSdk, Subscription } from './sdkTypes'

interface Props {
  sid: string
  onConnected: (sdk: MpSdk, variant: Variant) => void
  onDisconnected: () => void
}

type Status = { kind: 'checking' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

/** The Matterport tour iframe plus SDK connection. Prefers the self-hosted Bundle SDK. */
export function MatterportViewer({ sid, onConnected, onDisconnected }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const [variant, setVariant] = useState<Variant | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)
  // Callbacks change identity on every parent render; read them through a ref.
  const cb = useRef({ onConnected, onDisconnected })
  useEffect(() => {
    cb.current = { onConnected, onDisconnected }
  }, [onConnected, onDisconnected])

  useEffect(() => {
    let live = true
    bundleAvailable().then((ok) => live && setVariant(ok ? 'bundle' : 'embed'))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const el = iframe.current
    if (!variant || !el) return
    let live = true
    let sdk: MpSdk | null = null
    let modeSub: Subscription | null = null
    setStatus({ kind: 'loading' })
    const onLoad = async () => {
      try {
        const s = await connectSdk(variant, el)
        if (!live) return s.disconnect?.()
        sdk = s
        if (variant === 'bundle') {
          modeSub = s.Mode.current.subscribe((m) => {
            if (m && m !== 'mode.transitioning') revealBundleView(el)
          })
        }
        setStatus({ kind: 'ready' })
        cb.current.onConnected(s, variant)
      } catch (e) {
        if (live) setStatus({ kind: 'error', message: (e as Error).message })
      }
    }
    el.addEventListener('load', onLoad)
    // Navigate only when the URL changes (or on Retry). React StrictMode runs this effect twice
    // in dev; a second navigation mid-load left the Embed showcase black and its SDK silent.
    const url = iframeSrc(variant, sid)
    if (el.dataset.src !== url || el.dataset.attempt !== String(attempt)) {
      el.dataset.src = url
      el.dataset.attempt = String(attempt)
      el.src = url
    }
    return () => {
      live = false
      el.removeEventListener('load', onLoad)
      modeSub?.cancel()
      if (sdk) {
        cb.current.onDisconnected()
        sdk.disconnect?.()
      }
    }
  }, [variant, sid, attempt])

  return (
    <div className="relative h-full w-full bg-black">
      <iframe
        ref={iframe}
        title="Matterport 3D tour"
        className="h-full w-full border-0"
        allow="fullscreen; xr-spatial-tracking"
        data-testid="matterport-iframe"
      />
      {status.kind !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-sm">
          {status.kind === 'error' ? (
            <div className="max-w-md space-y-2">
              <div className="font-semibold text-red-300">The 3D tour could not connect</div>
              <div className="text-zinc-300">{status.message}</div>
              {!SDK_KEY && (
                <div className="text-xs text-zinc-400">
                  Add MATTERPORT_SDK_KEY to the repo-root .env and restart the dev server.
                </div>
              )}
              <button
                className="rounded bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-700"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry
              </button>
              <div className="text-xs text-zinc-500">Room analysis and audio below still work without the tour.</div>
            </div>
          ) : (
            <div className="text-zinc-300">
              <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200" />
              Loading the Matterport tour…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
