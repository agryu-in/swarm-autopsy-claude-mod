// SIMULATED FIXTURES. Observation builders for tests only: these records
// stand in for hook inputs and are never written into a live collector.

import { factsFor, outcomeFor, type RawResult } from '../hooks/lib/classify'
import { emptySnapshot, reduceAll, type Observation, type SpawnObservation } from '../hooks/lib/reduce'
import type { Snapshot } from '../types'

let clock = 1_000_000

export function tick(ms = 1000): number {
  clock += ms
  return clock
}

export function resetClock(): void {
  clock = 1_000_000
}

export type SpawnOptions = {
  parent?: string
  type?: string
  description?: string
  prompt?: string
  toolUseId?: string
  cwd?: string
}

export function spawn(agentId: string | undefined, options: SpawnOptions = {}): SpawnObservation {
  return {
    kind: 'spawn',
    at: tick(),
    toolUseId: options.toolUseId ?? `toolu_spawn_${agentId ?? 'none'}`,
    agentId,
    parentAgentId: options.parent,
    subagentType: options.type ?? 'general-purpose',
    description: options.description ?? `task for ${agentId ?? 'nobody'}`,
    prompt: options.prompt ?? `Do the task assigned to ${agentId ?? 'nobody'}.`,
    background: false,
    cwd: options.cwd,
  }
}

export function turnStart(agentId: string | undefined, turnId: string, text = ''): Observation {
  return { kind: 'turn-start', at: tick(), turnId, agentId, text }
}

export function turnEnd(
  agentId: string | undefined,
  turnId: string,
  answer: string,
  reason: 'answer' | 'aborted' | 'error' | 'refusal' = 'answer',
): Observation {
  return { kind: 'turn-end', at: tick(), turnId, agentId, reason, answer, durationMs: 1000 }
}

export function toolStart(
  agentId: string | undefined,
  toolUseId: string,
  tool: string,
  input: Record<string, unknown>,
): Observation {
  return { kind: 'tool-start', at: tick(), toolUseId, agentId, facts: factsFor(tool, input) }
}

export function toolEnd(
  agentId: string | undefined,
  toolUseId: string,
  tool: string,
  input: Record<string, unknown>,
  raw: RawResult = { text: 'ok' },
): Observation {
  const facts = factsFor(tool, input)
  return { kind: 'tool-end', at: tick(), toolUseId, agentId, facts, outcome: outcomeFor(facts, raw) }
}

/** A tool call observed start then end. */
export function tool(
  agentId: string | undefined,
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  raw: RawResult = { text: 'ok' },
): Observation[] {
  return [toolStart(agentId, toolUseId, name, input), toolEnd(agentId, toolUseId, name, input, raw)]
}

export function build(...observations: Array<Observation | Observation[]>): Snapshot {
  resetClock()
  return reduceAll(emptySnapshot(1_000_000, 'session-fixture'), observations.flat())
}

/** A complete three-agent session: explore, implement, verify. */
export function threeAgentSession(): Observation[] {
  return [
    spawn('explorer', {
      type: 'Explore',
      description: 'investigate token expiry',
      prompt: 'Find why tokens expire early in src/auth/token.ts',
    }),
    turnStart('explorer', 't-explorer'),
    ...tool('explorer', 'r1', 'Read', { file_path: '/repo/src/auth/token.ts' }),
    ...tool('explorer', 'r2', 'Read', { file_path: '/repo/src/auth/session.ts' }),
    turnEnd(
      'explorer',
      't-explorer',
      'Finding: `src/auth/token.ts` compares expiry in seconds against Date.now() in milliseconds, so every token looks expired.',
    ),
    spawn('implementer', {
      description: 'fix token expiry',
      prompt:
        'Fix the unit mismatch in src/auth/token.ts: compares expiry in seconds against Date.now() in milliseconds, so every token looks expired.',
    }),
    turnStart('implementer', 't-impl'),
    ...tool('implementer', 'e1', 'Edit', {
      file_path: '/repo/src/auth/token.ts',
      old_string: 'exp < Date.now()',
      new_string: 'exp * 1000 < Date.now()',
    }),
    turnEnd('implementer', 't-impl', 'Changed the comparison to milliseconds.'),
    spawn('tester', { description: 'run auth tests', prompt: 'Run the auth regression tests.' }),
    turnStart('tester', 't-test'),
    ...tool('tester', 'b1', 'Bash', { command: 'npm test -- token' }, { text: '12 passed' }),
    turnEnd('tester', 't-test', 'All token tests pass.'),
  ]
}
