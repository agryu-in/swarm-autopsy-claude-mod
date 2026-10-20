// Live's agents at a glance: the coordinator strip, an agent card (a raised
// glass tile tinted with the agent's identity) and the one-line row the
// terminal's compact layout draws instead.
//
// The whole card opens the agent's existing details: every text line is a
// press target calling `toggleFocus(id)`. The first line keeps `card-<id>`, the
// others are `cardrow-<id>-<slot>` (never `card-`: the tests and the acceptance
// walk count one `card-` key per agent), and a line's slot is fixed by what it
// says, so its key never moves with the figures. The terminal draws each line as
// one Button of styled runs, cut to the card's width; the desktop draws only a
// Button's label, as plain text, so there the styled pieces (the marker and
// chip, the state pill, the Box bars, the ring) sit beside the line's Button.
// A desktop line too long for its card goes on to further rows (each its own
// press target, `cardrow-<id>-<slot>-<n>`) rather than being cut, so a narrow
// card (the side dock, 40–55 columns) keeps every fact; only the ring gives way.

import type { RenderChildren } from 'claude-code'

import type { AgentContextView, AgentRecord, LedgerRow } from '../../types'
import { contextViewFor } from '../lib/context'
import { MEASURE_GLYPH, ago, compact, pct, plural, truncate } from '../lib/format'
import { ROLE, STATE_ROLE, SVG_HEX, TOKEN_CATEGORIES, identityHex } from '../lib/palette'
import { formatUsd } from '../lib/pricing'
import type { ViewContext } from './common'
import { ContextFigures, hasPercent, ringLabel, sparkLabel } from './context'
import {
  AgentChip,
  BarStrip,
  CostText,
  MeasureTag,
  Meter,
  Pill,
  PressRow,
  ShareBar,
  Sparkline,
  StateBadge,
  TokenBar,
  drawsSvg,
  glass,
  glassHover,
  layoutFor,
  paintsGlass,
  textRuns,
} from './kit'
import { activityOf, filesOf, rowOf, usageOf, type AgentFiles, type Usage } from './live-facts'
import type { Analyses } from './pane'
import { ringSvg, sparkSvg } from './svg'

/** A card's frame: its round border and `paddingX={1}`, one cell on each side. */
export const CARD_FRAME = 4
const CARD_MIN_INNER = 24
const METER_MIN = 4
const METER_MAX = 8
const METER_ALONE_MAX = 12
const BAR_MIN = 4
const BAR_MAX = 12
const BAR_ALONE_MAX = 20
const SPARK_MAX = 24
/** Desktop: a card's per-request chart, in CSS px at the chart's own 5:1 ratio, and the cells it and its gap take. */
const SPARK_PX = { width: 90, height: 18 } as const
const SPARK_CELLS = 13
/** Desktop: the ring beside a card's first lines, in CSS px (about two lines tall). */
const RING_PX = 44
/** Cells the ring and its gap take from the lines beside it. */
const RING_CELLS = 7
/** Cells the lines beside the ring keep at least: a narrower card drops the ring (only the ring), never a word. */
const RING_MIN_HEAD = 36
/** Desktop: rows a task may take on a card before the rest is cut. */
const TASK_ROWS = 2
/** Desktop text is proportional: a character takes about this much of a cell on average. */
const DESKTOP_CHAR = 0.85
/**
 * Desktop: pad a line's label with figure spaces to the line's width (PressRow `fill`), so the press target spans the
 * line rather than the words alone. Off: the harness paint (2026-10-18, 116 columns) showed the padded labels ending
 * in a stray "…" and pushing the ring past the card's edge (`fill` is allowed only without them).
 */
const DESKTOP_FILL = false
/** From this width the coordinator strip lays its lines out in two columns. */
const STRIP_SPLIT = 100
const STRIP_LEFT_SHARE = 0.55
/** Compact lines pad the meter and the total to these widths on the terminal, so the columns line up. */
const LINE_METER = 11
const LINE_TOTAL = 7
const LINE_METER_CELLS = 4
/** A compact line's task, flattened to one line; the painter cuts it to the pane. */
const TASK_MAX = 160

/** Each line's slot on a card, fixed by what it says, so its key holds whatever the figures do. */
const SLOT = { identity: 0, task: 1, figures: 2, tokens: 3, meta: 4, spark: 5, spawn: 6, counts: 7 } as const

/** A card line's key: `card-<id>` for the first line, `cardrow-<id>-<slot>` for the rest. */
export function lineKey(id: string, slot: number): string {
  return slot === SLOT.identity ? `card-${id}` : `cardrow-${id}-${slot}`
}

