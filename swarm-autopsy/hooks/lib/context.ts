// The context gauge: per-agent context observation. Pure and
// immutable; no `$`, no model calls. Usage comes only from the agent's ledger
// (the token ledger's AgentLedger); a % appears only against an observed window (the main
// loop's session.measure) or under a stated same-model assumption.

import type { AgentContextView, AgentLedger, CompactionMark, Snapshot, TokenCounts, UsageRecord } from '../../types'
import { MEASURE_GLYPH, compact, plural, truncate } from './format'
import { CONTEXT_STOP_REASONS, promptTokensOf } from './tokens'

export type ContextInputs = {
  agentId: string
  isMain: boolean
  /** The token ledger's stored entry for this agent (history, latest, stopReasons). */
  ledger: AgentLedger | undefined
  /** This agent's compaction marks. */
  compactions: readonly CompactionMark[]
  /** snapshot.context: the main session's session.measure reading. */
  main?: { window: number; tokens?: number; percent?: number; at: number }
  /** The main loop's latest requestedModel. */
  mainRequestedModel?: string
  /**
   * The model of the main loop's newest request at or before `main.at`: the model the window was read for. When it
   * differs from `mainRequestedModel`, main has switched model since, and no window is known for the new one yet.
   */
  mainModelAtWindow?: string
}

/** Stop reasons shown as signals: the context-related ones plus refusal. */
export const SIGNAL_STOP_REASONS: readonly string[] = [...CONTEXT_STOP_REASONS, 'refusal']

export const SUBAGENT_WINDOW_GAP = "Claude Code does not expose a subagent's context window to mods."

const SPARK_BARS = '▁▂▃▄▅▆▇█'
const GAUGE_SPARK_MAX = 8
const ASSUMPTION = "assumes the main session's window for the same model"
const AUTO_COMPACT_NOTE = "an agent definition may lower a subagent's window (autoCompactWindow), which a mod cannot read"

/**
 * Documented context windows by model id (the user asked to see a subagent's context like the main loop's; Claude Code
 * never reports a subagent's window, so a subagent on another model is estimated against its model's documented window,
 * dated and sourced like the price table). Values are the cached reference's "Context" column.
 */
export const MODEL_WINDOWS: { date: string; source: string; windows: Readonly<Record<string, number>> } = {
  date: '2026-10-06',
  source: 'the Claude API reference bundled with Claude Code (claude-api skill, "Current Models (cached: 2026-10-06)")',
  windows: {
    'claude-fable-5-1': 1_000_000,
    'claude-mythos-5-1': 1_000_000,
    'claude-fable-5': 1_000_000,
    'claude-opus-5-5': 1_000_000,
    'claude-opus-5': 1_000_000,
    'claude-opus-4-8': 1_000_000,
    'claude-opus-4-7': 1_000_000,
    'claude-opus-4-6': 1_000_000,
    'claude-sonnet-5-5': 1_000_000,
    'claude-sonnet-5': 1_000_000,
    'claude-sonnet-4-6': 1_000_000,
    'claude-haiku-5-5': 1_000_000,
    'claude-haiku-4-5': 200_000,
  },
}

const ONE_MILLION_SUFFIX = /\[1m\]$/i

/**
 * A model's documented window: a `[1m]` variant is 1M; otherwise the table's entry for the id, a provider prefix such
 * as `anthropic.` or `us.anthropic.` set aside. Undefined for a model the table does not list.
 */
export function documentedWindow(model: string | undefined): number | undefined {
  if (model === undefined || model.trim() === '') return undefined
  const id = model.trim()
  if (ONE_MILLION_SUFFIX.test(id)) return 1_000_000
  const base = id.replace(/\[[^\]]*\]$/, '').replace(/^(?:[a-z]{2}\.)?anthropic\./, '')
  return Object.hasOwn(MODEL_WINDOWS.windows, base) ? MODEL_WINDOWS.windows[base] : undefined
}

type Priced = UsageRecord & { tokens: TokenCounts }
type Window = AgentContextView['window']
type Percent = AgentContextView['percent']
type Occupancy = { window: Window; percent: Percent; gap?: string }
type Latest = NonNullable<AgentContextView['latest']>

