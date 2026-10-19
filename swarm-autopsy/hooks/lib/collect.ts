// Hook inputs to observations. Each function reads only fields the event's
// declaration documents, and copies nothing it cannot name a source for.

import type { ToolFacts } from '../../types'
import { factsFor, outcomeFor, type RawResult } from './classify'
import type { Observation, RosterEntry, SpawnObservation, TurnUsageLite } from './reduce'

/** The fields of `agent.spawn`'s input this collector reads. */
export type SpawnInput = {
  tool_use_id: string
  prompt: string
  description: string
  subagentType: string
  parentAgentId?: string
  background: boolean
  cwd?: string
  name?: string
  isTeammate?: true
  workflow?: { agentIndex: number }
  resume?: { agentId: string }
}

/** The fields of `agent.spawn`'s result this collector reads. */
export type SpawnResult = { agentId?: string; model?: string; deny?: string }

export function spawnObservation(e: SpawnInput, result: SpawnResult, at: number): SpawnObservation {
  return {
    kind: 'spawn',
    at,
    toolUseId: e.tool_use_id,
    agentId: result.deny === undefined ? result.agentId : undefined,
    parentAgentId: e.parentAgentId,
    subagentType: e.subagentType,
    description: e.description,
    prompt: e.prompt,
    background: e.background,
    cwd: e.cwd,
    name: e.name,
    model: result.deny === undefined ? result.model : undefined,
    isTeammate: e.isTeammate === true ? true : undefined,
    workflowIndex: e.workflow?.agentIndex,
    resumeOf: e.resume?.agentId,
    denied: result.deny,
  }
}

type UsageInput = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  model?: string
}

function usageOf(usage: UsageInput | undefined): TurnUsageLite | undefined {
  if (!usage) return undefined
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    model: usage.model,
  }
}

export type TurnEndInput = {
  turnId: string
  agentId?: string
  reason: string
  answer: string
  durationMs: number
  usage?: UsageInput
}

export function turnEndObservation(e: TurnEndInput, at: number): Observation {
  return {
    kind: 'turn-end',
    at,
    turnId: e.turnId,
    agentId: e.agentId,
    reason: e.reason,
    answer: e.answer,
    durationMs: e.durationMs,
    usage: usageOf(e.usage),
  }
}

/** A tool call's input as plain fields: `tool`, `tool_use_id`, `agentId`, its arguments. */
export type ToolInput = { tool: string; tool_use_id: string; agentId?: string }

const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])

export function toolFacts(e: ToolInput): ToolFacts {
  const args = Object.fromEntries(Object.entries(e as Record<string, unknown>).filter(([key]) => !RESERVED.has(key)))
  return factsFor(String(e.tool), args)
}

export function toolStartObservation(e: ToolInput, facts: ToolFacts, at: number): Observation {
  return { kind: 'tool-start', at, toolUseId: e.tool_use_id, agentId: e.agentId, facts }
}

export function toolEndObservation(e: ToolInput, facts: ToolFacts, result: RawResult, at: number): Observation {
  return { kind: 'tool-end', at, toolUseId: e.tool_use_id, agentId: e.agentId, facts, outcome: outcomeFor(facts, result) }
}

/** `$.agent.list()` rows, reduced to the fields the roster observation keeps. */
export type AgentListRow = { id: string; type: string; description: string; status: string; parentId?: string }

export function rosterObservation(rows: readonly AgentListRow[], at: number): Observation {
  const agents: RosterEntry[] = rows.map(row => ({
    id: row.id,
    type: row.type,
    description: row.description,
    status: row.status,
    parentId: row.parentId,
  }))
  return { kind: 'roster', at, agents }
}
