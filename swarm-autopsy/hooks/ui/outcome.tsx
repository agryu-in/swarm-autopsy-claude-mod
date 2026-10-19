// F3 · Spend vs outcome: a 100% bar of the tokens processed by bucket, the
// denominator it is a share of, one selectable row per bucket (selecting one
// lists its agents and their contributions' evidence), and an agent's outcome
// detail (also the Live inspector's). Every number carries its measure label;
// unknown usage is ∅, never 0%; ≈$ goes through CostText only.
//
// Sunset Glass (§11 "Spend"): the section is a glass tile from the medium
// layout up; the bar is the kit's shared BucketBar (unresolved and unknown in
// the quiet `unknownFill`, the unknown tail `░`); on the desktop the bucket rows
// are pills with their figures in aligned cells, and "none in" is muted chips.

import type { AgentOutcome, ContributionOutcome, SpendBucket, SpendOutcome } from '../../types'
import { agentName, compact, displayPath, plural, truncate } from '../lib/format'
import { BUCKET_MEANING, BUCKET_ORDER, agentRecord } from '../lib/outcome'
import { BUCKET_ROLE, ROLE } from '../lib/palette'
import type { Trail, TrailEdge, TrailFlag, TrailNode } from '../lib/trail'
import type { ViewContext } from './common'
import { BucketBar, CostText, Disclosure, EventChips, EvidenceTag, MeasureTag, Pill, Row, paintsGlass } from './kit'
import {
  AgentCell,
  AgentName,
  BUCKET_LABEL,
  BucketBadge,
  BucketPill,
  Cell,
  DetailHeading,
  FigureCell,
  NoteLine,
  Section,
  TextCell,
  UnknownUsage,
  agentWords,
  chipCells,
  costCaveat,
  costCells,
  costRun,
  hasUsage,
  insideSection,
  shareOf,
  shareText,
} from './spend-common'

/** Source events listed per contribution before `+N more`. */
const MAX_SOURCE_EVENTS = 12
/** Source events per contribution in a bucket's agent list (the focused detail lists more). */
const MAX_LIST_EVENTS = 4
/** The newest verification runs listed under one contribution. */
const MAX_RUNS_SHOWN = 3
/** Agents listed under a selected bucket before `+N more`. */
const MAX_BUCKET_AGENTS = 12
const AGENT_WORDS_CELLS = 18
/** Desktop bucket rows: the pill, the agent count and the figure, in aligned cells. */
const PILL_CELLS = 28
const WHO_CELLS = 10
const SHARE_CELLS = 15

// ── the Spend tab's section ──

function Denominator(ctx: ViewContext, outcome: SpendOutcome) {
  const { Text } = ctx.els
  if (outcome.denominator <= 0) {
    return (
      <Text wrap="wrap" color={ROLE.muted}>
        {MeasureTag(ctx, 'UNAVAILABLE', false)} no tokens processed yet, so no shares are drawn
      </Text>
    )
  }
  return (
    <Text wrap="wrap">
      {MeasureTag(ctx, 'OBSERVED', false)} {compact(outcome.denominator)} tokens processed = 100%
      <Text dimColor> · each share below is of this total (tokens, not cost)</Text>
    </Text>
  )
}

/** The 100% bar of every bucket with recorded usage, then `░` when some agents' usage is unknown (the kit's shared bar). */
function OutcomeBar(ctx: ViewContext, outcome: SpendOutcome) {
  const { Box } = ctx.els
  if (outcome.denominator <= 0) return null
  return (
    // A row Box: the bar's own `alignSelf: center` then centres it on its line, not across the section.
    <Box key="spo-bar" flexDirection="row">
      {BucketBar(ctx, outcome, Math.max(8, ctx.width))}
    </Box>
  )
}

function agentsOf(outcome: SpendOutcome, bucket: SpendBucket): AgentOutcome[] {
  return bucket.agents.map(id => outcome.agents.find(a => a.agentId === id)).filter((a): a is AgentOutcome => a !== undefined)
}

