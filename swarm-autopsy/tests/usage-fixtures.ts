// SIMULATED FIXTURES for the token features (ledger, context, spend vs outcome).
// Builders for tests only: never imported by hooks/, never written into a
// live collector.

import type { TokenCounts, UsageRecord } from '../types'

export function tokens(input: number, cacheRead = 0, cacheWrite = 0, output = 0): TokenCounts {
  return { input, cacheRead, cacheWrite, output }
}

export type UsageOptions = {
  agentId?: string
  turnId?: string
  index?: number
  at?: number
  model?: string
  requestedModel?: string
  tokens?: TokenCounts | null
  stopReason?: string | null
}

/** One request's record as the ledger's normalizer would produce it from a `turn.step` result. */
export function usageRecord(options: UsageOptions = {}): UsageRecord {
  const agentId = options.agentId ?? 'main'
  const turnId = options.turnId ?? `turn-${agentId}`
  const index = options.index ?? 0
  const usage = options.tokens === null ? undefined : (options.tokens ?? tokens(10, 1000, 200, 50))
  return {
    key: `${turnId}:${index}`,
    source: 'turn.step',
    at: options.at ?? 1_000_000 + index * 1000,
    agentId,
    attribution: agentId === 'main' ? 'main-loop' : 'agentId',
    turnId,
    index,
    requestedModel: options.requestedModel ?? 'claude-opus-5-5',
    model: usage ? (options.model ?? 'claude-opus-5-5') : undefined,
    tokens: usage,
    stopReason: options.stopReason === undefined ? (usage ? 'tool_use' : null) : options.stopReason,
  }
}
