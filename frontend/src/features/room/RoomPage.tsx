import { type ReactNode, useEffect, useState } from 'react'
import { parseCustomRoomId, type SlotRef } from '../../roomRef'
import type { MaterialCatalog, MaterialSelection } from '../../types'
import { Button, Dot, Sheet, Stat } from '../../ui/kit'
import { outsideRating, reverbRating } from '../../ui/rating'
import { midRt60 } from '../acoustic-visualization/classify'
import { ambienceLayers } from '../audio/ambience'
import { AudioLab } from '../audio/AudioLab'
import { useVerdict } from '../decide/useVerdict'
import { VERDICT_RULES } from '../decide/verdict'
import { FurnitureEditor } from '../furniture/FurnitureEditor'
import { MaterialEditor } from '../materials/MaterialEditor'
import { NumbersPanel } from '../numbers/NumbersPanel'
import { useReport } from '../numbers/useReport'
import type { NoiseRisk } from '../risk/types'
import { SuitabilityPanel } from '../suitability/SuitabilityPanel'
import { TreatmentStep } from '../treatment/TreatmentStep'
import { InspectionCard, InspectionDetails } from './InspectionCard'
import { seen, useInspection } from './useInspection'
import type { TreatmentPlan } from '../treatment/types'

type SectionId = 'overview' | 'fix' | 'details' | 'listen'

interface Props {
  room: SlotRef
  risk: NoiseRisk | null
  catalog: MaterialCatalog | null
  /** Why this room was opened, e.g. "Best of 8 music-room candidates". */
  note?: string
  /** Open another room of the same home (e.g. one picked in the treatment plan). */
  onOpenRoom?: (roomId: string, label: string) => void
  onHeatmap: () => void
  onClose: () => void
}

/**
 * One room on ONE scrolling page: overview (verdict, numbers, AI inspection), fix it (treatment
 * plan in 3D), details (folded), and last, listen: test the reverb with your own recording.
 * A sticky bar jumps between the sections.
 */
