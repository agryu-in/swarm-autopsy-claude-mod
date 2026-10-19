// The contribution trail: delegation → investigation → finding → change →
// verification, per agent, and the edges between them. Every edge is one of
// a fixed set of rules over identifiers, paths and event order, and carries
// the basis a reader can check. No rule concludes causation from order alone.

import type { AgentRecord, AgentState, Evidence, ForensicEvent, Snapshot, VerificationVerdict } from '../../types'
import { cap, dirName, matchMention, normalizeCommand, textNamesPath } from './classify'
import { leadingDirectory, resolveDir } from './command'
import { createOverlapper, sharedMention, type Overlapper } from './excerpt'
import { MAIN } from './reduce'

export const UNLINKED_TEXT =
  'Unlinked contribution — no corresponding implementation or verification evidence was identified in the captured session.'
export const UNVERIFIED_TEXT = 'Unverified change — no verification evidence referencing this file was captured after the edit.'
export const UNVERIFIED_STALE_TEXT =
  'Unverified change — the checks linked to this file ran before its last edit; no verification was captured after that edit.'
const NO_DELEGATION_TEXT =
  'Delegation not observed: this agent was first seen through its own events, so its task and parent are unavailable.'
const LINK_MIN_WORDS = 12
const COMMAND_SHOWN = 80
const MAX_EVENT_IDS = 60
const MAX_CHECKS_PER_CHANGE = 3

export type TrailStage = 'delegation' | 'investigation' | 'finding' | 'change' | 'verification'

export type TrailNode = {
  id: string
  agentId: string
  stage: TrailStage
  evidence: Evidence
  title: string
  seq: number
  eventIds: string[]
  lines: string[]
  path?: string
  verdict?: VerificationVerdict
  command?: string
  mentions?: string[]
  /** The working directory a verification ran in, when known. */
  cwd?: string
  /** Change nodes: the sequence number at which the agent's last successful write to the path ended. */
  lastWriteSeq?: number
}

export type TrailEdge = {
  id: string
  from: string
  to: string
  evidence: 'LINKED' | 'INFERRED'
  basis: string
}

export type TrailFlag = {
  id: string
  agentId: string
  nodeId?: string
  kind: 'unlinked' | 'unverified' | 'no-report' | 'no-delegation' | 'still-failing' | 'inconclusive'
  evidence: 'UNRESOLVED' | 'UNAVAILABLE'
  text: string
  /** still-failing and inconclusive flags: the command (normalised) and working directory they are about. */
  command?: string
  cwd?: string
}

export type TrailLane = { agentId: string; nodes: TrailNode[] }

export type VerificationSummary = {
  command: string
  cwd?: string
  latest: VerificationVerdict
  runs: number
  agentId: string
}

export type OutcomeSummary = {
  filesChanged: Array<{ path: string; agents: string[] }>
  verifications: VerificationSummary[]
  unresolved: number
  agentsByState: Record<AgentState, number>
}

export type Trail = { lanes: TrailLane[]; edges: TrailEdge[]; flags: TrailFlag[]; outcome: OutcomeSummary }

const laneId = (agentId: string) => `agent:${agentId}`
const nodeId = (agentId: string, stage: string, key?: string) => `n:${agentId}:${stage}${key ? `:${key}` : ''}`
const succeeded = (e: ForensicEvent) => e.outcome?.status === 'ok'
const attempted = (e: ForensicEvent) => e.outcome?.status === 'error' || e.outcome?.status === 'denied'
const decided = (v: VerificationVerdict | undefined) => v === 'passed' || v === 'failed'
/** One verification command as run in one working directory: how runs of "the same check" are grouped. */
export const checkKey = (command: string, cwd: string | undefined): string => `${cwd ?? ''}\u0000${command}`

function eventsOf(snapshot: Snapshot, agentId: string): ForensicEvent[] {
  return snapshot.events.filter(e => e.agentId === agentId)
}

const isInvestigation = (e: ForensicEvent) =>
  e.tool !== undefined &&
  !e.tool.verification &&
  succeeded(e) &&
  (e.tool.access === 'read' || e.tool.access === 'search' || (e.tool.access === 'exec' && e.outcome?.isReadOnly === true))

