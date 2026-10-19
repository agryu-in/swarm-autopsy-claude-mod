// View A, Live (Sunset Glass DESIGN-CONTRACT §10, §11): the coordinator strip
// and one card or line per observed subagent, in spawn order, with state
// filters, a compact Health strip and the recent activity. Pressing any line of
// an agent's card opens its details (§9): in place under its card (medium), in
// the detail column (wide), or instead of the list (compact). The desktop draws
// the full cards at every width, the narrow dock (below 56 columns) included,
// their lines reflowed onto more rows; only the terminal's compact pane draws
// one line per agent. From 140 columns (expanded) the view reorganises into
// three columns: cards · details · activity and Health.

import type { AgentRecord, LiveFilter } from '../../types'
import { agentRecord } from '../lib/outcome'
import { ROLE } from '../lib/palette'
import { subagents } from '../lib/format'
import type { ViewContext } from './common'
import { EventLine } from './events'
import { HealthStrip } from './health'
import { Chips, Disclosure, EmptyState, GlassPanel, isExpanded, isOpen } from './kit'
import { AgentCard, AgentLine, CARD_FRAME, CoordinatorCard, CoordinatorLine, sized } from './live-cards'
import { liveMatches } from './live-facts'
import { Inspector } from './live-inspector'
import type { Analyses } from './pane'

const FILTERS: readonly LiveFilter[] = ['all', 'active', 'completed', 'failed']
/** The list column's share of a wide pane (master-detail). */
const LIST_SHARE = 0.58
/** Expanded: the cards' and the details' shares of the pane; activity and Health take the rest. */
const EXPANDED_LIST_SHARE = 0.42
const EXPANDED_DETAIL_SHARE = 0.35
/** A card narrower than this is cramped: the list goes to two columns only when both get this much. */
const CARD_MIN_WIDTH = 46
/** Lines drawn before "N more agents" (the tree budget: ≤ 2,500 nodes per tab). */
const LIST_CAP = 40
const RECENT_EVENTS = 5
const SHOW_ALL = 'live-all'

function focusedAgent(ctx: ViewContext): AgentRecord | undefined {
  return ctx.ui.focus ? agentRecord(ctx.snapshot, ctx.ui.focus) : undefined
}

/** How many agents get a card before the rest are drawn as lines: by the pane's height, 4 to 12. */
function cardCap(ctx: ViewContext): number {
  return Math.max(4, Math.min(12, Math.floor(ctx.rows / 8)))
}

// ── pieces ──

function Filters(ctx: ViewContext, agents: readonly AgentRecord[]) {
  if (agents.length === 0) return null
  const active = ctx.ui.liveFilter ?? 'all'
  return Chips(
    ctx,
    'lf',
    FILTERS.map(id => ({ id, label: id, count: agents.filter(a => liveMatches(a, id)).length, active: active === id })),
    id => ctx.act.liveFilter(id as LiveFilter),
  )
}

/** The compact layout has no KPI tiles, so a screen with ≈$ on it says here what ≈$ is (O1). */
function CostNote(ctx: ViewContext, analyses: Analyses) {
  const { Text } = ctx.els
  if (ctx.ui.showCost !== true) return null
  const date = analyses.ledger.session.cost?.priceDate ?? analyses.ledger.priceTable.date
  return (
    <Text dimColor wrap="wrap">
      ≈$ figures: API-equivalent estimates at {date} list prices, not a charge.
    </Text>
  )
}

/** The newest events, newest first, as aligned timeline rows in a sunken glass panel (a supporting list, §6). */
function RecentActivity(ctx: ViewContext) {
  const { Box, Text } = ctx.els
  const events = ctx.snapshot.events.slice(-RECENT_EVENTS).reverse()
  const inner = sized(ctx, Math.max(20, ctx.width - CARD_FRAME))
  return GlassPanel(ctx, {
    key: 'lv-recent',
    tone: 'sunken',
    title: 'Recent activity',
    summary: events.length ? `last ${events.length} events · newest first` : 'none yet',
    children: events.length ? (
      <Box flexDirection="column">{events.map(e => EventLine(inner, e, inner.width, true))}</Box>
    ) : (
      <Text dimColor>No event observed yet.</Text>
    ),
  })
}