// ── records ──

function byTime(a: UsageRecord, b: UsageRecord): number {
  return a.at - b.at || a.index - b.index
}

function hasTokens(record: UsageRecord | undefined): record is Priced {
  return record !== undefined && record.tokens != null
}

/** The retained history oldest first, each request key once (a repeated key is the same request). */
function orderedHistory(ledger: AgentLedger | undefined): UsageRecord[] {
  const history = Array.isArray(ledger?.history) ? ledger.history : []
  return [...history].sort(byTime).filter((record, i, all) => all.findIndex(other => other.key === record.key) === i)
}

/** The newest record that reported usage: from the history, or the ledger's own latest when that is newer. */
function newestWithUsage(ledger: AgentLedger | undefined, ordered: readonly UsageRecord[]): Priced | undefined {
  const candidates = [...ordered.filter(hasTokens), ...(hasTokens(ledger?.latest) ? [ledger.latest] : [])]
  return [...candidates].sort(byTime).at(-1)
}

function newestOverall(ledger: AgentLedger | undefined, ordered: readonly UsageRecord[]): UsageRecord | undefined {
  const candidates = [...ordered, ...(ledger?.latest ? [ledger.latest] : [])]
  return [...candidates].sort(byTime).at(-1)
}

function latestOf(record: Priced): Latest {
  return {
    promptTokens: promptTokensOf(record.tokens),
    output: record.tokens.output,
    at: record.at,
    model: record.model,
    requestedModel: record.requestedModel,
    stopReason: record.stopReason,
  }
}

// ── window and % ──

/** A reading time for a basis sentence: the UTC clock time of `$.clock.now()` milliseconds. */
export function clockText(at: number): string {
  if (!Number.isFinite(at) || Math.abs(at) > 8.64e15) return `time ${at}`
  return `${new Date(at).toISOString().slice(11, 19)} UTC`
}

function unavailable(reason: string): Occupancy {
  return {
    window: { measure: 'UNAVAILABLE', basis: reason },
    percent: { measure: 'UNAVAILABLE', basis: `% unavailable: ${reason}` },
    gap: `Context % unavailable: ${reason}.`,
  }
}

/** The main reading's window when it is a usable size, else undefined. */
function usableWindow(main: ContextInputs['main']): number | undefined {
  return main !== undefined && Number.isFinite(main.window) && main.window > 0 ? main.window : undefined
}

function mainOccupancy(main: ContextInputs['main']): Occupancy {
  if (!main) return unavailable('no session.measure reading yet')
  const size = usableWindow(main)
  if (size === undefined) return unavailable(`session.measure reported no usable window at ${clockText(main.at)}`)
  const read = clockText(main.at)
  const window: Window = { tokens: size, at: main.at, measure: 'OBSERVED', basis: `session.measure, the main session's model window, read ${read}` }
  if (main.percent === undefined || !Number.isFinite(main.percent)) {
    const reason = `session.measure reported no fill at ${read} (a fresh or just-compacted window has none until its next response)`
    return { window, percent: { measure: 'UNAVAILABLE', basis: `% unavailable: ${reason}` }, gap: `Context % unavailable: ${reason}.` }
  }
  const percent: Percent = {
    value: main.percent,
    tokens: main.tokens,
    at: main.at,
    measure: 'OBSERVED',
    basis: `session.measure used percentage, read ${read}`,
  }
  return { window, percent }
}

function isBlank(model: string | undefined): boolean {
  return model === undefined || model.trim() === ''
}

