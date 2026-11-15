import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Variant } from '../matterport/connect'
import { MatterportViewer } from '../matterport/MatterportViewer'
import type { MpSdk } from '../matterport/sdkTypes'
import { createTreatmentScene, goToViewpoint, type TreatmentScene } from './scene'
import { itemCardLines, productNames } from './itemCard'
import type { PlacedItem, TreatmentPlan } from './types'

type Status =
  | { kind: 'connecting' }
  | { kind: 'positioning' }
  | { kind: 'ready' }
  | { kind: 'embed' }
  | { kind: 'error'; message: string }

const NONE: PlacedItem[] = []
/** Room the card keeps clear of: our status label (top) and Matterport's controls (bottom). */
const SAFE = { top: 44, bottom: 84, side: 8 }

/**
 * The plan installed in the real Matterport scan: live 3D view with a treated/original toggle,
 * opened at the automatically chosen scan position.
 */
export function TreatmentView({
  plan,
  extraItems = NONE,
  focusKey = null,
}: {
  plan: TreatmentPlan
  /** Items of the other rooms (whole-house view), installed alongside this room's plan. */
  extraItems?: PlacedItem[]
  /** An item hovered outside the 3D view (the plan's item list): highlighted with its card. */
  focusKey?: string | null
}) {
  const [conn, setConn] = useState<{ sdk: MpSdk; variant: Variant } | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'connecting' })
  const [treated, setTreated] = useState(true)
  const [moveError, setMoveError] = useState<string | null>(null)
  const scene = useRef<TreatmentScene | null>(null)
  const [sceneOn, setSceneOn] = useState(0) // bumps when a scene is installed
  const [hover3d, setHover3d] = useState<string | null>(null)
  const active = hover3d ?? focusKey
  const box = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [cardAt, setCardAt] = useState<{ left: number; top: number } | null>(null)
  const names = useMemo(() => productNames(plan), [plan])
  const activeItem = active ? plan.items.find((i) => i.key === active) : undefined
  const lines = activeItem ? itemCardLines(activeItem, plan.room.floor_z, names) : []

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
        const s = await createTreatmentScene(
          conn.sdk,
          [...plan.items, ...extraItems],
          plan.items.map((i) => i.key),
        )
        if (!live) return s?.dispose()
        scene.current = s
        s?.onHover(setHover3d)
        setSceneOn((n) => n + 1)
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
      setHover3d(null)
    }
  }, [conn, plan, extraItems])

  // Highlight the active item and keep its card next to it while the camera moves.
  useEffect(() => {
    const s = scene.current
    s?.highlight(treated ? active : null)
    if (!s || !active || !treated) {
      setCardAt(null)
      return
    }
    let raf = 0
    const tick = () => {
      const p = s.project(active)
      const el = box.current
      if (!p || !el) setCardAt(null)
      else {
        const W = el.clientWidth
        const H = el.clientHeight
        const cw = cardRef.current?.offsetWidth ?? 200
        const ch = cardRef.current?.offsetHeight ?? 64
        // beside the item: right of it if there is room, else left of it, else clamped inside
        let left = p.maxX + 12
        if (left + cw > W - SAFE.side) left = p.minX - cw - 12
        left = Math.max(SAFE.side, Math.min(W - SAFE.side - cw, left))
        const midY = (Math.max(p.minY, 0) + Math.min(p.maxY, H)) / 2
        const top = Math.max(SAFE.top, Math.min(H - SAFE.bottom - ch, midY - ch / 2))
        setCardAt((c) => (c && Math.abs(c.left - left) < 0.5 && Math.abs(c.top - top) < 0.5 ? c : { left, top }))
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      s.highlight(null)
    }
  }, [active, treated, sceneOn])

  const toggle = (on: boolean) => {
    setTreated(on)
    scene.current?.setVisible(on)
  }
  const busy = status.kind === 'connecting' || status.kind === 'positioning'

  return (
    <div className="space-y-3" data-testid="treatment-view">
      <div ref={box} className="relative overflow-hidden rounded-xl bg-black ring-1 ring-zinc-800">
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
        {lines.length > 0 && (
          <div
            ref={cardRef}
            className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-lg bg-paper/95 px-2.5 py-1.5 text-[11px] leading-4 text-ink shadow-lg ring-1 ring-line"
            style={cardAt ? { left: cardAt.left, top: cardAt.top } : { visibility: 'hidden', left: 0, top: 0 }}
            data-testid="item-card"
          >
            {lines.map((l, i) => (
              <div key={i} className={
                  activeItem?.status !== 'ok' && i === lines.length - 1 ? 'font-medium text-ok' : i === 0 ? 'font-semibold' : 'text-mute'
                }>
                {l}
              </div>
            ))}
          </div>
        )}
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
