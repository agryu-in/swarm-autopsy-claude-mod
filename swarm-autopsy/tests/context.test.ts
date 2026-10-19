// F1 context view tests. SIMULATED data only: AgentLedger values are built by
// hand from `usageRecord` (F2's reducer is not used here), and no live session,
// model or network is involved.

import { describe, expect, test } from 'claude-code/testing'

import { ROLE } from '../hooks/lib/palette'

import type { AgentContextView, AgentLedger, CompactionMark, ModelTally, Snapshot, TokenCounts, UsageRecord } from '../types'
import {
  SUBAGENT_WINDOW_GAP,
  buildContextView,
  contextGaugeText,
  contextViewFor,
  documentedWindow,
  MODEL_WINDOWS,
  peakIsExact,
  percentText,
  sparkline,
  type ContextInputs,
} from '../hooks/lib/context'
import { applyUsage } from '../hooks/lib/ledger'
import { LARGE_PROMPT_TOKENS, ZERO_TOKENS, addTokens, promptTokensOf } from '../hooks/lib/tokens'
import type { ViewContext } from '../hooks/ui/common'
import { ContextPanel, contextMarkers } from '../hooks/ui/context'
import { build, spawn } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'

// ── SIMULATED ledger builder: the AgentLedger contract shape, by hand ──

const byTime = (a: UsageRecord, b: UsageRecord) => a.at - b.at || a.index - b.index

function tally(previous: ModelTally | undefined, t: TokenCounts): ModelTally {
  const base: ModelTally = previous ?? { requests: 0, tokens: ZERO_TOKENS, largeRequests: 0, largeTokens: ZERO_TOKENS }
  const large = promptTokensOf(t) > LARGE_PROMPT_TOKENS
  return {
    requests: base.requests + 1,
    tokens: addTokens(base.tokens, t),
    largeRequests: base.largeRequests + (large ? 1 : 0),
    largeTokens: large ? addTokens(base.largeTokens, t) : base.largeTokens,
  }
}

/** An agent's ledger as F2 would store it; `historyCap` keeps only the newest records, as the bound does. */
function agentLedger(records: readonly UsageRecord[], options: { agentId?: string; historyCap?: number } = {}): AgentLedger {
  const agentId = options.agentId ?? records[0]?.agentId ?? 'main'
  const ordered = [...records].sort(byTime)
  const counted = ordered.filter(r => r.tokens !== undefined)
  const history = options.historyCap === undefined ? ordered : ordered.slice(-options.historyCap)
  const byModel = counted.reduce<Record<string, ModelTally>>((acc, r) => {
    const model = r.model ?? r.requestedModel
    return { ...acc, [model]: tally(acc[model], r.tokens ?? ZERO_TOKENS) }
  }, {})
  const stopReasons = ordered.reduce<Record<string, number>>((acc, r) => {
    const key = r.stopReason ?? 'none'
    return { ...acc, [key]: (acc[key] ?? 0) + 1 }
  }, {})
  return {
    agentId,
    attribution: agentId === 'main' ? 'main-loop' : 'agentId',
    requests: counted.length,
    requestsWithoutUsage: ordered.length - counted.length,
    tokens: counted.reduce((sum, r) => addTokens(sum, r.tokens ?? ZERO_TOKENS), ZERO_TOKENS),
    byModel,
    stopReasons,
    firstAt: ordered[0]?.at ?? 0,
    lastAt: ordered[ordered.length - 1]?.at ?? 0,
    latest: ordered[ordered.length - 1],
    history,
    historyDropped: ordered.length - history.length,
  }
}

function mark(agentId: string, seq: number, extra: Partial<CompactionMark> = {}): CompactionMark {
  return { agentId, at: 5_000_000 + seq, seq, trigger: 'auto', ...extra }
}

const OPUS_1M = 'claude-opus-5-5[1m]'
/** A model the documented window table does not list: no window is known for it. */
const UNKNOWN_MODEL = 'claude-unlisted-9'
const MAIN_READING = { window: 1_000_000, tokens: 120_000, percent: 12, at: 1_700_000_000_000 }

function sub(overrides: Partial<ContextInputs> = {}): ContextInputs {
  return { agentId: 'ag1', isMain: false, ledger: undefined, compactions: [], ...overrides }
}

// ── buildContextView ──

