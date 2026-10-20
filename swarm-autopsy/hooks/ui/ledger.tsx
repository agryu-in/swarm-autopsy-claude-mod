// The token ledger on the Spend tab: the session block (total processed, token
// categories, requests, the cost toggle and, with cost on, the dated ≈$
// estimate beside Claude Code's own figure), the ledger table and its notes.
// Token counts are OBSERVED; ≈$ figures are API-equivalent estimates, never a
// charge, and are drawn only through CostText.
//
// The session block is the hero, a raised glass tile from the medium layout up
// (plain lines when compact). On the desktop it holds the big total, the
// categories as a Box bar, the legend as pills with exact counts, and with cost
// on two sub-tiles: the ≈$ estimate (amber edge) and Claude Code's own figure,
// apart. The terminal keeps today's lines inside its round border. Expanded (≥
// 140 columns) the hero sits beside the table.

import type { CostEstimate, LedgerTotals, LedgerView } from '../../types'
import { compact, exact, plural } from '../lib/format'
import { ROLE, TOKEN_CATEGORIES } from '../lib/palette'
import { formatUsd } from '../lib/pricing'
import type { ViewContext } from './common'
import { BarStrip, CostText, Disclosure, EmptyState, MeasureTag, Pill, TokenLegend, glass, isExpanded, layoutFor, paintsGlass, type BarPart } from './kit'
import { NoteLine, Section, UnknownUsage, costCaveat, insideSection, unknownUsageText, type LedgerLinks } from './spend-common'
import { LedgerTable } from './spend-table'

export { AgentLedgerDetail } from './spend-ledger-detail'
export type { LedgerLinks } from './spend-common'

/**
 * One short card line, e.g. "in 1.2M · cache 980k/41k · out 12k · 14 req"; the caller tags it OBSERVED when
 * `totals.requests > 0`. No request at all reads as nothing recorded, and requests that all came back without usage as
 * unknown (the caller tags that ∅), never as zero tokens observed. It never carries ≈$: `showCost` is kept for the
 * signature, and a caller draws the estimate through `CostText`, the only ≈$ drawer.
 */
export function tokenSummary(totals: LedgerTotals | undefined, _showCost: boolean): string {
  if (!totals || totals.requests + totals.requestsWithoutUsage === 0) return 'tokens: no requests recorded yet'
  if (totals.requests === 0) return unknownUsageText(totals)
  const t = totals.tokens
  const without = totals.requestsWithoutUsage > 0 ? ` (+${totals.requestsWithoutUsage} no usage)` : ''
  return `in ${compact(t.input)} · cache ${compact(t.cacheRead)}/${compact(t.cacheWrite)} · out ${compact(t.output)} · ${totals.requests} req${without}`
}

/** The four token categories of some totals as bar parts, in their fixed order and colours. */
function tokenParts(totals: LedgerTotals): BarPart[] {
  return TOKEN_CATEGORIES.map(c => ({ value: totals.tokens[c.key], role: c.role }))
}

const HERO_SUMMARY = 'each recorded turn.step request counted once'
/** The hero's title and summary fit on one line from this tile width (`session tokens · ` + the summary + the frame). */
const HERO_TITLE_WITH_SUMMARY_CELLS = 'session tokens · '.length + HERO_SUMMARY.length + 6

/** From this inner width the two cost sub-tiles sit side by side. */
const COST_TILES_SIDE_BY_SIDE = 64

/** Half a cent: two figures closer than this read the same at two decimals. */
const SAME_TO_THE_CENT = 0.005

/**
 * The estimate set beside Claude Code's own figure: which way they differ, and what can make it. No amount is drawn
 * for the gap (an estimate minus an observed figure is neither); both figures sit on the lines above it.
 */