function delegationNode(agent: AgentRecord, parent: AgentRecord | undefined): TrailNode {
  const prompt =
    agent.prompt !== undefined
      ? `prompt (${agent.promptLength ?? agent.prompt.length} chars): ${agent.prompt}`
      : 'prompt unavailable: the agent was found through $.agent.list(), which carries its description but not its prompt'
  return {
    id: nodeId(agent.id, 'delegation'),
    agentId: agent.id,
    stage: 'delegation',
    evidence: 'OBSERVED',
    title: `Delegated by ${parent?.isMain ? 'main' : (parent?.label ?? 'unknown')}: “${agent.description ?? ''}”`,
    seq: agent.spawnSeq ?? agent.firstSeq,
    eventIds: agent.spawnToolUseId ? [`spawn:${agent.spawnToolUseId}:${agent.id}`] : [],
    lines: [
      `type: ${agent.type ?? 'unknown'}${agent.background ? ' (background)' : ''}`,
      `parent: ${agent.parentBasis}`,
      ...(agent.cwd ? [`working directory: ${agent.cwd}`] : []),
      prompt,
    ],
  }
}

function investigationNode(agent: AgentRecord, events: ForensicEvent[]): TrailNode | undefined {
  const reads = events.filter(isInvestigation)
  if (reads.length === 0) return undefined
  const files = [...new Set(reads.flatMap(e => e.tool?.paths ?? []))]
  const commands = reads.filter(e => e.tool?.command).map(e => e.tool?.command ?? '')
  return {
    id: nodeId(agent.id, 'investigation'),
    agentId: agent.id,
    stage: 'investigation',
    evidence: 'OBSERVED',
    title: `Investigated: ${reads.length} read${reads.length === 1 ? '' : 's'} across ${files.length} path${files.length === 1 ? '' : 's'}`,
    seq: reads[0]?.seq ?? agent.firstSeq,
    eventIds: reads.map(e => e.id).slice(-MAX_EVENT_IDS),
    lines: [...files.map(f => `read: ${f}`), ...commands.map(c => `read-only command: ${c}`)],
  }
}

function findingNode(snapshot: Snapshot, agent: AgentRecord): TrailNode | undefined {
  const report = agent.report
  if (!report) return undefined
  const firstLine = report.excerpt.split('\n').find(line => line.trim().length > 0) ?? ''
  const source = snapshot.events.find(e => e.seq === report.seq)
  return {
    id: nodeId(agent.id, 'finding'),
    agentId: agent.id,
    stage: 'finding',
    evidence: 'OBSERVED',
    title: `Report: ${firstLine.trim()}`,
    seq: report.seq,
    eventIds: source ? [source.id] : [],
    lines: [`source: ${report.source}`, `length: ${report.length} chars`, `names: ${report.mentions.join(', ') || 'no paths'}`, report.excerpt],
  }
}

/** One node per file the agent changed: only writes whose result came back without error count. */
function changeNodes(agent: AgentRecord, events: ForensicEvent[]): TrailNode[] {
  const byPath = new Map<string, ForensicEvent[]>()
  for (const event of events.filter(e => e.tool?.access === 'write')) {
    for (const path of event.tool?.paths ?? []) byPath.set(path, [...(byPath.get(path) ?? []), event])
  }
  return [...byPath.entries()]
    .filter(([, writes]) => writes.some(succeeded))
    .map(([path, writes]) => {
      const done = writes.filter(succeeded)
      const failed = writes.filter(attempted).length
      return {
        id: nodeId(agent.id, 'change', path),
        agentId: agent.id,
        stage: 'change' as const,
        evidence: 'OBSERVED' as const,
        title: `Changed ${path} (${done.length} edit${done.length === 1 ? '' : 's'}${failed ? `; ${failed} refused or failed attempt${failed === 1 ? '' : 's'}` : ''})`,
        seq: done[0]?.seq ?? agent.firstSeq,
        eventIds: writes.map(e => e.id),
        lines: writes.map(e => `#${e.seq} ${e.tool?.tool}: ${e.outcome?.status ?? 'running'}`),
        path,
        lastWriteSeq: Math.max(...done.map(e => e.endSeq ?? e.seq)),
      }
    })
}

