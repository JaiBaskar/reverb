import { useEffect, useState } from 'react'
import type { NoiseScoutResult, ScoutEvidence } from './types'

const SIGNIFICANCE: Record<string, string> = {
  high: 'bg-red-500/20 text-red-300',
  moderate: 'bg-amber-500/20 text-amber-300',
  low: 'bg-emerald-500/20 text-emerald-300',
}
// Tags worth surfacing next to a citation, in order.
const KEY_TAGS = ['opening_hours', 'maxspeed', 'lanes', 'highway', 'railway', 'usage', 'service', 'aeroway', 'amenity']

async function call(sid: string, method: 'GET' | 'POST'): Promise<NoiseScoutResult> {
  const res = await fetch(`/api/properties/${sid}/noise-scout`, { method })
  if (!res.ok) throw new Error(`noise-scout: HTTP ${res.status}`)
  return res.json() as Promise<NoiseScoutResult>
}

export function NoiseScoutPanel({ sid }: { sid: string }) {
  const [state, setState] = useState<{ sid: string; result?: NoiseScoutResult; error?: string }>({ sid: '' })
  const [running, setRunning] = useState(false)

  useEffect(() => {
    let live = true
    call(sid, 'GET')
      .then((result) => live && setState({ sid, result }))
      .catch((e: Error) => live && setState({ sid, error: e.message }))
    return () => {
      live = false
    }
  }, [sid])

  const run = async () => {
    setRunning(true)
    try {
      setState({ sid, result: await call(sid, 'POST') })
    } catch (e) {
      setState({ sid, error: (e as Error).message })
    } finally {
      setRunning(false)
    }
  }

  const r = state.sid === sid ? state.result : undefined
  const error = state.sid === sid ? state.error : undefined

  return (
    <div className="mt-3 rounded-lg bg-zinc-950/50 p-3 text-sm" data-testid="noise-scout">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Noise Scout · AI research agent</h3>
        <span className="text-xs text-zinc-500">
          Deep Agents + LangChain · traced in LangSmith · cites OpenStreetMap · no dB
        </span>
      </div>
      <p className="mb-2 text-xs text-zinc-400">
        A coordinator agent sends three specialists (transport, nightlife and commercial, aviation
        and industrial) to dig into the mapped sources: speed limits, venue opening hours, fire
        stations, transit. Claims without a valid citation are removed automatically.
      </p>
      <button
        onClick={run}
        disabled={running}
        className="rounded bg-violet-500 px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
        data-testid="run-scout"
      >
        {running ? 'Researching…' : r?.status === 'ok' ? 'Run again' : 'Run Noise Scout'}
      </button>
      {running && (
        <span className="ml-2 text-xs text-zinc-400">
          Three specialists are researching in parallel; this usually takes 1–3 minutes.
        </span>
      )}
      {error && <div className="mt-2 text-red-300">{error}</div>}
      {r && r.status !== 'ok' && r.status !== 'not_run' && (
        <div className="mt-2 text-amber-300">{r.notes.join(' ')}</div>
      )}
      {r?.status === 'ok' && <Result r={r} />}
    </div>
  )
}

function Cite({ e }: { e: ScoutEvidence }) {
  const tags = KEY_TAGS.filter((k) => e.tags[k]).map((k) => `${k}=${e.tags[k]}`)
  return (
    <a
      href={e.osm_url}
      target="_blank"
      rel="noreferrer"
      className="mr-2 inline-block text-xs text-sky-300 hover:underline"
      title={e.distance_note ?? undefined}
    >
      {e.name ?? e.id}
      {e.distance_m != null && ` · ${e.distance_m.toFixed(0)} m ${e.bearing_compass ?? ''}`}
      {tags.length > 0 && <span className="text-zinc-400"> · {tags.slice(0, 2).join(', ')}</span>}
    </a>
  )
}

function Result({ r }: { r: NoiseScoutResult }) {
  return (
    <div className="mt-3 space-y-3">
      {r.summary && <p className="text-zinc-200">{r.summary}</p>}
      <ul className="space-y-2" data-testid="scout-findings">
        {r.findings.map((f) => (
          <li key={f.title} className="rounded bg-zinc-900/60 p-2">
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 text-[10px] uppercase ${SIGNIFICANCE[f.significance]}`}>
                {f.significance}
              </span>
              <span className="font-medium">{f.title}</span>
            </div>
            <div className="mt-0.5 text-zinc-300">{f.detail}</div>
            <div className="mt-1">
              {f.evidence.map((e) => (
                <Cite key={e.id} e={e} />
              ))}
            </div>
            {f.warnings.map((w) => (
              <div key={w} className="text-xs text-amber-300">
                {w}
              </div>
            ))}
          </li>
        ))}
      </ul>
      {r.recording_advice.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-zinc-400">
            Recording advice{' '}
            <span className="font-normal text-zinc-500">
              (AI-written general guidance; only the findings above are citation-checked)
            </span>
          </div>
          <ul className="ml-4 list-disc text-zinc-300">
            {r.recording_advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {r.data_gaps.length > 0 && (
        <div className="text-xs text-zinc-400">
          <span className="font-semibold">Couldn't determine: </span>
          {r.data_gaps.join(' · ')}
        </div>
      )}
      <div className="rounded border border-zinc-800 p-2 text-xs text-zinc-400" data-testid="scout-run">
        Agent run: {r.subagents_used.length} specialists ({r.subagents_used.join(', ') || 'none'}) ·{' '}
        {r.tool_calls} coordinator tool calls · {r.model} with {r.subagent_model} specialists ·{' '}
        {r.trace.url ? (
          <a href={r.trace.url} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
            open LangSmith trace
          </a>
        ) : (
          <span>LangSmith run {r.trace.run_id?.slice(0, 8) ?? 'n/a'} in {r.trace.project ?? 'n/a'}</span>
        )}
        {r.rejected.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-amber-300">
              {r.rejected.length} claim(s) removed by the citation check
            </summary>
            <ul className="ml-4 list-disc">
              {r.rejected.map((x) => (
                <li key={x.title}>
                  {x.title}: {x.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {Object.keys(r.files).length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer">Agent's working files ({Object.keys(r.files).length})</summary>
            {Object.entries(r.files).map(([path, text]) => (
              <div key={path} className="mt-1">
                <div className="font-mono text-zinc-300">{path}</div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-[11px]">{text}</pre>
              </div>
            ))}
          </details>
        )}
        <div className="mt-1">{r.notes.join(' ')}</div>
      </div>
    </div>
  )
}
