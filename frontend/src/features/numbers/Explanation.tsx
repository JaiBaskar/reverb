import type { Comparison } from '../../types'

interface Props {
  comparison?: Comparison
  error?: string
  loading: boolean
}

export function Explanation({ comparison: c, error, loading }: Props) {
  return (
    <div className="rounded-lg bg-zinc-950/50 p-3 text-sm" data-testid="explanation">
      <div className="mb-1 font-semibold">Why these rooms sound different</div>
      {error && <div className="text-red-300">{error}</div>}
      {loading && <div className="text-zinc-500">Calculating…</div>}
      {!c && !loading && !error && <div className="text-zinc-500">Choose two rooms to compare.</div>}
      {c && (
        <ul className="list-disc space-y-1.5 pl-5 text-zinc-200">
          {c.statements.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-[11px] text-zinc-500">
        Generated from the calculated numbers by fixed templates, not by a language model.
      </div>
    </div>
  )
}
