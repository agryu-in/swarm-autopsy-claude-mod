// View D, Session Forensics: every observed event in order, filterable by kind
// (chips with counts) and by agent (a Select, chips in the compact dock, the
// pane's focused agent by default), paged, with the selected event's whole
// evidence beneath. Desktop: the timeline is one glass panel of aligned rows
// (the selected one lit), and the evidence a sunken panel with paths, commands
// and the diff in mono; the terminal keeps its lines.

import type { ForensicEvent, HealthLevel, TimelineFilter } from '../../types'
import { agentName, displayPath, offset, plural, truncate } from '../lib/format'
import { ROLE } from '../lib/palette'
import { matchesFilter, timelinePage } from '../lib/timeline'
import type { ViewContext } from './common'
import { AgentChip, Chips, EmptyState, EvidenceTag, GlassPanel, Heading, LEVEL_STYLE, Row, glassHover, paintsGlass, type ChipOption } from './kit'
import { EventLine, statusText } from './events'

const FILTERS: ReadonlyArray<{ id: TimelineFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'agents', label: 'Agents' },
  { id: 'files', label: 'Files' },
  { id: 'tests', label: 'Tests' },
  { id: 'failures', label: 'Failures' },
  { id: 'signals', label: 'Signals' },
]

const MIN_PAGE = 6
const RESERVED_ROWS = 22
/** In the compact dock the agent filter is chips while there are at most this many agents; a Select past that. */
const COMPACT_AGENT_CHIPS = 6
/** The Select's value for "every agent". */
const ALL = 'all'
/** The most options the engine lets a Select carry (it refuses the whole pane past this). */
const SELECT_MAX = 64
/** Cells before an event line in a row: the selection marker and the signal marker. */
const ROW_PREFIX = 4
/** Cells the timeline's glass panel takes from a row on desktop (padding and a hairline). */
const PANEL_CELLS = 3
/** The empty state's mark: an open circle, nothing to show (it carries no evidence meaning). */
const EMPTY_GLYPH = '○'

/**
 * A collision signal as Forensics needs it: which events it rests on and its title. `level` is the signal's own
 * severity when the caller passes it; rows mark a flagged event ▲ either way.
 */
export type SignalRef = { id: string; title: string; eventIds: readonly string[]; level?: HealthLevel }

/** What the call's input said: its paths and their access, its command, a note on its exit status, its edit. */
function InputFacts(ctx: ViewContext, event: ForensicEvent, width: number) {
  const { Box, Text } = ctx.els
  const cwd = ctx.snapshot.cwd
  const facts = event.tool
  if (!facts) return null
  return (
    <Box flexDirection="column">
      {facts.paths.length > 0 && (
        <Text wrap="wrap">
          paths ({facts.access}): <Text mono>{facts.paths.map(p => displayPath(p, cwd)).join(', ')}</Text>
        </Text>
      )}
      {facts.command && (
        <Text wrap="wrap">
          command{facts.verification ? ` (${facts.verification} command)` : ''}:{' '}
          <Text mono dimColor>
            {facts.command}
          </Text>
        </Text>
      )}
      {facts.statusNote && (
        <Text dimColor wrap="wrap">
          {facts.statusNote}
        </Text>
      )}
      {facts.edit && (
        <Box flexDirection="column">
          {facts.edit.old ? (
            <Text color="diffRemoved" mono wrap="wrap">
              − {truncate(facts.edit.old, width * 3)}
            </Text>
          ) : null}
          <Text color="diffAdded" mono wrap="wrap">
            + {truncate(facts.edit.new, width * 3)}
          </Text>
        </Box>
      )}
    </Box>
  )
}

/** What came back: the result in its verdict role with its basis and output, or that none was captured yet. */
function ResultFacts(ctx: ViewContext, event: ForensicEvent, width: number) {
  const { Box, Text } = ctx.els
  const outcome = event.outcome
  const status = statusText(event)
  return (
    <Box flexDirection="column">
      {outcome && outcome.status !== 'running' ? (
        <Box flexDirection="column">
          <Text wrap="wrap">
            result: <Text color={status.color}>{status.text}</Text>
            {outcome.verdictBasis ? <Text dimColor> · {outcome.verdictBasis}</Text> : ''}
          </Text>
          {outcome.text ? (
            <Text dimColor wrap="wrap">
              {truncate(outcome.text, width * 4)}
            </Text>
          ) : null}
        </Box>
      ) : outcome ? (
        <Text wrap="wrap">{EvidenceTag(ctx, 'UNRESOLVED')} result not captured yet (the call is running or its end was not observed)</Text>
      ) : null}
      {event.detail && (
        <Text dimColor wrap="wrap">
          {truncate(event.detail, width * 4)}
        </Text>
      )}
    </Box>
  )
}

