import { type ButtonHTMLAttributes, type ReactNode, useEffect } from 'react'
import { TONE_BG, TONE_TEXT, type Tone } from './rating'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'outline' | 'ghost'; size?: 'sm' | 'md' }

/** Three buttons only: primary (blue, one per view), outline, ghost. */
export function Button({ kind = 'outline', size = 'md', className = '', ...rest }: BtnProps) {
  const k = {
    primary: 'bg-accent text-paper hover:brightness-110',
    outline: 'border border-line bg-paper text-ink hover:bg-soft',
    ghost: 'text-ink hover:bg-soft',
  }[kind]
  const s = size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm'
  return (
    <button
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${k} ${s} ${className}`}
      {...rest}
    />
  )
}

export const Dot = ({ tone, className = '' }: { tone?: Tone; className?: string }) => (
  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone ? TONE_BG[tone] : 'bg-line'} ${className}`} />
)

/** A labelled number or word, Zillow-fact style. */
export function Stat({ label, value, tone, sub, testId }: { label: string; value: ReactNode; tone?: Tone; sub?: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line p-3" data-testid={testId}>
      <div className="text-xs text-mute">{label}</div>
      <div className={`mt-0.5 flex items-center gap-2 truncate text-lg font-semibold ${tone ? TONE_TEXT[tone] : ''}`}>
        {tone && <Dot tone={tone} />}
        <span className="truncate">{value}</span>
      </div>
      {sub && <div className="truncate text-xs text-mute">{sub}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-6 border-b border-line" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          onClick={() => onChange(o.id)}
          className={`-mb-px border-b-2 pb-2.5 text-sm font-semibold transition ${
            o.id === value ? 'border-ink text-ink' : 'border-transparent text-mute hover:text-ink'
          }`}
          data-testid={`tab-${o.id}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Full-screen page over the map (like a listing opened on Zillow). Esc closes it. */
export function Sheet({ title, sub, onClose, actions, children, testId }: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
  testId?: string
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-paper" data-testid={testId}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-soft" aria-label="Close" data-testid="sheet-close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{title}</div>
          {sub && <div className="truncate text-xs text-mute">{sub}</div>}
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}

export const Muted = ({ children }: { children: ReactNode }) => <p className="text-sm text-mute">{children}</p>

/** Small print for provenance; one line, never a paragraph. */
export const Fine = ({ children }: { children: ReactNode }) => <p className="text-[11px] text-mute">{children}</p>
