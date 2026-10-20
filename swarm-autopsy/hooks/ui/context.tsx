// The context gauge's visuals. `ContextFigures` is the one gauge line every
// card and inspector draws: a Meter with the view's own % and window, or ∅ and
// the latest prompt. `ContextPanel` is the inspector's context section: the
// gauge (plus a Ring on desktop), the latest prompt, per-request prompt sizes
// as a sparkline (plus a chart on desktop, marked only where a compaction or a
// context stop was captured), the stop reasons and compactions themselves, and
// the window basis behind "why?". Draws from an AgentContextView only: a % or a
// capacity is never computed here, and samples are per-request prompt sizes,
// never cumulative.

import type { AgentContextView, AgentLedger, CompactionMark, Snapshot, TokenCounts, UsageRecord } from '../../types'
import { isContextStopReason, peakIsExact } from '../lib/context'
import { MEASURE_COLOR, MEASURE_GLYPH, ago, compact, exact, pct, plural } from '../lib/format'
import { ROLE } from '../lib/palette'
import { promptTokensOf } from '../lib/tokens'
import type { ViewContext } from './common'
import { Disclosure, Heading, MeasureTag, Meter, Ring, ShareBar, SparkChart, Sparkline, paintsGlass } from './kit'
import type { SparkMarker } from './svg'

const MIN_WIDTH = 20
const SPARK_MAX = 40
const METER_MIN = 8
const METER_MAX = 24
/** Desktop: the gauge's Box bar, at most this many cells (it stands beside the figures, not under them). */
const DESKTOP_METER_MAX = 12

// ── the gauge line ──

/** True when the view carries a % to draw (OBSERVED or ESTIMATED, with a finite value). */
export function hasPercent(view: AgentContextView): boolean {
  return view.percent.measure !== 'UNAVAILABLE' && view.percent.value !== undefined && Number.isFinite(view.percent.value)
}

/**
 * KIT-CANDIDATE: a `ContextGauge` beside `Meter`; the header's context tile draws the same figures its own way.
 *
 * The gauge as one run of Text: `███··· ● 9% · 86k of 1.0M` (main, OBSERVED: one ● covers the line),
 * `▍····· ≈ 4.2% of 1.0M · ● prompt 42k` (a same-model subagent: the % and the assumed window are ≈, the prompt is ●),
 * or `∅ % n/a · ● latest prompt 150k` (no window known for it, so no capacity is drawn).
 */
export function ContextFigures(ctx: ViewContext, view: AgentContextView, meterCells: number, opts: { bar?: boolean } = {}) {
  const { Text } = ctx.els
  const { percent, window, latest } = view
  if (hasPercent(view) && opts.bar === false) {
    // The words alone, for a line that draws its gauge as a Box bar beside them (desktop): the same figures and labels.
    const of = window.tokens !== undefined ? ` of ${compact(window.tokens)}` : ''
    const value = (
      <Text>
        <Text color={MEASURE_COLOR[percent.measure]}>{MEASURE_GLYPH[percent.measure]}</Text> {pct(percent.value)}
      </Text>
    )
    const prompt = percent.measure === 'OBSERVED' ? undefined : (percent.tokens ?? latest?.promptTokens)
    return (
      <Text>
        {value}
        {percent.measure === 'OBSERVED' ? (percent.tokens !== undefined ? ` · ${compact(percent.tokens)}${of}` : of) : of}
        {prompt !== undefined ? (
          <Text>
            {' · '}
            {MeasureTag(ctx, 'OBSERVED', false)} prompt {compact(prompt)}
          </Text>
        ) : (
          ''
        )}
      </Text>
    )
  }
  if (!hasPercent(view)) {
    return (
      <Text>
        {Meter(ctx, { measure: 'UNAVAILABLE', width: meterCells })}
        {latest ? (
          <Text>
            {' · '}
            {MeasureTag(ctx, 'OBSERVED', false)} latest prompt {compact(latest.promptTokens)}
          </Text>
        ) : (
          <Text dimColor> · no prompt size yet</Text>
        )}
      </Text>
    )
  }
  const of = window.tokens !== undefined ? ` of ${compact(window.tokens)}` : ''
  const meter = Meter(ctx, { percent: percent.value, measure: percent.measure, width: meterCells })
  if (percent.measure === 'OBSERVED') {
    const numerator = percent.tokens !== undefined ? ` · ${compact(percent.tokens)}${of}` : of
    return (
      <Text>
        {meter}
        {numerator}
      </Text>
    )
  }
  const prompt = percent.tokens ?? latest?.promptTokens
  return (
    <Text>
      {meter}
      {of}
      {prompt !== undefined ? (
        <Text>
          {' · '}
          {MeasureTag(ctx, 'OBSERVED', false)} prompt {compact(prompt)}
        </Text>
      ) : (
        ''
      )}
    </Text>
  )
}

