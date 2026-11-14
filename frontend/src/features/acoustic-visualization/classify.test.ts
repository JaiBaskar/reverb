import { describe, expect, it } from 'vitest'
import report from '../../../../contract/fixtures/acoustic_report_zvKHR9DHNjJ_living_room.json'
import suit from '../../../../contract/fixtures/suitability_zvKHR9DHNjJ_living_room.json'
import type { AcousticReport } from '../../types'
import type { SuitabilityReport } from '../suitability/types'
import { classifyRoom, FIT_BINS, legendFor, midRt60, NEUTRAL } from './classify'

const rep = report as unknown as AcousticReport
const s = suit as unknown as SuitabilityReport
const data = { report: rep, suitability: s, loading: false }

const withFit = (level: 'good' | 'workable' | 'poor', shape: 'good' | 'workable' | 'poor' | null) => ({
  ...data,
  suitability: {
    ...s,
    fits: [
      {
        use_case: 'acoustic_guitar',
        label: 'Acoustic guitar recording',
        level,
        shape_level: shape,
        checks: [
          { id: 'rt60', label: 'Reverberation', status: 'fail' as const, reason: 'Mid RT60 1.99 s', treatable: true },
          { id: 'volume', label: 'Room volume', status: 'pass' as const, reason: 'Volume 77 m3', treatable: false },
          { id: 'mode_gap', label: 'Bass mode spacing', status: 'caution' as const, reason: 'gap 33 Hz', treatable: false },
        ],
      },
    ],
  },
})

describe('classifyRoom', () => {
  it('greys out unusable, loading and failed rooms without inventing a class', () => {
    expect(classifyRoom(data, false, 'fit', 'vocal', 'modeled')).toMatchObject({ key: 'unmodeled', color: NEUTRAL })
    expect(classifyRoom({ loading: true }, true, 'fit', 'vocal', 'modeled').key).toBe('loading')
    expect(classifyRoom({ loading: false, error: 'HTTP 500' }, true, 'rt60', 'vocal', 'modeled')).toMatchObject({
      key: 'error',
      why: ['HTTP 500'],
    })
  })

  it('uses the backend fit level as modeled, with failing checks first in the reasons', () => {
    const c = classifyRoom(withFit('poor', 'workable'), true, 'fit', 'acoustic_guitar', 'modeled')
    expect(c.color).toBe(FIT_BINS.poor.color)
    expect(c.why[0]).toMatch(/^Reverberation/)
    expect(c.why).toHaveLength(2)
  })

  it('shape basis uses shape_level and only untreatable checks', () => {
    const c = classifyRoom(withFit('poor', 'workable'), true, 'fit', 'acoustic_guitar', 'shape')
    expect(c.key).toBe('workable')
    expect(c.why).toEqual(['Bass mode spacing: gap 33 Hz'])
    expect(classifyRoom(withFit('good', null), true, 'fit', 'acoustic_guitar', 'shape').key).toBe('n/a')
  })

  it('reports a missing profile rather than a colour', () => {
    expect(classifyRoom(data, true, 'fit', 'no_such_profile', 'modeled').key).toBe('error')
  })

  it('bins mid RT60 from the report (display only)', () => {
    const mid = midRt60(rep)
    const c = classifyRoom(data, true, 'rt60', 'vocal', 'modeled')
    expect(c.value).toBe(`${mid.toFixed(2)} s`)
    expect(legendFor('rt60').map((b) => b.key)).toContain(c.key)
  })

  it('bins the Schroeder frequency for the bass view', () => {
    const c = classifyRoom(data, true, 'bass', 'vocal', 'modeled')
    expect(c.value).toBe(`${rep.schroeder_hz.toFixed(0)} Hz`)
    const r2 = { ...rep, schroeder_hz: 250 }
    expect(classifyRoom({ ...data, report: r2 }, true, 'bass', 'vocal', 'modeled').key).toBe('very-high')
  })
})
