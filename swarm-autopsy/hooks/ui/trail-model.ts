// The Contribution Trail's view model (Workstream C): stage grouping, filter
// membership, the selected node's path, lane badges and text fitting. Pure: it
// reads the Trail and F3's SpendOutcome as they are and decides nothing they do
// not already say. No edge is made here; every mark points at a trail edge.

import type { AgentOutcome, ContributionOutcome, Evidence, SpendBucket, SpendOutcome, TrailFilter, UiState } from '../../types'
import { checkKey, type Trail, type TrailEdge, type TrailLane, type TrailNode, type TrailStage } from '../lib/trail'
import { BUCKET_ROLE, ROLE } from '../lib/palette'
import { BUCKET_WORDS } from '../lib/format'

/** The flow's stages as drawn: investigation folds into Findings (a summary row above the report). */
export type FlowStage = 'delegation' | 'finding' | 'change' | 'verification'

export const FLOW_STAGES: readonly FlowStage[] = ['delegation', 'finding', 'change', 'verification']

export const FLOW_OF: Record<TrailStage, FlowStage> = {
  delegation: 'delegation',
  investigation: 'finding',
  finding: 'finding',
  change: 'change',
  verification: 'verification',
}

export const STAGE_TITLE: Record<FlowStage | 'outcome', string> = {
  delegation: 'Delegation',
  finding: 'Findings',
  change: 'Changes',
  verification: 'Verification',
  outcome: 'Outcome',
}

/** DESIGN-CONTRACT §3.2: one glyph per stage; `⚑` only for verification. */
export const STAGE_GLYPH: Record<TrailStage, string> = {
  delegation: '⇢',
  investigation: '⌕',
  finding: '✦',
  change: '✎',
  verification: '⚑',
}

/** Stage colour roles (theme keys; delegation and verification follow the theme's accent). Verification takes its verdict's colour instead. */
export const STAGE_ROLE: Record<TrailStage, string> = {
  get delegation(): string {
    return ROLE.accent
  },
  get investigation() {
    return ROLE.muted
  },
  get finding() {
    return ROLE.analytic
  },
  get change() {
    return ROLE.text
  },
  get verification(): string {
    return ROLE.accent
  },
}

export const TRAIL_FILTERS: readonly TrailFilter[] = ['all', 'verified', 'unresolved', 'inconclusive', 'failed']

export type PlacedNode = { node: TrailNode; laneIndex: number; nodeIndex: number; key: string }

/** The key the hook tests press: the node's index among its lane's nodes, whatever order it is drawn in. */
export const nodeKey = (laneIndex: number, nodeIndex: number): string => `node-${laneIndex}-${nodeIndex}`

/** A lane's nodes in flow order: Delegation, Findings (investigation first), Changes, Verification. Empty stages are left out. */
export function stageGroups(lane: TrailLane, laneIndex: number): Array<{ stage: FlowStage; nodes: PlacedNode[] }> {
  const placed = lane.nodes.map((node, nodeIndex) => ({ node, laneIndex, nodeIndex, key: nodeKey(laneIndex, nodeIndex) }))
  return FLOW_STAGES.map(stage => ({
    stage,
    nodes: placed
      .filter(p => FLOW_OF[p.node.stage] === stage)
      .sort((a, b) => (a.node.stage === b.node.stage ? a.nodeIndex - b.nodeIndex : a.node.stage === 'investigation' ? -1 : 1)),
  })).filter(group => group.nodes.length > 0)
}

/** A report handed back to its spawner: drawn in the list, never in the map. */
export const isBackEdge = (edge: TrailEdge): boolean => edge.to.startsWith('agent:')

/**
 * A change → verification edge whose check ran at or before the change's last successful write: the same comparison
 * trail.ts makes when it appends "it does not cover the final version" to the edge's basis (T-3).
 */
export function isStaleCheckEdge(byId: ReadonlyMap<string, TrailNode>, edge: TrailEdge): boolean {
  const change = byId.get(edge.from)
  const check = byId.get(edge.to)
  if (change?.stage !== 'change' || check?.stage !== 'verification') return false
  return check.seq <= (change.lastWriteSeq ?? change.seq)
}

export const nodesById = (trail: Trail): Map<string, TrailNode> => new Map(trail.lanes.flatMap(l => l.nodes).map(n => [n.id, n]))

const RANK: readonly Evidence[] = ['OBSERVED', 'LINKED', 'INFERRED', 'UNRESOLVED', 'UNAVAILABLE']
const stronger = (a: Evidence, b: Evidence): Evidence => (RANK.indexOf(a) <= RANK.indexOf(b) ? a : b)
const weaker = (a: Evidence, b: Evidence): Evidence => (RANK.indexOf(a) >= RANK.indexOf(b) ? a : b)