export function RoomPage({ room, risk, catalog, note, onOpenRoom, onHeatmap, onClose }: Props) {
  const [sel, setSel] = useState<MaterialSelection>({})
  const [treated, setTreated] = useState<{ sel: MaterialSelection; label: string } | null>(null)
  const [objective, setObjective] = useState('mixing')
  const [active, setActive] = useState<SectionId>('overview')
  const scanned = !parseCustomRoomId(room.roomId)
  const inspection = useInspection(room.sid, room.roomId, scanned)
  // Once the AI has looked, the room is modelled from what it saw (materials, furniture, windows).
  const base: MaterialSelection = seen(inspection.status) ? { ...sel, room_model: true } : sel
  const rep = useReport(room.sid, room.roomId, base)
  const verdict = useVerdict(rep.report, risk)
  const mid = rep.report ? midRt60(rep.report) : null
  const rate = mid != null ? reverbRating(mid) : null
  const outside = risk ? outsideRating(risk.ranked) : null
  const lowest = rep.report?.modes.length ? Math.min(...rep.report.modes.map((m) => m.freq_hz)) : null
  const layers = ambienceLayers(risk?.ranked ?? [])

  const sections: { id: SectionId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(scanned ? [{ id: 'fix' as const, label: 'Fix it' }] : []),
    { id: 'details', label: 'Details' },
    { id: 'listen', label: 'Listen' },
  ]
  const go = (id: SectionId) => {
    setActive(id)
    // Smooth scrolling needs animation frames, which a hidden page does not get.
    const behavior = document.visibilityState === 'visible' ? 'smooth' : 'auto'
    document.getElementById(`room-${id}`)?.scrollIntoView({ behavior, block: 'start' })
  }
  // Highlight the section being read.
  useEffect(() => {
    const els = sections.map((x) => document.getElementById(`room-${x.id}`)).filter((e): e is HTMLElement => !!e)
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id.replace('room-', '') as SectionId)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [scanned]) // eslint-disable-line react-hooks/exhaustive-deps

  const hearTreated = (plan: TreatmentPlan, avoid: number[]) => {
    const b: MaterialSelection = {
      ...Object.fromEntries(plan.room.materials.map((m) => [m.surface, m.material_id])),
      furniture: plan.room.furniture,
      room_model: true,
    }
    setSel(b)
    setTreated({ sel: { ...b, treatment: plan.objective.id, treatment_avoid: avoid }, label: `Treated for ${plan.objective.label.toLowerCase()}` })
    setTimeout(() => go('listen'), 50)
  }

  return (
    <Sheet
      title={room.label}
      sub={[note, room.address].filter(Boolean).join(' · ')}
      onClose={onClose}
      testId="room-page"
      actions={
        scanned && (
          <Button size="sm" onClick={onHeatmap} data-testid="open-heatmap" className="hidden sm:inline-flex">
            3D heatmap
          </Button>
        )
      }
    >
      <nav className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur" data-testid="room-nav">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 sm:px-6">
          {sections.map((x) => (
            <button
              key={x.id}
              onClick={() => go(x.id)}
              className={`h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold transition ${active === x.id ? 'bg-ink text-paper' : 'text-mute hover:bg-soft hover:text-ink'}`}
              data-testid={`nav-${x.id}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-6xl space-y-10 p-4 pb-24 sm:p-6">
        <Section id="overview">
          <div data-testid="verdict">
            {verdict ? (
              <>
                <div className="flex items-center gap-3">
                  <Dot tone={verdict.tone} className="h-4 w-4" />
                  <h1 className="text-3xl font-bold">{verdict.label}</h1>
                </div>
                <p className="mt-1 text-sm text-mute first-letter:uppercase" title={VERDICT_RULES.join('\n')}>
                  {verdict.reasons.join(' · ')}
                </p>
              </>
            ) : (
              <h1 className="text-3xl font-bold text-mute">{rep.error ? 'Could not model this room' : 'Analyzing…'}</h1>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Reverb" value={mid != null ? `${mid.toFixed(2)} s` : '…'} tone={rate?.tone} sub={rate?.label} testId="stat-reverb" />
            <Stat label="Outside" value={outside?.label ?? '…'} tone={outside?.tone} sub={outside?.detail} testId="stat-outside" />
            <Stat label="Panels to fix" value={verdict ? verdict.panels : '…'} sub="for mixing" testId="stat-panels" />
            <Stat label="Lowest boom" value={lowest != null ? `${Math.round(lowest)} Hz` : '…'} sub="room mode" testId="stat-bass" />
          </div>
          {scanned && (
            <div className="mt-4">
              <InspectionCard status={inspection.status} onStart={inspection.start} />
            </div>
          )}
          <button className="mt-4 text-sm font-semibold text-accent" onClick={() => go('listen')} data-testid="to-listen">
            Test the reverb ↓
          </button>
        </Section>

        {scanned && (
          <Section id="fix" title="Fix it">
            <TreatmentStep key={`${room.sid}/${room.roomId}`} room={room} objective={objective} onObjective={setObjective} onHearTreated={hearTreated} onOpenRoom={onOpenRoom} />
          </Section>
        )}

        <Section id="details" title="Details">
          <div className="space-y-2">
            {scanned && (
              <Fold title="What the AI saw">
                <InspectionDetails status={inspection.status} />
              </Fold>
            )}
            <Fold title="Adjust furniture and surfaces">
              <div className="space-y-3">
                {catalog && <MaterialEditor slot="A" catalog={catalog} value={sel} onChange={setSel} />}
                {rep.report && (
                  <FurnitureEditor
                    current={rep.report.furniture ?? []}
                    edited={sel.furniture !== undefined}
                    compact
                    onChange={(items) => {
                      const { furniture: _drop, ...rest } = sel
                      void _drop
                      setSel(items === undefined ? rest : { ...rest, furniture: items })
                    }}
                  />
                )}
              </div>
            </Fold>
            <Fold title="Fit by use">
              <SuitabilityPanel a={rep.report} />
            </Fold>
            <Fold title="All the numbers">
              <NumbersPanel slot="A" {...rep} maxRt60={Math.max(0.1, ...(rep.report?.rt60_s ?? []))} />
            </Fold>
          </div>
        </Section>

        <Section id="listen" title="Listen: test the reverb">
          <AudioLab
            a={room}
            b={treated ? { ...room, label: treated.label } : null}
            materials={{ A: base, B: treated?.sel ?? {} }}
            active={active === 'listen'}
            names={{ A: 'This room', B: treated ? 'Treated' : undefined }}
            outside={{ A: layers, B: layers }}
          />
          {!treated && scanned && (
            <button className="mt-3 text-sm font-semibold text-accent" onClick={() => go('fix')} data-testid="to-treat">
              Want to hear it treated? Plan it in Fix it ↑
            </button>
          )}
        </Section>
      </div>
    </Sheet>
  )
}

function Section({ id, title, children }: { id: SectionId; title?: string; children: ReactNode }) {
  return (
    <section id={`room-${id}`} className="scroll-mt-16" data-testid={`section-${id}`}>
      {title && <h2 className="mb-4 text-2xl font-bold">{title}</h2>}
      {children}
    </section>
  )
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-line">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{title}</summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}