function NoAgents(ctx: ViewContext) {
  return EmptyState(
    ctx,
    'No subagents observed in this session yet.',
    'The collector is listening. When the session delegates work through the Agent tool, each agent appears here with its task, context, tokens and report.',
  )
}

function NoneMatch(ctx: ViewContext, filter: LiveFilter, hidden: number) {
  return EmptyState(ctx, `No ${filter} agents.`, `The filter hides ${hidden === 1 ? 'one agent' : `${hidden} agents`}; choose “all” to see every agent.`)
}

function NoneSelected(ctx: ViewContext) {
  return EmptyState(ctx, 'No agent selected.', 'Press any line of an agent’s card to open its context, usage, outcome, delegation and files here.')
}

/** The agents the filter keeps, in spawn order; the focused agent stays drawn whatever the filter. */
function visible(ctx: ViewContext, agents: readonly AgentRecord[]): AgentRecord[] {
  const filter = ctx.ui.liveFilter ?? 'all'
  return agents.filter(a => liveMatches(a, filter) || a.id === ctx.ui.focus)
}

/** Glass panels in the details: on the medium and wide panes; compact draws plain lines (no tiles, §10). */
function panels(ctx: ViewContext): boolean {
  return ctx.layout !== 'compact'
}

/** Whether the list draws cards: on every pane but the terminal's compact one, which draws one line per agent. */
function drawsCards(ctx: ViewContext): boolean {
  return ctx.layout !== 'compact' || ctx.surface !== 'terminal'
}

/**
 * The list: cards for the first agents (wherever `drawsCards`), lines for the rest (and for all of them on the
 * terminal's compact pane), the focused agent's details after its entry when `inPlace`, and past LIST_CAP a disclosure
 * for the remainder.
 */
function AgentList(ctx: ViewContext, analyses: Analyses, agents: readonly AgentRecord[], opts: { columns: number; inPlace: boolean; panels: boolean }) {
  const { Box } = ctx.els
  const cards = drawsCards(ctx) ? cardCap(ctx) : 0
  const cardWidth = opts.columns > 1 ? Math.floor((ctx.width - (opts.columns - 1)) / opts.columns) : ctx.width
  const entry = (agent: AgentRecord, i: number) => {
    const drawn = i < cards ? AgentCard(ctx, analyses, agent, cardWidth) : AgentLine(ctx, analyses, agent)
    if (!opts.inPlace || ctx.ui.focus !== agent.id) return drawn
    return (
      <Box key={`lv-entry-${agent.id}`} flexDirection="column">
        {drawn}
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          {Inspector(ctx, analyses, agent, { titled: true, cardShown: true, panels: opts.panels })}
        </Box>
      </Box>
    )
  }
  const head = agents.slice(0, Math.min(cards, agents.length))
  // The tiles stand a line apart (§6); the one-line rows after them stay packed.
  const grid =
    head.length > 0 ? (
      opts.columns > 1 ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {head.map((a, i) => entry(a, i))}
        </Box>
      ) : (
        <Box flexDirection="column" rowGap={1}>
          {head.map((a, i) => entry(a, i))}
        </Box>
      )
    ) : null
  const lines = agents.slice(head.length, LIST_CAP).map((a, i) => entry(a, head.length + i))
  const start = Math.max(LIST_CAP, head.length)
  const rest = agents.slice(start)
  const open = isOpen(ctx, SHOW_ALL)
  // A focused agent past the cap stays on screen, with its details, while the rest are folded away.
  const focusedRest = open ? -1 : rest.findIndex(a => a.id === ctx.ui.focus)
  const kept = focusedRest >= 0 ? rest[focusedRest] : undefined
  return (
    <Box flexDirection="column">
      {grid}
      {lines.length && grid ? <Box flexDirection="column" marginTop={1}>{lines}</Box> : lines}
      {rest.length
        ? Disclosure(ctx, SHOW_ALL, open ? `${rest.length} more agents` : `show ${rest.length} more agents`, () =>
            rest.map((a, i) => entry(a, start + i)),
          )
        : null}
      {kept ? entry(kept, start + focusedRest) : null}
    </Box>
  )
}

