import { useEffect, useRef, useState } from 'react'
import {
  analyzeRender,
  audioCtx,
  decodeDry,
  renderThroughIr,
  syntheticClaps,
  type RoomRender,
} from './engine'
import type { SlotRef } from '../../roomRef'
import type { MaterialSelection } from '../../types'
import { useIr } from './useIr'

type Mode = 'orig' | 'A' | 'B'

interface Props {
  a: SlotRef | null
  b: SlotRef | null
  materials: Record<'A' | 'B', MaterialSelection>
  /** Called with the loaded recording's name (or null), so the journey knows step 5 is done. */
  onDry?: (name: string | null) => void
}

interface Graph {
  src: AudioBufferSourceNode
  dryG: GainNode
  wetG: { A: GainNode; B: GainNode }
}

export function AudioLab({ a, b, materials, onDry }: Props) {
  const irA = useIr(a?.sid ?? null, a?.roomId ?? null, materials.A)
  const irB = useIr(b?.sid ?? null, b?.roomId ?? null, materials.B)
  const [dry, setDry] = useState<AudioBuffer | null>(null)
  const [dryName, setDryName] = useState('')
  const [renders, setRenders] = useState<{ A?: RoomRender; B?: RoomRender }>({})
  const [mode, setMode] = useState<Mode>('orig')
  const [wet, setWet] = useState(100)
  const [volume, setVolume] = useState(80)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState(0)

  const graph = useRef<Graph | null>(null)
  const timing = useRef({ startedAt: 0, offset: 0 })
  const master = useRef<GainNode | null>(null)
  const starting = useRef(false)
  // play() awaits the AudioContext; read IRs from a ref so it always builds with the latest ones.
  const irs = useRef<{ A?: AudioBuffer; B?: AudioBuffer }>({})
  irs.current = { A: irA.ir?.buffer, B: irB.ir?.buffer }

  // Offline-render the dry audio through each IR: gives loudness-matching gains and proof of processing.
  useEffect(() => {
    if (!dry) return
    let live = true
    const run = async (slot: 'A' | 'B', buf?: AudioBuffer) => {
      if (!buf) return setRenders((r) => ({ ...r, [slot]: undefined }))
      const wetBuf = await renderThroughIr(dry, buf)
      if (live) setRenders((r) => ({ ...r, [slot]: analyzeRender(dry, wetBuf) }))
    }
    run('A', irA.ir?.buffer).catch((e: Error) => live && setError(e.message))
    run('B', irB.ir?.buffer).catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [dry, irA.ir, irB.ir])

  useEffect(() => {
    if (!playing || !dry) return
    const id = setInterval(() => {
      const t = timing.current
      setPos((t.offset + audioCtx().currentTime - t.startedAt) % dry.duration)
    }, 200)
    return () => clearInterval(id)
  }, [playing, dry])

  const stop = () => {
    const g = graph.current
    if (g) {
      const c = audioCtx()
      timing.current.offset =
        (timing.current.offset + c.currentTime - timing.current.startedAt) % (dry?.duration ?? 1)
      g.src.stop()
      g.src.disconnect()
      g.dryG.disconnect()
      g.wetG.A.disconnect()
      g.wetG.B.disconnect()
      graph.current = null
    }
    setPlaying(false)
  }

  useEffect(
    () => () => {
      // stop playback when the lab unmounts
      try {
        graph.current?.src.stop()
      } catch {
        /* already stopped */
      }
    },
    [],
  )

  const play = async () => {
    if (!dry || starting.current || graph.current) return
    starting.current = true
    const c = audioCtx()
    try {
      await c.resume()
    } finally {
      starting.current = false
    }
    if (!master.current) {
      const m = c.createGain()
      const comp = c.createDynamicsCompressor() // safety limiter
      comp.threshold.value = -3
      comp.ratio.value = 20
      comp.knee.value = 0 // hard knee: only touches peaks, so it does not colour the A/B comparison
      m.connect(comp).connect(c.destination)
      master.current = m
    }
    const src = c.createBufferSource()
    src.buffer = dry
    src.loop = true
    const dryG = c.createGain()
    src.connect(dryG).connect(master.current)
    const wetG = { A: c.createGain(), B: c.createGain() }
    for (const slot of ['A', 'B'] as const) {
      const ir = irs.current[slot]
      if (!ir) continue
      const conv = c.createConvolver()
      conv.normalize = false // the IR's own level is preserved; we loudness-match ourselves
      conv.buffer = ir
      src.connect(conv).connect(wetG[slot]).connect(master.current)
    }
    graph.current = { src, dryG, wetG }
    applyGains()
    src.start(0, timing.current.offset % dry.duration)
    timing.current.startedAt = c.currentTime
    setPlaying(true)
  }

  const applyGains = () => {
    const g = graph.current
    if (!g) return
    const t = audioCtx().currentTime
    const w = wet / 100
    const set = (node: GainNode, v: number) => node.gain.setTargetAtTime(v, t, 0.015)
    set(g.dryG, mode === 'orig' ? 1 : 1 - w)
    for (const slot of ['A', 'B'] as const) {
      const match = renders[slot]?.matchGain ?? 1
      set(g.wetG[slot], mode === slot ? w * match : 0)
    }
    if (master.current) set(master.current, volume / 100)
  }
  useEffect(applyGains) // keep gains in sync with controls and render results

  // A new IR (materials or rooms changed) while playing: rebuild the graph from the same position.
  useEffect(() => {
    if (!graph.current) return
    stop()
    void play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irA.ir, irB.ir])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setError(null)
    stop()
    timing.current.offset = 0
    try {
      setDry(await decodeDry(f))
      setDryName(f.name)
    } catch {
      setError(`Could not decode "${f.name}". Try WAV, MP3 or M4A.`)
    }
  }

  useEffect(() => onDry?.(dry ? dryName : null), [dry, dryName, onDry])

  const label = (slot: 'A' | 'B') => (slot === 'A' ? a : b)?.label ?? 'not chosen'
  const ready = dry != null

  // Keyboard: 0 = dry, 1 = Room A, 2 = Room B, space = play/pause (ignored while typing).
  const keys = useRef({ play, stop, playing, irA: irA.ir, irB: irB.ir })
  keys.current = { play, stop, playing, irA: irA.ir, irB: irB.ir }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t?.closest('input, select, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      const k = keys.current
      if (e.key === '0') setMode('orig')
      else if (e.key === '1' && k.irA) setMode('A')
      else if (e.key === '2' && k.irB) setMode('B')
      else if (e.key === ' ' && t?.tagName !== 'BUTTON') {
        e.preventDefault()
        void (k.playing ? k.stop() : k.play())
      } else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="text-sm" data-testid="audio-lab">
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/50 p-3">
        <label className="cursor-pointer rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-black hover:bg-white">
          {dry ? 'Replace recording' : 'Upload dry recording'}
          <input
            type="file"
            accept="audio/*"
            data-testid="dry-file"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="sr-only"
          />
        </label>
        <button
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700"
          onClick={() => {
            stop()
            timing.current.offset = 0
            setDry(syntheticClaps())
            setDryName('synthetic test claps (generated in browser)')
          }}
        >
          or use synthetic test claps
        </button>
        <span className="min-w-0 truncate text-xs text-zinc-400" data-testid="dry-name">
          {dryName || 'WAV, MP3 or M4A; a close-miked, dry take works best (first 30 s used).'}
        </span>
      </div>
      {error && <div className="mb-2 text-red-300">{error}</div>}

      <div className="mb-3 flex flex-wrap items-stretch gap-2" role="radiogroup" aria-label="Playback source">
        <button
          disabled={!ready}
          onClick={() => (playing ? stop() : play())}
          className="w-24 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-40"
          data-testid="play"
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        {(['orig', 'A', 'B'] as Mode[]).map((m, i) => {
          const loading = m === 'A' ? irA.loading : m === 'B' ? irB.loading : false
          const missing = m !== 'orig' && !(m === 'A' ? irA.ir : irB.ir)
          const on = mode === m
          const tone =
            m === 'A' ? 'bg-sky-500 text-black' : m === 'B' ? 'bg-fuchsia-500 text-black' : 'bg-zinc-200 text-black'
          return (
            <button
              key={m}
              role="radio"
              aria-checked={on}
              disabled={missing}
              onClick={() => setMode(m)}
              className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-xs disabled:opacity-40 ${
                on ? tone : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                {m === 'orig' ? 'Dry original' : `Room ${m}`}
                <kbd className={`rounded px-1 text-[10px] ${on ? 'bg-black/20' : 'bg-zinc-900 text-zinc-400'}`}>{i}</kbd>
              </div>
              <div className={`truncate ${on ? 'text-black/70' : 'text-zinc-400'}`}>
                {m === 'orig' ? 'no room' : loading ? 'generating impulse response…' : label(m)}
              </div>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-[1fr_1fr_auto]">
        <label className="block text-zinc-400">
          Room {wet}% · dry {100 - wet}%
          <input type="range" min={0} max={100} value={wet} onChange={(e) => setWet(+e.target.value)} className="w-full accent-amber-400" />
        </label>
        <label className="block text-zinc-400">
          Volume {volume}%
          <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(+e.target.value)} className="w-full accent-amber-400" />
        </label>
        {dry && (
          <span className="self-end tabular-nums text-zinc-400" data-testid="position">
            {pos.toFixed(1)} / {dry.duration.toFixed(1)} s
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        One playhead feeds both rooms, so switching keeps your place. Rooms are loudness-matched so you
        hear the room, not a volume change. Keys: 0 / 1 / 2 to switch, space to play.
      </p>

      <details className="mt-3 text-xs text-zinc-400" data-testid="verification">
        <summary className="cursor-pointer">
          Processing check
          {ready && (renders.A || renders.B) ? (
            <span className="text-zinc-500">
              {' '}
              ·{' '}
              {(['A', 'B'] as const)
                .filter((s) => renders[s])
                .map((s) => `Room ${s} rings ${renders[s]!.ringOutS.toFixed(2)} s after the take stops`)
                .join(' · ')}
            </span>
          ) : null}
        </summary>
        <div className="mt-2 space-y-1">
          {ready && (renders.A || renders.B) ? (
            <div>The audio was rendered offline through each generated impulse response to set the loudness match.</div>
          ) : (
            <div>Choose rooms and load audio to process it through their impulse responses.</div>
          )}
          {(irA.ir || irB.ir) && (
            <div data-testid="ir-rt60">
              <div>RT60 of the modeled impulse response vs the Sabine estimate (500 Hz / 1 kHz / 2 kHz):</div>
              {(['A', 'B'] as const).map((s) => {
                const m = (s === 'A' ? irA : irB).ir?.meta
                if (!m) return null
                const f = (v: number | null) => (v == null ? '—' : v.toFixed(2))
                return (
                  <div key={s} title={m.notes.join(' ')}>
                    Room {s}: IR {[2, 3, 4].map((i) => f(m.ir_rt60_s[i])).join(' / ')} s · Sabine{' '}
                    {[2, 3, 4].map((i) => f(m.sabine_rt60_s[i])).join(' / ')} s
                  </div>
                )
              })}
              <div className="text-zinc-500">
                {irA.ir?.meta.notes.slice(1).join(' ') ?? irB.ir?.meta.notes.slice(1).join(' ')}
              </div>
            </div>
          )}
        </div>
      </details>
      {(irA.error || irB.error) && <div className="mt-2 text-xs text-red-300">{irA.error ?? irB.error}</div>}
    </div>
  )
}