describe('buildContextView: missing data', () => {
  test('no ledger gives an empty, unavailable view with plain gaps', () => {
    const view = buildContextView(sub())
    expect(view.agentId).toBe('ag1')
    expect(view.latest).toBeUndefined()
    expect(view.peakPromptTokens).toBeUndefined()
    expect(view.samples).toEqual([])
    expect(view.window.measure).toBe('UNAVAILABLE')
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.percent.value).toBeUndefined()
    expect(view.stopSignals).toEqual([])
    expect(view.compactions).toEqual([])
    expect(view.gaps.some(g => g.includes('No model request recorded'))).toBe(true)
    expect(view.gaps.some(g => g.includes("does not expose a subagent's context window"))).toBe(true)
  })

  test('a ledger with an empty history does not crash and reads as no requests', () => {
    const view = buildContextView(sub({ ledger: agentLedger([], { agentId: 'ag1' }), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(view.latest).toBeUndefined()
    expect(view.samples).toEqual([])
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.percent.basis).toContain('no request with usage')
  })

  test('a malformed ledger missing its arrays and maps still gives a view', () => {
    const broken = { agentId: 'ag1', requests: 1 } as unknown as AgentLedger
    const view = buildContextView(sub({ ledger: broken }))
    expect(view.samples).toEqual([])
    expect(view.stopSignals).toEqual([])
    expect(view.window.measure).toBe('UNAVAILABLE')
  })

  test('records without usage give no prompt size and say how many lacked usage', () => {
    const records = [0, 1].map(index => usageRecord({ agentId: 'ag1', index, tokens: null, requestedModel: OPUS_1M }))
    const view = buildContextView(sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(view.latest).toBeUndefined()
    expect(view.samples).toEqual([])
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.gaps.some(g => g.includes('2 requests resolved without usage'))).toBe(true)
  })

  test('a newer request without usage is noted and not used as latest', () => {
    const records = [
      usageRecord({ agentId: 'ag1', index: 0, at: 1000, tokens: tokens(10, 50_000, 0, 5), requestedModel: OPUS_1M }),
      usageRecord({ agentId: 'ag1', index: 1, at: 2000, tokens: null, requestedModel: OPUS_1M }),
    ]
    const view = buildContextView(sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(view.latest?.at).toBe(1000)
    expect(view.latest?.promptTokens).toBe(50_010)
    expect(view.gaps.some(g => g.includes('newest request') && g.includes('no usage'))).toBe(true)
  })

  test("an unknown subagent model makes the % unavailable", () => {
    const records = [usageRecord({ agentId: 'ag1', requestedModel: '' })]
    const view = buildContextView(sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(view.latest).toBeDefined()
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.percent.basis).toContain("this agent's model is unknown")
    expect(view.gaps.some(g => g.includes('Context % unavailable'))).toBe(true)
  })

  test("an unknown main-loop model leaves only the documented window; with an unlisted model the % is unavailable", () => {
    const listed = [usageRecord({ agentId: 'ag1', requestedModel: OPUS_1M })]
    expect(buildContextView(sub({ ledger: agentLedger(listed), main: MAIN_READING })).window.basis).toContain('documented window')
    const records = [usageRecord({ agentId: 'ag1', requestedModel: UNKNOWN_MODEL })]
    const view = buildContextView(sub({ ledger: agentLedger(records), main: MAIN_READING }))
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.percent.basis).toContain("main loop's model is unknown")
  })

  test('no main window yet leaves only the documented window; with an unlisted model the % is unavailable', () => {
    const listed = [usageRecord({ agentId: 'ag1', requestedModel: OPUS_1M })]
    expect(buildContextView(sub({ ledger: agentLedger(listed), mainRequestedModel: OPUS_1M })).window.basis).toContain('documented window')
    const records = [usageRecord({ agentId: 'ag1', requestedModel: UNKNOWN_MODEL })]
    const view = buildContextView(sub({ ledger: agentLedger(records), mainRequestedModel: UNKNOWN_MODEL }))
    expect(view.window.measure).toBe('UNAVAILABLE')
    expect(view.window.tokens).toBeUndefined()
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.percent.basis).toContain('no main-session window observed yet')
  })
})

describe('buildContextView: the main loop', () => {
  test('window and % are OBSERVED from session.measure, with its time and numerator', () => {
    const records = [usageRecord({ agentId: 'main', tokens: tokens(100, 110_000, 9_000, 400), requestedModel: OPUS_1M })]
    const view = buildContextView({ agentId: 'main', isMain: true, ledger: agentLedger(records), compactions: [], main: MAIN_READING, mainRequestedModel: OPUS_1M })
    expect(view.window).toMatchObject({ tokens: 1_000_000, at: MAIN_READING.at, measure: 'OBSERVED' })
    expect(view.window.basis).toContain('session.measure')
    expect(view.window.basis).toContain('UTC')
    expect(view.percent).toMatchObject({ value: 12, tokens: 120_000, at: MAIN_READING.at, measure: 'OBSERVED' })
    expect(view.latest?.promptTokens).toBe(119_100)
    expect(view.gaps.some(g => g.includes('subagent'))).toBe(false)
  })

  test('a window without a fill reading keeps the window and makes the % unavailable', () => {
    const view = buildContextView({ agentId: 'main', isMain: true, ledger: undefined, compactions: [], main: { window: 200_000, at: 42 } })
    expect(view.window.measure).toBe('OBSERVED')
    expect(view.window.tokens).toBe(200_000)
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.percent.value).toBeUndefined()
    expect(view.gaps.some(g => g.includes('no fill'))).toBe(true)
  })

  test('no session.measure reading leaves the main window unavailable', () => {
    const view = buildContextView({ agentId: 'main', isMain: true, ledger: undefined, compactions: [] })
    expect(view.window.measure).toBe('UNAVAILABLE')
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.window.basis).toContain('no session.measure reading yet')
  })
})

