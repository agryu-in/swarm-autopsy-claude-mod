// F2 · one agent's ledger, as the Spend tab and the Live inspector both draw it:
// the attribution basis once, the token categories once, its models, stop
// reasons and reconciliation, and one table of its recent requests. Token
// counts are OBSERVED; ≈$ is drawn only through CostText, only when asked.
// Sunset Glass: the kit's level-2 heading, the categories as a block bar, the
// request ids muted and monospaced, and on the desktop the request table in
// fixed-width Box cells under a header (the terminal keeps one line a request).

import type { AgentLedger, LedgerRow, UsageRecord } from '../../types'
import { compact, exact, offset, plural, shortId } from '../lib/format'
import { ROLE, TOKEN_CATEGORIES } from '../lib/palette'
import { processedOf, promptTokensOf } from '../lib/tokens'
import type { ViewContext } from './common'
import { BarStrip, CostText, EvidenceTag, MeasureTag, TokenLegend, paintsGlass } from './kit'
import { Cell, DetailHeading, FigureCell, TextCell, UnknownUsage, costCaveat, costRun, hasUsage } from './spend-common'

/** From this width a request is named by its full key; narrower, by a short turn id and its index. */
const FULL_KEY_WIDTH = 80
/** Requests listed in the table: fewer in the compact layout. */
const RECENT_REQUESTS = 8
const RECENT_REQUESTS_COMPACT = 5
/** Desktop request table: the label, the time, the id (the rest of the row), the two figures and the stop reason. */
const REQ_LABEL_CELLS = 2
const REQ_AT_CELLS = 7
const REQ_ID_MIN_CELLS = 6
const REQ_PROMPT_CELLS = 7
const REQ_OUT_CELLS = 6
const REQ_STOP_CELLS = 12

/** The stored ledger of an agent, read as an own property (an id such as `constructor` is an agent, not Object's member). */
function ledgerOf(ctx: ViewContext, agentId: string): AgentLedger | undefined {
  const agents = ctx.snapshot.ledger.agents
  return Object.hasOwn(agents, agentId) ? agents[agentId] : undefined
}

function UsageLines(ctx: ViewContext, row: LedgerRow, showCost: boolean) {
  const { Box, Text } = ctx.els
  const d = row.direct
  const cost = showCost ? d.cost : undefined
  return (
    <Box flexDirection="column">
      {d.processed > 0 ? (
        // In a row Box: the bar's own `alignSelf: center` then centres it on the line, not across the column.
        <Box flexDirection="row">
          {BarStrip(
            ctx,
            TOKEN_CATEGORIES.map(c => ({ value: d.tokens[c.key], role: c.role })),
            Math.max(8, Math.min(40, ctx.width - 2)),
          )}
        </Box>
      ) : null}
      {TokenLegend(ctx, d.tokens, { exact: true })}
      <Text wrap="wrap">
        {MeasureTag(ctx, 'OBSERVED', false)} {exact(d.processed)} tokens processed · {plural(d.requests, 'request')} with usage
        {d.requestsWithoutUsage > 0 ? ` · ${d.requestsWithoutUsage} without usage` : ''}
      </Text>
      {cost ? (
        <Text wrap="wrap">
          {CostText(ctx, cost, true)}
          <Text dimColor> direct · {costCaveat(cost)}</Text>
          {cost.complete ? '' : <Text color={ROLE.caution}> · leaves out {cost.unpricedModels.join(', ')} (no price)</Text>}
        </Text>
      ) : null}
    </Box>
  )
}

function ModelLines(ctx: ViewContext, row: LedgerRow, showCost: boolean) {
  const { Text } = ctx.els
  return row.byModel.map(entry => (
    <Text wrap="wrap">
      {MeasureTag(ctx, 'OBSERVED', false)} {entry.model} · {compact(processedOf(entry.tally.tokens))} tok · {entry.tally.requests} req
      {entry.tally.largeRequests > 0 ? ` · ${entry.tally.largeRequests} over 100k prompt` : ''}
      {showCost && entry.cost ? <Text> {costRun(ctx, entry.cost, true)}</Text> : ''}
    </Text>
  ))
}

function StopsLine(ctx: ViewContext, agent: AgentLedger | undefined) {
  const { Text } = ctx.els
  const stops = Object.entries(agent?.stopReasons ?? {}).sort((a, b) => b[1] - a[1])
  if (stops.length === 0) return null
  return (
    <Text wrap="wrap">
      {MeasureTag(ctx, 'OBSERVED', false)} stops: {stops.map(([reason, count]) => `${reason} ${count}`).join(' · ')}
    </Text>
  )
}

function ReconciliationLine(ctx: ViewContext, row: LedgerRow) {
  const { Text } = ctx.els
  const r = row.reconciliation
  return (
    <Text wrap="wrap">
      {MeasureTag(ctx, 'OBSERVED', false)} turn.complete check: {r.turnsCompared} compared · {r.mismatched} differ · {r.reportedOnly} reported only
      {r.note ? <Text dimColor> · {r.note}</Text> : ''}
    </Text>
  )
}

/** A request's id: its full key from 80 columns, else a short turn id and its index. */
function requestId(ctx: ViewContext, record: UsageRecord): string {
  return ctx.width >= FULL_KEY_WIDTH ? record.key : `${shortId(record.turnId)}:${record.index}`
}