/** A desktop row's key: the line's own for its first row, `cardrow-<id>-<slot>-<n>` for the rows it goes on to. */
function rowKey(id: string, slot: number, row: number): string {
  return row === 0 ? lineKey(id, slot) : `cardrow-${id}-${slot}-${row}`
}

/**
 * KIT-CANDIDATE: a shared `column(ctx, width)`: components that size to `ctx.width` (Spend's ledger and outcome
 * details, EventLine) then fit a column of the pane instead of the whole pane.
 *
 * A context for a column of the pane: its own width and the layout class that width has.
 */
export function sized(ctx: ViewContext, width: number): ViewContext {
  return { ...ctx, width, layout: layoutFor(width) }
}

// ── text arithmetic ──

/** The text a node draws, flattened. */
function plainText(node: RenderChildren): string {
  return textRuns(node)
    .map(run => run.text)
    .join('')
}

/** Cells a text takes: one per character on the terminal, fewer in the desktop's proportional face. */
function cellsOf(ctx: ViewContext, text: string): number {
  return ctx.surface === 'terminal' ? text.length : Math.ceil(text.length * DESKTOP_CHAR)
}

/** Characters that fit in `cells` on this surface. */
function charsIn(ctx: ViewContext, cells: number): number {
  return Math.max(1, ctx.surface === 'terminal' ? Math.floor(cells) : Math.floor(cells / DESKTOP_CHAR))
}

/** Styled runs cut to `cells` with a dim ellipsis: the terminal wraps a Button's text whatever a Text says. */
function fit(ctx: ViewContext, node: RenderChildren, cells: number): RenderChildren[] {
  const { Text } = ctx.els
  const runs = textRuns(node)
  const cut = runs.reduce((n, run) => n + run.text.length, 0) > cells
  let left = Math.max(0, cut ? cells - 1 : cells)
  const out: RenderChildren[] = []
  for (const run of runs) {
    if (left <= 0) break
    const text = run.text.slice(0, left)
    left -= text.length
    out.push(<Text {...(run.style as Record<string, never>)}>{text}</Text>)
  }
  if (cut) out.push(<Text dimColor>…</Text>)
  return out
}

// ── rows (desktop) ──

/** The separator between a line's figures: a row may end there, and the separator is then left out. */
const SEPARATOR = ' · '

/**
 * A figure's words as the units a row keeps together, each at most `chars`: a lone glyph (●, ≈, ∅) stays with what it
 * labels and a number with the words either side of it (`last 2 requests`, `peak 42k`), so a label never ends a row
 * and a figure keeps its unit.
 */