/**
 * One event's whole evidence: who and when, its source, its input facts, its result, the signals that rest on it. On
 * desktop a sunken glass panel titled with the event; on the terminal a heading and its lines.
 */
export function EventEvidence(ctx: ViewContext, event: ForensicEvent, signals: readonly SignalRef[]) {
  const { Box } = ctx.els
  const title = `evidence · event #${event.seq}`
  if (!paintsGlass(ctx)) {
    return (
      <Box flexDirection="column" marginTop={1}>
        {Heading(ctx, title)}
        {EvidenceLines(ctx, event, signals, Math.max(30, ctx.width))}
      </Box>
    )
  }
  return <Box flexDirection="column" marginTop={1}>{GlassPanel(ctx, { tone: 'sunken', title, children: EvidenceLines(ctx, event, signals, Math.max(30, ctx.width - PANEL_CELLS)) })}</Box>
}

function EvidenceLines(ctx: ViewContext, event: ForensicEvent, signals: readonly SignalRef[], width: number) {
  const { Text } = ctx.els
  const related = signals.filter(s => s.eventIds.includes(event.id))
  return [
    <Text wrap="wrap">
      {EvidenceTag(ctx, 'OBSERVED')} {event.kind} by {AgentChip(ctx, event.agentId, { name: true })} · observed at{' '}
      {offset(ctx.snapshot.startedAt, event.at)}
      {event.endAt !== undefined ? `, result at ${offset(ctx.snapshot.startedAt, event.endAt)}` : ''}
    </Text>,
    <Text dimColor wrap="wrap">
      source: {event.source}
    </Text>,
    <Text wrap="wrap">{event.summary}</Text>,
    InputFacts(ctx, event, width),
    ResultFacts(ctx, event, width),
    ...related.map(signal => {
      const style = LEVEL_STYLE[signal.level ?? 'investigate']
      return (
        <Text wrap="wrap">
          <Text color={style.role}>{signal.level ? style.glyph : '▲'}</Text> part of signal: {signal.title}
        </Text>
      )
    }),
  ]
}

/** An agent's record, read as an own property (an id such as `constructor` is an agent, not Object's member). */
function recordOf(ctx: ViewContext, id: string) {
  return Object.hasOwn(ctx.snapshot.agents, id) ? ctx.snapshot.agents[id] : undefined
}

/** The agent the timeline is filtered to: the person's explicit pick, else the pane's focused agent. */
function agentFilterOf(ctx: ViewContext): { id?: string; fromFocus: boolean } {
  if (ctx.ui.agentFilter !== undefined) return { id: ctx.ui.agentFilter, fromFocus: false }
  const focus = ctx.ui.focus
  if (focus !== undefined && recordOf(ctx, focus) !== undefined) return { id: focus, fromFocus: true }
  return { fromFocus: false }
}

/** Kind chips, each with how many events it holds under the current agent filter. */
function KindChips(ctx: ViewContext, flagged: ReadonlySet<string>, agentId: string | undefined) {
  const events = ctx.snapshot.events.filter(e => agentId === undefined || e.agentId === agentId)
  const options: ChipOption[] = FILTERS.map(f => ({
    id: f.id,
    label: f.label,
    count: events.filter(e => matchesFilter(e, f.id, flagged)).length,
    active: ctx.ui.filter === f.id,
  }))
  return Chips(ctx, 'filter', options, id => ctx.act.filter(id as TimelineFilter))
}

/** Picking "every agent" lifts the focus pre-filter too; picking an agent filters to it. */
function pickAgent(ctx: ViewContext, value: string): void {
  if (value === ALL) {
    ctx.act.agentFilter(undefined)
    if (ctx.ui.focus !== undefined) ctx.act.focus(undefined)
    return
  }
  ctx.act.agentFilter(value)
}

