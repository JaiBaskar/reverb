import { roomPayload } from '../../roomRef'
import type { IrResponse, MaterialSelection } from '../../types'

export const MAX_DRY_SECONDS = 30

let ctx: AudioContext | null = null
export const audioCtx = (): AudioContext => (ctx ??= new AudioContext())

export interface LoadedIr {
  buffer: AudioBuffer
  meta: IrResponse
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export async function fetchIr(
  sid: string,
  roomId: string,
  materials?: MaterialSelection,
): Promise<LoadedIr> {
  const res = await fetch('/api/rooms/ir', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sid, ...roomPayload(roomId), materials }),
  })
  if (!res.ok) throw new Error(`ir: HTTP ${res.status}`)
  const meta = (await res.json()) as IrResponse
  const buffer = await audioCtx().decodeAudioData(b64ToArrayBuffer(meta.wav_base64))
  return { buffer, meta }
}

export async function decodeDry(file: File): Promise<AudioBuffer> {
  const full = await audioCtx().decodeAudioData(await file.arrayBuffer())
  return trim(full, MAX_DRY_SECONDS)
}

/** Synthetic test signal (decaying noise bursts), clearly not a recording. */
export function syntheticClaps(): AudioBuffer {
  const c = audioCtx()
  const sr = c.sampleRate
  const buf = c.createBuffer(1, sr * 6, sr)
  const d = buf.getChannelData(0)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
  for (const t0 of [0.2, 1.2, 2.2, 3.2, 4.2, 5.0]) {
    const start = Math.floor(t0 * sr)
    for (let i = 0; i < 0.12 * sr && start + i < d.length; i++) {
      d[start + i] = rnd() * Math.exp(-i / (0.02 * sr)) * 0.8
    }
  }
  return buf
}

function trim(buf: AudioBuffer, seconds: number): AudioBuffer {
  const n = Math.min(buf.length, Math.floor(seconds * buf.sampleRate))
  if (n === buf.length) return buf
  const out = audioCtx().createBuffer(buf.numberOfChannels, n, buf.sampleRate)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.copyToChannel(buf.getChannelData(ch).subarray(0, n), ch)
  }
  return out
}

/** Convolve the dry buffer with the IR offline (the same math the live graph uses). */
export async function renderThroughIr(dry: AudioBuffer, ir: AudioBuffer): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(
    dry.numberOfChannels,
    dry.length + ir.length,
    dry.sampleRate,
  )
  const src = off.createBufferSource()
  src.buffer = dry
  const conv = off.createConvolver()
  conv.normalize = false // set before buffer, or Web Audio rescales the IR
  conv.buffer = ir
  src.connect(conv).connect(off.destination)
  src.start()
  return off.startRendering()
}

function energy(a: Float32Array, from = 0, to = a.length): number {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return s
}

/** Time (s) of the last 10 ms block whose level is within `floorDb` of the signal's peak block. */
function lastAudibleS(x: Float32Array, sr: number, floorDb = 40): number {
  const block = Math.floor(sr * 0.01)
  const levels: number[] = []
  for (let i = 0; i + block <= x.length; i += block) levels.push(energy(x, i, i + block))
  const peak = Math.max(...levels, 1e-20)
  const limit = peak * 10 ** (-floorDb / 10)
  let last = 0
  levels.forEach((e, i) => {
    if (e > limit) last = i
  })
  return (last + 1) * 0.01
}

export interface RoomRender {
  /** Gain that makes the wet output as loud (RMS) as the dry input. */
  matchGain: number
  /** How much longer (s) the output stays within 40 dB of its peak than the dry take does. */
  ringOutS: number
}

export function analyzeRender(dry: AudioBuffer, wet: AudioBuffer): RoomRender {
  const d = dry.getChannelData(0)
  const w = wet.getChannelData(0)
  const n = d.length
  const rmsDry = Math.sqrt(energy(d) / n)
  const rmsWet = Math.sqrt(energy(w, 0, n) / n)
  return {
    matchGain: rmsWet > 0 ? Math.min(20, Math.max(0.05, rmsDry / rmsWet)) : 1,
    ringOutS: Math.max(0, lastAudibleS(w, wet.sampleRate) - lastAudibleS(d, dry.sampleRate)),
  }
}
