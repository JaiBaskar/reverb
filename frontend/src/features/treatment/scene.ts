/* eslint-disable @typescript-eslint/no-explicit-any */
import type { MpSdk, SceneComponent, SceneObject } from '../matterport/sdkTypes'
import { ITEM_COLORS } from './colors'
import type { PlacedItem, Viewpoint } from './types'

/**
 * The treatment plan, built as 3D objects inside the Matterport scan (Bundle SDK Scene API).
 *
 * Every object sits at the coordinates the backend calculated (model space, z up), converted
 * with sdk (x, y, z) = model (x, z, -y). Nothing here changes a position or a size.
 *
 * Each item is drawn twice against the scan's depth:
 *  - visible pass (normal depth test): a solid fabric panel with rounded edges, darker sides
 *    (vertex colours, no lights, so the scan's own lighting is untouched), a fine fabric
 *    texture and a soft contact shadow on the wall;
 *  - hidden pass (depth test GREATER, no depth write): only the part behind furniture or walls,
 *    as a dashed outline and a faint fill. So a panel behind a desk is solid where you can see
 *    it and outlined where it is hidden.
 * Furniture in the way of a blocked item is outlined only while that item is hovered.
 */

type V3 = [number, number, number]
const toSdk = ([x, y, z]: V3): V3 => [x, z, -y]

interface Inputs {
  /** Registry key for this instance's hover handle (Matterport drops unknown output keys). */
  id: string
  items: PlacedItem[]
  /** Keys of the items that can be hovered (the page's own room). */
  hoverable: string[]
  visible: boolean
}

/** Handle the component hands back through outputs (closure state lives in the factory). */
interface Api {
  /** Item key under the pointer at canvas pixel (x, y), or null. */
  pick(x: number, y: number, w: number, h: number): string | null
  highlight(key: string | null): void
  /** The item's on-screen box in canvas pixels; null when it is behind the camera. */
  project(key: string, w: number, h: number): Box2 | null
}

