// What the still pane does after the desktop app stops one of its Clients (`ui.fault`), as plain state. The pane then
// draws the engine tree, whose scene frame follows scrolling (it lags, then snaps back): fine for a moment, not for a
// session. So a fault means a short wait, then a fresh pair of Clients under new keys (the page starts new instances
// for new keys), at most RETRY_MS.length times an opening; past that the engine tree stays, saying why, until the pane
// is opened again. Pure: the hooks module keeps the state, schedules the wait and redraws.

export type RetryState = {
  /** Faults heard since the pane was last opened. */
  tries: number
  /** Why the last one happened, as the app said it; undefined while the Clients draw. */
  reason?: string
  /** Waiting before the next fresh pair (or, past the last try, for the pane to be opened again). */
  waiting: boolean
  /** Which pair of Clients this is: 0 first, then one more for each fresh pair. */
  generation: number
}

export const FRESH: RetryState = { tries: 0, waiting: false, generation: 0 }

/** The waits before each fresh pair, longer each time: a fault that keeps coming back is not hammered. */
export const RETRY_MS = [2_000, 6_000, 20_000] as const

/** A fault heard: the engine tree while it waits, and how long to wait (none once an opening's tries are spent). */
export function afterFault(state: RetryState, reason: string): { state: RetryState; retryInMs?: number } {
  const tries = state.tries + 1
  const retryInMs = RETRY_MS[tries - 1]
  return { state: { ...state, tries, reason, waiting: true }, ...(retryInMs !== undefined ? { retryInMs } : {}) }
}

/** The wait is over: a fresh pair of Clients, unless this opening's tries are spent. */
export function afterCooling(state: RetryState): RetryState {
  if (!state.waiting || state.tries > RETRY_MS.length) return state
  return { tries: state.tries, waiting: false, generation: state.generation + 1 }
}

/** The pane opened again (its command): every try back, and a fresh pair if the last one had failed. */
export function afterOpen(state: RetryState): RetryState {
  if (state.tries === 0) return state
  return { tries: 0, waiting: false, generation: state.reason === undefined ? state.generation : state.generation + 1 }
}

/** The dim line the engine tree carries while the Clients are down; undefined while they draw. */
export function fallbackNote(state: RetryState): string | undefined {
  if (!state.waiting || state.reason === undefined) return undefined
  const next = state.tries > RETRY_MS.length ? 'reopen the pane to try again' : 'trying again'
  return `the desktop app stopped it (${state.reason}); ${next}`
}

/** A Client's key in this generation: its own key first, then `<key>-<generation>`. */
export const clientKey = (base: string, state: RetryState): string => (state.generation === 0 ? base : `${base}-${state.generation}`)

/** Whether an element's key is one of a Client's generations. */
export const isClientKey = (element: string, base: string): boolean => element === base || new RegExp(`^${base}-\\d+$`).test(element)
