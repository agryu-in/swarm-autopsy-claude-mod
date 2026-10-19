// F2 · the ledger table. Wide: every token category, total, requests, ≈$ (cost
// on) and the F3 bucket, with the session total row first. Compact and medium:
// the agent's chip, its total and a mini token bar (its categories open with
// the focused agent's detail). Rows are direct usage; an agent with
// descendants gets a dim "spawn tree (overlaps)" line that is never added.
//
// The terminal draws each row as one padded monospaced line. The desktop draws
// fixed-width Box cells (Sunset Glass §8, SG-6): the figure columns are
// right-aligned `mono` cells anchored to the table's right edge, so they line
// up on every row whatever the proportional font does with the names; the
// session row is highlighted, the bucket a pill, the spawn tree a muted pill.

import type { RenderChildren } from 'claude-code'

import type { LedgerRow, LedgerTotals, LedgerView } from '../../types'
import { compact, plural } from '../lib/format'
import { GLASS, TOKEN_CATEGORIES, type TokenCategory } from '../lib/palette'
import type { ViewContext } from './common'
import { BarStrip, Disclosure, MeasureTag, Pill, Row, TokenBar, glass, layoutFor, paintsGlass } from './kit'
import { AgentOutcomeDetail } from './outcome'
import {
  AgentCell,
  AgentName,
  BUCKET_LABEL,
  BucketBadge,
  BucketPill,
  Cell,
  FigureCell,
  TextCell,
  UnknownUsage,
  agentWords,
  chipCells,
  costCells,
  costRun,
  hasUsage,
  padStart,
  unknownUsageText,
  type BucketName,
  type LedgerLinks,
} from './spend-common'
import { AgentLedgerDetail } from './spend-ledger-detail'

const MAX_INDENT_DEPTH = 6
/** Rows drawn before the rest go behind "N more agents" (the focused agent's row is always drawn). */
const ROW_CAP = 20
/** Cells per numeric column in the wide table (a compact figure is at most six cells). */
const CATEGORY_CELLS: Record<TokenCategory, number> = { input: 7, cacheRead: 11, cacheWrite: 12, output: 7 }
const TOTAL_CELLS = 8
const REQ_CELLS = 6
/** The measure label's slot before the numbers: `● `. */
const LABEL_CELLS = 2
/** The selection marker Row draws: `▸ `. */
const MARKER_CELLS = 2
const BADGE_CELLS = 2 + Math.max(...Object.values(BUCKET_LABEL).map(l => l.length)) + 2
const NUMBER_CELLS = Object.values(CATEGORY_CELLS).reduce((a, b) => a + b, 0) + TOTAL_CELLS + REQ_CELLS
/** The compact total, right-aligned. */
const BRIEF_TOTAL_CELLS = 5
const BRIEF_WORDS_CELLS = 16
/** A row's mini token bar shows its categories' mix, not its size (the largest-use bars show size). */
const BRIEF_BAR_CELLS = 12
/** Desktop brief columns: the total and `N req`. */
const DESK_BRIEF_TOTAL_CELLS = 7
const DESK_BRIEF_REQ_CELLS = 8
/** The desktop name column never grows past this, so a wide pane does not open a gap before the figures. */
const DESK_MAX_NAME_CELLS = 40
const DESK_MIN_NAME_CELLS = 6
/** Cells of indent per spawn-tree level on the desktop (a Box padding, not spaces). */
const DESK_INDENT_CELLS = 2

type Shape = {
  full: boolean
  nameCells: number
  costColumn: number
  barCells: number
  withWords: boolean
  withBadge: boolean
}

function indentOf(ctx: ViewContext, row: LedgerRow): string {
  return (ctx.layout === 'compact' ? ' ' : '  ').repeat(Math.min(row.depth, MAX_INDENT_DEPTH))
}

