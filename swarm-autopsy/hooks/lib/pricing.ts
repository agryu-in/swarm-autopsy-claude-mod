// F2 · API-equivalent price estimates (definition 6). A dated list-price
// table, an exact model-id match, and a strict parser for a table the person
// supplies. Every figure is ESTIMATED: never an actual charge, never what a
// Claude subscription costs. Pure; no `$`, no network.

import type { CostEstimate, ModelTally, TokenCounts } from '../../types'
import { processedOf } from './tokens'

/**
 * USD per million tokens, one rate per token category. `cacheWritePerMTok` is a
 * 5-minute-TTL write; `cacheWrite1hPerMTok` a 1-hour one, 2× input when left out.
 */
export type Rates = {
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
  cacheWrite1hPerMTok?: number
}

export type ModelPrice = { model: string; large?: Rates; note?: string } & Rates

/** A prompt-cache entry's lifetime, as the API prices its write. */
export type CacheTtl = '5m' | '1h'

/** Which loop a tally's requests came from: the main loop's or a subagent's. */
export type Loop = 'main-loop' | 'subagent'

/** Which TTL each loop's cache writes are priced at; the built-in rule when a table leaves it out. */
export type CacheWriteTtl = { mainLoop: CacheTtl; subagents: CacheTtl }

export type PriceTable = { date: string; source: string; assumptions: string[]; models: ModelPrice[]; cacheWriteTtl?: CacheWriteTtl }

/** A 5-minute-TTL cache write: 1.25× the input rate. */
export const CACHE_WRITE_MULTIPLIER = 1.25
/** A 1-hour-TTL cache write: 2× the input rate. */
export const CACHE_WRITE_1H_MULTIPLIER = 2

/**
 * How Claude Code wrote its prompt cache in every recorded session (2.1.299–2.1.301,
 * transcripts of 5 sessions on 2026-10-16/17): the main loop 1-hour, subagents
 * 5-minute. The hook's usage does not carry the TTL, so this stays an assumption.
 */
export const DEFAULT_CACHE_WRITE_TTL: CacheWriteTtl = { mainLoop: '1h', subagents: '5m' }

const PER_MTOK = 1_000_000
const RATE_KEYS: ReadonlyArray<keyof Rates> = ['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok']
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/
const BRACKET_SUFFIX = /\[[^\]]*\]$/
const DATE_SUFFIX = /-\d{8}$/

function rates(input: number, output: number, cacheRead: number): Rates {
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: cacheRead,
    cacheWritePerMTok: input * CACHE_WRITE_MULTIPLIER,
    cacheWrite1hPerMTok: input * CACHE_WRITE_1H_MULTIPLIER,
  }
}

function price(model: string, input: number, output: number, cacheRead: number): ModelPrice {
  return { model, ...rates(input, output, cacheRead) }
}