/** One bucket's usage: an observed count and share, or ∅ for usage no request reported. */
function BucketUsage(ctx: ViewContext, outcome: SpendOutcome, bucket: SpendBucket) {
  const { Text } = ctx.els
  if (bucket.bucket === 'no-usage-recorded') {
    const members = agentsOf(outcome, bucket)
    const without = members.reduce((n, a) => n + a.usage.requestsWithoutUsage, 0)
    return UnknownUsage(ctx, { requests: 0, requestsWithoutUsage: without })
  }
  return (
    <Text>
      {MeasureTag(ctx, 'OBSERVED', false)} {shareText(compact(bucket.processed), bucket.percent)}
    </Text>
  )
}

/** The ≈$ of a bucket, when cost is on and its usage is known. */
function bucketCost(ctx: ViewContext, bucket: SpendBucket, showCost: boolean) {
  return showCost && bucket.bucket !== 'no-usage-recorded' ? CostText(ctx, bucket.cost, true) : null
}

/** Desktop: the bucket as a pill, then its agent count, usage and ≈$ in aligned cells. */
function BucketCells(ctx: ViewContext, outcome: SpendOutcome, bucket: SpendBucket, showCost: boolean, who: string) {
  const { Box, Text } = ctx.els
  const cost = bucketCost(ctx, bucket, showCost)
  const known = bucket.bucket !== 'no-usage-recorded'
  return (
    <Box flexDirection="row" flexGrow={1} columnGap={1}>
      {Cell(ctx, PILL_CELLS, BucketPill(ctx, bucket.bucket))}
      {TextCell(ctx, WHO_CELLS, who, { dim: true })}
      {known
        ? FigureCell(ctx, SHARE_CELLS, BucketUsage(ctx, outcome, bucket), { mono: false })
        : Cell(ctx, SHARE_CELLS, <Text wrap="truncate-end">{BucketUsage(ctx, outcome, bucket)}</Text>, { grow: true })}
      {cost ? FigureCell(ctx, costCells(bucket.cost) + 1, cost) : null}
    </Box>
  )
}

/** The narrowest pane the aligned bucket cells fit: the pill, who and share cells, two gaps, the row's marker and a spare cell. */
const BUCKET_CELLS_MIN = PILL_CELLS + WHO_CELLS + SHARE_CELLS + 2 + 4

function BucketRow(ctx: ViewContext, outcome: SpendOutcome, bucket: SpendBucket, showCost: boolean) {
  const { Text } = ctx.els
  const id = `bk:${bucket.bucket}`
  const selected = ctx.ui.selected === id
  const who = bucket.agents.length > 0 ? plural(bucket.agents.length, 'agent') : 'no agent'
  const cost = bucketCost(ctx, bucket, showCost)
  return Row(ctx, {
    key: `bk-${bucket.bucket}`,
    selected,
    onPress: () => ctx.act.select(selected ? undefined : id),
    children: (
      <Text wrap="wrap">
        {BucketBadge(ctx, bucket.bucket)}
        <Text dimColor> · {who} · </Text>
        {BucketUsage(ctx, outcome, bucket)}
        {cost ? <Text> · {cost}</Text> : ''}
      </Text>
    ),
    // The aligned cells only where they fit the pane (with the row's marker and the gaps); a narrow pane wraps the line.
    cells: paintsGlass(ctx) && ctx.width >= BUCKET_CELLS_MIN ? BucketCells(ctx, outcome, bucket, showCost, who) : undefined,
  })
}

/** A contribution in a bucket's list: its evidence label, category and title, the basis, and its source events. */
function ContributionSummary(ctx: ViewContext, c: ContributionOutcome) {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        {EvidenceTag(ctx, c.evidence, false)} <Text color={BUCKET_ROLE[c.category]}>{BUCKET_LABEL[c.category]}</Text> · {c.title}
      </Text>
      <Text dimColor wrap="wrap">
        {c.basis}
      </Text>
      {EventChips(ctx, `bl-${c.id}`, c.eventIds, MAX_LIST_EVENTS)}
    </Box>
  )
}

