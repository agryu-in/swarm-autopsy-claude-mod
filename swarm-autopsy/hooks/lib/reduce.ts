// The collector's reducer: one observation in, a new snapshot out. Pure and
// immutable, so the same observations always give the same snapshot, and
// every record keeps the hook and field it came from.

import type {
  AgentCounts,
  AgentRecord,
  AgentReport,
  AgentState,
  CompactionMark,
  ForensicEvent,
  Instruments,
  Snapshot,
  TokenCounts,
  ToolFacts,
  ToolOutcome,
  UsageRecord,
} from '../../types'
import { HANDBACK_TOOL, REPORT_CAP, baseName, cap, pathMentions } from './classify'
import { applyTurnReport, applyUsage, emptyLedger } from './ledger'

export const MAIN = 'main'
export const MAX_EVENTS = 1200
export const PROMPT_CAP = 2000
const DETAIL_CAP = 300
const NOTE_CAP = 12
const OPEN_TOOLS_CAP = 200
const COMPACTION_MARKS_CAP = 60

export type TurnUsageLite = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  model?: string
}

export type RosterEntry = {
  id: string
  type: string
  description: string
  status: string
  parentId?: string
}

export type SpawnObservation = {
  kind: 'spawn'
  at: number
  toolUseId: string
  agentId?: string
  parentAgentId?: string
  subagentType: string
  description: string
  prompt: string
  background: boolean
  cwd?: string
  name?: string
  model?: string
  isTeammate?: boolean
  workflowIndex?: number
  resumeOf?: string
  denied?: string
}

export type Observation =
  | SpawnObservation
  | { kind: 'turn-start'; at: number; turnId: string; agentId?: string; text: string }
  | {
      kind: 'turn-end'
      at: number
      turnId: string
      agentId?: string
      reason: string
      answer: string
      durationMs: number
      usage?: TurnUsageLite
    }
  | { kind: 'tool-start'; at: number; toolUseId: string; agentId?: string; facts: ToolFacts }
  | { kind: 'tool-end'; at: number; toolUseId: string; agentId?: string; facts: ToolFacts; outcome: ToolOutcome }
  | { kind: 'agent-start'; at: number; agentId: string; agentType: string }
  | { kind: 'agent-stop'; at: number; agentId: string; agentType: string; transcriptPath?: string; lastMessage?: string }
  | { kind: 'roster'; at: number; agents: RosterEntry[] }
  | {
      kind: 'compaction'
      at: number
      agentId?: string
      trigger: string
      tokensBefore?: number
      tokensAfter?: number
      summarizerTokens?: TokenCounts
    }
  | { kind: 'context'; at: number; tokens?: number; window: number; percent?: number }
  | { kind: 'step'; record: UsageRecord }
  | { kind: 'cost'; at: number; usd: number }
  | { kind: 'root'; dir: string; root: string | null; commonDir?: string | null }
  | { kind: 'note'; at: number; text: string }

const ZERO_COUNTS: AgentCounts = { tools: 0, reads: 0, writes: 0, execs: 0, errors: 0 }

const ZERO_INSTRUMENTS: Instruments = {
  spawn: 0,
  turnStart: 0,
  turnEnd: 0,
  tool: 0,
  agentStart: 0,
  agentStop: 0,
  roster: 0,
  compaction: 0,
  measure: 0,
  step: 0,
}

