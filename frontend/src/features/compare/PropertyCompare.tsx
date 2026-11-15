import { useEffect, useState } from 'react'
import { fetchAnalysis, type HouseAnalysis } from '../../api'
import type { SlotRef } from '../../roomRef'
import { Sheet } from '../../ui/kit'
import { ComparePage } from './ComparePage'

interface Home {
  sid: string
  address: string
}

type Side = { analysis?: HouseAnalysis; error?: string }

/** Two homes, each analyzed whole and represented by its best music room. */
export function PropertyCompare({ a, b, onOpen, onClose }: { a: Home; b: Home; onOpen: (ref: SlotRef, note?: string) => void; onClose: () => void }) {
  const [sides, setSides] = useState<Record<string, Side>>({})
  useEffect(() => {
    let live = true
    for (const h of [a, b])
      fetchAnalysis(h.sid)
        .then((analysis) => live && setSides((s) => ({ ...s, [h.sid]: { analysis } })))
        .catch((e: Error) => live && setSides((s) => ({ ...s, [h.sid]: { error: e.message } })))
    return () => {
      live = false
    }
  }, [a, b])

  const ref = (h: Home): SlotRef | null => {
    const best = sides[h.sid]?.analysis?.best
    return best ? { sid: h.sid, roomId: best.room_id, label: best.label, address: h.address } : null
  }
  const note = (h: Home) => {
    const an = sides[h.sid]?.analysis
    return an ? `Best of ${an.rooms.filter((r) => r.eligible).length} music-room candidates` : undefined
  }
  const ra = ref(a)
  const rb = ref(b)
  if (ra && rb) return <ComparePage a={ra} b={rb} onOpen={(s) => onOpen(s === 'A' ? ra : rb, note(s === 'A' ? a : b))} onClose={onClose} />

  const problem = [a, b].map((h) => {
    const s = sides[h.sid]
    if (!s) return null
    if (s.error) return `${h.address}: analysis failed (${s.error})`
    if (!s.analysis?.best) return `${h.address}: no room here is a music-room candidate`
    return null
  })
  return (
    <Sheet title="Compare" sub={`${a.address} vs ${b.address}`} onClose={onClose} testId="compare-page">
      <div className="mx-auto max-w-xl p-6 text-center">
        {problem.some(Boolean) ? (
          problem.filter(Boolean).map((t) => (
            <p key={t} className="text-sm text-bad">
              {t}
            </p>
          ))
        ) : (
          <p className="text-mute">Analyzing every room of both homes…</p>
        )}
      </div>
    </Sheet>
  )
}
