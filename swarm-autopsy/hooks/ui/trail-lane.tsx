// The Trail's lanes as native rows: the clickable twin of the map, carrying
// every node, edge and basis. One lane per agent: a glass card edged in its
// identity (medium and wide), its header (identity chip, delegation, outcome
// badge), its nodes grouped by stage, each node's outgoing edges (solid ◆
// LINKED, dashed ◇ INFERRED), and its flags.
// A selected node opens its evidence right under itself; its path is marked.
// Desktop: a Button draws only a plain label, so chips and badges sit beside
// the header Buttons, and columns and indents are Box cells, never runs of
// spaces in a proportional font.

import type { Evidence, SpendOutcome, TrailFilter } from '../../types'
import { BUCKET_WORDS, EVIDENCE_COLOR, EVIDENCE_GLYPH, STATE_GLYPH, VERDICT_COLOR, VERDICT_GLYPH, displayPath, shortId, truncate } from '../lib/format'
import { agentRecord } from '../lib/outcome'
import { BUCKET_ROLE, ROLE, STATE_ROLE, identityHex } from '../lib/palette'
import type { Trail, TrailEdge, TrailLane, TrailNode } from '../lib/trail'
import type { ViewContext } from './common'
import { AgentChip, BucketBadge, BucketPill, EventChips, EvidenceTag, Row, glass, isOpen } from './kit'
import { FlagLine, isCommandFlag } from './trail-outcome'
import {
  ALL_LANES,
  LANE_CAP_ALL,
  NODE_CAP,
  NODE_CAP_ALL,
  STAGE_GLYPH,
  STAGE_ROLE,
  STAGE_TITLE,
  badgeFor,
  capNodes,
  isBackEdge,
  isStaleCheckEdge,
  laneToggles,
  middleTruncate,
  nodeMatches,
  stageGroups,
  type FlowStage,
  type PathMarks,
  type PlacedNode,
} from './trail-model'

/** Width of the stage gutter in the medium and wide list ("Verification" and a space). */
export const STAGE_GUTTER = 13
/** The open compact lane's left margin. */
const COMPACT_MARGIN = 2
const SOURCE_EVENTS = 12
const CONNECTOR: Record<TrailEdge['evidence'], string> = { LINKED: '─◆→', INFERRED: '╌◇→' }

/** What every lane row needs to draw itself. */
export type LaneScope = {
  ctx: ViewContext
  trail: Trail
  spend: SpendOutcome
  byId: ReadonlyMap<string, TrailNode>
  path: PathMarks
  selectedId?: string
  filter: TrailFilter
  /** Cells a lane's lines may take: the pane, less the lane card's border and padding where there is a card. */
  inner: number
}

/** Cells a lane card takes from a line: border and padding on the terminal; padding (and a hairline) on desktop. */
const CARD_CELLS = { terminal: 4, desktop: 3 } as const

/** The width a lane's lines may take at this layout (compact lanes have no card). */
export function laneInner(ctx: ViewContext): number {
  if (ctx.layout === 'compact') return ctx.width
  return ctx.width - (ctx.surface === 'terminal' ? CARD_CELLS.terminal : CARD_CELLS.desktop)
}

/** Whether lines are drawn in a proportional font, where alignment needs Box cells (the desktop). */
const proportional = (ctx: ViewContext): boolean => ctx.surface !== 'terminal'

/** The stage gutter: a fixed-width cell, so every row's content starts at the same place on both surfaces. */
function Gutter(ctx: ViewContext, title: string) {
  const { Box, Text } = ctx.els
  return (
    <Box width={STAGE_GUTTER} flexShrink={0}>
      {title ? (
        <Text dimColor wrap="truncate-end">
          {title}
        </Text>
      ) : null}
    </Box>
  )
}

const isSelected = (scope: LaneScope, node: TrailNode): boolean => scope.selectedId === node.id
const matches = (scope: LaneScope, node: TrailNode): boolean => nodeMatches(scope.trail, scope.spend, node, scope.filter)

function selectNode(scope: LaneScope, node: TrailNode): () => void {
  return () => scope.ctx.act.select(isSelected(scope, node) ? undefined : `node:${node.id}`)
}

