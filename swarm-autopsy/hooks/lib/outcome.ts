// F3 · spend vs outcome: each agent's recorded usage beside what the
// contribution trail can establish about its work. Deterministic rules over
// trail nodes, edges and flags; no model calls, no causation from order
// alone. An agent's usage is never split across its contributions.

import type {
  AgentOutcome,
  AgentRecord,
  ContributionOutcome,
  CostEstimate,
  Evidence,
  ForensicEvent,
  LedgerRow,
  LedgerTotals,
  LedgerView,
  OutcomeCategory,
  Snapshot,
  SpendBucket,
  SpendOutcome,
} from '../../types'
import { cap } from './classify'
import { sumCosts, ZERO_TOKENS } from './tokens'
import { checkKey, UNVERIFIED_TEXT, UNLINKED_TEXT, type Trail, type TrailEdge, type TrailFlag, type TrailNode } from './trail'

export type BucketName = SpendBucket['bucket']

export const BUCKET_ORDER: readonly BucketName[] = [
  'coordinator',
  'verified',
  'changed-unverified',
  'failed-or-inconclusive',
  'report-only',
  'mixed',
  'unresolved',
  'no-usage-recorded',
]

export const BUCKET_MEANING: Record<BucketName, string> = {
  coordinator: 'The main loop: delegating, reading reports and its own edits. Its own contributions are listed but do not set this bucket.',
  verified:
    'Every contribution is a change tied by a trail edge to a check that passed after its last edit (with no tied check failing or inconclusive after it), or such a passing check. The tie is INFERRED at best: it rests on a file name, the same agent or the same working tree, not on proof that the check exercised the change.',
  'changed-unverified':
    'Changed files with no tied check after the last edit: none was captured, or every tied check ran before the file was edited again. Unverified means not shown either way, not broken.',
  'failed-or-inconclusive':
    'A check tied to the change after its last edit failed or was inconclusive, or the agent\'s own check ended that way. A check can fail for reasons unrelated to the change; inconclusive means its result could not be read as a pass or a failure.',
  'report-only':
    'Handed back a report and made no captured change or check. A linked report is tied by an edge to a later delegation or change; an unlinked one has no such tie captured. A missing link is not evidence about the report\'s value: research, review and ruling options out leave no edit, and the events cannot show how a report was used.',
  mixed: 'The agent\'s work (its changes and checks) falls in more than one category; a report it also handed back does not count. The agent is counted once, here, and its usage is not split between them.',
  unresolved:
    'The captured events do not establish an outcome: still running, ended without a captured report, a passing check tied to no change after its last edit, or usage from a loop never seen as an agent.',
  'no-usage-recorded':
    'No request that reported token usage was recorded for these agents (for example, they ran before the mod loaded, were started by another hook, or every request came back without usage). Their usage is unknown, not zero; they add nothing to the total.',
}

export const DENOMINATOR_BASIS =
  'Tokens processed in the session: input + cache read + cache write + output, summed over every recorded turn.step request, each counted once (the ledger session total). Cache reads usually dominate, so a share here is a share of tokens processed, not of cost. Requests the hook cannot see are not included.'

const COMMAND_SHOWN = 80
const SERIES_SHOWN = 5

const EMPTY_TOTALS: LedgerTotals = { requests: 0, requestsWithoutUsage: 0, tokens: ZERO_TOKENS, processed: 0 }

type Index = {
  snapshot: Snapshot
  trail: Trail
  nodesByAgent: ReadonlyMap<string, TrailNode[]>
  nodeById: ReadonlyMap<string, TrailNode>
  edgesFrom: ReadonlyMap<string, TrailEdge[]>
  edgesTo: ReadonlyMap<string, TrailEdge[]>
  eventById: ReadonlyMap<string, ForensicEvent>
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item])
  return groups
}

