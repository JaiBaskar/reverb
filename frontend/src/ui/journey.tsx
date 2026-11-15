import type { ReactNode } from 'react'
import { STEPS, type StepId } from './steps'

/** The four steps across the top. Steps you can't use yet are disabled, so the order is obvious. */
export function Stepper({
  done,
  reachable,
  active,
  onSelect,
}: {
  done: Record<StepId, boolean>
  reachable: Record<StepId, boolean>
  active: StepId
  onSelect: (id: StepId) => void
}) {
  return (
    <ol className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm" aria-label="Progress" data-testid="stepper">
      {STEPS.map((s, i) => {
        const on = s.id === active
        const tick = done[s.id] && !on
        return (
          <li key={s.id} className="flex items-center">
            {i > 0 && <span className={`mx-1 h-px w-4 sm:w-8 ${done[STEPS[i - 1].id] ? 'bg-emerald-500/60' : 'bg-zinc-700'}`} />}
            <button
              onClick={() => onSelect(s.id)}
              disabled={!reachable[s.id]}
              aria-current={on ? 'step' : undefined}
              className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                on ? 'bg-amber-400 font-semibold text-black' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
              data-testid={`stepper-${s.id}`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${
                  tick ? 'bg-emerald-500 text-black' : on ? 'bg-black/20' : 'bg-zinc-800'
                }`}
              >
                {tick ? '✓' : i + 1}
              </span>
              <span className={on ? '' : 'hidden sm:inline'}>{s.title}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Back / Next at the bottom: Next stays off, with the reason, until the step has what it needs. */
export function StepNav({
  active,
  need,
  onGo,
  last,
}: {
  active: StepId
  need: string | null
  onGo: (id: StepId) => void
  last?: ReactNode
}) {
  const i = STEPS.findIndex((s) => s.id === active)
  const prev = STEPS[i - 1]
  const next = STEPS[i + 1]
  return (
    <nav
      className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur"
      aria-label="Step navigation"
      data-testid="step-nav"
    >
      {prev ? (
        <button onClick={() => onGo(prev.id)} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700" data-testid="step-back">
          ← Back
        </button>
      ) : (
        <span />
      )}
      <span className="min-w-0 flex-1 truncate text-center text-sm text-zinc-400" data-testid="step-need">
        {need ?? ''}
      </span>
      {next ? (
        <button
          onClick={() => onGo(next.id)}
          disabled={need != null}
          className="rounded-lg bg-amber-400 px-5 py-2 text-sm font-semibold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          data-testid="step-next"
        >
          {next.title} →
        </button>
      ) : (
        last ?? <span />
      )}
    </nav>
  )
}

/** A step's heading: what this step is for, in one line. */
export function StepHeader({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">{title}</h1>
        {children && <p className="mt-1 max-w-prose text-sm text-zinc-400">{children}</p>}
      </div>
      {aside}
    </header>
  )
}

/** Small label for where a number comes from. */
export function Tag({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'amber' | 'sky' | 'fuchsia' }) {
  const c = {
    zinc: 'bg-zinc-800 text-zinc-300',
    amber: 'bg-amber-500/15 text-amber-300',
    sky: 'bg-sky-500/15 text-sky-300',
    fuchsia: 'bg-fuchsia-500/15 text-fuchsia-300',
  }[tone]
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${c}`}>{children}</span>
}
