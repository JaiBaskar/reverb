import type { PlacedItem, TreatmentPlan, V3 } from './types'

const cm = (m: number) => Math.round(m * 100)

/**
 * Height of an item's lowest point above the room floor, in metres (model space, z up).
 * Its vertical half-extent is the sum of each local axis' half-size times that axis' z share,
 * so it holds for wall panels, ceiling clouds and anything tilted in between.
 */
export function bottomAboveFloor(it: PlacedItem, floorZ: number): number {
  const n = it.normal
  const u = it.up
  const x: V3 = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]]
  const half = (Math.abs(x[2]) * it.width_m + Math.abs(u[2]) * it.height_m + Math.abs(n[2]) * it.depth_m) / 2
  return it.center[2] - half - floorZ
}

const sixWords = (s: string) => {
  const w = s.trim().replace(/\.$/, '').split(/\s+/)
  const t = w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * The hover card: only what you need to buy and hang the item.
 * Product names come from the plan (backend product labels); none is ever made up.
 */
export function itemCardLines(it: PlacedItem, floorZ: number, names: Record<string, string>): string[] {
  const lines: string[] = []
  // type and thickness only ("Broadband panel, 100 mm"): the label's size and mounting details
  // are on lines 2-3, and the card stays at about six words a line
  const name = names[it.product_id]?.split(',').slice(0, 2).join(',').trim()
  if (name) lines.push(name)
  lines.push(`${cm(it.width_m)} × ${cm(it.height_m)} × ${cm(it.depth_m)} cm`)
  lines.push(`Bottom edge ${cm(bottomAboveFloor(it, floorZ))} cm above floor`)
  if (it.status === 'blocked' && it.blocked_by[0]) lines.push(`Behind ${it.blocked_by[0].label}`)
  else if (it.status !== 'ok' && it.adjustment) lines.push(sixWords(it.adjustment))
  return lines
}

/** product_id -> product label, from the plan's groups. */
export const productNames = (plan: TreatmentPlan): Record<string, string> =>
  Object.fromEntries(plan.groups.map((g) => [g.product_id, g.product]))