function indexOf(snapshot: Snapshot, trail: Trail): Index {
  const nodes = trail.lanes.flatMap(l => l.nodes)
  return {
    snapshot,
    trail,
    nodesByAgent: groupBy(nodes, n => n.agentId),
    nodeById: new Map(nodes.map(n => [n.id, n])),
    edgesFrom: groupBy(trail.edges, e => e.from),
    edgesTo: groupBy(trail.edges, e => e.to),
    eventById: new Map(snapshot.events.map(e => [e.id, e])),
  }
}

const shown = (command: string | undefined): string => `\`${cap(command ?? '', COMMAND_SHOWN)}\``
const isDefined = <T>(value: T | undefined): value is T => value !== undefined

/** The agent record for an id, read as an own property: an id such as `constructor` is an agent, not Object's member. */
export function agentRecord(snapshot: Snapshot, id: string): AgentRecord | undefined {
  return Object.hasOwn(snapshot.agents, id) ? snapshot.agents[id] : undefined
}
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)]

/** Strongest first: a chain of claims is only as strong as its weakest link. */
const EVIDENCE_RANK: readonly Evidence[] = ['OBSERVED', 'LINKED', 'INFERRED', 'UNRESOLVED', 'UNAVAILABLE']
const weakest = (...labels: Evidence[]): Evidence =>
  labels.reduce((worst, label) => (EVIDENCE_RANK.indexOf(label) > EVIDENCE_RANK.indexOf(worst) ? label : worst), 'OBSERVED')
const strongest = (labels: readonly Evidence[]): Evidence =>
  labels.reduce((best, label) => (EVIDENCE_RANK.indexOf(label) < EVIDENCE_RANK.indexOf(best) ? label : best), 'UNAVAILABLE')

const notPassing = (verdict: string | undefined): boolean => verdict === 'failed' || verdict === 'inconclusive'

function summaryOf(trail: Trail, check: TrailNode) {
  const key = checkKey(check.command ?? '', check.cwd)
  return trail.outcome.verifications.find(v => checkKey(v.command, v.cwd) === key)
}

function commandFlags(trail: Trail, command: string | undefined, cwd: string | undefined): TrailFlag[] {
  return trail.flags.filter(f => (f.kind === 'still-failing' || f.kind === 'inconclusive') && f.command === command && f.cwd === cwd)
}

/** Every run of the same command in the same directory, oldest first. */
function runsOf(ix: Index, check: TrailNode): TrailNode[] {
  const key = checkKey(check.command ?? '', check.cwd)
  return [...ix.nodeById.values()]
    .filter(n => n.stage === 'verification' && checkKey(n.command ?? '', n.cwd) === key)
    .sort((a, b) => a.seq - b.seq)
}

function nodeLabel(ix: Index, id: string): string {
  const node = ix.nodeById.get(id)
  if (!node) return id
  const owner = agentRecord(ix.snapshot, node.agentId)?.label ?? node.agentId
  if (node.stage === 'change') return `${owner}'s change to ${node.path ?? 'a file'}`
  if (node.stage === 'verification') return `${owner}'s run of ${shown(node.command)}`
  return `${owner}'s ${node.stage}`
}

type Linked = { edge: TrailEdge; check: TrailNode }

function linkedChecks(ix: Index, change: TrailNode): Linked[] {
  return (ix.edgesFrom.get(change.id) ?? [])
    .map(edge => ({ edge, check: ix.nodeById.get(edge.to) }))
    .filter((l): l is Linked => l.check?.stage === 'verification')
    .sort((a, b) => a.check.seq - b.check.seq)
}

/** The change's writes as the timeline holds them: the last successful one, and any still without a result. */
function writesOf(ix: Index, change: TrailNode): { lastWriteSeq: number; lastShown: number; pending: ForensicEvent[] } {
  const writes = change.eventIds.map(id => ix.eventById.get(id)).filter(isDefined)
  const done = writes.filter(e => e.outcome?.status === 'ok')
  const lastWriteSeq = change.lastWriteSeq ?? Math.max(change.seq, ...done.map(e => e.endSeq ?? e.seq))
  const last = done.find(e => (e.endSeq ?? e.seq) === lastWriteSeq)
  const pending = writes.filter(e => e.outcome === undefined || e.outcome.status === 'running')
  return { lastWriteSeq, lastShown: last?.seq ?? lastWriteSeq, pending }
}

