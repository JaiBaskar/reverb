import type { SlotRef } from '../../roomRef'
import { Dot, Sheet } from '../../ui/kit'
import { outsideRating, reverbRating, TONE_TEXT } from '../../ui/rating'
import { midRt60 } from '../acoustic-visualization/classify'
import { ambienceLayers } from '../audio/ambience'
import { AudioLab } from '../audio/AudioLab'
import { useVerdict } from '../decide/useVerdict'
import { thumbUrl } from '../../ui/format'
import { Explanation } from '../numbers/Explanation'
import { NumbersPanel } from '../numbers/NumbersPanel'
import { useComparison } from '../numbers/useComparison'
import { useReport } from '../numbers/useReport'
import { useNoiseRisk } from '../risk/useNoiseRisk'
import { SuitabilityPanel } from '../suitability/SuitabilityPanel'

type Slot = 'A' | 'B'
/** Each home's room modelled from its scan, as on the room page. */
const NONE = { room_model: true }

interface Props {
  a: SlotRef
  b: SlotRef
  onOpen: (slot: Slot) => void
  onClose: () => void
}

/** Two rooms side by side (home-comparison style): verdict, the same facts per column, then listen A/B. */
export function ComparePage({ a, b, onOpen, onClose }: Props) {
  const repA = useReport(a.sid, a.roomId, NONE)
  const repB = useReport(b.sid, b.roomId, NONE)
  const riskA = useNoiseRisk(a.sid, true)
  const riskB = useNoiseRisk(b.sid, true)
  const vA = useVerdict(repA.report, riskA.risk)
  const vB = useVerdict(repB.report, riskB.risk)
  const cmp = useComparison({ sid: a.sid, roomId: a.roomId, materials: NONE }, { sid: b.sid, roomId: b.roomId, materials: NONE })

  const cols = [
    { slot: 'A' as Slot, ref: a, rep: repA, risk: riskA.risk, v: vA },
    { slot: 'B' as Slot, ref: b, rep: repB, risk: riskB.risk, v: vB },
  ]
  const rows: { label: string; cell: (c: (typeof cols)[number]) => { text: string; sub?: string; tone?: 'good' | 'ok' | 'bad' } }[] = [
    {
      label: 'Reverb',
      cell: (c) => {
        const m = c.rep.report ? midRt60(c.rep.report) : null
        return m == null ? { text: '…' } : { text: `${m.toFixed(2)} s`, sub: reverbRating(m).label, tone: reverbRating(m).tone }
      },
    },
    {
      label: 'Outside',
      cell: (c) => {
        const o = c.risk ? outsideRating(c.risk.ranked) : null
        return o ? { text: o.label, sub: o.detail, tone: o.tone } : { text: '…' }
      },
    },
    { label: 'Panels to fix', cell: (c) => ({ text: c.v ? String(c.v.panels) : '…' }) },
    { label: 'Size', cell: (c) => ({ text: c.rep.report ? `${Math.round(c.rep.report.geometry.volume_m3)} m³` : '…' }) },
  ]

  return (
    <Sheet title="Compare" sub={`${a.label} vs ${b.label}`} onClose={onClose} testId="compare-page">
      <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-6">
          {cols.map((c) => (
            <button key={c.slot} onClick={() => onOpen(c.slot)} className="flex min-w-0 flex-col justify-start text-left" data-testid={`verdict-${c.slot}`}>
              <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-soft">
                <img src={thumbUrl(c.ref.sid)} alt="" className="h-full w-full object-cover" />
                <span className={`absolute left-2 top-2 h-3 w-3 rounded-full ring-2 ring-paper ${c.slot === 'A' ? 'bg-a' : 'bg-b'}`} />
              </div>
              <div className="mt-2 truncate font-semibold">{c.ref.address}</div>
              <div className="truncate text-sm text-mute">{c.ref.label}</div>
              <div className={`mt-2 flex items-center gap-2 text-xl font-bold ${c.v ? TONE_TEXT[c.v.tone] : 'text-mute'}`}>
                {c.v && <Dot tone={c.v.tone} />}
                {c.v?.label ?? 'Measuring…'}
              </div>
              {c.v && <div className="mt-0.5 text-xs text-mute first-letter:uppercase">{c.v.reasons.join(' · ')}</div>}
            </button>
          ))}
        </div>

        <table className="w-full table-fixed text-sm" data-testid="compare-table">
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.label}>
                <th className="w-24 py-2.5 pr-2 text-left align-top font-normal text-mute sm:w-36">{r.label}</th>
                {cols.map((c) => {
                  const v = r.cell(c)
                  return (
                    <td key={c.slot} className="py-2.5 pr-2 align-top">
                      <span className="inline-flex max-w-full items-center gap-2 font-medium">
                        {v.tone && <Dot tone={v.tone} />}
                        <span className="truncate">{v.text}</span>
                      </span>
                      {v.sub && <div className="truncate text-xs text-mute">{v.sub}</div>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Listen</h2>
          <AudioLab
            a={a}
            b={b}
            materials={{ A: NONE, B: NONE }}
            names={{ A: shortAddr(a.address), B: shortAddr(b.address) }}
            outside={{ A: ambienceLayers(riskA.risk?.ranked ?? []), B: ambienceLayers(riskB.risk?.ranked ?? []) }}
          />
        </section>

        <details className="rounded-2xl border border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Why they differ</summary>
          <div className="space-y-4 px-4 pb-4">
            <Explanation {...cmp} />
            <SuitabilityPanel a={repA.report} b={repB.report} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {cols.map((c) => (
                <NumbersPanel
                  key={c.slot}
                  slot={c.slot}
                  {...c.rep}
                  maxRt60={Math.max(0.1, ...(repA.report?.rt60_s ?? []), ...(repB.report?.rt60_s ?? []))}
                />
              ))}
            </div>
          </div>
        </details>
      </div>
    </Sheet>
  )
}

const shortAddr = (s: string) => s.split(',')[0] || s
