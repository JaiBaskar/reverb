import { useEffect, useState } from 'react'
import { CATEGORY_COLOR } from '../noise/colors'
import type { NoiseScoutResult, ScoutFinding } from '../noise-scout/types'
import type { NoiseRisk, RankedSource } from './types'

const LEVEL: Record<RankedSource['level'], string> = {
  high: 'bg-red-500/20 text-red-300',
  moderate: 'bg-amber-500/20 text-amber-300',
  low: 'bg-zinc-700/40 text-zinc-300',
}

interface Props {
  sid: string
  risk: NoiseRisk | null
  loading: boolean
  error: string | null
  onFocus: (lon: number, lat: number) => void
}

async function scout(sid: string, method: 'GET' | 'POST'): Promise<NoiseScoutResult> {
  const r = await fetch(`/api/properties/${sid}/noise-scout`, { method })
  if (!r.ok) throw new Error(`noise-scout: HTTP ${r.status}`)
  return r.json() as Promise<NoiseScoutResult>
}

/**
 * Nearby sources ranked by relative risk (deterministic), with the Deep Agents research that
 * cites each one shown under it. Clicking a row flies the map to the source.
 */
export function RiskPanel({ sid, risk, loading, error, onFocus }: Props) {
  const [all, setAll] = useState(false)
  const [res, setRes] = useState<{ sid: string; r?: NoiseScoutResult; err?: string } | null>(null)
  const [running, setRunning] = useState<{ sid: string; started: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let live = true
    scout(sid, 'GET')
      .then((r) => live && setRes({ sid, r }))
      .catch((e: Error) => live && setRes({ sid, err: e.message }))
    return () => {
      live = false
    }
  }, [sid])
  const isRunning = running?.sid === sid
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  const research = async () => {
    setRunning({ sid, started: Date.now() })
    try {
      setRes({ sid, r: await scout(sid, 'POST') })
    } catch (e) {
      setRes({ sid, err: (e as Error).message })
    } finally {
      setRunning(null)
    }
  }

  const result = res?.sid === sid ? res.r : undefined
  const byId = new Map<string, ScoutFinding[]>()
  for (const f of result?.status === 'ok' ? result.findings : [])
    for (const ev of f.evidence) byId.set(ev.id, [...(byId.get(ev.id) ?? []), f])

  const rows = risk?.ranked ?? []
  const shown = all ? rows : rows.slice(0, 6)
  const counts = { high: 0, moderate: 0, low: 0 }
  for (const r of rows) counts[r.level]++

  return (
    <div className="rounded-lg bg-zinc-950/50 p-3 text-sm" data-testid="risk-panel">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-zinc-200">Noise risks around this home</h3>
        <span className="text-xs text-zinc-500">relative ranking · not a sound level</span>
      </div>
      {loading && !risk && <p className="text-xs text-zinc-500">Ranking nearby sources once the OpenStreetMap lookup finishes…</p>}
      {error && <p className="text-xs text-red-300">Risk ranking unavailable ({error}).</p>}
      {risk && rows.length === 0 && <p className="text-xs text-zinc-400">No mapped noise sources nearby.</p>}
      {rows.length > 0 && (
        <>
          <p className="mb-2 text-xs text-zinc-400">
            <span className="text-red-300">{counts.high} high</span> ·{' '}
            <span className="text-amber-300">{counts.moderate} moderate</span> · {counts.low} low. Risk = how
            intrusive that kind of source usually is (assumed) × how close it is. The heatmap on the map shows the
            same. Click a row to see it on the map.
          </p>
          <ol className="space-y-1.5" data-testid="risk-list">
            {shown.map((r) => {
              const found = byId.get(r.id) ?? []
              return (
                <li key={r.id}>
                  <button
                    onClick={() => onFocus(r.lon, r.lat)}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-900"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${LEVEL[r.level]}`}>{r.level}</span>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[r.category] }} />
                      <span className="min-w-0 flex-1 truncate text-zinc-200">{r.name ?? r.subtype}</span>
                      <span className="shrink-0 tabular-nums text-zinc-400">
                        {Math.round(r.distance_m)} m {r.bearing_compass}
                      </span>
                    </div>
                    <div className="mt-0.5 pl-1 text-[11px] text-zinc-500">{r.when}</div>
                  </button>
                  {found.map((f) => (
                    <div key={f.title} className="ml-3 mt-1 border-l-2 border-sky-500/50 pl-2 text-[11px] text-zinc-300" data-testid="risk-research">
                      <span className="font-medium text-sky-300">Researched:</span> {f.title}. {f.detail}
                    </div>
                  ))}
                </li>
              )
            })}
          </ol>
          {rows.length > 6 && (
            <button className="mt-1 text-xs text-sky-300 hover:underline" onClick={() => setAll((v) => !v)}>
              {all ? 'Show top 6' : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}

      <div className="mt-3 border-t border-zinc-800 pt-2 text-xs">
        {result?.status === 'ok' ? (
          <p className="text-zinc-400">
            Deep Agents research ({result.subagents_used.length} specialists, {result.tool_calls} tool calls):{' '}
            {result.findings.length} cited findings are attached to the rows they cite.
            {result.trace?.url && (
              <>
                {' '}
                <a className="text-sky-400 hover:underline" href={result.trace.url} target="_blank" rel="noreferrer">
                  LangSmith trace
                </a>
              </>
            )}
          </p>
        ) : (
          <p className="text-zinc-400">
            Want the details (opening hours, speed limits, sirens)? A Deep Agents coordinator sends three specialist
            agents to research the top-ranked sources in OpenStreetMap. Every claim must cite a source above.
          </p>
        )}
        {result && result.status !== 'ok' && result.status !== 'not_run' && (
          <p className="mt-1 text-amber-300">{result.notes.join(' ')}</p>
        )}
        <button
          onClick={research}
          disabled={isRunning || !risk}
          className="mt-2 rounded-md bg-sky-400 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-sky-300 disabled:opacity-50"
          data-testid="research-risks"
        >
          {isRunning
            ? `Agents researching… ${Math.round((now - running!.started) / 1000)} s (a few minutes on free models)`
            : result?.status === 'ok'
              ? 'Re-run the research'
              : 'Research the top risks with Deep Agents'}
        </button>
      </div>
    </div>
  )
}