type ChangeBase = Omit<ContributionOutcome, 'category' | 'evidence' | 'basis' | 'flagIds'>

/** The evidence of "this check bears on this change": the change, the trail edge and the run, weakest wins. */
const chainOf = (change: TrailNode, l: Linked): Evidence => weakest(change.evidence, l.edge.evidence, l.check.evidence)
const runText = (l: Linked): string => `${shown(l.check.command)} ${l.check.verdict} at #${l.check.seq}`
const flagIdsOf = (ix: Index, linked: readonly Linked[]): string[] =>
  linked.flatMap(l => commandFlags(ix.trail, l.check.command, l.check.cwd)).map(f => f.id)

/** A linked run after the last edit that does not stand as a pass: it failed, or its command's latest run did not pass. */
function standsAsPass(ix: Index, l: Linked): boolean {
  return l.check.verdict === 'passed' && !notPassing(summaryOf(ix.trail, l.check)?.latest)
}

/**
 * Verified needs a linked check that passed after the last edit and whose
 * command's latest run did not fail or end inconclusive. A linked check after
 * the last edit that failed (or whose command later did) makes the change
 * failed-or-inconclusive; checks that all ran before the last edit are stale.
 */
function classifyChange(ix: Index, change: TrailNode): ContributionOutcome {
  const linked = linkedChecks(ix, change)
  const ownFlags = ix.trail.flags.filter(f => f.nodeId === change.id).map(f => f.id)
  const base: ChangeBase = {
    id: `c:${change.id}`,
    agentId: change.agentId,
    title: `Changed ${change.path ?? 'a file'}`,
    nodeIds: [change.id],
    eventIds: change.eventIds,
    edgeIds: linked.map(l => l.edge.id),
  }
  const unverified = (basis: string, extraFlags: readonly string[] = []): ContributionOutcome => ({
    ...base,
    category: 'changed-unverified',
    evidence: 'UNRESOLVED',
    basis,
    flagIds: unique([...ownFlags, ...extraFlags]),
  })
  const { lastWriteSeq, lastShown, pending } = writesOf(ix, change)
  const firstPending = pending[0]
  if (firstPending) return unverified(`An edit to this file (#${firstPending.seq}) has no captured result yet, so no check is known to have run after the last edit.`)
  const after = linked.filter(l => l.check.seq > lastWriteSeq)
  if (after.length === 0) {
    const unclear = unclearRunsAfter(ix, change, lastWriteSeq)
    if (unclear.length > 0) return unclearChange(ix, change, base, ownFlags, unclear, lastShown)
  }
  if (linked.length === 0) return unverified(UNVERIFIED_TEXT)
  if (after.length === 0) return unverified(staleBasis(linked, lastShown), flagIdsOf(ix, linked))
  const failing = after.filter(l => !standsAsPass(ix, l))
  if (failing.length > 0) return failedChange(ix, change, base, ownFlags, after, failing, lastShown)
  const chosen = after[after.length - 1] as Linked
  return verifiedChange(ix, change, base, ownFlags, chosen, lastWriteSeq, lastShown)
}

/** The same agent's runs of one command (in one directory), whose latest captured run was inconclusive. */
type UnclearCheck = { runs: TrailNode[]; latest: TrailNode }

/**
 * Checks the same agent ran after the change's last write whose command's latest
 * run is inconclusive. trail.ts links only decided runs, so this reuses only its
 * same-agent rule; its file-name and whole-suite rules are not applied here.
 */
