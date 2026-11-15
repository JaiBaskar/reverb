import { Button, Dot } from '../../ui/kit'
import { seen, type InspectStatus } from './useInspection'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const short = (m: string | null) => (m ?? '').split('/').pop()?.replace(':free', '') ?? ''

/** One line on the room page: what the room is made of, and whether the AI has looked. */
export function InspectionCard({ status, onStart }: { status: InspectStatus | null; onStart: (fresh?: boolean) => void }) {
  const m = status?.model
  const ok = seen(status)
  let body
  if (!status) body = <span className="text-mute">Checking…</span>
  else if (status.state === 'running')
    body = (
      <span className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
        AI inspecting the scan photos · {mmss(status.elapsed_s ?? 0)}
        <span className="hidden text-mute sm:inline">(coordinator + 3 vision agents, a few minutes)</span>
      </span>
    )
  else if (ok && m) {
    const mats = m.materials.map((x) => `${x.label}${x.provenance === 'observed' ? '' : ' (typical)'}`)
    const pieces = m.pieces.reduce((n, p) => n + p.count, 0)
    body = (
      <span className="flex min-w-0 items-center gap-2">
        <Dot tone="good" />
        <span className="truncate">
          Seen by AI: {mats.join(' · ')} · {pieces} furniture piece{pieces === 1 ? '' : 's'}
        </span>
      </span>
    )
  } else
    body = (
      <span className="flex min-w-0 items-center gap-2">
        <Dot />
        <span className="truncate text-mute">
          {status.state === 'error' || m?.vision_status === 'error'
            ? `AI inspection failed: ${status.error ?? m?.vision_reason ?? 'unknown error'}`
            : 'Materials and furniture are typical for this room type'}
        </span>
      </span>
    )

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5 text-sm" data-testid="inspection">
      <div className="min-w-0 flex-1">{body}</div>
      {status && status.state !== 'running' && (
        <Button size="sm" kind={ok ? 'ghost' : 'primary'} onClick={() => onStart(ok || status.state === 'error')} data-testid="inspect">
          {ok ? 'Re-inspect' : status.state === 'error' || m?.vision_status === 'error' ? 'Retry' : 'Inspect with AI'}
        </Button>
      )}
    </div>
  )
}

/** Everything the agents reported, for the Details tab. */
export function InspectionDetails({ status }: { status: InspectStatus | null }) {
  const m = status?.model
  if (!m) return <p className="text-sm text-mute">Not inspected yet.</p>
  const ins = m.inspection
  return (
    <div className="space-y-4 text-sm" data-testid="inspection-details">
      {ins && (
        <div className="text-xs text-mute">
          {ins.orchestrator === 'deepagents'
            ? `Deep Agents coordinator (${short(ins.coordinator_model)}) → walls, furniture and surroundings vision agents (${short(ins.vision_model)})`
            : `Vision agents run directly (${short(ins.vision_model)})${ins.reason ? `: ${ins.reason}` : ''}`}
          {ins.seconds != null && ` · ${mmss(ins.seconds)}`}
        </div>
      )}
      {ins?.summary && <p>{ins.summary}</p>}
      <table className="w-full text-left">
        <tbody className="divide-y divide-line">
          {m.materials.map((x) => (
            <tr key={x.surface}>
              <td className="w-20 py-1.5 capitalize text-mute">{x.surface}</td>
              <td className="py-1.5">{x.label}</td>
              <td className="py-1.5 text-right text-xs text-mute">
                {x.provenance === 'observed' ? `seen${x.confidence != null ? ` · ${Math.round(x.confidence * 100)}%` : ''}` : 'typical'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.pieces.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Furniture seen</div>
          <ul className="flex flex-wrap gap-1.5">
            {m.pieces.map((p, i) => (
              <li key={i} className="rounded-full bg-soft px-2.5 py-1 text-xs">
                {p.count > 1 ? `${p.count} × ` : ''}
                {p.label} <span className="text-mute">({p.covering})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.hazards.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Things that hurt the sound</div>
          <ul className="space-y-1">
            {m.hazards.map((h, i) => (
              <li key={i} className="flex gap-2">
                <Dot tone="ok" className="mt-1.5 h-2 w-2" />
                <span>
                  {h.kind.replace(/_/g, ' ')}: <span className="text-mute">{h.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ins && (ins.cross_checks.length > 0 || ins.rechecked.length > 0 || ins.gaps.length > 0) && (
        <details className="rounded-xl border border-line px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold">Coordinator's cross-checks</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-mute">
            {[...ins.cross_checks, ...ins.rechecked.map((r) => `Second look: ${r}`), ...ins.gaps.map((g) => `Not established: ${g}`)].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-[11px] text-mute">The agents only name materials and objects; absorption and every acoustic number come from REVERB's tables and physics.</p>
    </div>
  )
}
