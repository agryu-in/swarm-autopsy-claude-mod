// Token ledger tests: SIMULATED `turn.step` records and `turn.complete` reports
// in, ledger state and view out. Nothing here touches a live session, and no
// figure below is a real charge.

import { describe, expect, test } from 'claude-code/testing'

import {
  HISTORY_CAP,
  SEEN_CAP,
  TURNS_CAP,
  applyTurnReport,
  applyUsage,
  buildLedgerView,
  emptyLedger,
  usageRecordFrom,
} from '../hooks/lib/ledger'
import { PRICE_TABLE, estimateCost, formatUsd, parsePriceTable, priceFor, type PriceTable } from '../hooks/lib/pricing'
import { reduce, type Observation } from '../hooks/lib/reduce'
import type { ViewContext } from '../hooks/ui/common'
import { layoutFor } from '../hooks/ui/kit'
import { LedgerPanel, tokenSummary } from '../hooks/ui/ledger'
import type { LedgerState, LedgerView, Snapshot, TokenCounts, UsageRecord } from '../types'
import { build, spawn, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { NOOP_ACTIONS, logicalLines, type DrawnNode } from './view-helpers'

const fold = (records: readonly UsageRecord[], from: LedgerState = emptyLedger()): LedgerState => records.reduce(applyUsage, from)

const step = (record: UsageRecord): Observation => ({ kind: 'step', record })

const turnEndWithUsage = (agentId: string | undefined, turnId: string, usage: TokenCounts | undefined): Observation => ({
  kind: 'turn-end',
  at: 2_000_000,
  turnId,
  agentId,
  reason: 'answer',
  answer: '',
  durationMs: 10,
  usage: usage ? { ...usage, model: 'claude-opus-5-5' } : undefined,
})

const close = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected) < 1e-9).toBe(true)
}

const rowIds = (view: LedgerView): string[] => view.rows.map(r => r.agentId)

/** A table's own entry only: never one inherited from Object.prototype. */
const ownValue = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined

/** main → a → b, and main → c; each agent's requests on their own turns. */
function treeSession(): Snapshot {
  return build(
    spawn('a'),
    spawn('b', { parent: 'a' }),
    spawn('c'),
    step(usageRecord({ turnId: 'm1', index: 0, tokens: tokens(10, 100, 20, 5) })),
    step(usageRecord({ agentId: 'a', turnId: 'a1', index: 0, tokens: tokens(1, 2, 3, 4) })),
    step(usageRecord({ agentId: 'a', turnId: 'a1', index: 1, tokens: tokens(5, 6, 7, 8) })),
    step(usageRecord({ agentId: 'b', turnId: 'b1', index: 0, tokens: tokens(100, 200, 300, 400) })),
    step(usageRecord({ agentId: 'c', turnId: 'c1', index: 0, tokens: tokens(1000, 0, 0, 1) })),
  )
}

describe('usageRecordFrom', () => {
  test('a step without agentId goes to the main loop; null usage leaves tokens absent', () => {
    const record = usageRecordFrom({ turnId: 't1', index: 2, model: 'claude-opus-5-5[1m]' }, { stopReason: null, usage: null }, 5)
    expect(record.key).toBe('t1:2')
    expect(record.agentId).toBe('main')
    expect(record.attribution).toBe('main-loop')
    expect(record.requestedModel).toBe('claude-opus-5-5[1m]')
    expect(record.tokens).toBeUndefined()
    expect(record.model).toBeUndefined()
  })

  test('a step with agentId keeps it and maps the four counts apart', () => {
    const record = usageRecordFrom(
      { turnId: 't9', index: 0, model: 'claude-sonnet-5-5', agentId: 'ag1' },
      {
        stopReason: 'end_turn',
        usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 4, model: 'claude-sonnet-5-5' },
      },
      7,
    )
    expect(record.attribution).toBe('agentId')
    expect(record.agentId).toBe('ag1')
    expect(record.tokens).toEqual({ input: 1, cacheRead: 2, cacheWrite: 3, output: 4 })
  })

  test('a count that is missing, negative or not a number reads as zero and never poisons the sums', () => {
    const malformed = {
      input_tokens: Number.NaN,
      output_tokens: -5,
      cache_read_input_tokens: undefined as unknown as number,
      cache_creation_input_tokens: 7,
      model: 'claude-opus-5-5',
    }
    const record = usageRecordFrom({ turnId: 't', index: 0, model: 'claude-opus-5-5' }, { stopReason: 'end_turn', usage: malformed }, 1)
    expect(record.tokens).toEqual({ input: 0, cacheRead: 0, cacheWrite: 7, output: 0 })
    const infinite = usageRecordFrom(
      { turnId: 't', index: 1, model: 'claude-opus-5-5' },
      { stopReason: 'end_turn', usage: { ...malformed, input_tokens: Number.POSITIVE_INFINITY, cache_creation_input_tokens: 1 } },
      2,
    )
    const ledger = fold([record, infinite, usageRecord({ turnId: 't', index: 2, tokens: tokens(1, 1, 1, 1) })])
    expect(ledger.agents.main?.tokens).toEqual(tokens(1, 1, 9, 1))
  })
})

