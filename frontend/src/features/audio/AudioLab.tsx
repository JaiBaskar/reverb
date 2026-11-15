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
import { KIND_LABEL, synthAmbience, type AmbienceLayer, type AmbientKind } from './ambience'

type Mode = 'orig' | 'A' | 'B'

interface Props {
  a: SlotRef | null
  b: SlotRef | null
  materials: Record<'A' | 'B', MaterialSelection>
  /** Called with the loaded recording's name (or null), so the journey knows step 5 is done. */
  onDry?: (name: string | null) => void
  /** Illustrative outside noise per room's property, from its noise-risk ranking. */
  outside?: { A: AmbienceLayer[]; B: AmbienceLayer[] }
  /** False while the lab is kept mounted but hidden: keyboard shortcuts are off. */
  active?: boolean
  /** Short names for the two room buttons (default: the room labels). */
  names?: { A?: string; B?: string }
}

const LOOP_S: Record<AmbientKind, number> = { traffic: 20, rail: 24, aircraft: 30, helicopter: 28, siren: 26, venue: 8, works: 12 }
const AMB_SR = 22050
const WALL_LOWPASS_HZ = 700 // heard from inside: walls and windows remove most of the highs
const ambBuffers = new Map<AmbientKind, AudioBuffer>()
function ambBuffer(c: BaseAudioContext, kind: AmbientKind): AudioBuffer {
  let b = ambBuffers.get(kind)
  if (!b) {
    const data = synthAmbience(kind, AMB_SR, LOOP_S[kind])
    b = c.createBuffer(1, data.length, AMB_SR)
    b.getChannelData(0).set(data)
    ambBuffers.set(kind, b)
  }
  return b
}

interface Graph {
  src: AudioBufferSourceNode
  dryG: GainNode
  wetG: { A: GainNode; B: GainNode }
  amb: { A: GainNode; B: GainNode; srcs: AudioBufferSourceNode[] }
}