export interface Box2 {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const COMPONENT = 'reverb.treatment'
const apis = new Map<string, Api>()
let nextId = 0

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Small seeded PRNG: the fabric looks the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Greyscale woven-fabric noise (multiplies the item colour). */
function fabricCanvas(): HTMLCanvasElement {
  const n = 128
  const c = document.createElement('canvas')
  c.width = c.height = n
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(n, n)
  const r = rng(7)
  // low-frequency mottling (tileable 8 x 8 grid, bilinear) so the fabric still reads from metres away
  const g = 8
  const grid = Array.from({ length: g * g }, () => r() - 0.5)
  const at = (i: number, j: number) => grid[((j + g) % g) * g + ((i + g) % g)]
  const mottle = (x: number, y: number) => {
    const fx = (x / n) * g
    const fy = (y / n) * g
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const tx = fx - i
    const ty = fy - j
    return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const weave = ((x % 4 < 2) !== (y % 4 < 2) ? 10 : -10) + (y % 2 ? 5 : -5)
      const v = Math.max(0, Math.min(255, 222 + weave + mottle(x, y) * 60 + (r() - 0.5) * 30))
      const i = (y * n + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/** Soft dark blob for the contact shadow behind a panel (transparent at the edges). */
function shadowCanvas(): HTMLCanvasElement {
  const n = 64
  const c = document.createElement('canvas')
  c.width = c.height = n
  const ctx = c.getContext('2d')!
  ctx.filter = 'blur(6px)'
  ctx.fillStyle = 'rgba(0,0,0,1)'
  ctx.fillRect(12, 12, n - 24, n - 24)
  return c
}

function factory(): Partial<SceneComponent<Inputs>> {
  let root: any
  let id = ''
  const disposables: any[] = []
  return {
    inputs: { id: '', items: [], hoverable: [], visible: true },
    outputs: {},
    onInit(this: SceneComponent<Inputs>) {
      const T = this.context.three as any
      root = new T.Group()
      const keep = <X>(x: X): X => {
        disposables.push(x)
        return x
      }

      const fabric = keep(new T.CanvasTexture(fabricCanvas()))
      fabric.wrapS = fabric.wrapT = T.RepeatWrapping
      fabric.repeat.set(2.5, 2.5) // geometry UVs are in metres: one fabric tile every 40 cm
      const shadowTex = keep(new T.CanvasTexture(shadowCanvas()))

      /**
       * Vertex colours: base colour x a shade from how much each face looks forward / up, so the
       * front reads light, the sides darker and the rounded edges blend between them.
       */
      const tint = (geo: any, hex: string, front: V3, up: V3) => {
        const base = new T.Color(hex)
        const nor = geo.attributes.normal
        const pos = geo.attributes.position
        geo.computeBoundingBox()
        const bb = geo.boundingBox
        const lo = bb.min.x * up[0] + bb.min.y * up[1] + bb.min.z * up[2]
        const hi = bb.max.x * up[0] + bb.max.y * up[1] + bb.max.z * up[2]
        const span = Math.abs(hi - lo) || 1
        const cols: number[] = []
        for (let i = 0; i < nor.count; i++) {
          const n: V3 = [nor.getX(i), nor.getY(i), nor.getZ(i)]
          const f = n[0] * front[0] + n[1] * front[1] + n[2] * front[2]
          const u = n[0] * up[0] + n[1] * up[1] + n[2] * up[2]
          // room light from above: the top of each face a little lighter than its bottom
          const t = ((pos.getX(i) * up[0] + pos.getY(i) * up[1] + pos.getZ(i) * up[2] - Math.min(lo, hi)) / span) * 2 - 1
          const k = Math.min(1.05, (0.5 + 0.42 * Math.max(0, f) + 0.12 * Math.max(0, u) - 0.12 * Math.max(0, -u)) * (0.9 + 0.1 * t))
          const lin = Math.pow(k, 2.2) // shades are perceptual; vertex colours are linear
          cols.push(base.r * lin, base.g * lin, base.b * lin)
        }
        geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3))
      }

      const solidMat = () =>
        // transparent (at full opacity) only so renderOrder puts it after the hidden pass
        keep(new T.MeshBasicMaterial({ vertexColors: true, map: fabric, transparent: true, opacity: 1 }))
      const hiddenFill = (color: string) =>
        keep(
          new T.MeshBasicMaterial({
            color: new T.Color(color),
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            depthFunc: T.GreaterDepth,
            polygonOffset: true, // pull toward the camera: only clearly hidden parts pass GREATER
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -4,
          }),
        )
      const hiddenLine = (color: string) =>
        keep(
          new T.LineDashedMaterial({
            color: new T.Color(color).lerp(new T.Color('#ffffff'), 0.55), // light, so it reads on dark furniture
            dashSize: 0.05,
            gapSize: 0.035,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            depthFunc: T.GreaterDepth,
          }),
        )
      const edgeMat = keep(new T.LineBasicMaterial({ color: '#1f2430', transparent: true, opacity: 0.35 }))
      const edgeHot = keep(new T.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1, depthTest: false }))
      const blockerFill = keep(new T.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.14, depthTest: false, depthWrite: false }))
      const blockerEdges = keep(new T.LineBasicMaterial({ color: '#f87171', depthTest: false, transparent: true, opacity: 0.95 }))
      const shadowMat = keep(
        new T.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -16,
        }),
      )

      /** Rounded slab centred on the origin: local x = width, y = height, z = thickness (front +z). */
      const slab = (w: number, h: number, d: number) => {
        const b = Math.min(0.008, d / 4, w / 6, h / 6) // bevel = rounded front/back edges
        const r = Math.min(0.025, (w - 2 * b) / 4, (h - 2 * b) / 4) // rounded corners
        const sw = (w - 2 * b) / 2
        const sh = (h - 2 * b) / 2
        const s = new T.Shape()
        s.moveTo(-sw + r, -sh)
        s.lineTo(sw - r, -sh)
        s.quadraticCurveTo(sw, -sh, sw, -sh + r)
        s.lineTo(sw, sh - r)
        s.quadraticCurveTo(sw, sh, sw - r, sh)
        s.lineTo(-sw + r, sh)
        s.quadraticCurveTo(-sw, sh, -sw, sh - r)
        s.lineTo(-sw, -sh + r)
        s.quadraticCurveTo(-sw, -sh, -sw + r, -sh)
        const depth = Math.max(0.002, d - 2 * b)
        const geo = new T.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 3 })
        geo.translate(0, 0, -depth / 2)
        return keep(geo)
      }

      /** Dashed rectangle w x h in the local plane z (the item's ideal outline). */
      const rect = (w: number, h: number, z: number) => {
        const x = w / 2
        const y = h / 2
        const p = [-x, -y, z, x, -y, z, x, -y, z, x, y, z, x, y, z, -x, y, z, -x, y, z, -x, -y, z]
        const g = new T.BufferGeometry()
        g.setAttribute('position', new T.Float32BufferAttribute(p, 3))
        return keep(g)
      }

      /** Orientation of an item: local z = its normal, local y = its "up", in SDK space. */
      const orient = (obj: any, it: PlacedItem, center?: V3) => {
        const z = toSdk(it.normal)
        const y = toSdk(it.up)
        const x = cross(y, z)
        obj.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(...x), new T.Vector3(...y), new T.Vector3(...z)))
        obj.position.set(...toSdk(center ?? it.center))
        return obj
      }

      interface Rec {
        group: any
        pick: any[]
        edges: any[]
        dashed: any[]
        blockers: any
        /** the item's 8 box corners in SDK space (the hover card sits beside their screen box) */
        corners: any[]
      }
      const recs = new Map<string, Rec>()
      const hoverable = new Set(this.inputs.hoverable)

      /** Add one solid piece (visible + hidden pass) to an item record. */
      const piece = (rec: Rec, geo: any, color: string, front: V3, up: V3, holder: any) => {
        tint(geo, color, front, up)
        const solid = new T.Mesh(geo, solidMat())
        solid.renderOrder = 12
        const ghost = new T.Mesh(geo, hiddenFill(color))
        ghost.renderOrder = 10
        const e = new T.LineSegments(keep(new T.EdgesGeometry(geo, 35)), edgeMat)
        e.renderOrder = 13
        holder.add(ghost, solid, e)
        rec.pick.push(solid)
        rec.edges.push(e)
      }
      const dashedOf = (rec: Rec, geo: any, color: string, holder: any) => {
        const l = new T.LineSegments(geo, hiddenLine(color))
        l.computeLineDistances()
        l.renderOrder = 11
        holder.add(l)
        rec.dashed.push(l)
      }

      for (const it of this.inputs.items) {
        const color = ITEM_COLORS[it.product_id] ?? '#7a7f88'
        const group = new T.Group()
        const rec: Rec = { group, pick: [], edges: [], dashed: [], blockers: new T.Group(), corners: [] }
        const front = toSdk(it.normal)
        const upDir = toSdk(it.up)
        const xDir = cross(upDir, front)
        const c = toSdk(it.center)
        for (const sx of [-1, 1])
          for (const sy of [-1, 1])
            for (const sz of [-1, 1]) {
              const p = [0, 1, 2].map((k) => c[k] + (sx * xDir[k] * it.width_m + sy * upDir[k] * it.height_m + sz * front[k] * it.depth_m) / 2)
              rec.corners.push(new T.Vector3(...p))
            }

        if (it.product_id === 'bass_trap') {
          // Triangular prism filling the corner: apex in the corner, front face across it.
          const [cx, cy] = it.center
          const [nx, ny] = it.normal
          const apex: [number, number] = [cx - (nx * it.depth_m) / 2, cy - (ny * it.depth_m) / 2]
          const leg = it.width_m / Math.SQRT2
          const rot = (a: number): [number, number] => [nx * Math.cos(a) - ny * Math.sin(a), nx * Math.sin(a) + ny * Math.cos(a)]
          const [ax, ay] = rot(Math.PI / 4)
          const [bx, by] = rot(-Math.PI / 4)
          const shape = new T.Shape()
          shape.moveTo(apex[0], apex[1])
          shape.lineTo(apex[0] + ax * leg, apex[1] + ay * leg)
          shape.lineTo(apex[0] + bx * leg, apex[1] + by * leg)
          shape.lineTo(apex[0], apex[1])
          const geo = keep(new T.ExtrudeGeometry(shape, { depth: it.height_m - 0.02, bevelEnabled: false }))
          geo.rotateX(-Math.PI / 2) // shape (x, y) -> sdk (x, ., -y); extrusion -> +y
          const holder = new T.Group()
          holder.position.y = it.center[2] - it.height_m / 2 + 0.01
          piece(rec, geo, color, front, [0, 1, 0], holder)
          dashedOf(rec, keep(new T.EdgesGeometry(geo)), color, holder)
          group.add(holder)
        } else if (it.product_id === 'diffuser_qrd') {
          // Quadratic-residue diffuser, N = 7: well depths (n^2 mod 7) / 4 of the item depth.
          const holder = orient(new T.Group(), it)
          const back = keep(new T.BoxGeometry(it.width_m, it.height_m, 0.02))
          back.translate(0, 0, -it.depth_m / 2 + 0.01)
          piece(rec, back, '#6f4b2c', [0, 0, 1], [0, 1, 0], holder)
          const well = it.width_m / 7
          for (let k = 0; k < 7; k++) {
            const depth = Math.max(0.02, it.depth_m - (((k * k) % 7) / 4) * it.depth_m)
            const g = keep(new T.BoxGeometry(well * 0.92, it.height_m, depth))
            g.translate((k - 3) * well, 0, -it.depth_m / 2 + depth / 2)
            piece(rec, g, color, [0, 0, 1], [0, 1, 0], holder)
          }
          dashedOf(rec, rect(it.width_m, it.height_m, it.depth_m / 2), color, holder)
          group.add(holder)
        } else {
          const holder = orient(new T.Group(), it)
          piece(rec, slab(it.width_m, it.height_m, it.depth_m), color, [0, 0, 1], [0, 1, 0], holder)
          dashedOf(rec, rect(it.width_m, it.height_m, it.depth_m / 2), color, holder)
          // contact shadow on the wall just behind the panel, a little below it (light from above)
          const sh = new T.Mesh(keep(new T.PlaneGeometry(it.width_m + 0.22, it.height_m + 0.22)), shadowMat)
          sh.position.set(0.015, -0.04, -it.depth_m / 2 + 0.01)
          sh.renderOrder = 9
          holder.add(sh)
          group.add(holder)
        }

        // furniture / wall objects in the way: outlined only while this item is hovered
        for (const b of it.blocked_by ?? []) {
          const [x0, y0, z0] = b.min
          const [x1, y1, z1] = b.max
          const geo = keep(new T.BoxGeometry(Math.max(0.02, x1 - x0), Math.max(0.02, z1 - z0), Math.max(0.02, y1 - y0)))
          const box = new T.Mesh(geo, blockerFill)
          box.position.set(...toSdk([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]))
          box.renderOrder = 15
          const edges = new T.LineSegments(keep(new T.EdgesGeometry(geo)), blockerEdges)
          edges.renderOrder = 16
          box.add(edges)
          rec.blockers.add(box)
        }
        rec.blockers.visible = false
        group.add(rec.blockers)
        root.add(group)
        recs.set(it.key, rec)
      }

      let hot: string | null = null
      const raycaster = new T.Raycaster()
      const ctx = this.context
      const api: Api = {
        pick(x, y, w, h) {
          if (!root.visible || !ctx.camera || !w || !h) return null
          raycaster.setFromCamera(new T.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), ctx.camera)
          const meshes: any[] = []
          const owner = new Map<any, string>()
          for (const [key, r] of recs) {
            if (!hoverable.has(key)) continue
            for (const m of r.pick) {
              meshes.push(m)
              owner.set(m, key)
            }
          }
          const hit = raycaster.intersectObjects(meshes, false)[0]
          return hit ? (owner.get(hit.object) ?? null) : null
        },
        highlight(key) {
          if (key === hot) return
          for (const [k, r] of recs) {
            const on = k === key
            for (const e of r.edges) {
              e.material = on ? edgeHot : edgeMat
              e.renderOrder = on ? 30 : 13
            }
            for (const d of r.dashed) d.material.opacity = on ? 1 : 0.9
            r.blockers.visible = on
          }
          hot = key
        },
        project(key, w, h) {
          const r = recs.get(key)
          if (!r || !ctx.camera) return null
          const b: Box2 = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
          for (const v of r.corners) {
            const p = v.clone().project(ctx.camera)
            if (p.z > 1 || p.z < -1) return null // a corner behind the camera: no card
            const x = ((p.x + 1) / 2) * w
            const y = ((1 - p.y) / 2) * h
            b.minX = Math.min(b.minX, x)
            b.maxX = Math.max(b.maxX, x)
            b.minY = Math.min(b.minY, y)
            b.maxY = Math.max(b.maxY, y)
          }
          // camera not ready yet (matrices NaN): no card rather than a NaN position
          return [b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite) ? b : null
        },
      }
      root.visible = this.inputs.visible
      this.outputs.objectRoot = root
      apis.set(this.inputs.id, api)
      id = this.inputs.id
    },
    onInputsUpdated(this: SceneComponent<Inputs>) {
      if (root) root.visible = this.inputs.visible
    },
    onDestroy() {
      apis.delete(id)
      for (const d of disposables) d.dispose?.()
    },
  }
}

