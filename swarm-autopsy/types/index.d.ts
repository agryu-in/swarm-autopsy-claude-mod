// Swarm Autopsy's state contract: every value it keeps in `$.state`, and the
// data types the collector, the analysis and the views share.

/** How a displayed claim is supported. */
export type Evidence = 'OBSERVED' | 'LINKED' | 'INFERRED' | 'UNRESOLVED' | 'UNAVAILABLE'

export type AgentState = 'active' | 'completed' | 'failed' | 'stopped' | 'unknown'

export type Access = 'read' | 'write' | 'search' | 'exec' | 'other'

export type VerificationKind = 'test' | 'check'

export type VerificationVerdict = 'passed' | 'failed' | 'inconclusive' | 'running'

export type ToolStatus = 'running' | 'ok' | 'error' | 'denied'

export type EditExcerpt = {
  old: string
  new: string
  replaceAll: boolean
}

/** What a tool call's input says, read deterministically from its arguments. */
export type ToolFacts = {
  tool: string
  access: Access
  paths: string[]
  command?: string
  mentions: string[]
  verification?: VerificationKind
  edit?: EditExcerpt
  bytes?: number
  /** A free-text argument some tools carry (SubagentHandback's `message`), capped. */
  text?: string
  textLength?: number
  /** Why a verification's exit status may not be the check's own (a later pipe, `||`, `;`). */
  statusNote?: string
}

/** What the tool call's result says, when one was captured. */
export type ToolOutcome = {
  status: ToolStatus
  text: string
  exitCode?: number
  isReadOnly?: boolean
  verdict?: VerificationVerdict
  verdictBasis?: string
}

export type EventKind =
  | 'spawn'
  | 'spawn-denied'
  | 'turn-start'
  | 'turn-end'
  | 'tool'
  | 'agent-start'
  | 'agent-stop'
  | 'roster'
  | 'compaction'
  | 'session'

/** One normalised, provenance-carrying record of something the collector observed. */
export type ForensicEvent = {
  id: string
  seq: number
  at: number
  kind: EventKind
  agentId: string
  summary: string
  source: string
  toolUseId?: string
  turnId?: string
  tool?: ToolFacts
  outcome?: ToolOutcome
  endSeq?: number
  endAt?: number
  detail?: string
}

export type AgentReport = {
  excerpt: string
  length: number
  at: number
  seq: number
  reason: string
  mentions: string[]
  source: string
}

export type AgentCounts = {
  tools: number
  reads: number
  writes: number
  execs: number
  errors: number
}

export type CurrentTool = {
  tool: string
  toolUseId: string
  at: number
  label: string
}

export type AgentRecord = {
  id: string
  ordinal: number
  label: string
  isMain: boolean
  knownFrom: 'session' | 'spawn' | 'events' | 'roster'
  type?: string
  description?: string
  prompt?: string
  promptLength?: number
  promptMentions: string[]
  parentId?: string
  parentEvidence: Evidence
  parentBasis: string
  spawnToolUseId?: string
  spawnSeq?: number
  background?: boolean
  cwd?: string
  model?: string
  name?: string
  state: AgentState
  stateBasis: string
  firstSeq: number
  firstAt: number
  lastSeq: number
  lastAt: number
  lastSummary: string
  currentTool?: CurrentTool
  turns: number
  report?: AgentReport
  transcriptPath?: string
  compactions: number
  counts: AgentCounts
}

export type ContextReading = {
  tokens?: number
  window: number
  percent?: number
  at: number
}

export type Instruments = {
  spawn: number
  turnStart: number
  turnEnd: number
  tool: number
  agentStart: number
  agentStop: number
  roster: number
  compaction: number
  measure: number
  /** `turn.step` results heard, one per model request, duplicates included. */
  step: number
}

/** The whole collected session, as one JSON value. */
export type Snapshot = {
  version: 3
  sessionId?: string
  cwd?: string
  startedAt: number
  seq: number
  /** Bumped by every observation that changed anything; keys memoized analysis. */
  rev: number
  agents: Record<string, AgentRecord>
  agentOrder: string[]
  events: ForensicEvent[]
  droppedEvents: number
  /** Directory → git worktree root (null: not in a repository, or unknown). */
  roots: Record<string, string | null>
  /** Worktree root → the repository's common git dir, shared by all its worktrees. */
  repos: Record<string, string | null>
  /** tool_use_ids started and not yet ended, so an end whose start was evicted is not counted twice. */
  openTools: string[]
  context?: ContextReading
  /** The token ledger: the one source of token usage. */
  ledger: LedgerState
  /** Compactions with their token counts, oldest first, bounded. */
  compactionMarks: CompactionMark[]
  /** `session.measure` `cost.usd`, Claude Code's own figure for the session, when the host keeps one. */
  engineCost?: { usd: number; at: number }
  instruments: Instruments
  notes: string[]
}

