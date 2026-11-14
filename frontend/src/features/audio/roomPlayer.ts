/**
 * One dry recording on one looping playhead, heard either dry or through the current room's
 * modeled impulse response. Changing room swaps the convolver under the running source with a
 * short crossfade, so the playhead never restarts. The dry buffer is never modified.
 */

export const CROSSFADE_S = 0.12

interface Chain {
  conv: ConvolverNode
  gain: GainNode
}

export type Listen = 'dry' | 'room'

export class RoomPlayer {
  private ctx: BaseAudioContext
  private master: GainNode
  private dry: AudioBuffer | null = null
  private src: AudioBufferSourceNode | null = null
  private dryGain: GainNode | null = null
  private chain: Chain | null = null
  private ir: AudioBuffer | null = null
  private match = 1
  private startedAt = 0
  private offset = 0
  private mix = { listen: 'room' as Listen, wet: 1, volume: 0.8 }
  private timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    const limiter = ctx.createDynamicsCompressor() // safety limiter, peaks only
    limiter.threshold.value = -3
    limiter.ratio.value = 20
    limiter.knee.value = 0
    this.master.connect(limiter).connect(ctx.destination)
    this.master.gain.value = this.mix.volume
  }

  get playing() {
    return this.src !== null
  }
  get duration() {
    return this.dry?.duration ?? 0
  }
  get hasRoom() {
    return this.ir !== null
  }

  position(): number {
    if (!this.dry) return 0
    const t = this.src ? this.offset + this.ctx.currentTime - this.startedAt : this.offset
    return ((t % this.dry.duration) + this.dry.duration) % this.dry.duration
  }

  load(dry: AudioBuffer) {
    this.pause()
    this.dry = dry
    this.offset = 0
  }

  play() {
    if (!this.dry || this.src) return
    const c = this.ctx
    const src = c.createBufferSource()
    src.buffer = this.dry
    src.loop = true
    const dryGain = c.createGain()
    src.connect(dryGain).connect(this.master)
    this.src = src
    this.dryGain = dryGain
    if (this.ir) this.chain = this.makeChain(this.ir)
    this.applyGains(0)
    src.start(0, this.offset % this.dry.duration)
    this.startedAt = c.currentTime
  }

  pause() {
    if (!this.src) return
    this.offset = this.position()
    try {
      this.src.stop()
    } catch {
      /* already stopped */
    }
    this.src.disconnect()
    this.dryGain?.disconnect()
    this.chain?.gain.disconnect()
    this.chain?.conv.disconnect()
    this.src = null
    this.dryGain = null
    this.chain = null
  }

  seek(t: number) {
    const wasPlaying = this.playing
    this.pause()
    this.offset = Math.max(0, Math.min(t, this.duration))
    if (wasPlaying) this.play()
  }

  /** Swap the room response. `ir` null means no model for this room: the dry take is heard. */
  setRoom(ir: AudioBuffer | null, matchGain = 1) {
    this.ir = ir
    this.match = matchGain
    if (!this.src) return
    const old = this.chain
    this.chain = ir ? this.makeChain(ir) : null
    if (old) {
      const t = this.ctx.currentTime
      old.gain.gain.cancelScheduledValues(t)
      old.gain.gain.setValueAtTime(old.gain.gain.value, t)
      old.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_S)
      const id = setTimeout(() => {
        old.gain.disconnect()
        old.conv.disconnect()
        this.timers.delete(id)
      }, (CROSSFADE_S + 0.05) * 1000)
      this.timers.add(id)
    }
    this.applyGains(CROSSFADE_S)
  }

  setMatchGain(g: number) {
    this.match = g
    this.applyGains(0.05)
  }

  setMix(mix: Partial<{ listen: Listen; wet: number; volume: number }>) {
    this.mix = { ...this.mix, ...mix }
    this.applyGains(0.03)
  }

  dispose() {
    this.pause()
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    this.master.disconnect()
  }

  /** Current gain targets; exposed for tests. */
  targets() {
    const roomActive = this.mix.listen === 'room' && this.ir !== null
    return {
      dry: roomActive ? 1 - this.mix.wet : 1,
      room: roomActive ? this.mix.wet * this.match : 0,
      volume: this.mix.volume,
    }
  }

  private makeChain(ir: AudioBuffer): Chain {
    const conv = this.ctx.createConvolver()
    conv.normalize = false // before .buffer, or Web Audio rescales the IR
    conv.buffer = ir
    const gain = this.ctx.createGain()
    gain.gain.value = 0
    this.src!.connect(conv).connect(gain).connect(this.master)
    return { conv, gain }
  }

  private applyGains(ramp: number) {
    const t = this.ctx.currentTime
    const { dry, room, volume } = this.targets()
    const to = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(t)
      p.setValueAtTime(p.value, t)
      if (ramp > 0) p.linearRampToValueAtTime(v, t + ramp)
      else p.setValueAtTime(v, t)
    }
    to(this.master.gain, volume)
    if (this.dryGain) to(this.dryGain.gain, dry)
    if (this.chain) to(this.chain.gain.gain, room)
  }
}
