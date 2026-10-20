// Shared pieces of the pane: the view context and actions, the header (title,
// live dot, status pills, tabs with badges, the KPI glass tiles), the evidence
// legend and the footer.

import type { ElementTable, RenderSurface } from 'claude-code'

import type { Evidence, Instruments, Measure, LiveFilter, Snapshot, TimelineFilter, TrailFilter, UiState, View } from '../../types'
import { contextViewFor } from '../lib/context'
import { EVIDENCE_COLOR, EVIDENCE_GLYPH, MEASURE_COLOR, MEASURE_GLYPH, STATE_GLYPH, compact, pct, plural, subagents, truncate } from '../lib/format'
import { GLASS, ROLE, STATE_ROLE, TOKEN_CATEGORIES } from '../lib/palette'
import { findingsOf, unresolvedOf } from '../lib/signals'
import {
  BarStrip,
  ChoiceButton,
  CostText,
  Disclosure,
  EvidenceTag,
  headingInk,
  isExpanded,
  Kpi,
  type Layout,
  LiveDot,
  MeasureTag,
  Meter,
  paintsGlass,
  Pill,
  Ring,
  ShareBar,
  ThemeLine,
  TokenLegend,
} from './kit'
import type { Analyses } from './pane'

export { EvidenceTag, MeasureTag } from './kit'

export type Actions = {
  view: (view: View) => void
  select: (id: string | undefined) => void
  filter: (filter: TimelineFilter) => void
  agentFilter: (agentId: string | undefined) => void
  page: (page: number) => void
  openEvent: (eventId: string) => void
  /** Shows or hides ≈$ API-equivalent estimates (UiState.showCost). */
  toggleCost: () => void
  /** Puts an agent in focus across views, or clears the focus. */
  focus: (agentId: string | undefined) => void
  /** Focuses the agent, or clears the focus when it already has it. */
  toggleFocus: (agentId: string) => void
  /** Opens or closes a disclosure or section by id. */
  toggleOpen: (id: string) => void
  trailFilter: (filter: TrailFilter) => void
  liveFilter: (filter: LiveFilter) => void
  /** Asks the terminal's dock for a wider pane, or for its default width: a request, never a grant (sizesPaneOnRequest). */
  requestWidth: (wide: boolean) => void
  /** Switches to the Trail and selects a node there. */
  showNode: (nodeId: string) => void
  /** Pauses or resumes live updates (UiState.paused). */
  togglePause: () => void
  /** Switches the scene's mode (its remembered scene with it); kept in the store for every chat. */
  mode: (mode: string) => void
  /** Shows a scene (its mode with it); kept in the store for every chat. */
  scene: (scene: string) => void
  /** Plays or pauses the scenes' music for every chat. */
  play: () => void
  /** The music's volume step, 1–5, for every chat. */
  volume: (step: number) => void
  /** How clear the liquid glass is, 1 (frosted) to 5 (crystal), for every chat. */
  glass: (step: number) => void
  /** Shows that part of the current view in the still pane (a view too long for one Client). */
  part: (index: number) => void
}

export type ViewContext = {
  els: ElementTable
  surface: RenderSurface
  width: number
  rows: number
  /** Rows the pane is scrolled down by (the desktop reports it on every scroll step); the backdrop frame sits there. */
  scrollOffset?: number
  /** The layout class for this width. */
  layout: Layout
  /**
   * Whether the pane draws held data: `paused` (the person paused it) or `browsing` (a press in the last seconds). A
   * desktop redraw re-mints every press handle, so while the person browses the data and clock stay frozen.
   */
  held?: 'paused' | 'browsing'
  now: number
  snapshot: Snapshot
  ui: UiState
  act: Actions
  /** The content is drawn inside a Client (the still pane), which draws no Select: views offer chips instead. */
  noSelect?: boolean
}