/** A node's stage glyph, or a verification's verdict glyph, in its colour role. */
function Glyph(ctx: ViewContext, node: TrailNode) {
  const { Text } = ctx.els
  if (node.stage === 'verification') {
    const verdict = node.verdict ?? 'running'
    return (
      <Text color={VERDICT_COLOR[verdict]} weight="bold">
        {STAGE_GLYPH.verification} {VERDICT_GLYPH[verdict]}
      </Text>
    )
  }
  return (
    <Text color={STAGE_ROLE[node.stage]} weight="bold">
      {STAGE_GLYPH[node.stage]}
    </Text>
  )
}

/** The node's own words, fitted: commands and paths are cut in the middle, prose at the end. */
function titleOf(ctx: ViewContext, node: TrailNode, room: number): string {
  if (node.stage === 'delegation') {
    const description = agentRecord(ctx.snapshot, node.agentId)?.description
    return description !== undefined ? `“${truncate(description, room - 2)}”` : truncate(node.title, room)
  }
  if (node.stage === 'change') {
    // The title is `Changed <path> (<counts>)`; the path itself may hold " (", so the counts start at the last one.
    const at = node.title.lastIndexOf(' (')
    const count = at >= 0 ? node.title.slice(at) : ''
    return `${middleTruncate(displayPath(node.path ?? '', ctx.snapshot.cwd), Math.max(8, room - count.length))}${count}`
  }
  if (node.stage === 'verification') return middleTruncate(node.command ?? node.title, room)
  return truncate(node.title, room)
}

function PathMark(ctx: ViewContext, evidence: Evidence | undefined) {
  const { Text } = ctx.els
  if (!evidence) return ''
  return (
    <Text color={EVIDENCE_COLOR[evidence]} weight="bold">
      {' '}
      {EVIDENCE_GLYPH[evidence]} on path
    </Text>
  )
}

function NodeRowContent(scope: LaneScope, node: TrailNode, room: number) {
  const { ctx, trail } = scope
  const { Text } = ctx.els
  const flagged = trail.flags.some(f => f.nodeId === node.id && f.evidence === 'UNRESOLVED')
  const faint = scope.filter !== 'all' && !matches(scope, node)
  const verdict = node.stage === 'verification' ? ` · ${node.verdict ?? 'running'}` : ''
  return (
    <Text>
      {Glyph(ctx, node)} {EvidenceTag(ctx, node.evidence, false)} <Text dimColor={faint}>{titleOf(ctx, node, room - verdict.length)}</Text>
      {verdict ? <Text color={VERDICT_COLOR[node.verdict ?? 'running']}>{verdict}</Text> : ''}
      {flagged ? <Text color={ROLE.caution}> ?</Text> : ''}
      {PathMark(ctx, scope.path.nodes.get(node.id))}
    </Text>
  )
}

const TARGET_MAX = 40
const HAND_BACK = ' · report hand-back'
const STALE = ' · before last edit'

/** Where an edge ends, in `room` cells or fewer: the stage, the owner's chip and what the node is. */
function TargetText(scope: LaneScope, id: string, room = TARGET_MAX + 12) {
  const { ctx } = scope
  const { Text } = ctx.els
  if (id.startsWith('agent:')) return <Text>{AgentChip(ctx, id.slice('agent:'.length))}</Text>
  const node = scope.byId.get(id)
  if (!node) return <Text dimColor>{id}</Text>
  const fixed = (node.stage === 'verification' ? 3 : 1) + 2 + (agentRecord(ctx.snapshot, node.agentId)?.isMain ? 6 : 3)
  const fit = Math.max(8, Math.min(TARGET_MAX, room - fixed))
  const what =
    node.stage === 'change'
      ? middleTruncate(displayPath(node.path ?? '', ctx.snapshot.cwd), fit)
      : node.stage === 'verification'
        ? middleTruncate(node.command ?? '', fit)
        : node.stage === 'delegation'
          ? 'delegation'
          : node.stage === 'finding'
            ? 'report'
            : 'investigation'
  return (
    <Text>
      {Glyph(ctx, node)} {AgentChip(ctx, node.agentId)} {what}
    </Text>
  )
}

