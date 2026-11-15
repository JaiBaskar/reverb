import { describe, expect, it } from 'vitest'
import { bottomAboveFloor, itemCardLines } from './itemCard'
import type { PlacedItem } from './types'

const base: PlacedItem = {
  key: 'fr-1',
  product_id: 'panel_100',
  group: 'first_reflection',
  center: [1, 2, 1.6],
  normal: [1, 0, 0],
  up: [0, 0, 1],
  width_m: 0.6,
  height_m: 1.2,
  depth_m: 0.1,
  wall: 0,
  where: 'left wall',
  reason: 'first reflection',
  status: 'ok',
  adjustment: null,
  blocked_by: [],
}
const names = { panel_100: 'Broadband panel 10 cm' }

describe('bottomAboveFloor', () => {
  it('wall panel: centre minus half its height', () => {
    expect(bottomAboveFloor(base, 0.1)).toBeCloseTo(0.9)
  })
  it('ceiling cloud (facing down, flat): centre minus half its thickness', () => {
    const cloud = { ...base, center: [1, 2, 2.4] as [number, number, number], normal: [0, 0, -1] as [number, number, number], up: [0, 1, 0] as [number, number, number] }
    expect(bottomAboveFloor(cloud, 0)).toBeCloseTo(2.35)
  })
})

describe('itemCardLines', () => {
  it('ok item: name, size, mount height only', () => {
    expect(itemCardLines(base, 0.1, names)).toEqual(['Broadband panel 10 cm', '60 × 120 × 10 cm', 'Bottom edge 90 cm above floor'])
  })
  it('blocked item names the first blocker', () => {
    const b = { ...base, status: 'blocked' as const, blocked_by: [{ id: 'f1', label: 'sofa', kind: 'furniture' as const, min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] }] }
    expect(itemCardLines(b, 0.1, names)[3]).toBe('Behind sofa')
  })
  it('moved item shows its adjustment, cut to six words', () => {
    const m = { ...base, status: 'moved' as const, adjustment: 'moved 20 cm left to clear the window frame' }
    expect(itemCardLines(m, 0.1, names)[3]).toBe('Moved 20 cm left to clear…')
  })
  it('keeps only type and thickness from the product label', () => {
    expect(itemCardLines(base, 0.1, { panel_100: 'Broadband panel, 100 mm, 0.6 x 1.2 m' })[0]).toBe('Broadband panel, 100 mm')
    expect(itemCardLines(base, 0.1, { panel_100: 'Corner bass trap, 100 mm, floor to ceiling, 0.6 m face' })[0]).toBe('Corner bass trap, 100 mm')
  })
  it('never invents a product name', () => {
    expect(itemCardLines(base, 0.1, {})[0]).toBe('60 × 120 × 10 cm')
  })
})