// ── Shared types of the token features (the token ledger, the context gauge, spend vs outcome) ──

/** How a displayed number is supported: read from an event, computed from a stated assumption, or not available. */
export type Measure = 'OBSERVED' | 'ESTIMATED' | 'UNAVAILABLE'

/** The four token counts the API reports for one request, kept apart. */
export type TokenCounts = {
  /** Uncached input tokens (`input_tokens`). */
  input: number
  /** Input tokens served from the prompt cache (`cache_read_input_tokens`). */
  cacheRead: number
  /** Input tokens written to the prompt cache (`cache_creation_input_tokens`). */
  cacheWrite: number
  /** Generated tokens (`output_tokens`). */
  output: number
}

/**
 * Definition 1: one model request, as one `turn.step` result reported it.
 * The only source that counts toward ledger totals.
 */
export type UsageRecord = {
  /** Stable request identity, `${turnId}:${index}`: the dedupe key. */
  key: string
  source: 'turn.step'
  /** `$.clock.now()` when the step's response had resolved. */
  at: number
  /** The snapshot's agent id: `e.agentId`, or MAIN when the step carried none. */
  agentId: string
  /** `agentId`: the step named its loop; `main-loop`: it carried no agentId, which the API defines as the main loop. */
  attribution: 'agentId' | 'main-loop'
  turnId: string
  index: number
  /** The model the request named, as the engine resolved it (`TurnStepInput.model`; may carry a suffix such as `[1m]`). */
  requestedModel: string
  /** The model that answered, as the API reported it (`TurnUsage.model`); absent when no usage arrived. */
  model?: string
  /** Absent when the step's `usage` was null (no response, interrupted, or no usage reported). */
  tokens?: TokenCounts
  /** `TurnStepResult.stopReason`; null when no response arrived. */
  stopReason: string | null
}

/** Exact sums for one model inside one agent; `large*` is the part from requests whose prompt exceeded LARGE_PROMPT_TOKENS. */
export type ModelTally = {
  requests: number
  tokens: TokenCounts
  largeRequests: number
  largeTokens: TokenCounts
}

/** Definitions 2 and 3: an agent's own (direct) usage, aggregated over its recorded requests. */
export type AgentLedger = {
  agentId: string
  attribution: UsageRecord['attribution']
  /** Requests that reported usage and were counted. */
  requests: number
  /** Requests whose step resolved with no usage (no response, interrupted). */
  requestsWithoutUsage: number
  tokens: TokenCounts
  byModel: Record<string, ModelTally>
  /** Count of each stop reason seen, `null` keyed as 'none'. */
  stopReasons: Record<string, number>
  firstAt: number
  lastAt: number
  /** The most recent request by `at` (with or without usage). */
  latest?: UsageRecord
  /** The most recent requests, ordered by `at` then `index`, bounded; the sums above stay exact past the bound. */
  history: UsageRecord[]
  historyDropped: number
  /** The largest single-request prompt (input + cacheRead + cacheWrite) over EVERY counted request, exact past the history bound. */
  peak?: { promptTokens: number; at: number; key: string }
}

/** One turn as its steps added up and as `turn.complete` reported it, for reconciliation. */
export type TurnTally = {
  turnId: string
  agentId: string
  steps: number
  stepTokens: TokenCounts
  /** `turn.complete`'s usage: the turn's responses summed by the engine. Never added to totals. */
  reported?: TokenCounts
  reportedModel?: string
  reportedAt?: number
}

/** The ledger as stored in the snapshot: bounded, exact sums. */
export type LedgerState = {
  agents: Record<string, AgentLedger>
  /** Recent request keys, bounded: the dedupe window. */
  seen: string[]
  /** Records dropped because their key was already counted. */
  duplicates: number
  /** The tokens those dropped records carried: set aside, never in totals (a hook above may have re-sent a request). */
  duplicateTokens: TokenCounts
  /** When this ledger began counting, and whether requests before it went unrecorded (set by the collector). */
  since?: { at: number; missedEarlier: boolean; basis: string }
  turns: Record<string, TurnTally>
  /** Turn ids oldest first, bounded with `turns`. */
  turnOrder: string[]
  turnsDropped: number
}