/** The words a desktop ring carries in its alt: the same figures as its native twin. */
export function ringLabel(view: AgentContextView): string {
  const { percent, window } = view
  const tokens = percent.tokens !== undefined ? compact(percent.tokens) : undefined
  const capacity = window.tokens !== undefined ? compact(window.tokens) : undefined
  if (tokens && capacity) return `${tokens} of ${capacity} tokens`
  return tokens ? `${tokens} tokens` : capacity ? `of ${capacity} tokens` : 'context'
}

/** One line under the gauge: where an observed % came from, the assumption an estimate rests on, or why there is none. */
function gaugeNote(ctx: ViewContext, view: AgentContextView): string {
  const { percent, window } = view
  if (percent.measure === 'OBSERVED') {
    const at = percent.at ?? window.at
    return `from session.measure${at !== undefined ? `, read ${ago(ctx.now, at)}` : ''}`
  }
  if (percent.measure === 'ESTIMATED') return (window.basis.split(';')[0] ?? window.basis).trim()
  return `no exact percentage can be established: ${percent.basis.replace(/^% unavailable: /, '')}`
}

// ── markers on the per-request chart ──

function byTime(a: UsageRecord, b: UsageRecord): number {
  return a.at - b.at || a.index - b.index
}

function ledgerOf(snapshot: Snapshot | undefined, agentId: string): AgentLedger | undefined {
  const agents = snapshot?.ledger?.agents
  return agents && Object.hasOwn(agents, agentId) ? agents[agentId] : undefined
}

/**
 * KIT-CANDIDATE: lib/context could export its `orderedHistory` and `hasTokens`; this repeats them, and the alignment
 * check below turns any drift into "no markers" rather than wrong ones.
 *
 * The view's samples as the requests they came from: the agent's retained history oldest first, each key once, those
 * that reported usage (the order buildContextView samples in). Undefined when they do not line up with the samples.
 */
function sampledRecords(snapshot: Snapshot | undefined, view: AgentContextView): UsageRecord[] | undefined {
  const history = ledgerOf(snapshot, view.agentId)?.history
  const ordered = (Array.isArray(history) ? [...history] : []).sort(byTime).filter((r, i, all) => all.findIndex(o => o.key === r.key) === i)
  const priced = ordered.filter(r => r.tokens != null)
  const aligned = priced.length === view.samples.length && priced.every((r, i) => r.tokens && promptTokensOf(r.tokens) === view.samples[i])
  return aligned ? priced : undefined
}

/**
 * Markers for the per-request chart, by sample index: a captured context stop reason on the request that carried it,
 * and a captured compaction on the first request after it. A compaction before the first or after the last plotted
 * request has no place on the chart and is left to the text lines. Nothing is marked that was not captured.
 */
export function contextMarkers(snapshot: Snapshot | undefined, view: AgentContextView): SparkMarker[] {
  const records = sampledRecords(snapshot, view)
  if (!records || records.length < 2) return []
  const stops = records.flatMap((r, index) => (r.stopReason && isContextStopReason(r.stopReason) ? [{ index, kind: 'stop' as const }] : []))
  const compactions = view.compactions.flatMap(mark => {
    const index = records.findIndex(r => r.at >= mark.at)
    return index > 0 ? [{ index, kind: 'compaction' as const }] : []
  })
  return [...compactions, ...stops]
}

function markersText(markers: readonly SparkMarker[]): string {
  const compactions = markers.filter(m => m.kind === 'compaction').length
  const stops = markers.filter(m => m.kind === 'stop').length
  const parts = [...(compactions ? [plural(compactions, 'compaction')] : []), ...(stops ? [plural(stops, 'context stop')] : [])]
  return parts.length ? `; ${parts.join(' and ')} marked` : ''
}

// ── the sparkline's label ──

/** "● last 12 of 45 requests · peak 152k": what the drawn values are, out of how many, and the peak with its scope. */
export function sparkLabel(view: AgentContextView, drawn: number, withUsage: number, withPeak: boolean): string {
  const of = drawn < withUsage ? ` of ${withUsage}` : ''
  const peak =
    withPeak && view.peakPromptTokens !== undefined ? ` · peak ${compact(view.peakPromptTokens)}${peakIsExact(view) ? '' : ' (kept)'}` : ''
  return `${MEASURE_GLYPH.OBSERVED} last ${drawn}${of} ${drawn === 1 ? 'request' : 'requests'}${peak}`
}

// ── the inspector's section ──

