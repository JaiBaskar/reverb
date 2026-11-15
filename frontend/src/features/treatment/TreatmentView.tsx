import { useCallback, useEffect, useRef, useState } from 'react'
import type { Variant } from '../matterport/connect'
import { MatterportViewer } from '../matterport/MatterportViewer'
import type { MpSdk } from '../matterport/sdkTypes'
import { createTreatmentScene, goToViewpoint, type TreatmentScene } from './scene'
import type { PlacedItem, TreatmentPlan } from './types'

type Status =
  | { kind: 'connecting' }
  | { kind: 'positioning' }
  | { kind: 'ready' }
  | { kind: 'embed' }
  | { kind: 'error'; message: string }

const NONE: PlacedItem[] = []

/**
 * The plan installed in the real Matterport scan: live 3D view with a treated/original toggle,
 * opened at the automatically chosen scan position.
 */
export function TreatmentView({
  plan,
  extraItems = NONE,
}: {
  plan: TreatmentPlan
  /** Items of the other rooms (whole-house view), installed alongside this room's plan. */
  extraItems?: PlacedItem[]
}) {
  const [conn, setConn] = useState<{ sdk: MpSdk; variant: Variant } | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'connecting' })
  const [treated, setTreated] = useState(true)
  const [moveError, setMoveError] = useState<string | null>(null)
  const scene = useRef<TreatmentScene | null>(null)

  const onConnected = useCallback((sdk: MpSdk, variant: Variant) => {
    // Dev-only handle for inspecting the SDK from the browser console.
    if (import.meta.env.DEV) (window as unknown as { __reverbTreatSdk?: MpSdk }).__reverbTreatSdk = sdk
    setConn({ sdk, variant })
  }, [])
  const onDisconnected = useCallback(() => setConn(null), [])

  useEffect(() => {
    if (!conn) return
    let live = true
    const run = async () => {
      if (conn.variant !== 'bundle' || !conn.sdk.Scene) {
        setStatus({ kind: 'embed' })
        return
      }
      try {
        const s = await createTreatmentScene(conn.sdk, [...plan.items, ...extraItems])
        if (!live) return s?.dispose()
        scene.current = s
        if (!plan.viewpoint) {
          setStatus({ kind: 'ready' })
          return
        }
        setStatus({ kind: 'positioning' })
        try {
          await goToViewpoint(conn.sdk, plan.viewpoint)
        } catch (e) {
          // not fatal: the treatment is installed; only the automatic camera move failed
          if (live) setMoveError((e as Error).message || 'the tour would not move to the chosen scan position')
          if (live) setStatus({ kind: 'ready' })
          return
        }
        if (!live) return
        setTreated(true)
        setStatus({ kind: 'ready' })
      } catch (e) {
        if (live) setStatus({ kind: 'error', message: (e as Error).message })
      }
    }
    void run()
    return () => {
      live = false
      scene.current?.dispose()
      scene.current = null
    }
  }, [conn, plan, extraItems])

  const toggle = (on: boolean) => {
    setTreated(on)
    scene.current?.setVisible(on)
  }
  const busy = status.kind === 'connecting' || status.kind === 'positioning'

  return (
    <div className="space-y-3" data-testid="treatment-view">
      <div className="relative overflow-hidden rounded-xl bg-black ring-1 ring-zinc-800">
        <div className="aspect-video w-full">
          <MatterportViewer sid={plan.sid} onConnected={onConnected} onDisconnected={onDisconnected} />
        </div>
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs text-zinc-200">
          {busy
            ? status.kind === 'connecting'
              ? 'Loading the 3D scan…'
              : 'Moving to the best scan position…'
            : treated
              ? 'With the treatment plan (rendered at the calculated positions)'
              : 'Original scan'}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex rounded-lg bg-zinc-900 p-0.5 ring-1 ring-zinc-800" role="radiogroup" aria-label="Show treatment">
          {[
            [true, 'With treatment'],
            [false, 'Original'],
          ].map(([on, label]) => (
            <button
              key={String(on)}
              role="radio"
              aria-checked={treated === on}
              disabled={status.kind !== 'ready'}
              onClick={() => toggle(on as boolean)}
              className={`rounded-md px-3 py-1 disabled:opacity-40 ${treated === on ? 'bg-zinc-100 text-black' : 'text-zinc-300'}`}
            >
              {label as string}
            </button>
          ))}
        </div>
        {plan.viewpoint && conn && status.kind === 'ready' && (
          <button onClick={() => void goToViewpoint(conn.sdk, plan.viewpoint!)} className="rounded-lg bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">
            Back to the chosen view
          </button>
        )}
        {extraItems.length > 0 && conn && status.kind === 'ready' && (
          <button
            onClick={() => void conn.sdk.Mode.moveTo(conn.sdk.Mode.Mode.DOLLHOUSE).catch(() => undefined)}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700"
            data-testid="dollhouse"
          >
            See the whole house
          </button>
        )}
        <span className="text-xs text-zinc-500">Drag to look around; click the floor to walk.</span>
      </div>
      {status.kind === 'embed' && (
        <p className="rounded-lg bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
          The 3D treatment preview needs the Matterport Bundle SDK (run <code>npm run setup:matterport</code>). The plan,
          positions and predictions below are unaffected.
        </p>
      )}
      {status.kind === 'error' && (
        <p className="text-sm text-red-300">3D preview failed: {status.message || 'unknown error from the Matterport viewer'}</p>
      )}
      {moveError && status.kind === 'ready' && (
        <p className="text-xs text-amber-300">Could not move to the chosen view automatically ({moveError}); use “Back to the chosen view”.</p>
      )}
      {plan.viewpoint ? (
        <p className="text-xs text-zinc-500" data-testid="viewpoint-reason">
          Viewpoint chosen automatically: {plan.viewpoint.reason}
        </p>
      ) : (
        <p className="text-xs text-zinc-500">This room has no tour scan position.</p>
      )}
    </div>
  )
}
