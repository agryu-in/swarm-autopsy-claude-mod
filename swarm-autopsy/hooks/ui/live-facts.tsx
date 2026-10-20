// Live's facts about one agent, read from the snapshot and the analyses: its
// files (a search root is a path, not a file read), its last activity in
// plain words, whether its usage is known, and its outcome bucket. Pure: no
// drawing, no `$`, no new metric (counts and lookups over captured data only).

import type { AgentOutcome, AgentRecord, Evidence, ForensicEvent, LedgerRow, LedgerTotals, LiveFilter, Snapshot, SpendBucket, SpendOutcome } from '../../types'
import { BUCKET_WORDS, plural } from '../lib/format'
import { statusText } from './events'
import type { Analyses } from './pane'

// ── files ──

export type AgentFiles = {
  /** Distinct file paths of successful read calls. */
  read: string[]
  /** Distinct file paths of successful write calls. */
  written: string[]
  /** Distinct search roots (Grep, Glob, LS `path`): directories or patterns, never counted as files. */
  searched: string[]
  /** True when older events were dropped and this agent may have had some of them: the counts are lower bounds. */
  bounded: boolean
}

/** The agent's distinct paths from the kept timeline, by access; a call that did not succeed touched nothing. */
export function filesOf(snapshot: Snapshot, agent: AgentRecord): AgentFiles {
  const read = new Set<string>()
  const written = new Set<string>()
  const searched = new Set<string>()
  for (const event of snapshot.events) {
    if (event.agentId !== agent.id || !event.tool || event.outcome?.status !== 'ok') continue
    const into = event.tool.access === 'write' ? written : event.tool.access === 'read' ? read : event.tool.access === 'search' ? searched : undefined
    for (const path of into ? event.tool.paths : []) into?.add(path)
  }
  const oldest = snapshot.events[0]?.seq
  const bounded = snapshot.droppedEvents > 0 && (oldest === undefined || agent.firstSeq < oldest)
  return { read: [...read], written: [...written], searched: [...searched], bounded }
}

// ── activity ──

/** `seen`: an event or a running tool backs it, so its time means something. */
export type Activity = { text: string; at: number; live: boolean; seen: boolean }

const TURN_END: Record<string, string> = {
  answer: 'answered',
  aborted: 'turn aborted',
  error: 'turn ended with an error',
  refusal: 'refused',
}

const KIND_WORDS: Partial<Record<ForensicEvent['kind'], string>> = {
  'turn-start': 'started a turn',
  spawn: 'delegated',
  'spawn-denied': 'a delegation was refused',
  'agent-start': 'started',
  'agent-stop': 'stopped',
  roster: 'seen in the agent roster',
}

function lastEventOf(snapshot: Snapshot, agentId: string): ForensicEvent | undefined {
  for (let i = snapshot.events.length - 1; i >= 0; i--) {
    const event = snapshot.events[i]
    if (event?.agentId === agentId) return event
  }
  return undefined
}

/** An event in plain words: `ran npm test (failed (exit 1))`, `Read token.ts`, `answered`. */
export function plainWords(event: ForensicEvent): string {
  if (event.kind === 'tool') {
    const command = event.tool?.command?.split('\n')[0]
    const what = command ? `ran ${command}` : event.summary
    const status = statusText(event).text
    return status && status !== 'ok' ? `${what} (${status})` : what
  }
  if (event.kind === 'turn-end') {
    const reason = /^Turn ended \((\w+)\)/.exec(event.summary)?.[1]
    return (reason ? TURN_END[reason] : undefined) ?? 'turn ended'
  }
  return KIND_WORDS[event.kind] ?? event.summary
}

/**
 * What the agent is doing now (a running tool), or the last thing it was seen doing. A tool counts as running only
 * while the agent is active: a stop or a roster change can end an agent whose tool never reported its end.
 */
export function activityOf(snapshot: Snapshot, agent: AgentRecord): Activity {
  if (agent.currentTool && agent.state === 'active') return { text: `now: ${agent.currentTool.label}`, at: agent.currentTool.at, live: true, seen: true }
  const last = lastEventOf(snapshot, agent.id)
  if (last) return { text: plainWords(last), at: last.at, live: false, seen: true }
  return { text: agent.lastSummary || 'no activity in the kept timeline', at: agent.lastAt, live: false, seen: agent.lastSummary !== '' }
}

// ── usage ──

export type Usage = { known: false; reason: string } | { known: true; totals: LedgerTotals }

/**
 * The agent's direct usage, or why it is unknown: no request heard at all, or every request came back without
 * usage. Unknown is never drawn as an observed 0.
 */
export function usageOf(row: LedgerRow | undefined): Usage {
  const direct = row?.direct
  if (!direct || direct.requests + direct.requestsWithoutUsage === 0) return { known: false, reason: 'no model request heard yet' }
  if (direct.requests === 0) return { known: false, reason: `${plural(direct.requestsWithoutUsage, 'request')} returned no usage` }
  return { known: true, totals: direct }
}

export function rowOf(analyses: Analyses, agentId: string): LedgerRow | undefined {
  return analyses.ledger.rows.find(r => r.agentId === agentId)
}

// ── filters ──

export function liveMatches(agent: AgentRecord, filter: LiveFilter): boolean {
  return filter === 'all' || agent.state === filter
}

// ── spend vs outcome ──

/** The outcome bucket words: the one table every view uses (`BUCKET_WORDS`). */
export const BUCKET_LABEL: Record<SpendBucket['bucket'], string> = BUCKET_WORDS

export function outcomeOf(spend: SpendOutcome, agentId: string): AgentOutcome | undefined {
  return spend.agents.find(a => a.agentId === agentId)
}

/** The spend bucket the agent's tokens are counted in (exactly one). */
export function bucketOf(spend: SpendOutcome, agentId: string): SpendBucket | undefined {
  return spend.buckets.find(b => b.agents.includes(agentId))
}

const EVIDENCE_ORDER: readonly Evidence[] = ['OBSERVED', 'LINKED', 'INFERRED', 'UNRESOLVED', 'UNAVAILABLE']

/**
 * KIT-CANDIDATE: a lib/outcome export, so Spend and Trail badges label a bucket the same way.
 *
 * The label a bucket badge carries: the weakest evidence among the contributions that put the agent there (a claim is
 * no stronger than its weakest link, so `verified` reads ◇ at best). The coordinator is OBSERVED (it is the main
 * loop), unknown usage is UNAVAILABLE, and a bucket with no contribution behind it is UNRESOLVED.
 */
export function bucketEvidence(bucket: SpendBucket['bucket'], outcome: AgentOutcome | undefined): Evidence {
  if (bucket === 'coordinator') return 'OBSERVED'
  if (bucket === 'no-usage-recorded') return 'UNAVAILABLE'
  const ranks = (outcome?.contributions ?? []).map(c => EVIDENCE_ORDER.indexOf(c.evidence))
  if (ranks.length === 0) return 'UNRESOLVED'
  return EVIDENCE_ORDER[Math.max(...ranks)] ?? 'UNRESOLVED'
}
