import type { ReactNode } from 'react'
import { STEPS, type StepId, type StepState } from './steps'

const scrollTo = (id: StepId) =>
  document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** The seven-step journey; the first unfinished step is "current". */
export function Stepper({ done }: { done: Record<StepId, boolean> }) {
  const current = STEPS.find((s) => !done[s.id])?.id
  return (
    <ol className="flex min-w-0 gap-1 overflow-x-auto text-xs" aria-label="Progress" data-testid="stepper">
      {STEPS.map((s, i) => {
        const state: StepState = done[s.id] ? 'done' : s.id === current ? 'current' : 'todo'
        return (
          <li key={s.id}>
            <button
              onClick={() => scrollTo(s.id)}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 transition ${
                state === 'current'
                  ? 'bg-amber-400 font-semibold text-black'
                  : state === 'done'
                    ? 'text-zinc-200 hover:bg-zinc-800'
                    : 'text-zinc-500 hover:bg-zinc-800'
              }`}
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${
                  state === 'done' ? 'bg-emerald-500 text-black' : state === 'current' ? 'bg-black/20' : 'bg-zinc-800'
                }`}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              {s.title}
            </button>
          </li>
        )
      })}
    </ol>
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