/** One compaction, from `session.compact` and its result. */
export type CompactionMark = {
  agentId: string
  at: number
  seq: number
  trigger: string
  tokensBefore?: number
  tokensAfter?: number
  /** The summarizer request's own usage when core reported it. Display only: never added to ledger totals. */
  summarizerTokens?: TokenCounts
}

/** Definition 6: an API-equivalent price estimate. Never an actual charge. */
export type CostEstimate = {
  usd: number
  measure: 'ESTIMATED'
  /** The price table's effective date (YYYY-MM-DD). */
  priceDate: string
  /** Models whose tokens are in the totals but have no price: left out of `usd`. */
  unpricedModels: string[]
  /** True when every counted token was priced. */
  complete: boolean
}

export type LedgerTotals = {
  requests: number
  requestsWithoutUsage: number
  tokens: TokenCounts
  /** input + cacheRead + cacheWrite + output: "tokens processed", for proportions only. */
  processed: number
  cost?: CostEstimate
}

/** One agent's row in the spawn tree. */
export type LedgerRow = {
  agentId: string
  label: string
  parentId?: string
  depth: number
  models: string[]
  /** This agent's direct usage per model, priced with the view's table when cost is shown. */
  byModel: Array<{ model: string; tally: ModelTally; cost?: CostEstimate }>
  /** Definition 3: this agent's own requests only. */
  direct: LedgerTotals
  /** Definition 4: this agent plus every descendant in the spawn tree. */
  subtree: LedgerTotals & { agents: number }
  attribution: { evidence: Evidence; basis: string }
  reconciliation: { turnsCompared: number; mismatched: number; reportedOnly: number; note?: string }
}

/** The token ledger's view model: rows in tree order, session totals, the price table and the ledger's own caveats. */
export type LedgerView = {
  rows: LedgerRow[]
  /** Sum of every agent's direct totals: each request counted once. */
  session: LedgerTotals
  /** Claude Code's own session cost (`session.measure` cost.usd), when the host reports one. */
  engineCost?: { usd: number; measure: 'OBSERVED'; source: string }
  /** `cacheWrites`: the cache-write TTL rule the estimate applied, in words (the hook's usage does not say which TTL a write used). */
  priceTable: { date: string; source: string; assumptions: string[]; cacheWrites: string }
  /** Limitations in plain words: requests the hook cannot see, duplicates dropped, reconciliation gaps. */
  notes: string[]
}

/** Definition 5: one agent's context occupancy, as far as the captured data supports it. */
export type AgentContextView = {
  agentId: string
  /** Prompt size of the latest request that reported usage: input + cacheRead + cacheWrite of that one request (OBSERVED). */
  latest?: { promptTokens: number; output: number; at: number; model?: string; requestedModel: string; stopReason: string | null }
  peakPromptTokens?: number
  /** Prompt sizes of the retained requests, oldest first, for the sparkline. */
  samples: number[]
  /** `at`: when the window was read (session.measure), when it was. */
  window: { tokens?: number; at?: number; measure: Measure; basis: string }
  /** `tokens`: the numerator (main: session.measure tokens; subagent: its latest prompt); `at`: when it was read. */
  percent: { value?: number; tokens?: number; at?: number; measure: Measure; basis: string }
  /** Context-related stop reasons actually captured (max_tokens, model_context_window_exceeded, compaction, ...). */
  stopSignals: Array<{ reason: string; count: number; lastAt?: number }>
  compactions: CompactionMark[]
  gaps: string[]
}

/** Spend vs outcome: what a contribution or an agent's work amounted to, by the captured evidence. */
export type OutcomeCategory = 'verified' | 'changed-unverified' | 'failed-or-inconclusive' | 'report-only' | 'unresolved'

/** One contribution (one or more trail nodes) and why it was classified so. */
export type ContributionOutcome = {
  id: string
  agentId: string
  category: OutcomeCategory
  evidence: Evidence
  basis: string
  title: string
  nodeIds: string[]
  /** The trail edges that justify the classification (e.g. the change → passing check edge). */
  edgeIds?: string[]
  eventIds: string[]
  flagIds: string[]
}

/** An agent's contributions and its whole recorded usage; usage is never split across contributions. */
export type AgentOutcome = {
  agentId: string
  /** A single category when all its contributions share it; 'mixed' otherwise; 'coordinator' for the main loop. */
  bucket: OutcomeCategory | 'mixed' | 'coordinator'
  contributions: ContributionOutcome[]
  usage: LedgerTotals
}

