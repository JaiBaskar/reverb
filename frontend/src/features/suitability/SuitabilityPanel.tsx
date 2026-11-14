import { useState } from 'react'
import type { AcousticReport } from '../../types'
import type { Check, Fit, FitLevel, SuitabilityReport, UseCaseVerdict } from './types'
import { useSuitability } from './useSuitability'
import { useVerdicts } from './useVerdicts'

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
  const verdicts = useVerdicts(a, b)
  const [open, setOpen] = useState<string | null>(null)
  const rows = sa.suitability?.fits ?? sb.suitability?.fits ?? []
  if (!a && !b) return null

  return (
    <div className="mt-3 text-sm" data-testid="suitability-panel">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Studio suitability</h3>
        <span className="text-xs text-zinc-500">Rule-based fit · qualitative, not a score</span>
      </div>
      {(sa.error || sb.error) && <div className="text-red-300">{sa.error ?? sb.error}</div>}
      {verdicts && verdicts.length > 0 && <Verdict verdicts={verdicts} a={a?.label} b={b?.label} />}
      <p className="mb-2 text-xs text-zinc-400">
        <b>Best achievable</b>: what the room can reach with a practical amount of acoustic panels; its
        size, height and bass modes cannot be changed. <b>As is</b>: the room as modeled now, with its
        furniture (assumed unless you edited it) and no acoustic treatment. Panel counts are Eyring estimates. Click a row for the reasons.
      </p>
      <table className="w-full text-xs">
        <thead className="text-left text-zinc-400">
          <tr>
            <th className="py-1 font-normal">Use</th>
            <th className="font-normal">Room A{a ? ` · ${a.label}` : ''}</th>
            <th className="font-normal">Room B{b ? ` · ${b.label}` : ''}</th>
            {verdicts && <th className="font-normal">Better</th>}
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
                verdict={verdicts?.find((v) => v.use_case === row.use_case)}
                showVerdict={verdicts !== undefined}
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
  verdict,
  showVerdict,
  open,
  onToggle,
}: {
  label: string
  fa?: Fit
  fb?: Fit
  verdict?: UseCaseVerdict
  showVerdict: boolean
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
        {showVerdict && (
          <td className="py-1.5 font-semibold" title={verdict?.reason}>
            {verdict?.better ? (
              <span className={verdict.better === 'A' ? 'text-sky-300' : 'text-fuchsia-300'}>Room {verdict.better}</span>
            ) : (
              <span className="text-zinc-500">tie</span>
            )}
          </td>
        )}
      </tr>
      {open && (
        <tr>
          <td />
          <td className="pb-2 pr-2 align-top">{fa && <Reasons fit={fa} />}</td>
          <td className="pb-2 align-top">{fb && <Reasons fit={fb} />}</td>
          {showVerdict && <td className="pb-2 align-top text-zinc-300">{verdict?.reason}</td>}
        </tr>
      )}
    </>
  )
}

function Levels({ fit }: { fit: Fit }) {
  const t = fit.treatment
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 font-semibold ${LEVEL[fit.potential_level]}`} title="Best achievable with practical treatment">
        {fit.potential_level}
      </span>
      <span className={`rounded px-1.5 py-0.5 opacity-70 ${LEVEL[fit.level]}`} title="The room as modeled now: furniture included, no acoustic treatment">
        as is: {fit.level}
      </span>
      {t && t.verdict === 'add_absorption' && <span className="text-zinc-400">~{t.panels} panels</span>}
      {t && t.verdict === 'impractical' && <span className="text-red-300">too much treatment</span>}
      {t && t.verdict === 'too_dead' && <span className="text-amber-300">too dead</span>}
    </div>
  )
}

function Reasons({ fit }: { fit: Fit }) {
  return (
    <ul className="space-y-1">
      {fit.treatment && (
        <li className="text-violet-200">
          Treatment: {fit.treatment.reason}
        </li>
      )}
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

/** Headline from the per-use verdicts: which room wins which uses. Counts only, no score. */
function Verdict({ verdicts, a, b }: { verdicts: UseCaseVerdict[]; a?: string; b?: string }) {
  const by = (s: 'A' | 'B' | null) => verdicts.filter((v) => v.better === s).map((v) => v.label.toLowerCase())
  const [wa, wb, tie] = [by('A'), by('B'), by(null)]
  const list = (xs: string[]) => xs.join(', ')
  return (
    <div className="mb-3 rounded-lg bg-zinc-950/60 p-3 text-sm" data-testid="verdict">
      {wa.length > 0 && (
        <div>
          <span className="font-semibold text-sky-300">Room A{a ? ` (${a})` : ''}</span> is the better fit for{' '}
          {list(wa)}.
        </div>
      )}
      {wb.length > 0 && (
        <div>
          <span className="font-semibold text-fuchsia-300">Room B{b ? ` (${b})` : ''}</span> is the better fit for{' '}
          {list(wb)}.
        </div>
      )}
      {tie.length > 0 && <div className="text-zinc-400">No clear difference for {list(tie)}.</div>}
      <div className="mt-1 text-[11px] text-zinc-500">
        From the rule-based checks below on the modeled numbers; open a row for the reasons.
      </div>
    </div>
  )
}
