import type { MpSdk, SceneComponent, SceneObject } from '../matterport/sdkTypes'
import { ITEM_COLORS } from './colors'
import type { PlacedItem, Viewpoint } from './types'

/**
 * The treatment plan, built as 3D objects inside the Matterport scan (Bundle SDK Scene API).
 *
 * Every object sits at the coordinates the backend calculated (model space, z up), converted
 * with sdk (x, y, z) = model (x, z, -y). The scan's depth hides objects behind furniture, so
 * the picture is the real room with the planned treatment, not an illustration of it.
 * No lights are added: faces get fixed shades so the boxes read as solid without changing the
 * scan's own lighting.
 */

type V3 = [number, number, number]
const toSdk = ([x, y, z]: V3): V3 => [x, z, -y]

const COLORS = ITEM_COLORS
/** Fixed shade per face direction (local axes: z = front, y = up): reads as solid, unlit. */
function shadeFor(nx: number, ny: number, nz: number): number {
  if (nz > 0.5) return 1.0
  if (nz < -0.5) return 0.55
  if (ny > 0.5) return 0.88
  if (ny < -0.5) return 0.5
  return nx > 0 ? 0.74 : 0.66
}

interface Inputs {
  items: PlacedItem[]
  visible: boolean
}

const COMPONENT = 'reverb.treatment'

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function factory(): Partial<SceneComponent<Inputs>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let root: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disposables: any[] = []
  return {
    inputs: { items: [], visible: true },
    outputs: {},
    onInit(this: SceneComponent<Inputs>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const T = this.context.three as any
      root = new T.Group()
      /** Vertex colours: face shade x a soft top-to-bottom gradient (fabric under room light). */
      const shaded = (geo: any, hex: string, h: number) => {
        const base = new T.Color(hex)
        const pos = geo.attributes.position
        const nor = geo.attributes.normal
        const cols: number[] = []
        for (let i = 0; i < pos.count; i++) {
          const k = shadeFor(nor.getX(i), nor.getY(i), nor.getZ(i)) * (0.86 + 0.14 * (pos.getY(i) / h + 0.5))
          cols.push(base.r * k, base.g * k, base.b * k)
        }
        geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3))
        const m = new T.MeshBasicMaterial({ vertexColors: true })
        disposables.push(m)
        return m
      }
      const edges = new T.LineBasicMaterial({ color: '#9ca3af', transparent: true, opacity: 0.55 })
      disposables.push(edges)

      /** A box whose local z is the item's normal and local y its "up", in SDK space. */
      const orientedBox = (it: PlacedItem, w: number, h: number, d: number, color: string, center?: V3) => {
        const geo = new T.BoxGeometry(w, h, d)
        disposables.push(geo)
        const mesh = new T.Mesh(geo, shaded(geo, color, h))
        const z = toSdk(it.normal)
        const y = toSdk(it.up)
        const x = cross(y, z)
        const m = new T.Matrix4().makeBasis(new T.Vector3(...x), new T.Vector3(...y), new T.Vector3(...z))
        mesh.quaternion.setFromRotationMatrix(m)
        mesh.position.set(...toSdk(center ?? it.center))
        const line = new T.LineSegments(new T.EdgesGeometry(geo), edges)
        mesh.add(line)
        return mesh
      }

      /**
       * X-ray: a blocked item is drawn through whatever is in front of it (depth test off,
       * see-through, orange edges), and the furniture in the way gets a translucent red box, so
       * the picture shows where the panel belongs and what to move.
       */
      const xrayEdges = new T.LineBasicMaterial({ color: '#fb923c', depthTest: false, transparent: true })
      disposables.push(xrayEdges)
      const xray = (obj: any) =>
        obj.traverse((o: any) => {
          o.renderOrder = 20
          if (o.isLineSegments) o.material = xrayEdges
          else if (o.material) {
            o.material = o.material.clone()
            Object.assign(o.material, { transparent: true, opacity: 0.55, depthTest: false, depthWrite: false })
            disposables.push(o.material)
          }
        })
      const blockerFill = new T.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.16, depthTest: false, depthWrite: false })
      const blockerEdges = new T.LineBasicMaterial({ color: '#f87171', depthTest: false, transparent: true, opacity: 0.9 })
      disposables.push(blockerFill, blockerEdges)
      const shownBlockers = new Set<string>()
      for (const it of this.inputs.items) {
        for (const b of it.blocked_by ?? []) {
          if (shownBlockers.has(b.id)) continue
          shownBlockers.add(b.id)
          const [x0, y0, z0] = b.min
          const [x1, y1, z1] = b.max
          const geo = new T.BoxGeometry(Math.max(0.02, x1 - x0), Math.max(0.02, z1 - z0), Math.max(0.02, y1 - y0))
          disposables.push(geo)
          const box = new T.Mesh(geo, blockerFill)
          box.position.set(...toSdk([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]))
          box.renderOrder = 15
          const edges = new T.LineSegments(new T.EdgesGeometry(geo), blockerEdges)
          edges.renderOrder = 16
          box.add(edges)
          root.add(box)
        }
      }
      for (const it of this.inputs.items) {
        const before = root.children.length
        const color = COLORS[it.product_id] ?? '#555'
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
          const geo = new T.ExtrudeGeometry(shape, { depth: it.height_m - 0.02, bevelEnabled: false })
          geo.rotateX(-Math.PI / 2) // shape (x, y) -> sdk (x, ., -y); extrusion -> +y
          disposables.push(geo)
          const mat = new T.MeshBasicMaterial({ color: new T.Color(color) })
          disposables.push(mat)
          const mesh = new T.Mesh(geo, mat)
          mesh.position.y = it.center[2] - it.height_m / 2 + 0.01
          mesh.add(new T.LineSegments(new T.EdgesGeometry(geo), edges))
          root.add(mesh)
        } else if (it.product_id === 'diffuser_qrd') {
          // Quadratic-residue diffuser, N = 7: well depths (n^2 mod 7) / 4 x 150 mm.
          const g = new T.Group()
          const well = it.width_m / 7
          const n = it.normal
          const x = cross(toSdk(it.up), toSdk(n))
          const back = it.center.map((c, i) => c - (n[i] * it.depth_m) / 2) as V3
          const backSdk = toSdk(back)
          g.add(orientedBox(it, it.width_m, it.height_m, 0.02, '#7a5534', [back[0] + n[0] * 0.01, back[1] + n[1] * 0.01, back[2]]))
          for (let k = 0; k < 7; k++) {
            const depth = Math.max(0.02, it.depth_m - (((k * k) % 7) / 4) * it.depth_m)
            const off = (k - 3) * well
            const c: V3 = [
              backSdk[0] + x[0] * off,
              backSdk[1] + x[1] * off,
              backSdk[2] + x[2] * off,
            ]
            const nSdk = toSdk(n)
            const centerSdk: V3 = [c[0] + (nSdk[0] * depth) / 2, c[1] + (nSdk[1] * depth) / 2, c[2] + (nSdk[2] * depth) / 2]
            const box = orientedBox(it, well * 0.92, it.height_m, depth, color)
            box.position.set(...centerSdk)
            g.add(box)
          }
          root.add(g)
        } else {
          root.add(orientedBox(it, it.width_m, it.height_m, it.depth_m, color))
        }
        if (it.status === 'blocked') for (const o of root.children.slice(before)) xray(o)
      }
      root.visible = this.inputs.visible
      this.outputs.objectRoot = root
    },
    onInputsUpdated(this: SceneComponent<Inputs>) {
      if (root) root.visible = this.inputs.visible
    },
    onDestroy() {
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
  dispose(): void
}

const registered = new WeakSet<MpSdk>()

export async function createTreatmentScene(sdk: MpSdk, items: PlacedItem[]): Promise<TreatmentScene | null> {
  if (!sdk.Scene) return null
  if (!registered.has(sdk)) {
    await sdk.Scene.register(COMPONENT, factory as () => Partial<SceneComponent>)
    registered.add(sdk)
  }
  const [obj]: SceneObject[] = await sdk.Scene.createObjects(1)
  const comp = obj.addNode().addComponent<Inputs>(COMPONENT, { items, visible: true })
  obj.start()
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
    dispose() {
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