function shapeOf(ctx: ViewContext, view: LedgerView, rows: readonly LedgerRow[], showCost: boolean, withBadge: boolean): Shape {
  const costColumn = showCost ? 2 + Math.max(0, ...[view.session, ...rows.map(r => r.direct)].map(t => costCells(t.cost))) : 0
  const badge = withBadge ? BADGE_CELLS : 0
  if (ctx.layout === 'wide') {
    const nameCells = Math.max(10, ctx.width - MARKER_CELLS - LABEL_CELLS - NUMBER_CELLS - costColumn - badge)
    return { full: true, nameCells, costColumn, barCells: 0, withWords: true, withBadge }
  }
  const withWords = ctx.layout === 'medium'
  const cells = rows.map(r => indentOf(ctx, r).length + chipCells(ctx, r.agentId) + (withWords && agentWords(ctx, r.agentId) ? 1 + BRIEF_WORDS_CELLS : 0))
  const nameCells = Math.max(0, ...cells)
  const fixed = MARKER_CELLS + nameCells + 1 + LABEL_CELLS + BRIEF_TOTAL_CELLS + 1 + (withWords ? 8 + badge : 0) + costColumn
  return { full: false, nameCells, costColumn, barCells: Math.max(4, Math.min(BRIEF_BAR_CELLS, ctx.width - fixed)), withWords, withBadge: withBadge && withWords }
}

function badgeOf(links: LedgerLinks, agentId: string): BucketName | undefined {
  return links.outcome?.buckets.find(b => b.agents.includes(agentId))?.bucket
}

// ── the terminal: one padded monospaced line per row ──

function numbers(totals: LedgerTotals): string {
  const t = totals.tokens
  return (
    TOKEN_CATEGORIES.map(c => padStart(compact(t[c.key]), CATEGORY_CELLS[c.key])).join('') +
    padStart(compact(totals.processed), TOTAL_CELLS) +
    padStart(String(totals.requests), REQ_CELLS)
  )
}

/** The ≈$ cell: right-aligned in its column, drawn by CostText; blank where usage is unknown. */
function CostCell(ctx: ViewContext, totals: LedgerTotals, shape: Shape, showCost: boolean) {
  const { Text } = ctx.els
  if (shape.costColumn === 0) return ''
  if (!showCost || !hasUsage(totals) || !totals.cost) return ' '.repeat(shape.costColumn)
  return (
    <Text>
      {' '.repeat(Math.max(1, shape.costColumn - costCells(totals.cost)))}
      {costRun(ctx, totals.cost, true)}
    </Text>
  )
}

function HeaderLine(ctx: ViewContext, shape: Shape) {
  const { Text } = ctx.els
  return (
    <Text wrap="truncate-end" dimColor>
      {'  '}
      {'agent'.padEnd(shape.nameCells)}
      {' '.repeat(LABEL_CELLS)}
      {TOKEN_CATEGORIES.map(c => (
        <Text color={c.role}>{padStart(c.short, CATEGORY_CELLS[c.key])}</Text>
      ))}
      {padStart('total', TOTAL_CELLS)}
      {padStart('req', REQ_CELLS)}
      {shape.costColumn > 0 ? padStart('≈$', shape.costColumn) : ''}
      {shape.withBadge ? '  outcome' : ''}
    </Text>
  )
}

function SessionLine(ctx: ViewContext, view: LedgerView, shape: Shape, showCost: boolean) {
  const { Text } = ctx.els
  const s = view.session
  if (!hasUsage(s)) return null
  return (
    <Text wrap="truncate-end" weight="bold">
      {'  '}
      {'Σ session'.padEnd(shape.nameCells)}
      {MeasureTag(ctx, 'OBSERVED', false)}{' '}
      <Text tabular>{numbers(s)}</Text>
      {CostCell(ctx, s, shape, showCost)}
    </Text>
  )
}

function FullRowText(ctx: ViewContext, row: LedgerRow, shape: Shape, showCost: boolean, bucket: BucketName | undefined) {
  const { Text } = ctx.els
  const indent = indentOf(ctx, row)
  const d = row.direct
  const usage = hasUsage(d) ? (
    <Text>
      {MeasureTag(ctx, 'OBSERVED', false)} <Text tabular>{numbers(d)}</Text>
    </Text>
  ) : (
    <Text>
      {UnknownUsage(ctx, d)}
      {' '.repeat(Math.max(1, LABEL_CELLS + NUMBER_CELLS - 2 - unknownUsageText(d).length))}
    </Text>
  )
  return (
    <Text wrap="truncate-end">
      {indent}
      {AgentCell(ctx, row.agentId, shape.nameCells - indent.length, true)}
      {usage}
      {CostCell(ctx, d, shape, showCost)}
      {shape.withBadge && bucket ? <Text>{'  '}{BucketBadge(ctx, bucket)}</Text> : ''}
    </Text>
  )
}