describe('applyUsage', () => {
  test('the same key twice is counted once and its tokens set aside', () => {
    const record = usageRecord({ agentId: 'a', turnId: 't1', index: 0, tokens: tokens(10, 20, 30, 40) })
    const ledger = fold([record, record])
    expect(ledger.agents.a?.requests).toBe(1)
    expect(ledger.agents.a?.tokens).toEqual(tokens(10, 20, 30, 40))
    expect(ledger.duplicates).toBe(1)
    expect(ledger.duplicateTokens).toEqual(tokens(10, 20, 30, 40))
    expect(ledger.turns.t1?.steps).toBe(1)
    expect(ledger.seen).toEqual(['t1:0'])
  })

  test('several requests sum exactly, per category and per model, with stop reasons', () => {
    const ledger = fold([
      usageRecord({ agentId: 'a', turnId: 't1', index: 0, at: 10, tokens: tokens(1, 2, 3, 4), stopReason: 'tool_use' }),
      usageRecord({ agentId: 'a', turnId: 't1', index: 1, at: 20, tokens: tokens(10, 20, 30, 40), model: 'claude-haiku-5-5', stopReason: 'end_turn' }),
      usageRecord({ agentId: 'a', turnId: 't2', index: 0, at: 30, tokens: null, stopReason: null }),
    ])
    const a = ledger.agents.a
    expect(a?.requests).toBe(2)
    expect(a?.requestsWithoutUsage).toBe(1)
    expect(a?.tokens).toEqual({ input: 11, cacheRead: 22, cacheWrite: 33, output: 44 })
    expect(Object.keys(a?.byModel ?? {}).sort()).toEqual(['claude-haiku-5-5', 'claude-opus-5-5'])
    expect(a?.byModel['claude-haiku-5-5']?.tokens).toEqual(tokens(10, 20, 30, 40))
    expect(a?.byModel['claude-opus-5-5']?.requests).toBe(1)
    expect(a?.stopReasons).toEqual({ tool_use: 1, end_turn: 1, none: 1 })
    expect(a?.firstAt).toBe(10)
    expect(a?.lastAt).toBe(30)
    expect(a?.latest?.key).toBe('t2:0')
    expect(a?.attribution).toBe('agentId')
  })

  test('byModel falls back to the requested model when the answer named none', () => {
    const record = { ...usageRecord({ agentId: 'a', requestedModel: 'claude-sonnet-5-5' }), model: undefined }
    expect(Object.keys(fold([record]).agents.a?.byModel ?? {})).toEqual(['claude-sonnet-5-5'])
  })

  test('the large tally holds only requests whose prompt exceeds 100K tokens', () => {
    const ledger = fold([
      usageRecord({ turnId: 't1', index: 0, tokens: tokens(50_000, 40_000, 10_000, 9) }),
      usageRecord({ turnId: 't1', index: 1, tokens: tokens(50_000, 40_000, 10_001, 7) }),
    ])
    const tally = ledger.agents.main?.byModel['claude-opus-5-5']
    expect(tally?.requests).toBe(2)
    expect(tally?.largeRequests).toBe(1)
    expect(tally?.largeTokens).toEqual(tokens(50_000, 40_000, 10_001, 7))
  })

  test('history keeps the newest requests by time then index; sums stay exact past the bound', () => {
    const records = Array.from({ length: HISTORY_CAP + 5 }, (_, i) =>
      usageRecord({ agentId: 'a', turnId: `t${Math.floor(i / 2)}`, index: i % 2, at: 1000 + Math.floor(i / 2), tokens: tokens(1, 0, 0, 1) }),
    )
    const ledger = fold([...records].reverse())
    const a = ledger.agents.a
    expect(a?.history).toHaveLength(HISTORY_CAP)
    expect(a?.historyDropped).toBe(5)
    expect(a?.requests).toBe(HISTORY_CAP + 5)
    expect(a?.history.map(r => r.key)).toEqual(records.slice(5).map(r => r.key))
    expect(a?.latest?.key).toBe(records[records.length - 1]?.key)
  })

  test('late and out-of-order records give identical sums, history and view', () => {
    const records = [
      usageRecord({ agentId: 'a', turnId: 't1', index: 0, at: 10, tokens: tokens(1, 2, 3, 4) }),
      usageRecord({ agentId: 'a', turnId: 't1', index: 1, at: 20, tokens: tokens(5, 6, 7, 8), model: 'claude-sonnet-5-5' }),
      usageRecord({ agentId: 'b', turnId: 't2', index: 0, at: 15, tokens: null }),
      usageRecord({ turnId: 'm1', index: 0, at: 5, tokens: tokens(100, 0, 0, 1), stopReason: 'end_turn' }),
      usageRecord({ turnId: 'm1', index: 1, at: 25, tokens: tokens(200_000, 1, 1, 1) }),
    ]
    const withDuplicate = [...records, records[1] as UsageRecord]
    const orders = [withDuplicate, [...withDuplicate].reverse(), [3, 5, 0, 4, 2, 1].map(i => withDuplicate[i] as UsageRecord)]
    const ledgers = orders.map(order => fold(order))
    const snapshot = build(spawn('a'), spawn('b'))
    const views = ledgers.map(ledger => buildLedgerView(ledger, snapshot, { showCost: true }))
    for (const ledger of ledgers.slice(1)) {
      expect(ledger.agents).toEqual(ledgers[0]?.agents)
      expect(ledger.turns).toEqual(ledgers[0]?.turns)
      expect(ledger.duplicates).toBe(1)
      expect(ledger.duplicateTokens).toEqual(ledgers[0]?.duplicateTokens)
    }
    for (const view of views.slice(1)) expect(view).toEqual(views[0])
  })

  test('the dedupe window is bounded to the most recent keys', () => {
    const records = Array.from({ length: SEEN_CAP + 1 }, (_, i) => usageRecord({ turnId: `t${Math.floor(i / 10)}`, index: i % 10, tokens: tokens(1, 0, 0, 0) }))
    const ledger = fold(records)
    expect(ledger.seen).toHaveLength(SEEN_CAP)
    expect(ledger.seen.includes('t0:0')).toBe(false)
    expect(ledger.agents.main?.requests).toBe(SEEN_CAP + 1)
    const notes = buildLedgerView(ledger, build(), { showCost: false }).notes
    expect(notes).toContain(`Duplicate detection covers the most recent ${SEEN_CAP} requests.`)
    expect(buildLedgerView(fold(records.slice(0, 3)), build(), { showCost: false }).notes.some(n => n.includes('Duplicate detection'))).toBe(false)
  })

  test('turns are bounded, oldest dropped first', () => {
    const records = Array.from({ length: TURNS_CAP + 1 }, (_, i) => usageRecord({ turnId: `t${i}`, at: i }))
    const ledger = fold(records)
    expect(ledger.turnOrder).toHaveLength(TURNS_CAP)
    expect(ledger.turnsDropped).toBe(1)
    expect(ledger.turns.t0).toBeUndefined()
    expect(ledger.turnOrder[0]).toBe('t1')
  })

  test('the bounds are the ones the ledger documents', () => {
    expect(SEEN_CAP).toBe(500)
    expect(HISTORY_CAP).toBe(40)
    expect(TURNS_CAP).toBe(400)
  })

  test('a turn still receiving steps outlives idle turns in the reconciliation window', () => {
    const idle = Array.from({ length: TURNS_CAP - 1 }, (_, i) => usageRecord({ turnId: `idle${i}`, at: 1 + i }))
    const ledger = fold([
      usageRecord({ turnId: 'live', index: 0, at: 0 }),
      ...idle,
      usageRecord({ turnId: 'live', index: 1, at: 1000 }),
      usageRecord({ turnId: 'newest', at: 1001 }),
    ])
    expect(ledger.turns.live?.steps).toBe(2)
    expect(ledger.turns.idle0).toBeUndefined()
    expect(ledger.turnOrder).toHaveLength(TURNS_CAP)
    expect(ledger.turnOrder[TURNS_CAP - 1]).toBe('newest')
    expect(ledger.turnsDropped).toBe(1)
  })

  test('a duplicate changes nothing but the duplicate tallies, whatever it carries', () => {
    const first = usageRecord({ agentId: 'a', turnId: 't1', index: 0, at: 10, tokens: tokens(1, 2, 3, 4), stopReason: 'tool_use' })
    const resent: UsageRecord = { ...first, at: 99, tokens: tokens(500_000, 0, 0, 9), stopReason: 'end_turn' }
    const once = fold([first])
    const twice = fold([first, resent])
    expect(twice.agents).toEqual(once.agents)
    expect(twice.turns).toEqual(once.turns)
    expect(twice.seen).toEqual(once.seen)
    expect(twice.duplicates).toBe(1)
    expect(twice.duplicateTokens).toEqual(tokens(500_000, 0, 0, 9))
  })

  test('peak is the largest single prompt over every counted request: exact past the history bound, order-independent, earlier on a tie', () => {
    const records = [
      usageRecord({ agentId: 'a', turnId: 'p0', index: 0, at: 10, tokens: tokens(90_000, 50_000, 10_000, 1) }),
      usageRecord({ agentId: 'a', turnId: 'p1', index: 0, at: 50, tokens: tokens(100_000, 40_000, 10_000, 9) }),
      usageRecord({ agentId: 'a', turnId: 'n0', index: 0, at: 5, tokens: null }),
      ...Array.from({ length: HISTORY_CAP + 3 }, (_, i) => usageRecord({ agentId: 'a', turnId: `f${i}`, at: 100 + i, tokens: tokens(5, 5, 5, 999_999) })),
    ]
    for (const order of [records, [...records].reverse(), [...records.slice(3), records[1] as UsageRecord, records[0] as UsageRecord]]) {
      const a = fold(order).agents.a
      expect(a?.peak).toEqual({ promptTokens: 150_000, at: 10, key: 'p0:0' })
      expect(a?.history.some(r => r.key === 'p0:0')).toBe(false)
    }
  })

  test('an agent whose requests all came back without usage has no peak', () => {
    const ledger = fold([usageRecord({ agentId: 'a', turnId: 'x', tokens: null })])
    expect(ledger.agents.a?.requestsWithoutUsage).toBe(1)
    expect(ledger.agents.a?.peak).toBeUndefined()
  })

  test('a response that names no model is tallied under the requested model, else under "unknown model"', () => {
    const blankAnswer: UsageRecord = { ...usageRecord({ turnId: 'b', requestedModel: 'claude-sonnet-5-5' }), model: '' }
    const nothingNamed: UsageRecord = { ...usageRecord({ turnId: 'c' }), model: '', requestedModel: '' }
    const ledger = fold([blankAnswer, nothingNamed])
    expect(Object.keys(ledger.agents.main?.byModel ?? {}).sort()).toEqual(['claude-sonnet-5-5', 'unknown model'])
    const cost = buildLedgerView(ledger, build(), { showCost: true }).session.cost
    expect(cost?.unpricedModels).toEqual(['unknown model'])
    expect(cost?.complete).toBe(false)
  })

  test('ids named like Object.prototype members stay ordinary keys', () => {
    const ledger = fold([
      usageRecord({ agentId: 'constructor', turnId: 'toString', at: 1, model: 'hasOwnProperty', tokens: tokens(1, 0, 0, 1), stopReason: 'valueOf' }),
      usageRecord({ agentId: '__proto__', turnId: '__proto__', at: 2, tokens: tokens(2, 0, 0, 2) }),
    ])
    const ctor = ownValue(ledger.agents, 'constructor')
    expect(ctor?.requests).toBe(1)
    expect(ownValue(ctor?.byModel ?? {}, 'hasOwnProperty')?.requests).toBe(1)
    expect(ownValue(ctor?.stopReasons ?? {}, 'valueOf')).toBe(1)
    expect(ownValue(ledger.agents, '__proto__')?.tokens).toEqual(tokens(2, 0, 0, 2))
    expect(ownValue(ledger.turns, 'toString')?.steps).toBe(1)
    expect(ownValue(ledger.turns, '__proto__')?.steps).toBe(1)
    const view = buildLedgerView(ledger, build(), { showCost: false })
    expect(rowIds(view)).toEqual(['main', 'constructor', '__proto__'])
    expect(view.rows.slice(1).map(r => r.attribution.evidence)).toEqual(['UNRESOLVED', 'UNRESOLVED'])
    expect(view.session.tokens).toEqual(tokens(3, 0, 0, 3))
  })
})