function engineComparison(estimateUsd: number, engineUsd: number): string {
  const gap = engineUsd - estimateUsd
  if (Math.abs(gap) < SAME_TO_THE_CENT) return 'This estimate matches Claude Code’s own figure to the cent.'
  return gap > 0
    ? 'This estimate is below Claude Code’s own figure, which also covers requests no hook sees (side requests, anything before the mod loaded).'
    : 'This estimate is above Claude Code’s own figure: the list prices or the cache-write assumption differ from what Claude Code applied.'
}

/** Notes that change how the figures read (a coverage gap, ids never seen as agents, duplicates set aside) stay visible. */
const READING_NOTE = /not recorded|began is unknown|never seen as an agent|already counted/

/** The view's notes split into those drawn in place and the rest; a note about $ is dropped while cost is hidden. */
export function partitionNotes(notes: readonly string[], showCost: boolean): { reading: string[]; rest: string[] } {
  const shown = notes.filter(note => showCost || !note.includes('$'))
  return { reading: shown.filter(n => READING_NOTE.test(n)), rest: shown.filter(n => !READING_NOTE.test(n)) }
}

/** The terminal's session lines (one monospaced line each), and the desktop's when no tile is drawn. */
function SessionLines(ctx: ViewContext, s: LedgerTotals) {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        {MeasureTag(ctx, 'OBSERVED', false)}{' '}
        <Text weight="bold" tabular>
          {compact(s.processed)}
        </Text>{' '}
        tokens processed · {plural(s.requests, 'request')} with usage
        {s.requestsWithoutUsage > 0 ? ` · ${s.requestsWithoutUsage} without usage` : ''}
      </Text>
      {s.processed > 0 ? BarStrip(ctx, tokenParts(s), Math.max(10, ctx.width)) : null}
      {TokenLegend(ctx, s.tokens)}
    </Box>
  )
}

/**
 * The desktop hero's figures: the big total in the monospaced face, the four categories as one Box bar, the legend as
 * pills with exact counts (one ● for the line), and the requests with and without usage.
 */
function HeroFigures(ctx: ViewContext, s: LedgerTotals) {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {MeasureTag(ctx, 'OBSERVED', false)}{' '}
        <Text mono tabular size="title" weight="semibold">
          {compact(s.processed)}
        </Text>{' '}
        <Text dimColor>tokens processed</Text>
      </Text>
      {s.processed > 0 ? <Box flexDirection="row">{BarStrip(ctx, tokenParts(s), ctx.width)}</Box> : null}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {MeasureTag(ctx, 'OBSERVED', false)}
        {TOKEN_CATEGORIES.map(c =>
          Pill(ctx, {
            key: `sp-lg-${c.key}`,
            children: (
              <Text>
                <Text color={c.role}>■</Text> {c.short} <Text tabular>{exact(s.tokens[c.key])}</Text>
              </Text>
            ),
          }),
        )}
      </Box>
      <Text wrap="wrap">
        {MeasureTag(ctx, 'OBSERVED', false)} {plural(s.requests, 'request')} with usage
        {s.requestsWithoutUsage > 0 ? ` · ${s.requestsWithoutUsage} without usage` : ''}
      </Text>
    </Box>
  )
}

function SessionFigures(ctx: ViewContext, view: LedgerView) {
  const { Box, Text } = ctx.els
  const s = view.session
  if (s.requests === 0) {
    return s.requestsWithoutUsage > 0 ? (
      <Text wrap="wrap">{UnknownUsage(ctx, s)}</Text>
    ) : (
      EmptyState(ctx, 'No token usage recorded yet', 'Token counts come from turn.step results, and none has been heard in this session.', { glyph: '∅' })
    )
  }
  return (
    <Box flexDirection="column">
      {paintsGlass(ctx) ? HeroFigures(ctx, s) : SessionLines(ctx, s)}
      <Text dimColor wrap="wrap">
        The session total is the sum of every row's direct usage; spawn-tree figures overlap and are never added.
      </Text>
    </Box>
  )
}