function BriefRowText(ctx: ViewContext, row: LedgerRow, shape: Shape, showCost: boolean, bucket: BucketName | undefined) {
  const { Text } = ctx.els
  const indent = indentOf(ctx, row)
  const d = row.direct
  const cell = AgentCell(ctx, row.agentId, shape.nameCells - indent.length, shape.withWords)
  if (!hasUsage(d)) {
    return (
      <Text wrap="truncate-end">
        {indent}
        {cell} {UnknownUsage(ctx, d)}
      </Text>
    )
  }
  return (
    <Text wrap="truncate-end">
      {indent}
      {cell} {MeasureTag(ctx, 'OBSERVED', false)}{' '}
      <Text weight="bold" tabular>
        {padStart(compact(d.processed), BRIEF_TOTAL_CELLS)}
      </Text>{' '}
      {TokenBar(ctx, d.tokens, shape.barCells)}
      {shape.withWords ? ` ${padStart(String(d.requests), 3)} req` : ''}
      {CostCell(ctx, d, shape, showCost)}
      {shape.withBadge && bucket ? <Text>{'  '}{BucketBadge(ctx, bucket)}</Text> : ''}
    </Text>
  )
}

/** The spawn tree's usage: a dim second line, labelled as overlapping, never summed with the rows. */
function SpawnTreeText(ctx: ViewContext, row: LedgerRow, showCost: boolean) {
  const { Text } = ctx.els
  const s = row.subtree
  return (
    <Text dimColor wrap="truncate-end">
      spawn tree (overlaps){' '}
      {hasUsage(s) ? (
        <Text>
          {MeasureTag(ctx, 'OBSERVED', false)} {compact(s.processed)} · {plural(s.agents, 'agent')}
          {showCost && s.cost ? <Text> {costRun(ctx, s.cost, true)}</Text> : ''}
        </Text>
      ) : (
        <Text>
          {UnknownUsage(ctx, s)} · {plural(s.agents, 'agent')}
        </Text>
      )}
    </Text>
  )
}

function SpawnTreeLine(ctx: ViewContext, row: LedgerRow, showCost: boolean) {
  const { Box, Text } = ctx.els
  if (row.subtree.agents <= 1) return null
  if (paintsGlass(ctx)) {
    // Desktop: a muted pill under the agent's name, indented by a Box (spaces would not line up in a proportional face).
    const depth = Math.min(row.depth, MAX_INDENT_DEPTH)
    return (
      <Box key={`lgs-${row.agentId}`} flexDirection="row" paddingLeft={MARKER_CELLS + DESK_INDENT_CELLS * (depth + 1)}>
        {Pill(ctx, { children: SpawnTreeText(ctx, row, showCost) })}
      </Box>
    )
  }
  return (
    <Text dimColor wrap="truncate-end">
      {'    '}
      {indentOf(ctx, row)}
      {SpawnTreeText(ctx, row, showCost)}
    </Text>
  )
}

// ── the desktop: fixed-width Box cells ──

/** The desktop columns after the name: which there are and how wide, the same on the header and every row. */
type DeskColumns = { full: boolean; bar: boolean; cost: number; badge: number; fixed: number }

function deskColumnsOf(ctx: ViewContext, shape: Shape): DeskColumns {
  const badge = shape.withBadge ? BADGE_CELLS : 0
  const cost = shape.costColumn
  if (shape.full) return { full: true, bar: false, cost, badge, fixed: LABEL_CELLS + NUMBER_CELLS + cost + badge }
  // Compact: figures only (§10: no miniature charts there); medium adds the categories' mix as a Box bar.
  const bar = ctx.layout === 'medium'
  return { full: false, bar, cost, badge, fixed: LABEL_CELLS + DESK_BRIEF_TOTAL_CELLS + (bar ? BRIEF_BAR_CELLS : 0) + DESK_BRIEF_REQ_CELLS + cost + badge }
}

/** The table's width on the desktop: the pane's, but the name column stops growing at its cap. */
function deskTableWidth(ctx: ViewContext, cols: DeskColumns): number {
  return Math.min(ctx.width, MARKER_CELLS + DESK_MAX_NAME_CELLS + cols.fixed)
}

/** The cells a row holds: the name grows, every other column has its fixed width; right-anchored, so they line up. */
function CellRow(ctx: ViewContext, cells: RenderChildren[]) {
  const { Box } = ctx.els
  return (
    <Box flexDirection="row" flexGrow={1}>
      {cells}
    </Box>
  )
}

