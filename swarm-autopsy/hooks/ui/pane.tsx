// The pane: header (status, tabs, KPI strip, legend), the selected view, the
// footer. Lead-owned central rendering (DESIGN-CONTRACT §5, §8).

import type { HealthSignal, LedgerView, SpendOutcome } from '../../types'
import type { Collisions } from '../lib/collisions'
import type { Trail } from '../lib/trail'
import { CollisionsView } from './collisions'
import { Footer, Header, type ViewContext } from './common'
import { ForensicsView, type SignalRef } from './forensics'
import { HealthView } from './health'
import { Backdrop, ContentAnchor, SceneToolbar, glass, layoutFor, paintsGlass, paneTint } from './kit'
import { LiveView } from './live'
import { SpendView } from './spend'
import { TrailView } from './trail'

export type Analyses = {
  trail: Trail
  collisions: Collisions
  /** F2: usage per agent, direct and subtree, priced only when the person turned cost on. */
  ledger: LedgerView
  /** F3: the ledger's usage set against the trail's outcomes. */
  spend: SpendOutcome
  /** Swarm Health: the signals the analyses above already raised, in one shape (lib/signals). */
  health: HealthSignal[]
  /** Where a replacement price table came from, and why it was refused if it was. */
  prices: { path?: string; error?: string }
}

function body(ctx: ViewContext, analyses: Analyses) {
  switch (ctx.ui.view) {
    case 'trail':
      return TrailView(ctx, analyses.trail, analyses.spend, analyses.health)
    case 'collisions':
      return CollisionsView(ctx, analyses.collisions, analyses.trail)
    case 'forensics': {
      const signals: SignalRef[] = analyses.collisions.signals.map(s => ({ id: s.id, title: s.title, eventIds: s.eventIds, level: s.severity }))
      return ForensicsView(ctx, signals)
    }
    case 'spend':
      return SpendView(ctx, analyses)
    case 'health':
      return HealthView(ctx, analyses)
    default:
      return LiveView(ctx, analyses)
  }
}

/**
 * The pane's content: header, the selected view, footer. `note`: a dim first line, why the desktop's still scene is
 * not drawn this time (client/still-pane.tsx). `toolbar`: the scene toolbar first (the engine-tree pane; the still pane
 * draws it outside its content Client, fixed).
 */
export function PaneContent(ctx: ViewContext, analyses: Analyses, note?: string, opts: { toolbar?: boolean } = {}) {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="column">
      {ContentAnchor(ctx)}
      {opts.toolbar ? SceneToolbar(ctx) : null}
      {note ? (
        <Text dimColor wrap="truncate-end">
          still scene unavailable: {note}
        </Text>
      ) : null}
      {Header(ctx, analyses)}
      {Body(ctx, analyses)}
      {Footer(ctx)}
    </Box>
  )
}

/** Views that bring their own glass in a compact pane (cards, the timeline's panel); the others sit on one sheet. */
const OWN_GLASS = new Set(['live', 'forensics'])
/** The sheet's frame: its round border and side padding, in cells. */
const SHEET_FRAME = 4

/**
 * The selected view. On a compact desktop pane most views draw plain lines (no panels, to keep every cell); over the
 * scene they then sit on one frosted sheet, so no text ever lies bare on the picture. The view is drawn the sheet's
 * frame narrower.
 */
function Body(ctx: ViewContext, analyses: Analyses) {
  const { Box } = ctx.els
  const sheet = paintsGlass(ctx) && ctx.layout === 'compact' && !OWN_GLASS.has(ctx.ui.view)
  if (!sheet) {
    return (
      <Box flexDirection="column" marginTop={1}>
        {body(ctx, analyses)}
      </Box>
    )
  }
  const width = Math.max(26, ctx.width - SHEET_FRAME)
  return (
    <Box key="sa-sheet" flexDirection="column" marginTop={1} {...glass(ctx, 'base')} paddingX={1}>
      {body({ ...ctx, width, layout: layoutFor(width) }, analyses)}
    </Box>
  )
}

/**
 * The pane in the engine tree: on desktop the scene behind the content as a frame over the visible window (the fallback
 * when the still Client is not drawn), the content above it; on the terminal the content alone.
 */
export function Pane(ctx: ViewContext, analyses: Analyses, note?: string) {
  const { Box } = ctx.els
  return (
    <Box flexDirection="column" width={ctx.width} {...paneTint(ctx)}>
      {Backdrop(ctx)}
      {PaneContent(ctx, analyses, note, { toolbar: true })}
    </Box>
  )
}
