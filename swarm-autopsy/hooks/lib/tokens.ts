// Token arithmetic the token features share (the ledger, the context gauge
// and spend vs outcome). Shared helpers: pure, no rounding, and never a
// context-window percentage on their own.

import type { CostEstimate, TokenCounts } from '../../types'

/** Requests whose prompt is larger than this many tokens are tallied apart, for prices tiered by prompt size. */
export const LARGE_PROMPT_TOKENS = 100_000

/** Stop reasons that say something about context pressure, as `TurnStepResult.stopReason` spells them. */
export const CONTEXT_STOP_REASONS: readonly string[] = ['max_tokens', 'model_context_window_exceeded', 'compaction']

export const ZERO_TOKENS: TokenCounts = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  }
}

export function sameTokens(a: TokenCounts, b: TokenCounts): boolean {
  return a.input === b.input && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite && a.output === b.output
}

/**
 * The size of the prompt one request was answered over: its uncached, cache-read
 * and cache-written input together (the status line's `total_input_tokens`).
 * Meaningful for ONE request only; on summed counts it is not a context size.
 */
export function promptTokensOf(t: TokenCounts): number {
  return t.input + t.cacheRead + t.cacheWrite
}

/** All four counts together: "tokens processed", used only for proportions and never called a context size. */
export function processedOf(t: TokenCounts): number {
  return t.input + t.cacheRead + t.cacheWrite + t.output
}

/**
 * Sums estimates (cost is linear, so a sum of per-agent estimates is the
 * estimate of their union). Undefined when there is nothing to sum.
 */
export function sumCosts(costs: ReadonlyArray<CostEstimate | undefined>): CostEstimate | undefined {
  const present = costs.filter((c): c is CostEstimate => c !== undefined)
  const first = present[0]
  if (!first) return undefined
  return {
    usd: present.reduce((total, c) => total + c.usd, 0),
    measure: 'ESTIMATED',
    priceDate: first.priceDate,
    unpricedModels: [...new Set(present.flatMap(c => c.unpricedModels))].sort(),
    complete: present.every(c => c.complete),
  }
}