/** Why a subagent's % cannot be estimated, or undefined when it can. */
function estimateBlocker(latest: Latest | undefined, input: ContextInputs): string | undefined {
  if (!latest) return 'no request with usage yet'
  if (isBlank(latest.requestedModel)) return "this agent's model is unknown"
  if (isBlank(input.mainRequestedModel)) return "the main loop's model is unknown"
  if (latest.requestedModel !== input.mainRequestedModel) {
    return `this agent requested ${latest.requestedModel}, the main loop ${input.mainRequestedModel}; no window is known for ${latest.requestedModel}`
  }
  if (usableWindow(input.main) === undefined) return 'no main-session window observed yet'
  const readFor = input.mainModelAtWindow
  if (input.main && !isBlank(readFor) && readFor !== input.mainRequestedModel) {
    return `the main window was read at ${clockText(input.main.at)} while the main loop used ${readFor}; it now uses ${input.mainRequestedModel}, and the window has not been read again`
  }
  return undefined
}

/** A subagent's % against its own model's documented window, or undefined when the table does not list the model. */
function documentedOccupancy(latest: Latest): Occupancy | undefined {
  const size = documentedWindow(latest.requestedModel)
  if (size === undefined) return undefined
  if (latest.promptTokens > size) {
    return unavailable(
      `the latest prompt (${compact(latest.promptTokens)}) exceeds the documented window of ${latest.requestedModel} (${compact(size)})`,
    )
  }
  // The size is drawn with its label beside the gauge; the basis says where it comes from.
  const basis = `assumes the documented window for ${latest.requestedModel} (model table of ${MODEL_WINDOWS.date}: ${MODEL_WINDOWS.source}); ${AUTO_COMPACT_NOTE}`
  return {
    window: { tokens: size, measure: 'ESTIMATED', basis },
    percent: {
      value: (latest.promptTokens / size) * 100,
      tokens: latest.promptTokens,
      at: latest.at,
      measure: 'ESTIMATED',
      basis: `latest prompt over the documented window; ${basis}`,
    },
  }
}

/**
 * A subagent's window and %, in order of evidence: the main session's observed window when the subagent asked for main's
 * model (read for that model); else its own model's documented window; else unavailable, with the reason.
 */
function subagentOccupancy(latest: Latest | undefined, input: ContextInputs): Occupancy {
  const blocker = estimateBlocker(latest, input)
  const main = input.main
  const size = usableWindow(main)
  if (blocker !== undefined || !latest || !main || size === undefined) {
    const documented = latest && !isBlank(latest.requestedModel) ? documentedOccupancy(latest) : undefined
    return documented ?? unavailable(blocker ?? 'no estimate possible')
  }
  if (latest.promptTokens > size) {
    return unavailable(
      `the latest prompt (${compact(latest.promptTokens)}) exceeds the assumed window (${compact(size)}), so the same-window assumption does not hold`,
    )
  }
  const basis = `${ASSUMPTION} (${latest.requestedModel}), as session.measure read it at ${clockText(main.at)}; ${AUTO_COMPACT_NOTE}`
  return {
    window: { tokens: size, at: main.at, measure: 'ESTIMATED', basis },
    percent: {
      value: (latest.promptTokens / size) * 100,
      tokens: latest.promptTokens,
      at: latest.at,
      measure: 'ESTIMATED',
      basis: `latest prompt over the assumed window; ${basis}`,
    },
  }
}

// ── signals, compactions, gaps ──

function stopSignalsOf(ledger: AgentLedger | undefined, ordered: readonly UsageRecord[]): AgentContextView['stopSignals'] {
  const counts = ledger?.stopReasons ?? {}
  return SIGNAL_STOP_REASONS.flatMap(reason => {
    const count = counts[reason] ?? 0
    if (!(count > 0)) return []
    const lastAt = ordered.filter(r => r.stopReason === reason).at(-1)?.at
    return [{ reason, count, lastAt }]
  })
}

function compactionsOf(agentId: string, marks: readonly CompactionMark[]): CompactionMark[] {
  return (Array.isArray(marks) ? marks : []).filter(m => m.agentId === agentId).sort((a, b) => a.seq - b.seq)
}

function recordedNothing(ledger: AgentLedger | undefined, ordered: readonly UsageRecord[]): boolean {
  return !ledger || ((ledger.requests ?? 0) + (ledger.requestsWithoutUsage ?? 0) === 0 && ordered.length === 0)
}

