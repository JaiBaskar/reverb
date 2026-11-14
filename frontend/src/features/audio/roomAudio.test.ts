import { describe, expect, it, vi } from 'vitest'
import { CROSSFADE_S, RoomPlayer } from './roomPlayer'
import { createRoomSwitcher, type SwitchState } from './roomSwitcher'

// ---------------------------------------------------------------------------------------
// Minimal fake Web Audio graph: records starts, connections and scheduled gain values.
class FakeParam {
  value = 1
  events: [string, number, number][] = []
  cancelScheduledValues() {}
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t])
    this.value = v
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['ramp', v, t])
    this.value = v // fake: jump to the target
  }
}
class FakeNode {
  outputs: FakeNode[] = []
  disconnected = false
  kind: string
  constructor(kind: string) {
    this.kind = kind
  }
  connect<T extends FakeNode>(n: T): T {
    this.outputs.push(n)
    return n
  }
  disconnect() {
    this.disconnected = true
    this.outputs = []
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam()
  constructor() {
    super('gain')
  }
}
class FakeConvolver extends FakeNode {
  normalize = true
  normalizeWhenBufferSet: boolean | null = null
  private _buffer: unknown = null
  constructor() {
    super('convolver')
  }
  set buffer(b: unknown) {
    this.normalizeWhenBufferSet = this.normalize
    this._buffer = b
  }
  get buffer() {
    return this._buffer
  }
}
class FakeSource extends FakeNode {
  buffer: unknown = null
  loop = false
  starts: [number, number][] = []
  stopped = 0
  constructor() {
    super('source')
  }
  start(when: number, offset: number) {
    this.starts.push([when, offset])
  }
  stop() {
    this.stopped++
  }
}
class FakeCtx {
  currentTime = 0
  destination = new FakeNode('destination')
  sources: FakeSource[] = []
  convolvers: FakeConvolver[] = []
  createGain() {
    return new FakeGain()
  }
  createConvolver() {
    const c = new FakeConvolver()
    this.convolvers.push(c)
    return c
  }
  createBufferSource() {
    const s = new FakeSource()
    this.sources.push(s)
    return s
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode('comp'), {
      threshold: new FakeParam(),
      ratio: new FakeParam(),
      knee: new FakeParam(),
    })
  }
}

const buf = (duration: number) => ({ duration }) as AudioBuffer
const setup = () => {
  const ctx = new FakeCtx()
  const player = new RoomPlayer(ctx as unknown as BaseAudioContext)
  return { ctx, player }
}

describe('RoomPlayer', () => {
  it('switching rooms keeps one source and one playhead', () => {
    vi.useFakeTimers()
    const { ctx, player } = setup()
    const dry = buf(10)
    player.load(dry)
    player.setRoom(buf(1), 0.5)
    player.play()
    ctx.currentTime = 3.2
    player.setRoom(buf(1.5), 0.7)
    ctx.currentTime = 4
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].starts).toEqual([[0, 0]])
    expect(ctx.sources[0].stopped).toBe(0)
    expect(player.position()).toBeCloseTo(4)
    expect(ctx.sources[0].buffer).toBe(dry) // the original take is what plays
    vi.useRealTimers()
  })

  it('crossfades the old room out and the new one in, then disconnects the old chain', () => {
    vi.useFakeTimers()
    const { ctx, player } = setup()
    player.load(buf(10))
    player.setRoom(buf(1), 1)
    player.play()
    ctx.currentTime = 2
    player.setRoom(buf(1), 1)
    const [oldConv, newConv] = ctx.convolvers
    const oldGain = oldConv.outputs[0] as FakeGain
    const newGain = newConv.outputs[0] as FakeGain
    expect(oldGain.gain.events.at(-1)).toEqual(['ramp', 0, 2 + CROSSFADE_S])
    expect(newGain.gain.events.at(-1)).toEqual(['ramp', 1, 2 + CROSSFADE_S])
    expect(oldConv.disconnected).toBe(false)
    vi.advanceTimersByTime((CROSSFADE_S + 0.1) * 1000)
    expect(oldConv.disconnected).toBe(true)
    expect(newConv.disconnected).toBe(false)
    vi.useRealTimers()
  })

  it('sets convolver normalize=false before assigning the IR', () => {
    const { ctx, player } = setup()
    player.load(buf(5))
    player.setRoom(buf(1))
    player.play()
    expect(ctx.convolvers[0].normalizeWhenBufferSet).toBe(false)
  })

  it('original / room / wet-dry targets', () => {
    const { player } = setup()
    player.load(buf(5))
    player.setRoom(buf(1), 0.5)
    player.setMix({ listen: 'room', wet: 0.8, volume: 0.6 })
    expect(player.targets()).toEqual({ dry: expect.closeTo(0.2), room: 0.4, volume: 0.6 })
    player.setMix({ listen: 'dry' })
    expect(player.targets()).toMatchObject({ dry: 1, room: 0 })
    player.setMix({ listen: 'room' })
    player.setRoom(null)
    expect(player.targets()).toMatchObject({ dry: 1, room: 0 }) // no model: never silent
  })

  it('pause/play resumes from the same position; seek moves it', () => {
    const { ctx, player } = setup()
    player.load(buf(10))
    player.play()
    ctx.currentTime = 2.5
    player.pause()
    ctx.currentTime = 9
    expect(player.position()).toBeCloseTo(2.5)
    player.play()
    expect(ctx.sources[1].starts[0][1]).toBeCloseTo(2.5)
    player.seek(7)
    expect(ctx.sources[2].starts[0][1]).toBeCloseTo(7)
  })
})

// ---------------------------------------------------------------------------------------
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createRoomSwitcher', () => {
  it('applies only the latest room when loads finish out of order', async () => {
    const loads: Record<string, ReturnType<typeof deferred<string>>> = {}
    const applied: (string | null)[] = []
    const states: SwitchState<string>[] = []
    const sw = createRoomSwitcher<string, string>(
      (k) => (loads[k] = deferred<string>()).promise,
      (_k, v) => applied.push(v),
      (s) => states.push(s),
    )
    sw.request('kitchen')
    sw.request('living')
    sw.request('bedroom')
    loads.bedroom.resolve('IR-bedroom')
    loads.kitchen.resolve('IR-kitchen') // stale
    loads.living.reject(new Error('boom')) // stale
    await Promise.resolve()
    await Promise.resolve()
    expect(applied).toEqual(['IR-bedroom'])
    expect(states.at(-1)).toEqual({ kind: 'ready', key: 'bedroom' })
  })

  it('reports errors for the current room and clears with null', async () => {
    const applied: (string | null)[] = []
    const states: SwitchState<string>[] = []
    const sw = createRoomSwitcher<string, string>(
      () => Promise.reject(new Error('ir: HTTP 422')),
      (_k, v) => applied.push(v),
      (s) => states.push(s),
    )
    sw.request('closet')
    await Promise.resolve()
    await Promise.resolve()
    expect(states.at(-1)).toEqual({ kind: 'error', key: 'closet', message: 'ir: HTTP 422' })
    sw.request(null)
    expect(applied).toEqual([null])
    expect(states.at(-1)).toEqual({ kind: 'idle' })
  })
})
