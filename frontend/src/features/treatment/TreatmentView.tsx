import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPhotorealStatus, makePhotoreal, type PhotorealStatus } from '../../api'
import type { Variant } from '../matterport/connect'
import { MatterportViewer } from '../matterport/MatterportViewer'
import type { MpSdk } from '../matterport/sdkTypes'
import { createTreatmentScene, goToViewpoint, type TreatmentScene } from './scene'
import type { TreatmentPlan } from './types'

type Status =
  | { kind: 'connecting' }
  | { kind: 'positioning' }
  | { kind: 'capturing' }
  | { kind: 'ready' }
  | { kind: 'embed' }
  | { kind: 'error'; message: string }

const SHOT = { width: 1280, height: 720 }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The plan installed in the real Matterport scan: live 3D view with a treated/original toggle,
 * and a before/after pair captured from the automatically chosen scan position.
 */
export function TreatmentView({ plan, avoidWalls }: { plan: TreatmentPlan; avoidWalls: number[] }) {
  const [conn, setConn] = useState<{ sdk: MpSdk; variant: Variant } | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'connecting' })
  const [shots, setShots] = useState<{ key: string; before: string; after: string } | null>(null)
  const [treated, setTreated] = useState(true)
  const scene = useRef<TreatmentScene | null>(null)
  const [ai, setAi] = useState<PhotorealStatus | null>(null)
  const [real, setReal] = useState<{ key: string; image?: string; label?: string; error?: string; busy?: boolean } | null>(null)
  useEffect(() => {
    fetchPhotorealStatus()
      .then(setAi)
      .catch(() => setAi(null))
  }, [])
  const planKey = `${plan.room_id}/${plan.objective.id}/${plan.scenario}/${plan.items.length}`

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
        const s = await createTreatmentScene(conn.sdk, plan.items)
        if (!live) return s?.dispose()
        scene.current = s
        if (!plan.viewpoint) {
          setStatus({ kind: 'ready' })
          return
        }
        setStatus({ kind: 'positioning' })
        await goToViewpoint(conn.sdk, plan.viewpoint)
        await wait(2500) // let the panorama's high-resolution tiles load
        if (!live) return
        setStatus({ kind: 'capturing' })
        const before = s?.capture(false) ?? (await conn.sdk.Renderer.takeScreenShot(SHOT))
        const after = s?.capture(true)
        if (!live) return
        if (after) setShots({ key: planKey, before, after })
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
  }, [conn, plan, planKey])

  const toggle = (on: boolean) => {
    setTreated(on)
    scene.current?.setVisible(on)
  }
  const current = shots?.key === planKey ? shots : null
  const realNow = real?.key === planKey ? real : null
  const photoreal = () => {
    if (!current) return
    setReal({ key: planKey, busy: true })
    makePhotoreal(plan, avoidWalls, current.before, current.after)
      .then((r) => setReal({ key: planKey, image: r.image, label: r.label }))
      .catch((e: Error) => setReal({ key: planKey, error: e.message }))
  }
  const busy = status.kind === 'connecting' || status.kind === 'positioning' || status.kind === 'capturing'

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
              : status.kind === 'positioning'
                ? 'Moving to the best scan position…'
                : 'Capturing before and after…'
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
        <span className="text-xs text-zinc-500">Drag to look around; click the floor to walk.</span>
      </div>
      {status.kind === 'embed' && (
        <p className="rounded-lg bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
          The 3D treatment preview needs the Matterport Bundle SDK (run <code>npm run setup:matterport</code>). The plan,
          positions and predictions below are unaffected.
        </p>
      )}
      {status.kind === 'error' && <p className="text-sm text-red-300">3D preview failed: {status.message}</p>}
      {plan.viewpoint ? (
        <p className="text-xs text-zinc-500" data-testid="viewpoint-reason">
          Viewpoint chosen automatically: {plan.viewpoint.reason}
        </p>
      ) : (
        <p className="text-xs text-zinc-500">This room has no tour scan position, so there is no picture of it.</p>
      )}
      {current && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="before-after">
          <figure>
            <img src={current.before} alt="The room as scanned" className="w-full rounded-lg ring-1 ring-zinc-800" />
            <figcaption className="mt-1 text-xs text-zinc-400">Before: the Matterport scan as captured</figcaption>
          </figure>
          <figure>
            <img src={current.after} alt="The room with the recommended treatment" className="w-full rounded-lg ring-1 ring-zinc-800" />
            <figcaption className="mt-1 text-xs text-zinc-400">
              After: a visualization, with each item drawn at its calculated position. Not a photo of an installation.
            </figcaption>
          </figure>
        </div>
      )}
      {current && ai?.available && (
        <div className="space-y-2" data-testid="photoreal">
          {!realNow?.image && (
            <button
              onClick={photoreal}
              disabled={realNow?.busy}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              {realNow?.busy ? 'Generating…' : 'Make the "after" look photographic (AI)'}
            </button>
          )}
          {realNow?.error && <p className="text-sm text-red-300">AI visualization failed: {realNow.error}</p>}
          {realNow?.image && (
            <figure>
              <img src={realNow.image} alt="AI visualization of the treated room" className="w-full rounded-lg ring-1 ring-zinc-800" />
              <figcaption className="mt-1 text-xs text-zinc-400">{realNow.label}</figcaption>
            </figure>
          )}
        </div>
      )}
    </div>
  )
}