function verificationNodes(snapshot: Snapshot, agent: AgentRecord, events: ForensicEvent[]): TrailNode[] {
  const base = agent.cwd ?? snapshot.cwd
  return events
    .filter(e => e.tool?.verification !== undefined && e.tool.command !== undefined)
    .map(e => {
      const verdict = e.outcome?.verdict ?? 'running'
      const command = normalizeCommand(e.tool?.command ?? '')
      const cwd = resolveDir(leadingDirectory(e.tool?.command ?? ''), base)
      return {
        id: nodeId(agent.id, 'verify', e.id),
        agentId: agent.id,
        stage: 'verification' as const,
        evidence: 'OBSERVED' as const,
        title: `Ran \`${cap(command, COMMAND_SHOWN)}\` → ${verdict}`,
        seq: e.seq,
        eventIds: [e.id],
        lines: [`verdict: ${verdict}${e.outcome?.verdictBasis ? ` (${e.outcome.verdictBasis})` : ''}`, `command: ${command}`, e.outcome?.text ?? ''],
        verdict,
        command,
        mentions: e.tool?.mentions ?? [],
        cwd,
      }
    })
}

type Built = { lanes: TrailLane[]; nodes: TrailNode[] }

function buildLanes(snapshot: Snapshot): Built {
  const lanes: TrailLane[] = []
  for (const id of snapshot.agentOrder) {
    const agent = snapshot.agents[id]
    if (!agent) continue
    const events = eventsOf(snapshot, id)
    const changes = changeNodes(agent, events)
    const checks = verificationNodes(snapshot, agent, events)
    if (agent.isMain) {
      if (changes.length + checks.length > 0) lanes.push({ agentId: id, nodes: [...changes, ...checks].sort((x, y) => x.seq - y.seq) })
      continue
    }
    const parent = agent.parentId ? snapshot.agents[agent.parentId] : undefined
    const nodes = [
      agent.parentEvidence === 'LINKED' && agent.description !== undefined ? delegationNode(agent, parent) : undefined,
      investigationNode(agent, events),
      findingNode(snapshot, agent),
      ...changes,
      ...checks,
    ].filter((n): n is TrailNode => n !== undefined)
    lanes.push({ agentId: id, nodes })
  }
  return { lanes, nodes: lanes.flatMap(l => l.nodes) }
}

function delegationEdges(snapshot: Snapshot, nodes: readonly TrailNode[]): TrailEdge[] {
  const edges: TrailEdge[] = []
  for (const node of nodes) {
    const agent = snapshot.agents[node.agentId]
    if (!agent?.parentId) continue
    if (node.stage === 'delegation') {
      edges.push({ id: `e:${laneId(agent.parentId)}>${node.id}`, from: laneId(agent.parentId), to: node.id, evidence: 'LINKED', basis: agent.parentBasis })
    }
    if (node.stage === 'finding' && agent.report) {
      const how = agent.report.source.startsWith('turn.complete')
        ? 'turn.complete carries the answer the subagent handed back to its spawner'
        : agent.report.source
      edges.push({ id: `e:${node.id}>${laneId(agent.parentId)}`, from: node.id, to: laneId(agent.parentId), evidence: 'LINKED', basis: how })
    }
  }
  return edges
}

/**
 * Whether a report could have reached an agent at all: its spawner receives
 * it, and another agent only if it was delegated after the report existed
 * (or its delegation was not observed, which leaves the question open).
 */
function couldReceive(snapshot: Snapshot, author: AgentRecord, receiverId: string, reportSeq: number): boolean {
  if (receiverId === author.parentId) return true
  const receiver = snapshot.agents[receiverId]
  if (!receiver || receiver.isMain) return false
  return receiver.spawnSeq === undefined || receiver.spawnSeq > reportSeq
}