describe('buildContextView: subagent estimate', () => {
  const records = [usageRecord({ agentId: 'ag1', at: 9_000, tokens: tokens(1000, 80_000, 3000, 500), requestedModel: OPUS_1M })]

  test('the same model (suffix included) gives an ESTIMATED % with its basis', () => {
    const view = buildContextView(sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(view.window).toMatchObject({ tokens: 1_000_000, at: MAIN_READING.at, measure: 'ESTIMATED' })
    expect(view.percent.measure).toBe('ESTIMATED')
    expect(Math.abs((view.percent.value ?? 0) - 8.4) < 1e-9).toBe(true)
    expect(view.percent.tokens).toBe(84_000)
    expect(view.percent.at).toBe(9_000)
    expect(view.window.basis).toContain("assumes the main session's window for the same model")
    expect(view.window.basis).toContain('autoCompactWindow')
    expect(view.window.basis).toContain('UTC')
    expect(view.percent.basis).toContain("assumes the main session's window for the same model")
    expect(view.gaps.some(g => g.includes("does not expose a subagent's context window"))).toBe(true)
  })

  test('another model the documented table lists gives an ESTIMATED % against its documented window, dated and sourced', () => {
    // The subagent asked for claude-opus-5-5[1m], the main loop for claude-opus-5-5: not the same model, so main's
    // observed window is not assumed; the [1m] variant's documented window (1M) is.
    const view = buildContextView(sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: 'claude-opus-5-5' }))
    expect(view.window).toMatchObject({ tokens: 1_000_000, measure: 'ESTIMATED' })
    expect(view.percent.measure).toBe('ESTIMATED')
    expect(Math.abs((view.percent.value ?? 0) - 8.4) < 1e-9).toBe(true)
    expect(view.window.basis).toContain('documented window')
    expect(view.window.basis).toContain(MODEL_WINDOWS.date)
    expect(view.window.basis).toContain(OPUS_1M)
    expect(view.window.basis).toContain('autoCompactWindow')
    expect(view.window.basis).not.toContain('as session.measure read it')
    expect(view.gaps.some(g => g.includes("does not expose a subagent's context window"))).toBe(true)
  })

  test('a haiku subagent under an opus main loop is estimated against haiku’s own documented window', () => {
    const haiku = [usageRecord({ agentId: 'ag1', at: 9_000, tokens: tokens(10, 60_000, 4_000), requestedModel: 'claude-haiku-5-5' })]
    const view = buildContextView(sub({ ledger: agentLedger(haiku), main: MAIN_READING, mainRequestedModel: 'claude-opus-5-5' }))
    expect(view.percent.measure).toBe('ESTIMATED')
    expect(view.window.tokens).toBe(MODEL_WINDOWS.windows['claude-haiku-5-5'])
    expect(view.percent.basis).toContain('claude-haiku-5-5')
  })

  test('a model the documented table does not list is UNAVAILABLE, with both models named', () => {
    const unlisted = [usageRecord({ agentId: 'ag1', at: 9_000, tokens: tokens(1000, 80_000, 3000, 500), requestedModel: UNKNOWN_MODEL })]
    const view = buildContextView(sub({ ledger: agentLedger(unlisted), main: MAIN_READING, mainRequestedModel: 'claude-opus-5-5' }))
    expect(view.window.measure).toBe('UNAVAILABLE')
    expect(view.window.tokens).toBeUndefined()
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.percent.value).toBeUndefined()
    expect(view.percent.basis).toContain(UNKNOWN_MODEL)
    expect(view.percent.basis).toContain('claude-opus-5-5')
  })

  test('documentedWindow reads the [1m] suffix, a provider prefix and an exact id, and nothing else', () => {
    expect(documentedWindow('claude-opus-5-5')).toBe(1_000_000)
    expect(documentedWindow('claude-sonnet-4-6[1m]')).toBe(1_000_000)
    expect(documentedWindow('anthropic.claude-haiku-4-5')).toBe(200_000)
    expect(documentedWindow('claude-haiku-4-5')).toBe(200_000)
    expect(documentedWindow(UNKNOWN_MODEL)).toBeUndefined()
    expect(documentedWindow('constructor')).toBeUndefined()
    expect(documentedWindow('')).toBeUndefined()
    expect(documentedWindow(undefined)).toBeUndefined()
  })

  test('an estimate above 100% of the assumed window is UNAVAILABLE, not a percentage', () => {
    const big = [usageRecord({ agentId: 'ag1', tokens: tokens(0, 1_150_000, 50_000), requestedModel: OPUS_1M })]
    const view = buildContextView(sub({ ledger: agentLedger(big), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(view.latest?.promptTokens).toBe(1_200_000)
    expect(view.window.measure).toBe('UNAVAILABLE')
    expect(view.window.tokens).toBeUndefined()
    expect(view.percent.measure).toBe('UNAVAILABLE')
    expect(view.percent.value).toBeUndefined()
    expect(view.percent.basis).toContain('exceeds the assumed window')
  })

  test('a zero or non-finite main window is unknown capacity for main and subagent alike', () => {
    for (const window of [0, Number.NaN, -5]) {
      const reading = { ...MAIN_READING, window }
      const mainView = buildContextView({ agentId: 'main', isMain: true, ledger: undefined, compactions: [], main: reading })
      expect(mainView.window.measure).toBe('UNAVAILABLE')
      expect(mainView.percent.measure).toBe('UNAVAILABLE')
      // No usable main window: the subagent's own model's documented window is used instead, never main's bad reading.
      const subView = buildContextView(sub({ ledger: agentLedger(records), main: reading, mainRequestedModel: OPUS_1M }))
      expect(subView.window.basis).toContain('documented window')
      const unlisted = records.map(record => ({ ...record, requestedModel: UNKNOWN_MODEL }))
      const noWindow = buildContextView(sub({ ledger: agentLedger(unlisted), main: reading, mainRequestedModel: UNKNOWN_MODEL }))
      expect(noWindow.percent.measure).toBe('UNAVAILABLE')
      expect(noWindow.percent.basis).toContain('no main-session window')
    }
  })

  test('a main window read while main used another model is not assumed; the documented window is used instead (D4)', () => {
    const view = buildContextView(
      sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: OPUS_1M, mainModelAtWindow: 'claude-sonnet-5-5' }),
    )
    expect(view.percent.measure).toBe('ESTIMATED')
    expect(view.window.basis).toContain('documented window')
    expect(view.window.basis).not.toContain('as session.measure read it')
  })

  test('a main window read on the model main still uses keeps the estimate', () => {
    const view = buildContextView(
      sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: OPUS_1M, mainModelAtWindow: OPUS_1M }),
    )
    expect(view.percent.measure).toBe('ESTIMATED')
  })

  test('contextViewFor reads the model main used when its window was read from main’s own history', () => {
    const at = MAIN_READING.at
    const base = build(spawn('ag1'))
    const ledger = [
      usageRecord({ agentId: 'main', turnId: 'm1', at: at - 5000, tokens: tokens(10, 50_000), requestedModel: 'claude-sonnet-5-5' }),
      usageRecord({ agentId: 'main', turnId: 'm2', at: at + 5000, tokens: tokens(10, 60_000), requestedModel: OPUS_1M }),
      usageRecord({ agentId: 'ag1', turnId: 'a1', at: at + 6000, tokens: tokens(10, 70_000), requestedModel: OPUS_1M }),
    ].reduce((l, r) => applyUsage(l, r), base.ledger)
    const stale: Snapshot = { ...base, ledger, context: MAIN_READING }
    // Read while main used sonnet: main's window is not assumed, the documented one is.
    expect(contextViewFor(stale, 'ag1').window.basis).toContain('documented window')
    const fresh: Snapshot = { ...stale, context: { ...MAIN_READING, at: at + 5500 } }
    expect(contextViewFor(fresh, 'ag1').percent.measure).toBe('ESTIMATED')
    expect(contextViewFor(fresh, 'ag1').window.basis).toContain("assumes the main session's window for the same model")
    expect(contextViewFor(fresh, 'main').percent.measure).toBe('OBSERVED')
  })

  test('the model compared is the one of the record whose prompt is used', () => {
    const mixed = [
      usageRecord({ agentId: 'ag1', index: 0, at: 1000, tokens: tokens(10, 40_000), requestedModel: OPUS_1M }),
      usageRecord({ agentId: 'ag1', index: 1, at: 2000, tokens: null, requestedModel: 'claude-haiku-5-5' }),
    ]
    const view = buildContextView(sub({ ledger: agentLedger(mixed), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(view.latest?.requestedModel).toBe(OPUS_1M)
    expect(view.percent.measure).toBe('ESTIMATED')
  })
})

describe('buildContextView: history, signals and compactions', () => {
  test('repeated requests out of order: samples oldest first, peak, latest newest by at', () => {
    const records = [
      usageRecord({ agentId: 'ag1', turnId: 't2', index: 0, at: 3000, tokens: tokens(0, 30_000) }),
      usageRecord({ agentId: 'ag1', turnId: 't1', index: 0, at: 1000, tokens: tokens(0, 10_000) }),
      usageRecord({ agentId: 'ag1', turnId: 't1', index: 1, at: 2000, tokens: tokens(0, 50_000, 0, 7) }),
    ]
    const shuffled: AgentLedger = { ...agentLedger(records), history: records }
    const view = buildContextView(sub({ ledger: shuffled }))
    expect(view.samples).toEqual([10_000, 50_000, 30_000])
    expect(view.peakPromptTokens).toBe(50_000)
    expect(view.latest?.at).toBe(3000)
    expect(view.latest?.promptTokens).toBe(30_000)
  })

  test('stop signals come only from captured stopReasons, with counts and last time', () => {
    const records = [
      usageRecord({ agentId: 'ag1', index: 0, at: 1000, stopReason: 'max_tokens' }),
      usageRecord({ agentId: 'ag1', index: 1, at: 2000, stopReason: 'tool_use' }),
      usageRecord({ agentId: 'ag1', index: 2, at: 3000, stopReason: 'max_tokens' }),
      usageRecord({ agentId: 'ag1', index: 3, at: 4000, stopReason: 'refusal' }),
      usageRecord({ agentId: 'ag1', index: 4, at: 5000, stopReason: 'end_turn' }),
    ]
    const view = buildContextView(sub({ ledger: agentLedger(records) }))
    expect(view.stopSignals).toEqual([
      { reason: 'max_tokens', count: 2, lastAt: 3000 },
      { reason: 'refusal', count: 1, lastAt: 4000 },
    ])
  })

  test('no context stop reason captured gives no stop signals', () => {
    const records = [usageRecord({ agentId: 'ag1', stopReason: 'end_turn' }), usageRecord({ agentId: 'ag1', index: 1, tokens: null })]
    expect(buildContextView(sub({ ledger: agentLedger(records) })).stopSignals).toEqual([])
  })

  test('a signal whose record left the history keeps its exact count and no time', () => {
    const records = [
      usageRecord({ agentId: 'ag1', index: 0, at: 1000, stopReason: 'model_context_window_exceeded' }),
      usageRecord({ agentId: 'ag1', index: 1, at: 2000 }),
      usageRecord({ agentId: 'ag1', index: 2, at: 3000 }),
    ]
    const view = buildContextView(sub({ ledger: agentLedger(records, { historyCap: 2 }) }))
    expect(view.stopSignals).toEqual([{ reason: 'model_context_window_exceeded', count: 1, lastAt: undefined }])
  })

  test("compaction marks: this agent's only, by seq, token counts kept when captured", () => {
    const marks = [
      mark('ag1', 7),
      mark('main', 3, { tokensBefore: 900_000, tokensAfter: 40_000 }),
      mark('ag1', 2, { tokensBefore: 150_000, tokensAfter: 12_000, summarizerTokens: tokens(5, 140_000, 0, 9_000) }),
    ]
    const view = buildContextView(sub({ compactions: marks }))
    expect(view.compactions.map(m => m.seq)).toEqual([2, 7])
    expect(view.compactions[0]).toMatchObject({ tokensBefore: 150_000, tokensAfter: 12_000 })
    expect(view.compactions[1]?.tokensBefore).toBeUndefined()
    expect(marks.map(m => m.seq)).toEqual([7, 3, 2])
  })

  test('a bounded history says it holds the newest N of M', () => {
    const records = [0, 1, 2, 3, 4].map(index => usageRecord({ agentId: 'ag1', index }))
    const view = buildContextView(sub({ ledger: agentLedger(records, { historyCap: 3 }) }))
    expect(view.samples).toHaveLength(3)
    expect(view.gaps.some(g => g.includes('newest 3 of 5'))).toBe(true)
  })

  test('an exact ledger peak beyond the history bound is used, with no retained-only caveat', () => {
    const records = [
      usageRecord({ agentId: 'ag1', index: 0, at: 1000, tokens: tokens(0, 200_000) }),
      usageRecord({ agentId: 'ag1', index: 1, at: 2000, tokens: tokens(0, 10_000) }),
      usageRecord({ agentId: 'ag1', index: 2, at: 3000, tokens: tokens(0, 20_000) }),
    ]
    const ledger: AgentLedger = { ...agentLedger(records, { historyCap: 2 }), peak: { promptTokens: 200_000, at: 1000, key: 'turn-ag1:0' } }
    const view = buildContextView(sub({ ledger }))
    expect(view.samples).toEqual([10_000, 20_000])
    expect(view.peakPromptTokens).toBe(200_000)
    expect(peakIsExact(view)).toBe(true)
    expect(view.gaps.some(g => g.toLowerCase().includes('peak'))).toBe(false)
    expect(view.gaps.some(g => g.includes('newest 2 of 3') && g.includes('sparkline'))).toBe(true)
  })

  test('without a ledger peak, a dropped history labels the peak as of the retained requests', () => {
    const records = [
      usageRecord({ agentId: 'ag1', index: 0, at: 1000, tokens: tokens(0, 200_000) }),
      usageRecord({ agentId: 'ag1', index: 1, at: 2000, tokens: tokens(0, 10_000) }),
      usageRecord({ agentId: 'ag1', index: 2, at: 3000, tokens: tokens(0, 20_000) }),
    ]
    const view = buildContextView(sub({ ledger: agentLedger(records, { historyCap: 2 }) }))
    expect(view.peakPromptTokens).toBe(20_000)
    expect(peakIsExact(view)).toBe(false)
    expect(view.gaps.some(g => g.includes('Peak prompt') && g.includes('2 retained requests'))).toBe(true)
  })

  test('a complete history needs no ledger peak to be exact', () => {
    const records = [0, 1].map(index => usageRecord({ agentId: 'ag1', index, tokens: tokens(0, 10_000 * (index + 1)) }))
    const view = buildContextView(sub({ ledger: agentLedger(records) }))
    expect(view.peakPromptTokens).toBe(20_000)
    expect(peakIsExact(view)).toBe(true)
  })

  test('a ledger with no history but a known latest and peak still gives a prompt size (missing samples)', () => {
    const latest = usageRecord({ agentId: 'ag1', index: 4, at: 9000, tokens: tokens(0, 30_000), requestedModel: OPUS_1M })
    const ledger: AgentLedger = {
      ...agentLedger([latest]),
      history: [],
      historyDropped: 5,
      peak: { promptTokens: 90_000, at: 4000, key: 'turn-ag1:1' },
    }
    const view = buildContextView(sub({ ledger, main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(view.latest?.promptTokens).toBe(30_000)
    expect(view.samples).toEqual([])
    expect(view.peakPromptTokens).toBe(90_000)
    expect(view.percent.measure).toBe('ESTIMATED')
    expect(view.gaps.some(g => g.includes('newest 0 of 5'))).toBe(true)
  })

  test('a request key repeated in history is sampled and counted once', () => {
    const once = usageRecord({ agentId: 'ag1', index: 0, at: 1000, tokens: tokens(0, 10_000) })
    const records = [once, usageRecord({ agentId: 'ag1', index: 1, at: 2000, tokens: tokens(0, 20_000) })]
    const ledger: AgentLedger = { ...agentLedger(records, { historyCap: 2 }), history: [once, once, records[1] as UsageRecord], historyDropped: 1 }
    const view = buildContextView(sub({ ledger }))
    expect(view.samples).toEqual([10_000, 20_000])
    expect(view.gaps.some(g => g.includes('newest 2 of 3'))).toBe(true)
  })

  test('the input ledger is not mutated', () => {
    const records = [usageRecord({ agentId: 'ag1', at: 2000 }), usageRecord({ agentId: 'ag1', index: 1, at: 1000 })]
    const ledger: AgentLedger = { ...agentLedger(records), history: records }
    buildContextView(sub({ ledger }))
    expect(ledger.history.map(r => r.at)).toEqual([2000, 1000])
  })
})

// ── sparkline, percentText, contextGaugeText ──

describe('sparkline', () => {
  test('edge cases: no values, zero width, one value, all zeros', () => {
    expect(sparkline([], 8)).toBe('')
    expect(sparkline([5, 6], 0)).toBe('')
    expect(sparkline([5], 4)).toBe('█')
    expect(sparkline([0, 0], 4)).toBe('▁▁')
  })

  test('takes the newest width values and scales them to their max', () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8], 4)).toBe('▅▆▇█')
    expect(sparkline([1, 8], 10)).toBe('▂█')
  })

  test('non-finite or negative values draw as the lowest bar', () => {
    expect(sparkline([Number.NaN, -5, 10], 3)).toBe('▁▁█')
  })
})