function historyGaps(ledger: AgentLedger | undefined, ordered: readonly UsageRecord[], latest: Latest | undefined): string[] {
  if (recordedNothing(ledger, ordered)) return ['No model request recorded for this agent yet.']
  const dropped = ledger?.historyDropped ?? 0
  const withoutUsage = ledger?.requestsWithoutUsage ?? 0
  const newest = newestOverall(ledger, ordered)
  const newerWithoutUsage = newest !== undefined && !hasTokens(newest) && latest !== undefined && newest.at > latest.at
  return [
    ...(latest ? [] : ['No request reported usage yet, so no prompt size is known.']),
    ...(dropped > 0
      ? [`History holds the newest ${ordered.length} of ${ordered.length + dropped} requests; the sparkline covers those only.`]
      : []),
    ...(withoutUsage > 0 ? [`${plural(withoutUsage, 'request')} resolved without usage (no response or interrupted); they carry no prompt size.`] : []),
    ...(newerWithoutUsage ? [`The newest request (${clockText(newest.at)}) reported no usage; the latest prompt shown is the one before it.`] : []),
  ]
}

// ── peak ──

const PEAK_RETAINED_PREFIX = 'Peak prompt is the largest of the'

/**
 * The largest single-request prompt: the ledger's exact `peak` when it has one
 * (never below a retained sample), else the retained requests' largest, with a
 * gap when requests were dropped from the history.
 */
function peakOf(ledger: AgentLedger | undefined, retained: readonly Priced[]): { value?: number; gap?: string } {
  const sizes = retained.map(r => promptTokensOf(r.tokens))
  const retainedMax = sizes.length ? Math.max(...sizes) : undefined
  const exact = ledger?.peak?.promptTokens
  if (exact !== undefined && Number.isFinite(exact)) return { value: Math.max(exact, retainedMax ?? 0) }
  if (retainedMax === undefined) return {}
  if ((ledger?.historyDropped ?? 0) <= 0) return { value: retainedMax }
  return {
    value: retainedMax,
    gap: `${PEAK_RETAINED_PREFIX} ${plural(retained.length, 'retained request')} with usage; the ledger reported no exact peak past the history bound.`,
  }
}

/** True when the view's peak covers every counted request (the ledger's exact peak, or a history that dropped nothing). */
export function peakIsExact(view: AgentContextView): boolean {
  return view.peakPromptTokens !== undefined && !view.gaps.some(g => g.startsWith(PEAK_RETAINED_PREFIX))
}

/** A stop reason that says something about context pressure (as opposed to refusal). */
export function isContextStopReason(reason: string): boolean {
  return CONTEXT_STOP_REASONS.includes(reason)
}

// ── the view ──

export function buildContextView(input: ContextInputs): AgentContextView {
  const ordered = orderedHistory(input.ledger)
  const priced = ordered.filter(hasTokens)
  const newest = newestWithUsage(input.ledger, ordered)
  const latest = newest ? latestOf(newest) : undefined
  const retained = newest && !priced.some(r => r.key === newest.key) ? [...priced, newest] : priced
  const peak = peakOf(input.ledger, retained)
  const occupancy = input.isMain ? mainOccupancy(input.main) : subagentOccupancy(latest, input)
  return {
    agentId: input.agentId,
    latest,
    peakPromptTokens: peak.value,
    samples: priced.map(r => promptTokensOf(r.tokens)),
    window: occupancy.window,
    percent: occupancy.percent,
    stopSignals: stopSignalsOf(input.ledger, ordered),
    compactions: compactionsOf(input.agentId, input.compactions),
    gaps: [
      ...historyGaps(input.ledger, ordered, latest),
      ...(peak.gap ? [peak.gap] : []),
      ...(occupancy.gap ? [occupancy.gap] : []),
      ...(input.isMain ? [] : [SUBAGENT_WINDOW_GAP]),
    ],
  }
}

const MAIN_ID = 'main'

/** The model of the newest retained request at or before `at`, or undefined when none is retained. */
function modelAt(ledger: AgentLedger | undefined, at: number): string | undefined {
  return orderedHistory(ledger)
    .filter(record => record.at <= at)
    .at(-1)?.requestedModel
}

