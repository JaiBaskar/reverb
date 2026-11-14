import { useEffect, useMemo, useRef, useState } from 'react'
import { audioCtx, cachedIr, decodeAudioBlob, MAX_DRY_SECONDS, matchGainFor, syntheticClaps, type LoadedIr } from './engine'
import { RoomPlayer, type Listen } from './roomPlayer'
import { createRoomSwitcher, type SwitchState } from './roomSwitcher'
import { useRecorder } from './useRecorder'

interface RoomRef {
  id: string
  label: string
  usable: boolean
}

interface Props {
  sid: string
  /** The room being simulated (follows the tour or the room picker). */
  room: RoomRef | null
  /** Rooms whose IRs are fetched in the background once audio is loaded. */
  prefetchRoomIds: string[]
}

const MAX_UPLOAD_MB = 100

interface Loaded {
  ir: LoadedIr
  gain: number
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/**
 * Hear one dry take in whichever room the visitor is in. One playhead: changing room swaps the
 * impulse response under the running audio with a short crossfade.
 */
export function RoomAudio({ sid, room, prefetchRoomIds }: Props) {
  const [dry, setDry] = useState<{ buf: AudioBuffer; name: string; note?: string } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [listen, setListen] = useState<Listen>('room')
  const [wet, setWet] = useState(100)
  const [volume, setVolume] = useState(80)
  const [sw, setSw] = useState<SwitchState<string>>({ kind: 'idle' })
  const [applied, setApplied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const player = useRef<RoomPlayer | null>(null)
  const getPlayer = () => (player.current ??= new RoomPlayer(audioCtx()))
  const dryRef = useRef<AudioBuffer | null>(null)
  dryRef.current = dry?.buf ?? null

  const switcher = useMemo(
    () =>
      createRoomSwitcher<string, Loaded>(
        async (roomId) => {
          const ir = await cachedIr(sid, roomId)
          const d = dryRef.current
          return { ir, gain: d ? await matchGainFor(d, ir.buffer) : 1 }
        },
        (roomId, v) => {
          getPlayer().setRoom(v?.ir.buffer ?? null, v?.gain ?? 1)
          setApplied(roomId)
        },
        setSw,
      ),
    [sid],
  )

  // Follow the selected room. While its IR loads, the previous room keeps playing.
  const roomKey = room ? `${room.id}:${room.usable}` : ''
  useEffect(() => {
    switcher.request(room?.usable ? room.id : null)
    // re-run when the dry take changes too, so loudness matching uses the new take
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switcher, roomKey, dry])

  useEffect(() => () => switcher.cancel(), [switcher])

  useEffect(
    () => () => {
      player.current?.dispose()
      player.current = null
    },
    [],
  )

  // Warm the IR cache for the tour's rooms once there is audio, one at a time.
  const prefetchKey = prefetchRoomIds.join(',')
  useEffect(() => {
    if (!dry) return
    let live = true
    ;(async () => {
      for (const id of prefetchRoomIds) {
        if (!live) return
        try {
          const ir = await cachedIr(sid, id)
          if (live) await matchGainFor(dry.buf, ir.buffer)
        } catch {
          /* shown when that room is selected */
        }
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, dry, prefetchKey])

  useEffect(() => {
    getPlayer().setMix({ listen, wet: wet / 100, volume: volume / 100 })
  }, [listen, wet, volume])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setPos(player.current?.position() ?? 0), 100)
    return () => clearInterval(id)
  }, [playing])

  const loadTake = (buf: AudioBuffer, name: string, note?: string) => {
    setError(null)
    getPlayer().load(buf)
    setPlaying(false)
    setPos(0)
    setDry({ buf, name, note })
  }

  const rec = useRecorder((buf, secs) => loadTake(buf, `Microphone take (${secs.toFixed(1)} s)`))

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`"${f.name}" is over ${MAX_UPLOAD_MB} MB. Trim it first; only ${MAX_DRY_SECONDS} s are used.`)
      return
    }
    try {
      const { buffer, originalSeconds } = await decodeAudioBlob(f)
      const note = originalSeconds > MAX_DRY_SECONDS + 0.05 ? `first ${MAX_DRY_SECONDS} s of ${originalSeconds.toFixed(0)} s` : undefined
      loadTake(buffer, f.name, note)
    } catch {
      setError(`Could not decode "${f.name}". Try WAV, MP3 or M4A (what the browser can decode).`)
    }
  }

  const togglePlay = async () => {
    const p = getPlayer()
    if (p.playing) {
      p.pause()
      setPlaying(false)
      return
    }
    await audioCtx().resume()
    p.play()
    setPlaying(true)
  }

  const roomLabel = room?.label ?? 'no room selected'
  const loadingThis = sw.kind === 'loading'
  const swError = sw.kind === 'error' ? sw.message : null
  const noModel = room && !room.usable
  const recording = rec.state.kind === 'recording'

  let status: string
  if (!room) status = 'Select a room or walk into one to hear it.'
  else if (noModel) status = `${room.label} has no acoustic model; you are hearing the original take.`
  else if (swError) status = `Could not load ${room.label}'s impulse response: ${swError}`
  else if (loadingThis) status = `Loading ${room.label}…${applied ? ' (still hearing the previous room)' : ''}`
  else status = `Simulating ${room.label}`

  return (
    <div className="space-y-3 text-xs" data-testid="room-audio">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Hear it in this room</h3>
        <span className="text-[11px] text-amber-300/90">Modeled approximation — not a recording of the actual room.</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <button onClick={rec.stop} className="flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 font-semibold text-black" data-testid="rec-stop">
            <span className="h-2 w-2 rounded-sm bg-black" /> Stop {rec.elapsed.toFixed(1)} / {MAX_DRY_SECONDS} s
          </button>
        ) : (
          <button
            onClick={rec.start}
            disabled={!rec.supported || rec.state.kind === 'requesting' || rec.state.kind === 'processing'}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700 disabled:opacity-40"
            title={rec.supported ? 'Record a dry take with your microphone' : 'Recording is not supported in this browser'}
            data-testid="rec-start"
          >
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {rec.state.kind === 'requesting' ? 'Waiting for mic…' : rec.state.kind === 'processing' ? 'Processing…' : 'Record'}
          </button>
        )}
        <label className="cursor-pointer rounded-md bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">
          Upload audio
          <input type="file" accept="audio/*" className="hidden" data-testid="tour-dry-file" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button
          className="rounded-md px-2 py-1.5 text-zinc-400 hover:bg-zinc-800"
          onClick={() => loadTake(syntheticClaps(), 'Synthetic test claps (generated in browser)')}
        >
          Test claps
        </button>
      </div>
      <div className="text-zinc-400" data-testid="take-name">
        {dry ? (
          <>
            {dry.name} · {dry.buf.duration.toFixed(1)} s{dry.note ? ` (${dry.note})` : ''}
          </>
        ) : (
          `Record or upload a dry take (WAV, MP3, M4A; up to ${MAX_UPLOAD_MB} MB; the first ${MAX_DRY_SECONDS} s are used).`
        )}
      </div>
      {rec.state.kind === 'error' && <div className="text-red-300">{rec.state.message}</div>}
      {error && <div className="text-red-300">{error}</div>}

      <div className="flex items-center gap-2">
        <button
          onClick={togglePlay}
          disabled={!dry}
          className="w-16 rounded-md bg-emerald-500 py-1.5 font-bold text-black disabled:opacity-40"
          data-testid="tour-play"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={dry?.buf.duration ?? 1}
          step={0.05}
          value={pos}
          disabled={!dry}
          onChange={(e) => {
            player.current?.seek(+e.target.value)
            setPos(+e.target.value)
          }}
          className="flex-1"
          aria-label="Playback position"
        />
        <span className="w-20 text-right tabular-nums text-zinc-400" data-testid="tour-position">
          {fmt(pos)} / {fmt(dry?.buf.duration ?? 0)}
        </span>
      </div>

      <div className="flex rounded-lg bg-zinc-900 p-0.5 ring-1 ring-zinc-800" role="radiogroup" aria-label="Listen to">
        <button
          role="radio"
          aria-checked={listen === 'dry'}
          onClick={() => setListen('dry')}
          className={`flex-1 rounded-md px-2 py-1.5 font-medium ${listen === 'dry' ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-300 hover:bg-zinc-800'}`}
        >
          Original (dry)
        </button>
        <button
          role="radio"
          aria-checked={listen === 'room'}
          onClick={() => setListen('room')}
          className={`flex-1 truncate rounded-md px-2 py-1.5 font-medium ${listen === 'room' ? 'bg-sky-400 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'}`}
          data-testid="listen-room"
        >
          In {roomLabel}
          {loadingThis && ' …'}
        </button>
      </div>
      <div className={swError ? 'text-red-300' : noModel ? 'text-amber-300' : 'text-zinc-400'} data-testid="audio-status">
        {listen === 'dry' ? 'Playing the original take.' : status}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-zinc-400">
            Room {wet}% / dry {100 - wet}%
          </span>
          <input type="range" min={0} max={100} value={wet} onChange={(e) => setWet(+e.target.value)} className="w-full" />
        </label>
        <label className="block">
          <span className="text-zinc-400">Volume {volume}%</span>
          <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(+e.target.value)} className="w-full" />
        </label>
      </div>
      <p className="text-zinc-500">
        Room-level simulation: one modeled impulse response per room (empty room, assumed materials, default source and
        mic positions), loudness-matched to the dry take. It does not change with where you stand in the tour.
      </p>
    </div>
  )
}