/** With cost on: the dated estimate, Claude Code's own figure apart from it, and how the two compare. */
function CostLines(ctx: ViewContext, view: LedgerView, cost: CostEstimate) {
  const { Box, Text } = ctx.els
  const engine = view.engineCost
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        {CostText(ctx, cost, true)}
        <Text dimColor> session · {costCaveat(cost)}</Text>
        {cost.complete ? '' : <Text color={ROLE.caution}> · + leaves out {cost.unpricedModels.join(', ')} (no price)</Text>}
      </Text>
      {engine ? (
        <Text wrap="wrap">
          {MeasureTag(ctx, 'OBSERVED', false)} Claude Code's own session figure {formatUsd(engine.usd)}
          <Text dimColor> · {engine.source} · drawn apart, never added to the estimate</Text>
        </Text>
      ) : null}
      {engine ? (
        <Text dimColor wrap="wrap">
          {engineComparison(cost.usd, engine.usd)}
        </Text>
      ) : null}
    </Box>
  )
}

/**
 * The desktop's cost sub-tiles: the ≈$ estimate in its own amber-edged tile, dated, API-equivalent and
 * not a charge; Claude Code's own figure in a separate tile, never added to it; side by side when there is room.
 */
function CostTiles(ctx: ViewContext, view: LedgerView, cost: CostEstimate) {
  const { Box, Text } = ctx.els
  const engine = view.engineCost
  const side = engine !== undefined && ctx.width >= COST_TILES_SIDE_BY_SIDE
  const share = side ? { width: 0, flexGrow: 1 } : {}
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection={side ? 'row' : 'column'} columnGap={1}>
        <Box key="sp-cost-est" flexDirection="column" {...glass(ctx, 'sunken', ROLE.caution)} paddingX={1} {...share}>
          <Text wrap="truncate-end">
            <Text size="title" weight="semibold" tabular>
              {CostText(ctx, cost, true)}
            </Text>
            <Text dimColor> session</Text>
          </Text>
          <Text dimColor wrap="wrap">
            {costCaveat(cost)}
          </Text>
          {cost.complete ? null : (
            <Text color={ROLE.caution} wrap="wrap">
              + leaves out {cost.unpricedModels.join(', ')} (no price)
            </Text>
          )}
        </Box>
        {engine ? (
          <Box key="sp-cost-cc" flexDirection="column" {...glass(ctx, 'sunken')} paddingX={1} {...share}>
            <Text wrap="wrap">
              {MeasureTag(ctx, 'OBSERVED', false)} Claude Code's own session figure {formatUsd(engine.usd)}
            </Text>
            <Text dimColor wrap="wrap">
              {engine.source} · drawn apart, never added to the estimate
            </Text>
          </Box>
        ) : null}
      </Box>
      {engine ? (
        <Text dimColor wrap="wrap">
          {engineComparison(cost.usd, engine.usd)}
        </Text>
      ) : null}
    </Box>
  )
}

function PriceBody(ctx: ViewContext, view: LedgerView) {
  const { Box, Text } = ctx.els
  const table = view.priceTable
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">
        Not a charge or a subscription cost. Price table {table.date}: {table.source}
      </Text>
      <Text dimColor wrap="wrap">
        · {table.cacheWrites}
      </Text>
      {table.assumptions.map(assumption => (
        <Text dimColor wrap="wrap">
          · {assumption}
        </Text>
      ))}
    </Box>
  )
}

/**
 * The session hero: a raised glass tile from the medium layout up (plain lines when compact) with the
 * total processed first, its categories and requests, the reading notes, the cost toggle and, with cost on, ≈$.
 */