function units(text: string, chars: number): string[] {
  const out: string[] = []
  for (const word of text.split(' ').filter(Boolean)) {
    const last = out.at(-1)
    const tail = last?.slice(last.lastIndexOf(' ') + 1) ?? ''
    const together = /^[^\p{L}\p{N}]$/u.test(tail) || /\p{N}$/u.test(tail) || /^\(?\p{N}/u.test(word)
    const glued = last !== undefined && together && last.length + 1 + word.length <= chars
    if (glued) out[out.length - 1] = `${last} ${word}`
    else out.push(word)
  }
  return out
}

/** A word longer than a row, cut after a hyphen, colon or slash inside the row where there is one, else at its end. */
function hardBreak(word: string, chars: number): string[] {
  const out: string[] = []
  let rest = word
  while (rest.length > chars) {
    const head = rest.slice(0, chars)
    const at = Math.max(head.lastIndexOf('-'), head.lastIndexOf(':'), head.lastIndexOf('/'))
    const cut = at > 0 ? at + 1 : chars
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  return rest ? [...out, rest] : out
}

/**
 * A line's plain words as rows of at most `chars`: whole figures where they fit (a row breaks at a ` · `), then whole
 * words; at most `max` rows, the last cut with an ellipsis when the words run on past it.
 */
function wrapRows(text: string, chars: number, max = Number.POSITIVE_INFINITY): string[] {
  const rows: string[] = []
  let row = ''
  const add = (piece: string, joint: string) => {
    if (row && row.length + joint.length + piece.length <= chars) {
      row += joint + piece
      return
    }
    if (row) rows.push(row)
    row = piece
  }
  for (const segment of text.replace(/\s+/g, ' ').trim().split(SEPARATOR)) {
    if (segment.length <= chars) {
      add(segment, SEPARATOR)
      continue
    }
    // A figure longer than a row: its words, packed.
    units(segment, chars)
      .flatMap(unit => hardBreak(unit, chars))
      .forEach((unit, i) => add(unit, i === 0 ? SEPARATOR : ' '))
  }
  if (row) rows.push(row)
  if (rows.length <= max) return rows.length ? rows : [text]
  return [...rows.slice(0, max - 1), truncate(rows.slice(max - 1).join(' '), chars)]
}

// ── one line, two drawings ──

/**
 * What a card line says, for both surfaces. `runs`: the terminal's whole line as styled runs. `words`: the desktop's
 * words (its Button label, as plain text, or a static line's styled Text). `before` and `after`: the desktop's pieces
 * beside the words (Text, a pill, Box bars), `aside` the cells they and their gaps take. `dim`: the desktop label is
 * drawn dim (the terminal's runs carry their own dim style). `rows`: the desktop rows the words may go on to (all
 * they need when unset).
 */
export type LineParts = {
  slot: number
  runs: RenderChildren
  words: RenderChildren
  before?: RenderChildren
  after?: RenderChildren
  aside?: number
  dim?: boolean
  rows?: number
}

type Press = { id: string; selected: boolean; onPress: () => void }

/** The press of an agent's card: every line toggles its focus, which opens its existing details. */
function pressOf(ctx: ViewContext, agent: AgentRecord): Press {
  return { id: agent.id, selected: ctx.ui.focus === agent.id, onPress: () => ctx.act.toggleFocus(agent.id) }
}

/**
 * A card line as a press target, `cells` wide. Desktop: words that do not fit go on to further rows, each its own
 * press target, the pieces before them on the first row and those after them on the last.
 */
function CardLine(ctx: ViewContext, press: Press, cells: number, parts: LineParts) {
  const key = lineKey(press.id, parts.slot)
  const selected = parts.slot === SLOT.identity && press.selected
  if (ctx.surface === 'terminal') {
    return PressRow(ctx, { key, onPress: press.onPress, selected, children: fit(ctx, parts.runs, cells) })
  }
  const { Box } = ctx.els
  const chars = charsIn(ctx, Math.max(4, cells - (parts.aside ?? 0)))
  const rows = wrapRows(plainText(parts.words), chars, parts.rows)
  return rows.map((label, i) => {
    const row = rowKey(press.id, parts.slot, i)
    const before = i === 0 ? parts.before : undefined
    const after = i === rows.length - 1 ? parts.after : undefined
    const fill = DESKTOP_FILL && after === undefined ? chars : undefined
    const button = PressRow(ctx, { key: row, onPress: press.onPress, dim: parts.dim, children: label, ...(fill ? { fill } : {}) })
    if (before === undefined && after === undefined) return button
    return (
      <Box key={`ln-${row}`} flexDirection="row" columnGap={1} alignItems="center">
        {before ?? null}
        {button}
        {after ?? null}
      </Box>
    )
  })
}

/** The same line drawn to be read, not pressed (the inspector's summary). */
export function StaticLine(ctx: ViewContext, cells: number, parts: LineParts) {
  const { Box, Text } = ctx.els
  if (ctx.surface === 'terminal') {
    return <Text wrap="truncate-end">{fit(ctx, parts.runs, cells)}</Text>
  }
  const words = (
    <Text wrap="truncate-end" dimColor={parts.dim === true}>
      {parts.words}
    </Text>
  )
  if (parts.before === undefined && parts.after === undefined) return words
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {parts.before ?? null}
      {words}
      {parts.after ?? null}
    </Box>
  )
}

// ── the lines ──

function marker(ctx: ViewContext, press: Press, space: boolean) {
  const { Text } = ctx.els
  return (
    <Text color={ROLE.accent}>
      {press.selected ? '▾' : '▸'}
      {space ? ' ' : ''}
    </Text>
  )
}

/** The state as a small pill on desktop (its glyph and word in the state's colour); plain on the terminal. */
function StatePill(ctx: ViewContext, agent: AgentRecord) {
  return Pill(ctx, { edge: STATE_ROLE[agent.state], children: StateBadge(ctx, agent) })
}

/** Line 0: the marker, the identity chip and type, and the state. */
function identityParts(ctx: ViewContext, agent: AgentRecord, press: Press, cells: number): LineParts {
  const { Text } = ctx.els
  const state = StateBadge(ctx, agent)
  const stateCells = plainText(state).length
  if (agent.isMain) {
    return {
      slot: SLOT.identity,
      runs: [marker(ctx, press, true), AgentChip(ctx, agent.id), ' ', state, <Text dimColor> · coordinator</Text>],
      words: 'coordinator',
      before: (
        <Text>
          {marker(ctx, press, true)}
          {AgentChip(ctx, agent.id)}
        </Text>
      ),
      after: StatePill(ctx, agent),
      aside: 9 + stateCells + 6,
    }
  }
  const letter = agent.label.length + 2
  return {
    slot: SLOT.identity,
    runs: [marker(ctx, press, true), AgentChip(ctx, agent.id, { name: true, width: cells - 2 - stateCells - 1 }), ' ', state],
    words: agent.type ?? 'type unknown',
    before: (
      <Text>
        {marker(ctx, press, true)}
        {AgentChip(ctx, agent.id)}
      </Text>
    ),
    after: StatePill(ctx, agent),
    aside: 3 + letter + stateCells + 6,
  }
}

/** Line 1: the task as it was delegated (on desktop up to two rows), or that it is unavailable (never invented). */
function taskParts(ctx: ViewContext, agent: AgentRecord, cells: number): LineParts {
  const { Text } = ctx.els
  if (!agent.description) {
    const text = <Text dimColor>task description unavailable</Text>
    return { slot: SLOT.task, runs: text, words: 'task description unavailable', dim: true }
  }
  const quoted = `“${truncate(agent.description, Math.max(4, charsIn(ctx, cells) - 2))}”`
  return { slot: SLOT.task, runs: <Text weight="medium">{quoted}</Text>, words: `“${agent.description}”`, rows: TASK_ROWS }
}

/** The tokens figure's words: `● 78k processed`, or `∅ usage unknown (why)` (unknown is never a 0). */
function tokenWords(ctx: ViewContext, usage: Usage) {
  const { Text } = ctx.els
  if (!usage.known) {
    return (
      <Text color={ROLE.muted}>
        {MEASURE_GLYPH.UNAVAILABLE} usage unknown ({usage.reason})
      </Text>
    )
  }
  return (
    <Text>
      {MeasureTag(ctx, 'OBSERVED', false)} <Text weight="bold">{compact(usage.totals.processed)}</Text> processed
    </Text>
  )
}

type FigurePlan = { together: boolean; meter: number; bar: number }

/**
 * Whether the context gauge and the tokens fit one line of `cells`, and the bar widths that make them fit: the meter
 * gives way first, down to its minimum, then the tokens take a line of their own (no figure is ever cut).
 */
function planFigures(fixed: number, cells: number, hasMeter: boolean, known: boolean): FigurePlan {
  let meter = hasMeter ? Math.max(METER_MIN, Math.min(METER_MAX, Math.floor(cells / 8))) : 0
  if (!known) return { together: fixed + meter <= cells, meter, bar: 0 }
  let bar = Math.min(BAR_MAX, cells - fixed - meter)
  while (bar < BAR_MIN && meter > METER_MIN) {
    meter -= 1
    bar = Math.min(BAR_MAX, cells - fixed - meter)
  }
  return { together: bar >= BAR_MIN, meter, bar }
}

/**
 * Lines 2 (and 3): the figures. The context gauge in its own colour with its one label (the view's own %, window and
 * prompt; ∅ when none), then the agent's own tokens processed with a thin token bar and ≈$ when asked. One line when
 * both fit; the tokens take line 3 otherwise.
 */
export function figureParts(ctx: ViewContext, view: AgentContextView, row: LedgerRow | undefined, cells: number): LineParts[] {
  const { Text } = ctx.els
  const usage = usageOf(row)
  const cost = usage.known ? CostText(ctx, usage.totals.cost, ctx.ui.showCost === true) : null
  const costText = cost ? plainText(cost) : ''
  const hasMeter = hasPercent(view)
  const tokens = tokenWords(ctx, usage)
  // The gauge's words without its meter: the desktop draws the meter as a Box bar beside them.
  const gaugeWords = ContextFigures(ctx, view, METER_MIN, { bar: false })
  const gaugeLabel = plainText(gaugeWords)
  const tokenLabel = plainText(tokens)
  const terminal = ctx.surface === 'terminal'
  // Everything on the line but the two bars: words, separators and the gaps between pieces.
  const fixed = terminal
    ? 4 + (hasMeter ? 1 : 0) + gaugeLabel.length + 3 + tokenLabel.length + (usage.known ? 1 : 0) + (cost ? 3 + costText.length : 0)
    : 4 + (hasMeter ? 1 : 0) + cellsOf(ctx, `${gaugeLabel} · ${tokenLabel}`) + (usage.known ? 1 : 0) + (cost ? 1 + cellsOf(ctx, costText) : 0)
  const plan = planFigures(fixed, cells, hasMeter, usage.known)
  const meterCells = plan.together ? plan.meter : Math.max(METER_MIN, Math.min(METER_ALONE_MAX, Math.floor(cells / 6)))
  const barCells = plan.together ? plan.bar : Math.max(BAR_MIN, Math.min(BAR_ALONE_MAX, cells - cellsOf(ctx, tokenLabel) - 1 - (cost ? 3 + costText.length : 0)))
  const ctxWord = <Text dimColor>ctx </Text>
  const gaugeRuns = [ctxWord, ContextFigures(ctx, view, meterCells)]
  const gaugeBar = hasMeter
    ? ShareBar(ctx, (view.percent.value ?? 0) / 100, meterCells, view.percent.measure === 'ESTIMATED' ? ROLE.caution : ROLE.context)
    : null
  const tokenBar = usage.known
    ? BarStrip(
        ctx,
        TOKEN_CATEGORIES.map(c => ({ value: usage.totals.tokens[c.key], role: c.role })),
        barCells,
      )
    : null
  const tokenRuns = usage.known
    ? [tokens, ' ', TokenBar(ctx, usage.totals.tokens, barCells), cost ? [<Text dimColor> · </Text>, cost] : '']
    : tokens
  const costAfter = cost ? (
    <Text>
      <Text dimColor>· </Text>
      {cost}
    </Text>
  ) : null
  const gaugeBefore = <Text dimColor>ctx</Text>
  const before = gaugeBar ? [gaugeBefore, gaugeBar] : gaugeBefore
  const beforeCells = 4 + (gaugeBar ? meterCells + 1 : 0)
  const afterCells = (tokenBar ? barCells + 1 : 0) + (cost ? 3 + cellsOf(ctx, costText) : 0)
  if (plan.together) {
    return [
      {
        slot: SLOT.figures,
        runs: [gaugeRuns, <Text dimColor> · </Text>, tokenRuns],
        words: [gaugeWords, <Text dimColor> · </Text>, tokens],
        before,
        after: tokenBar || costAfter ? [tokenBar, costAfter] : undefined,
        aside: beforeCells + afterCells,
      },
    ]
  }
  return [
    { slot: SLOT.figures, runs: gaugeRuns, words: gaugeWords, before, aside: beforeCells },
    { slot: SLOT.tokens, runs: tokenRuns, words: tokens, after: tokenBar || costAfter ? [tokenBar, costAfter] : undefined, aside: afterCells },
  ]
}

/** The agent's report as a glyph: captured, not yet returned, or none. */
function ReportMark(ctx: ViewContext, agent: AgentRecord) {
  const { Text } = ctx.els
  if (agent.report) return <Text>✦ report</Text>
  if (agent.state === 'active' || agent.state === 'unknown') return <Text dimColor>no report yet</Text>
  return <Text dimColor>{MEASURE_GLYPH.UNAVAILABLE} no report</Text>
}

/** Files read and written (distinct paths, ≥ when older events were dropped) and errors: zero counts are left out. */
function Counters(ctx: ViewContext, agent: AgentRecord, files: AgentFiles) {
  const { Text } = ctx.els
  const ge = files.bounded ? '≥' : ''
  const reads = files.read.length
  const writes = files.written.length
  const errors = agent.counts.errors
  const any = reads + writes + errors > 0
  return (
    <Text>
      {any ? <Text>{MeasureTag(ctx, 'OBSERVED', false)} </Text> : ''}
      {reads ? `${ge}${reads} read` : ''}
      {writes ? `${reads ? ' ' : ''}✎${ge}${writes}` : ''}
      {errors ? <Text color={ROLE.fail}>{`${reads + writes ? ' ' : ''}✕${errors}`}</Text> : ''}
      {any ? ' · ' : ''}
      {ReportMark(ctx, agent)}
    </Text>
  )
}

/** The coordinator's counts: turns completed (never "0 turns" while its first runs), tool calls, compactions. */
function MainCounts(ctx: ViewContext, main: AgentRecord) {
  const { Text } = ctx.els
  const turns = main.turns > 0 ? `${plural(main.turns, 'turn')} completed` : main.state === 'active' ? 'first turn running' : 'no turn completed'
  const tools = main.counts.tools > 0 ? plural(main.counts.tools, 'tool call') : 'no tool calls yet'
  const compactions = main.compactions > 0 ? ` · ${plural(main.compactions, 'compaction')}` : ''
  const numbered = main.turns > 0 || main.counts.tools > 0 || main.compactions > 0
  return (
    <Text>
      {numbered ? <Text>{MeasureTag(ctx, 'OBSERVED', false)} </Text> : ''}
      {turns} · {tools}
      {compactions}
    </Text>
  )
}

/**
 * Line 4, quiet: what the agent is doing or did last and when, then its counts (files, errors, report; main's turns
 * and tool calls). An agent's activity gives way to its counts; the coordinator's counts, which are long, take a line
 * of their own (slot 7) when both do not fit, so neither is cut.
 */
function metaParts(ctx: ViewContext, agent: AgentRecord, cells: number): LineParts[] {
  const { Text } = ctx.els
  const activity = activityOf(ctx.snapshot, agent)
  const said = activity.seen ? `${activity.text} · ${ago(ctx.now, activity.at)}` : activity.text
  const counts = agent.isMain ? MainCounts(ctx, agent) : Counters(ctx, agent, filesOf(ctx.snapshot, agent))
  const countCells = cellsOf(ctx, plainText(counts))
  // The terminal cuts the activity to its room; the desktop's words are whole and go on to further rows.
  const doing = (room?: number) => (
    <Text color={activity.live ? ROLE.context : undefined} dimColor={!activity.live}>
      {room === undefined ? said : truncate(said, charsIn(ctx, room))}
    </Text>
  )
  if (agent.isMain && cellsOf(ctx, said) + 3 + countCells > cells) {
    return [
      { slot: SLOT.meta, runs: doing(cells), words: doing(), dim: !activity.live },
      { slot: SLOT.counts, runs: counts, words: counts, dim: true },
    ]
  }
  const runs = [doing(Math.max(8, cells - countCells - 3)), <Text dimColor> · </Text>, counts]
  return [{ slot: SLOT.meta, runs, words: [doing(), <Text dimColor> · </Text>, counts], dim: !activity.live }]
}

/**
 * The desktop's per-request prompt sizes: a small area chart (the kit's `sparkSvg`, plotted from zero), muted when the
 * agent is not active. Text block glyphs read as one solid block in the desktop face (harness paint, 2026-10-18), so the
 * desktop draws this beside the line's label, its native twin; the terminal keeps the text sparkline.
 */
function SparkPicture(ctx: ViewContext, values: readonly number[], label: string, dim: boolean) {
  if (!drawsSvg(ctx) || !('Svg' in ctx.els)) return null
  const picture = sparkSvg({ values, label })
  if (!picture) return null
  const { Svg } = ctx.els
  const source = dim ? picture.source.replaceAll(SVG_HEX.context, SVG_HEX.muted) : picture.source
  return <Svg source={source} alt={picture.alt} width={SPARK_PX.width} height={SPARK_PX.height} />
}

/** Line 5: per-request prompt sizes when there are at least two, dim when the agent is not active; never cumulative. */
function sparkParts(ctx: ViewContext, view: AgentContextView, row: LedgerRow | undefined, cells: number, dim: boolean): LineParts | undefined {
  const count = view.samples.length
  if (count < 2) return undefined
  const withUsage = Math.max(count, row?.direct.requests ?? count)
  const drawn = Math.max(2, Math.min(SPARK_MAX, count, cells - sparkLabel(view, count, withUsage, true).length - 1))
  const label = sparkLabel(view, drawn, withUsage, true)
  const picture = SparkPicture(ctx, view.samples.slice(-drawn), `prompt sizes, one per request (observed): ${label.replace(/^● /, '')}`, dim)
  return {
    slot: SLOT.spark,
    runs: Sparkline(ctx, view.samples, drawn, { label, dim }),
    words: label,
    before: picture ?? Sparkline(ctx, view.samples, drawn, { dim }),
    aside: picture ? SPARK_CELLS : drawn + 1,
    dim: true,
  }
}

/** Main's spawn tree: it includes every agent below, so it overlaps their own figures and is never added to them. */
function spawnWords(ctx: ViewContext, row: LedgerRow | undefined) {
  const { Text } = ctx.els
  if (!row || row.subtree.agents <= 1 || row.subtree.requests === 0) return null
  return (
    <Text dimColor>
      {MeasureTag(ctx, 'OBSERVED', false)} spawn tree {compact(row.subtree.processed)} · {row.subtree.agents} agents (overlaps their own figures; never
      added)
    </Text>
  )
}

/** The spawn tree as a line of its own, for a summary drawn without the coordinator card (compact). */
export function SpawnTree(ctx: ViewContext, analyses: Analyses, main: AgentRecord) {
  const { Text } = ctx.els
  const words = spawnWords(ctx, rowOf(analyses, main.id))
  return words ? <Text wrap="wrap">{words}</Text> : null
}

// ── cards ──

/** The desktop ring beside a card's first lines: the view's own % (dashed when ESTIMATED), its figures in the alt. */
function CardRing(ctx: ViewContext, view: AgentContextView) {
  if (!drawsSvg(ctx) || !hasPercent(view) || !('Svg' in ctx.els)) return null
  const picture = ringSvg({ percent: view.percent.value ?? 0, measure: view.percent.measure, label: ringLabel(view) })
  if (!picture) return null
  const { Svg } = ctx.els
  return <Svg source={picture.source} alt={picture.alt} width={RING_PX} height={RING_PX} />
}

/**
 * The ring for a card `inner` cells wide, when the lines beside it keep their room and its identity line (drawn by
 * `identity` at a width) still fits whole beside it; otherwise none, and the lines take the ring's cells.
 */
function RingBeside(ctx: ViewContext, view: AgentContextView, inner: number, identity: (cells: number) => LineParts) {
  const head = inner - RING_CELLS
  if (head < RING_MIN_HEAD) return null
  const parts = identity(head)
  if (plainText(parts.words).length > charsIn(ctx, head - (parts.aside ?? 0))) return null
  return CardRing(ctx, view)
}

/**
 * The card's tile: raised glass tinted with `edge`; on desktop the focused card's edge is at full strength and the
 * whole tile lights under the pointer. The terminal keeps a plain round border in `edge`.
 */
function CardBox(ctx: ViewContext, id: string, edge: string, width: number, focused: boolean, children: RenderChildren) {
  const { Box } = ctx.els
  const hover = glassHover(ctx)
  const lit = focused && paintsGlass(ctx) ? { borderColor: edge } : {}
  return (
    <Box key={`card-box-${id}`} flexDirection="column" {...glass(ctx, 'raised', edge)} {...lit} paddingX={1} width={width} {...(hover ? { hover } : {})}>
      {children}
    </Box>
  )
}

/** The ring beside `lines` (desktop, when the view carries a %); the lines alone otherwise. */
function besideRing(ctx: ViewContext, ring: RenderChildren, lines: RenderChildren[], first: 'ring' | 'lines') {
  const { Box } = ctx.els
  if (!ring) return lines
  const column = (
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
      {lines}
    </Box>
  )
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {first === 'ring' ? [ring, column] : [column, ring]}
    </Box>
  )
}