/** An agent's usage in a bucket's list: its count and share of the denominator, ≈$ with cost on, or ∅ unknown. */
function AgentUsage(ctx: ViewContext, outcome: SpendOutcome, agent: AgentOutcome, showCost: boolean) {
  const { Text } = ctx.els
  const u = agent.usage
  if (!hasUsage(u)) return UnknownUsage(ctx, u)
  return (
    <Text>
      {MeasureTag(ctx, 'OBSERVED', false)} {shareText(compact(u.processed), shareOf(u.processed, outcome.denominator))}
      {showCost && u.cost ? <Text> · {costRun(ctx, u.cost, true)}</Text> : ''}
    </Text>
  )
}

/**
 * Desktop: the agent's name in a fixed-width cell, then its count and share, then its ≈$ (cost on) in a cell of its own,
 * so the figures of the list line up and never wrap.
 */
function BucketAgentCells(ctx: ViewContext, outcome: SpendOutcome, agent: AgentOutcome, showCost: boolean, cells: number, words: boolean) {
  const { Box, Text } = ctx.els
  const u = agent.usage
  const name = Cell(ctx, Math.max(4, cells), AgentName(ctx, agent.agentId, words))
  if (!hasUsage(u)) {
    return (
      <Box flexDirection="row" flexGrow={1} columnGap={1}>
        {name}
        {Cell(ctx, SHARE_CELLS, <Text wrap="truncate-end">{UnknownUsage(ctx, u)}</Text>, { grow: true })}
      </Box>
    )
  }
  const share = (
    <Text>
      {MeasureTag(ctx, 'OBSERVED', false)} {shareText(compact(u.processed), shareOf(u.processed, outcome.denominator))}
    </Text>
  )
  return (
    <Box flexDirection="row" flexGrow={1} columnGap={1}>
      {name}
      {FigureCell(ctx, SHARE_CELLS, share, { mono: false })}
      {showCost && u.cost ? FigureCell(ctx, costCells(u.cost) + 1, costRun(ctx, u.cost, true)) : null}
    </Box>
  )
}

/** A selected bucket's agents (each focuses its agent) and their contributions' evidence. */
function BucketAgents(ctx: ViewContext, outcome: SpendOutcome, bucket: SpendBucket, showCost: boolean) {
  const { Box, Text } = ctx.els
  const members = agentsOf(outcome, bucket)
  const shown = members.slice(0, MAX_BUCKET_AGENTS)
  const words = ctx.layout === 'compact' ? 0 : AGENT_WORDS_CELLS
  const cells = Math.max(0, ...shown.map(a => chipCells(ctx, a.agentId) + (words && agentWords(ctx, a.agentId) ? 1 + words : 0)))
  return (
    <Box flexDirection="column" marginLeft={2}>
      {members.length === 0 ? (
        <Text dimColor wrap="wrap">
          no agent: session tokens that no ledger row carries (the notes below say how many)
        </Text>
      ) : null}
      {shown.map(agent => {
        const focused = ctx.ui.focus === agent.agentId
        return (
          <Box key={`bka-${agent.agentId}`} flexDirection="column">
            {Row(ctx, {
              key: `so-${agent.agentId}`,
              selected: focused,
              onPress: () => ctx.act.toggleFocus(agent.agentId),
              children: (
                <Text wrap="truncate-end">
                  {AgentCell(ctx, agent.agentId, cells, words > 0)} {AgentUsage(ctx, outcome, agent, showCost)}
                </Text>
              ),
              cells: paintsGlass(ctx) ? BucketAgentCells(ctx, outcome, agent, showCost, cells, words > 0) : undefined,
            })}
            <Box flexDirection="column" marginLeft={2}>
              {agent.contributions.map(c => ContributionSummary(ctx, c))}
            </Box>
          </Box>
        )
      })}
      {members.length > shown.length ? <Text dimColor>+{plural(members.length - shown.length, 'more agent')} in this bucket</Text> : null}
    </Box>
  )
}

function Meanings(ctx: ViewContext) {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="column">
      {BUCKET_ORDER.map(bucket => (
        <Text wrap="wrap">
          {BucketBadge(ctx, bucket)}
          <Text dimColor>: {BUCKET_MEANING[bucket]}</Text>
        </Text>
      ))}
    </Box>
  )
}

