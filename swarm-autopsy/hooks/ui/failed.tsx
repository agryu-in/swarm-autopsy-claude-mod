// What the pane draws when its render hook fails before any view can: a read
// that rejects, or a drawing that runs past the engine's budget. Without it the
// engine draws its own "Nothing to show yet" and says why only in a debug log,
// so the person sees a blank pane and no reason. Needs nothing but the element
// table: no snapshot, no view state, no press handlers.

import type { ElementTable, HookFailure } from 'claude-code'
import { cleanText } from './clean'

/** The engine's budget for one render hook (HookBudget `ms`). */
const RENDER_BUDGET_S = 10

/** Why the drawing failed, in words: the thrown message, or the budget it ran past. */
function reasonOf(failure: HookFailure): string {
  if (failure.kind === 'timeout') return `The drawing ran past the engine's ${RENDER_BUDGET_S} s budget for one render.`
  return failure.message ?? 'The drawing threw without a message.'
}

/** A small drawing naming why the pane could not draw, and how to retry. */
export function drawingFailed(els: ElementTable, width: number, failure: HookFailure) {
  const { Box, Text } = els
  return (
    <Box flexDirection="column" width={width}>
      <Text weight="bold">Swarm Autopsy could not draw this pane</Text>
      <Text wrap="wrap">{cleanText(reasonOf(failure))}</Text>
      <Text dimColor wrap="wrap">
        The collector keeps running. To retry: /swarm-autopsy close, then /swarm-autopsy.
      </Text>
    </Box>
  )
}