export type ContextPanelOptions = {
  /** Makes the disclosure's id unique per agent (`ctx-<id>`); the view's agent id by default. */
  id?: string
  /** Requests that reported usage over the agent's whole ledger: the M of "last N of M". */
  requestsWithUsage?: number
  /** Captured compactions and context stops by sample index (contextMarkers); none by default. */
  markers?: readonly SparkMarker[]
}

/**
 * The gauge as one line: `ctx`, the meter and the figures. On desktop the meter is a Box bar beside the words (a text
 * meter's track runs long in the desktop face and pushes the figures onto a second line; harness paint, 2026-10-18).
 */
function GaugeLine(ctx: ViewContext, view: AgentContextView, width: number) {
  const { Box, Text } = ctx.els
  if (!paintsGlass(ctx) || !hasPercent(view)) {
    const cells = Math.max(METER_MIN, Math.min(METER_MAX, Math.floor(width / 3)))
    return (
      <Text wrap="wrap">
        <Text dimColor>ctx </Text>
        {ContextFigures(ctx, view, cells)}
      </Text>
    )
  }
  const cells = Math.max(METER_MIN, Math.min(DESKTOP_METER_MAX, Math.floor(width / 5)))
  const role = view.percent.measure === 'ESTIMATED' ? ROLE.caution : ROLE.context
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Text dimColor>ctx</Text>
      {ShareBar(ctx, (view.percent.value ?? 0) / 100, cells, role)}
      <Text wrap="wrap">{ContextFigures(ctx, view, cells, { bar: false })}</Text>
    </Box>
  )
}

function GaugeLines(ctx: ViewContext, view: AgentContextView, width: number) {
  const { Box, Text } = ctx.els
  const note = gaugeNote(ctx, view)
  const text = (
    <Box flexDirection="column" flexShrink={1}>
      {GaugeLine(ctx, view, width)}
      <Text dimColor wrap="wrap">
        {note}
      </Text>
    </Box>
  )
  const ring = hasPercent(view) ? Ring(ctx, { percent: view.percent.value, measure: view.percent.measure, label: ringLabel(view) }) : null
  if (!ring) return text
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {ring}
      {text}
    </Box>
  )
}

function LatestLines(ctx: ViewContext, view: AgentContextView) {
  const { Box, Text } = ctx.els
  const latest = view.latest
  if (!latest) return <Text wrap="wrap">{MeasureTag(ctx, 'UNAVAILABLE', false)} latest prompt: no request with usage yet</Text>
  const answered = latest.model && latest.model !== latest.requestedModel ? ` · answered by ${latest.model}` : ''
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        {MeasureTag(ctx, 'OBSERVED', false)} latest prompt <Text weight="bold">{compact(latest.promptTokens)}</Text>
        <Text dimColor> (one request, not cumulative)</Text> · out {compact(latest.output)} · {ago(ctx.now, latest.at)}
      </Text>
      <Text dimColor wrap="wrap">
        requested {latest.requestedModel || 'model unknown'}
        {answered} · stop {latest.stopReason ?? 'none'}
      </Text>
    </Box>
  )
}

function HistoryLines(ctx: ViewContext, view: AgentContextView, width: number, opts: ContextPanelOptions) {
  const { Box, Text } = ctx.els
  if (view.peakPromptTokens === undefined) return null
  const scope = peakIsExact(view) ? 'exact, every counted request' : 'retained requests only'
  const count = view.samples.length
  const withUsage = Math.max(count, opts.requestsWithUsage ?? count)
  const markers = opts.markers ?? []
  const drawn = Math.max(2, Math.min(SPARK_MAX, count, width - sparkLabel(view, count, withUsage, false).length - 1))
  const chartLabel = `prompt size per request (observed), last ${count}${count < withUsage ? ` of ${withUsage}` : ''} requests with usage, highest plotted ${compact(Math.max(0, ...view.samples))}${markersText(markers)}`
  // Desktop: the area chart, with its label as the native twin; block glyphs read as one solid block in the desktop face.
  const chart = count > 1 ? SparkChart(ctx, { values: view.samples, markers, label: chartLabel }) : null
  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        {MeasureTag(ctx, 'OBSERVED', false)} peak prompt {compact(view.peakPromptTokens)} ({scope})
      </Text>
      {count > 1 ? (chart ? <Text dimColor>{sparkLabel(view, count, withUsage, false)}</Text> : Sparkline(ctx, view.samples, drawn, { label: sparkLabel(view, drawn, withUsage, false) })) : null}
      {chart}
    </Box>
  )
}