/** The buckets no agent landed in: plain words on the terminal, muted chips on the desktop. */
function NoneIn(ctx: ViewContext, empty: readonly SpendBucket['bucket'][]) {
  const { Box, Text } = ctx.els
  if (empty.length === 0) return null
  if (!paintsGlass(ctx)) {
    return (
      <Text dimColor wrap="wrap">
        none in: {empty.map(b => BUCKET_LABEL[b]).join(' · ')}
      </Text>
    )
  }
  return (
    <Box key="spo-none" flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text dimColor>none in:</Text>
      {empty.map(b => Pill(ctx, { key: `spo-none-${b}`, children: <Text dimColor>{BUCKET_LABEL[b]}</Text> }))}
    </Box>
  )
}

/**
 * The Spend tab's spend vs outcome: the 100% bar, the denominator (its basis behind a disclosure), one row per bucket
 * with agents, tokens, share and ≈$ (cost on), the buckets with no agent, the meanings and F3's notes.
 */
export function SpendOutcomePanel(ctx: ViewContext, outcome: SpendOutcome, trail: Trail, showCost: boolean) {
  const { Box, Text } = ctx.els
  const inner = insideSection(ctx)
  const present = new Set(outcome.buckets.map(b => b.bucket))
  const empty = BUCKET_ORDER.filter(b => !present.has(b))
  return Section(ctx, {
    key: 'sp-outcome',
    tone: 'base',
    title: 'spend vs outcome',
    summary: 'tokens processed by what the evidence establishes',
    width: ctx.width,
    children: [
      OutcomeBar(inner, outcome),
      Denominator(inner, outcome),
      Disclosure(inner, 'spend-basis', 'denominator basis', () => (
        <Text dimColor wrap="wrap">
          {outcome.denominatorBasis}
        </Text>
      )),
      ...outcome.buckets.map(bucket => (
        <Box key={`bkr-${bucket.bucket}`} flexDirection="column">
          {BucketRow(inner, outcome, bucket, showCost)}
          {ctx.ui.selected === `bk:${bucket.bucket}` ? BucketAgents(inner, outcome, bucket, showCost) : null}
        </Box>
      )),
      NoneIn(inner, empty),
      Disclosure(inner, 'spend-meanings', 'what each bucket means', () => Meanings(inner)),
      // Notes are housekeeping (coverage, reconciliation): the neutral role, never the estimate amber.
      ...outcome.notes.map(note => NoteLine(inner, note, /\d/.test(note) ? ROLE.neutral : undefined)),
    ],
  })
}

// ── an agent's outcome detail (Spend and the Live inspector) ──

/** The verification runs a contribution rests on: its own runs and the checks its edges reach, newest last. */
function verificationsOf(trail: Trail, c: ContributionOutcome): TrailNode[] {
  const edges = (c.edgeIds ?? []).map(id => trail.edges.find(e => e.id === id)).filter((e): e is TrailEdge => e !== undefined)
  const ids = new Set([...c.nodeIds, ...edges.flatMap(e => [e.from, e.to])])
  return trail.lanes
    .flatMap(l => l.nodes)
    .filter(n => n.stage === 'verification' && ids.has(n.id))
    .sort((a, b) => a.seq - b.seq)
}