/** List prices as of 2026-10-06 (docs/vnext-contract.md §5). */
export const PRICE_TABLE: PriceTable = {
  date: '2026-10-06',
  source:
    'Claude API reference bundled with Claude Code 2.1.299 (claude-api skill, "Current Models (cached: 2026-10-06)", shared/models.md, shared/prompt-caching.md): first-party list rates, USD per million tokens',
  cacheWriteTtl: DEFAULT_CACHE_WRITE_TTL,
  assumptions: [
    "Cache writes: the hook's usage does not say whether a write was 5-minute (1.25× input) or 1-hour (2× input). In every recorded session (Claude Code 2.1.299–2.1.301, 5 sessions' transcripts) the main loop wrote 1-hour cache and subagents 5-minute, so they are priced that way. cacheWriteTtl in SWARM_AUTOPSY_PRICES changes it.",
    'Standard speed. Fast mode (Opus 5.5: $8/$40 per million) is not visible to the mod.',
    'First-party API rates. Bedrock and Vertex differ, and ids with a provider prefix stay unpriced.',
    'API-equivalent figures, not what a Claude Max or Pro subscription charges.',
  ],
  models: [
    price('claude-fable-5-1', 10, 50, 0.25),
    price('claude-mythos-5-1', 10, 50, 0.25),
    price('claude-fable-5', 10, 50, 1),
    price('claude-mythos-5', 10, 50, 1),
    price('claude-opus-5-5', 4, 20, 0.2),
    price('claude-opus-5', 5, 25, 0.5),
    price('claude-opus-4-8', 5, 25, 0.5),
    price('claude-opus-4-7', 5, 25, 0.5),
    price('claude-opus-4-6', 5, 25, 0.5),
    price('claude-sonnet-5-5', 2, 10, 0.2),
    price('claude-sonnet-5', 2, 10, 0.2),
    price('claude-sonnet-4-6', 3, 15, 0.3),
    {
      ...price('claude-haiku-5-5', 0.1, 0.5, 0.01),
      large: rates(0.5, 2.5, 0.05),
      note: 'tiered by prompt size: requests over 100K prompt tokens use the large rates',
    },
    price('claude-haiku-4-5', 1, 5, 0.1),
  ],
}

/** The id a price is listed under: a trailing `[...]` (e.g. `[1m]`) and then a trailing `-YYYYMMDD` removed. */
function listedId(model: string): string {
  return model.replace(BRACKET_SUFFIX, '').replace(DATE_SUFFIX, '')
}

/** The table's price for a model id, matched exactly after removing a bracket and a date suffix; provider-prefixed ids stay unpriced. */
export function priceFor(table: PriceTable, model: string): ModelPrice | undefined {
  const id = listedId(model)
  return table.models.find(p => p.model === model) ?? table.models.find(p => p.model === id)
}

function subtract(a: TokenCounts, b: TokenCounts): TokenCounts {
  return { input: a.input - b.input, cacheRead: a.cacheRead - b.cacheRead, cacheWrite: a.cacheWrite - b.cacheWrite, output: a.output - b.output }
}

/** The TTL a loop's cache writes are priced at; a loop nobody named gets the lower, 5-minute rate. */
export function ttlFor(table: PriceTable, loop: Loop | undefined): CacheTtl {
  if (loop === undefined) return '5m'
  const rule = table.cacheWriteTtl ?? DEFAULT_CACHE_WRITE_TTL
  return loop === 'main-loop' ? rule.mainLoop : rule.subagents
}

const TTL_WORDS: Record<CacheTtl, string> = { '5m': '5-minute', '1h': '1-hour' }

/** The cache-write rule a table applies, in words, for the Spend panel. */
export function cacheWriteRule(table: PriceTable): string {
  const rule = table.cacheWriteTtl ?? DEFAULT_CACHE_WRITE_TTL
  return `Cache writes: the main loop at the ${TTL_WORDS[rule.mainLoop]} rate, subagents at the ${TTL_WORDS[rule.subagents]} rate (the hook does not report which; see the assumptions).`
}

function writeRate(r: Rates, ttl: CacheTtl): number {
  return ttl === '1h' ? (r.cacheWrite1hPerMTok ?? r.inputPerMTok * CACHE_WRITE_1H_MULTIPLIER) : r.cacheWritePerMTok
}

function priceTokens(t: TokenCounts, r: Rates, ttl: CacheTtl): number {
  return (t.input * r.inputPerMTok + t.cacheRead * r.cacheReadPerMTok + t.cacheWrite * writeRate(r, ttl) + t.output * r.outputPerMTok) / PER_MTOK
}

/** One model's tally at its rates: the large part at the large rates when the model has them. */
function priceTally(tally: ModelTally, p: ModelPrice, ttl: CacheTtl): number {
  return priceTokens(subtract(tally.tokens, tally.largeTokens), p, ttl) + priceTokens(tally.largeTokens, p.large ?? p, ttl)
}