function forwardEdge(
  overlap: Overlapper,
  author: AgentRecord,
  target: AgentRecord | undefined,
  finding: TrailNode,
  delegation: TrailNode,
): TrailEdge | undefined {
  const report = author.report
  if (!report || !target) return undefined
  const excerpt = overlap(report.excerpt, target.prompt ?? '', author.prompt ?? '')
  if (excerpt) {
    const isLong = excerpt.words >= LINK_MIN_WORDS
    return {
      id: `e:${finding.id}>${delegation.id}`,
      from: finding.id,
      to: delegation.id,
      evidence: isLong ? 'LINKED' : 'INFERRED',
      basis: `the delegation prompt contains a verbatim ${excerpt.words}-word excerpt of this report${isLong ? '' : ' (short enough to be a common phrase)'}: “${cap(excerpt.text, 240)}”`,
    }
  }
  const shared = sharedMention(report.mentions, target.promptMentions)
  if (!shared) return undefined
  return {
    id: `e:${finding.id}>${delegation.id}`,
    from: finding.id,
    to: delegation.id,
    evidence: 'INFERRED',
    basis: `both the report and the later delegation prompt name \`${shared}\``,
  }
}

function findingEdges(snapshot: Snapshot, nodes: readonly TrailNode[]): TrailEdge[] {
  const edges: TrailEdge[] = []
  const overlap = createOverlapper()
  for (const finding of nodes.filter(n => n.stage === 'finding')) {
    const author = snapshot.agents[finding.agentId]
    const report = author?.report
    if (!author || !report) continue
    for (const delegation of nodes.filter(n => n.stage === 'delegation' && n.agentId !== author.id && n.seq > report.seq)) {
      const edge = forwardEdge(overlap, author, snapshot.agents[delegation.agentId], finding, delegation)
      if (edge) edges.push(edge)
    }
    for (const change of nodes.filter(n => n.stage === 'change' && n.agentId !== author.id && n.seq > report.seq)) {
      if (!couldReceive(snapshot, author, change.agentId, report.seq)) continue
      const kind = report.mentions.map(m => matchMention(m, change.path ?? '')).find(k => k !== undefined)
      if (!kind) continue
      edges.push({
        id: `e:${finding.id}>${change.id}`,
        from: finding.id,
        to: change.id,
        evidence: 'INFERRED',
        basis: `the report names this file (${kind === 'path' ? 'by path' : 'by file name'}); the edit came later, at #${change.seq}. A shared name is not proof the report caused it.`,
      })
    }
  }
  return edges
}

function taskEdges(snapshot: Snapshot, nodes: readonly TrailNode[]): TrailEdge[] {
  const edges: TrailEdge[] = []
  for (const change of nodes.filter(n => n.stage === 'change')) {
    const agent = snapshot.agents[change.agentId]
    const kind = agent?.promptMentions.map(m => matchMention(m, change.path ?? '')).find(k => k !== undefined)
    if (!agent || !kind) continue
    const delegation = nodeId(agent.id, 'delegation')
    if (!nodes.some(n => n.id === delegation)) continue
    edges.push({
      id: `e:${delegation}>${change.id}`,
      from: delegation,
      to: change.id,
      evidence: kind === 'path' ? 'LINKED' : 'INFERRED',
      basis: `the delegation prompt names this file ${kind === 'path' ? 'by path' : 'by file name only'}; the same agent then edited it`,
    })
  }
  return edges
}

/** Whether a verification ran in the working tree that holds `path`, as far as the roots say. */
function sameTree(snapshot: Snapshot, path: string, check: TrailNode): boolean {
  const root = snapshot.roots[dirName(path)]
  const cwd = check.cwd
  if (!root || !cwd) return false
  return cwd === root || cwd.startsWith(`${root}/`)
}

function verificationBasis(snapshot: Snapshot, change: TrailNode, check: TrailNode): string | undefined {
  const path = change.path ?? ''
  const named = textNamesPath(check.command ?? '', check.mentions ?? [], path)
  if (named) {
    const how = named === 'stem' ? 'by its stem' : named === 'path' ? 'by path' : 'by file name'
    return `the command names the edited file (${how}) and ran after the edit`
  }
  if (check.agentId === change.agentId) return 'the same agent ran this verification after editing; the command names no edited file'
  if ((check.mentions ?? []).length === 0 && sameTree(snapshot, path, check)) {
    return 'a whole-suite command naming no file ran after this edit in the same working tree; it does not establish that this file was exercised'
  }
  return undefined
}

/**
 * Change → verification candidates: a decided verdict only, and per command
 * (in its working directory) the LATEST qualifying run after the change, so a
 * fail-then-fix sequence links its passing rerun. At most a few commands per
 * change, the most recently run first.
 */
