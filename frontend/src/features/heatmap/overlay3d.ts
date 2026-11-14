import type { MpSdk, SceneComponent, SceneObject } from '../matterport/sdkTypes'

/**
 * The acoustic field as a continuous, coloured relief surface inside each room (Bundle SDK
 * Scene API). Built from `buildFieldMesh` (already in SDK space). Drawn without depth testing so
 * furniture in the scan cannot hide it in dollhouse view; markers show the sound source and the
 * best spot.
 */

export interface FieldMeshInput {
  positions: number[]
  colors: number[]
  markers: { x: number; y: number; z: number; color: string; size: number }[]
}

interface Inputs {
  data: FieldMeshInput
  visible: boolean
}

const COMPONENT = 'reverb.acousticField'
const OPACITY = 0.82

function fieldFactory(): Partial<SceneComponent<Inputs>> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let group: any, mesh: any, mat: any
  const markers: any[] = []
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    inputs: { data: { positions: [], colors: [], markers: [] }, visible: true },
    outputs: {},
    onInit(this: SceneComponent<Inputs>) {
      const T = this.context.three
      group = new T.Group()
      mat = new T.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: OPACITY,
        side: T.DoubleSide,
        depthWrite: false,
        depthTest: false,
      })
      mesh = new T.Mesh(new T.BufferGeometry(), mat)
      mesh.renderOrder = 10
      group.add(mesh)
      this.outputs.objectRoot = group
      this.onInputsUpdated?.(this.inputs)
    },
    onInputsUpdated(this: SceneComponent<Inputs>) {
      if (!group) return
      const T = this.context.three
      const { data, visible } = this.inputs
      group.visible = visible
      const geo = new T.BufferGeometry()
      geo.setAttribute('position', new T.Float32BufferAttribute(data.positions, 3))
      geo.setAttribute('color', new T.Float32BufferAttribute(data.colors, 3))
      mesh.geometry?.dispose?.()
      mesh.geometry = geo
      for (const m of markers.splice(0)) {
        group.remove(m)
        m.geometry?.dispose?.()
        m.material?.dispose?.()
      }
      for (const mk of data.markers) {
        const shape = new T.Shape()
        shape.absarc(0, 0, mk.size, 0, Math.PI * 2, false)
        const g = new T.ShapeGeometry(shape)
        g.rotateX(-Math.PI / 2)
        const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: new T.Color(mk.color), depthTest: false, transparent: true, side: T.DoubleSide }))
        m.position.set(mk.x, mk.y, mk.z)
        m.renderOrder = 11
        group.add(m)
        markers.push(m)
      }
    },
    onDestroy() {
      mesh?.geometry?.dispose?.()
      mat?.dispose?.()
    },
  }
}

export interface FieldOverlay {
  update(rooms: Record<string, FieldMeshInput>): void
  setVisible(on: boolean): void
  dispose(): void
}

const registered = new WeakSet<MpSdk>()

export async function createFieldOverlay(sdk: MpSdk): Promise<FieldOverlay | null> {
  const scene = sdk.Scene
  if (!scene) return null // Embed SDK: no Scene API; the 2D plan shows the heatmap instead
  if (!registered.has(sdk)) {
    await scene.register(COMPONENT, fieldFactory as () => Partial<SceneComponent>)
    registered.add(sdk)
  }
  const [obj]: SceneObject[] = await scene.createObjects(1)
  const comps = new Map<string, SceneComponent<Inputs>>()
  let visible = true
  let started = false
  let disposed = false
  return {
    update(rooms) {
      if (disposed) return
      for (const [id, data] of Object.entries(rooms)) {
        let c = comps.get(id)
        if (!c) {
          if (started) continue // Scene objects take nodes only before start(); see dispose/recreate
          c = obj.addNode().addComponent<Inputs>(COMPONENT, { data, visible })
          comps.set(id, c)
        } else {
          c.inputs.data = data
        }
      }
      if (!started && comps.size) {
        obj.start()
        started = true
      }
    },
    setVisible(on) {
      visible = on
      for (const c of comps.values()) c.inputs.visible = on
    },
    dispose() {
      disposed = true
      try {
        obj.stop()
      } catch {
        /* sdk gone */
      }
    },
  }
}