function SignalLines(ctx: ViewContext, view: AgentContextView) {
  const { Box, Text } = ctx.els
  if (view.stopSignals.length === 0) return null
  return (
    <Box flexDirection="column">
      {view.stopSignals.map(signal => {
        const pressure = isContextStopReason(signal.reason)
        return (
          <Text key={`ctx-stop-${signal.reason}`} color={pressure ? ROLE.caution : undefined} dimColor={!pressure} wrap="wrap">
            {MeasureTag(ctx, 'OBSERVED', false)} stop {signal.reason} ×{signal.count}
            {signal.lastAt !== undefined ? ` · last ${ago(ctx.now, signal.lastAt)}` : ' · last time not in kept history'}
            {pressure ? '' : ' (not context-related)'}
          </Text>
        )
      })}
    </Box>
  )
}

function sizesText(mark: CompactionMark): string {
  const { tokensBefore: before, tokensAfter: after } = mark
  if (before !== undefined && after !== undefined) return `${compact(before)} → ${compact(after)} tokens`
  if (before !== undefined) return `${compact(before)} before, after not captured`
  if (after !== undefined) return `${compact(after)} after, before not captured`
  return 'token counts not captured'
}

function summarizerText(t: TokenCounts): string {
  return `summarizer request: prompt ${compact(promptTokensOf(t))} · out ${compact(t.output)} (display only, not added to the ledger)`
}

function CompactionLines(ctx: ViewContext, view: AgentContextView) {
  const { Box, Text } = ctx.els
  if (view.compactions.length === 0) return null
  return (
    <Box flexDirection="column">
      {view.compactions.map(mark => (
        <Box key={`ctx-compaction-${mark.seq}`} flexDirection="column">
          <Text wrap="wrap">
            <Text color={ROLE.analytic}>⇊</Text> {MeasureTag(ctx, 'OBSERVED', false)} compacted ({mark.trigger}) · {ago(ctx.now, mark.at)} ·{' '}
            {sizesText(mark)}
          </Text>
          {mark.summarizerTokens && (
            <Text dimColor wrap="wrap">
              {'  '}
              {MeasureTag(ctx, 'OBSERVED', false)} {summarizerText(mark.summarizerTokens)}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )
}

function GapLines(ctx: ViewContext, gaps: readonly string[]) {
  const { Box, Text } = ctx.els
  if (gaps.length === 0) return null
  return (
    <Box flexDirection="column">
      {gaps.map((gap, i) => (
        <Text key={`ctx-gap-${i}`} dimColor wrap="wrap">
          {MeasureTag(ctx, 'UNAVAILABLE', false)} {gap}
        </Text>
      ))}
    </Box>
  )
}

/** The window, its basis, the %'s basis and (when a prompt size is known) the view's notes: closed by default. */
function BasisLines(ctx: ViewContext, view: AgentContextView) {
  const { Box, Text } = ctx.els
  const { window, percent } = view
  const size = window.tokens !== undefined ? `${compact(window.tokens)} (${exact(window.tokens)} tokens)` : 'not known'
  const read = window.at !== undefined ? ` · read ${ago(ctx.now, window.at)}` : ''
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text wrap="wrap">
        {MeasureTag(ctx, window.measure, false)} window {size}
        {read}
      </Text>
      <Text dimColor wrap="wrap">
        {window.basis}
      </Text>
      {percent.basis !== window.basis && !percent.basis.endsWith(window.basis) ? (
        <Text dimColor wrap="wrap">
          {percent.basis}
        </Text>
      ) : null}
      {view.latest ? (
        <Text dimColor wrap="wrap">
          A prompt is one request's input + cache read + cache write: what that request was answered over, not a sum over requests.
        </Text>
      ) : null}
      {view.latest ? GapLines(ctx, view.gaps) : null}
    </Box>
  )
}

/** The inspector's context section for one agent. */
export function ContextPanel(ctx: ViewContext, view: AgentContextView, opts: ContextPanelOptions = {}) {
  const { Box } = ctx.els
  const width = Math.max(MIN_WIDTH, ctx.width)
  const id = opts.id ?? view.agentId
  const notes = view.latest ? view.gaps.length : 0
  const label = `why? window basis${notes > 0 ? ` · ${plural(notes, 'note')}` : ''}`
  return (
    <Box flexDirection="column">
      {Heading(ctx, 'context', { summary: 'prompt size per request, never cumulative' })}
      {GaugeLines(ctx, view, width)}
      {LatestLines(ctx, view)}
      {HistoryLines(ctx, view, width, opts)}
      {SignalLines(ctx, view)}
      {CompactionLines(ctx, view)}
      {view.latest ? null : GapLines(ctx, view.gaps)}
      {Disclosure(ctx, `ctx-${id}`, label, () => BasisLines(ctx, view))}
    </Box>
  )
}