function unclearRunsAfter(ix: Index, change: TrailNode, lastWriteSeq: number): UnclearCheck[] {
  const own = (ix.nodesByAgent.get(change.agentId) ?? []).filter(n => n.stage === 'verification')
  const keys = unique(own.filter(n => n.seq > lastWriteSeq).map(n => checkKey(n.command ?? '', n.cwd)))
  return keys.flatMap(key => {
    const runs = own.filter(n => checkKey(n.command ?? '', n.cwd) === key)
    const all = runsOf(ix, runs[0] as TrailNode)
    const latest = all[all.length - 1]
    return latest?.verdict === 'inconclusive' ? [{ runs, latest }] : []
  })
}

function unclearChange(
  ix: Index,
  change: TrailNode,
  base: ChangeBase,
  ownFlags: readonly string[],
  unclear: readonly UnclearCheck[],
  lastShown: number,
): ContributionOutcome {
  const runs = unclear.flatMap(u => u.runs)
  return {
    ...base,
    category: 'failed-or-inconclusive',
    evidence: weakest(change.evidence, 'INFERRED', ...runs.map(r => r.evidence)),
    basis: `After the last edit at #${lastShown} the same agent ran ${unclear.map(u => unclearText(ix, u)).join('; ')}, and no decided linked check covers the final version. Tie (the trail's same-agent rule): the same agent ran this verification after editing. Only the same agent's runs are tied here: trail.ts links only runs with a pass or fail result, so an inconclusive run by another agent is not considered.`,
    ...withUnclear(ix, base, change, ownFlags, unclear),
  }
}

function unclearText(ix: Index, { latest }: UnclearCheck): string {
  const verdictBasis = ix.eventById.get(latest.eventIds[0] ?? '')?.outcome?.verdictBasis ?? 'verdict basis not captured'
  return `${shown(latest.command)} (latest run #${latest.seq} inconclusive: ${verdictBasis})`
}

/** A change's refs with the same agent's inconclusive runs folded in, so they are not a second contribution. */
function withUnclear(ix: Index, base: ChangeBase, change: TrailNode, ownFlags: readonly string[], unclear: readonly UnclearCheck[]) {
  const runs = unclear.flatMap(u => u.runs)
  return {
    nodeIds: [...base.nodeIds, ...runs.map(r => r.id)],
    eventIds: unique([...change.eventIds, ...runs.flatMap(r => r.eventIds)]),
    flagIds: unique([...ownFlags, ...unclear.flatMap(u => commandFlags(ix.trail, u.latest.command, u.latest.cwd)).map(f => f.id)]),
  }
}

function staleBasis(linked: readonly Linked[], lastShown: number): string {
  const pass = [...linked].reverse().find(l => l.check.verdict === 'passed')
  const lead = pass ? `Edited again at #${lastShown} after the passing check at #${pass.check.seq} (${shown(pass.check.command)}). ` : ''
  return `${lead}Every linked check ran before the last edit at #${lastShown}, so none covers the final version: ${linked.map(runText).join('; ')}.`
}

function failedChange(
  ix: Index,
  change: TrailNode,
  base: ChangeBase,
  ownFlags: readonly string[],
  after: readonly Linked[],
  failing: readonly Linked[],
  lastShown: number,
): ContributionOutcome {
  const describe = (l: Linked): string => {
    const latest = summaryOf(ix.trail, l.check)?.latest
    const later =
      l.check.verdict === 'passed' ? `, but the latest captured run of that command in the same directory ${latest === 'failed' ? 'failed' : 'was inconclusive'}` : ''
    return `${runText(l)}${later}`
  }
  const passing = after.filter(l => !failing.includes(l))
  const conflict = passing.length ? ` A linked check also passed (${passing.map(runText).join('; ')}); a failing or inconclusive result outweighs a pass.` : ''
  const first = failing[0] as Linked
  return {
    ...base,
    category: 'failed-or-inconclusive',
    evidence: strongest(failing.map(l => chainOf(change, l))),
    basis: `After the last edit at #${lastShown}: ${failing.map(describe).join('; ')}.${conflict} Why that check bears on this file (trail rule): ${first.edge.basis}.`,
    edgeIds: after.map(l => l.edge.id),
    flagIds: unique([...ownFlags, ...flagIdsOf(ix, after)]),
  }
}