/** One outgoing edge under its node, fitted to `width` cells so its qualifiers are never cut; indented by a Box on desktop. */
function EdgeLine(scope: LaneScope, edge: TrailEdge, indent: number, last: boolean, width: number) {
  const { ctx } = scope
  const { Box, Text } = ctx.els
  const onPath = scope.path.edges.has(edge.id)
  const stale = isStaleCheckEdge(scope.byId, edge)
  const suffix = (isBackEdge(edge) ? HAND_BACK.length : 0) + (stale ? STALE.length : 0)
  const room = width - indent - 1 - CONNECTOR[edge.evidence].length - 1 - suffix
  const lead = proportional(ctx) ? '' : ' '.repeat(indent)
  const line = (
    <Text wrap="truncate-end">
      <Text dimColor>{`${lead}${last ? '└' : '├'}`}</Text>
      <Text color={EVIDENCE_COLOR[edge.evidence]} weight={onPath ? 'bold' : undefined}>
        {CONNECTOR[edge.evidence]}
      </Text>{' '}
      {TargetText(scope, edge.to, room)}
      {isBackEdge(edge) ? <Text dimColor>{HAND_BACK}</Text> : ''}
      {stale ? <Text color={ROLE.caution}>{STALE}</Text> : ''}
    </Text>
  )
  return proportional(ctx) ? <Box marginLeft={indent}>{line}</Box> : line
}

/**
 * The selected node's evidence: its title and lines, every edge with its basis, its flags, the outcome verdict and its
 * events.
 */
function NodeEvidence(scope: LaneScope, placed: PlacedNode, indent: number) {
  const { ctx, trail } = scope
  const { Box, Text } = ctx.els
  const node = placed.node
  const width = Math.max(30, scope.inner - indent)
  const edges = trail.edges.filter(e => e.from === node.id || e.to === node.id)
  const flags = trail.flags.filter(
    f => f.nodeId === node.id || (node.stage === 'verification' && isCommandFlag(f) && f.command === node.command && f.cwd === node.cwd),
  )
  const outcome = scope.spend.agents.find(a => a.agentId === node.agentId)?.contributions.filter(c => c.nodeIds.includes(node.id)) ?? []
  // Desktop: the selected detail is the one panel inside the lane card, sunken.
  const surface = proportional(ctx) ? { ...glass(ctx, 'sunken'), paddingX: 1 } : {}
  return (
    <Box flexDirection="column" marginLeft={indent} {...surface}>
      <Text color={ROLE.accent} weight="semibold">
        evidence · {node.stage}
      </Text>
      <Text wrap="wrap">
        {EvidenceTag(ctx, node.evidence)} {node.title}
      </Text>
      {node.lines
        .filter(line => line.trim() !== '')
        .map(line => (
          <Text dimColor wrap="wrap">
            {truncate(line, width * 4)}
          </Text>
        ))}
      {edges.map(edge => (
        <Box flexDirection="column">
          <Text wrap="wrap">
            <Text color={EVIDENCE_COLOR[edge.evidence]}>{CONNECTOR[edge.evidence]}</Text> {EvidenceTag(ctx, edge.evidence)}{' '}
            {edge.from === node.id ? 'to' : 'from'} {TargetText(scope, edge.from === node.id ? edge.to : edge.from)}
            {isBackEdge(edge) ? <Text dimColor>{HAND_BACK}</Text> : ''}
            {isStaleCheckEdge(scope.byId, edge) ? <Text color={ROLE.caution}>{STALE}</Text> : ''}
          </Text>
          <Box marginLeft={4}>
            <Text dimColor wrap="wrap">
              {edge.basis}
            </Text>
          </Box>
        </Box>
      ))}
      {flags.map(flag => FlagLine(ctx, flag))}
      {outcome.map(c => (
        <Text wrap="wrap">
          outcome {EvidenceTag(ctx, c.evidence, false)} <Text color={BUCKET_ROLE[c.category]}>{BUCKET_WORDS[c.category]}</Text>
          <Text dimColor>: {c.basis}</Text>
        </Text>
      ))}
      {EventChips(ctx, `src-${placed.laneIndex}-${placed.nodeIndex}`, node.eventIds, SOURCE_EVENTS)}
    </Box>
  )
}

