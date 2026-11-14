import type { ReactNode } from 'react'
import { STEPS, type StepId, type StepState } from './steps'

/** The seven steps. One is open at a time; finished ones show a tick; any can be opened. */
export function Stepper({
  done,
  active,
  onSelect,
}: {
  done: Record<StepId, boolean>
  active: StepId
  onSelect: (id: StepId) => void
}) {
  return (
    <ol className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-xs" aria-label="Progress" data-testid="stepper">
      {STEPS.map((s, i) => {
        const on = s.id === active
        return (
          <li key={s.id} className="flex items-center">
            {i > 0 && <span className={`mx-0.5 h-px w-3 ${done[STEPS[i - 1].id] ? 'bg-emerald-500/60' : 'bg-zinc-700'}`} />}
            <button
              onClick={() => onSelect(s.id)}
              aria-current={on ? 'step' : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 transition ${
                on ? 'bg-amber-400 font-semibold text-black' : done[s.id] ? 'text-zinc-200 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-800'
              }`}
              data-testid={`stepper-${s.id}`}
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                  done[s.id] && !on ? 'bg-emerald-500 text-black' : on ? 'bg-black/20' : 'bg-zinc-800'
                }`}
              >
                {done[s.id] && !on ? '✓' : i + 1}
              </span>
              {s.title}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Back / Next bar at the bottom of the workspace: where you are and what the next step needs. */
export function StepNav({
  active,
  need,
  onGo,
}: {
  active: StepId
  /** Why Next is not possible yet (null when it is). */
  need: string | null
  onGo: (id: StepId) => void
}) {
  const i = STEPS.findIndex((s) => s.id === active)
  const prev = STEPS[i - 1]
  const next = STEPS[i + 1]
  return (
    <nav
      className="sticky bottom-0 z-10 -mx-4 mt-2 flex items-center gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 py-2.5 backdrop-blur"
      aria-label="Step navigation"
      data-testid="step-nav"
    >
      {prev ? (
        <button onClick={() => onGo(prev.id)} className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700" data-testid="step-back">
          ← {prev.title}
        </button>
      ) : (
        <span />
      )}
      <span className="min-w-0 flex-1 truncate text-center text-xs text-zinc-400" data-testid="step-need">
        Step {i + 1} of {STEPS.length}
        {need ? ` · ${need}` : ''}
      </span>
      {next ? (
        <button
          onClick={() => onGo(next.id)}
          disabled={need != null}
          className="rounded-md bg-amber-400 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          data-testid="step-next"
        >
          Next: {next.title} →
        </button>
      ) : (
        <span className="text-xs text-emerald-300">Done</span>
      )}
    </nav>
  )
}

interface StepProps {
  id: StepId
  title: string
  subtitle?: ReactNode
  aside?: ReactNode
  hint?: ReactNode
  state: StepState
  children?: ReactNode
}

/** One step of the journey as a card: number, title, what to do next, then its content. */
export function Step({ id, title, subtitle, aside, hint, state, children }: StepProps) {
  const n = STEPS.findIndex((s) => s.id === id) + 1
  return (
    <section
      id={`step-${id}`}
      data-testid={`step-${id}`}
      className={`scroll-mt-4 rounded-xl border bg-zinc-900/40 p-4 ${
        state === 'current' ? 'border-amber-400/50 shadow-[0_0_0_1px_rgba(251,191,36,0.15)]' : 'border-zinc-800'
      }`}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
              state === 'done' ? 'bg-emerald-500 text-black' : state === 'current' ? 'bg-amber-400 text-black' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {state === 'done' ? '✓' : n}
          </span>
          <div>
            <h2 className="text-base font-semibold leading-6 text-zinc-100">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
          </div>
        </div>
        {aside && <div className="text-xs text-zinc-500">{aside}</div>}
      </header>
      {hint && state !== 'done' && (
        <p className="mb-3 rounded-md bg-amber-400/10 px-3 py-2 text-xs text-amber-200" data-testid={`hint-${id}`}>
          {hint}
        </p>
      )}
      {children}
    </section>
  )
}

/** Small label for where a number or fact comes from. */
export function Tag({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'amber' | 'sky' | 'fuchsia' }) {
  const c = {
    zinc: 'bg-zinc-800 text-zinc-300',
    amber: 'bg-amber-500/15 text-amber-300',
    sky: 'bg-sky-500/15 text-sky-300',
    fuchsia: 'bg-fuchsia-500/15 text-fuchsia-300',
  }[tone]
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${c}`}>{children}</span>
}