/**
 * An agent's card: identity, type and state with the ring on the right (desktop), the task, one figures line
 * (context gauge, tokens processed and their bar), a quiet line of activity and counts, and per-request prompt sizes.
 * A narrow card stacks the gauge and the tokens, lets the task take two rows and drops the ring when it would squeeze
 * the identity line.
 */
export function AgentCard(ctx: ViewContext, analyses: Analyses, agent: AgentRecord, width: number) {
  const inner = Math.max(CARD_MIN_INNER, width - CARD_FRAME)
  const view = contextViewFor(ctx.snapshot, agent.id)
  const row = rowOf(analyses, agent.id)
  const press = pressOf(ctx, agent)
  const ring = RingBeside(ctx, view, inner, cells => identityParts(ctx, agent, press, cells))
  const head = ring ? inner - RING_CELLS : inner
  const line = (cells: number) => (parts: LineParts) => CardLine(ctx, press, cells, parts)
  const spark = sparkParts(ctx, view, row, inner, agent.state !== 'active')
  return CardBox(ctx, agent.id, identityHex(agent) ?? ROLE.muted, width, press.selected, [
    besideRing(ctx, ring, [identityParts(ctx, agent, press, head), taskParts(ctx, agent, head)].map(line(head)), 'lines'),
    figureParts(ctx, view, row, inner).map(line(inner)),
    metaParts(ctx, agent, inner).map(line(inner)),
    spark ? line(inner)(spark) : null,
  ])
}