export type PathMarks = {
  /** Edge ids into or out of the selected node. */
  edges: Set<string>
  /** Nodes at the other end of those edges, with the strongest edge label between them and the selection. */
  nodes: Map<string, Evidence>
}

/** The selected node's path: its incoming and outgoing trail edges and their other ends (agent lanes excluded). */
export function pathOf(trail: Trail, nodeId: string | undefined): PathMarks {
  const marks: PathMarks = { edges: new Set(), nodes: new Map() }
  if (!nodeId) return marks
  for (const edge of trail.edges) {
    if (edge.from !== nodeId && edge.to !== nodeId) continue
    marks.edges.add(edge.id)
    const other = edge.from === nodeId ? edge.to : edge.from
    if (other.startsWith('agent:')) continue
    const known = marks.nodes.get(other)
    marks.nodes.set(other, known ? stronger(known, edge.evidence) : edge.evidence)
  }
  return marks
}

const outcomeOf = (spend: SpendOutcome, agentId: string): AgentOutcome | undefined => spend.agents.find(a => a.agentId === agentId)

/** A still-failing or inconclusive flag is about its command's latest run: only that run carries it. */
function commandFlagMatches(trail: Trail, node: TrailNode): boolean {
  if (node.stage !== 'verification') return false
  const key = checkKey(node.command ?? '', node.cwd)
  if (!trail.flags.some(f => f.evidence === 'UNRESOLVED' && f.command !== undefined && checkKey(f.command, f.cwd) === key)) return false
  const runs = trail.lanes.flatMap(l => l.nodes).filter(n => n.stage === 'verification' && checkKey(n.command ?? '', n.cwd) === key)
  return node.seq === Math.max(...runs.map(n => n.seq))
}

/** An F3 contribution the filter `unresolved` is about: UNRESOLVED evidence, or an outcome the evidence cannot settle. */
const unsettled = (c: ContributionOutcome): boolean => c.evidence === 'UNRESOLVED' || c.category === 'unresolved'

/**
 * Whether a node is what a filter is about:
 * - verified: the node is in one of its agent's F3 contributions classified `verified` (◇ INFERRED at best);
 * - unresolved: an UNRESOLVED trail flag names the node (or it is the latest run of a flagged command), or the node is
 *   in an F3 contribution whose evidence is UNRESOLVED or whose category is `unresolved`;
 * - inconclusive / failed: a verification run with that verdict (● OBSERVED).
 */
export function nodeMatches(trail: Trail, spend: SpendOutcome, node: TrailNode, filter: TrailFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'failed' || filter === 'inconclusive') return node.stage === 'verification' && node.verdict === filter
  const contributions = outcomeOf(spend, node.agentId)?.contributions.filter(c => c.nodeIds.includes(node.id)) ?? []
  if (filter === 'verified') return contributions.some(c => c.category === 'verified')
  const flagged = trail.flags.some(f => f.evidence === 'UNRESOLVED' && f.nodeId === node.id) || commandFlagMatches(trail, node)
  return flagged || contributions.some(unsettled)
}

/**
 * A lane matches when one of its nodes does; for `unresolved` also when its agent has an UNRESOLVED flag or a contribution
 * that names no node (e.g. "ended without a captured report": category unresolved, ∅ UNAVAILABLE).
 */
export function laneMatches(trail: Trail, spend: SpendOutcome, lane: TrailLane, filter: TrailFilter): boolean {
  if (filter === 'all') return true
  if (lane.nodes.some(node => nodeMatches(trail, spend, node, filter))) return true
  if (filter !== 'unresolved') return false
  const flagged = trail.flags.some(f => f.agentId === lane.agentId && f.evidence === 'UNRESOLVED')
  return flagged || (outcomeOf(spend, lane.agentId)?.contributions.some(unsettled) ?? false)
}

/** Lanes drawn by default, and at most when the person asks for all of them (the tree budget, DESIGN-CONTRACT §2). */
export const LANE_CAP = 12
export const LANE_CAP_ALL = 18
/** Nodes drawn per stage of one lane, by default and with ALL_LANES open. */
export const NODE_CAP = 8
export const NODE_CAP_ALL = 24
/** The `ui.open` id that raises both caps. */
export const ALL_LANES = 'trail-all-lanes'

/** A stage's nodes past `cap` are counted, not drawn; the selected node is always drawn. */
export function capNodes(nodes: readonly PlacedNode[], cap: number, selectedId: string | undefined): { shown: PlacedNode[]; hidden: number } {
  if (nodes.length <= cap) return { shown: [...nodes], hidden: 0 }
  const shown = nodes.filter((p, i) => i < cap || p.node.id === selectedId)
  return { shown, hidden: nodes.length - shown.length }
}

