// Swarm Health (DESIGN-CONTRACT §8.7, Report 03 §7): the findings the existing
// analyses already raised, mapped to one shape for the Health tab, the Live
// strip and the header. Pure. No score, no threshold, no new detection: every
// entry is one export's own finding, with its own words, its own scale and its
// own evidence label. Where a source has a sentence, the title is that
// sentence's lead and `why` the sentence verbatim; where it has only fields (a
// stop reason, a compaction, a drop count), the text states those fields and
// nothing more. Workstream D owns this file.

import type { AgentOutcome, ContributionOutcome, Evidence, HealthLevel, HealthSignal, LedgerView, Snapshot, SpendOutcome } from '../../types'
import type { Collisions } from './collisions'
import { clockText, contextViewFor, isContextStopReason } from './context'
import { compact, pct, plural, subagents } from './format'
import { checkKey, type Trail, type TrailFlag, type TrailNode } from './trail'

export type HealthInputs = {
  snapshot: Snapshot
  trail: Trail
  collisions: Collisions
  ledger: LedgerView
  spend: SpendOutcome
}

/** The id of the one entry that is a value, not a finding: main's context fill (no threshold applies to it). */
export const MAIN_CONTEXT_ID = 'ctx:main:percent'

/** F3 buckets that ask for a look: their agents' work is not established as verified. */
const OUTCOME_BUCKETS: ReadonlySet<AgentOutcome['bucket']> = new Set(['changed-unverified', 'failed-or-inconclusive', 'mixed', 'unresolved'])

/** Categories a mixed agent's representative contribution is never taken from. */
const SETTLED: ReadonlySet<ContributionOutcome['category']> = new Set(['verified', 'report-only'])

const LEAD_SEPARATORS = [' — ', '; ', ': ', '. '] as const

// Phrases the ledger's own notes carry, used only to find the note that states a count the ledger keeps.
const DUPLICATES_NOTE = 'arrived with a key already counted'
const WITHOUT_USAGE_NOTE = 'resolved with no usage'
const COVERAGE_NOTE = 'Token counts start at'

/**
 * A sentence's lead: its text up to the first ` — `, `; `, `: ` or `. ` outside backticks and parentheses, so a
 * command or an aside is never cut. The whole text when there is no such separator.
 */
export function leadOf(text: string): string {
  let code = false
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '`') code = !code
    if (code) continue
    if (ch === '(') depth += 1
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (depth > 0) continue
    if (LEAD_SEPARATORS.some(sep => text.startsWith(sep, i))) {
      const head = text.slice(0, i).trim()
      return head || text
    }
  }
  return text
}

/** Whether an entry is a value shown for reference (main's context fill) rather than a finding to look at. */
export function isValueOnly(signal: HealthSignal): boolean {
  return signal.id === MAIN_CONTEXT_ID
}

/** The findings only: every entry except values shown for reference. For counts and badges. */
export function findingsOf(signals: readonly HealthSignal[]): HealthSignal[] {
  return signals.filter(s => !isValueOnly(s))
}

/**
 * The one unresolved count every view draws (Sunset Glass §12, SG-U): the findings whose source's evidence is UNRESOLVED,
 * the entries Health marks `?`. A count over `gatherSignals`' output; it changes no analysis.
 */
export function unresolvedOf(signals: readonly HealthSignal[]): HealthSignal[] {
  return findingsOf(signals).filter(s => s.level === 'unresolved')
}

/** A source's evidence label as its level on the Health scale: never a new severity. */
function levelOf(evidence: Evidence): HealthLevel {
  if (evidence === 'UNRESOLVED') return 'unresolved'
  if (evidence === 'UNAVAILABLE') return 'unavailable'
  return 'observed'
}

function allNodes(trail: Trail): TrailNode[] {
  return trail.lanes.flatMap(lane => lane.nodes)
}

/** The trail node that holds the first of these events, when one does: where "show in Trail" goes. */
export function nodeForEvents(trail: Trail, eventIds: readonly string[]): string | undefined {
  const nodes = allNodes(trail)
  for (const eventId of eventIds) {
    const node = nodes.find(n => n.eventIds.includes(eventId))
    if (node) return node.id
  }
  return undefined
}

/** The node a flag is about: the one it names, or, for a command flag, the latest run of that exact command. */
function flagNode(trail: Trail, flag: TrailFlag): TrailNode | undefined {
  const nodes = allNodes(trail)
  if (flag.nodeId) return nodes.find(n => n.id === flag.nodeId)
  if (flag.command === undefined) return undefined
  const key = checkKey(flag.command, flag.cwd)
  return nodes
    .filter(n => n.stage === 'verification' && checkKey(n.command ?? '', n.cwd) === key)
    .sort((a, b) => a.seq - b.seq)
    .at(-1)
}

