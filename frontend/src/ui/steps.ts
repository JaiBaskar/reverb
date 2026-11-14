/** One cycle: find a place, choose the room, plan its treatment, hear it, get the verdict. */
export const STEPS = [
  { id: 'find', title: 'Find a place' },
  { id: 'room', title: 'Choose a room' },
  { id: 'treat', title: 'Treatment plan' },
  { id: 'listen', title: 'Listen' },
  { id: 'verdict', title: 'Verdict' },
] as const

export type StepId = (typeof STEPS)[number]['id']
export type StepState = 'done' | 'current' | 'todo'
