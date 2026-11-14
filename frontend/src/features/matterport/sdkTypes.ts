// Narrow hand-written types for the parts of the Matterport Showcase SDK Reverb uses.
// Checked against sdk.d.ts shipped in the bundle (26.5.4). Kept small on purpose: add a member
// here only after confirming it in sdk.d.ts or in the running viewer.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Subscription {
  cancel(): void
}

export interface Observable<T> {
  subscribe(cb: (value: T) => void): Subscription
}

export interface CollectionObserver<T> {
  onCollectionUpdated(collection: Record<string, T>): void
}

export interface SweepCurrent {
  sid: string
  roomInfo?: { id?: string }
  floorInfo?: { id?: string; sequence?: number }
  position: Vec3
}

export interface RoomCurrent {
  rooms: { id: string; label?: string }[]
}

export interface CameraPose {
  position: Vec3
  rotation: { x: number; y: number }
  sweep: string
  mode: string
}

export type ModeValue =
  | 'mode.inside'
  | 'mode.outside'
  | 'mode.dollhouse'
  | 'mode.floorplan'
  | 'mode.transitioning'

export interface AppState {
  phase: string
}

// --- Scene (Bundle SDK only) -------------------------------------------------------------
// `three` is the bundle's own three.js instance; Reverb has no three dependency. Only the
// constructors used by overlay.ts are listed.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ThreeLike {
  Group: new () => any
  Mesh: new (geometry: any, material: any) => any
  Shape: new () => any
  ShapeGeometry: new (shape: any) => any
  BufferGeometry: new () => any
  Float32BufferAttribute: new (array: number[], itemSize: number) => any
  MeshBasicMaterial: new (params: Record<string, unknown>) => any
  Color: new (hex: string) => any
  DoubleSide: number
}

export interface SceneComponent<I = Record<string, unknown>> {
  inputs: I
  outputs: { objectRoot?: any }
  context: { three: ThreeLike; renderer?: any; scene?: any; camera?: any }
  onInit?(): void
  onInputsUpdated?(previous: I): void
  onDestroy?(): void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SceneNode {
  addComponent<I>(name: string, inputs?: Partial<I>): SceneComponent<I>
}

export interface SceneObject {
  addNode(): SceneNode
  start(): void
  stop(): void
}

export interface SceneApi {
  register(name: string, factory: () => Partial<SceneComponent>): Promise<{ dispose(): void } | null>
  createObjects(count: number): Promise<SceneObject[]>
}

export interface MpSdk {
  App: { state: Observable<AppState> }
  Sweep: {
    current: Observable<SweepCurrent>
    moveTo(
      sid: string,
      options?: { transition?: string; transitionTime?: number; rotation?: { x: number; y: number } },
    ): Promise<string>
    Transition: { FLY: string; INSTANT: string; FADEOUT: string }
  }
  Room: { current: Observable<RoomCurrent> }
  Mode: {
    current: Observable<ModeValue>
    moveTo(mode: string): Promise<string>
    Mode: { INSIDE: string; DOLLHOUSE: string; FLOORPLAN: string }
  }
  Camera: {
    pose: Observable<CameraPose>
    setRotation(rotation: { x: number; y: number }, options?: { speed?: number }): Promise<void>
  }
  Renderer: {
    /** JPEG data URI; with no visibility argument, tags and sweep markers are hidden. */
    takeScreenShot(resolution?: { width: number; height: number }): Promise<string>
  }
  Scene?: SceneApi
  disconnect?(): void
}

/** contentWindow of the self-hosted showcase.html (same origin). */
export interface BundleWindow {
  MP_SDK?: { connect(target: unknown): Promise<MpSdk> }
}

declare global {
  interface Window {
    MP_SDK?: {
      connect(target: HTMLIFrameElement, key: string, version: string): Promise<MpSdk>
    }
  }
}