export const VIEWS: ReadonlyArray<{ id: View; label: string; hotkey: string }> = [
  { id: 'live', label: 'Live', hotkey: '1' },
  { id: 'trail', label: 'Trail', hotkey: '2' },
  { id: 'collisions', label: 'Collisions', hotkey: '3' },
  { id: 'forensics', label: 'Forensics', hotkey: '4' },
  { id: 'spend', label: 'Spend', hotkey: '5' },
  { id: 'health', label: 'Health', hotkey: '6' },
]

/**
 * A dim rule with an optional label: kept for the footer; sections use `Heading` from the kit. `mono`, so on desktop
 * each `─` is one cell and the rule fits the pane instead of wrapping a stub onto the next line. On desktop it is drawn
 * in the theme's strong glass edge (a hairline like the panels' own; Abyssal's brass); the terminal keeps its dim rule.
 */
export function Rule(ctx: ViewContext, label?: string) {
  const { Text } = ctx.els
  const width = Math.max(10, ctx.width)
  const head = label ? `── ${label} ` : ''
  return (
    <Text mono dimColor {...(paintsGlass(ctx) ? { color: GLASS.edgeStrong } : {})}>
      {truncate(head + '─'.repeat(Math.max(0, width - head.length)), width)}
    </Text>
  )
}

function stateCounts(snapshot: Snapshot): Record<string, number> {
  const counts: Record<string, number> = { active: 0, completed: 0, failed: 0, stopped: 0, unknown: 0 }
  for (const agent of subagents(snapshot)) counts[agent.state] = (counts[agent.state] ?? 0) + 1
  return counts
}

function badgeFor(view: View, analyses: Analyses): number {
  if (view === 'collisions') return analyses.collisions.signals.length
  if (view === 'health') return findingsOf(analyses.health).length
  return 0
}

function Tabs(ctx: ViewContext, analyses: Analyses) {
  const { Box } = ctx.els
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {VIEWS.map(view => {
        const badge = badgeFor(view.id, analyses)
        // The count in parentheses, so it never reads as a second number beside the desktop's hotkey keycap.
        const label = `${ctx.surface === 'terminal' ? `${view.hotkey} ` : ''}${view.label}${badge > 0 ? ` (${badge})` : ''}`
        return ChoiceButton(ctx, {
          key: `tab-${view.id}`,
          label,
          hotkey: view.hotkey,
          selected: ctx.ui.view === view.id,
          onPress: () => ctx.act.view(view.id),
        })
      })}
    </Box>
  )
}

/** The `? N unresolved` count every view draws: the findings Health marks `?`, never a second tally. */
export function UnresolvedCount(ctx: ViewContext, health: Analyses['health']) {
  const { Text } = ctx.els
  const n = unresolvedOf(health).length
  return (
    <Text>
      <Text color={n > 0 ? ROLE.caution : ROLE.muted}>?</Text> {n} unresolved
    </Text>
  )
}

/**
 * The status facts: main context first (it is cut last), then agents, signals, the unresolved count, and the hold.
 * Desktop: a row of glass pills; terminal: one line. The counts carry their own ● (they are observed counts).
 */
