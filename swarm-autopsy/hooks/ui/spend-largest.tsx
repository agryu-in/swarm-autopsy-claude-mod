// The token ledger's largest token use: one horizontal bar per agent of its
// direct tokens processed, largest first, each a share of the session total
// (exact arithmetic over observed counts). Never the spawn tree. With cost on,
// and only when every estimate is complete, a second set of ≈$ bars; token
// shares and ≈$ never share a bar.
//
// The bars are the kit's ShareBar in one analytical hue (the coral is chrome,
// never data); ≈$ bars are amber, an estimate. On the desktop each row is
// fixed-width Box cells, so every bar starts at the same place and the figures
// stand in a right-aligned column; the terminal keeps one padded monospaced
// line per row.

import type { RenderChildren } from 'claude-code'

import type { LedgerRow, LedgerView } from '../../types'
import { compact, plural } from '../lib/format'
import { ROLE } from '../lib/palette'
import type { ViewContext } from './common'
import { AgentChip, MeasureTag, ShareBar, paintsGlass } from './kit'
import { AgentCell, AgentName, Cell, FigureCell, Section, agentWords, chipCells, costCaveat, costCells, costRun, hasUsage, insideSection, shareOf, shareText, unknownUsageText } from './spend-common'

/** Bars drawn before the rest are summarised by count. */
const BAR_CAP = 10
const WORDS_CELLS = 18
/** `● 452k · 57%` at its widest. */
const FIGURE_CELLS = 15

function nameCells(ctx: ViewContext, rows: readonly LedgerRow[]): { cells: number; words: boolean } {
  const words = ctx.layout !== 'compact'
  const cells = Math.max(0, ...rows.map(r => chipCells(ctx, r.agentId) + (words && agentWords(ctx, r.agentId) ? 1 + WORDS_CELLS : 0)))
  return { cells, words }
}

function Chips(ctx: ViewContext, rows: readonly LedgerRow[]) {
  const { Text } = ctx.els
  return rows.map((row, i) => (
    <Text>
      {i > 0 ? ' ' : ''}
      {AgentChip(ctx, row.agentId)}
    </Text>
  ))
}

/**
 * One bar row. Desktop: the name in a fixed-width cell (aligned starts), the bar, the figure right-aligned in its own
 * column. Terminal: one line, the name padded to the same width.
 */
function BarRow(
  ctx: ViewContext,
  input: { key: string; agentId: string; name: { cells: number; words: boolean }; fraction: number; barCells: number; role: string; figure: RenderChildren; figureCells: number },
) {
  const { Box, Text } = ctx.els
  if (paintsGlass(ctx)) {
    return (
      <Box key={input.key} flexDirection="row" columnGap={1}>
        {Cell(ctx, input.name.cells, AgentName(ctx, input.agentId, input.name.words))}
        {ShareBar(ctx, input.fraction, input.barCells, input.role)}
        {FigureCell(ctx, input.figureCells, input.figure, { mono: false })}
      </Box>
    )
  }
  return (
    <Text wrap="truncate-end">
      {AgentCell(ctx, input.agentId, input.name.cells, input.name.words)} {ShareBar(ctx, input.fraction, input.barCells, input.role)} {input.figure}
    </Text>
  )
}

/** ≈$ by agent, only when every model was priced: the session's ≈$ is then the 100% of these bars. */
function CostBars(ctx: ViewContext, view: LedgerView, showCost: boolean) {
  const { Box, Text } = ctx.els
  const session = view.session.cost
  if (!showCost || !session) return null
  if (!session.complete) {
    return (
      <Text dimColor wrap="wrap">
        ≈$ bars are drawn only when every model has a price; no price for {session.unpricedModels.join(', ')}.
      </Text>
    )
  }
  const rows = view.rows
    .filter(r => hasUsage(r.direct) && r.direct.cost !== undefined && r.direct.cost.usd > 0)
    .sort((a, b) => (b.direct.cost?.usd ?? 0) - (a.direct.cost?.usd ?? 0))
    .slice(0, BAR_CAP)
  if (rows.length === 0 || session.usd <= 0) return null
  const name = nameCells(ctx, rows)
  const money = Math.max(...rows.map(r => costCells(r.direct.cost)))
  const cells = Math.max(6, ctx.width - name.cells - money - 3)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor wrap="wrap">
        ≈$ by agent · {costCaveat(session)}
      </Text>
      {rows.map(row =>
        BarRow(ctx, {
          key: `lc-${row.agentId}`,
          agentId: row.agentId,
          name,
          fraction: (row.direct.cost?.usd ?? 0) / session.usd,
          barCells: cells,
          role: ROLE.caution,
          figure: costRun(ctx, row.direct.cost, true),
          figureCells: money + 1,
        }),
      )}
    </Box>
  )
}

/** Largest token use: direct tokens processed per agent, largest first, as a share of the session total. */
export function LargestUse(ctx: ViewContext, view: LedgerView, showCost: boolean) {
  const { Text } = ctx.els
  const inner = insideSection(ctx)
  const total = view.session.processed
  const measured = view.rows.filter(r => hasUsage(r.direct) && r.direct.processed > 0).sort((a, b) => b.direct.processed - a.direct.processed)
  const unknown = view.rows.filter(r => !hasUsage(r.direct) && r.direct.requestsWithoutUsage > 0)
  const silent = view.rows.filter(r => r.direct.requests + r.direct.requestsWithoutUsage === 0)
  const shown = measured.slice(0, BAR_CAP)
  const name = nameCells(inner, shown)
  const cells = Math.max(6, inner.width - name.cells - FIGURE_CELLS - 2)
  const without = unknown.reduce((n, r) => n + r.direct.requestsWithoutUsage, 0)
  return Section(ctx, {
    key: 'sp-largest',
    tone: 'base',
    title: 'largest token use',
    summary: 'direct usage per agent, as a share of the session total',
    width: ctx.width,
    children: [
      total <= 0 || shown.length === 0 ? (
        <Text wrap="wrap" color={ROLE.muted}>
          {MeasureTag(inner, 'UNAVAILABLE', false)} nothing to compare yet: no agent has recorded token usage
        </Text>
      ) : null,
      ...(total > 0
        ? shown.map(row =>
            BarRow(inner, {
              key: `lu-${row.agentId}`,
              agentId: row.agentId,
              name,
              fraction: row.direct.processed / total,
              barCells: cells,
              role: ROLE.analytic,
              figure: (
                <Text>
                  {MeasureTag(inner, 'OBSERVED', false)} {shareText(compact(row.direct.processed), shareOf(row.direct.processed, total))}
                </Text>
              ),
              figureCells: FIGURE_CELLS,
            }),
          )
        : []),
      measured.length > shown.length ? (
        <Text dimColor wrap="wrap">
          +{plural(measured.length - shown.length, 'more agent')} with smaller direct usage
        </Text>
      ) : null,
      unknown.length > 0 ? (
        <Text wrap="wrap" color={ROLE.muted}>
          {MeasureTag(inner, 'UNAVAILABLE', false)} {unknownUsageText({ requests: 0, requestsWithoutUsage: without })}: {Chips(inner, unknown)}
        </Text>
      ) : null,
      silent.length > 0 ? (
        <Text wrap="wrap" color={ROLE.muted}>
          {MeasureTag(inner, 'UNAVAILABLE', false)} no request heard: {Chips(inner, silent)}
        </Text>
      ) : null,
      CostBars(inner, view, showCost),
    ],
  })
}