/** Only reached when every linked check after the last edit stands as a pass. */
/**
 * Only reached when every linked check after the last edit stands as a pass. The
 * agent's own inconclusive checks after the last edit are folded in as context:
 * the decided pass covers the final version, and they are not a second contribution.
 */
function verifiedChange(
  ix: Index,
  change: TrailNode,
  base: ChangeBase,
  ownFlags: readonly string[],
  chosen: Linked,
  lastWriteSeq: number,
  lastShown: number,
): ContributionOutcome {
  const newer = runsOf(ix, chosen.check).filter(n => n.seq > chosen.check.seq && n.verdict === 'running')
  const running = newer[0] ? ` A newer run of that command (#${newer[0].seq}) is still running.` : ''
  const unclear = unclearRunsAfter(ix, change, lastWriteSeq)
  const own = unclear.length
    ? ` Its own check ${unclear.map(u => unclearText(ix, u)).join('; ')} after the edit was inconclusive; the passing ${shown(chosen.check.command)} at #${chosen.check.seq} covers the final version.`
    : ''
  return {
    ...base,
    category: 'verified',
    evidence: chainOf(change, chosen),
    basis: `${shown(chosen.check.command)} passed at #${chosen.check.seq}, after the last edit at #${lastShown}. Why that check bears on this file (trail rule): ${chosen.edge.basis}.${running}${own}`,
    edgeIds: [chosen.edge.id],
    ...withUnclear(ix, base, change, ownFlags, unclear),
  }
}

function seriesText(runs: readonly TrailNode[]): string {
  const verdicts = runs.map(r => r.verdict ?? 'running')
  if (verdicts.length === 1) return `1 run, ${verdicts[0]}`
  const tail = verdicts.slice(-SERIES_SHOWN).join(', then ')
  return `${runs.length} runs: ${verdicts.length > SERIES_SHOWN ? `…, ${tail}` : tail}`
}

/** One contribution per command and directory: the agent's latest run decides, every run is referenced. */
function classifyChecks(ix: Index, checks: readonly TrailNode[]): ContributionOutcome[] {
  const groups = groupBy([...checks].sort((a, b) => a.seq - b.seq), n => checkKey(n.command ?? '', n.cwd))
  return [...groups.values()].map(runs => {
    const latest = runs[runs.length - 1] as TrailNode
    const verdict = latest.verdict ?? 'running'
    const where = latest.cwd ? ` in ${latest.cwd}` : ''
    const verdictBasis = ix.eventById.get(latest.eventIds[0] ?? '')?.outcome?.verdictBasis ?? 'verdict basis not captured'
    const edges = runs.flatMap(r => ix.edgesTo.get(r.id) ?? [])
    const changes = [...new Set(edges.map(e => e.from))]
    const flags = commandFlags(ix.trail, latest.command, latest.cwd)
    const sessionLatest = summaryOf(ix.trail, latest)?.latest
    const head = `${shown(latest.command)}${where}: ${seriesText(runs)}`
    const base = {
      id: `c:${latest.agentId}:check:${latest.cwd ?? ''}|${latest.command ?? ''}`,
      agentId: latest.agentId,
      title: `Ran ${shown(latest.command)}${runs.length > 1 ? ` (${runs.length} runs)` : ''} → ${verdict}`,
      nodeIds: runs.map(r => r.id),
      eventIds: runs.flatMap(r => r.eventIds),
      edgeIds: edges.map(e => e.id),
      flagIds: flags.map(f => f.id),
    }
    if (verdict === 'running') {
      return { ...base, category: 'unresolved', evidence: 'UNRESOLVED', basis: `${head}; the latest run (#${latest.seq}) has no captured result yet.` }
    }
    if (verdict !== 'passed') {
      return { ...base, category: 'failed-or-inconclusive', evidence: 'OBSERVED', basis: `${head}; latest ${verdict} (${verdictBasis}).` }
    }
    const covering = edges.filter(e => coversFinalVersion(ix, e))
    const first = covering[0]
    if (first) {
      const evidence = strongest(covering.map(e => chainEvidence(ix, e)))
      const targets = unique(covering.map(e => nodeLabel(ix, e.from))).join(', ')
      return {
        ...base,
        category: 'verified',
        evidence,
        basis: `${head}; latest passed (${verdictBasis}), after the last edit of ${targets}. Why that check bears on it (trail rule): ${first.basis}.`,
      }
    }
    return { ...base, category: 'unresolved', evidence: 'UNRESOLVED', basis: `${head}; latest passed (${verdictBasis}), but ${uncoveredReason(ix, edges, changes, sessionLatest)}.` }
  })
}