export function AudioLab({ a, b, materials, onDry, outside, active = true, names }: Props) {
  const [outsideOn, setOutsideOn] = useState(true)
  const [outsideLevel, setOutsideLevel] = useState(100)
  const outsideRef = useRef(outside)
  outsideRef.current = outside
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
      setPos(Math.min(dry.duration, t.offset + audioCtx().currentTime - t.startedAt))
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
      for (const s of g.amb.srcs) {
        s.stop()
        s.disconnect()
      }
      g.amb.A.disconnect()
      g.amb.B.disconnect()
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
    // Plays once: when the take ends, stop everything (outside noise too) and rewind for the next play.
    src.onended = () => {
      if (graph.current?.src !== src) return // stopped by hand or rebuilt: not the natural end
      stop()
      timing.current.offset = 0
      setPos(0)
    }
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
    const amb = { A: c.createGain(), B: c.createGain(), srcs: [] as AudioBufferSourceNode[] }
    for (const slot of ['A', 'B'] as const) {
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = WALL_LOWPASS_HZ
      amb[slot].gain.value = 0
      amb[slot].connect(lp).connect(master.current)
      for (const layer of outsideRef.current?.[slot] ?? []) {
        const s = c.createBufferSource()
        s.buffer = ambBuffer(c, layer.kind)
        s.loop = true
        const g = c.createGain()
        g.gain.value = layer.gain
        s.connect(g).connect(amb[slot])
        s.start()
        amb.srcs.push(s)
      }
    }
    graph.current = { src, dryG, wetG, amb }
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
    for (const slot of ['A', 'B'] as const) set(g.amb[slot], outsideOn && mode === slot ? outsideLevel / 100 : 0)
    if (master.current) set(master.current, volume / 100)
  }
  useEffect(applyGains) // keep gains in sync with controls and render results

  // A new IR (materials or rooms changed) while playing: rebuild the graph from the same position.
  useEffect(() => {
    if (!graph.current) return
    stop()
    void play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irA.ir, irB.ir, JSON.stringify(outside)])

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
  const keys = useRef({ play, stop, playing, irA: irA.ir, irB: irB.ir, active })
  keys.current = { play, stop, playing, irA: irA.ir, irB: irB.ir, active }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t?.closest('input, select, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      const k = keys.current
      if (!k.active) return
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

  const roomName = (m: 'A' | 'B') => names?.[m] ?? label(m)
  const modes = (['orig', 'A', 'B'] as Mode[]).filter((m) => m === 'orig' || (m === 'A' ? a : b))
  return (
    <div className="space-y-4 text-sm" data-testid="audio-lab">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft p-4">
        <button
          disabled={!ready}
          onClick={() => (playing ? stop() : play())}
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-paper transition hover:brightness-110 disabled:opacity-30"
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="play"
        >
          {playing ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold" data-testid="dry-name">{dryName || 'Add a recording to start'}</div>
          <div className="text-xs text-mute">
            {dry ? `${pos.toFixed(1)} / ${dry.duration.toFixed(1)} s` : 'A dry, close-miked take works best'}
            {dry && <span className="sr-only" data-testid="position">{pos.toFixed(1)}</span>}
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <label className="inline-flex h-9 cursor-pointer items-center rounded-full border border-line bg-paper px-3 text-[13px] font-semibold hover:bg-soft">
            {dry ? 'Replace' : 'Upload'}
            <input type="file" accept="audio/*" data-testid="dry-file" onChange={(e) => onFile(e.target.files?.[0])} className="sr-only" />
          </label>
          <button
            className="inline-flex h-9 items-center rounded-full border border-line bg-paper px-3 text-[13px] font-semibold hover:bg-soft"
            onClick={() => {
              stop()
              timing.current.offset = 0
              setDry(syntheticClaps())
              setDryName('Test claps')
            }}
            data-testid="test-claps"
          >
            Test claps
          </button>
        </div>
      </div>
      {error && <div className="text-bad">{error}</div>}

      <div className="flex rounded-full bg-soft p-1" role="radiogroup" aria-label="Playback source">
        {modes.map((m, i) => {
          const loading = m === 'A' ? irA.loading : m === 'B' ? irB.loading : false
          const missing = m !== 'orig' && !(m === 'A' ? irA.ir : irB.ir)
          const on = mode === m
          const dot = m === 'A' ? 'bg-a' : m === 'B' ? 'bg-b' : 'bg-mute'
          return (
            <button
              key={m}
              role="radio"
              aria-checked={on}
              disabled={missing}
              onClick={() => setMode(m)}
              title={`Key ${i}`}
              className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-[13px] font-semibold transition disabled:opacity-40 ${
                on ? 'bg-paper shadow-sm' : 'text-mute hover:text-ink'
              }`}
              data-testid={`mode-${m}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <span className="truncate">{m === 'orig' ? 'No room' : loading ? 'Loading…' : roomName(m)}</span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs text-mute sm:grid-cols-3">
        <label className="block">
          Room mix {wet}%
          <input type="range" min={0} max={100} value={wet} onChange={(e) => setWet(+e.target.value)} className="w-full accent-[var(--color-accent)]" />
        </label>
        <label className="block">
          Volume {volume}%
          <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(+e.target.value)} className="w-full accent-[var(--color-accent)]" />
        </label>
        {outside && (
          <div data-testid="outside-noise">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={outsideOn} onChange={(e) => setOutsideOn(e.target.checked)} className="accent-[var(--color-accent)]" />
              Outside noise {outsideOn ? `${outsideLevel}%` : 'off'}
            </label>
            <input
              type="range"
              min={0}
              max={200}
              value={outsideLevel}
              onChange={(e) => setOutsideLevel(+e.target.value)}
              aria-label="Outside noise level"
              disabled={!outsideOn}
              className="w-full accent-[var(--color-accent)] disabled:opacity-40"
            />
            <div className="truncate" title="Synthetic sounds for the kinds of sources mapped nearby, heard through a wall. Illustrative, not a measured level.">
              {(['A', 'B'] as const)
                .flatMap((slot) => ((slot === 'A' ? a : b) ? outside[slot] : []))
                .map((l) => KIND_LABEL[l.kind])
                .filter((v, i, xs) => xs.indexOf(v) === i)
                .join(', ') || 'Nothing loud mapped nearby'}
            </div>
          </div>
        )}
      </div>
      {(irA.error || irB.error) && <div className="text-xs text-bad">{irA.error ?? irB.error}</div>}
      <p className="text-[11px] text-mute">Modeled, not recorded. Loudness-matched. Keys 0 / 1 / 2 switch, space plays.</p>
    </div>
  )
}
