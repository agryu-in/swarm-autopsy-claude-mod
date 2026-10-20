// The token ledger: `turn.step` results normalised into request records,
// folded into exact per-agent sums, and read back as a view with direct and
// subtree totals. Pure and immutable; no `$`.

import type {
  AgentLedger,
  AgentRecord,
  CostEstimate,
  Evidence,
  LedgerRow,
  LedgerState,
  LedgerTotals,
  LedgerView,
  ModelTally,
  Snapshot,
  TokenCounts,
  TurnTally,
  UsageRecord,
} from '../../types'
import { agentName, compact, offset, plural, shortId } from './format'
import { PRICE_TABLE, cacheWriteRule, estimateCost, formatUsd, type Loop, type PriceTable } from './pricing'
import { LARGE_PROMPT_TOKENS, ZERO_TOKENS, addTokens, processedOf, promptTokensOf, sameTokens, sumCosts } from './tokens'

/** The fields of `turn.step`'s input this ledger reads. */
export type StepInputLite = { turnId: string; index: number; model: string; agentId?: string }

/** The fields of `turn.step`'s result this ledger reads. */
export type StepResultLite = {
  stopReason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
    model: string
  } | null
}

/** What `turn.complete` said the turn cost: the engine's sum, for reconciliation only. */
export type TurnReport = { turnId: string; agentId: string; at: number; tokens?: TokenCounts; model?: string }

export type LedgerViewOptions = { showCost: boolean; engineCostUsd?: number; prices?: PriceTable }

/**
 * Request keys remembered for dedupe. A duplicate arises when a
 * hook re-sends a step (same `turnId:index`) right away, so 500 recent keys
 * cover it comfortably. The window is kept small because the snapshot is
 * written to `$.state` on every dirty tick (every 250 ms while busy): 500 keys
 * of ~45 bytes is ~22 KB a write, where 4000 would add ~180 KB. A duplicate
 * arriving after this many newer requests would be counted again; the view's
 * notes say so once the window is full.
 */
export const SEEN_CAP = 500
/** Requests kept per agent for the inspector and the context sparkline; the sums stay exact past it. */
export const HISTORY_CAP = 40
/** Turns kept for reconciliation, oldest dropped first; totals never depend on them. */
export const TURNS_CAP = 400

const MAIN = 'main'
const NO_STOP_REASON = 'none'
/** The byModel key for a request whose response and request both named no model. */
export const UNKNOWN_MODEL = 'unknown model'
const MAIN_BASIS = 'turn.step carried no agentId, which the API defines as the main loop'
const NO_USAGE_BASIS = 'no turn.step heard for this agent'
const ENGINE_COST_SOURCE = "session.measure cost.usd: Claude Code's own total over every priced response"

// ── records ──

/** A table's own entry only, so an id such as `constructor` never reads Object.prototype. */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

/** One reported count. The API reads a count a response left out as zero; anything not a finite, non-negative number reads the same, so it can never poison a sum. */
function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function usageRecordFrom(input: StepInputLite, result: StepResultLite, at: number): UsageRecord {
  const usage = result.usage
  return {
    key: `${input.turnId}:${input.index}`,
    source: 'turn.step',
    at,
    agentId: input.agentId ?? MAIN,
    attribution: input.agentId === undefined ? 'main-loop' : 'agentId',
    turnId: input.turnId,
    index: input.index,
    requestedModel: input.model,
    model: usage?.model,
    tokens: usage
      ? {
          input: countOf(usage.input_tokens),
          cacheRead: countOf(usage.cache_read_input_tokens),
          cacheWrite: countOf(usage.cache_creation_input_tokens),
          output: countOf(usage.output_tokens),
        }
      : undefined,
    stopReason: result.stopReason,
  }
}

/** Where a request is tallied: the model that answered, else the one requested, else UNKNOWN_MODEL (left unpriced). */
function modelKeyOf(record: UsageRecord): string {
  return record.model || record.requestedModel || UNKNOWN_MODEL
}

export function emptyLedger(): LedgerState {
  return {
    agents: {},
    seen: [],
    duplicates: 0,
    duplicateTokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    turns: {},
    turnOrder: [],
    turnsDropped: 0,
  }
}