describe('percentText and contextGaugeText', () => {
  test('small estimates read <1%, others whole numbers', () => {
    expect(percentText(0.4)).toBe('<1%')
    expect(percentText(8.4)).toBe('8%')
    expect(percentText(0)).toBe('0%')
    expect(percentText(undefined)).toBe('n/a')
  })

  const subRecords = [0, 1, 2, 3].map(index =>
    usageRecord({ agentId: 'ag1', index, tokens: tokens(0, 20_000 * (index + 1) + 4_000), requestedModel: OPUS_1M }),
  )

  test('main: measured tokens, the observed % and the observed window', () => {
    const view = buildContextView({ agentId: 'main', isMain: true, ledger: undefined, compactions: [], main: MAIN_READING })
    expect(contextGaugeText(view, 60)).toBe('ctx 120k ● 12% of 1.0M')
    expect(contextGaugeText(view, 20)).toBe('ctx 120k ● 12%')
  })

  test('subagent, estimated: sparkline and ≈% of the assumed window', () => {
    const view = buildContextView(sub({ ledger: agentLedger(subRecords), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    const text = contextGaugeText(view, 60)
    expect(text.startsWith('ctx 84k ')).toBe(true)
    expect(text.endsWith('· ≈8% of 1.0M')).toBe(true)
    expect(text).toContain('▃▅▆█')
  })

  test('subagent, unavailable: tokens and % n/a', () => {
    const one = [usageRecord({ agentId: 'ag1', tokens: tokens(0, 84_000), requestedModel: UNKNOWN_MODEL })]
    const view = buildContextView(sub({ ledger: agentLedger(one), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(contextGaugeText(view, 60)).toBe('ctx 84k · ∅ % n/a')
  })

  test('nothing recorded yet', () => {
    expect(contextGaugeText(buildContextView(sub()), 60)).toBe('ctx n/a · ∅ % n/a')
  })

  test('never wider than asked, and drops the sparkline first', () => {
    const view = buildContextView(sub({ ledger: agentLedger(subRecords), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    for (const width of [0, 1, 8, 12, 20, 24, 30, 45, 60]) {
      expect(contextGaugeText(view, width).length).toBeLessThanOrEqual(width)
    }
    expect(contextGaugeText(view, 24)).toBe('ctx 84k ▆█ · ≈8% of 1.0M')
    expect(contextGaugeText(view, 23)).toBe('ctx 84k · ≈8% of 1.0M')
    expect(contextGaugeText(view, 12)).toBe('ctx 84k ≈8%')
  })

  test('card widths 24, 30, 40 and 60: exact lines for an estimated subagent', () => {
    const view = buildContextView(sub({ ledger: agentLedger(subRecords), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(contextGaugeText(view, 24)).toBe('ctx 84k ▆█ · ≈8% of 1.0M')
    expect(contextGaugeText(view, 30)).toBe('ctx 84k ▃▅▆█ · ≈8% of 1.0M')
    expect(contextGaugeText(view, 40)).toBe('ctx 84k ▃▅▆█ · ≈8% of 1.0M')
    expect(contextGaugeText(view, 60)).toBe('ctx 84k ▃▅▆█ · ≈8% of 1.0M')
  })

  test('narrow cards drop the window, then the separator, and never cut the % or its glyph', () => {
    const sonnet = 'claude-sonnet-5-5'
    const heavy = [0, 1, 2].map(index =>
      usageRecord({ agentId: 'ag1', index, tokens: tokens(0, 52_000 * (index + 1)), requestedModel: sonnet }),
    )
    const reading = { window: 200_000, tokens: 150_000, percent: 75, at: MAIN_READING.at }
    const estimated = buildContextView(sub({ ledger: agentLedger(heavy), main: reading, mainRequestedModel: sonnet }))
    expect(contextGaugeText(estimated, 24)).toBe('ctx 156k · ≈78% of 200k')
    expect(contextGaugeText(estimated, 20)).toBe('ctx 156k · ≈78%')
    expect(contextGaugeText(estimated, 14)).toBe('ctx 156k ≈78%')
    const heavyUnlisted = heavy.map(record => ({ ...record, requestedModel: UNKNOWN_MODEL }))
    const unavailable = buildContextView(sub({ ledger: agentLedger(heavyUnlisted), main: reading, mainRequestedModel: OPUS_1M }))
    const observed = buildContextView({ agentId: 'main', isMain: true, ledger: undefined, compactions: [], main: reading })
    const cases: Array<[AgentContextView, string]> = [
      [estimated, '≈78%'],
      [unavailable, '∅ % n/a'],
      [observed, '● 75%'],
    ]
    for (const [view, pct] of cases) {
      for (const width of [16, 20, 24, 26, 30, 35, 40, 56, 60]) {
        const line = contextGaugeText(view, width)
        expect(line.length).toBeLessThanOrEqual(width)
        expect(line.startsWith('ctx ')).toBe(true)
        expect(line).toContain(pct)
      }
    }
  })
})

// ── ContextPanel: draws from the view alone, never crashes ──

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') {
    const element = node as { props?: { children?: unknown; label?: unknown }; children?: unknown }
    return textOf(element.props?.children) + textOf(element.children)
  }
  return ''
}

type Drawn = { type: string; props?: { children?: unknown; color?: unknown }; children?: unknown }

/** Every Text element drawn, with its color and its whole text (nested tags included). */
function textsOf(node: unknown): Array<{ color: unknown; text: string }> {
  if (Array.isArray(node)) return node.flatMap(textsOf)
  if (node === null || typeof node !== 'object') return []
  const drawn = node as Drawn
  const own = drawn.type === 'Text' ? [{ color: drawn.props?.color, text: textOf(drawn) }] : []
  return [...own, ...textsOf(drawn.props?.children), ...textsOf(drawn.children)]
}

function stubContext(width: number, options: { open?: string[]; snapshot?: Snapshot } = {}): ViewContext {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  return {
    els: { Box: element('Box'), Text: element('Text'), Button: element('Button') },
    surface: 'terminal',
    width,
    rows: 40,
    now: MAIN_READING.at + 60_000,
    snapshot: options.snapshot ?? ({} as Snapshot),
    ui: { view: 'live', filter: 'all', page: 0, ...(options.open ? { open: options.open } : {}) },
    act: {},
  } as unknown as ViewContext
}

function panelOf(view: AgentContextView, width: number, open?: string[]): unknown {
  return ContextPanel(stubContext(width, { open }), view)
}

function panelText(view: AgentContextView, width: number, open?: string[]): string {
  return textOf(panelOf(view, width, open))
}

/** Every Text element's own text, one per element (nested Texts are inside their parent's). */
function topTexts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(topTexts)
  if (node === null || typeof node !== 'object') return []
  const drawn = node as Drawn
  if (drawn.type === 'Text') return [textOf(drawn)]
  return [...topTexts(drawn.props?.children), ...topTexts(drawn.children)]
}

describe('ContextPanel', () => {
  test('an empty view draws its gaps at narrow and wide widths', () => {
    for (const width of [30, 60]) {
      const text = panelText(buildContextView(sub()), width)
      expect(text).toContain('∅')
      expect(text).toContain('No model request recorded')
    }
  })

  test('an estimated subagent view tags its numbers and states its assumption in view', () => {
    const records = [
      usageRecord({ agentId: 'ag1', index: 0, at: MAIN_READING.at, tokens: tokens(0, 84_000), requestedModel: OPUS_1M, stopReason: 'max_tokens' }),
    ]
    const marks = [mark('ag1', 1, { tokensBefore: 150_000, tokensAfter: 12_000, summarizerTokens: tokens(5, 140_000, 0, 9_000) }), mark('ag1', 2)]
    const view = buildContextView(sub({ ledger: agentLedger(records), compactions: marks, main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    const text = panelText(view, 40)
    expect(text).toContain('●')
    expect(text).toMatch(/≈ 8\.4% of 1\.0M · ● prompt 84k/)
    expect(text).toContain('max_tokens')
    expect(text).toContain('150k → 12k')
    expect(text).toContain('display only')
    expect(text).toContain('token counts not captured')
    expect(text).toContain("assumes the main session's window for the same model")
  })

  test('every line with a number carries a measure label', () => {
    const records = [0, 1, 2].map(index =>
      usageRecord({ agentId: 'ag1', index, at: MAIN_READING.at - 3000 + index * 1000, tokens: tokens(5, 20_000 * (index + 1), 100, 50), requestedModel: OPUS_1M }),
    )
    const views = [
      buildContextView(sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: OPUS_1M })),
      buildContextView(sub({ ledger: agentLedger(records), main: MAIN_READING, mainRequestedModel: 'claude-sonnet-5-5' })),
      buildContextView({ agentId: 'main', isMain: true, ledger: agentLedger(records, { agentId: 'main' }), compactions: [], main: MAIN_READING }),
    ]
    for (const view of views) {
      const lines = topTexts(panelOf(view, 60, ['ctx-ag1', 'ctx-main']))
      const metric = /\d[\d.,]*\s?[kM]\b|\d[\d.]*%/
      expect(lines.filter(l => metric.test(l) && !/[●≈∅]/.test(l) && !/^[▸▾]/.test(l.trim()))).toEqual([])
    }
  })

  test('a subagent with no window shows no capacity anywhere outside its basis', () => {
    const one = [usageRecord({ agentId: 'ag1', tokens: tokens(0, 84_000), requestedModel: UNKNOWN_MODEL })]
    const view = buildContextView(sub({ ledger: agentLedger(one), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    expect(panelText(view, 60)).not.toMatch(/of 1\.0M|1\.0M|of 200k/)
  })

  test('the window basis and the notes sit behind "why?", closed by default and reachable when opened', () => {
    const records = [0, 1].map(index => usageRecord({ agentId: 'ag1', index, tokens: tokens(0, 40_000), requestedModel: OPUS_1M }))
    const withoutUsage = usageRecord({ agentId: 'ag1', index: 2, tokens: null, requestedModel: OPUS_1M })
    const view = buildContextView(sub({ ledger: agentLedger([...records, withoutUsage]), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    const closed = panelText(view, 60)
    expect(closed).toContain(`▸ why? window basis · ${view.gaps.length} notes`)
    expect(view.gaps.length).toBe(3)
    expect(closed).not.toContain('autoCompactWindow')
    expect(closed).not.toContain('resolved without usage')
    const open = panelText(view, 60, ['ctx-ag1'])
    expect(open).toContain('▾ why? window basis')
    expect(open).toContain('autoCompactWindow')
    expect(open).toContain('resolved without usage')
    expect(open).toContain(SUBAGENT_WINDOW_GAP)
  })

  test('an unavailable % shows the observed prompt and says no exact percentage can be established', () => {
    const one = [usageRecord({ agentId: 'ag1', tokens: tokens(0, 84_000), requestedModel: UNKNOWN_MODEL })]
    const view = buildContextView(sub({ ledger: agentLedger(one), main: MAIN_READING, mainRequestedModel: OPUS_1M }))
    for (const width of [30, 60]) {
      const text = panelText(view, width)
      expect(text).toContain('latest prompt 84k')
      expect(text).toContain('no exact percentage can be established')
      expect(text).toContain(UNKNOWN_MODEL)
    }
  })

  test('the latest prompt is described as one request, never cumulative', () => {
    const view = buildContextView(sub({ ledger: agentLedger([usageRecord({ agentId: 'ag1' })]) }))
    expect(panelText(view, 40)).toContain('latest prompt 1.2k (one request, not cumulative)')
  })

  test('context stop signals are highlighted; refusal is listed as not context-related', () => {
    const records = [
      usageRecord({ agentId: 'ag1', index: 0, at: 1000, stopReason: 'max_tokens' }),
      usageRecord({ agentId: 'ag1', index: 1, at: 2000, stopReason: 'refusal' }),
    ]
    const drawn = textsOf(panelOf(buildContextView(sub({ ledger: agentLedger(records) })), 40))
    const maxTokens = drawn.find(t => t.text.includes('stop max_tokens ×'))
    const refusal = drawn.find(t => t.text.includes('stop refusal ×'))
    // The caution colour of the theme the drawing reads (a scene's own, or the classic key).
    expect(maxTokens?.color).toBe(ROLE.caution)
    expect(refusal?.color === ROLE.caution).toBe(false)
    expect(refusal?.text).toContain('not context-related')
  })

  test('a compaction is OBSERVED even when a token count is missing, and a lone after-count is shown', () => {
    const marks = [mark('ag1', 1, { tokensAfter: 12_000 })]
    const view = buildContextView(sub({ compactions: marks }))
    const drawn = textsOf(panelOf(view, 40))
    const line = drawn.find(t => t.text.includes('compacted ('))
    expect(line?.text).toContain('⇊ ● compacted (auto)')
    expect(line?.text).toContain('12k after')
    expect(line?.text).toContain('before not captured')
  })

  test('an exact peak is labelled exact; a retained-only peak says so', () => {
    const records = [0, 1, 2].map(index => usageRecord({ agentId: 'ag1', index, at: 1000 * (index + 1), tokens: tokens(0, 10_000 * (3 - index)) }))
    const exact: AgentLedger = { ...agentLedger(records, { historyCap: 2 }), peak: { promptTokens: 30_000, at: 1000, key: 'turn-ag1:0' } }
    expect(panelText(buildContextView(sub({ ledger: exact })), 40)).toContain('peak prompt 30k (exact')
    const retained = panelText(buildContextView(sub({ ledger: agentLedger(records, { historyCap: 2 }) })), 40)
    expect(retained).toContain('peak prompt 20k (retained requests only')
  })

  test('the sparkline says how many requests it draws out of how many reported usage', () => {
    const records = [0, 1, 2, 3].map(index => usageRecord({ agentId: 'ag1', index, at: 1000 * (index + 1), tokens: tokens(0, 10_000 * (index + 1)) }))
    const bounded = agentLedger(records, { historyCap: 3 })
    const panel = ContextPanel(stubContext(60), buildContextView(sub({ ledger: bounded })), { requestsWithUsage: 4 })
    expect(textOf(panel)).toMatch(/[▁-█]{3} ● last 3 of 4 requests/)
  })
})

// ── chart markers: only what was captured, by sample index ──

describe('contextMarkers', () => {
  const OPUS = 'claude-opus-5-5'
  const records = [0, 1, 2, 3].map(index =>
    usageRecord({ agentId: 'ag1', index, at: 10_000 + index * 1000, tokens: tokens(0, 20_000 + index), requestedModel: OPUS, stopReason: index === 2 ? 'max_tokens' : 'tool_use' }),
  )
  const snapshotWith = (ledger: AgentLedger) => ({ ledger: { agents: { ag1: ledger } } }) as unknown as Snapshot

  test('a captured compaction marks the first request after it; a context stop marks its own request', () => {
    const ledger = agentLedger(records)
    const view = buildContextView(sub({ ledger, compactions: [{ ...mark('ag1', 1), at: 11_500 }] }))
    expect(contextMarkers(snapshotWith(ledger), view)).toEqual([
      { index: 2, kind: 'compaction' },
      { index: 2, kind: 'stop' },
    ])
  })

  test('refusal, ordinary stops and a compaction outside the plotted requests are not marked', () => {
    const plain = records.map((r, i) => (i === 2 ? { ...r, stopReason: 'refusal' } : r))
    const ledger = agentLedger(plain)
    const early = { ...mark('ag1', 1), at: 5_000 }
    const late = { ...mark('ag1', 2), at: 99_000 }
    const view = buildContextView(sub({ ledger, compactions: [early, late] }))
    expect(contextMarkers(snapshotWith(ledger), view)).toEqual([])
  })

  test('no ledger, or samples that do not line up with it, give no markers', () => {
    const ledger = agentLedger(records)
    const view = buildContextView(sub({ ledger }))
    expect(contextMarkers(undefined, view)).toEqual([])
    expect(contextMarkers({} as Snapshot, view)).toEqual([])
    expect(contextMarkers(snapshotWith(agentLedger(records.slice(1))), view)).toEqual([])
  })
})