describe('applyTurnReport', () => {
  test("turn.complete's usage never changes any total", () => {
    const before = fold([usageRecord({ agentId: 'a', turnId: 't1', tokens: tokens(1, 2, 3, 4) })])
    const after = applyTurnReport(before, { turnId: 't1', agentId: 'a', at: 9, tokens: tokens(1, 2, 3, 4), model: 'claude-opus-5-5' })
    expect(after.agents).toBe(before.agents)
    expect(after.turns.t1?.reported).toEqual(tokens(1, 2, 3, 4))
    expect(after.turns.t1?.reportedAt).toBe(9)
  })

  test('a step arriving after its turn was reported still adds to the step tokens', () => {
    const reported = applyTurnReport(emptyLedger(), { turnId: 't1', agentId: 'a', at: 9, tokens: tokens(2, 0, 0, 2) })
    const ledger = fold([usageRecord({ agentId: 'a', turnId: 't1', index: 0, tokens: tokens(2, 0, 0, 2) })], reported)
    expect(ledger.turns.t1?.steps).toBe(1)
    expect(ledger.turns.t1?.stepTokens).toEqual(tokens(2, 0, 0, 2))
    expect(ledger.agents.a?.requests).toBe(1)
  })

  test('a report without usage records only when it arrived', () => {
    const ledger = applyTurnReport(emptyLedger(), { turnId: 't1', agentId: 'a', at: 9 })
    expect(ledger.turns.t1?.reported).toBeUndefined()
    expect(ledger.turns.t1?.reportedAt).toBe(9)
    expect(ledger.agents).toEqual({})
  })
})

