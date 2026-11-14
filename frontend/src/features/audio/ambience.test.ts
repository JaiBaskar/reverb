import { describe, expect, it } from 'vitest'
import { AMBIENT_KINDS, ambienceLayers, synthAmbience } from './ambience'

const ranked = [
  { category: 'road_major', risk: 0.85, level: 'high' as const, name: 'Sunset Blvd', distance_m: 32 },
  { category: 'road_major', risk: 0.5, level: 'moderate' as const, name: 'Western Ave', distance_m: 116 },
  { category: 'venue', risk: 0.3, level: 'low' as const, name: 'Bar', distance_m: 175 },
  { category: 'school', risk: 0.34, level: 'low' as const, name: 'School', distance_m: 140 },
]

describe('ambienceLayers', () => {
  it('keeps the strongest source per sound kind, scaled by its risk, loudest first', () => {
    const layers = ambienceLayers(ranked)
    expect(layers.map((l) => l.kind)).toEqual(['traffic', 'venue'])
    expect(layers[0].gain).toBeGreaterThan(layers[1].gain)
    expect(layers[0].source).toContain('Sunset Blvd')
  })

  it('is empty for a quiet neighbourhood', () => {
    expect(ambienceLayers([])).toEqual([])
  })
})

describe('synthAmbience', () => {
  it('is deterministic, bounded and not silent for every kind', () => {
    for (const kind of AMBIENT_KINDS) {
      const a = synthAmbience(kind, 8000, 4)
      const b = synthAmbience(kind, 8000, 4)
      expect(a).toEqual(b)
      const peak = Math.max(...a.map(Math.abs))
      expect(peak).toBeGreaterThan(0.01)
      expect(peak).toBeLessThanOrEqual(1)
    }
  })
})
