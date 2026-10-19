// How clear the liquid glass is: the person's choice in the toolbar, five steps from frosted (1) to crystal (5), kept in
// the store so every chat draws the same glass. Clearer glass lets more of the still scene through and blurs it more,
// so text over it still reads. Pure.

export const CLARITY_STEPS = 5
export const DEFAULT_CLARITY = 3

/** Each step in words, frosted to crystal: what the toolbar says beside the steps. */
export const CLARITY_WORDS = ['frosted', 'misted', 'balanced', 'clear', 'crystal'] as const

/** A stored or pressed step, checked: anything but a whole step 1–5 is the default. */
export function cleanClarity(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= CLARITY_STEPS ? value : DEFAULT_CLARITY
}

/** A step as a share: 0 frosted, 1 crystal. */
export const clarityShare = (step: unknown): number => (cleanClarity(step) - 1) / (CLARITY_STEPS - 1)