function StatusLine(ctx: ViewContext, analyses: Analyses) {
  const { Box, Text } = ctx.els
  const agents = subagents(ctx.snapshot)
  const active = agents.filter(a => a.state === 'active').length
  const context = contextViewFor(ctx.snapshot, 'main').percent
  const contextChip =
    context.measure === 'UNAVAILABLE' ? (
      <Text color={ROLE.muted}>{MEASURE_GLYPH.UNAVAILABLE} ctx n/a</Text>
    ) : (
      <Text>
        <Text color={MEASURE_COLOR[context.measure]}>{MEASURE_GLYPH[context.measure]}</Text> ctx {pct(context.value)}
      </Text>
    )
  const agentsChip = (
    <Text>
      <Text color={active > 0 ? ROLE.context : ROLE.muted}>{STATE_GLYPH.active}</Text> {active} active of {plural(agents.length, 'agent')}
    </Text>
  )
  const signalsChip = (
    <Text>
      {MeasureTag(ctx, 'OBSERVED', false)} {plural(findingsOf(analyses.health).length, 'signal')}
    </Text>
  )
  const held = ctx.held ? <Text color={ROLE.neutral}>⏸ {ctx.held === 'paused' ? 'paused' : 'held while you browse'}</Text> : null
  // The desktop draws the figures as pills at every width: a row that wraps, never a line cut off at the pane's edge.
  if (paintsGlass(ctx)) {
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {Pill(ctx, { key: 'st-ctx', children: contextChip })}
        {Pill(ctx, { key: 'st-agents', children: agentsChip })}
        {Pill(ctx, { key: 'st-signals', children: signalsChip })}
        {Pill(ctx, { key: 'st-unresolved', children: UnresolvedCount(ctx, analyses.health) })}
        {held ? Pill(ctx, { key: 'st-held', edge: ROLE.neutral, children: held }) : null}
      </Box>
    )
  }
  return (
    <Text wrap="truncate-end">
      {contextChip}
      <Text dimColor> · </Text>
      {agentsChip}
      <Text dimColor> · </Text>
      {signalsChip}
      <Text dimColor> · </Text>
      {UnresolvedCount(ctx, analyses.health)}
      {held ? (
        <Text>
          <Text dimColor> · </Text>
          {held}
        </Text>
      ) : (
        ''
      )}
    </Text>
  )
}

function TokensTile(ctx: ViewContext, analyses: Analyses, width: number) {
  const { Box, Text } = ctx.els
  const session = analyses.ledger.session
  const heard = session.requests + session.requestsWithoutUsage > 0
  // Usage is known only from requests that came back with counts; all without counts is unknown, never an observed 0.
  const recorded = session.requests > 0
  const showCost = ctx.ui.showCost === true
  const inner = Math.max(8, width - 4)
  if (heard && !recorded) {
    return Kpi(ctx, {
      key: 'tokens',
      label: 'tokens processed · session',
      value: 'usage unknown',
      measure: 'UNAVAILABLE',
      width,
      children: (
        <Text dimColor wrap="wrap">
          {plural(session.requestsWithoutUsage, 'request')} came back without usage counts
        </Text>
      ),
    })
  }
  const narrow = ctx.layout === 'compact'
  return Kpi(ctx, {
    key: 'tokens',
    label: narrow ? 'tokens processed' : 'tokens processed · session',
    value: recorded ? compact(session.processed) : 'none recorded',
    measure: recorded ? 'OBSERVED' : 'UNAVAILABLE',
    width,
    children: recorded ? (
      [
        // In a row Box, so the bar sits at the tile's text edge rather than centred across the tile.
        <Box flexDirection="row">
          {BarStrip(
            ctx,
            TOKEN_CATEGORIES.map(c => ({ value: session.tokens[c.key], role: c.role })),
            inner,
          )}
        </Box>,
        // A narrow card keeps the bar; the categories' legend is the Spend tab's.
        narrow ? null : TokenLegend(ctx, session.tokens),
        showCost && session.cost ? (
          <Text wrap="wrap">
            {CostText(ctx, session.cost, showCost)}
            <Text dimColor> API-equivalent at {session.cost.priceDate} prices, not a charge</Text>
          </Text>
        ) : null,
      ]
    ) : (
      <Text dimColor wrap="wrap">
        no model request heard yet
      </Text>
    ),
  })
}

/**
 * The tile's bare gauge beside the ring: a Box bar on desktop (the same gauge the cards draw, never wrapping), the mono
 * text meter on the terminal. The labelled value is the tile's own headline, so the bar carries no label of its own.
 */