/** The figure cells of a totals line, or the unknown usage across them. */
function deskFigures(ctx: ViewContext, totals: LedgerTotals, cols: DeskColumns, bold: boolean) {
  const span = cols.full ? LABEL_CELLS + NUMBER_CELLS : LABEL_CELLS + DESK_BRIEF_TOTAL_CELLS + (cols.bar ? BRIEF_BAR_CELLS : 0) + DESK_BRIEF_REQ_CELLS
  if (!hasUsage(totals)) return [TextCell(ctx, span, UnknownUsage(ctx, totals))]
  const label = TextCell(ctx, LABEL_CELLS, MeasureTag(ctx, 'OBSERVED', false))
  if (cols.full) {
    return [
      label,
      ...TOKEN_CATEGORIES.map(c => FigureCell(ctx, CATEGORY_CELLS[c.key], compact(totals.tokens[c.key]), { bold })),
      FigureCell(ctx, TOTAL_CELLS, compact(totals.processed), { bold: true }),
      FigureCell(ctx, REQ_CELLS, String(totals.requests), { bold }),
    ]
  }
  return [
    label,
    FigureCell(ctx, DESK_BRIEF_TOTAL_CELLS, compact(totals.processed), { bold: true }),
    cols.bar
      ? Cell(
          ctx,
          BRIEF_BAR_CELLS,
          BarStrip(
            ctx,
            TOKEN_CATEGORIES.map(c => ({ value: totals.tokens[c.key], role: c.role })),
            BRIEF_BAR_CELLS - 2,
          ),
          { indent: 1 },
        )
      : null,
    FigureCell(ctx, DESK_BRIEF_REQ_CELLS, `${totals.requests} req`, { bold }),
  ]
}

/** The ≈$ column cell: CostText right-aligned; empty where there is no estimate (unknown usage, cost off). */
function deskCost(ctx: ViewContext, totals: LedgerTotals, cols: DeskColumns, showCost: boolean) {
  if (cols.cost === 0) return null
  return FigureCell(ctx, cols.cost, showCost && hasUsage(totals) && totals.cost ? costRun(ctx, totals.cost, true) : '')
}

/** The wide table's header: the same cells as its rows (the brief tables have none, as on the terminal). */
function DeskHeader(ctx: ViewContext, cols: DeskColumns) {
  const { Box, Text } = ctx.els
  const head = (width: number, label: string, color?: string) => Cell(ctx, width, <Text wrap="truncate-end" {...(color ? { color } : {})}>{label}</Text>, { end: true })
  const figures = [...TOKEN_CATEGORIES.map(c => head(CATEGORY_CELLS[c.key], c.short, c.role)), head(TOTAL_CELLS, 'total'), head(REQ_CELLS, 'req')]
  return (
    <Box key="lgt-head" flexDirection="row" paddingLeft={MARKER_CELLS}>
      <Box flexDirection="row" flexGrow={1}>
        {TextCell(ctx, DESK_MIN_NAME_CELLS, 'agent', { grow: true, dim: true })}
        {TextCell(ctx, LABEL_CELLS, ' ')}
        {figures}
        {cols.cost > 0 ? head(cols.cost, '≈$') : null}
        {cols.badge > 0 ? TextCell(ctx, cols.badge, 'outcome', { dim: true, indent: 2 }) : null}
      </Box>
    </Box>
  )
}

/** The session total row: Σ direct, highlighted on the glass, never main's spawn tree. */
function DeskSession(ctx: ViewContext, view: LedgerView, cols: DeskColumns, showCost: boolean) {
  const { Box } = ctx.els
  const s = view.session
  if (!hasUsage(s)) return null
  return (
    <Box key="lgt-session" flexDirection="row" paddingLeft={MARKER_CELLS} backgroundColor={GLASS.raised}>
      {CellRow(ctx, [
        TextCell(ctx, DESK_MIN_NAME_CELLS, 'Σ session', { grow: true, bold: true }),
        ...deskFigures(ctx, s, cols, true),
        deskCost(ctx, s, cols, showCost),
        cols.badge > 0 ? TextCell(ctx, cols.badge, ' ') : null,
      ])}
    </Box>
  )
}

function deskRowCells(ctx: ViewContext, row: LedgerRow, cols: DeskColumns, showCost: boolean, bucket: BucketName | undefined) {
  const depth = Math.min(row.depth, MAX_INDENT_DEPTH)
  const name = Cell(ctx, DESK_MIN_NAME_CELLS, AgentName(ctx, row.agentId, ctx.layout !== 'compact'), { grow: true, indent: DESK_INDENT_CELLS * depth })
  return CellRow(ctx, [
    name,
    ...deskFigures(ctx, row.direct, cols, false),
    deskCost(ctx, row.direct, cols, showCost),
    cols.badge > 0 ? Cell(ctx, cols.badge, bucket ? BucketPill(ctx, bucket) : null, { indent: 2 }) : null,
  ])
}

