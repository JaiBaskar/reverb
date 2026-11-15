import { describe, expect, it } from 'vitest'
import type { RankedSource } from '../features/risk/types'
import { outsideRating, reverbRating } from './rating'

const src = (level: RankedSource['level'], name: string | null = 'Main St', distance_m = 120): RankedSource => ({
  id: `way/${name}`,
  name,
  category: 'roads',
  subtype: 'highway=primary',
  distance_m,
  bearing_compass: 'N',
  lat: 0,
  lon: 0,
  osm_url: '',
  intensity: 1,
  proximity: 1,
  risk: 1,
  level,
  when: 'day',
  why: '',
})

describe('reverbRating', () => {
  it('grades the mid-band RT60 for a music room', () => {
    expect(reverbRating(0.45).tone).toBe('good')
    expect(reverbRating(0.8).tone).toBe('ok')
    expect(reverbRating(1.6).tone).toBe('bad')
    expect(reverbRating(0.12).tone).toBe('ok')
    expect(reverbRating(1.6).label).toBe('Echoey')
  })
})

describe('outsideRating', () => {
  it('is noisy with any high-risk source', () => {
    const r = outsideRating([src('moderate'), src('high', 'I-10', 80)])
    expect(r.tone).toBe('bad')
    expect(r.label).toBe('Noisy')
    expect(r.detail).toBe('I-10 · 80 m')
  })
  it('is so-so with many moderate sources', () => {
    expect(outsideRating(Array.from({ length: 5 }, () => src('moderate'))).tone).toBe('ok')
  })
  it('is quiet otherwise, and names the friendly subtype when unnamed', () => {
    const r = outsideRating([src('low', null, 300)])
    expect(r.tone).toBe('good')
    expect(r.detail).toBe('Primary · 300 m')
  })
  it('says so when nothing is mapped nearby', () => {
    expect(outsideRating([]).detail).toBe('Nothing mapped nearby')
  })
})