function ContextBar(ctx: ViewContext, percent: number, measure: Measure, cells: number) {
  const { Box } = ctx.els
  if (!paintsGlass(ctx)) return Meter(ctx, { percent, measure, width: cells, bare: true })
  return (
    <Box flexDirection="row">
      {ShareBar(ctx, percent / 100, cells, measure === 'ESTIMATED' ? ROLE.caution : ROLE.context)}
    </Box>
  )
}

function ContextTile(ctx: ViewContext, width: number) {
  const { Box, Text } = ctx.els
  const view = contextViewFor(ctx.snapshot, 'main')
  const { percent, window } = view
  const available = percent.measure !== 'UNAVAILABLE' && percent.value !== undefined
  const detail =
    available && percent.tokens !== undefined && window.tokens !== undefined
      ? `${compact(percent.tokens)} of ${compact(window.tokens)} tokens`
      : percent.basis.replace(/^% unavailable: /, '')
  return Kpi(ctx, {
    key: 'context',
    label: 'main context',
    value: available ? pct(percent.value) : 'n/a',
    measure: available ? percent.measure : 'UNAVAILABLE',
    width,
    children: (
      <Box flexDirection="row" columnGap={1}>
        {/* A narrow card has no room for the ring beside its bar: the bar alone, as wide as the card. */}
        {ctx.layout === 'compact' ? null : Ring(ctx, { percent: percent.value, measure: percent.measure, label: detail })}
        {/* minWidth 0: the column may shrink below its text, so the detail is cut with an ellipsis inside the card. */}
        <Box flexDirection="column" flexShrink={1} minWidth={0}>
          {available ? ContextBar(ctx, percent.value ?? 0, percent.measure, Math.max(6, width - (ctx.layout === 'compact' ? 4 : 14))) : null}
          <Text dimColor wrap="truncate-end">
            {detail}
          </Text>
        </Box>
      </Box>
    ),
  })
}

function AgentsTile(ctx: ViewContext, width: number) {
  const { Text } = ctx.els
  const counts = stateCounts(ctx.snapshot)
  const total = subagents(ctx.snapshot).length
  const parts = (['active', 'completed', 'failed', 'stopped', 'unknown'] as const).filter(s => (counts[s] ?? 0) > 0)
  return Kpi(ctx, {
    key: 'agents',
    label: 'subagents',
    value: String(total),
    measure: 'OBSERVED',
    width,
    children: (
      <Text wrap="truncate-end">
        {parts.length === 0 ? (
          <Text dimColor>none observed yet</Text>
        ) : (
          parts.map((state, i) => (
            <Text>
              {i > 0 ? ' · ' : ''}
              <Text color={STATE_ROLE[state]}>{STATE_GLYPH[state]}</Text> {counts[state]} {state === 'completed' ? 'done' : state}
            </Text>
          ))
        )}
      </Text>
    ),
  })
}

function SignalsTile(ctx: ViewContext, analyses: Analyses, width: number) {
  const { Text } = ctx.els
  return Kpi(ctx, {
    key: 'signals',
    label: ctx.layout === 'compact' ? 'signals' : 'signals · from existing analyses',
    value: String(findingsOf(analyses.health).length),
    measure: 'OBSERVED',
    width,
    children: (
      <Text wrap="truncate-end">
        {plural(analyses.collisions.signals.length, 'collision')} · {UnresolvedCount(ctx, analyses.health)}
      </Text>
    ),
  })
}

/** The widest a KPI tile grows on an expanded pane, in cells. */
const KPI_MAX_WIDTH = 46

/** From this many columns a compact desktop pane puts its summary cards two to a row; narrower, one. */
const TWO_CARDS_FROM = 40

/**
 * The KPI strip: four tiles wide, two per row medium. On the desktop compact panes draw the tiles too (two per row from
 * TWO_CARDS_FROM columns, one below), so the default side pane shows the same cards as a wide one; the terminal's
 * compact pane draws none (its status line carries the figures).
 */
