import { useState } from 'react'
import type { AcousticReport } from '../../types'
import type { Check, Fit, FitLevel, SuitabilityReport } from './types'
import { useSuitability } from './useSuitability'

const LEVEL: Record<FitLevel, string> = {
  good: 'bg-emerald-900/60 text-emerald-200',
  workable: 'bg-amber-900/60 text-amber-200',
  poor: 'bg-red-900/60 text-red-200',
}
const STATUS: Record<Check['status'], string> = {
  pass: 'text-emerald-300',
  caution: 'text-amber-300',
  fail: 'text-red-300',
}

interface Props {
  a?: AcousticReport
  b?: AcousticReport
}

/** Fit per use case for Room A and Room B, side by side. Qualitative, never a score. */
export function SuitabilityPanel({ a, b }: Props) {
  const sa = useSuitability(a)
  const sb = useSuitability(b)
  const [open, setOpen] = useState<string | null>(null)
  const rows = sa.suitability?.fits ?? sb.suitability?.fits ?? []
  if (!a && !b) return null

  return (
    <div className="mt-4 rounded border border-zinc-800 p-3 text-sm" data-testid="suitability-panel">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Studio suitability</h3>
        <span className="text-xs text-zinc-500">Rule-based fit · qualitative, not a score</span>
      </div>
      {(sa.error || sb.error) && <div className="text-red-300">{sa.error ?? sb.error}</div>}
      <p className="mb-2 text-xs text-zinc-400">
        <b>As modeled</b>: the empty room with the assumed materials. <b>Room shape</b>: size, height and
        bass modes, which treatment cannot change. Click a row for the reasons.
      </p>
      <table className="w-full text-xs">
        <thead className="text-left text-zinc-400">
          <tr>
            <th className="py-1 font-normal">Use</th>
            <th className="font-normal">Room A{a ? ` · ${a.label}` : ''}</th>
            <th className="font-normal">Room B{b ? ` · ${b.label}` : ''}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const fa = sa.suitability?.fits.find((f) => f.use_case === row.use_case)
            const fb = sb.suitability?.fits.find((f) => f.use_case === row.use_case)
            const isOpen = open === row.use_case
            return (
              <FitRow
                key={row.use_case}
                label={row.label}
                fa={fa}
                fb={fb}
                open={isOpen}
                onToggle={() => setOpen(isOpen ? null : row.use_case)}
              />
            )
          })}
        </tbody>
      </table>
      <Notes a={sa.suitability} b={sb.suitability} />
    </div>
  )
}

function FitRow({
  label,
  fa,
  fb,
  open,
  onToggle,
}: {
  label: string
  fa?: Fit
  fb?: Fit
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-zinc-900 align-top hover:bg-zinc-900/50"
        onClick={onToggle}
        data-testid={`fit-${label}`}
      >
        <td className="py-1.5 pr-2">
          <span className="mr-1 text-zinc-500">{open ? '▾' : '▸'}</span>
          {label}
        </td>
        <td className="py-1.5">{fa ? <Levels fit={fa} /> : <span className="text-zinc-600">—</span>}</td>
        <td className="py-1.5">{fb ? <Levels fit={fb} /> : <span className="text-zinc-600">—</span>}</td>
      </tr>
      {open && (
        <tr>
          <td />
          <td className="pb-2 pr-2 align-top">{fa && <Reasons fit={fa} />}</td>
          <td className="pb-2 align-top">{fb && <Reasons fit={fb} />}</td>
        </tr>
      )}
    </>
  )
}

function Levels({ fit }: { fit: Fit }) {
  return (
    <div className="flex flex-wrap gap-1">
      <span className={`rounded px-1.5 py-0.5 ${LEVEL[fit.level]}`} title="As modeled">
        {fit.level}
      </span>
      {fit.shape_level && (
        <span className={`rounded px-1.5 py-0.5 opacity-80 ${LEVEL[fit.shape_level]}`} title="Room shape">
          shape: {fit.shape_level}
        </span>
      )}
    </div>
  )
}

function Reasons({ fit }: { fit: Fit }) {
  return (
    <ul className="space-y-1">
      {fit.checks.map((c) => (
        <li key={c.id}>
          <span className={STATUS[c.status]}>{c.status}</span> <span className="text-zinc-300">{c.label}</span>
          {c.treatable && <span className="text-zinc-500"> (treatable)</span>}
          <div className="text-zinc-400">{c.reason}</div>
        </li>
      ))}
    </ul>
  )
}

function Notes({ a, b }: { a?: SuitabilityReport; b?: SuitabilityReport }) {
  const assumptions = [...new Set([...(a?.assumptions ?? []), ...(b?.assumptions ?? [])])]
  const missing = a?.missing ?? b?.missing ?? []
  if (!assumptions.length) return null
  return (
    <div className="mt-2 grid gap-2 text-xs text-zinc-500 md:grid-cols-2">
      <div>
        <div className="text-zinc-400">Assumptions</div>
        <ul className="list-disc pl-4">{assumptions.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
      <div>
        <div className="text-zinc-400">Not assessed</div>
        <ul className="list-disc pl-4">{missing.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>
    </div>
  )
}