function verificationEdges(snapshot: Snapshot, nodes: readonly TrailNode[]): TrailEdge[] {
  const edges: TrailEdge[] = []
  const newestFirst = nodes.filter(n => n.stage === 'verification' && decided(n.verdict)).sort((a, b) => b.seq - a.seq)
  for (const change of nodes.filter(n => n.stage === 'change')) {
    const latest = new Map<string, { check: TrailNode; basis: string }>()
    const lastWrite = change.lastWriteSeq ?? change.seq
    for (const check of newestFirst) {
      if (latest.size >= MAX_CHECKS_PER_CHANGE) break
      if (check.seq <= change.seq || !check.command) continue
      const key = checkKey(check.command, check.cwd)
      if (latest.has(key)) continue
      const basis = verificationBasis(snapshot, change, check)
      if (!basis) continue
      // A check covers the file as it was when it ran: one that ran between
      // edits is kept as evidence but says it predates the final version.
      const stale = check.seq <= lastWrite ? `; it ran before the last edit of this file (#${lastWrite}), so it does not cover the final version` : ''
      latest.set(key, { check, basis: basis + stale })
    }
    for (const { check, basis } of [...latest.values()].sort((a, b) => a.check.seq - b.check.seq)) {
      edges.push({ id: `e:${change.id}>${check.id}`, from: change.id, to: check.id, evidence: 'INFERRED', basis })
    }
  }
  return edges
}

function noReportText(agent: AgentRecord): string {
  return `Ended (${agent.state}) without a captured report: no answer text and no hand-back message was observed for it.`
}

function flagsFor(snapshot: Snapshot, nodes: readonly TrailNode[], edges: readonly TrailEdge[]): TrailFlag[] {
  const flags: TrailFlag[] = []
  const outgoing = (id: string) => edges.some(e => e.from === id && !e.to.startsWith('agent:'))
  for (const id of snapshot.agentOrder) {
    const agent = snapshot.agents[id]
    if (!agent || agent.isMain) continue
    const own = nodes.filter(n => n.agentId === id)
    if (agent.parentEvidence !== 'LINKED' || agent.description === undefined) {
      flags.push({ id: `f:${id}:no-delegation`, agentId: id, kind: 'no-delegation', evidence: 'UNAVAILABLE', text: NO_DELEGATION_TEXT })
    }
    const endObserved = agent.turns > 0 || agent.stateBasis.startsWith('classic.SubagentStop')
    if (!agent.report && endObserved && agent.state !== 'active') {
      flags.push({ id: `f:${id}:no-report`, agentId: id, kind: 'no-report', evidence: 'UNAVAILABLE', text: noReportText(agent) })
    }
    const didWork = own.some(n => n.stage === 'change' || n.stage === 'verification')
    if (agent.report && !didWork && !outgoing(nodeId(id, 'finding'))) {
      flags.push({ id: `f:${id}:unlinked`, agentId: id, nodeId: nodeId(id, 'finding'), kind: 'unlinked', evidence: 'UNRESOLVED', text: UNLINKED_TEXT })
    }
  }
  const seqOf = new Map(nodes.map(n => [n.id, n.seq]))
  for (const change of nodes.filter(n => n.stage === 'change')) {
    const lastWrite = change.lastWriteSeq ?? change.seq
    const checks = edges.filter(e => e.from === change.id && e.to.includes(':verify:'))
    if (checks.some(e => (seqOf.get(e.to) ?? 0) > lastWrite)) continue
    const text = checks.length > 0 ? UNVERIFIED_STALE_TEXT : UNVERIFIED_TEXT
    flags.push({ id: `f:${change.id}:unverified`, agentId: change.agentId, nodeId: change.id, kind: 'unverified', evidence: 'UNRESOLVED', text })
  }
  return flags
}

