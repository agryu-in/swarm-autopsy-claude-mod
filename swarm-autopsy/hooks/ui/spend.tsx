// View E, Spend (DESIGN-CONTRACT §8.6; Sunset Glass §11 "Spend"): the session
// hero and the ledger table (F2), the largest token use, then spend vs outcome
// (F3). Selecting an agent anywhere here focuses it pane-wide (`ui.focus`); its
// ledger and outcome details open under its ledger row. ≈$ appears only once
// the person turns cost on, always dated, API-equivalent and not a charge.
// Expanded (≥ 140 columns) the view reorganises rather than stretches: the hero
// beside the table, and largest use beside spend vs outcome.

import type { ViewContext } from './common'
import { ROLE } from '../lib/palette'
import { isExpanded, layoutFor } from './kit'
import { LedgerPanel } from './ledger'
import { SpendOutcomePanel } from './outcome'
import type { Analyses } from './pane'
import { LargestUse } from './spend-largest'

function PricesMessage(ctx: ViewContext, prices: Analyses['prices']) {
  const { Text } = ctx.els
  if (prices.error) {
    return (
      <Text color={ROLE.caution} wrap="wrap">
        SWARM_AUTOPSY_PRICES ({prices.path}) was not used: {prices.error}. Estimates use the built-in table.
      </Text>
    )
  }
  return prices.path ? (
    <Text dimColor wrap="wrap">
      Prices from SWARM_AUTOPSY_PRICES: {prices.path}
    </Text>
  ) : null
}

/** A context `width` cells wide, its layout class following that width. */
function narrowed(ctx: ViewContext, width: number): ViewContext {
  return { ...ctx, width, layout: layoutFor(width) }
}

/** Largest use and spend vs outcome: stacked, or side by side when the pane is expanded. */
function LowerSections(ctx: ViewContext, analyses: Analyses, showCost: boolean) {
  const { Box } = ctx.els
  if (isExpanded(ctx)) {
    const left = Math.floor((ctx.width - 1) / 2)
    const right = ctx.width - left - 1
    return (
      <Box key="sp-bottom" flexDirection="row" columnGap={1} marginTop={1}>
        <Box flexDirection="column" width={left}>
          {LargestUse(narrowed(ctx, left), analyses.ledger, showCost)}
        </Box>
        <Box flexDirection="column" width={right}>
          {SpendOutcomePanel(narrowed(ctx, right), analyses.spend, analyses.trail, showCost)}
        </Box>
      </Box>
    )
  }
  return [
    <Box key="sp-largest-row" flexDirection="column" marginTop={1}>
      {LargestUse(ctx, analyses.ledger, showCost)}
    </Box>,
    <Box key="sp-outcome-row" flexDirection="column" marginTop={1}>
      {SpendOutcomePanel(ctx, analyses.spend, analyses.trail, showCost)}
    </Box>,
  ]
}

export function SpendView(ctx: ViewContext, analyses: Analyses) {
  const { Box } = ctx.els
  const showCost = ctx.ui.showCost === true
  return (
    <Box flexDirection="column">
      {PricesMessage(ctx, analyses.prices)}
      {LedgerPanel(ctx, analyses.ledger, showCost, { outcome: analyses.spend, trail: analyses.trail })}
      {LowerSections(ctx, analyses, showCost)}
    </Box>
  )
}
