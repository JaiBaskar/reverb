import { useEffect, useState } from 'react'
import { CATEGORY_COLOR, LEVEL_STYLE } from './colors'
import type { NoiseReport } from './types'
import type { useNoise } from './useNoise'

/** Exposure summary and source list; the sources are drawn on the main map. */
export function NoisePanel({ noise }: { noise: ReturnType<typeof useNoise> }) {
  const { report, error, loading, retry } = noise
  const [waited, setWaited] = useState(0)
  useEffect(() => {
    if (!loading) return
    const started = Date.now()
    const id = setInterval(() => setWaited(Math.round((Date.now() - started) / 1000)), 1000)
    return () => {
      clearInterval(id)
      setWaited(0)
    }
  }, [loading])
  return (
    <div className="mt-4 rounded border border-zinc-800 p-3 text-sm" data-testid="noise-panel">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-semibold">Nearby noise sources</h3>
        <span className="text-xs text-zinc-500">OpenStreetMap evidence · no dB</span>
      </div>
      {loading && (
        <div className="text-zinc-500">
          Querying OpenStreetMap… {waited} s (a first lookup can take a minute; public servers are
          sometimes slow).
          {waited > 75 && (
            <button className="ml-2 text-sky-300 underline" onClick={retry}>
              Retry
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="text-red-300">
          {error}{' '}
          <button className="text-sky-300 underline" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {report && <Report report={report} />}
    </div>
  )
}

function Report({ report: r }: { report: NoiseReport }) {
  if (r.status === 'error') {
    return <div className="text-amber-300">{r.notes.join(' ')}</div>
  }
  return (
    <div className="space-y-3">
      <div className="text-xs text-zinc-400">
        Sources are drawn on the main map; toggle categories in its legend.
      </div>
      <div className="flex flex-wrap gap-1.5" data-testid="noise-exposure">
        {r.exposure.map((e) => (
          <span
            key={e.category}
            title={e.reason}
            className={`rounded px-2 py-0.5 text-xs ${LEVEL_STYLE[e.level]}`}
          >
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full"
              style={{ background: CATEGORY_COLOR[e.category] }}
            />
            {e.label}: {e.level === 'none' ? 'none mapped' : e.level}
          </span>
        ))}
      </div>
      <table className="w-full text-xs" data-testid="noise-list">
        <thead className="text-left text-zinc-400">
          <tr>
            <th className="py-1 font-normal">Source</th>
            <th className="font-normal">Type</th>
            <th className="text-right font-normal">Distance</th>
            <th className="pl-2 font-normal">Direction</th>
            <th className="font-normal" />
          </tr>
        </thead>
        <tbody>
          {r.sources.map((s) => (
            <tr key={s.id} className="border-t border-zinc-900">
              <td className="py-1">
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ background: CATEGORY_COLOR[s.category] }}
                />
                {s.name ?? <span className="text-zinc-500">unnamed</span>}
              </td>
              <td className="text-zinc-400">{s.subtype}</td>
              <td className="text-right tabular-nums">{Math.round(s.distance_m)} m</td>
              <td className="pl-2">{s.bearing_compass}</td>
              <td className="text-right">
                <a className="text-sky-400 hover:underline" href={s.osm_url} target="_blank" rel="noreferrer">
                  OSM
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-0.5 text-xs text-zinc-500">
        <li>
          Property location: {r.location_provenance} (Matterport). Distances are to the nearest
          point of each mapped feature.
        </li>
        {r.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        <li>Data © {r.data_source}.</li>
      </ul>
    </div>
  )
}