/** Filters, then the list, or why it is empty. */
function ListSection(ctx: ViewContext, analyses: Analyses, opts: { columns: number; inPlace: boolean; panels: boolean }) {
  const { Box } = ctx.els
  const agents = subagents(ctx.snapshot)
  if (agents.length === 0) return <Box marginTop={1}>{NoAgents(ctx)}</Box>
  const shown = visible(ctx, agents)
  const filter = ctx.ui.liveFilter ?? 'all'
  return (
    <Box flexDirection="column" marginTop={1} rowGap={1}>
      {Filters(ctx, agents)}
      {shown.length ? AgentList(ctx, analyses, shown, opts) : NoneMatch(ctx, filter, agents.length)}
    </Box>
  )
}

/** The focused agent's details for a column, or the empty tile that says how to open them. */
function DetailColumn(ctx: ViewContext, analyses: Analyses, focused: AgentRecord | undefined) {
  return focused ? Inspector(ctx, analyses, focused, { titled: true, cardShown: true, panels: true }) : NoneSelected(ctx)
}

// ── layouts ──

/** The way back from a focused agent to the list, on a pane too narrow for both. */
function BackToList(ctx: ViewContext) {
  const { Button, Text } = ctx.els
  return ctx.surface === 'terminal' ? (
    <Button key="focus-back" plain onPress={() => ctx.act.focus(undefined)}>
      <Text color={ROLE.accent}>◂ all agents</Text>
    </Button>
  ) : (
    <Button key="focus-back" plain label="◂ all agents" onPress={() => ctx.act.focus(undefined)} />
  )
}

/** Compact on the terminal (below 56 columns): one line per agent; a press shows the agent's details instead of the list. */
function Compact(ctx: ViewContext, analyses: Analyses, main: AgentRecord | undefined, focused: AgentRecord | undefined) {
  const { Box } = ctx.els
  if (focused) {
    return [
      BackToList(ctx),
      focused.isMain ? CoordinatorLine(ctx, analyses, focused) : AgentLine(ctx, analyses, focused),
      <Box flexDirection="column" marginTop={1}>
        {Inspector(ctx, analyses, focused, { titled: false, cardShown: false, panels: false })}
      </Box>,
      CostNote(ctx, analyses),
    ]
  }
  return [
    main ? CoordinatorLine(ctx, analyses, main) : null,
    ListSection(ctx, analyses, { columns: 1, inPlace: false, panels: false }),
    CostNote(ctx, analyses),
    HealthStrip(ctx, analyses),
  ]
}

/**
 * Narrow on the desktop (below 56 columns, the side dock): the full cards, one column, their lines reflowed onto more
 * rows; a press shows the agent's card and its details instead of the list, as compact does.
 */
function Narrow(ctx: ViewContext, analyses: Analyses, main: AgentRecord | undefined, focused: AgentRecord | undefined) {
  const { Box } = ctx.els
  if (focused) {
    return [
      BackToList(ctx),
      focused.isMain ? CoordinatorCard(ctx, analyses, focused, ctx.width) : AgentCard(ctx, analyses, focused, ctx.width),
      <Box flexDirection="column" marginTop={1}>
        {Inspector(ctx, analyses, focused, { titled: false, cardShown: true, panels: false })}
      </Box>,
      CostNote(ctx, analyses),
    ]
  }
  return [
    main ? CoordinatorCard(ctx, analyses, main, ctx.width) : null,
    ListSection(ctx, analyses, { columns: 1, inPlace: false, panels: false }),
    CostNote(ctx, analyses),
    HealthStrip(ctx, analyses),
  ]
}

