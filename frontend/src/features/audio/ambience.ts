/**
 * Illustrative outside noise for the audio demo, built from a property's noise-risk ranking.
 *
 * Nothing here is measured: each kind of nearby source (traffic, trains, aircraft, sirens,
 * venues, works) gets a synthetic loop, and its level follows that source's relative risk
 * (intrusiveness x proximity) from the backend. The mix is low-passed as if heard through a
 * wall. It answers "what kind of noise, how often, roughly how dominant", never "how many dB".
 */

export type AmbientKind = 'traffic' | 'rail' | 'aircraft' | 'helicopter' | 'siren' | 'venue' | 'works'
export const AMBIENT_KINDS: AmbientKind[] = ['traffic', 'rail', 'aircraft', 'helicopter', 'siren', 'venue', 'works']

const KIND_OF: Record<string, AmbientKind> = {
  road_major: 'traffic',
  road_minor: 'traffic',
  transit: 'traffic',
  rail: 'rail',
  airport: 'aircraft',
  heliport: 'helicopter',
  emergency: 'siren',
  venue: 'venue',
  construction: 'works',
  industrial: 'works',
}

export const KIND_LABEL: Record<AmbientKind, string> = {
  traffic: 'Traffic rumble',
  rail: 'Train pass-bys',
  aircraft: 'Aircraft overhead',
  helicopter: 'Helicopters',
  siren: 'Sirens',
  venue: 'Venue bass at night',
  works: 'Construction / works',
}

export interface RiskRow {
  category: string
  risk: number
  level: 'low' | 'moderate' | 'high'
  name: string | null
  distance_m: number
}

export interface AmbienceLayer {
  kind: AmbientKind
  gain: number // linear, relative to the music; follows the risk score only
  source: string
}

const MIN_RISK = 0.15
const MAX_GAIN = 0.35

/** Strongest source per kind (risk >= MIN_RISK), gain proportional to risk, loudest first. */
export function ambienceLayers(ranked: RiskRow[]): AmbienceLayer[] {
  const best = new Map<AmbientKind, RiskRow>()
  for (const r of ranked) {
    const kind = KIND_OF[r.category]
    if (!kind || r.risk < MIN_RISK) continue
    if (!best.has(kind) || best.get(kind)!.risk < r.risk) best.set(kind, r)
  }
  return [...best.entries()]
    .map(([kind, r]) => ({
      kind,
      gain: MAX_GAIN * r.risk,
      source: `${r.name ?? KIND_LABEL[kind]}, ${Math.round(r.distance_m)} m (${r.level} risk)`,
    }))
    .sort((a, b) => b.gain - a.gain)
}

// Small seeded PRNG so loops are identical on every run.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** One loop of `seconds` at `sr` for a kind; peak-normalised to 0.9. */
export function synthAmbience(kind: AmbientKind, sr: number, seconds: number): number[] {
  const n = Math.floor(sr * seconds)
  const r = rng(AMBIENT_KINDS.indexOf(kind) + 7)
  const out = new Array<number>(n).fill(0)
  let brown = 0
  let lp = 0
  const white = () => r() * 2 - 1
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const w = white()
    brown = (brown + 0.02 * w) * 0.995
    lp += 0.05 * (w - lp)
    let v = 0
    switch (kind) {
      case 'traffic': // steady rumble with slow swells as cars pass
        v = brown * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.13 * t) * Math.sin(2 * Math.PI * 0.031 * t))
        break
      case 'rail': {
        // one pass-by per loop: rises, holds, fades; wheel clatter as a 9 Hz pulse
        const env = Math.exp(-(((t / seconds - 0.5) * 6) ** 2))
        v = (brown + 0.3 * lp) * env * (0.8 + 0.2 * Math.sign(Math.sin(2 * Math.PI * 9 * t)))
        break
      }
      case 'aircraft': {
        const env = Math.exp(-(((t / seconds - 0.45) * 4) ** 2))
        v = brown * env
        break
      }
      case 'helicopter': {
        const env = Math.exp(-(((t / seconds - 0.55) * 5) ** 2))
        v = brown * env * (0.5 + 0.5 * Math.max(0, Math.sin(2 * Math.PI * 11 * t)))
        break
      }
      case 'siren': {
        // wail for a third of the loop, then quiet
        const on = t / seconds > 0.3 && t / seconds < 0.63
        const f = 850 + 350 * Math.sin(2 * Math.PI * 0.35 * t)
        v = on ? Math.sin(2 * Math.PI * f * t) * Math.min(1, (t / seconds - 0.3) * 10, (0.63 - t / seconds) * 10) : 0
        break
      }
      case 'venue': {
        // muffled four-on-the-floor kick at 124 bpm
        const beat = (t * 124) / 60
        const ph = beat - Math.floor(beat)
        v = Math.sin(2 * Math.PI * (50 + 60 * Math.exp(-ph * 30)) * ph * 0.5) * Math.exp(-ph * 9)
        break
      }
      case 'works': {
        // irregular impacts
        const slot = Math.floor(t * 1.7)
        const local = t * 1.7 - slot
        const hit = rng(slot + 99)() < 0.55
        v = hit ? lp * 4 * Math.exp(-local * 18) : 0
        break
      }
    }
    out[i] = v
  }
  let peak = 1e-9
  for (const x of out) peak = Math.max(peak, Math.abs(x))
  return out.map((x) => (0.9 * x) / peak)
}