function requestText(record: UsageRecord): string {
  const usage = record.tokens ? `prompt ${compact(promptTokensOf(record.tokens))} · out ${compact(record.tokens.output)}` : 'no usage'
  return `${usage} · ${record.stopReason ?? 'no stop reason'}`
}

/** The desktop request table's header: the same cells as its rows. */
function RequestHeader(ctx: ViewContext, agentId: string) {
  const { Box, Text } = ctx.els
  const head = (width: number, label: string) => Cell(ctx, width, <Text dimColor wrap="truncate-end">{label}</Text>, { end: true })
  return (
    <Box key={`rq-${agentId}-head`} flexDirection="row" columnGap={1}>
      {Cell(ctx, REQ_LABEL_CELLS, null)}
      {TextCell(ctx, REQ_AT_CELLS, 'when', { dim: true })}
      {TextCell(ctx, REQ_ID_MIN_CELLS, 'request', { dim: true, grow: true })}
      {head(REQ_PROMPT_CELLS, 'prompt')}
      {head(REQ_OUT_CELLS, 'out')}
      {TextCell(ctx, REQ_STOP_CELLS, 'stop', { dim: true })}
    </Box>
  )
}

/** One request on the desktop: aligned cells, the id muted and monospaced, the figures right-aligned. */
function RequestCells(ctx: ViewContext, agentId: string, record: UsageRecord, index: number) {
  const { Box, Text } = ctx.els
  const t = record.tokens
  return (
    <Box key={`rq-${agentId}-${record.key}`} flexDirection="row" columnGap={1}>
      {TextCell(ctx, REQ_LABEL_CELLS, MeasureTag(ctx, 'OBSERVED', false))}
      {TextCell(ctx, REQ_AT_CELLS, offset(ctx.snapshot.startedAt, record.at), { dim: true })}
      {Cell(
        ctx,
        REQ_ID_MIN_CELLS,
        <Text mono dimColor wrap="truncate-end">
          {requestId(ctx, record)}
        </Text>,
        { grow: true },
      )}
      {t ? FigureCell(ctx, REQ_PROMPT_CELLS, compact(promptTokensOf(t))) : TextCell(ctx, REQ_PROMPT_CELLS + 1 + REQ_OUT_CELLS, 'no usage', { dim: true })}
      {t ? FigureCell(ctx, REQ_OUT_CELLS, compact(t.output)) : null}
      {TextCell(ctx, REQ_STOP_CELLS, record.stopReason ?? 'no stop reason', { dim: true })}
    </Box>
  )
}

/** The one request table: the newest requests first, saying how many were heard and how many the history no longer keeps. */
function RequestTable(ctx: ViewContext, agent: AgentLedger, agentId: string) {
  const { Box, Text } = ctx.els
  const heard = agent.requests + agent.requestsWithoutUsage
  const recent = agent.history.slice(-(ctx.layout === 'compact' ? RECENT_REQUESTS_COMPACT : RECENT_REQUESTS)).reverse()
  if (recent.length === 0) return null
  const desktop = paintsGlass(ctx)
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        {MeasureTag(ctx, 'OBSERVED', false)} last {recent.length} of {plural(heard, 'request')}
        <Text dimColor>
          {' '}
          · newest first
          {agent.historyDropped > 0 ? ` · ${plural(agent.historyDropped, 'older request')} not kept here; the sums above include them` : ''}
        </Text>
      </Text>
      {desktop ? RequestHeader(ctx, agentId) : null}
      {recent.map((record, i) =>
        desktop ? (
          RequestCells(ctx, agentId, record, i)
        ) : (
          <Text wrap="truncate-end">
            {'  '}
            {MeasureTag(ctx, 'OBSERVED', false)} <Text dimColor>{offset(ctx.snapshot.startedAt, record.at)}</Text>{' '}
            <Text mono dimColor>
              {requestId(ctx, record)}
            </Text>{' '}
            · {requestText(record)}
          </Text>
        ),
      )}
    </Box>
  )
}

/**
 * An agent's ledger: how its requests were attributed, its token categories (exact), ≈$ when asked, its models, stop
 * reasons, the turn.complete check and its recent requests. Usage no request reported reads ∅, never zero.
 */
export function AgentLedgerDetail(ctx: ViewContext, row: LedgerRow | undefined, showCost: boolean) {
  const { Box, Text } = ctx.els
  if (!row) {
    return (
      <Box flexDirection="column">
        {DetailHeading(ctx, 'ledger')}
        <Text wrap="wrap">{MeasureTag(ctx, 'UNAVAILABLE', false)} no ledger row for this agent</Text>
      </Box>
    )
  }
  const agent = ledgerOf(ctx, row.agentId)
  return (
    <Box flexDirection="column">
      {DetailHeading(ctx, 'ledger', row.agentId)}
      <Text wrap="wrap">
        {EvidenceTag(ctx, row.attribution.evidence)} <Text dimColor>{row.attribution.basis}</Text>
      </Text>
      {hasUsage(row.direct) ? UsageLines(ctx, row, showCost) : <Text wrap="wrap">{UnknownUsage(ctx, row.direct)}</Text>}
      {ModelLines(ctx, row, showCost)}
      {StopsLine(ctx, agent)}
      {agent ? ReconciliationLine(ctx, row) : null}
      {agent ? RequestTable(ctx, agent, row.agentId) : null}
    </Box>
  )
}