function VerificationRecords(ctx: ViewContext, runs: readonly TrailNode[], c: ContributionOutcome) {
  const { Box, Text } = ctx.els
  const shownRuns = runs.slice(-MAX_RUNS_SHOWN)
  const width = Math.max(20, ctx.width - 6)
  return (
    <Box flexDirection="column">
      {runs.length > shownRuns.length ? <Text dimColor>{`verification record: ${plural(runs.length - shownRuns.length, 'earlier run')} not listed`}</Text> : null}
      {shownRuns.map((run, j) => {
        const output = (run.lines[2] ?? '').split('\n').find(line => line.trim().length > 0)
        return (
          <Box key={`odv-${c.id}-${j}`} flexDirection="column">
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              <Text wrap="wrap">
                {EvidenceTag(ctx, run.evidence, false)} verification record: {truncate(run.title, width)}
              </Text>
              {EventChips(ctx, `od-vr-${c.id}-${j}`, run.eventIds.slice(0, 1), 1)}
            </Box>
            <Text dimColor wrap="wrap">{`   ${run.lines[0] ?? ''}`}</Text>
            {output ? <Text dimColor wrap="wrap">{`   output: ${truncate(output.trim(), width * 2)}`}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

/** What an edge points at, in words: an agent, a change (by its display path), a run, or a stage. */
function edgeTarget(ctx: ViewContext, trail: Trail, id: string): string {
  if (id.startsWith('agent:')) {
    const agentId = id.slice('agent:'.length)
    return agentName(agentRecord(ctx.snapshot, agentId), agentId)
  }
  const node = trail.lanes.flatMap(l => l.nodes).find(n => n.id === id)
  if (!node) return id
  const owner = agentRecord(ctx.snapshot, node.agentId)?.label ?? node.agentId
  if (node.stage === 'change') return `${owner} changed ${node.path ? displayPath(node.path, ctx.snapshot.cwd) : 'a file'}`
  if (node.stage === 'verification') return `${owner} ran \`${node.command ?? ''}\``
  return `${owner}'s ${node.stage}`
}

/** The contribution's actions: open it in the Trail, and its source events not already listed under a run. */
function ContributionActions(ctx: ViewContext, c: ContributionOutcome, sources: readonly string[]) {
  const { Box, Text, Button } = ctx.els
  const nodeId = c.nodeIds[0]
  if (!nodeId && sources.length === 0) return null
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {nodeId ? <Button key={`od-tr-${c.id}`} label="show in Trail" variant="secondary" onPress={() => ctx.act.showNode(nodeId)} /> : null}
      {sources.length > 0 ? <Text dimColor>source events:</Text> : null}
      {sources.length > 0 ? EventChips(ctx, `od-${c.id}`, sources, MAX_SOURCE_EVENTS) : null}
    </Box>
  )
}

function Contribution(ctx: ViewContext, trail: Trail, c: ContributionOutcome) {
  const { Box, Text } = ctx.els
  const edges = (c.edgeIds ?? []).map(id => trail.edges.find(e => e.id === id)).filter((e): e is TrailEdge => e !== undefined)
  // A flag whose text the basis already states (an unlinked report's) is not drawn twice.
  const flags = c.flagIds
    .map(id => trail.flags.find(f => f.id === id))
    .filter((f): f is TrailFlag => f !== undefined && !c.basis.includes(f.text))
  const runs = verificationsOf(trail, c)
  const inRecords = new Set(runs.slice(-MAX_RUNS_SHOWN).flatMap(r => r.eventIds))
  const sources = c.eventIds.filter(id => !inRecords.has(id))
  return (
    <Box key={`odc-${c.id}`} flexDirection="column" marginTop={1}>
      <Text wrap="wrap">
        {EvidenceTag(ctx, c.evidence)} <Text color={BUCKET_ROLE[c.category]}>{BUCKET_LABEL[c.category]}</Text> · {c.title}
      </Text>
      <Text dimColor wrap="wrap">
        {c.basis}
      </Text>
      {edges.map(edge => {
        const outgoing = c.nodeIds.includes(edge.from)
        const other = edgeTarget(ctx, trail, outgoing ? edge.to : edge.from)
        return (
          <Text wrap="wrap">
            {EvidenceTag(ctx, edge.evidence, false)} {outgoing ? '→' : '←'} {other}
            {c.basis.includes(edge.basis) ? '' : <Text dimColor>{`: ${edge.basis}`}</Text>}
          </Text>
        )
      })}
      {flags.map(flag => (
        <Text wrap="wrap">
          {EvidenceTag(ctx, flag.evidence, false)} <Text color={flag.evidence === 'UNRESOLVED' ? ROLE.caution : ROLE.muted}>{flag.text}</Text>
        </Text>
      ))}
      {runs.length > 0 ? VerificationRecords(ctx, runs, c) : null}
      {ContributionActions(ctx, c, sources)}
    </Box>
  )
}

/** The agent's report when it is not itself a contribution: the hand-back of its own work. */
function ReportedBack(ctx: ViewContext, agent: AgentOutcome, trail: Trail) {
  const { Box, Text } = ctx.els
  const finding = trail.lanes.find(l => l.agentId === agent.agentId)?.nodes.find(n => n.stage === 'finding')
  if (!finding || agent.contributions.some(c => c.nodeIds.includes(finding.id))) return null
  const links = trail.edges.filter(e => e.from === finding.id && !e.to.startsWith('agent:'))
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text dimColor wrap="wrap">
          {EvidenceTag(ctx, finding.evidence, false)} also reported back (not counted as a separate contribution): {truncate(finding.title, Math.max(20, ctx.width * 3))}
        </Text>
        {EventChips(ctx, `od-rb-${agent.agentId}`, finding.eventIds.slice(0, 1), 1)}
      </Box>
      {links.map(edge => (
        <Text dimColor wrap="wrap">
          {'   '}
          {EvidenceTag(ctx, edge.evidence, false)} → {edgeTarget(ctx, trail, edge.to)}: {edge.basis}
        </Text>
      ))}
    </Box>
  )
}

function mixLine(agent: AgentOutcome): string | undefined {
  if (agent.bucket !== 'mixed') return undefined
  const counts = new Map<ContributionOutcome['category'], number>()
  for (const c of agent.contributions) counts.set(c.category, (counts.get(c.category) ?? 0) + 1)
  const parts = [...counts.entries()].map(([category, n]) => `${n} ${BUCKET_LABEL[category]}`)
  return `contributions: ${parts.join(', ')}; counted once under mixed, usage not split`
}

/** The usage F3 counted for this agent, once, and its ≈$ only when the person turned cost on (fixes D2). */
function UsageLine(ctx: ViewContext, agent: AgentOutcome) {
  const { Text } = ctx.els
  const u = agent.usage
  if (!hasUsage(u)) return <Text wrap="wrap">{UnknownUsage(ctx, u)}</Text>
  const cost = CostText(ctx, u.cost, ctx.ui.showCost === true)
  return (
    <Text wrap="wrap">
      {MeasureTag(ctx, 'OBSERVED', false)} {compact(u.processed)} tokens processed, counted once under {BUCKET_LABEL[agent.bucket]}
      {cost && u.cost ? (
        <Text>
          {' · '}
          {cost}
          <Text dimColor> {costCaveat(u.cost)}</Text>
        </Text>
      ) : (
        ''
      )}
    </Text>
  )
}

/** An agent's outcome: its bucket, the usage F3 counted, each contribution with its evidence, and its hand-back. */
export function AgentOutcomeDetail(ctx: ViewContext, agent: AgentOutcome | undefined, trail: Trail) {
  const { Box, Text } = ctx.els
  if (!agent) {
    return (
      <Box flexDirection="column">
        {DetailHeading(ctx, 'outcome')}
        <Text dimColor>No spend-vs-outcome record for this agent.</Text>
      </Box>
    )
  }
  const mix = mixLine(agent)
  return (
    <Box flexDirection="column">
      {DetailHeading(ctx, 'outcome', agent.agentId)}
      <Text wrap="wrap">
        {BucketBadge(ctx, agent.bucket)}
        {agent.bucket === 'coordinator' ? <Text dimColor> · the main loop; its own contributions are listed below</Text> : ''}
        {hasUsage(agent.usage) ? '' : <Text dimColor> · its tokens sit under </Text>}
        {hasUsage(agent.usage) ? '' : BucketBadge(ctx, 'no-usage-recorded')}
      </Text>
      {mix ? (
        <Text dimColor wrap="wrap">
          {mix}
        </Text>
      ) : null}
      {UsageLine(ctx, agent)}
      {agent.contributions.length === 0 ? <Text dimColor>No change or verification of its own was captured.</Text> : null}
      {agent.contributions.map(c => Contribution(ctx, trail, c))}
      {ReportedBack(ctx, agent, trail)}
    </Box>
  )
}