export function labelFor(ordinal: number): string {
  if (ordinal <= 0) return MAIN
  let n = ordinal
  let label = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

function newAgent(id: string, ordinal: number, at: number, seq: number, knownFrom: AgentRecord['knownFrom']): AgentRecord {
  const isMain = id === MAIN
  return {
    id,
    ordinal,
    label: labelFor(ordinal),
    isMain,
    knownFrom,
    promptMentions: [],
    parentEvidence: isMain ? 'OBSERVED' : 'UNAVAILABLE',
    parentBasis: isMain ? 'the coordinating session' : 'no delegation event was observed for this agent',
    state: 'unknown',
    stateBasis: 'no lifecycle event observed yet',
    firstSeq: seq,
    firstAt: at,
    lastSeq: seq,
    lastAt: at,
    lastSummary: '',
    turns: 0,
    compactions: 0,
    counts: ZERO_COUNTS,
  }
}

export function emptySnapshot(at: number, sessionId?: string): Snapshot {
  return {
    version: 3,
    sessionId,
    startedAt: at,
    seq: 0,
    rev: 0,
    agents: { [MAIN]: newAgent(MAIN, 0, at, 0, 'session') },
    agentOrder: [MAIN],
    events: [],
    droppedEvents: 0,
    roots: {},
    repos: {},
    openTools: [],
    ledger: emptyLedger(),
    compactionMarks: [],
    instruments: ZERO_INSTRUMENTS,
    notes: [],
  }
}

const idOf = (agentId: string | undefined): string => agentId ?? MAIN

/** The agent recorded under `id`: an own entry only, so an id like `constructor` is never mistaken for one. */
function agentIn(s: Snapshot, id: string): AgentRecord | undefined {
  return Object.hasOwn(s.agents, id) ? s.agents[id] : undefined
}

function ensureAgent(s: Snapshot, id: string, at: number, knownFrom: AgentRecord['knownFrom']): Snapshot {
  if (agentIn(s, id)) return s
  const agent = newAgent(id, s.agentOrder.length, at, s.seq, knownFrom)
  return { ...s, agents: { ...s.agents, [id]: agent }, agentOrder: [...s.agentOrder, id] }
}

function patchAgent(s: Snapshot, id: string, patch: (agent: AgentRecord) => AgentRecord): Snapshot {
  const agent = agentIn(s, id)
  return agent ? { ...s, agents: { ...s.agents, [id]: patch(agent) } } : s
}

function touch(agent: AgentRecord, event: ForensicEvent): AgentRecord {
  return { ...agent, lastSeq: event.seq, lastAt: event.at, lastSummary: event.summary }
}

function hasEvent(s: Snapshot, id: string): boolean {
  return s.events.some(e => e.id === id)
}

/** Appends an event at the next sequence number, dropping the oldest past the cap. */
function appendEvent(s: Snapshot, event: Omit<ForensicEvent, 'seq'>): [Snapshot, ForensicEvent] {
  const seq = s.seq + 1
  const full: ForensicEvent = { ...event, seq }
  const events = [...s.events, full]
  const overflow = Math.max(0, events.length - MAX_EVENTS)
  return [
    { ...s, seq, events: overflow > 0 ? events.slice(overflow) : events, droppedEvents: s.droppedEvents + overflow },
    full,
  ]
}

function count(s: Snapshot, key: keyof Instruments): Snapshot {
  return { ...s, instruments: { ...s.instruments, [key]: s.instruments[key] + 1 } }
}

function setState(agent: AgentRecord, state: AgentState, basis: string): AgentRecord {
  return { ...agent, state, stateBasis: basis }
}

function reportFrom(text: string, at: number, seq: number, reason: string, source: string): AgentReport {
  return { excerpt: cap(text, REPORT_CAP), length: text.length, at, seq, reason, mentions: pathMentions(text), source }
}

function stateForReason(reason: string): AgentState {
  if (reason === 'answer') return 'completed'
  if (reason === 'aborted') return 'stopped'
  return 'failed'
}

function addCounts(counts: AgentCounts, facts: ToolFacts): AgentCounts {
  return {
    ...counts,
    tools: counts.tools + 1,
    reads: counts.reads + (facts.access === 'read' || facts.access === 'search' ? 1 : 0),
    writes: counts.writes + (facts.access === 'write' ? 1 : 0),
    execs: counts.execs + (facts.access === 'exec' ? 1 : 0),
  }
}

export function toolLabel(facts: ToolFacts): string {
  if (facts.command) return `${facts.tool}: ${cap(facts.command.split('\n')[0] ?? '', 80)}`
  const path = facts.paths[0]
  if (path) return `${facts.tool} ${baseName(path)}`
  return facts.tool
}

function reduceSpawn(s: Snapshot, o: SpawnObservation): Snapshot {
  const counted = count(s, 'spawn')
  if (o.denied !== undefined || o.agentId === undefined) {
    const id = `spawn:${o.toolUseId}:${o.workflowIndex ?? 'none'}`
    if (hasEvent(counted, id)) return counted
    const isDenied = o.denied !== undefined
    const why = isDenied ? `refused: ${cap(o.denied ?? '', 120)}` : 'started no local agent (a remote or workflow run)'
    const [next] = appendEvent(counted, {
      id,
      at: o.at,
      kind: isDenied ? 'spawn-denied' : 'spawn',
      agentId: idOf(o.parentAgentId),
      summary: `Spawn of ${o.subagentType} "${cap(o.description, 60)}" ${why}`,
      source: isDenied ? 'agent.spawn: answered with a deny' : 'agent.spawn: the result carried no agentId',
      toolUseId: o.toolUseId,
      detail: cap(o.prompt, DETAIL_CAP),
    })
    return next
  }
  const agentId = o.agentId
  const id = `spawn:${o.toolUseId}:${agentId}`
  if (hasEvent(counted, id)) return counted
  const parentId = idOf(o.parentAgentId)
  const withParent = ensureAgent(counted, parentId, o.at, 'events')
  const withAgent = ensureAgent(withParent, agentId, o.at, 'spawn')
  const [next, event] = appendEvent(withAgent, {
    id,
    at: o.at,
    kind: 'spawn',
    agentId,
    summary: `Delegated to ${o.subagentType}: "${cap(o.description, 80)}"${o.background ? ' (background)' : ''}`,
    source: `agent.spawn: tool_use_id ${o.toolUseId}, result agentId ${agentId}`,
    toolUseId: o.toolUseId,
    detail: cap(o.prompt, DETAIL_CAP),
  })
  const parentBasis = o.parentAgentId
    ? `agent.spawn raised in loop ${o.parentAgentId} (parentAgentId)`
    : 'agent.spawn raised in the main loop (no parentAgentId)'
  return patchAgent(next, agentId, agent => {
    const merged: AgentRecord = {
      ...agent,
      knownFrom: 'spawn',
      type: o.subagentType,
      description: o.description,
      prompt: cap(o.prompt, PROMPT_CAP),
      promptLength: o.prompt.length,
      promptMentions: pathMentions(o.prompt),
      parentId,
      parentEvidence: 'LINKED',
      parentBasis: `${parentBasis}; tool_use_id ${o.toolUseId}`,
      spawnToolUseId: o.toolUseId,
      spawnSeq: event.seq,
      background: o.background,
      cwd: o.cwd,
      model: o.model,
      name: o.name,
    }
    const started = agent.state === 'unknown' || o.resumeOf !== undefined
    return touch(started ? setState(merged, 'active', 'agent.spawn started it') : merged, event)
  })
}

function reduceTurnStart(s: Snapshot, o: Extract<Observation, { kind: 'turn-start' }>): Snapshot {
  const id = `turn:${o.turnId}:start`
  const counted = count(s, 'turnStart')
  if (hasEvent(counted, id)) return counted
  const agentId = idOf(o.agentId)
  const withAgent = ensureAgent(counted, agentId, o.at, 'events')
  const isMain = agentId === MAIN
  const [next, event] = appendEvent(withAgent, {
    id,
    at: o.at,
    kind: 'turn-start',
    agentId,
    summary: isMain ? 'Main turn started' : 'Agent turn started',
    source: `turn.start: turnId ${o.turnId}${o.agentId ? `, agentId ${o.agentId}` : ' (main loop)'}`,
    turnId: o.turnId,
    detail: o.text ? cap(o.text, DETAIL_CAP) : undefined,
  })
  return patchAgent(next, agentId, agent => touch(setState(agent, 'active', 'turn.start: a turn is running'), event))
}

function reduceTurnEnd(s: Snapshot, o: Extract<Observation, { kind: 'turn-end' }>): Snapshot {
  const id = `turn:${o.turnId}:end`
  const counted = count(s, 'turnEnd')
  if (hasEvent(counted, id)) return counted
  const agentId = idOf(o.agentId)
  const withAgent = ensureAgent(counted, agentId, o.at, 'events')
  const hasAnswer = o.answer.trim().length > 0
  const [next, event] = appendEvent(withAgent, {
    id,
    at: o.at,
    kind: 'turn-end',
    agentId,
    summary: `Turn ended (${o.reason})${hasAnswer ? `: answer of ${o.answer.length} chars` : ', no answer text'}`,
    source: `turn.complete: turnId ${o.turnId}, reason ${o.reason}${o.agentId ? `, agentId ${o.agentId}` : ' (main loop)'}`,
    turnId: o.turnId,
    detail: hasAnswer ? cap(o.answer, DETAIL_CAP) : undefined,
  })
  // turn.complete's usage is the engine's sum of the turn's requests: it goes to
  // the ledger for reconciliation only, never into a total (turn.step is the source).
  const tokens = o.usage
    ? { input: o.usage.input, cacheRead: o.usage.cacheRead, cacheWrite: o.usage.cacheWrite, output: o.usage.output }
    : undefined
  const reconciled = { ...next, ledger: applyTurnReport(next.ledger, { turnId: o.turnId, agentId, at: o.at, tokens, model: o.usage?.model }) }
  return patchAgent(reconciled, agentId, agent => {
    const report = hasAnswer
      ? reportFrom(o.answer, o.at, event.seq, o.reason, `turn.complete answer (turnId ${o.turnId})`)
      : agent.report
    const ended = setState(agent, stateForReason(o.reason), `turn.complete reason=${o.reason}`)
    return touch({ ...ended, turns: agent.turns + 1, report, currentTool: undefined }, event)
  })
}

function reduceToolStart(s: Snapshot, o: Extract<Observation, { kind: 'tool-start' }>): Snapshot {
  const id = `tool:${o.toolUseId}`
  if (hasEvent(s, id)) return s
  const agentId = idOf(o.agentId)
  const counted = count(ensureAgent(s, agentId, o.at, 'events'), 'tool')
  const withAgent = { ...counted, openTools: [...counted.openTools, o.toolUseId].slice(-OPEN_TOOLS_CAP) }
  const label = toolLabel(o.facts)
  const [next, event] = appendEvent(withAgent, {
    id,
    at: o.at,
    kind: 'tool',
    agentId,
    summary: label,
    source: `tool.call: tool_use_id ${o.toolUseId}${o.agentId ? `, agentId ${o.agentId}` : ' (main loop)'}`,
    toolUseId: o.toolUseId,
    tool: o.facts,
    outcome: { status: 'running', text: '', verdict: o.facts.verification ? 'running' : undefined },
  })
  return patchAgent(next, agentId, agent => {
    const active = agent.state === 'unknown' ? setState(agent, 'active', 'tool activity observed (no lifecycle event yet)') : agent
    const handback = o.facts.tool === HANDBACK_TOOL && o.facts.text !== undefined && o.facts.text.length > 0
    const report =
      handback && (!agent.report || agent.report.source.startsWith('classic.SubagentStop'))
        ? {
            excerpt: o.facts.text ?? '',
            length: o.facts.textLength ?? 0,
            at: o.at,
            seq: event.seq,
            reason: 'handback',
            mentions: o.facts.mentions,
            source: `${HANDBACK_TOOL} tool call message (tool_use_id ${o.toolUseId})`,
          }
        : agent.report
    return touch(
      {
        ...active,
        counts: addCounts(agent.counts, o.facts),
        currentTool: { tool: o.facts.tool, toolUseId: o.toolUseId, at: o.at, label },
        report,
      },
      event,
    )
  })
}

function reduceToolEnd(s: Snapshot, o: Extract<Observation, { kind: 'tool-end' }>): Snapshot {
  const id = `tool:${o.toolUseId}`
  const existing = s.events.find(e => e.id === id)
  if (existing?.endSeq !== undefined) return s
  const agentId = idOf(o.agentId)
  const isError = o.outcome.status === 'error' || o.outcome.status === 'denied'
  const wasOpen = s.openTools.includes(o.toolUseId)
  const closed = { ...s, openTools: s.openTools.filter(t => t !== o.toolUseId) }
  if (existing) {
    const endSeq = s.seq + 1
    const ended: ForensicEvent = { ...existing, outcome: o.outcome, endSeq, endAt: o.at, source: `${existing.source}; result captured` }
    const replaced = { ...closed, seq: endSeq, events: closed.events.map(e => (e.id === id ? ended : e)) }
    return patchAgent(replaced, agentId, agent => ({
      ...agent,
      counts: isError ? { ...agent.counts, errors: agent.counts.errors + 1 } : agent.counts,
      currentTool: agent.currentTool?.toolUseId === o.toolUseId ? undefined : agent.currentTool,
      lastSeq: endSeq,
      lastAt: o.at,
    }))
  }
  const withAgent = wasOpen ? ensureAgent(closed, agentId, o.at, 'events') : count(ensureAgent(closed, agentId, o.at, 'events'), 'tool')
  const [next, event] = appendEvent(withAgent, {
    id,
    at: o.at,
    kind: 'tool',
    agentId,
    summary: toolLabel(o.facts),
    source: wasOpen
      ? `tool.call result: tool_use_id ${o.toolUseId} (its start record aged out of the timeline)`
      : `tool.call result: tool_use_id ${o.toolUseId} (start not observed)`,
    toolUseId: o.toolUseId,
    tool: o.facts,
    outcome: o.outcome,
    endSeq: s.seq + 1,
    endAt: o.at,
  })
  return patchAgent(next, agentId, agent => {
    const active = agent.state === 'unknown' ? setState(agent, 'active', 'tool activity observed (no lifecycle event yet)') : agent
    const counts = wasOpen ? agent.counts : addCounts(agent.counts, o.facts)
    const currentTool = agent.currentTool?.toolUseId === o.toolUseId ? undefined : agent.currentTool
    return touch({ ...active, currentTool, counts: isError ? { ...counts, errors: counts.errors + 1 } : counts }, event)
  })
}

function reduceAgentStart(s: Snapshot, o: Extract<Observation, { kind: 'agent-start' }>): Snapshot {
  const counted = count(s, 'agentStart')
  const withAgent = ensureAgent(counted, o.agentId, o.at, 'events')
  const agent = agentIn(withAgent, o.agentId)
  const id = `agent-start:${o.agentId}:${agent?.turns ?? 0}`
  if (hasEvent(withAgent, id)) return withAgent
  const [next, event] = appendEvent(withAgent, {
    id,
    at: o.at,
    kind: 'agent-start',
    agentId: o.agentId,
    summary: `Subagent started (${o.agentType})`,
    source: `classic.SubagentStart: agent_id ${o.agentId}, agent_type ${o.agentType}`,
  })
  return patchAgent(next, o.agentId, a => touch({ ...a, type: a.type ?? o.agentType }, event))
}

function reduceAgentStop(s: Snapshot, o: Extract<Observation, { kind: 'agent-stop' }>): Snapshot {
  const counted = count(s, 'agentStop')
  const withAgent = ensureAgent(counted, o.agentId, o.at, 'events')
  const agent = agentIn(withAgent, o.agentId)
  const id = `agent-stop:${o.agentId}:${agent?.turns ?? 0}`
  if (hasEvent(withAgent, id)) return withAgent
  const [next, event] = appendEvent(withAgent, {
    id,
    at: o.at,
    kind: 'agent-stop',
    agentId: o.agentId,
    summary: 'Subagent stopped',
    source: `classic.SubagentStop: agent_id ${o.agentId}${o.transcriptPath ? `, transcript ${o.transcriptPath}` : ''}`,
    detail: o.lastMessage ? cap(o.lastMessage, DETAIL_CAP) : undefined,
  })
  return patchAgent(next, o.agentId, a => {
    const report =
      a.report ?? (o.lastMessage ? reportFrom(o.lastMessage, o.at, event.seq, 'stop', 'classic.SubagentStop last_assistant_message') : undefined)
    const stopped = a.state === 'active' || a.state === 'unknown' ? setState(a, 'completed', 'classic.SubagentStop') : a
    return touch({ ...stopped, type: a.type ?? o.agentType, transcriptPath: o.transcriptPath ?? a.transcriptPath, report }, event)
  })
}

function rosterState(status: string): AgentState | undefined {
  if (status === 'pending' || status === 'running' || status === 'waiting') return 'active'
  if (status === 'idle' || status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'killed') return 'stopped'
  return undefined
}

function reduceRoster(s: Snapshot, o: Extract<Observation, { kind: 'roster' }>): Snapshot {
  return o.agents.reduce((acc, entry) => {
    const isNew = !agentIn(acc, entry.id)
    const withAgent = ensureAgent(acc, entry.id, o.at, 'roster')
    const withParent = entry.parentId ? ensureAgent(withAgent, entry.parentId, o.at, 'events') : withAgent
    const [next, event] = isNew
      ? appendEvent(withParent, {
          id: `roster:${entry.id}`,
          at: o.at,
          kind: 'roster',
          agentId: entry.id,
          summary: `Agent found in the roster (${entry.type}, ${entry.status})`,
          source: '$.agent.list() at load or on first sight of an unknown agent',
        })
      : [withParent, undefined]
    return patchAgent(next, entry.id, agent => {
      const state = rosterState(entry.status)
      const hasParent = agent.parentEvidence === 'LINKED'
      const filled: AgentRecord = {
        ...agent,
        type: agent.type ?? entry.type,
        description: agent.description ?? (entry.description || undefined),
        parentId: hasParent ? agent.parentId : (entry.parentId ?? MAIN),
        parentEvidence: 'LINKED',
        parentBasis: hasParent ? agent.parentBasis : `$.agent.list() ${entry.parentId ? `parentId ${entry.parentId}` : 'lists no parentId (spawned by the main loop)'}`,
      }
      const withState = state ? setState(filled, state, `$.agent.list() status=${entry.status}`) : filled
      return event ? touch(withState, event) : withState
    })
  }, count(s, 'roster'))
}

function reduceCompaction(s: Snapshot, o: Extract<Observation, { kind: 'compaction' }>): Snapshot {
  const agentId = idOf(o.agentId)
  const withAgent = count(ensureAgent(s, agentId, o.at, 'events'), 'compaction')
  const sizes =
    o.tokensBefore !== undefined && o.tokensAfter !== undefined ? ` (${o.tokensBefore} → ${o.tokensAfter} tokens)` : ''
  const [next, event] = appendEvent(withAgent, {
    id: `compaction:${agentId}:${withAgent.seq + 1}`,
    at: o.at,
    kind: 'compaction',
    agentId,
    summary: `Context compacted (${o.trigger})${sizes}`,
    source: `session.compact: trigger ${o.trigger}${o.agentId ? `, agentId ${o.agentId}` : ' (main loop)'}`,
  })
  const mark: CompactionMark = {
    agentId,
    at: o.at,
    seq: event.seq,
    trigger: o.trigger,
    tokensBefore: o.tokensBefore,
    tokensAfter: o.tokensAfter,
    summarizerTokens: o.summarizerTokens,
  }
  const marked = { ...next, compactionMarks: [...next.compactionMarks, mark].slice(-COMPACTION_MARKS_CAP) }
  return patchAgent(marked, agentId, agent => touch({ ...agent, compactions: agent.compactions + 1 }, event))
}

/** One `turn.step` result: counted as heard, then folded into the ledger (which drops a duplicate key). */
function reduceStep(s: Snapshot, o: Extract<Observation, { kind: 'step' }>): Snapshot {
  return { ...count(s, 'step'), ledger: applyUsage(s.ledger, o.record) }
}

/** Folds one observation in; the revision moves whenever anything changed. */
export function reduce(s: Snapshot, o: Observation): Snapshot {
  const next = reduceOne(s, o)
  return next === s ? s : { ...next, rev: s.rev + 1 }
}

function reduceOne(s: Snapshot, o: Observation): Snapshot {
  switch (o.kind) {
    case 'spawn':
      return reduceSpawn(s, o)
    case 'turn-start':
      return reduceTurnStart(s, o)
    case 'turn-end':
      return reduceTurnEnd(s, o)
    case 'tool-start':
      return reduceToolStart(s, o)
    case 'tool-end':
      return reduceToolEnd(s, o)
    case 'agent-start':
      return reduceAgentStart(s, o)
    case 'agent-stop':
      return reduceAgentStop(s, o)
    case 'roster':
      return reduceRoster(s, o)
    case 'compaction':
      return reduceCompaction(s, o)
    case 'context':
      return count({ ...s, context: { tokens: o.tokens, window: o.window, percent: o.percent, at: o.at } }, 'measure')
    case 'step':
      return reduceStep(s, o)
    case 'cost':
      return s.engineCost?.usd === o.usd ? s : { ...s, engineCost: { usd: o.usd, at: o.at } }
    case 'root':
      return {
        ...s,
        roots: { ...s.roots, [o.dir]: o.root },
        repos: o.root && o.commonDir !== undefined ? { ...s.repos, [o.root]: o.commonDir } : s.repos,
      }
    case 'note':
      return s.notes.includes(o.text) ? s : { ...s, notes: [...s.notes, o.text].slice(-NOTE_CAP) }
  }
}

export function reduceAll(s: Snapshot, observations: readonly Observation[]): Snapshot {
  return observations.reduce(reduce, s)
}