/**
 * The lanes to draw, in trail order: the first `cap`, plus the lanes of the selected node and the focused agent when
 * they fall past it (so a selection or focus made elsewhere is never invisible).
 */
export function lanesToDraw<T extends { lane: TrailLane }>(lanes: readonly T[], ui: UiState, cap: number): T[] {
  if (lanes.length <= cap) return [...lanes]
  const selected = ui.selected?.startsWith('node:') ? ui.selected.slice('node:'.length) : undefined
  const keep = (l: T, i: number) => i < cap || l.lane.agentId === ui.focus || (selected !== undefined && l.lane.nodes.some(n => n.id === selected))
  return lanes.filter(keep)
}

/** Lanes per filter: the counts on the filter chips. */
export function filterCounts(trail: Trail, spend: SpendOutcome): Record<TrailFilter, number> {
  const count = (filter: TrailFilter) => trail.lanes.filter(lane => laneMatches(trail, spend, lane, filter)).length
  return { all: trail.lanes.length, verified: count('verified'), unresolved: count('unresolved'), inconclusive: count('inconclusive'), failed: count('failed') }
}

/** F3's bucket words: the one table every view uses (`BUCKET_WORDS`, Sunset Glass §4.3). */
export const bucketLabel = (bucket: SpendBucket['bucket']): string => BUCKET_WORDS[bucket]

export type Badge = { bucket: AgentOutcome['bucket']; label: string; role: string; evidence?: Evidence }

/**
 * A lane's F3 bucket and the weakest evidence among the contributions that set it. The coordinator is not judged and
 * carries no label; `verified` is never drawn stronger than ◇ INFERRED (F3-4).
 */
export function badgeFor(spend: SpendOutcome, agentId: string): Badge | undefined {
  const agent = outcomeOf(spend, agentId)
  if (!agent) return undefined
  const base = { bucket: agent.bucket, label: bucketLabel(agent.bucket), role: BUCKET_ROLE[agent.bucket] }
  if (agent.bucket === 'coordinator' || agent.contributions.length === 0) return base
  const evidence = agent.contributions.map(c => c.evidence).reduce(weaker, 'OBSERVED' as Evidence)
  return { ...base, evidence: agent.bucket === 'verified' ? weaker(evidence, 'INFERRED') : evidence }
}

// KIT-CANDIDATE: middle truncation for commands and paths (lib/format has end truncation only).
/** Fits text in `width` cells by cutting its middle, so two commands that differ at the end stay apart. */
export function middleTruncate(text: string, width: number): string {
  // Code points, not UTF-16 units: a cut never splits a surrogate pair.
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  if (chars.length <= width) return chars.join('')
  if (width <= 0) return ''
  if (width === 1) return '…'
  const head = Math.ceil((width - 1) / 2)
  const tail = width - 1 - head
  return `${chars.slice(0, head).join('')}…${tail > 0 ? chars.slice(chars.length - tail).join('') : ''}`
}

const laneIdOf = (id: string): string | undefined => (id.startsWith('lane-') ? id.slice('lane-'.length) : undefined)

/** Compact layout: the one open lane. A selected node opens its own lane; otherwise the lane opened last. */
export function openLaneOf(trail: Trail, ui: UiState): string | undefined {
  const selected = ui.selected?.startsWith('node:') ? ui.selected.slice('node:'.length) : undefined
  const owner = selected ? trail.lanes.find(l => l.nodes.some(n => n.id === selected))?.agentId : undefined
  if (owner) return owner
  const opened = (ui.open ?? []).map(laneIdOf).filter((id): id is string => id !== undefined)
  return [...opened].reverse().find(id => trail.lanes.some(l => l.agentId === id))
}

/** The `ui.open` changes that leave `agentId`'s lane the only one open (or none, when it is open already). */
export function laneToggles(trail: Trail, ui: UiState, agentId: string): { toggle: string[]; clearSelection: boolean } {
  const open = openLaneOf(trail, ui)
  const laneIds = (ui.open ?? []).filter(id => laneIdOf(id) !== undefined)
  const target = `lane-${agentId}`
  const selectedLane = ui.selected?.startsWith('node:')
    ? trail.lanes.find(l => l.nodes.some(n => `node:${n.id}` === ui.selected))?.agentId
    : undefined
  if (open === agentId) return { toggle: laneIds, clearSelection: selectedLane === agentId }
  const others = laneIds.filter(id => id !== target)
  return { toggle: [...others, ...(laneIds.includes(target) ? [] : [target])], clearSelection: selectedLane !== undefined }
}