/**
 * The coordinating session as a compact strip: identity and state, its figures, its activity and counts, and its
 * prompt sizes; from 100 columns in two columns of lines, the ring beside the gauge (desktop). Its spawn tree closes
 * the strip as a muted note, labelled as overlapping and never added.
 */
export function CoordinatorCard(ctx: ViewContext, analyses: Analyses, main: AgentRecord, width: number) {
  const { Box } = ctx.els
  const inner = Math.max(CARD_MIN_INNER, width - CARD_FRAME)
  const view = contextViewFor(ctx.snapshot, main.id)
  const row = rowOf(analyses, main.id)
  const press = pressOf(ctx, main)
  const ring = RingBeside(ctx, view, inner, cells => identityParts(ctx, main, press, cells))
  const usable = ring ? inner - RING_CELLS : inner
  const split = width >= STRIP_SPLIT
  const left = split ? Math.floor((usable - 1) * STRIP_LEFT_SHARE) : usable
  const right = split ? usable - 1 - left : usable
  const line = (cells: number) => (parts: LineParts) => CardLine(ctx, press, cells, parts)
  const spark = sparkParts(ctx, view, row, right, main.state !== 'active')
  const first = [identityParts(ctx, main, press, left), ...figureParts(ctx, view, row, left)].map(line(left))
  const second = [...metaParts(ctx, main, right), ...(spark ? [spark] : [])].map(line(right))
  const spawn = spawnWords(ctx, row)
  const body = split ? (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {ring}
      <Box flexDirection="column" width={left}>
        {first}
      </Box>
      <Box flexDirection="column" width={right}>
        {second}
      </Box>
    </Box>
  ) : (
    besideRing(ctx, ring, [...first, ...second], 'ring')
  )
  return CardBox(ctx, main.id, paintsGlass(ctx) ? SVG_HEX.main : ROLE.main, width, press.selected, [
    body,
    spawn ? line(inner)({ slot: SLOT.spawn, runs: spawn, words: spawn, dim: true }) : null,
  ])
}