/**
 * ≈$ for a set of model tallies from one loop, its cache writes at that loop's
 * TTL (`ttlFor`). A model with tokens but no price is left out and named in
 * `unpricedModels`.
 */
export function estimateCost(table: PriceTable, byModel: Record<string, ModelTally>, loop?: Loop): CostEstimate {
  const ttl = ttlFor(table, loop)
  const models = Object.keys(byModel).sort()
  const priced = models.flatMap(model => {
    const tally = byModel[model]
    const p = priceFor(table, model)
    return tally && p ? [priceTally(tally, p, ttl)] : []
  })
  const unpricedModels = models.filter(model => {
    const tally = byModel[model]
    return tally !== undefined && processedOf(tally.tokens) > 0 && priceFor(table, model) === undefined
  })
  return {
    usd: priced.reduce((sum, usd) => sum + usd, 0),
    measure: 'ESTIMATED',
    priceDate: table.date,
    unpricedModels,
    complete: unpricedModels.length === 0,
  }
}

/** Dollars for display: two decimals, `<$0.01` for a non-zero amount below a cent, whole dollars from $1000. */
export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return usd >= 1000 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`
}

// ── parsing a person's own table (SWARM_AUTOPSY_PRICES) ──
//
// The file is untrusted: every value is checked, every string is bounded and
// free of control characters (it is drawn in a terminal), and the table is
// built from fresh values, so no key or array of the input is carried over.

type Parsed<T> = { value: T } | { error: string }

/** The highest rate accepted, USD per million tokens: far above any list price, low enough that no sum overflows. */
export const MAX_RATE_PER_MTOK = 10_000
const MAX_MODELS = 200
const MAX_ASSUMPTIONS = 12
const MAX_SOURCE_CHARS = 300
const MAX_ASSUMPTION_CHARS = 400
const MAX_NOTE_CHARS = 200
const MAX_MODEL_ID_CHARS = 100
/** Model ids as providers spell them: letters, digits and . _ - : @ / [ ] (e.g. `claude-opus-5-5[1m]`, `…-v1:0`). */
const MODEL_ID_SHAPE = /^[A-Za-z0-9._:@/[\]-]+$/
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_RATE_PER_MTOK

/** A YYYY-MM-DD string naming a real calendar day. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_SHAPE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** One line of display text: non-empty after trimming, within `max` characters, no control characters. */
function parseText(value: unknown, path: string, max: number): Parsed<string> {
  if (typeof value !== 'string' || value.trim() === '') return { error: `${path} must be non-empty text` }
  if (value.length > max) return { error: `${path} must be at most ${max} characters` }
  if (CONTROL_CHARS.test(value)) return { error: `${path} must be one line of plain text (no control characters)` }
  return { value }
}

function parseRates(raw: unknown, path: string): Parsed<Rates> {
  if (!isRecord(raw)) return { error: `${path} must be an object of rates` }
  const bad = RATE_KEYS.find(key => !isRate(raw[key]))
  if (bad) return { error: `${path}.${bad} must be a number from 0 to ${MAX_RATE_PER_MTOK} (USD per million tokens)` }
  const hour = raw.cacheWrite1hPerMTok
  if (hour !== undefined && !isRate(hour)) {
    return { error: `${path}.cacheWrite1hPerMTok must be a number from 0 to ${MAX_RATE_PER_MTOK} (USD per million tokens), or left out for 2× input` }
  }
  return {
    value: {
      inputPerMTok: raw.inputPerMTok as number,
      outputPerMTok: raw.outputPerMTok as number,
      cacheReadPerMTok: raw.cacheReadPerMTok as number,
      cacheWritePerMTok: raw.cacheWritePerMTok as number,
      ...(hour !== undefined ? { cacheWrite1hPerMTok: hour } : {}),
    },
  }
}

const isTtl = (value: unknown): value is CacheTtl => value === '5m' || value === '1h'

/** The optional cache-write TTL rule: both loops named, each '5m' or '1h'. */
function parseCacheWriteTtl(raw: unknown): Parsed<CacheWriteTtl | undefined> {
  if (raw === undefined) return { value: undefined }
  if (!isRecord(raw) || !isTtl(raw.mainLoop) || !isTtl(raw.subagents)) {
    return { error: 'cacheWriteTtl must be { "mainLoop": "5m" or "1h", "subagents": "5m" or "1h" }, or left out for the built-in rule' }
  }
  return { value: { mainLoop: raw.mainLoop, subagents: raw.subagents } }
}

function parseModelId(value: unknown, path: string): Parsed<string> {
  const text = parseText(value, path, MAX_MODEL_ID_CHARS)
  if ('error' in text) return text
  return MODEL_ID_SHAPE.test(text.value) ? text : { error: `${path} must be a model id (letters, digits and . _ - : @ / [ ] only)` }
}

function parseModel(raw: unknown, path: string): Parsed<ModelPrice> {
  if (!isRecord(raw)) return { error: `${path} must be an object` }
  const model = parseModelId(raw.model, `${path}.model`)
  if ('error' in model) return model
  const note = raw.note === undefined ? undefined : parseText(raw.note, `${path}.note`, MAX_NOTE_CHARS)
  if (note && 'error' in note) return note
  const base = parseRates(raw, path)
  if ('error' in base) return base
  const large = raw.large === undefined ? undefined : parseRates(raw.large, `${path}.large`)
  if (large && 'error' in large) return large
  return {
    value: {
      model: model.value,
      ...base.value,
      ...(large ? { large: large.value } : {}),
      ...(note ? { note: note.value } : {}),
    },
  }
}

function parseModels(raw: unknown): Parsed<ModelPrice[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'models must be a non-empty list' }
  if (raw.length > MAX_MODELS) return { error: `models must list at most ${MAX_MODELS} entries` }
  const models: ModelPrice[] = []
  for (const [i, entry] of raw.entries()) {
    const parsed = parseModel(entry, `models[${i}]`)
    if ('error' in parsed) return parsed
    if (models.some(m => m.model === parsed.value.model)) return { error: `models[${i}].model ${parsed.value.model} is listed twice` }
    models.push(parsed.value)
  }
  return { value: models }
}

function parseAssumptions(raw: unknown): Parsed<string[]> {
  const list = raw ?? []
  if (!Array.isArray(list)) return { error: 'assumptions must be a list of text' }
  if (list.length > MAX_ASSUMPTIONS) return { error: `assumptions must list at most ${MAX_ASSUMPTIONS} entries` }
  const assumptions: string[] = []
  for (const [i, entry] of list.entries()) {
    const text = parseText(entry, `assumptions[${i}]`, MAX_ASSUMPTION_CHARS)
    if ('error' in text) return text
    assumptions.push(text.value)
  }
  return { value: assumptions }
}

/** Validates an untrusted price table read from JSON and rebuilds it from fresh values; anything wrong is refused with a plain message naming the field. */
export function parsePriceTable(json: unknown): { table: PriceTable } | { error: string } {
  if (!isRecord(json)) return { error: 'the price table must be a JSON object' }
  if (!isCalendarDate(json.date)) return { error: "date must be the prices' effective date, a real day as YYYY-MM-DD" }
  const source = parseText(json.source, 'source', MAX_SOURCE_CHARS)
  if ('error' in source) return { error: `${source.error}, saying where the prices come from` }
  const assumptions = parseAssumptions(json.assumptions)
  if ('error' in assumptions) return assumptions
  const models = parseModels(json.models)
  if ('error' in models) return models
  const ttl = parseCacheWriteTtl(json.cacheWriteTtl)
  if ('error' in ttl) return ttl
  return {
    table: {
      date: json.date,
      source: source.value,
      assumptions: assumptions.value,
      models: models.value,
      ...(ttl.value ? { cacheWriteTtl: ttl.value } : {}),
    },
  }
}
