// View: Contribution Trail (DESIGN-CONTRACT §8.3). Per agent, the flow from
// delegation through findings, changes and verification to its F3 outcome,
// the evidence-coded edges between nodes, and what stays unresolved.
// - Outcome box first (verifications, flags, F3 spend vs outcome);
// - filter chips and the edge legend;
// - desktop: the map (wide) or the stage overview (narrower, or a map too large),
//   each beside its native twin; terminal wide: a text overview, stages as columns;
// - the lanes (capped, with a way to show more): a stage-grouped list (medium,
//   wide) or one open lane (compact).
// Every node opens its evidence under itself; every edge shows its basis there.

import type { HealthSignal, SpendOutcome, TrailFilter } from '../../types'
import { EVIDENCE_COLOR, EVIDENCE_GLYPH, VERDICT_COLOR, VERDICT_GLYPH, plural } from '../lib/format'
import { agentRecord } from '../lib/outcome'
import { ROLE } from '../lib/palette'
import type { Trail, TrailLane } from '../lib/trail'
import type { ViewContext } from './common'
import { AgentChip, Chips, Disclosure, EmptyState, GlassPanel, Heading, drawsSvg, isOpen } from './kit'
import { CompactLanes, LaneList, laneInner, type LaneScope } from './trail-lane'
import {
  ALL_LANES,
  FLOW_OF,
  FLOW_STAGES,
  LANE_CAP,
  LANE_CAP_ALL,
  STAGE_GLYPH,
  STAGE_ROLE,
  STAGE_TITLE,
  TRAIL_FILTERS,
  badgeFor,
  filterCounts,
  laneMatches,
  lanesToDraw,
  nodeMatches,
  nodesById,
  openLaneOf,
  pathOf,
  type FlowStage,
} from './trail-model'
import { OutcomeBox } from './trail-outcome'
import { CELL_PX, trailOverviewSvg, trailSvg, type MapInput } from './trailmap'

type Placed = { lane: TrailLane; index: number }

/** The empty states' mark: an open circle, nothing drawn yet (it carries no evidence meaning). */
const EMPTY_GLYPH = '○'

/** The filter chips: each the number of lanes it shows (membership: trail-model). "verified" carries its ◇ (F3-4). */
function Filters(ctx: ViewContext, trail: Trail, spend: SpendOutcome, active: TrailFilter) {
  const { Box, Text } = ctx.els
  const counts = filterCounts(trail, spend)
  const options = TRAIL_FILTERS.map(id => ({
    id,
    label: id === 'verified' ? `${EVIDENCE_GLYPH.INFERRED} verified` : id,
    count: counts[id],
    active: id === active,
  }))
  const pick = (id: string) => {
    const filter = TRAIL_FILTERS.find(f => f === id)
    if (filter) ctx.act.trailFilter(filter)
  }
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text dimColor>show lanes</Text>
      {Chips(ctx, 'tf', options, pick)}
    </Box>
  )
}

function EdgeLegend(ctx: ViewContext, selected: boolean) {
  const { Text } = ctx.els
  return (
    <Text wrap="truncate-end">
      <Text dimColor>edges </Text>
      <Text color={EVIDENCE_COLOR.LINKED}>─◆→</Text> LINKED <Text dimColor>·</Text> <Text color={EVIDENCE_COLOR.INFERRED}>╌◇→</Text> INFERRED
      <Text dimColor>{selected ? ' · the selected node’s path is marked “on path”' : ' · select a node for its evidence and path'}</Text>
    </Text>
  )
}

/**
 * Desktop: the edge map on wide panes, the stage overview on narrower ones and whenever the map would not fit the
 * source budget, on a glass panel. Image mode sized by its viewBox (a Client requires a size) in the panel's column Box: the
 * drawing (a viewBox about the pane's pixel width) fills the panel at its own ratio, its type near 1:1 (R1 §6.3d, SG-9). Never pressable and
 * without tooltips: the list is the twin.
 */