function KpiStrip(ctx: ViewContext, analyses: Analyses) {
  const { Box } = ctx.els
  if (ctx.layout === 'compact' && !paintsGlass(ctx)) return null
  const perRow = ctx.layout === 'wide' ? 4 : ctx.layout === 'medium' || ctx.width >= TWO_CARDS_FROM ? 2 : 1
  // Expanded panes cap the tiles rather than stretch them.
  const fair = Math.floor((ctx.width - (perRow - 1)) / perRow)
  const tileWidth = Math.max(20, isExpanded(ctx) ? Math.min(fair, KPI_MAX_WIDTH) : fair)
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} {...(paintsGlass(ctx) ? { rowGap: 1 } : {})}>
      {TokensTile(ctx, analyses, tileWidth)}
      {ContextTile(ctx, tileWidth)}
      {AgentsTile(ctx, tileWidth)}
      {SignalsTile(ctx, analyses, tileWidth)}
    </Box>
  )
}

/**
 * Whether the surface sizes the pane at the plugin's request (`$.ui.open` `columns`): the terminal docks it that wide
 * beside a fullscreen transcript. The desktop app (2.1.299 bundle) keeps the request in its roster but never reads it:
 * its dock is as wide as the person drags it (280 to 640 px), so a wider/narrower button there would change nothing.
 */
export const sizesPaneOnRequest = (surface: RenderSurface): boolean => surface === 'terminal'

/**
 * The header's rhythm on the desktop: the title and its scene line read as one group, and every block after it (the
 * status pills, the tabs, the summary cards, the legend) sits one gap below the last, the same gap as between the agent
 * cards (rowGap 1). The terminal keeps its compact lines.
 */
const HEADER_GAP = 1

export function Header(ctx: ViewContext, analyses: Analyses) {
  const { Box, Text, Button } = ctx.els
  const glassy = paintsGlass(ctx)
  const titleRow = (
    <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text wrap="truncate-end">
          <Text color={ROLE.accent} weight="bold">
            ◢
          </Text>
          <Text weight="semibold" size="title" {...headingInk()}>
            {' '}
            Swarm Autopsy
          </Text>
        </Text>
        {LiveDot(ctx, !ctx.held && subagents(ctx.snapshot).some(a => a.state === 'active'))}
      </Box>
      <Box flexDirection="row" columnGap={1}>
        <Button
          key="toggle-pause"
          label={ctx.ui.paused ? '▶ live' : '⏸ pause'}
          variant="secondary"
          onPress={() => ctx.act.togglePause()}
        />
        {sizesPaneOnRequest(ctx.surface) ? (
          <Button
            key="toggle-wide"
            label={ctx.ui.wide ? '⇔ narrower' : '⇔ wider'}
            variant="secondary"
            onPress={() => ctx.act.requestWidth(ctx.ui.wide !== true)}
          />
        ) : null}
      </Box>
    </Box>
  )
  return (
    <Box key="pane-header" flexDirection="column" {...(glassy ? { rowGap: HEADER_GAP } : {})}>
      <Box key="pane-identity" flexDirection="column">
        {titleRow}
        {ThemeLine(ctx)}
      </Box>
      {StatusLine(ctx, analyses)}
      {Tabs(ctx, analyses)}
      {/* On the desktop the header's own gap sets the cards apart; the terminal keeps its line above them. */}
      <Box flexDirection="column" marginTop={glassy || ctx.layout === 'compact' ? 0 : 1}>
        {KpiStrip(ctx, analyses)}
      </Box>
      {Legend(ctx)}
    </Box>
  )
}

const LEGEND_MEANING: Record<Evidence, string> = {
  OBSERVED: 'read from one event or result',
  LINKED: 'an explicit identifier or verbatim text ties two things',
  INFERRED: 'a shared name, file or order suggests the tie; not proven',
  UNRESOLVED: 'the evidence does not settle it',
  UNAVAILABLE: 'Claude Code does not expose it, or it was not captured',
}