// ── compact lines ──

function pad(ctx: ViewContext, length: number, to: number): string {
  return ctx.surface === 'terminal' ? ' '.repeat(Math.max(0, to - length)) : ''
}

function meterLength(view: AgentContextView): number {
  return hasPercent(view) ? LINE_METER_CELLS + 3 + pct(view.percent.value).length : 7
}

/**
 * One agent on one line, the whole line one press target (`card-<id>`): chip and state glyph, mini meter, total (or
 * ∅ usage unknown), ≈$ when cost is on, writes and errors, then the task. The figures come first so they line up and
 * are never cut; the task is the flexible tail. Desktop: the marker, chip and meter sit beside the Button, whose label
 * is the rest of the line.
 */
function Line(ctx: ViewContext, analyses: Analyses, agent: AgentRecord, task: { text: string; dim?: boolean }) {
  const { Text } = ctx.els
  const view = contextViewFor(ctx.snapshot, agent.id)
  const usage = usageOf(rowOf(analyses, agent.id))
  const files = filesOf(ctx.snapshot, agent)
  const showCost = ctx.ui.showCost === true
  const cost = usage.known && showCost ? usage.totals.cost : undefined
  const total = usage.known ? compact(usage.totals.processed) : ''
  const totalLength = usage.known ? total.length + 2 : 15
  const ge = files.bounded ? '≥' : ''
  const writes = files.written.length
  const errors = agent.counts.errors
  // With usage unknown the line's only label is ∅, so the observed counts carry their own ●.
  const countTag = !usage.known && writes + errors > 0 ? <Text> {MeasureTag(ctx, 'OBSERVED', false)}</Text> : ''
  // A Button wraps its text on the terminal whatever a Text inside says, so the task is cut to the cells left after the
  // fixed columns (marker, chip, state, meter, total, cost, counts), and the line never wraps under itself.
  const costText = cost ? ` ≈${formatUsd(cost.usd)}${cost.complete ? '' : '+'}` : ''
  const counts = (countTag ? 2 : 0) + (writes ? ` ✎${ge}${writes}`.length : 0) + (errors ? ` ✕${errors}`.length : 0)
  const lead = 2 + (agent.isMain ? 6 : agent.label.length + 2) + 2 + 1 + Math.max(meterLength(view), LINE_METER) + 1
  const fixed = lead + Math.max(totalLength, LINE_TOTAL) + costText.length + counts + 1
  const taskText = truncate(task.text, Math.max(4, ctx.width - fixed))
  const press = pressOf(ctx, agent)
  const head = [
    marker(ctx, press, true),
    AgentChip(ctx, agent.id, { state: true }),
    ' ',
    Meter(ctx, { percent: view.percent.value, measure: view.percent.measure, width: LINE_METER_CELLS }),
    pad(ctx, meterLength(view), LINE_METER),
    ' ',
  ]
  const figures = [
    usage.known ? (
      <Text>
        {MeasureTag(ctx, 'OBSERVED', false)} {total}
      </Text>
    ) : (
      <Text color={ROLE.muted}>{MEASURE_GLYPH.UNAVAILABLE} usage unknown</Text>
    ),
    pad(ctx, totalLength, LINE_TOTAL),
    cost ? <Text> {CostText(ctx, cost, showCost)}</Text> : '',
    countTag,
    writes ? ` ✎${ge}${writes}` : '',
    errors ? <Text color={ROLE.fail}> ✕{errors}</Text> : '',
    ' ',
    task.dim ? <Text dimColor>{taskText}</Text> : <Text>{taskText}</Text>,
  ]
  const key = lineKey(agent.id, SLOT.identity)
  if (ctx.surface === 'terminal') return PressRow(ctx, { key, onPress: press.onPress, selected: press.selected, children: [...head, ...figures] })
  const label = truncate(plainText(figures), charsIn(ctx, Math.max(8, ctx.width - cellsOf(ctx, plainText(head)) - 1)))
  return PressRow(ctx, { key, onPress: press.onPress, lead: head, children: label })
}

/** A subagent's compact line; its task is the description on one line, or says it is unavailable. */
export function AgentLine(ctx: ViewContext, analyses: Analyses, agent: AgentRecord) {
  const task = agent.description ? { text: truncate(agent.description, TASK_MAX) } : { text: 'task description unavailable', dim: true }
  return Line(ctx, analyses, agent, task)
}

/** The coordinator's compact line. */
export function CoordinatorLine(ctx: ViewContext, analyses: Analyses, main: AgentRecord) {
  return Line(ctx, analyses, main, { text: 'coordinator', dim: true })
}