export type SpendBucket = {
  bucket: AgentOutcome['bucket'] | 'no-usage-recorded'
  agents: string[]
  processed: number
  /** processed / denominator × 100, or undefined when the denominator is 0. */
  percent?: number
  cost?: CostEstimate
  meaning: string
}

/** The spend vs outcome view model. `denominator` is explained in `denominatorBasis`. */
export type SpendOutcome = {
  agents: AgentOutcome[]
  buckets: SpendBucket[]
  denominator: number
  denominatorBasis: string
  notes: string[]
}

export type View = 'live' | 'trail' | 'collisions' | 'forensics' | 'spend' | 'health'

export type TimelineFilter = 'all' | 'agents' | 'files' | 'tests' | 'failures' | 'signals'

/** Trail lanes shown: all, or those whose outcome or flags match. */
export type TrailFilter = 'all' | 'verified' | 'unresolved' | 'inconclusive' | 'failed'

/** Live agents shown, by state. */
export type LiveFilter = 'all' | 'active' | 'completed' | 'failed'

/** What the pane shows: the view, the agent in focus, what is selected or opened, the filters. */
export type UiState = {
  view: View
  /** The agent in focus across views: Live's inspector, Spend's detail, Trail's lane, Forensics' default filter. */
  focus?: string
  /** A selected trail node (`node:`), signal (`sig:`), event (`ev:`) or bucket (`bk:`). */
  selected?: string
  /** Ids of opened disclosures and sections ("why?" blocks, notes, the long legend, instruments). */
  open?: string[]
  filter: TimelineFilter
  agentFilter?: string
  trailFilter?: TrailFilter
  liveFilter?: LiveFilter
  page: number
  /** Show ≈$ API-equivalent estimates beside token counts; off unless the person turns it on. */
  showCost?: boolean
  /** The person asked the surface for a wider pane: a request, never a layout override. */
  wide?: boolean
  /** The person paused live updates: the pane keeps drawing the data it had, so its buttons stay pressable. */
  paused?: boolean
  /**
   * The chosen mode and the scene remembered for each mode (ids as in hooks/lib/scenes.ts), mirrored from the store
   * so every chat opens on the same scene.
   */
  mood?: { mode: string; sceneByMode: Record<string, string> }
  /** The music as every chat agrees on it (the store's), mirrored here so the toolbar draws it. */
  sound?: SoundValue
  /** Where this chat stands on the music. */
  player?: PlayerValue
  /** How clear the liquid glass is, 1 (frosted) to 5 (crystal), mirrored from the store so every chat draws it alike. */
  glass?: number
  /** The part of each view the still pane shows, by view, when a view is too long for one Client (client/parts.ts). */
  parts?: Record<string, number>
}

/** Music as every chat agrees on it: playing or paused, and the volume step 1–5. */
export type SoundValue = { isPlaying: boolean; volume: number }

/** Where this chat stands on the music. */
export type PlayerValue = {
  where: 'here' | 'elsewhere' | 'paused' | 'silent' | 'unavailable'
  /** Why it is unavailable, or what failed last. */
  note?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Swarm Health. A list of signals the existing analyses already raised, mapped
// to one shape. No score, no threshold, no new detection.
// ─────────────────────────────────────────────────────────────────────────────

export type HealthSource = 'trail' | 'collisions' | 'context' | 'ledger' | 'outcome' | 'coverage'

/**
 * The source's own scale, never a new one: collision severities (investigate, notice), trail flag evidence
 * (unresolved, unavailable), and observed facts (a captured stop reason, a compaction, a count).
 */
export type HealthLevel = 'investigate' | 'notice' | 'unresolved' | 'unavailable' | 'observed'

export type HealthSignal = {
  /** Stable and unique within one gathering, prefixed by source (e.g. `trail:flag-3`, `col:sig-1`). */
  id: string
  source: HealthSource
  level: HealthLevel
  /** The evidence label the source gave the claim. */
  evidence: Evidence
  /** The source's own title or text, verbatim. */
  title: string
  /** Why it was raised: the source's basis or detail text, verbatim. */
  why: string
  agentIds: string[]
  eventIds: string[]
  /** A trail node to show it on, when the source names one. */
  nodeId?: string
}

declare module 'claude-code' {
  interface PluginState {
    'swarm-autopsy': {
      snapshot: Snapshot
      ui: UiState
    }
  }
}