/** Whether a change → check edge ends at a passing run after the change's last edit whose command's latest run did not fail. */
function coversFinalVersion(ix: Index, edge: TrailEdge): boolean {
  const change = ix.nodeById.get(edge.from)
  const check = ix.nodeById.get(edge.to)
  if (change?.stage !== 'change' || !check) return false
  const { lastWriteSeq, pending } = writesOf(ix, change)
  return pending.length === 0 && check.seq > lastWriteSeq && standsAsPass(ix, { edge, check })
}

function chainEvidence(ix: Index, edge: TrailEdge): Evidence {
  const change = ix.nodeById.get(edge.from)
  const check = ix.nodeById.get(edge.to)
  return change && check ? chainOf(change, { edge, check }) : 'UNRESOLVED'
}

function uncoveredReason(ix: Index, edges: readonly TrailEdge[], changes: readonly string[], sessionLatest: string | undefined): string {
  if (notPassing(sessionLatest)) return `a later run of that command in the same directory ${sessionLatest === 'failed' ? 'failed' : 'was inconclusive'}`
  if (changes.length === 0) return 'it is linked to no captured change, so it verifies nothing the trail can name'
  const linked = unique(changes).map(id => ix.nodeById.get(id)).filter(isDefined)
  const writes = linked.map(c => writesOf(ix, c))
  if (writes.some(w => w.pending.length > 0)) return 'a linked change has an edit with no captured result yet, so the run is not known to follow its last edit'
  const lastEdits = writes.map(w => `#${w.lastShown}`).join(', ')
  return `it ran before the last edit of the linked ${plural(linked.length, 'change')} (${lastEdits}), so it does not cover the final version`
}

/** For an agent with no change or check: its report, linked to later work or flagged unlinked by the trail. */
function classifyFinding(ix: Index, finding: TrailNode): ContributionOutcome | undefined {
  const later = (ix.edgesFrom.get(finding.id) ?? []).filter(e => !e.to.startsWith('agent:'))
  const base = { id: `c:${finding.id}`, agentId: finding.agentId, category: 'report-only' as const, title: finding.title, nodeIds: [finding.id], eventIds: finding.eventIds }
  const best = later.find(e => e.evidence === 'LINKED') ?? later[0]
  if (best) {
    const more = later.length > 1 ? ` (${plural(later.length - 1, 'more link')})` : ''
    return {
      ...base,
      evidence: best.evidence,
      basis: `report linked to later work: ${best.basis} (→ ${nodeLabel(ix, best.to)})${more}`,
      edgeIds: later.map(e => e.id),
      flagIds: [],
    }
  }
  const unlinked = ix.trail.flags.find(f => f.nodeId === finding.id && f.kind === 'unlinked')
  if (!unlinked) return undefined
  return { ...base, evidence: 'UNRESOLVED', basis: UNLINKED_TEXT, edgeIds: [], flagIds: [unlinked.id] }
}

