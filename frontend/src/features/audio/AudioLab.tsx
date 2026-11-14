import { useEffect, useRef, useState } from 'react'
import {
  analyzeRender,
  audioCtx,
  decodeDry,
  renderThroughIr,
  syntheticClaps,
  type RoomRender,
} from './engine'
import { useIr } from './useIr'

type Mode = 'orig' | 'A' | 'B'

interface Props {
  sid: string
  roomA: { id: string; label: string } | null
  roomB: { id: string; label: string } | null
}

interface Graph {
  src: AudioBufferSourceNode
  dryG: GainNode
  wetG: { A: GainNode; B: GainNode }
}

export function AudioLab({ sid, roomA, roomB }: Props) {
  const irA = useIr(sid, roomA?.id ?? null)
  const irB = useIr(sid, roomB?.id ?? null)
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
    if (!dry) return
    const c = audioCtx()
    await c.resume()
    if (!master.current) {
      const m = c.createGain()
      const comp = c.createDynamicsCompressor() // safety limiter
      comp.threshold.value = -3
      comp.ratio.value = 20
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
      const ir = slot === 'A' ? irA.ir : irB.ir
      if (!ir) continue
      const conv = c.createConvolver()
      conv.normalize = false // the IR's own level is preserved; we loudness-match ourselves
      conv.buffer = ir.buffer
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

  const label = (slot: 'A' | 'B') => (slot === 'A' ? roomA : roomB)?.label ?? 'not chosen'
  const ready = dry != null

  return (
    <div className="mt-4 rounded border border-zinc-800 p-3 text-sm" data-testid="audio-lab">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">Hear the rooms</div>
        <div className="text-xs text-amber-300">Modeled approximation — not a recording of this space</div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept="audio/*"
          data-testid="dry-file"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="text-xs"
        />
        <button
          className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
          onClick={() => {
            stop()
            timing.current.offset = 0
            setDry(syntheticClaps())
            setDryName('synthetic test claps (generated in browser)')
          }}
        >
          Use synthetic test claps
        </button>
        <span className="text-xs text-zinc-400">{dryName || 'Upload a dry recording (first 30 s are used)'}</span>
      </div>
      {error && <div className="mb-2 text-red-300">{error}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Playback source">
        {(['orig', 'A', 'B'] as Mode[]).map((m) => {
          const loading = m === 'A' ? irA.loading : m === 'B' ? irB.loading : false
          const missing = m !== 'orig' && !(m === 'A' ? irA.ir : irB.ir)
          return (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              disabled={missing}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1 text-xs font-semibold disabled:opacity-40 ${
                mode === m
                  ? m === 'A'
                    ? 'bg-sky-500 text-black'
                    : m === 'B'
                      ? 'bg-fuchsia-500 text-black'
                      : 'bg-zinc-200 text-black'
                  : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              {m === 'orig' ? 'Original (dry)' : `Room ${m}: ${label(m)}`}
              {loading && ' …'}
            </button>
          )
        })}
        <button
          disabled={!ready}
          onClick={() => (playing ? stop() : play())}
          className="ml-auto rounded bg-emerald-500 px-4 py-1 text-xs font-bold text-black disabled:opacity-40"
          data-testid="play"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        {dry && (
          <span className="text-xs tabular-nums text-zinc-400" data-testid="position">
            {pos.toFixed(1)} / {dry.duration.toFixed(1)} s
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
        <label className="block">
          Wet (room) {wet}% / dry {100 - wet}%
          <input type="range" min={0} max={100} value={wet} onChange={(e) => setWet(+e.target.value)} className="w-full" />
        </label>
        <label className="block">
          Volume {volume}%
          <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(+e.target.value)} className="w-full" />
        </label>
      </div>

      <div className="mt-3 text-xs text-zinc-400" data-testid="verification">
        {ready && (renders.A || renders.B) ? (
          <>
            Offline check: the audio was really convolved with each generated IR (loudness-matched).{' '}
            {(['A', 'B'] as const).map(
              (s) =>
                renders[s] && (
                  <span key={s} className="mr-3">
                    Room {s} keeps ringing {renders[s]!.ringOutS.toFixed(2)} s after the dry take stops
                  </span>
                ),
            )}
          </>
        ) : (
          <>Choose two rooms and load audio to process it through their impulse responses.</>
        )}
        {(irA.error || irB.error) && <div className="text-red-300">{irA.error ?? irB.error}</div>}
      </div>
    </div>
  )
}