/** Each distinct command, per working directory, and its latest verdict. */
function verificationSummaries(nodes: readonly TrailNode[]): VerificationSummary[] {
  const byKey = new Map<string, TrailNode[]>()
  for (const node of nodes.filter(n => n.stage === 'verification').sort((a, b) => a.seq - b.seq)) {
    const key = checkKey(node.command ?? '', node.cwd)
    byKey.set(key, [...(byKey.get(key) ?? []), node])
  }
  return [...byKey.values()].map(runs => {
    const last = runs[runs.length - 1]
    return { command: last?.command ?? '', cwd: last?.cwd, latest: last?.verdict ?? 'running', runs: runs.length, agentId: last?.agentId ?? MAIN }
  })
}

function stillFailing(nodes: readonly TrailNode[], failed: VerificationSummary): TrailFlag {
  const key = checkKey(failed.command, failed.cwd)
  const runs = nodes.filter(n => n.stage === 'verification' && checkKey(n.command ?? '', n.cwd) === key)
  const lastRun = Math.max(...runs.map(n => n.seq))
  const laterPasses = [
    ...new Set(nodes.filter(n => n.stage === 'verification' && n.seq > lastRun && n.verdict === 'passed').map(n => n.command ?? '')),
  ]
  const shown = cap(failed.command, COMMAND_SHOWN)
  const text =
    laterPasses.length === 0
      ? `The latest captured run of \`${shown}\` failed; no later passing run was captured.`
      : `The latest captured run of \`${shown}\` failed, and that exact command was not run again. Later verification runs passed: ${laterPasses
          .slice(0, 3)
          .map(c => `\`${cap(c, 40)}\``)
          .join(', ')}.`
  return {
    id: `f:still-failing:${key}`,
    agentId: failed.agentId,
    kind: 'still-failing',
    evidence: 'UNRESOLVED',
    text,
    command: failed.command,
    cwd: failed.cwd,
  }
}

function stillInconclusive(nodes: readonly TrailNode[], check: VerificationSummary): TrailFlag {
  const key = checkKey(check.command, check.cwd)
  const runs = nodes.filter(n => n.stage === 'verification' && checkKey(n.command ?? '', n.cwd) === key)
  const basis = runs[runs.length - 1]?.lines[0]?.replace(/^verdict: inconclusive\s*/, '') ?? ''
  const text = `The latest captured run of \`${cap(check.command, COMMAND_SHOWN)}\` was inconclusive${basis ? ` ${basis}` : ''}; no later decided run of that command was captured, so its result is unknown.`
  return {
    id: `f:inconclusive:${key}`,
    agentId: check.agentId,
    kind: 'inconclusive',
    evidence: 'UNRESOLVED',
    text,
    command: check.command,
    cwd: check.cwd,
  }
}

function outcomeOf(snapshot: Snapshot, nodes: readonly TrailNode[], flags: readonly TrailFlag[], verifications: VerificationSummary[]): OutcomeSummary {
  const changed = new Map<string, Set<string>>()
  for (const node of nodes.filter(n => n.stage === 'change')) {
    changed.set(node.path ?? '', new Set([...(changed.get(node.path ?? '') ?? []), node.agentId]))
  }
  const agentsByState: Record<AgentState, number> = { active: 0, completed: 0, failed: 0, stopped: 0, unknown: 0 }
  for (const agent of Object.values(snapshot.agents)) if (!agent.isMain) agentsByState[agent.state] += 1
  return {
    filesChanged: [...changed.entries()].map(([path, agents]) => ({ path, agents: [...agents] })),
    verifications,
    unresolved: flags.filter(f => f.evidence === 'UNRESOLVED').length,
    agentsByState,
  }
}

export function buildTrail(snapshot: Snapshot): Trail {
  const { lanes, nodes } = buildLanes(snapshot)
  const edges = [
    ...delegationEdges(snapshot, nodes),
    ...findingEdges(snapshot, nodes),
    ...taskEdges(snapshot, nodes),
    ...verificationEdges(snapshot, nodes),
  ]
  const verifications = verificationSummaries(nodes)
  const failing = verifications.filter(v => v.latest === 'failed').map(v => stillFailing(nodes, v))
  const inconclusive = verifications.filter(v => v.latest === 'inconclusive').map(v => stillInconclusive(nodes, v))
  const flags = [...flagsFor(snapshot, nodes, edges), ...failing, ...inconclusive]
  return { lanes, edges, flags, outcome: outcomeOf(snapshot, nodes, flags, verifications) }
}
