import type { TourLayout } from '../../types'
import { roomFloorHeight } from './geometry'
import type { MpSdk, SceneComponent, SceneObject } from './sdkTypes'

/**
 * Translucent acoustic tint on each room's floor, drawn with the Bundle SDK's Scene API.
 *
 * Geometry is the room's wall-centreline polygon from the Matterport Model API, converted to
 * SDK space with sdk (x, y, z) = model (x, z, -y). Verified on zvKHR9DHNjJ: tints stop at the
 * doorways and are hidden behind furniture (the scan mesh depth-tests them).
 * The selected room also gets a low band along its walls ("skirting") so it stands out.
 * One colour per room: this is a room-level value, not a point-by-point field.
 */

export interface RoomPaint {
  color: string
  selected: boolean
  /** Hidden while the acoustic field heatmap is shown. */
  hidden?: boolean
}

interface Inputs {
  polygon: number[][]
  floorY: number
  color: string
  selected: boolean
  hidden: boolean
}

const COMPONENT = 'reverb.roomTint'
const FILL_OPACITY = 0.38
const FILL_OPACITY_SELECTED = 0.58
const SKIRT_HEIGHT = 0.12
const LIFT = 0.015 // above the scanned floor to avoid z-fighting

function tintFactory(): Partial<SceneComponent<Inputs>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fillMat: any, skirtMat: any, skirt: any, fill: any
  return {
    inputs: { polygon: [], floorY: 0, color: '#888888', selected: false, hidden: false },
    outputs: {},
    onInit(this: SceneComponent<Inputs>) {
      const T = this.context.three
      const { polygon, floorY } = this.inputs
      const group = new T.Group()

      const shape = new T.Shape()
      shape.moveTo(polygon[0][0], polygon[0][1])
      for (const [x, y] of polygon.slice(1)) shape.lineTo(x, y)
      const fillGeo = new T.ShapeGeometry(shape)
      fillGeo.rotateX(-Math.PI / 2) // shape (x, y) -> world (x, 0, -y)
      fillMat = new T.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
      fill = new T.Mesh(fillGeo, fillMat)
      fill.position.y = floorY + LIFT
      fill.renderOrder = 1
      group.add(fill)

      const pos: number[] = []
      polygon.forEach(([x0, y0], i) => {
        const [x1, y1] = polygon[(i + 1) % polygon.length]
        const a = [x0, floorY, -y0]
        const b = [x1, floorY, -y1]
        const a2 = [x0, floorY + SKIRT_HEIGHT, -y0]
        const b2 = [x1, floorY + SKIRT_HEIGHT, -y1]
        pos.push(...a, ...b, ...b2, ...a, ...b2, ...a2)
      })
      const skirtGeo = new T.BufferGeometry()
      skirtGeo.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
      skirtMat = new T.MeshBasicMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, opacity: 0.75 })
      skirt = new T.Mesh(skirtGeo, skirtMat)
      skirt.renderOrder = 2
      group.add(skirt)

      this.outputs.objectRoot = group
      this.onInputsUpdated?.(this.inputs)
    },
    onInputsUpdated(this: SceneComponent<Inputs>) {
      if (!fillMat) return
      const T = this.context.three
      fillMat.color = new T.Color(this.inputs.color)
      fillMat.opacity = this.inputs.selected ? FILL_OPACITY_SELECTED : FILL_OPACITY
      skirtMat.color = new T.Color(this.inputs.color)
      fill.visible = !this.inputs.hidden
      skirt.visible = this.inputs.selected && !this.inputs.hidden
    },
    onDestroy() {
      fillMat?.dispose?.()
      skirtMat?.dispose?.()
    },
  }
}

export interface OverlayController {
  paint(paints: Record<string, RoomPaint>): void
  dispose(): void
}

const registered = new WeakSet<MpSdk>()

export async function createRoomOverlay(sdk: MpSdk, layout: TourLayout): Promise<OverlayController | null> {
  const scene = sdk.Scene
  if (!scene) return null // Embed SDK: no Scene API
  if (!registered.has(sdk)) {
    await scene.register(COMPONENT, tintFactory as () => Partial<SceneComponent>)
    registered.add(sdk)
  }
  const rooms = layout.rooms.filter((r) => r.polygon && r.polygon.length >= 3)
  const [obj]: SceneObject[] = await scene.createObjects(1)
  const comps = new Map<string, SceneComponent<Inputs>>()
  for (const r of rooms) {
    const node = obj.addNode()
    comps.set(
      r.room_id,
      node.addComponent<Inputs>(COMPONENT, {
        polygon: r.polygon!,
        floorY: roomFloorHeight(r, layout),
        color: '#71717a',
        selected: false,
        hidden: false,
      }),
    )
  }
  obj.start()
  let disposed = false
  return {
    paint(paints) {
      if (disposed) return
      for (const [id, comp] of comps) {
        const p = paints[id]
        if (!p) continue
        if (comp.inputs.color !== p.color) comp.inputs.color = p.color
        if (comp.inputs.selected !== p.selected) comp.inputs.selected = p.selected
        if (comp.inputs.hidden !== !!p.hidden) comp.inputs.hidden = !!p.hidden
      }
    },
    dispose() {
      disposed = true
      try {
        obj.stop()
      } catch {
        /* sdk already gone */
      }
    },
  }
}