/** One node: its row (a Row, with the stage gutter in the list), then its evidence when selected, else its outgoing edges. */
function NodeBlock(scope: LaneScope, placed: PlacedNode, gutter: string | undefined) {
  const { ctx, trail } = scope
  const { Box, Text } = ctx.els
  const node = placed.node
  const selected = isSelected(scope, node)
  const indentWidth = (gutter === undefined ? 0 : STAGE_GUTTER) + 2
  const room = Math.max(12, scope.inner - indentWidth - 8)
  const row = Row(ctx, { key: placed.key, selected, onPress: selectNode(scope, node), children: NodeRowContent(scope, node, room) })
  const outgoing = trail.edges.filter(e => e.from === node.id)
  // Compact rows sit in the open lane's 2-cell margin.
  const lineWidth = scope.inner - (gutter === undefined ? COMPACT_MARGIN : 0)
  return (
    <Box flexDirection="column">
      {gutter === undefined ? (
        row
      ) : (
        <Box flexDirection="row">
          {Gutter(ctx, gutter)}
          {row}
        </Box>
      )}
      {selected
        ? NodeEvidence(scope, placed, indentWidth)
        : outgoing.map((edge, i) => EdgeLine(scope, edge, indentWidth, i === outgoing.length - 1, lineWidth))}
    </Box>
  )
}

/** A stage's node blocks, capped (NODE_CAP, or NODE_CAP_ALL with ALL_LANES open), with a count of the rest. */
function StageBlocks(scope: LaneScope, group: { stage: FlowStage; nodes: PlacedNode[] }, withGutter: boolean) {
  const { ctx } = scope
  const { Box, Text } = ctx.els
  const cap = isOpen(ctx, ALL_LANES) ? NODE_CAP_ALL : NODE_CAP
  const { shown, hidden } = capNodes(group.nodes, cap, scope.selectedId)
  return [
    ...shown.map((placed, i) => NodeBlock(scope, placed, withGutter ? (i === 0 ? STAGE_TITLE[group.stage] : '') : undefined)),
    hidden > 0 ? (
      <Box marginLeft={withGutter ? STAGE_GUTTER : 0}>
        <Text dimColor>
          +{hidden} more in {STAGE_TITLE[group.stage]}
          {cap === NODE_CAP ? ` · “show up to ${LANE_CAP_ALL} lanes and their nodes” lists more` : ''}
        </Text>
      </Box>
    ) : null,
  ]
}

function Badge(scope: LaneScope, agentId: string) {
  const { ctx } = scope
  const { Text } = ctx.els
  const badge = badgeFor(scope.spend, agentId)
  if (!badge) return ''
  return (
    <Text>
      <Text dimColor> → </Text>
      {BucketBadge(ctx, badge.bucket, badge.evidence ? { evidence: badge.evidence } : {})}
    </Text>
  )
}

function Delegated(scope: LaneScope, agentId: string, lead = ' · ') {
  const { ctx } = scope
  const { Text } = ctx.els
  const agent = agentRecord(ctx.snapshot, agentId)
  if (agent?.isMain) return <Text dimColor>{lead}the coordinator's own changes</Text>
  const evidence: Evidence = agent?.parentEvidence ?? 'UNAVAILABLE'
  return (
    <Text dimColor>
      {lead}
      {EvidenceTag(ctx, evidence, false)} delegated by {agent?.parentId ? AgentChip(ctx, agent.parentId) : 'unknown'}
    </Text>
  )
}

/** The desktop badge: the outcome bucket as a pill edged in its colour, after a dim arrow. */
function BadgePill(scope: LaneScope, agentId: string) {
  const { ctx } = scope
  const { Box, Text } = ctx.els
  const badge = badgeFor(scope.spend, agentId)
  if (!badge) return null
  return (
    <Box flexDirection="row" columnGap={1} flexShrink={0}>
      <Text dimColor>→</Text>
      {BucketPill(ctx, badge.bucket, badge.evidence ? { evidence: badge.evidence } : {})}
    </Box>
  )
}