function Medium(ctx: ViewContext, analyses: Analyses, main: AgentRecord | undefined, focused: AgentRecord | undefined) {
  const { Box } = ctx.els
  return [
    main ? CoordinatorCard(ctx, analyses, main, ctx.width) : null,
    main && focused?.isMain ? (
      <Box flexDirection="column" marginTop={1}>
        {Inspector(ctx, analyses, main, { titled: true, cardShown: true, panels: panels(ctx) })}
      </Box>
    ) : null,
    ListSection(ctx, analyses, { columns: 1, inPlace: true, panels: panels(ctx) }),
    HealthStrip(ctx, analyses),
  ]
}

/** Wide (100–139): master-detail; the list and Health left, the recent activity and the details right. */
function Wide(ctx: ViewContext, analyses: Analyses, main: AgentRecord | undefined, focused: AgentRecord | undefined) {
  const { Box } = ctx.els
  const left = Math.floor((ctx.width - 1) * LIST_SHARE)
  const right = ctx.width - 1 - left
  const list = sized(ctx, left)
  const detail = sized(ctx, right)
  const columns = left >= CARD_MIN_WIDTH * 2 + 1 ? 2 : 1
  return [
    main ? CoordinatorCard(ctx, analyses, main, ctx.width) : null,
    <Box flexDirection="row" columnGap={1}>
      <Box key="lv-list" flexDirection="column" width={left}>
        {ListSection(list, analyses, { columns, inPlace: false, panels: true })}
        {HealthStrip(list, analyses)}
      </Box>
      <Box key="lv-detail" flexDirection="column" width={right} marginTop={1} rowGap={1}>
        {RecentActivity(detail)}
        {DetailColumn(detail, analyses, focused)}
      </Box>
    </Box>,
  ]
}

/** Expanded (≥ 140): three columns, so nothing stretches: the cards · the details · the activity and Health. */
function Expanded(ctx: ViewContext, analyses: Analyses, main: AgentRecord | undefined, focused: AgentRecord | undefined) {
  const { Box } = ctx.els
  const room = ctx.width - 2
  const left = Math.floor(room * EXPANDED_LIST_SHARE)
  const middle = Math.floor(room * EXPANDED_DETAIL_SHARE)
  const right = room - left - middle
  const list = sized(ctx, left)
  const side = sized(ctx, right)
  const columns = left >= CARD_MIN_WIDTH * 2 + 1 ? 2 : 1
  return [
    main ? CoordinatorCard(ctx, analyses, main, ctx.width) : null,
    <Box flexDirection="row" columnGap={1}>
      <Box key="lv-list" flexDirection="column" width={left}>
        {ListSection(list, analyses, { columns, inPlace: false, panels: true })}
      </Box>
      <Box key="lv-detail" flexDirection="column" width={middle} marginTop={1}>
        {DetailColumn(sized(ctx, middle), analyses, focused)}
      </Box>
      <Box key="lv-side" flexDirection="column" width={right} marginTop={1}>
        {RecentActivity(side)}
        {HealthStrip(side, analyses)}
      </Box>
    </Box>,
  ]
}

export function LiveView(ctx: ViewContext, analyses: Analyses) {
  const { Box } = ctx.els
  const main = agentRecord(ctx.snapshot, 'main')
  const focused = focusedAgent(ctx)
  const body =
    ctx.layout === 'compact'
      ? (ctx.surface === 'terminal' ? Compact : Narrow)(ctx, analyses, main, focused)
      : ctx.layout === 'medium'
        ? Medium(ctx, analyses, main, focused)
        : isExpanded(ctx)
          ? Expanded(ctx, analyses, main, focused)
          : Wide(ctx, analyses, main, focused)
  return (
    <Box key="lv-root" flexDirection="column">
      {body}
    </Box>
  )
}