function Picture(ctx: ViewContext, trail: Trail, input: MapInput) {
  // Compact draws no chart (Sunset Glass V-9): at that width it would be a miniature, and the beads already show the flow.
  if (ctx.layout === 'compact' || !drawsSvg(ctx) || !('Svg' in ctx.els)) return null
  const { Box, Svg } = ctx.els
  const map = ctx.layout === 'wide' ? trailSvg(ctx.snapshot, trail, input) : undefined
  const picture = map?.drawable ? map : trailOverviewSvg(ctx.snapshot, trail, input)
  if (!picture.drawable) return null
  // Its viewBox is the drawing's own size (about the pane's pixel width): a Client needs it as the image's size.
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(picture.source)
  const size = box ? { width: Math.min(4096, Math.max(1, Math.round(Number(box[1])))), height: Math.min(4096, Math.max(1, Math.round(Number(box[2])))) } : {}
  return <Box flexDirection="column" marginTop={1}>{GlassPanel(ctx, { tone: 'base', children: <Svg source={picture.source} alt={picture.alt} {...size} /> })}</Box>
}

/** One lane's nodes of one stage as beads (verification beads are verdict glyphs), padded to `cell`. */
function Beads(ctx: ViewContext, lane: TrailLane, stage: FlowStage, cell: number) {
  const { Text } = ctx.els
  const nodes = lane.nodes.filter(n => FLOW_OF[n.stage] === stage)
  const shown = nodes.slice(0, Math.max(1, cell - 4))
  const more = nodes.length > shown.length ? `+${nodes.length - shown.length}` : ''
  return (
    <Text>
      {shown.map(n =>
        n.stage === 'verification' ? (
          <Text color={VERDICT_COLOR[n.verdict ?? 'running']}>{VERDICT_GLYPH[n.verdict ?? 'running']}</Text>
        ) : (
          <Text color={STAGE_ROLE[n.stage]}>{STAGE_GLYPH[n.stage]}</Text>
        ),
      )}
      {more}
      {' '.repeat(Math.max(1, cell - shown.length - more.length))}
    </Text>
  )
}

const LABEL_W = 22
const OUTCOME_W = 24

function OverviewRow(ctx: ViewContext, spend: SpendOutcome, lane: TrailLane, cell: number) {
  const { Text } = ctx.els
  const agent = agentRecord(ctx.snapshot, lane.agentId)
  const badge = badgeFor(spend, lane.agentId)
  const name = agent?.isMain ? '◎ main' : ` ${agent?.type ?? 'type unknown'}`
  const room = LABEL_W - (agent?.isMain ? 0 : 3)
  return (
    <Text wrap="truncate-end">
      {agent?.isMain ? '' : AgentChip(ctx, lane.agentId)}
      <Text color={agent?.isMain ? ROLE.main : undefined} dimColor={!agent?.isMain}>
        {name.slice(0, room - 1).padEnd(room)}
      </Text>
      {FLOW_STAGES.map(stage => Beads(ctx, lane, stage, cell))}
      {badge ? (
        <Text color={badge.role}>
          {badge.evidence ? `${EVIDENCE_GLYPH[badge.evidence]} ` : ''}
          {badge.label}
        </Text>
      ) : (
        ''
      )}
    </Text>
  )
}

/** Terminal, wide: one row per lane with the stages as columns (one bead per node) and the outcome at the end. */
function TextOverview(ctx: ViewContext, spend: SpendOutcome, lanes: readonly Placed[]) {
  const { Box, Text } = ctx.els
  const cell = Math.max(8, Math.floor((ctx.width - LABEL_W - OUTCOME_W) / FLOW_STAGES.length))
  const head = FLOW_STAGES.map(stage => `${STAGE_GLYPH[stage]} ${STAGE_TITLE[stage]}`.padEnd(cell)).join('')
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor wrap="truncate-end">
        {' '.repeat(LABEL_W)}
        {head}
        {STAGE_TITLE.outcome}
      </Text>
      {lanes.map(({ lane }) => OverviewRow(ctx, spend, lane, cell))}
    </Box>
  )
}