/** The agent filter: chips in the compact dock (few agents), else a Select; chips again where no Select exists. */
function AgentFilter(ctx: ViewContext, flagged: ReadonlySet<string>, current: string | undefined) {
  const ids = ctx.snapshot.agentOrder
  const inKind = ctx.snapshot.events.filter(e => matchesFilter(e, ctx.ui.filter, flagged))
  const count = (id: string) => inKind.filter(e => e.agentId === id).length
  const nameOf = (id: string) => agentName(recordOf(ctx, id), id)
  const letterOf = (id: string) => (recordOf(ctx, id)?.isMain ? 'main' : (recordOf(ctx, id)?.label ?? id))
  const els = ctx.els
  if ((ctx.layout === 'compact' && ids.length <= COMPACT_AGENT_CHIPS) || !('Select' in els) || ctx.noSelect === true) {
    const options: ChipOption[] = [
      { id: ALL, label: 'all', count: inKind.length, active: current === undefined },
      ...ids.map(id => ({ id: `a:${id}`, label: letterOf(id), count: count(id), active: current === id })),
    ]
    return Chips(ctx, 'ag', options, id => pickAgent(ctx, id === ALL ? ALL : id.slice(2)))
  }
  const { Box, Select, Text } = els
  const listed = selectableAgents(ids, count, current)
  const options = [
    { value: ALL, label: `all agents (${inKind.length})` },
    ...listed.map(id => ({ value: id, label: `${truncate(nameOf(id), 28)} (${count(id)})` })),
  ]
  const select = <Select key="agent-filter" label="agent" options={options} value={current ?? ALL} onSelect={value => pickAgent(ctx, value)} />
  if (listed.length === ids.length) return select
  return (
    <Box flexDirection="column">
      {select}
      <Text dimColor wrap="wrap">
        The list holds the {listed.length} agents with the most events here, of {ids.length}; focus any other agent on Live to filter to it.
      </Text>
    </Box>
  )
}

/**
 * The agents a Select can list (the engine takes at most SELECT_MAX options, "all" included): every agent when they
 * fit, else the current one and those with the most events under the kind filter, drawn in spawn order.
 */
function selectableAgents(ids: readonly string[], count: (id: string) => number, current: string | undefined): string[] {
  const room = SELECT_MAX - 1
  if (ids.length <= room) return [...ids]
  const ranked = [...ids].sort((a, b) => count(b) - count(a) || ids.indexOf(a) - ids.indexOf(b))
  const chosen = new Set([...(current !== undefined && ids.includes(current) ? [current] : []), ...ranked].slice(0, room))
  return ids.filter(id => chosen.has(id))
}

/** "Filtered to the focused agent" and the button that lifts it: on its own row, never mixed into a wrapping row. */
function FocusNote(ctx: ViewContext, agentId: string) {
  const { Box, Text, Button } = ctx.els
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text wrap="truncate-end">
        <Text dimColor>focused: </Text>
        {AgentChip(ctx, agentId, { name: ctx.layout !== 'compact' })}
      </Text>
      <Button
        key="focus-clear"
        label="clear"
        variant="secondary"
        onPress={() => {
          ctx.act.agentFilter(undefined)
          ctx.act.focus(undefined)
        }}
      />
    </Box>
  )
}

/** Which page this is and how its rows run, as `timelinePage` orders them: page 1 holds the newest events. */
function orderText(page: number, pages: number): string {
  const where = page === 0 ? ' · newest' : page === pages - 1 ? ' · oldest' : ''
  return `page ${page + 1}/${pages}${where} · rows oldest → newest`
}