/** The labels in one line; their meanings behind a disclosure. */
export function Legend(ctx: ViewContext) {
  const { Box, Text } = ctx.els
  const order: Evidence[] = ['OBSERVED', 'LINKED', 'INFERRED', 'UNRESOLVED', 'UNAVAILABLE']
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {order.map(evidence => (
          <Text color={EVIDENCE_COLOR[evidence]}>{EVIDENCE_GLYPH[evidence]} </Text>
        ))}
        <Text dimColor>evidence · </Text>
        <Text color={MEASURE_COLOR.OBSERVED}>{MEASURE_GLYPH.OBSERVED} </Text>
        <Text color={MEASURE_COLOR.ESTIMATED}>{MEASURE_GLYPH.ESTIMATED} </Text>
        <Text color={MEASURE_COLOR.UNAVAILABLE}>{MEASURE_GLYPH.UNAVAILABLE} </Text>
        <Text dimColor>numbers</Text>
      </Text>
      {Disclosure(ctx, 'legend', 'what the labels mean', () => (
        <Box flexDirection="column">
          {order.map(evidence => (
            <Text wrap="wrap">
              {EvidenceTag(ctx, evidence)} <Text dimColor>{LEGEND_MEANING[evidence]}</Text>
            </Text>
          ))}
          <Text wrap="wrap">
            {MeasureTag(ctx, 'OBSERVED')} <Text dimColor>a count read from Claude Code, or exact arithmetic over such counts</Text>
          </Text>
          <Text wrap="wrap">
            {MeasureTag(ctx, 'ESTIMATED')} <Text dimColor>needs a stated assumption: ≈$ list prices, a subagent's window</Text>
          </Text>
          <Text wrap="wrap">
            {MeasureTag(ctx, 'UNAVAILABLE')} <Text dimColor>not exposed or not captured: shown as n/a, never as 0</Text>
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// `agentStop` counts the classic SubagentStop hook only; an agent's completion
// is read from its turn.complete (or the roster), so a 0 here is not a finding.
const INSTRUMENT_NAMES: ReadonlyArray<[keyof Instruments, string]> = [
  ['spawn', 'spawns'],
  ['turnStart', 'turn starts'],
  ['turnEnd', 'turn ends'],
  ['step', 'model requests'],
  ['tool', 'tool calls'],
  ['agentStop', 'SubagentStop hooks'],
  ['compaction', 'compactions'],
  ['measure', 'context readings'],
]

/** Warnings that change how to read the pane stay visible; the stream counters sit behind "instruments". */
export function Footer(ctx: ViewContext) {
  const { Box, Text } = ctx.els
  const seen = INSTRUMENT_NAMES.map(([key, name]) => `${name} ${ctx.snapshot.instruments[key]}`).join(' · ')
  const noSpawnButAgents = ctx.snapshot.instruments.spawn === 0 && subagents(ctx.snapshot).length > 0
  return (
    <Box flexDirection="column" marginTop={1}>
      {Rule(ctx)}
      {noSpawnButAgents && (
        <Text color={ROLE.neutral} wrap="wrap">
          Agents were seen without any agent.spawn event, so their parents and tasks are unavailable.
        </Text>
      )}
      {ctx.snapshot.droppedEvents > 0 && (
        <Text color={ROLE.neutral} wrap="wrap">
          {plural(ctx.snapshot.droppedEvents, 'older event')} dropped from the timeline to bound memory; agent totals still count them.
        </Text>
      )}
      {ctx.snapshot.notes.map(note => (
        <Text color={ROLE.neutral} wrap="wrap">
          {note}
        </Text>
      ))}
      {Disclosure(ctx, 'instruments', 'instruments: which event streams have delivered anything', () => (
        <Text dimColor wrap="wrap">
          Observed so far: {seen}.
        </Text>
      ))}
    </Box>
  )
}