describe('buildLedgerView', () => {
  test('rows follow the spawn tree; subtree rolls up descendants; session is the sum of direct', () => {
    const snapshot = treeSession()
    const view = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
    expect(rowIds(view)).toEqual(['main', 'a', 'b', 'c'])
    expect(view.rows.map(r => r.depth)).toEqual([0, 1, 2, 1])
    const [main, a, b, c] = view.rows
    expect(a?.direct.tokens).toEqual(tokens(6, 8, 10, 12))
    expect(a?.subtree.tokens).toEqual(tokens(106, 208, 310, 412))
    expect(a?.subtree.agents).toBe(2)
    expect(b?.subtree.tokens).toEqual(b?.direct.tokens)
    expect(main?.subtree.agents).toBe(4)
    expect(main?.subtree.tokens).toEqual(tokens(1116, 308, 330, 418))
    expect(view.session.tokens).toEqual(tokens(1116, 308, 330, 418))
    expect(view.session.requests).toBe(5)
    const directProcessed = view.rows.reduce((sum, r) => sum + r.direct.processed, 0)
    expect(view.session.processed).toBe(directProcessed)
    expect(c?.attribution.evidence).toBe('OBSERVED')
    expect(main?.attribution.basis).toContain('no agentId')
  })

  test('an agent with no usage still gets a row, with zero totals', () => {
    const snapshot = build(spawn('idle'))
    const view = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
    const idle = view.rows.find(r => r.agentId === 'idle')
    expect(idle?.direct.requests).toBe(0)
    expect(idle?.direct.processed).toBe(0)
    expect(idle?.attribution.evidence).toBe('UNAVAILABLE')
    expect(idle?.attribution.basis).toBe('no turn.step heard for this agent')
  })

  test('an agent id never seen as an agent keeps its own flagged row, never folded into main', () => {
    const snapshot = build(
      spawn('a'),
      turnStart('loose', 'l1'),
      step(usageRecord({ turnId: 'm1', tokens: tokens(1, 0, 0, 1) })),
      step(usageRecord({ agentId: 'fork-1', turnId: 'f1', tokens: tokens(50, 0, 0, 5) })),
    )
    const view = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
    expect(rowIds(view)).toEqual(['main', 'a', 'loose', 'fork-1'])
    const fork = view.rows[3]
    expect(fork?.depth).toBe(0)
    expect(fork?.parentId).toBeUndefined()
    expect(fork?.attribution.evidence).toBe('UNRESOLVED')
    expect(fork?.attribution.basis).toContain('never seen as an agent')
    expect(view.rows[0]?.direct.tokens).toEqual(tokens(1, 0, 0, 1))
    expect(view.rows[0]?.subtree.tokens).toEqual(tokens(1, 0, 0, 1))
    expect(view.session.tokens).toEqual(tokens(51, 0, 0, 6))
    expect(view.notes.some(n => n.includes('never seen as an agent'))).toBe(true)
  })

  test('a parent cycle neither loops nor drops an agent', () => {
    const base = build(spawn('a'), spawn('b', { parent: 'a' }), step(usageRecord({ agentId: 'b', turnId: 'b1' })))
    const a = base.agents.a
    if (!a) throw new Error('fixture lost agent a')
    const snapshot: Snapshot = { ...base, agents: { ...base.agents, a: { ...a, parentId: 'b' } } }
    const view = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
    expect([...rowIds(view)].sort()).toEqual(['a', 'b', 'main'])
    expect(view.rows[0]?.agentId).toBe('main')
    expect(view.rows[0]?.subtree.agents).toBe(1)
    expect(view.session.requests).toBe(1)
  })

  test('reconciliation counts matches, mismatches and turns reported with no step heard', () => {
    const snapshot = build(
      spawn('a'),
      step(usageRecord({ agentId: 'a', turnId: 'ok', tokens: tokens(1, 2, 3, 4) })),
      step(usageRecord({ agentId: 'a', turnId: 'off', tokens: tokens(1, 2, 3, 4) })),
      turnEndWithUsage('a', 'ok', tokens(1, 2, 3, 4)),
      turnEndWithUsage('a', 'off', tokens(9, 2, 3, 4)),
      turnEndWithUsage('a', 'ghost', tokens(5, 0, 0, 5)),
    )
    const view = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
    const a = view.rows.find(r => r.agentId === 'a')
    expect(a?.reconciliation.turnsCompared).toBe(2)
    expect(a?.reconciliation.mismatched).toBe(1)
    expect(a?.reconciliation.reportedOnly).toBe(1)
    expect(a?.reconciliation.note).toContain('1 of 2')
    expect(a?.direct.tokens).toEqual(tokens(2, 4, 6, 8))
    expect(view.notes.some(n => n.includes('differ'))).toBe(true)
  })

  test('once turns have aged out, a report with no step on record does not claim no step was heard', () => {
    const newer = Array.from({ length: TURNS_CAP }, (_, i) => usageRecord({ agentId: 'a', turnId: `n${i}`, at: 1 + i }))
    const stepped = fold([usageRecord({ agentId: 'a', turnId: 'old', at: 0, tokens: tokens(1, 0, 0, 1) }), ...newer])
    expect(stepped.turns.old).toBeUndefined()
    const ledger = applyTurnReport(stepped, { turnId: 'old', agentId: 'a', at: 9_999, tokens: tokens(1, 0, 0, 1) })
    const view = buildLedgerView(ledger, build(spawn('a')), { showCost: false })
    const row = view.rows.find(r => r.agentId === 'a')
    expect(row?.reconciliation.reportedOnly).toBe(1)
    expect(row?.reconciliation.note).toContain('aged out')
    expect(view.notes.some(n => n.includes('no turn.step on record') && n.includes('aged out'))).toBe(true)
    expect(view.notes.some(n => n.includes('no turn.step heard'))).toBe(false)
  })

  test('an unknown model keeps its tokens in every total, stays out of the ≈$ figure, and is named', () => {
    const snapshot = build(
      spawn('a'),
      step(usageRecord({ agentId: 'a', turnId: 'u', index: 0, tokens: tokens(1_000_000, 0, 0, 0) })),
      step(usageRecord({ agentId: 'a', turnId: 'u', index: 1, model: 'mystery-model', tokens: tokens(1_000_000, 0, 0, 0) })),
    )
    const view = buildLedgerView(snapshot.ledger, snapshot, { showCost: true })
    const a = view.rows.find(r => r.agentId === 'a')
    expect(view.session.tokens.input).toBe(2_000_000)
    expect(a?.direct.tokens.input).toBe(2_000_000)
    close(view.session.cost?.usd ?? -1, 4)
    expect(view.session.cost?.complete).toBe(false)
    expect(view.session.cost?.unpricedModels).toEqual(['mystery-model'])
    expect(a?.direct.cost?.complete).toBe(false)
    expect(a?.subtree.cost?.complete).toBe(false)
    expect(view.rows[0]?.subtree.cost?.unpricedModels).toEqual(['mystery-model'])
    expect(a?.byModel.find(m => m.model === 'mystery-model')?.cost?.complete).toBe(false)
    expect(view.notes.some(n => n.includes('No price for mystery-model'))).toBe(true)
  })

  test('with showCost false no cost field and no engine cost appear anywhere', () => {
    const snapshot = { ...treeSession(), engineCost: { usd: 3.5, at: 1 } }
    const view = buildLedgerView(snapshot.ledger, snapshot, { showCost: false, engineCostUsd: 4 })
    expect('cost' in view.session).toBe(false)
    expect('engineCost' in view).toBe(false)
    for (const row of view.rows) {
      expect('cost' in row.direct).toBe(false)
      expect('cost' in row.subtree).toBe(false)
      for (const entry of row.byModel) expect('cost' in entry).toBe(false)
    }
    expect(view.notes.some(n => n.includes('$'))).toBe(false)
  })

  test('with showCost true every total carries an estimate, and the engine figure stays apart', () => {
    const snapshot = { ...treeSession(), engineCost: { usd: 3.5, at: 1 } }
    const fromSnapshot = buildLedgerView(snapshot.ledger, snapshot, { showCost: true })
    expect(fromSnapshot.engineCost?.usd).toBe(3.5)
    expect(fromSnapshot.engineCost?.measure).toBe('OBSERVED')
    expect(fromSnapshot.engineCost?.source).toContain('session.measure')
    expect(buildLedgerView(snapshot.ledger, snapshot, { showCost: true, engineCostUsd: 4 }).engineCost?.usd).toBe(4)
    expect(fromSnapshot.session.cost?.measure).toBe('ESTIMATED')
    expect(fromSnapshot.session.cost?.priceDate).toBe('2026-10-06')
    const rowSum = fromSnapshot.rows.reduce((sum, r) => sum + (r.direct.cost?.usd ?? 0), 0)
    close(fromSnapshot.session.cost?.usd ?? -1, rowSum)
    const a = fromSnapshot.rows.find(r => r.agentId === 'a')
    close(a?.subtree.cost?.usd ?? -1, (a?.direct.cost?.usd ?? 0) + (fromSnapshot.rows.find(r => r.agentId === 'b')?.direct.cost?.usd ?? 0))
    expect(a?.byModel[0]?.cost?.measure).toBe('ESTIMATED')
    expect(fromSnapshot.notes.some(n => n.includes('different figure'))).toBe(true)
    expect(fromSnapshot.priceTable.date).toBe('2026-10-06')
  })

  test('byModel lists each model once, largest first', () => {
    const ledger = fold([
      usageRecord({ turnId: 't1', index: 0, tokens: tokens(1, 0, 0, 0), model: 'claude-haiku-5-5' }),
      usageRecord({ turnId: 't1', index: 1, tokens: tokens(100, 0, 0, 0) }),
    ])
    const view = buildLedgerView(ledger, build(), { showCost: false })
    expect(view.rows[0]?.models).toEqual(['claude-haiku-5-5', 'claude-opus-5-5'])
    expect(view.rows[0]?.byModel.map(m => m.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
  })

  test('notes name duplicates, requests without usage and when counting began', () => {
    const record = usageRecord({ turnId: 't1', tokens: tokens(10, 0, 0, 0) })
    const ledger = fold([record, record, usageRecord({ turnId: 't2', tokens: null })])
    const unknownStart = buildLedgerView(ledger, build(), { showCost: false })
    expect(unknownStart.notes.some(n => n.includes('1 request') && n.includes('set aside'))).toBe(true)
    expect(unknownStart.notes.some(n => n.includes('no usage'))).toBe(true)
    expect(unknownStart.notes.some(n => n.includes('unknown'))).toBe(true)
    expect(unknownStart.notes.some(n => n.includes('may miss'))).toBe(true)
    const late = { ...ledger, since: { at: 1_005_000, missedEarlier: true, basis: 'the mod loaded mid-session' } }
    const lateView = buildLedgerView(late, build(), { showCost: false })
    expect(lateView.notes.some(n => n.includes('the mod loaded mid-session') && n.includes('not recorded'))).toBe(true)
  })

  test('a user price table replaces the built-in one', () => {
    const table: PriceTable = {
      date: '2026-01-01',
      source: 'test table',
      assumptions: [],
      models: [{ model: 'claude-opus-5-5', inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1 }],
    }
    const ledger = fold([usageRecord({ tokens: tokens(1_000_000, 0, 0, 0) })])
    const view = buildLedgerView(ledger, build(), { showCost: true, prices: table })
    close(view.session.cost?.usd ?? -1, 1)
    expect(view.priceTable).toEqual({
      date: '2026-01-01',
      source: 'test table',
      assumptions: [],
      cacheWrites: 'Cache writes: the main loop at the 1-hour rate, subagents at the 5-minute rate (the hook does not report which; see the assumptions).',
    })
  })

  test('each row prices its cache writes by its loop, the subtree sums its members, and the view states the rule', () => {
    const snapshot = build(spawn('a'))
    const ledger = fold([
      usageRecord({ turnId: 'm', tokens: tokens(0, 0, 1_000_000, 0) }),
      usageRecord({ agentId: 'a', turnId: 'a', tokens: tokens(0, 0, 1_000_000, 0) }),
    ])
    const view = buildLedgerView(ledger, snapshot, { showCost: true })
    const row = (id: string) => view.rows.find(r => r.agentId === id)
    close(row('main')?.direct.cost?.usd ?? -1, 8)
    close(row('a')?.direct.cost?.usd ?? -1, 5)
    close(row('main')?.subtree.cost?.usd ?? -1, 13)
    close(view.session.cost?.usd ?? -1, 13)
    expect(view.priceTable.cacheWrites).toContain('main loop at the 1-hour rate')
    expect(view.priceTable.cacheWrites).toContain('subagents at the 5-minute rate')
  })

  test('an empty ledger gives a usable view', () => {
    const view = buildLedgerView(emptyLedger(), build(), { showCost: true })
    expect(rowIds(view)).toEqual(['main'])
    expect(view.session.processed).toBe(0)
    expect(view.session.cost?.usd).toBe(0)
    expect(view.session.cost?.complete).toBe(true)
  })

  test('the reducer feeds steps and turn reports through the same fold', () => {
    const snapshot = reduce(build(spawn('a')), step(usageRecord({ agentId: 'a', turnId: 'x' })))
    expect(snapshot.ledger.agents.a?.requests).toBe(1)
    expect(snapshot.instruments.step).toBe(1)
  })
})

describe('pricing', () => {
  test('the built-in table is dated, states its assumptions and prices cache writes at 1.25× input', () => {
    expect(PRICE_TABLE.date).toBe('2026-10-06')
    expect(PRICE_TABLE.assumptions).toHaveLength(4)
    expect(PRICE_TABLE.assumptions.some(a => a.includes('subscription'))).toBe(true)
    for (const price of PRICE_TABLE.models) close(price.cacheWritePerMTok, price.inputPerMTok * 1.25)
    expect(PRICE_TABLE.models.map(p => p.model)).toContain('claude-mythos-5')
    expect(priceFor(PRICE_TABLE, 'claude-mythos-5')?.cacheReadPerMTok).toBe(1)
    expect(priceFor(PRICE_TABLE, 'claude-haiku-5-5')?.large?.inputPerMTok).toBe(0.5)
  })

  test('cache writes are priced by loop: the main loop at the 1-hour rate, subagents at the 5-minute rate', () => {
    const writes = { 'claude-opus-5-5': { requests: 1, tokens: tokens(0, 0, 1_000_000, 0), largeRequests: 0, largeTokens: tokens(0) } }
    expect(PRICE_TABLE.cacheWriteTtl).toEqual({ mainLoop: '1h', subagents: '5m' })
    for (const price of PRICE_TABLE.models) close(price.cacheWrite1hPerMTok ?? -1, price.inputPerMTok * 2)
    close(estimateCost(PRICE_TABLE, writes, 'main-loop').usd, 8)
    close(estimateCost(PRICE_TABLE, writes, 'subagent').usd, 5)
    // A loop nobody named is priced at the lower, 5-minute rate.
    close(estimateCost(PRICE_TABLE, writes).usd, 5)
    expect(PRICE_TABLE.assumptions[0]).toContain('1-hour')
    expect(PRICE_TABLE.assumptions[0]).toContain('cacheWriteTtl')
  })

  // CAPTURED, not simulated: the per-agent token totals of a recorded live run (its export, matched against the
  // session's own transcripts). No request's prompt exceeded 100K, so no large tallies.
  test('the live run of 2026-10-17 prices to Claude Code’s own total for it', () => {
    const opus = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({
      'claude-opus-5-5': { requests: 1, tokens: tokens(input, cacheRead, cacheWrite, output), largeRequests: 0, largeTokens: tokens(0) },
    })
    const main = estimateCost(PRICE_TABLE, opus(22, 611_576, 66_440, 3_054), 'main-loop').usd
    const subagents = [
      opus(4, 32_819, 39_159, 703),
      opus(10, 271_188, 74_856, 2_098),
      opus(6, 140_831, 52_716, 1_663),
      opus(6, 129_946, 74_191, 862),
      opus(6, 144_528, 54_714, 608),
      opus(4, 75_493, 51_517, 446),
    ].map(tally => estimateCost(PRICE_TABLE, tally, 'subagent').usd)
    const total = main + subagents.reduce((sum, usd) => sum + usd, 0)
    // result.json total_cost_usd and session.measure cost.usd of that run: 2.7374732.
    expect(Math.abs(total - 2.7374732) < 1e-6).toBe(true)
    // The same totals through the ledger and the view the Spend tab draws (one record per agent carries its total).
    const totals: Array<[string | undefined, TokenCounts]> = [
      [undefined, tokens(22, 611_576, 66_440, 3_054)],
      ['A', tokens(4, 32_819, 39_159, 703)],
      ['B', tokens(10, 271_188, 74_856, 2_098)],
      ['C', tokens(6, 140_831, 52_716, 1_663)],
      ['D', tokens(6, 129_946, 74_191, 862)],
      ['E', tokens(6, 144_528, 54_714, 608)],
      ['F', tokens(4, 75_493, 51_517, 446)],
    ]
    const snapshot = build(spawn('A'), spawn('B'), spawn('C'), spawn('D', { parent: 'B' }), spawn('E'), spawn('F'))
    const ledger = fold(totals.map(([agentId, t]) => usageRecord({ ...(agentId ? { agentId } : {}), turnId: `t-${agentId ?? 'main'}`, tokens: t })))
    const view = buildLedgerView(ledger, { ...snapshot, engineCost: { usd: 2.7374732, at: 1 } }, { showCost: true })
    expect(Math.abs((view.session.cost?.usd ?? -1) - 2.7374732) < 1e-6).toBe(true)
  })

  test('ids match exactly, after a bracket suffix and a date suffix', () => {
    expect(priceFor(PRICE_TABLE, 'claude-opus-5-5[1m]')?.model).toBe('claude-opus-5-5')
    expect(priceFor(PRICE_TABLE, 'claude-haiku-4-5-20251001')?.model).toBe('claude-haiku-4-5')
    expect(priceFor(PRICE_TABLE, 'claude-haiku-4-5-20251001[1m]')?.model).toBe('claude-haiku-4-5')
    expect(priceFor(PRICE_TABLE, 'anthropic.claude-opus-5-5')).toBeUndefined()
    expect(priceFor(PRICE_TABLE, 'us.anthropic.claude-opus-5-5')).toBeUndefined()
    expect(priceFor(PRICE_TABLE, 'claude-opus-4-6@20250514')).toBeUndefined()
    expect(priceFor(PRICE_TABLE, 'claude-opus-5')?.model).toBe('claude-opus-5')
    expect(priceFor(PRICE_TABLE, 'claude-opus-5-55')).toBeUndefined()
    expect(priceFor(PRICE_TABLE, 'gpt-x')).toBeUndefined()
  })

  test('each category is priced at its own rate', () => {
    const ledger = fold([usageRecord({ tokens: tokens(1_000_000, 1_000_000, 1_000_000, 1_000_000) })])
    const cost = estimateCost(PRICE_TABLE, ledger.agents.main?.byModel ?? {})
    close(cost.usd, 4 + 0.2 + 5 + 20)
    expect(cost.complete).toBe(true)
    expect(cost.unpricedModels).toEqual([])
  })

  test('Haiku 5.5 prices requests over 100K prompt tokens at its large rates', () => {
    const ledger = fold([
      usageRecord({ turnId: 'h', index: 0, model: 'claude-haiku-5-5', tokens: tokens(50_000, 0, 0, 1_000) }),
      usageRecord({ turnId: 'h', index: 1, model: 'claude-haiku-5-5', tokens: tokens(200_000, 0, 0, 2_000) }),
    ])
    const cost = estimateCost(PRICE_TABLE, ledger.agents.main?.byModel ?? {})
    close(cost.usd, (50_000 * 0.1 + 1_000 * 0.5 + 200_000 * 0.5 + 2_000 * 2.5) / 1_000_000)
  })

  test('an unknown model stays unpriced and makes the estimate incomplete', () => {
    const ledger = fold([
      usageRecord({ turnId: 'u', index: 0, tokens: tokens(1_000_000, 0, 0, 0) }),
      usageRecord({ turnId: 'u', index: 1, model: 'us.anthropic.claude-opus-5-5-v1:0', tokens: tokens(1_000_000, 0, 0, 0) }),
    ])
    const cost = estimateCost(PRICE_TABLE, ledger.agents.main?.byModel ?? {})
    close(cost.usd, 4)
    expect(cost.complete).toBe(false)
    expect(cost.unpricedModels).toEqual(['us.anthropic.claude-opus-5-5-v1:0'])
    expect(cost.measure).toBe('ESTIMATED')
  })

  test('parsePriceTable accepts a well-formed table', () => {
    const raw = {
      date: '2026-11-01',
      source: 'my contract',
      assumptions: ['negotiated rates'],
      models: [
        { model: 'claude-opus-5-5', inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
        {
          model: 'claude-haiku-5-5',
          inputPerMTok: 0.1,
          outputPerMTok: 0.5,
          cacheReadPerMTok: 0.01,
          cacheWritePerMTok: 0.125,
          large: { inputPerMTok: 0.5, outputPerMTok: 2.5, cacheReadPerMTok: 0.05, cacheWritePerMTok: 0.625 },
          note: 'tiered',
        },
      ],
    }
    const parsed = parsePriceTable(raw)
    expect('table' in parsed).toBe(true)
    if ('table' in parsed) expect(parsed.table).toEqual(raw)
  })

  test('parsePriceTable reads a cache-write TTL rule and 1-hour rates, and prices by them', () => {
    const raw = {
      date: '2026-11-01',
      source: 'my contract',
      cacheWriteTtl: { mainLoop: '5m', subagents: '1h' },
      models: [{ model: 'claude-opus-5-5', inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, cacheWrite1hPerMTok: 9 }],
    }
    const parsed = parsePriceTable(raw)
    if (!('table' in parsed)) throw new Error(`refused: ${parsed.error}`)
    expect(parsed.table.cacheWriteTtl).toEqual({ mainLoop: '5m', subagents: '1h' })
    const writes = { 'claude-opus-5-5': { requests: 1, tokens: tokens(0, 0, 1_000_000, 0), largeRequests: 0, largeTokens: tokens(0) } }
    close(estimateCost(parsed.table, writes, 'main-loop').usd, 5)
    close(estimateCost(parsed.table, writes, 'subagent').usd, 9)
    const plain = parsePriceTable({ ...raw, cacheWriteTtl: undefined, models: [{ ...raw.models[0], cacheWrite1hPerMTok: undefined }] })
    if (!('table' in plain)) throw new Error(`refused: ${plain.error}`)
    // Left out, the rule is the built-in one and a 1-hour write costs 2× input.
    close(estimateCost(plain.table, writes, 'main-loop').usd, 8)
    close(estimateCost(plain.table, writes, 'subagent').usd, 5)
  })

  test('parsePriceTable rejects bad input with a plain message', () => {
    const good = { model: 'm', inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1 }
    const base = { date: '2026-11-01', source: 's', assumptions: [], models: [good] }
    const bad: unknown[] = [
      null,
      'prices',
      [],
      { ...base, date: undefined },
      { ...base, date: '1 Nov 2026' },
      { ...base, source: '' },
      { ...base, assumptions: [1] },
      { ...base, models: [] },
      { ...base, models: 'all' },
      { ...base, models: [{ ...good, inputPerMTok: -1 }] },
      { ...base, models: [{ ...good, outputPerMTok: Number.NaN }] },
      { ...base, models: [{ ...good, cacheReadPerMTok: Number.POSITIVE_INFINITY }] },
      { ...base, models: [{ ...good, cacheWritePerMTok: '1' }] },
      { ...base, models: [{ ...good, cacheWrite1hPerMTok: -2 }] },
      { ...base, cacheWriteTtl: 'always' },
      { ...base, cacheWriteTtl: { mainLoop: '2h', subagents: '5m' } },
      { ...base, cacheWriteTtl: { mainLoop: '1h' } },
      { ...base, models: [{ ...good, model: '' }] },
      { ...base, models: [good, good] },
      { ...base, models: [{ ...good, large: { inputPerMTok: 1 } }] },
      { ...base, models: [{ ...good, note: 3 }] },
    ]
    for (const input of bad) {
      const parsed = parsePriceTable(input)
      expect('error' in parsed).toBe(true)
      if ('error' in parsed) expect(parsed.error.length > 0).toBe(true)
    }
    const negative = parsePriceTable({ ...base, models: [{ ...good, inputPerMTok: -1 }] })
    if ('error' in negative) expect(negative.error).toContain('models[0].inputPerMTok')
  })

  test('the built-in table matches the published list prices cell by cell', () => {
    // [model, input, output, cache read] as the list prices give them, in the table's order.
    const contract: Array<[string, number, number, number]> = [
      ['claude-fable-5-1', 10, 50, 0.25],
      ['claude-mythos-5-1', 10, 50, 0.25],
      ['claude-fable-5', 10, 50, 1],
      ['claude-mythos-5', 10, 50, 1],
      ['claude-opus-5-5', 4, 20, 0.2],
      ['claude-opus-5', 5, 25, 0.5],
      ['claude-opus-4-8', 5, 25, 0.5],
      ['claude-opus-4-7', 5, 25, 0.5],
      ['claude-opus-4-6', 5, 25, 0.5],
      ['claude-sonnet-5-5', 2, 10, 0.2],
      ['claude-sonnet-5', 2, 10, 0.2],
      ['claude-sonnet-4-6', 3, 15, 0.3],
      ['claude-haiku-5-5', 0.1, 0.5, 0.01],
      ['claude-haiku-4-5', 1, 5, 0.1],
    ]
    expect(PRICE_TABLE.models.map(p => p.model)).toEqual(contract.map(([model]) => model))
    for (const [model, input, output, cacheRead] of contract) {
      const price = priceFor(PRICE_TABLE, model)
      expect(price?.inputPerMTok).toBe(input)
      expect(price?.outputPerMTok).toBe(output)
      expect(price?.cacheReadPerMTok).toBe(cacheRead)
      close(price?.cacheWritePerMTok ?? -1, input * 1.25)
      expect(price?.large === undefined).toBe(model !== 'claude-haiku-5-5')
    }
    const large = priceFor(PRICE_TABLE, 'claude-haiku-5-5')?.large
    expect([large?.inputPerMTok, large?.outputPerMTok, large?.cacheReadPerMTok]).toEqual([0.5, 2.5, 0.05])
    close(large?.cacheWritePerMTok ?? -1, 0.625)
    expect(PRICE_TABLE.source).toContain('Claude Code 2.1.299')
    expect(PRICE_TABLE.source).toContain('cached: 2026-10-06')
    const [ttl, speed, provider, subscription] = PRICE_TABLE.assumptions
    expect(ttl).toContain('1.25× input')
    expect(ttl).toContain('2× input')
    expect(ttl).toContain('main loop wrote 1-hour cache and subagents 5-minute')
    const hour = priceFor(PRICE_TABLE, 'claude-haiku-5-5')
    close(hour?.cacheWrite1hPerMTok ?? -1, 0.2)
    close(large?.cacheWrite1hPerMTok ?? -1, 1)
    expect(speed).toContain('$8/$40')
    expect(provider).toContain('provider prefix stay unpriced')
    expect(subscription).toContain('not what a Claude Max or Pro subscription charges')
  })

  test('parsePriceTable bounds every field of an untrusted table', () => {
    const good = { model: 'm', inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1 }
    const base = { date: '2026-11-01', source: 's', assumptions: [], models: [good] }
    const bad: Array<[string, unknown]> = [
      ['impossible date', { ...base, date: '2026-02-30' }],
      ['month 13', { ...base, date: '2026-13-01' }],
      ['long source', { ...base, source: 'x'.repeat(1_000) }],
      ['control characters in source', { ...base, source: 'prices\u001b[2J' }],
      ['too many assumptions', { ...base, assumptions: Array.from({ length: 50 }, () => 'a') }],
      ['long assumption', { ...base, assumptions: ['x'.repeat(2_000)] }],
      ['newline in an assumption', { ...base, assumptions: ['one\ntwo'] }],
      ['long model id', { ...base, models: [{ ...good, model: 'm'.repeat(500) }] }],
      ['model id with spaces', { ...base, models: [{ ...good, model: 'claude opus' }] }],
      ['too many models', { ...base, models: Array.from({ length: 1_000 }, (_, i) => ({ ...good, model: `m${i}` })) }],
      ['long note', { ...base, models: [{ ...good, note: 'x'.repeat(2_000) }] }],
      ['absurd rate', { ...base, models: [{ ...good, outputPerMTok: 1e12 }] }],
      ['absurd large rate', { ...base, models: [{ ...good, large: { ...good, model: undefined, inputPerMTok: 1e12 } }] }],
    ]
    for (const [what, input] of bad) {
      const parsed = parsePriceTable(input)
      expect(`${what}: ${'error' in parsed ? 'refused' : 'accepted'}`).toBe(`${what}: refused`)
    }
    expect('table' in parsePriceTable({ ...base, date: '2028-02-29', models: [{ ...good, model: 'claude-opus-5-5-20261001[1m]' }] })).toBe(true)
  })

  test('parsePriceTable returns fresh values: unknown keys dropped, the input never aliased, nothing polluted', () => {
    const raw = JSON.parse(
      '{"date":"2026-11-01","source":"s","assumptions":["a"],"extra":1,"__proto__":{"pollutedTop":true},' +
        '"models":[{"model":"m","inputPerMTok":1,"outputPerMTok":2,"cacheReadPerMTok":0.1,"cacheWritePerMTok":1.25,"x":2,"__proto__":{"polluted":true}}]}',
    ) as { assumptions: string[]; models: Array<Record<string, unknown>> }
    const parsed = parsePriceTable(raw)
    if (!('table' in parsed)) throw new Error(`refused: ${parsed.error}`)
    raw.assumptions.push('added later')
    raw.models.push({ model: 'late' })
    expect(parsed.table.assumptions).toEqual(['a'])
    expect(parsed.table.models).toHaveLength(1)
    expect(Object.keys(parsed.table)).toEqual(['date', 'source', 'assumptions', 'models'])
    expect(Object.keys(parsed.table.models[0] ?? {})).toEqual(['model', 'inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).pollutedTop).toBeUndefined()
  })

  test('formatUsd keeps small amounts readable', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(1.234)).toBe('$1.23')
    expect(formatUsd(1234.5)).toBe('$1235')
  })
})

// ── drawing: a fake element table, so the panel is read as logical lines and buttons ──
// (UI section: rows focus their agent pane-wide, details open under the row, the
// price assumptions and the less urgent notes sit behind disclosures. Text is read as logical lines, so a line's
// nested runs stay one string.)

type Drawn = { type: string; props: Record<string, unknown> }

function nodesOf(node: unknown): Drawn[] {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(nodesOf)
  const drawn = node as Drawn & { children?: unknown }
  return [drawn, ...nodesOf(drawn.props?.children), ...nodesOf(drawn.children)]
}

function drawPanel(snapshot: Snapshot, showCost: boolean, width: number, ui: { focus?: string; open?: string[] } = {}) {
  const calls: string[] = []
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const ctx = {
    els: { Box: element('Box'), Text: element('Text'), Button: element('Button') },
    surface: 'terminal',
    width,
    rows: 40,
    layout: layoutFor(width),
    now: 2_000_000,
    snapshot,
    ui: { view: 'spend', filter: 'all', page: 0, showCost, ...ui },
    act: {
      ...NOOP_ACTIONS,
      toggleCost: () => calls.push('toggle'),
      toggleFocus: (id: string) => calls.push(`focus ${id}`),
      toggleOpen: (id: string) => calls.push(`open ${id}`),
    },
  } as unknown as ViewContext
  const tree = LedgerPanel(ctx, buildLedgerView(snapshot.ledger, snapshot, { showCost }), showCost)
  const press = (key: string): void => {
    const button = nodesOf(tree).find(n => n.type === 'Button' && n.props.key === key)
    if (!button) throw new Error(`no button ${key}`)
    ;(button.props.onPress as () => void)()
  }
  return { text: logicalLines(tree as DrawnNode).join('\n'), calls, press }
}

describe('LedgerPanel', () => {
  test('draws session, tree and notes at narrow and wide widths, with no $ while cost is hidden', () => {
    const snapshot = { ...treeSession(), engineCost: { usd: 3.5, at: 1 } }
    for (const width of [30, 60, 116]) {
      const { text } = drawPanel(snapshot, false, width)
      expect(text).toContain('tokens processed')
      expect(text).toContain('sum of every row')
      expect(text).toContain('direct')
      expect(text).toContain('spawn tree (overlaps)')
      expect(text).toContain('show ≈$ estimates')
      expect(text).toMatch(/ledger notes?$/m)
      expect(text).not.toContain('$3.50')
      expect(text).not.toContain('2026-10-06')
    }
  })

  test('with cost shown: dated estimate, assumptions, the engine figure apart, never called a charge', () => {
    const snapshot = { ...treeSession(), engineCost: { usd: 3.5, at: 1 } }
    const closed = drawPanel(snapshot, true, 40).text
    expect(closed).toContain('API-equivalent at 2026-10-06 prices, not a charge')
    expect(closed).toContain("Claude Code's own session figure $3.50")
    expect(closed).toContain('hide ≈$ estimates')
    expect(closed).not.toContain('1.25× input')
    const { text } = drawPanel(snapshot, true, 40, { open: ['spend-prices'] })
    expect(text).toContain('Not a charge or a subscription cost')
    expect(text).toContain('1.25× input')
  })

  test('with cost shown, the estimate is compared with Claude Code’s own figure', () => {
    const fourDollars = build(step(usageRecord({ turnId: 'm', tokens: tokens(1_000_000, 0, 0, 0) })))
    const same = drawPanel({ ...fourDollars, engineCost: { usd: 4, at: 1 } }, true, 60).text
    expect(same).toContain('matches Claude Code’s own figure to the cent')
    const higher = drawPanel({ ...fourDollars, engineCost: { usd: 4.5, at: 1 } }, true, 60).text
    expect(higher).toContain('This estimate is below Claude Code’s own figure')
    expect(higher).not.toContain('$0.50')
    expect(higher).toContain('requests no hook sees')
    const hidden = drawPanel({ ...fourDollars, engineCost: { usd: 4.5, at: 1 } }, false, 60).text
    expect(hidden).not.toContain('below Claude Code')
  })

  test('the toggle and the rows act through ctx.act; a focused row shows its detail', () => {
    const snapshot = treeSession()
    const closed = drawPanel(snapshot, false, 50)
    closed.press('toggle-cost')
    closed.press('lg-a')
    expect(closed.calls).toEqual(['toggle', 'focus a'])
    expect(closed.text).not.toContain('turn.complete check')
    const open = drawPanel(snapshot, false, 50, { focus: 'a' })
    open.press('lg-a')
    expect(open.calls).toEqual(['focus a'])
    expect(open.text).toContain('turn.complete check')
    expect(open.text).toContain('last 2 of 2 requests')
    expect(open.text).toContain('■ in 6 · ■ cache read 8 · ■ cache write 10 · ■ out 12')
    expect(open.text).toContain('a1:1')
  })

  test('an estimate that leaves unpriced tokens out is marked + on every row, and the note says what + means', () => {
    const snapshot = build(
      spawn('a'),
      step(usageRecord({ agentId: 'a', turnId: 'u', index: 0, tokens: tokens(1_000_000, 0, 0, 0) })),
      step(usageRecord({ agentId: 'a', turnId: 'u', index: 1, model: 'mystery-model', tokens: tokens(1_000_000, 0, 0, 0) })),
    )
    const { text } = drawPanel(snapshot, true, 60, { open: ['spend-notes'] })
    // The session line, a's row and main's spawn-tree line all leave mystery-model out.
    expect(text.split('$4.00+').length - 1).toBe(3)
    expect(text).toContain('spawn tree (overlaps) ● 2.0M · 2 agents ≈$4.00+')
    expect(text).toMatch(/No price for mystery-model.*marked \+/)
  })

  test('a focused agent with nothing recorded draws its gap, not a crash', () => {
    const snapshot = build(spawn('idle'))
    const { text } = drawPanel(snapshot, true, 30, { focus: 'idle' })
    expect(text).toContain('no turn.step heard for this agent')
    expect(text).toContain('∅ usage unknown (no request heard)')
  })
})

describe('tokenSummary', () => {
  test('says so when nothing was recorded', () => {
    expect(tokenSummary(undefined, true)).toBe('tokens: no requests recorded yet')
  })

  test('totals with no request at all read as nothing recorded, and requests that all lacked usage as unknown, never as zero tokens observed', () => {
    const none = { requests: 0, requestsWithoutUsage: 0, tokens: tokens(0), processed: 0 }
    expect(tokenSummary(none, true)).toBe('tokens: no requests recorded yet')
    expect(tokenSummary({ ...none, requestsWithoutUsage: 2 }, false)).toBe('usage unknown (2 requests without usage)')
  })

  test('one short line that never carries ≈$ (callers draw it through CostText)', () => {
    const snapshot = build(step(usageRecord({ tokens: tokens(1_200_000, 980_000, 41_000, 12_000) })))
    const off = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
    const on = buildLedgerView(snapshot.ledger, snapshot, { showCost: true })
    expect(tokenSummary(off.session, false)).toBe('in 1.2M · cache 980k/41k · out 12k · 1 req')
    expect(tokenSummary(on.session, false)).not.toContain('$')
    expect(tokenSummary(on.session, true)).not.toContain('$')
  })
})