export interface TreatmentScene {
  setVisible(on: boolean): void
  /**
   * Render one frame of the Showcase scene (scan + treatment objects) and read it back as a
   * JPEG data URI. Renderer.takeScreenShot leaves custom Scene objects out, so this renders with
   * the scene's own renderer and camera and reads the canvas before the browser clears it.
   */
  capture(withTreatment: boolean): string | null
  /** Called with the hovered item's key (or null) as the pointer moves over the 3D view. */
  onHover(cb: (key: string | null) => void): void
  /** Brighter edges and its blockers for one item (null clears). */
  highlight(key: string | null): void
  /** Item's on-screen box in CSS pixels; null if off screen. */
  project(key: string): Box2 | null
  dispose(): void
}

const registered = new WeakSet<MpSdk>()

export async function createTreatmentScene(sdk: MpSdk, items: PlacedItem[], hoverable: string[] = []): Promise<TreatmentScene | null> {
  if (!sdk.Scene) return null
  if (!registered.has(sdk)) {
    await sdk.Scene.register(COMPONENT, factory as () => Partial<SceneComponent>)
    registered.add(sdk)
  }
  const [obj]: SceneObject[] = await sdk.Scene.createObjects(1)
  const id = `t${++nextId}`
  const comp = obj.addNode().addComponent<Inputs>(COMPONENT, { id, items, hoverable, visible: true })
  obj.start()
  // Dev-only handle for inspecting the three.js objects from the browser console.
  const api = () => apis.get(id)
  if (import.meta.env.DEV) Object.assign(window, { __reverbTreatComp: comp, __reverbTreatApi: api })
  const canvas = () => comp.context.renderer?.domElement as HTMLCanvasElement | undefined

  // Hover: the canvas lives in the showcase iframe (same origin, self-hosted bundle), and
  // Matterport's UI layers sit over it, so listen on the iframe's document.
  let listener: ((key: string | null) => void) | null = null
  let last: string | null = null
  let frame = 0
  let pending: PointerEvent | null = null
  const onMove = (e: PointerEvent) => {
    pending = e
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const c = canvas()
      const ev = pending
      if (!c || !ev || !listener) return
      const r = c.getBoundingClientRect()
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      const key = inside ? (api()?.pick(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height) ?? null) : null
      if (key !== last) {
        last = key
        listener(key)
      }
    })
  }
  const onLeave = () => {
    if (last !== null) {
      last = null
      listener?.(null)
    }
  }
  const doc = canvas()?.ownerDocument
  doc?.addEventListener('pointermove', onMove, true)
  doc?.documentElement.addEventListener('pointerleave', onLeave)

  return {
    setVisible(on) {
      comp.inputs.visible = on
    },
    capture(withTreatment) {
      const { renderer, scene, camera } = comp.context
      const root = comp.outputs.objectRoot
      if (!renderer || !scene || !camera || !root) return null
      const was = root.visible
      root.visible = withTreatment // set directly: input changes only apply on the next SDK tick
      renderer.render(scene, camera)
      const uri = renderer.domElement.toDataURL('image/jpeg', 0.92) as string
      root.visible = was
      return uri
    },
    onHover(cb) {
      listener = cb
    },
    highlight(key) {
      api()?.highlight(key)
    },
    project(key) {
      const c = canvas()
      const root = comp.outputs.objectRoot
      if (!c || !root?.visible) return null
      return api()?.project(key, c.clientWidth, c.clientHeight) ?? null
    },
    dispose() {
      cancelAnimationFrame(frame)
      doc?.removeEventListener('pointermove', onMove, true)
      doc?.documentElement.removeEventListener('pointerleave', onLeave)
      listener = null
      try {
        obj.stop()
      } catch {
        /* sdk gone */
      }
    },
  }
}

/**
 * Model-space heading (CCW from +x) -> Showcase camera rotation.y. three.js cameras look down -z;
 * rotation.y turns them CCW seen from above, so heading = rotation.y + 90 deg.
 */
export const sdkYaw = (modelYawDeg: number) => modelYawDeg - 90

/** Fly to the chosen scan position and face the chosen heading. Only real scan positions. */
export async function goToViewpoint(sdk: MpSdk, vp: Viewpoint, instant = false) {
  const rotation = { x: vp.pitch_deg, y: sdkYaw(vp.yaw_deg) }
  // Showcase rejects a move while another transition is running (e.g. a previous call, or the
  // opening fly-in): wait and retry a few times before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      await sdk.Sweep.moveTo(vp.scan_id, {
        rotation,
        transition: instant ? sdk.Sweep.Transition.INSTANT : sdk.Sweep.Transition.FLY,
        transitionTime: 1500,
      })
      await sdk.Camera.setRotation(rotation, { speed: 200 })
      return
    } catch (e) {
      if (attempt >= 4) throw e instanceof Error && e.message ? e : new Error('the tour would not move to the chosen scan position')
      await new Promise((r) => setTimeout(r, 800))
    }
  }
}
