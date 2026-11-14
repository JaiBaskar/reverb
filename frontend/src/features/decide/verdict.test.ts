import { describe, expect, it } from 'vitest'
import { houseVerdict } from './verdict'

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