export function ForensicsView(ctx: ViewContext, signals: readonly SignalRef[]) {
  const { Box, Text } = ctx.els
  const flagged = new Set(signals.flatMap(s => s.eventIds))
  const size = Math.max(MIN_PAGE, ctx.rows - RESERVED_ROWS)
  const agent = agentFilterOf(ctx)
  const view = timelinePage(ctx.snapshot, ctx.ui.filter, agent.id, ctx.ui.page, size, flagged)
  const selectedId = ctx.ui.selected?.startsWith('ev:') ? ctx.ui.selected.slice(3) : undefined
  const selected = selectedId ? ctx.snapshot.events.find(e => e.id === selectedId) : undefined
  const glassy = paintsGlass(ctx)
  // The same width on both surfaces: it decides where a row turns narrow (EventLine, < 60), and on desktop the cells fit
  // the panel by flex whatever it says.
  const lineWidth = Math.max(26, ctx.width - ROW_PREFIX)
  const rows = view.rows.map(event => TimelineRow(ctx, event, { selected: selectedId === event.id, flagged: flagged.has(event.id), lineWidth }))
  return (
    <Box flexDirection="column">
      {Heading(ctx, 'Forensics', { summary: agent.id === undefined ? 'every agent' : `${agentName(recordOf(ctx, agent.id), agent.id)} only` })}
      <Text dimColor wrap="wrap">
        {plural(view.total, 'event')} · {orderText(view.page, view.pages)}
      </Text>
      {KindChips(ctx, flagged, agent.id)}
      {AgentFilter(ctx, flagged, agent.id)}
      {agent.fromFocus && agent.id !== undefined ? FocusNote(ctx, agent.id) : null}
      {ctx.snapshot.droppedEvents > 0 ? (
        <Text color={ROLE.muted} wrap="wrap">
          ∅ {plural(ctx.snapshot.droppedEvents, 'older event')} not in the timeline (dropped to bound memory)
        </Text>
      ) : null}
      {view.rows.length === 0 ? (
        EmptyState(ctx, 'No events match these filters.', 'Choose "All" or another agent; events appear here as the collector observes them.', { glyph: EMPTY_GLYPH })
      ) : glassy ? (
        <Box flexDirection="column" marginTop={1}>{GlassPanel(ctx, { tone: 'base', children: rows })}</Box>
      ) : (
        <Box flexDirection="column">{rows}</Box>
      )}
      {Pager(ctx, view.page, view.pages)}
      {selected ? (
        EventEvidence(ctx, selected, signals)
      ) : (
        <Text dimColor wrap="wrap">
          Select an event to see its evidence; ▲ marks an event a collision signal rests on.
        </Text>
      )}
    </Box>
  )
}

/**
 * One timeline row: the selection marker, ▲ when a collision signal rests on the event, and the shared event line.
 * Terminal: one Button of styled runs. Desktop: the marker Button beside the event's aligned Box cells, ▲ in its own
 * two-cell column, and the selected row lit with the glass hover fill.
 */
function TimelineRow(ctx: ViewContext, event: ForensicEvent, row: { selected: boolean; flagged: boolean; lineWidth: number }) {
  const { Box, Text } = ctx.els
  const line = EventLine(ctx, event, row.lineWidth, true)
  const press = () => ctx.act.select(row.selected ? undefined : `ev:${event.id}`)
  const key = `row-ev-${event.seq}`
  if (!paintsGlass(ctx)) {
    const flag = <Text color={ROLE.caution}>{row.flagged ? '▲ ' : '  '}</Text>
    return Row(ctx, { key, selected: row.selected, onPress: press, children: [flag, line] })
  }
  const cells = (
    <Box flexDirection="row" flexGrow={1}>
      <Box width={2} flexShrink={0}>
        {row.flagged ? <Text color={ROLE.caution}>▲</Text> : null}
      </Box>
      {line}
    </Box>
  )
  const drawn = Row(ctx, { key, selected: row.selected, onPress: press, children: line, cells })
  const lit = row.selected ? glassHover(ctx)?.backgroundColor : undefined
  // A column, so the row inside stretches across the panel (in a row it would shrink to its content).
  return lit ? (
    <Box flexDirection="column" backgroundColor={lit}>
      {drawn}
    </Box>
  ) : (
    drawn
  )
}

/** Older and newer pages, as buttons alone on their row; only the ones that lead somewhere. */
function Pager(ctx: ViewContext, page: number, pages: number) {
  const { Box, Button } = ctx.els
  if (pages <= 1) return null
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {page < pages - 1 ? <Button key="page-older" label="◀ Older" variant="secondary" onPress={() => ctx.act.page(page + 1)} /> : null}
      {page > 0 ? <Button key="page-newer" label="Newer ▶" variant="secondary" onPress={() => ctx.act.page(page - 1)} /> : null}
    </Box>
  )
}