function trailSignals(trail: Trail): HealthSignal[] {
  return trail.flags.map(flag => {
    const node = flagNode(trail, flag)
    return {
      id: `trail:${flag.id}`,
      source: 'trail',
      level: levelOf(flag.evidence),
      evidence: flag.evidence,
      title: leadOf(flag.text),
      why: flag.text,
      agentIds: [flag.agentId],
      eventIds: node?.eventIds ?? [],
      ...(node ? { nodeId: node.id } : {}),
    }
  })
}

function collisionSignals(collisions: Collisions, trail: Trail): HealthSignal[] {
  return collisions.signals.map(signal => {
    const nodeId = nodeForEvents(trail, signal.eventIds)
    return {
      id: `col:${signal.id}`,
      source: 'collisions',
      level: signal.severity,
      evidence: signal.evidence,
      title: signal.title,
      why: signal.detail[0] ?? signal.title,
      agentIds: signal.agents,
      eventIds: signal.eventIds,
      ...(nodeId ? { nodeId } : {}),
    }
  })
}

const observed = (fields: Pick<HealthSignal, 'id' | 'title' | 'why' | 'agentIds'>): HealthSignal => ({
  ...fields,
  source: 'context',
  level: 'observed',
  evidence: 'OBSERVED',
  eventIds: [],
})

function sizesText(before: number | undefined, after: number | undefined): string {
  if (before !== undefined && after !== undefined) return `${compact(before)} → ${compact(after)} tokens`
  if (before !== undefined) return `${compact(before)} tokens before, after not captured`
  if (after !== undefined) return `${compact(after)} tokens after, before not captured`
  return 'token counts not captured'
}

/** F1: main's context fill as a value, then each agent's captured context stop reasons and compactions. */
function contextSignals(snapshot: Snapshot): HealthSignal[] {
  const main = contextViewFor(snapshot, 'main').percent
  const fill =
    main.measure !== 'UNAVAILABLE' && main.value !== undefined
      ? [observed({ id: MAIN_CONTEXT_ID, title: `main context ${pct(main.value)}`, why: main.basis, agentIds: ['main'] })]
      : []
  const ledgerIds = Object.keys(snapshot.ledger.agents)
  const ids = [...new Set([...snapshot.agentOrder, ...ledgerIds])]
  const perAgent = ids.flatMap(agentId => {
    const view = contextViewFor(snapshot, agentId)
    const stops = view.stopSignals
      .filter(stop => isContextStopReason(stop.reason))
      .map(stop =>
        observed({
          id: `ctx:${agentId}:stop:${stop.reason}`,
          title: `stop reason ${stop.reason} ×${stop.count}`,
          why: `turn.step reported stop reason ${stop.reason}${stop.lastAt !== undefined ? `, last at ${clockText(stop.lastAt)}` : '; the last one is not in the kept history'}`,
          agentIds: [agentId],
        }),
      )
    const compactions = view.compactions.map(mark =>
      observed({
        id: `ctx:${agentId}:compaction:${mark.seq}`,
        title: `compacted (${mark.trigger}) · ${sizesText(mark.tokensBefore, mark.tokensAfter)}`,
        why: `session.compact completed at ${clockText(mark.at)}`,
        agentIds: [agentId],
      }),
    )
    return [...stops, ...compactions]
  })
  return [...fill, ...perAgent]
}

function ledgerEntry(fields: Pick<HealthSignal, 'id' | 'why' | 'agentIds'> & { evidence?: Evidence }): HealthSignal {
  const evidence = fields.evidence ?? 'OBSERVED'
  return {
    id: fields.id,
    source: 'ledger',
    level: levelOf(evidence),
    evidence,
    title: leadOf(fields.why),
    why: fields.why,
    agentIds: fields.agentIds,
    eventIds: [],
  }
}

