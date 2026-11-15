import { describe, expect, it } from 'vitest'
import type { Check, Fit, Treatment } from '../suitability/types'
import { houseVerdict, whyMixingFails } from './verdict'

const base = { mixing: 'workable', vocal: 'good', panels: 8, high: 0, moderate: 2 } as const

describe('houseVerdict', () => {
  it('is a strong candidate when the room can be treated practically and nothing high-risk is near', () => {
    expect(houseVerdict(base).level).toBe('strong')
  })
  it('is risky with any high-risk neighbour, whatever the room', () => {
    const v = houseVerdict({ ...base, high: 1 })
    expect(v.level).toBe('risky')
    expect(v.reasons.join(' ')).toMatch(/high-risk/)
  })
  it('is risky when the room cannot reach a workable mixing level', () => {
    expect(houseVerdict({ ...base, mixing: 'poor' }).level).toBe('risky')
  })
  it('needs work when it takes a lot of treatment or many moderate risks', () => {
    expect(houseVerdict({ ...base, panels: 30 }).level).toBe('workable')
    expect(houseVerdict({ ...base, moderate: 6 }).level).toBe('workable')
  })
})

describe('houseVerdict reasons', () => {
  it('lists the room problems too when the surroundings already make it risky', () => {
    const v = houseVerdict({ ...base, high: 2, panels: 100 })
    expect(v.level).toBe('risky')
    expect(v.reasons.join(' ')).toMatch(/100 panels/)
  })
})

describe('mixing reason', () => {
  const fit = (checks: Partial<Check>[], verdict: Treatment['verdict'] = 'add_absorption') =>
    ({ potential_level: 'poor', checks, treatment: { verdict } }) as unknown as Fit

  it('names the room-shape problem panels cannot fix, not a lack of panels', () => {
    const why = whyMixingFails(fit([{ id: 'mode_gap', status: 'fail', treatable: false }]))
    expect(why).toBe('uneven bass from the room’s shape, which panels cannot fix')
    const v = houseVerdict({ ...base, mixing: 'poor', mixingWhy: why })
    expect(v.reasons.join(' ')).toContain('room’s shape')
    expect(v.reasons.join(' ')).not.toMatch(/even with panels/)
  })
  it('says when the reverb is beyond a practical number of panels', () => {
    expect(whyMixingFails(fit([{ id: 'rt60', status: 'fail', treatable: true }], 'impractical'))).toBe(
      'too much reverb for a practical number of panels',
    )
  })
  it('is undefined when mixing can reach a workable level', () => {
    expect(whyMixingFails({ ...fit([]), potential_level: 'workable' } as Fit)).toBeUndefined()
  })
})