/** An agent's identity as drawn beside a desktop header Button: its chip and state, or the coordinator's ◎ and state. */
function IdentityLead(ctx: ViewContext, agentId: string) {
  const { Text } = ctx.els
  const agent = agentRecord(ctx.snapshot, agentId)
  if (!agent?.isMain) return AgentChip(ctx, agentId, { state: true })
  return (
    <Text>
      <Text color={ROLE.main} weight="bold">
        ◎
      </Text>
      <Text color={STATE_ROLE[agent.state]}> {STATE_GLYPH[agent.state]}</Text>
    </Text>
  )
}

/** The plain words of a lane's header Button: the agent's type (the coordinator is "main"), and the focus mark. */
function headerLabel(ctx: ViewContext, agentId: string, focused: boolean, room?: number): string {
  const agent = agentRecord(ctx.snapshot, agentId)
  const name = agent?.isMain ? 'main' : agent ? (agent.type ?? 'type unknown') : shortId(agentId)
  return `${room !== undefined ? truncate(name, room) : name}${focused ? ' ◂ focus' : ''}`
}

/**
 * A lane's header (medium and wide); pressing it puts the agent in focus. Terminal: one Button holding the styled runs.
 * Desktop: the chip beside a plain Button (the desktop draws a Button's content unstyled), then the delegation and the
 * outcome badge as styled text on the same row.
 */
function ListHeader(scope: LaneScope, lane: TrailLane) {
  const { ctx } = scope
  const { Box, Button, Text } = ctx.els
  const id = lane.agentId
  const focused = ctx.ui.focus === id
  const press = () => ctx.act.toggleFocus(id)
  if (!proportional(ctx)) {
    return (
      <Button key={`lane-${id}`} plain onPress={press}>
        <Text color={ROLE.accent}>▌</Text>
        <Text weight={focused ? 'bold' : undefined}>
          {' '}
          {AgentChip(ctx, id, { name: true, state: true })}
        </Text>
        {Delegated(scope, id)}
        {Badge(scope, id)}
        {focused ? (
          <Text color={ROLE.accent} weight="bold">
            {' '}
            ◂ focus
          </Text>
        ) : (
          ''
        )}
      </Button>
    )
  }
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text>{IdentityLead(ctx, id)}</Text>
      <Button key={`lane-${id}`} plain label={headerLabel(ctx, id, focused)} onPress={press} />
      <Box width={0} flexGrow={1}>
        <Text wrap="truncate-end">{Delegated(scope, id, '· ')}</Text>
      </Box>
      {BadgePill(scope, id)}
    </Box>
  )
}