function noOutcome(ix: Index, agent: AgentRecord): ContributionOutcome {
  const nodes = ix.nodesByAgent.get(agent.id) ?? []
  const flags = ix.trail.flags.filter(f => f.agentId === agent.id && (f.kind === 'no-report' || f.kind === 'no-delegation'))
  const noReport = flags.find(f => f.kind === 'no-report')
  const delegation = flags.some(f => f.kind === 'no-delegation') ? ' Its delegation was not observed.' : ''
  const [evidence, basis]: [Evidence, string] =
    agent.state === 'active'
      ? ['UNRESOLVED', `It is still active: no change, verification or report has been captured yet.${delegation}`]
      : noReport
        ? ['UNAVAILABLE', `${noReport.text} No change or verification was captured either.${delegation}`]
        : [
            'UNAVAILABLE',
            `No change, verification or report was captured, and the end of its work was not observed (state ${agent.state}: ${agent.stateBasis}).${delegation}`,
          ]
  return {
    id: `c:${agent.id}:no-outcome`,
    agentId: agent.id,
    category: 'unresolved',
    evidence,
    basis,
    title: 'No captured outcome',
    nodeIds: nodes.map(n => n.id),
    eventIds: nodes.flatMap(n => n.eventIds),
    edgeIds: [],
    flagIds: flags.map(f => f.id),
  }
}

function bucketOf(agent: AgentRecord, contributions: readonly ContributionOutcome[]): AgentOutcome['bucket'] {
  if (agent.isMain) return 'coordinator'
  const categories = new Set<OutcomeCategory>(contributions.map(c => c.category))
  const [only] = [...categories]
  if (categories.size === 1 && only) return only
  return categories.size === 0 ? 'unresolved' : 'mixed'
}

function firstSeq(ix: Index, contribution: ContributionOutcome): number {
  return Math.min(...contribution.nodeIds.map(id => ix.nodeById.get(id)?.seq ?? Number.MAX_SAFE_INTEGER))
}

function agentOutcome(ix: Index, agent: AgentRecord, row: LedgerRow | undefined): AgentOutcome {
  const nodes = ix.nodesByAgent.get(agent.id) ?? []
  const changes = nodes.filter(n => n.stage === 'change').map(n => classifyChange(ix, n))
  // Runs folded into a change (an inconclusive-only check) are not a second contribution.
  const folded = new Set(
    changes
      .flatMap(c => c.nodeIds.map(id => ix.nodeById.get(id)))
      .filter((n): n is TrailNode => n?.stage === 'verification')
      .map(n => checkKey(n.command ?? '', n.cwd)),
  )
  const checks = classifyChecks(ix, nodes.filter(n => n.stage === 'verification' && !folded.has(checkKey(n.command ?? '', n.cwd))))
  // A report is a contribution only when the agent has no change or check of its own; otherwise it is "also reported back".
  const work = [...changes, ...checks]
  const reports = work.length === 0 ? nodes.filter(n => n.stage === 'finding').map(n => classifyFinding(ix, n)).filter(isDefined) : []
  const found = [...work, ...reports].sort((a, b) => firstSeq(ix, a) - firstSeq(ix, b))
  const contributions = found.length === 0 && !agent.isMain ? [noOutcome(ix, agent)] : found
  return { agentId: agent.id, bucket: bucketOf(agent, contributions), contributions, usage: row?.direct ?? EMPTY_TOTALS }
}

function orphanOutcome(row: LedgerRow): AgentOutcome {
  return {
    agentId: row.agentId,
    bucket: 'unresolved',
    usage: row.direct,
    contributions: [
      {
        id: `c:${row.agentId}:usage-only`,
        agentId: row.agentId,
        category: 'unresolved',
        evidence: 'UNAVAILABLE',
        basis: `usage from a loop never seen as an agent: no agent record, delegation or tool call was captured for it (${row.attribution.basis}).`,
        title: 'Usage only: no agent record',
        nodeIds: [],
        eventIds: [],
        edgeIds: [],
        flagIds: [],
      },
    ],
  }
}

/**
 * The bucket's ≈$: the rows' estimates summed, marked incomplete when some of
 * its tokens carry no estimate (a row without one, or session usage in no row).
 */