/** One total order over records: time, then position in the turn, then key. */
function compareRecords(a: UsageRecord, b: UsageRecord): number {
  return a.at - b.at || a.index - b.index || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

// ── folding a request in ──

function newAgentLedger(record: UsageRecord): AgentLedger {
  return {
    agentId: record.agentId,
    attribution: record.attribution,
    requests: 0,
    requestsWithoutUsage: 0,
    tokens: ZERO_TOKENS,
    byModel: {},
    stopReasons: {},
    firstAt: record.at,
    lastAt: record.at,
    history: [],
    historyDropped: 0,
  }
}

function foldTally(tally: ModelTally | undefined, tokens: TokenCounts): ModelTally {
  const base = tally ?? { requests: 0, tokens: ZERO_TOKENS, largeRequests: 0, largeTokens: ZERO_TOKENS }
  const isLarge = promptTokensOf(tokens) > LARGE_PROMPT_TOKENS
  return {
    requests: base.requests + 1,
    tokens: addTokens(base.tokens, tokens),
    largeRequests: base.largeRequests + (isLarge ? 1 : 0),
    largeTokens: isLarge ? addTokens(base.largeTokens, tokens) : base.largeTokens,
  }
}

function countUsage(agent: AgentLedger, record: UsageRecord): AgentLedger {
  if (!record.tokens) return { ...agent, requestsWithoutUsage: agent.requestsWithoutUsage + 1 }
  const model = modelKeyOf(record)
  return {
    ...agent,
    requests: agent.requests + 1,
    tokens: addTokens(agent.tokens, record.tokens),
    byModel: { ...agent.byModel, [model]: foldTally(own(agent.byModel, model), record.tokens) },
  }
}

type Peak = NonNullable<AgentLedger['peak']>

/** The larger single-request prompt; on a tie the earlier `at` (then the smaller key), so arrival order never matters. */
function peakOf(current: Peak | undefined, record: UsageRecord): Peak | undefined {
  if (!record.tokens) return current
  const candidate: Peak = { promptTokens: promptTokensOf(record.tokens), at: record.at, key: record.key }
  if (!current || candidate.promptTokens > current.promptTokens) return candidate
  if (candidate.promptTokens < current.promptTokens) return current
  return candidate.at < current.at || (candidate.at === current.at && candidate.key < current.key) ? candidate : current
}

/** Keeps the newest HISTORY_CAP records in order; the same set whatever order they arrived in. */
function withHistory(agent: AgentLedger, record: UsageRecord): Pick<AgentLedger, 'history' | 'historyDropped'> {
  const merged = [...agent.history, record].sort(compareRecords)
  const excess = Math.max(0, merged.length - HISTORY_CAP)
  return { history: merged.slice(excess), historyDropped: agent.historyDropped + excess }
}

function foldRecord(agent: AgentLedger, record: UsageRecord): AgentLedger {
  const counted = countUsage(agent, record)
  const reason = record.stopReason ?? NO_STOP_REASON
  const peak = peakOf(agent.peak, record)
  return {
    ...counted,
    stopReasons: { ...agent.stopReasons, [reason]: (own(agent.stopReasons, reason) ?? 0) + 1 },
    firstAt: Math.min(agent.firstAt, record.at),
    lastAt: Math.max(agent.lastAt, record.at),
    latest: agent.latest && compareRecords(agent.latest, record) > 0 ? agent.latest : record,
    ...withHistory(agent, record),
    ...(peak ? { peak } : {}),
  }
}

/**
 * Updates one turn's tally, creating it when new. `turnOrder` runs from least
 * to most recently touched, so a long turn still receiving steps (a subagent's
 * whole run is one turn) is not dropped ahead of idle ones past TURNS_CAP.
 */
function withTurn(ledger: LedgerState, turnId: string, agentId: string, update: (tally: TurnTally) => TurnTally): LedgerState {
  const tally = update(own(ledger.turns, turnId) ?? { turnId, agentId, steps: 0, stepTokens: ZERO_TOKENS })
  const order = [...ledger.turnOrder.filter(id => id !== turnId), turnId]
  const excess = Math.max(0, order.length - TURNS_CAP)
  const evicted = new Set(order.slice(0, excess))
  const kept = excess > 0 ? Object.fromEntries(Object.entries(ledger.turns).filter(([id]) => !evicted.has(id))) : ledger.turns
  return { ...ledger, turns: { ...kept, [turnId]: tally }, turnOrder: order.slice(excess), turnsDropped: ledger.turnsDropped + excess }
}

/** Folds one request in. A key already counted only bumps `duplicates` and sets its tokens aside. */
export function applyUsage(ledger: LedgerState, record: UsageRecord): LedgerState {
  if (ledger.seen.includes(record.key)) {
    const setAside = ledger.duplicateTokens ?? ZERO_TOKENS
    return {
      ...ledger,
      duplicates: ledger.duplicates + 1,
      duplicateTokens: record.tokens ? addTokens(setAside, record.tokens) : setAside,
    }
  }
  const agent = foldRecord(own(ledger.agents, record.agentId) ?? newAgentLedger(record), record)
  const counted: LedgerState = {
    ...ledger,
    seen: [...ledger.seen, record.key].slice(-SEEN_CAP),
    agents: { ...ledger.agents, [record.agentId]: agent },
  }
  return withTurn(counted, record.turnId, record.agentId, tally => ({
    ...tally,
    steps: tally.steps + 1,
    stepTokens: record.tokens ? addTokens(tally.stepTokens, record.tokens) : tally.stepTokens,
  }))
}

/** Records the engine's turn total for reconciliation; never added to any total. */
export function applyTurnReport(ledger: LedgerState, report: TurnReport): LedgerState {
  return withTurn(ledger, report.turnId, report.agentId, tally => ({
    ...tally,
    reportedAt: report.at,
    ...(report.tokens ? { reported: report.tokens } : {}),
    ...(report.model ? { reportedModel: report.model } : {}),
  }))
}

// ── the view ──

type Placed = { id: string; depth: number; members: string[] }

/** The snapshot's record of an agent, own entries only. */
function agentRecord(snapshot: Snapshot, id: string): AgentRecord | undefined {
  return own(snapshot.agents, id)
}

/** The agent's parent when it names one the snapshot knows (and not itself). */
function knownParent(snapshot: Snapshot, id: string): string | undefined {
  const parent = agentRecord(snapshot, id)?.parentId
  return parent !== undefined && parent !== id && agentRecord(snapshot, parent) ? parent : undefined
}

/** Child ids per parent, in roster order; a parent that is unknown or the agent itself is no parent. */
function childrenOf(snapshot: Snapshot): Map<string, string[]> {
  const tree = new Map<string, string[]>()
  for (const id of snapshot.agentOrder) {
    const parent = knownParent(snapshot, id)
    if (parent !== undefined) tree.set(parent, [...(tree.get(parent) ?? []), id])
  }
  return tree
}

/** Depth-first from one root; each agent placed once, so a parent cycle cannot loop. */
function place(id: string, depth: number, tree: Map<string, string[]>, visited: Set<string>): Placed[] {
  visited.add(id)
  const below: Placed[][] = []
  for (const child of tree.get(id) ?? []) if (!visited.has(child)) below.push(place(child, depth + 1, tree, visited))
  const members = [id, ...below.flatMap(branch => branch[0]?.members ?? [])]
  return [{ id, depth, members }, ...below.flat()]
}

/** Main's tree, then known agents main's tree does not reach (no parent first, then cycles), then ledger ids no agent record names. */
function placeAll(ledger: LedgerState, snapshot: Snapshot): Placed[] {
  const tree = childrenOf(snapshot)
  const visited = new Set<string>()
  const known = snapshot.agentOrder.filter(id => agentRecord(snapshot, id) !== undefined)
  const fromMain = agentRecord(snapshot, MAIN) ? place(MAIN, 0, tree, visited) : []
  const orphans = known.filter(id => knownParent(snapshot, id) === undefined).flatMap(id => (visited.has(id) ? [] : place(id, 0, tree, visited)))
  const cycles = known.flatMap(id => (visited.has(id) ? [] : place(id, 0, tree, visited)))
  const unknown = Object.values(ledger.agents)
    .filter(agent => !agentRecord(snapshot, agent.agentId))
    .sort((a, b) => a.firstAt - b.firstAt || (a.agentId < b.agentId ? -1 : 1))
    .map(agent => ({ id: agent.agentId, depth: 0, members: [agent.agentId] }))
  return [...fromMain, ...orphans, ...cycles, ...unknown]
}

/** The loop an agent's requests ran in, for its cache-write TTL: the main loop's, or a subagent's. */
function loopOf(agent: AgentLedger | undefined): Loop {
  return agent?.attribution === 'main-loop' ? 'main-loop' : 'subagent'
}

function totalsOf(agent: AgentLedger | undefined, prices: PriceTable | undefined): LedgerTotals {
  const tokens = agent?.tokens ?? ZERO_TOKENS
  const totals = { requests: agent?.requests ?? 0, requestsWithoutUsage: agent?.requestsWithoutUsage ?? 0, tokens, processed: processedOf(tokens) }
  return prices ? { ...totals, cost: estimateCost(prices, agent?.byModel ?? {}, loopOf(agent)) } : totals
}

function sumTotals(list: readonly LedgerTotals[], prices: PriceTable | undefined): LedgerTotals {
  const tokens = list.reduce((sum, t) => addTokens(sum, t.tokens), ZERO_TOKENS)
  const totals = {
    requests: list.reduce((sum, t) => sum + t.requests, 0),
    requestsWithoutUsage: list.reduce((sum, t) => sum + t.requestsWithoutUsage, 0),
    tokens,
    processed: processedOf(tokens),
  }
  if (!prices) return totals
  const cost: CostEstimate = sumCosts(list.map(t => t.cost)) ?? estimateCost(prices, {})
  return { ...totals, cost }
}

function byModelOf(agent: AgentLedger | undefined, prices: PriceTable | undefined): LedgerRow['byModel'] {
  return Object.entries(agent?.byModel ?? {})
    .map(([model, tally]) => ({ model, tally, ...(prices ? { cost: estimateCost(prices, { [model]: tally }, loopOf(agent)) } : {}) }))
    .sort((a, b) => processedOf(b.tally.tokens) - processedOf(a.tally.tokens) || (a.model < b.model ? -1 : 1))
}

function attributionOf(id: string, record: AgentRecord | undefined, agent: AgentLedger | undefined): { evidence: Evidence; basis: string } {
  if (!record) {
    return {
      evidence: 'UNRESOLVED',
      basis: `agent id ${id} was never seen as an agent (an engine fork, a workflow agent, or a spawn the collector missed); its requests stay on their own row, not folded into main`,
    }
  }
  if (!agent || agent.requests + agent.requestsWithoutUsage === 0) return { evidence: 'UNAVAILABLE', basis: NO_USAGE_BASIS }
  if (record.isMain) return { evidence: 'OBSERVED', basis: MAIN_BASIS }
  return { evidence: 'OBSERVED', basis: `turn.step carried agentId ${id}, the id this agent is known by (from ${record.knownFrom})` }
}

/**
 * What a turn reported with no step on record means. With no turn ever
 * dropped, no step was heard; once turns have aged out of the window, its
 * steps may have been heard and dropped, and the ledger cannot tell which.
 */
function reportOnlyText(count: number, turnsDropped: number): string {
  const what = `${plural(count, 'turn')} reported by turn.complete with no turn.step on record`
  return turnsDropped > 0 ? `${what} (none heard, or its steps aged out of the reconciliation window)` : `${what} (none heard)`
}

function reconcile(turns: readonly TurnTally[], agentId: string, turnsDropped: number): LedgerRow['reconciliation'] {
  const mine = turns.filter(t => t.agentId === agentId)
  const compared = mine.filter(t => t.reported !== undefined && t.steps > 0)
  const mismatched = compared.filter(t => !sameTokens(t.stepTokens, t.reported ?? ZERO_TOKENS)).length
  const reportedOnly = mine.filter(t => t.reported !== undefined && t.steps === 0).length
  const parts = [
    compared.length === 0
      ? ''
      : mismatched === 0
        ? `all ${plural(compared.length, 'turn')} match turn.complete's own total`
        : `${mismatched} of ${plural(compared.length, 'turn')} differ from turn.complete's own total (a step heard before the mod loaded, a response another hook supplied, or a re-sent request can cause this)`,
    reportedOnly === 0 ? '' : reportOnlyText(reportedOnly, turnsDropped),
  ].filter(Boolean)
  return { turnsCompared: compared.length, mismatched, reportedOnly, ...(parts.length ? { note: `${parts.join('; ')}.` } : {}) }
}

function rowFor(placed: Placed, ledger: LedgerState, snapshot: Snapshot, direct: Map<string, LedgerTotals>, prices: PriceTable | undefined, turns: TurnTally[]): LedgerRow {
  const record = agentRecord(snapshot, placed.id)
  const agent = own(ledger.agents, placed.id)
  const directTotals = direct.get(placed.id) ?? totalsOf(undefined, prices)
  const subtree = sumTotals(placed.members.map(id => direct.get(id) ?? totalsOf(undefined, prices)), prices)
  return {
    agentId: placed.id,
    label: record ? agentName(record) : `? ${shortId(placed.id)}`,
    ...(record?.parentId !== undefined ? { parentId: record.parentId } : {}),
    depth: placed.depth,
    models: Object.keys(agent?.byModel ?? {}).sort(),
    byModel: byModelOf(agent, prices),
    direct: directTotals,
    subtree: { ...subtree, agents: placed.members.length },
    attribution: attributionOf(placed.id, record, agent),
    reconciliation: reconcile(turns, placed.id, ledger.turnsDropped),
  }
}

function coverageNote(ledger: LedgerState, snapshot: Snapshot): string {
  const since = ledger.since
  if (!since) return 'When token counting began is unknown, so requests made before the collector loaded may be missing.'
  const start = offset(snapshot.startedAt, since.at)
  return since.missedEarlier
    ? `Token counts start at ${start} (${since.basis}); requests before that were not recorded.`
    : `Token counts cover the session from ${start} (${since.basis}).`
}

function costNotes(view: Pick<LedgerView, 'session' | 'engineCost'>): string[] {
  const cost = view.session.cost
  if (!cost) return []
  return [
    'The ≈$ figures are API-equivalent estimates at list prices: not a charge, and not what a subscription costs.',
    ...(cost.complete
      ? []
      : [`No price for ${cost.unpricedModels.join(', ')}: those tokens are left out of the ≈$ estimate (figures marked + leave them out).`]),
    ...(view.engineCost
      ? [
          `Claude Code's own session figure (${formatUsd(view.engineCost.usd)}, OBSERVED) covers requests no hook sees and uses its own prices: a different figure from the ≈ estimate.`,
        ]
      : []),
  ]
}

function notesFor(ledger: LedgerState, snapshot: Snapshot, rows: readonly LedgerRow[], view: Pick<LedgerView, 'session' | 'engineCost'>): string[] {
  const unknown = rows.filter(r => r.attribution.evidence === 'UNRESOLVED').length
  const mismatched = rows.reduce((sum, r) => sum + r.reconciliation.mismatched, 0)
  const reportedOnly = rows.reduce((sum, r) => sum + r.reconciliation.reportedOnly, 0)
  const withoutUsage = view.session.requestsWithoutUsage
  const dup = ledger.duplicates
  return [
    coverageNote(ledger, snapshot),
    "Counts come from this mod's turn.step hook, which may miss the engine's own side requests (compaction summary, titles, memory) and the steps of an agent spawned inside a hook this one wraps.",
    dup > 0
      ? `${plural(dup, 'request')} arrived with a key already counted and ${dup === 1 ? 'was' : 'were'} set aside (${compact(processedOf(ledger.duplicateTokens ?? ZERO_TOKENS))} tokens). If a hook re-sent a request, those were real and the totals are low by that much; reconciliation would show it.`
      : '',
    withoutUsage > 0 ? `${plural(withoutUsage, 'request')} resolved with no usage (no response, interrupted, or none reported): counted apart, adding no tokens.` : '',
    unknown > 0 ? `${plural(unknown, 'agent id')} never seen as an agent ${unknown === 1 ? 'keeps its' : 'keep their'} own row, flagged UNRESOLVED, not folded into main.` : '',
    mismatched > 0 ? `${plural(mismatched, 'turn')} differ from turn.complete's own total; the ledger counts turn.step results only and never adds turn.complete's figure.` : '',
    reportedOnly > 0 ? `${reportOnlyText(reportedOnly, ledger.turnsDropped)}.` : '',
    ledger.turnsDropped > 0
      ? `Reconciliation keeps the ${TURNS_CAP} most recently active turns; ${plural(ledger.turnsDropped, 'other')} ${ledger.turnsDropped === 1 ? 'was' : 'were'} dropped from it (totals stay exact).`
      : '',
    ledger.seen.length >= SEEN_CAP ? `Duplicate detection covers the most recent ${SEEN_CAP} requests.` : '',
    ...costNotes(view),
  ].filter(Boolean)
}

/** Rows in spawn-tree order with direct and subtree totals; the session total is the sum of direct totals. */
export function buildLedgerView(ledger: LedgerState, snapshot: Snapshot, options: LedgerViewOptions): LedgerView {
  const table = options.prices ?? PRICE_TABLE
  const prices = options.showCost ? table : undefined
  const placed = placeAll(ledger, snapshot)
  const direct = new Map(placed.map(p => [p.id, totalsOf(own(ledger.agents, p.id), prices)] as const))
  const turns = Object.values(ledger.turns)
  const rows = placed.map(p => rowFor(p, ledger, snapshot, direct, prices, turns))
  const session = sumTotals(rows.map(r => r.direct), prices)
  const engineUsd = options.engineCostUsd ?? snapshot.engineCost?.usd
  const engineCost = options.showCost && engineUsd !== undefined ? { usd: engineUsd, measure: 'OBSERVED' as const, source: ENGINE_COST_SOURCE } : undefined
  return {
    rows,
    session,
    ...(engineCost ? { engineCost } : {}),
    priceTable: { date: table.date, source: table.source, assumptions: table.assumptions, cacheWrites: cacheWriteRule(table) },
    notes: notesFor(ledger, snapshot, rows, { session, engineCost }),
  }
}