/** F2: usage carried by ids never seen as agents, turns that disagree with turn.complete, duplicates, requests without usage. */
function ledgerSignals(snapshot: Snapshot, ledger: LedgerView): HealthSignal[] {
  const unknown = ledger.rows
    .filter(row => row.attribution.evidence === 'UNRESOLVED')
    .map(row => ledgerEntry({ id: `ledger:unknown:${row.agentId}`, why: row.attribution.basis, agentIds: [row.agentId], evidence: 'UNRESOLVED' }))
  const reconcile = ledger.rows
    .filter(row => (row.reconciliation.mismatched > 0 || row.reconciliation.reportedOnly > 0) && row.reconciliation.note)
    .map(row => ledgerEntry({ id: `ledger:reconcile:${row.agentId}`, why: row.reconciliation.note ?? '', agentIds: [row.agentId] }))
  const duplicatesNote = snapshot.ledger.duplicates > 0 ? ledger.notes.find(n => n.includes(DUPLICATES_NOTE)) : undefined
  const duplicates = duplicatesNote ? [ledgerEntry({ id: 'ledger:duplicates', why: duplicatesNote, agentIds: [] })] : []
  const withoutNote = ledger.session.requestsWithoutUsage > 0 ? ledger.notes.find(n => n.includes(WITHOUT_USAGE_NOTE)) : undefined
  const without = withoutNote
    ? [
        ledgerEntry({
          id: 'ledger:without-usage',
          why: withoutNote,
          agentIds: ledger.rows.filter(r => r.direct.requestsWithoutUsage > 0).map(r => r.agentId),
        }),
      ]
    : []
  return [...unknown, ...reconcile, ...duplicates, ...without]
}

/** The contribution that stands for an agent's bucket: one of that category, or, for mixed, its first unsettled one. */
function representative(agent: AgentOutcome): ContributionOutcome | undefined {
  const list = agent.contributions
  if (agent.bucket === 'mixed') return list.find(c => !SETTLED.has(c.category)) ?? list[0]
  return list.find(c => c.category === agent.bucket) ?? list[0]
}

/** F3: agents whose work the evidence does not establish as verified, with the basis of their contribution. */
function outcomeSignals(spend: SpendOutcome): HealthSignal[] {
  return spend.agents.flatMap(agent => {
    if (!OUTCOME_BUCKETS.has(agent.bucket)) return []
    const contribution = representative(agent)
    if (!contribution) return []
    const label = agent.bucket === 'mixed' ? `mixed · ${contribution.category}` : agent.bucket
    const nodeId = contribution.nodeIds[0]
    return [
      {
        id: `outcome:${agent.agentId}`,
        source: 'outcome' as const,
        level: levelOf(contribution.evidence),
        evidence: contribution.evidence,
        title: `${label}: ${contribution.title}`,
        why: contribution.basis,
        agentIds: [agent.agentId],
        eventIds: contribution.eventIds,
        ...(nodeId ? { nodeId } : {}),
      },
    ]
  })
}

function gap(fields: Pick<HealthSignal, 'id' | 'title' | 'why' | 'agentIds'>): HealthSignal {
  return { ...fields, source: 'coverage', level: 'unavailable', evidence: 'UNAVAILABLE', eventIds: [] }
}

/** What was not captured: requests before counting began, events dropped from the timeline, agents with no spawn seen. */
function coverageSignals(snapshot: Snapshot, ledger: LedgerView): HealthSignal[] {
  const since = snapshot.ledger.since
  const sinceNote = since?.missedEarlier ? (ledger.notes.find(n => n.startsWith(COVERAGE_NOTE)) ?? since.basis) : undefined
  const dropped = snapshot.droppedEvents
  const unseen = subagents(snapshot)
  return [
    ...(sinceNote ? [gap({ id: 'coverage:since', title: leadOf(sinceNote), why: sinceNote, agentIds: [] })] : []),
    ...(dropped > 0
      ? [
          gap({
            id: 'coverage:dropped',
            title: `${plural(dropped, 'older event')} dropped from the timeline to bound memory`,
            why: 'agent totals still count them; the trail, the collision signals and Forensics cover the retained events only',
            agentIds: [],
          }),
        ]
      : []),
    ...(snapshot.instruments.spawn === 0 && unseen.length > 0
      ? [
          gap({
            id: 'coverage:no-spawn',
            title: 'Agents were seen without any agent.spawn event',
            why: 'so their parents and tasks are unavailable',
            agentIds: unseen.map(a => a.id),
          }),
        ]
      : []),
  ]
}

/** Ids made unique in order: a repeat gets `#2`, `#3`, … so the same inputs always give the same ids. */
function uniqueIds(signals: readonly HealthSignal[]): HealthSignal[] {
  const seen = new Map<string, number>()
  return signals.map(signal => {
    const count = (seen.get(signal.id) ?? 0) + 1
    seen.set(signal.id, count)
    return count === 1 ? signal : { ...signal, id: `${signal.id}#${count}` }
  })
}

/** Every entry, in source order: trail, collisions, context, ledger, outcome, coverage. */
export function gatherSignals(input: HealthInputs): HealthSignal[] {
  return uniqueIds([
    ...trailSignals(input.trail),
    ...collisionSignals(input.collisions, input.trail),
    ...contextSignals(input.snapshot),
    ...ledgerSignals(input.snapshot, input.ledger),
    ...outcomeSignals(input.spend),
    ...coverageSignals(input.snapshot, input.ledger),
  ])
}