function costOf(rows: readonly LedgerRow[], hasUnpricedGap: boolean): CostEstimate | undefined {
  const cost = sumCosts(rows.map(r => r.direct.cost))
  if (!cost) return undefined
  const missing = hasUnpricedGap || rows.some(r => r.direct.processed > 0 && r.direct.cost === undefined)
  return missing ? { ...cost, complete: false } : cost
}

const spendBucketOf = (agent: AgentOutcome): BucketName => (agent.usage.processed > 0 ? agent.bucket : 'no-usage-recorded')

function bucketsFor(agents: readonly AgentOutcome[], rows: readonly LedgerRow[], denominator: number, gap: number): SpendBucket[] {
  const byAgent = new Map(agents.map(a => [a.agentId, spendBucketOf(a)]))
  return BUCKET_ORDER.flatMap(bucket => {
    const members = agents.filter(a => byAgent.get(a.agentId) === bucket).map(a => a.agentId)
    const own = rows.filter(r => byAgent.get(r.agentId) === bucket)
    const processed = own.reduce((n, r) => n + r.direct.processed, 0) + (bucket === 'unresolved' && gap > 0 ? gap : 0)
    if (members.length === 0 && processed === 0) return []
    const cost = costOf(own, bucket === 'unresolved' && gap > 0)
    return [
      {
        bucket,
        agents: members,
        processed,
        ...(denominator > 0 ? { percent: (processed / denominator) * 100 } : {}),
        ...(cost ? { cost } : {}),
        meaning: BUCKET_MEANING[bucket],
      },
    ]
  })
}

function notesFor(snapshot: Snapshot, agents: readonly AgentOutcome[], orphans: readonly AgentOutcome[], denominator: number, gap: number): string[] {
  const label = (id: string) => agentRecord(snapshot, id)?.label ?? id
  const mixed = agents.filter(a => a.bucket === 'mixed')
  return [
    'Categories describe what the captured evidence establishes about each contribution, not the value of the work.',
    ...(mixed.length
      ? [`${plural(mixed.length, 'agent')} (${mixed.map(a => label(a.agentId)).join(', ')}) have contributions in more than one category; each is counted once, under mixed, and its usage is not split.`]
      : []),
    ...(orphans.length
      ? [`${plural(orphans.length, 'ledger row')} carry usage from a loop never seen as an agent (${orphans.map(a => a.agentId).join(', ')}); counted under unresolved.`]
      : []),
    ...(gap > 0 ? [`${gap} tokens in the session total belong to no ledger row; counted under unresolved, with no agent.`] : []),
    ...(gap < 0 ? [`The ledger rows add up to ${-gap} more tokens than the session total; shares use the session total.`] : []),
    ...(denominator === 0 ? ['No token usage has been recorded yet, so no shares are shown.'] : []),
  ]
}

export function buildSpendOutcome(snapshot: Snapshot, trail: Trail, ledger: LedgerView): SpendOutcome {
  const ix = indexOf(snapshot, trail)
  const rowFor = new Map<string, LedgerRow>()
  for (const row of ledger.rows) if (!rowFor.has(row.agentId)) rowFor.set(row.agentId, row)
  // Every agent record, in roster order first: one missing from agentOrder must still carry its usage into a bucket.
  const ids = unique([...snapshot.agentOrder, ...Object.keys(snapshot.agents)])
  const known = ids
    .map(id => agentRecord(snapshot, id))
    .filter(isDefined)
    .map(agent => agentOutcome(ix, agent, rowFor.get(agent.id)))
  const orphans = [...rowFor.values()].filter(row => !agentRecord(snapshot, row.agentId)).map(orphanOutcome)
  const agents = [...known, ...orphans]
  const denominator = ledger.session.processed
  const gap = denominator - ledger.rows.reduce((n, r) => n + r.direct.processed, 0)
  return {
    agents,
    buckets: bucketsFor(agents, ledger.rows, denominator, gap),
    denominator,
    denominatorBasis: DENOMINATOR_BASIS,
    notes: notesFor(snapshot, agents, orphans, denominator, gap),
  }
}