// ── rows and the focused detail ──

/** The focused agent's ledger and outcome details, under its row: side by side when wide, stacked otherwise. */
function FocusDetail(ctx: ViewContext, row: LedgerRow, showCost: boolean, links: LedgerLinks) {
  const { Box } = ctx.els
  const agent = links.outcome?.agents.find(a => a.agentId === row.agentId)
  const outcome = (inner: ViewContext) => (links.trail ? AgentOutcomeDetail(inner, agent, links.trail) : null)
  // Desktop: the selected detail sits in a sunken glass panel (the one panel-in-a-panel §6 allows).
  const panel = paintsGlass(ctx) ? { ...glass(ctx, 'sunken'), paddingX: 1 } : {}
  const frame = paintsGlass(ctx) ? 4 : 0
  if (ctx.layout === 'wide') {
    const cells = Math.floor((ctx.width - 3 - frame) / 2)
    const inner: ViewContext = { ...ctx, width: cells, layout: layoutFor(cells) }
    return (
      <Box flexDirection="row" columnGap={1} marginLeft={2} marginBottom={1} {...panel}>
        <Box flexDirection="column" width={cells}>
          {AgentLedgerDetail(inner, row, showCost)}
        </Box>
        <Box flexDirection="column" width={cells}>
          {outcome(inner)}
        </Box>
      </Box>
    )
  }
  const cells = Math.max(20, ctx.width - 2 - frame)
  const inner: ViewContext = { ...ctx, width: cells, layout: layoutFor(cells) }
  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1} {...panel}>
      {AgentLedgerDetail(inner, row, showCost)}
      {outcome(inner)}
    </Box>
  )
}

function AgentRow(ctx: ViewContext, row: LedgerRow, shape: Shape, cols: DeskColumns, showCost: boolean, links: LedgerLinks) {
  const { Box } = ctx.els
  const focused = ctx.ui.focus === row.agentId
  const bucket = badgeOf(links, row.agentId)
  return (
    <Box key={`lgr-${row.agentId}`} flexDirection="column">
      {Row(ctx, {
        key: `lg-${row.agentId}`,
        selected: focused,
        onPress: () => ctx.act.toggleFocus(row.agentId),
        children: shape.full ? FullRowText(ctx, row, shape, showCost, bucket) : BriefRowText(ctx, row, shape, showCost, bucket),
        cells: paintsGlass(ctx) ? deskRowCells(ctx, row, cols, showCost, bucket) : undefined,
      })}
      {SpawnTreeLine(ctx, row, showCost)}
      {focused ? FocusDetail(ctx, row, showCost, links) : null}
    </Box>
  )
}

/**
 * The ledger table: a header and the session total row first when wide, then one row per agent in spawn-tree order.
 * The caller draws the section's heading.
 */
export function LedgerTable(ctx: ViewContext, view: LedgerView, showCost: boolean, links: LedgerLinks) {
  const { Box } = ctx.els
  const focusRow = view.rows.find(r => r.agentId === ctx.ui.focus)
  const head = view.rows.slice(0, ROW_CAP)
  const shown = focusRow && !head.includes(focusRow) ? [...head, focusRow] : head
  const rest = view.rows.filter(r => !shown.includes(r))
  const shape = shapeOf(ctx, view, view.rows, showCost, links.outcome !== undefined)
  const cols = deskColumnsOf(ctx, shape)
  const desktop = paintsGlass(ctx)
  const header = desktop ? (shape.full ? DeskHeader(ctx, cols) : null) : shape.full ? HeaderLine(ctx, shape) : null
  const session = desktop ? (shape.full ? DeskSession(ctx, view, cols, showCost) : null) : shape.full ? SessionLine(ctx, view, shape, showCost) : null
  return (
    <Box flexDirection="column" {...(desktop ? { width: deskTableWidth(ctx, cols) } : {})}>
      {header}
      {session}
      {shown.map(row => AgentRow(ctx, row, shape, cols, showCost, links))}
      {rest.length > 0
        ? Disclosure(ctx, 'spend-more-rows', `${plural(rest.length, 'more agent')}`, () => (
            <Box flexDirection="column">{rest.map(row => AgentRow(ctx, row, shape, cols, showCost, links))}</Box>
          ))
        : null}
    </Box>
  )
}