/** Medium and wide: a glass card edged in the agent's identity, its header, the nodes by stage, and its flags. */
function ListLane(scope: LaneScope, lane: TrailLane, laneIndex: number) {
  const { ctx, trail } = scope
  const { Box, Text } = ctx.els
  const flags = trail.flags.filter(f => f.agentId === lane.agentId && !isCommandFlag(f))
  const agent = agentRecord(ctx.snapshot, lane.agentId)
  return (
    <Box flexDirection="column" marginTop={1} {...glass(ctx, 'base', identityHex(agent))} paddingX={1}>
      {ListHeader(scope, lane)}
      {lane.nodes.length === 0 ? (
        <Box marginLeft={2}>
          <Text dimColor>no delegation, report, change or verification observed yet</Text>
        </Box>
      ) : null}
      {stageGroups(lane, laneIndex).map(group => StageBlocks(scope, group, true))}
      {flags.length > 0 ? (
        <Box flexDirection="row">
          {Gutter(ctx, STAGE_TITLE.outcome)}
          <Box flexDirection="column" flexShrink={1}>
            {flags.map(flag => FlagLine(ctx, flag))}
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}

/** The medium and wide list of lanes. */
export function LaneList(scope: LaneScope, lanes: ReadonlyArray<{ lane: TrailLane; index: number }>) {
  const { Box } = scope.ctx.els
  return <Box flexDirection="column">{lanes.map(({ lane, index }) => ListLane(scope, lane, index))}</Box>
}

// ── compact: one lane open at a time ──

/** A closed lane's nodes as beads: each one presses like its row would. Desktop: a plain glyph label (no styled runs). */
function Bead(scope: LaneScope, placed: PlacedNode) {
  const { ctx } = scope
  const { Button, Text } = ctx.els
  const node = placed.node
  const glyph = node.stage === 'verification' ? VERDICT_GLYPH[node.verdict ?? 'running'] : STAGE_GLYPH[node.stage]
  const color = node.stage === 'verification' ? VERDICT_COLOR[node.verdict ?? 'running'] : STAGE_ROLE[node.stage]
  const mark = scope.path.nodes.get(node.id)
  const faint = scope.filter !== 'all' && !matches(scope, node)
  if (proportional(ctx)) {
    return <Button key={placed.key} plain dimColor={faint} label={`${glyph}${mark ? EVIDENCE_GLYPH[mark] : ''}`} onPress={selectNode(scope, node)} />
  }
  return (
    <Button key={placed.key} plain onPress={selectNode(scope, node)}>
      <Text color={color} weight="bold" dimColor={faint}>
        {glyph}
      </Text>
      {mark ? <Text color={EVIDENCE_COLOR[mark]}>{EVIDENCE_GLYPH[mark]}</Text> : ''}
    </Button>
  )
}

function CompactLane(scope: LaneScope, lane: TrailLane, laneIndex: number, open: boolean) {
  const { ctx, trail } = scope
  const { Box, Button, Text } = ctx.els
  const focused = ctx.ui.focus === lane.agentId
  const groups = stageGroups(lane, laneIndex)
  const press = () => {
    const { toggle, clearSelection } = laneToggles(trail, ctx.ui, lane.agentId)
    if (clearSelection) ctx.act.select(undefined)
    for (const id of toggle) ctx.act.toggleOpen(id)
  }
  const nameRoom = Math.max(10, Math.floor(ctx.width / 2) - 6)
  // Desktop: the marker and chip beside a plain Button carrying the type (the desktop draws Button content unstyled).
  const header = proportional(ctx) ? (
    <Box flexDirection="row" columnGap={1}>
      <Text>
        <Text color={ROLE.accent}>{open ? '▾' : '▸'} </Text>
        {IdentityLead(ctx, lane.agentId)}
      </Text>
      <Button key={`lane-${lane.agentId}`} plain label={headerLabel(ctx, lane.agentId, focused, nameRoom)} onPress={press} />
      {open ? <Text>{Badge(scope, lane.agentId)}</Text> : null}
    </Box>
  ) : (
    <Button key={`lane-${lane.agentId}`} plain onPress={press}>
      <Text color={ROLE.accent}>{open ? '▾' : '▸'} </Text>
      <Text weight={open || focused ? 'bold' : undefined}>{AgentChip(ctx, lane.agentId, { name: true, width: nameRoom })}</Text>
      {open ? Badge(scope, lane.agentId) : ''}
      {focused ? <Text color={ROLE.accent}> ◂ focus</Text> : ''}
    </Button>
  )
  if (!open) {
    // Closed: the flow in one line, chip → stage beads → outcome. Past the cap the lane opens to show the rest.
    const placed = groups.flatMap(group => group.nodes)
    const cap = Math.max(4, Math.floor((ctx.width - 22) / 2))
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {header}
        {placed.slice(0, cap).map(p => Bead(scope, p))}
        {placed.length > cap ? <Text dimColor>+{placed.length - cap}</Text> : null}
        {Badge(scope, lane.agentId) || null}
      </Box>
    )
  }
  const flags = trail.flags.filter(f => f.agentId === lane.agentId && !isCommandFlag(f))
  return (
    <Box flexDirection="column">
      {header}
      <Box flexDirection="column" marginLeft={COMPACT_MARGIN}>
        {Delegated(scope, lane.agentId, '')}
        {lane.nodes.length === 0 ? <Text dimColor>no delegation, report, change or verification observed yet</Text> : null}
        {groups.map(group => StageBlocks(scope, group, false))}
        {flags.map(flag => FlagLine(ctx, flag))}
      </Box>
    </Box>
  )
}

/** Compact: every lane a header and its stage beads; the one open lane draws its rows. */
export function CompactLanes(scope: LaneScope, lanes: ReadonlyArray<{ lane: TrailLane; index: number }>, openLane: string | undefined) {
  const { Box } = scope.ctx.els
  return <Box flexDirection="column">{lanes.map(({ lane, index }) => CompactLane(scope, lane, index, lane.agentId === openLane))}</Box>
}