export function SessionBlock(ctx: ViewContext, view: LedgerView, showCost: boolean, readingNotes: readonly string[]) {
  const { Box, Button, Text } = ctx.els
  const inner = insideSection(ctx)
  const cost = showCost ? view.session.cost : undefined
  const tiles = paintsGlass(ctx) && ctx.layout !== 'compact'
  // A narrow tile (the expanded hero) keeps its title on one line and gives the summary a line of its own.
  const titled = ctx.layout === 'compact' || ctx.width >= HERO_TITLE_WITH_SUMMARY_CELLS
  return Section(ctx, {
    key: 'sp-hero',
    tone: 'raised',
    title: 'session tokens',
    ...(titled ? { summary: HERO_SUMMARY } : {}),
    width: ctx.width,
    children: [
      titled ? null : (
        <Text dimColor wrap="wrap">
          {HERO_SUMMARY}
        </Text>
      ),
      SessionFigures(inner, view),
      ...readingNotes.map(note => NoteLine(inner, note, ROLE.neutral)),
      <Box flexDirection="row">
        <Button key="toggle-cost" label={showCost ? 'hide ≈$ estimates' : 'show ≈$ estimates'} variant="secondary" onPress={() => ctx.act.toggleCost()} />
      </Box>,
      cost ? (tiles ? CostTiles(inner, view, cost) : CostLines(inner, view, cost)) : null,
      showCost ? Disclosure(inner, 'spend-prices', 'price table, assumptions and the cache-write rule', () => PriceBody(inner, view)) : null,
    ],
  })
}

/** The ledger table in its section, with the notes that are not drawn in the hero behind a disclosure. */
function TableSection(ctx: ViewContext, view: LedgerView, showCost: boolean, links: LedgerLinks, notes: { rest: readonly string[]; more: boolean }) {
  const { Box } = ctx.els
  const inner = insideSection(ctx)
  const { rest } = notes
  return Section(ctx, {
    key: 'sp-table',
    tone: 'base',
    title: 'by agent',
    summary: 'direct usage · select a row for its detail',
    width: ctx.width,
    children: [
      LedgerTable(inner, view, showCost, links),
      rest.length > 0
        ? Disclosure(inner, 'spend-notes', `${rest.length} ${notes.more ? 'more ' : ''}ledger ${rest.length === 1 ? 'note' : 'notes'}`, () => (
            <Box flexDirection="column">{rest.map(note => NoteLine(inner, note))}</Box>
          ))
        : null,
    ],
  })
}

/** The hero's width when it sits beside the table (expanded): about this share of the pane, within these bounds. */
const HERO_SHARE = 0.28
const HERO_MIN_CELLS = 36
const HERO_MAX_CELLS = 48

/**
 * The Spend tab's ledger: the session hero, the table (a row focuses its agent and opens its detail under it) and the
 * ledger's notes. Expanded (≥ 140 columns), the hero and the table sit side by side. With `links`, each row carries its
 * outcome bucket and the focused agent's outcome detail.
 */
export function LedgerPanel(ctx: ViewContext, view: LedgerView, showCost: boolean, links: LedgerLinks = {}) {
  const { Box } = ctx.els
  const { reading, rest } = partitionNotes(view.notes, showCost)
  const notes = { rest, more: reading.length > 0 }
  if (isExpanded(ctx)) {
    const heroCells = Math.min(HERO_MAX_CELLS, Math.max(HERO_MIN_CELLS, Math.floor(ctx.width * HERO_SHARE)))
    const tableCells = ctx.width - heroCells - 1
    return (
      <Box key="sp-top" flexDirection="row" columnGap={1}>
        <Box flexDirection="column" width={heroCells}>
          {SessionBlock({ ...ctx, width: heroCells }, view, showCost, reading)}
        </Box>
        <Box flexDirection="column" width={tableCells}>
          {TableSection({ ...ctx, width: tableCells, layout: layoutFor(tableCells) }, view, showCost, links, notes)}
        </Box>
      </Box>
    )
  }
  return (
    <Box key="sp-top" flexDirection="column">
      {SessionBlock(ctx, view, showCost, reading)}
      <Box flexDirection="column" marginTop={1}>
        {TableSection(ctx, view, showCost, links, notes)}
      </Box>
    </Box>
  )
}