/** "showing 12 of 140 lanes" and the disclosure that shows up to LANE_CAP_ALL; nothing when every lane is drawn. */
function LaneCap(ctx: ViewContext, drawn: number, total: number) {
  const { Box, Text } = ctx.els
  const all = isOpen(ctx, ALL_LANES)
  if (total <= LANE_CAP) return null
  const past = all && total > drawn
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">
        showing {drawn} of {total} lanes
        {past ? ' · filter, or focus an agent from Live, to reach the others' : ''}
      </Text>
      {Disclosure(
        ctx,
        ALL_LANES,
        all ? `showing up to ${LANE_CAP_ALL} lanes and their nodes (press for the first ${LANE_CAP})` : `show up to ${LANE_CAP_ALL} lanes and their nodes`,
        () => null,
      )}
    </Box>
  )
}

function Lanes(ctx: ViewContext, trail: Trail, spend: SpendOutcome, scope: LaneScope, lanes: readonly Placed[], input: MapInput) {
  const { Box } = ctx.els
  return (
    <Box flexDirection="column">
      {Picture(ctx, trail, input)}
      {ctx.layout === 'wide' && !drawsSvg(ctx) ? TextOverview(ctx, spend, lanes) : null}
      {ctx.layout === 'compact' ? CompactLanes(scope, lanes, openLaneOf(trail, ctx.ui)) : LaneList(scope, lanes)}
    </Box>
  )
}

export function TrailView(ctx: ViewContext, trail: Trail, spend: SpendOutcome, health: readonly HealthSignal[] = []) {
  const { Box, Text } = ctx.els
  if (trail.lanes.length === 0) {
    return (
      <Box flexDirection="column">
        {OutcomeBox(ctx, trail, spend, health)}
        <Box flexDirection="column" marginTop={1}>
          {EmptyState(ctx, 'No contributions yet', 'The trail fills in as agents are delegated work, report back, change files and run checks.', { glyph: EMPTY_GLYPH })}
        </Box>
      </Box>
    )
  }
  const filter: TrailFilter = ctx.ui.trailFilter ?? 'all'
  const byId = nodesById(trail)
  const wanted = ctx.ui.selected?.startsWith('node:') ? ctx.ui.selected.slice('node:'.length) : undefined
  const selected = wanted !== undefined && byId.has(wanted) ? wanted : undefined
  const scope: LaneScope = { ctx, trail, spend, byId, path: pathOf(trail, selected), selectedId: selected, filter, inner: laneInner(ctx) }
  const matching = trail.lanes.map((lane, index) => ({ lane, index })).filter(({ lane }) => laneMatches(trail, spend, lane, filter))
  const lanes = lanesToDraw(matching, ctx.ui, isOpen(ctx, ALL_LANES) ? LANE_CAP_ALL : LANE_CAP)
  const input: MapInput = {
    widthPx: ctx.width * CELL_PX,
    spend,
    selectedNodeId: selected,
    focusAgentId: ctx.ui.focus,
    lanes: lanes.map(l => l.lane.agentId),
    emphasis: filter === 'all' ? undefined : new Set([...byId.values()].filter(n => nodeMatches(trail, spend, n, filter)).map(n => n.id)),
    cwd: ctx.snapshot.cwd,
  }
  const hidden = selected !== undefined && !matching.some(({ lane }) => lane.nodes.some(n => n.id === selected))
  return (
    <Box flexDirection="column">
      {OutcomeBox(ctx, trail, spend, health)}
      <Box flexDirection="column" marginTop={1}>
        {Heading(ctx, 'Contribution flow', { summary: `${plural(matching.length, 'lane')} · ${plural(trail.edges.length, 'edge')}` })}
        {Filters(ctx, trail, spend, filter)}
        {EdgeLegend(ctx, selected !== undefined)}
        {hidden ? <Text color={ROLE.caution}>The selected node is in a lane this filter hides.</Text> : null}
        {LaneCap(ctx, lanes.length, matching.length)}
      </Box>
      {lanes.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>{EmptyState(ctx, 'No lane matches this filter', 'Choose “all” to see every lane.', { glyph: EMPTY_GLYPH })}</Box>
      ) : (
        Lanes(ctx, trail, spend, scope, lanes, input)
      )}
    </Box>
  )
}