/**
 * One agent's context view, its inputs read from the snapshot: the agent's own ledger, the compaction marks, the main
 * loop's session.measure reading, main's latest model and the model main used when that reading was taken. Every view
 * draws context from this, so no view assembles the inputs differently.
 */
export function contextViewFor(snapshot: Snapshot, agentId: string): AgentContextView {
  const agents = snapshot.ledger.agents
  const own = (id: string): AgentLedger | undefined => (Object.hasOwn(agents, id) ? agents[id] : undefined)
  const mainLedger = own(MAIN_ID)
  const main = snapshot.context
  return buildContextView({
    agentId,
    isMain: agentId === MAIN_ID,
    ledger: own(agentId),
    compactions: snapshot.compactionMarks,
    main,
    mainRequestedModel: mainLedger?.latest?.requestedModel,
    mainModelAtWindow: main ? modelAt(mainLedger, main.at) : undefined,
  })
}

// ── text ──

/** ▁▂▃▄▅▆▇█ over the newest `width` values, scaled to their max; '' for none. */
export function sparkline(values: readonly number[], width: number): string {
  const room = Math.max(0, Math.floor(Number.isFinite(width) ? width : 0))
  if (room === 0 || values.length === 0) return ''
  const shown = values.slice(-room).map(v => (Number.isFinite(v) && v > 0 ? v : 0))
  const max = Math.max(...shown)
  const top = SPARK_BARS.length - 1
  return shown.map(v => SPARK_BARS[max > 0 ? Math.min(top, Math.round((v / max) * top)) : 0] ?? '').join('')
}

/** A percentage for display: whole numbers, '<1%' for small non-zero values, 'n/a' when absent. */
export function percentText(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a'
  if (value > 0 && value < 1) return '<1%'
  return `${Math.round(value)}%`
}

function gaugeTokens(view: AgentContextView): string {
  const tokens = view.percent.measure === 'OBSERVED' ? view.percent.tokens : view.latest?.promptTokens
  return tokens === undefined ? 'n/a' : compact(tokens)
}

/** The gauge's % with its measure glyph, the separator before it, and the window it is " of" (OBSERVED or ESTIMATED only). */
function gaugeParts(view: AgentContextView): { sep: string; pct: string; win: string } {
  const { percent, window } = view
  const win = window.tokens !== undefined ? ` of ${compact(window.tokens)}` : ''
  if (percent.measure === 'OBSERVED') return { sep: ' ', pct: `${MEASURE_GLYPH.OBSERVED} ${percentText(percent.value)}`, win }
  if (percent.measure === 'ESTIMATED') return { sep: ' · ', pct: `${MEASURE_GLYPH.ESTIMATED}${percentText(percent.value)}`, win }
  return { sep: ' · ', pct: `${MEASURE_GLYPH.UNAVAILABLE} % n/a`, win: '' }
}

/**
 * One card line, e.g. `ctx 84k ▃▅▆█ · ≈8% of 1.0M`, `ctx 120k ● 12% of 1.0M`
 * or `ctx 84k · ∅ % n/a`. When room is short it drops, in order, the
 * sparkline, the window and the separator; the % and its glyph are cut only
 * when nothing else fits.
 */
export function contextGaugeText(view: AgentContextView, width: number): string {
  const room = Math.max(0, Math.floor(Number.isFinite(width) ? width : 0))
  const head = `ctx ${gaugeTokens(view)}`
  const { sep, pct, win } = gaugeParts(view)
  const full = `${head}${sep}${pct}${win}`
  const leanest = `${head} ${pct}`
  const sparkRoom = Math.min(GAUGE_SPARK_MAX, view.samples.length, room - full.length - 1)
  const spark = view.samples.length > 1 && sparkRoom >= 2 ? sparkline(view.samples, sparkRoom) : ''
  const candidates = [...(spark ? [`${head} ${spark}${sep}${pct}${win}`] : []), full, `${head}${sep}${pct}`, leanest]
  return candidates.find(line => line.length <= room) ?? truncate(leanest, room)
}
