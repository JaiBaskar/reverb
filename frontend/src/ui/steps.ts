export const STEPS = [
  { id: 'discover', title: 'Discover' },
  { id: 'explore', title: 'Explore' },
  { id: 'configure', title: 'Configure' },
  { id: 'analyze', title: 'Analyze' },
  { id: 'audition', title: 'Audition' },
  { id: 'compare', title: 'Compare' },
  { id: 'decide', title: 'Decide' },
] as const

export type StepId = (typeof STEPS)[number]['id']
export type StepState = 'done' | 'current' | 'todo'
