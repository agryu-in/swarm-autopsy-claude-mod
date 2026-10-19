// Small pieces the Spend tab's ledger, bars and outcome sections share: bucket
// badges and pills, the "usage unknown" wording, note lines, the terminal's
// cell padding, and the Sunset Glass pieces (DESIGN-CONTRACT §6, §8): sections
// that are glass tiles from the medium layout up, and the fixed-width Box cells
// that line the desktop's columns up whatever its proportional font does
// (R1 §5.3). Pure drawing over the views' own fields; nothing here prices or
// classifies.

import type { RenderChildren } from 'claude-code'

import type { CostEstimate, LedgerTotals, SpendBucket, SpendOutcome } from '../../types'
import { BUCKET_WORDS, pct, plural, shortId } from '../lib/format'
import { agentRecord } from '../lib/outcome'
import { ROLE } from '../lib/palette'
import { formatUsd } from '../lib/pricing'
import type { Trail } from '../lib/trail'
import type { ViewContext } from './common'
import { AgentChip, CostText, GlassPanel, Heading, MeasureTag, type GlassTone } from './kit'

export type BucketName = SpendBucket['bucket']

/** What the ledger table needs from F3: each row's bucket, and the focused agent's outcome detail. */
export type LedgerLinks = { outcome?: SpendOutcome; trail?: Trail }

/** F3's bucket ids in words: the one table every view uses (`BUCKET_WORDS`, Sunset Glass §4.3). */
export const BUCKET_LABEL: Record<BucketName, string> = BUCKET_WORDS

// The bucket badge and pill are the kit's (one badge for every view, Sunset Glass §8); re-exported for Spend's files.
export { BucketBadge, BucketPill } from './kit'

/** Whether these totals carry any observed token count. */
export function hasUsage(totals: Pick<LedgerTotals, 'requests'> | undefined): boolean {
  return totals !== undefined && totals.requests > 0
}

/**
 * Usage the ledger cannot give as a number: requests that all came back without usage, or none heard at all.
 * Never a zero (DESIGN-CONTRACT §4.3, O5).
 */
export function unknownUsageText(totals: Pick<LedgerTotals, 'requests' | 'requestsWithoutUsage'> | undefined): string {
  const without = totals?.requestsWithoutUsage ?? 0
  return `usage unknown (${without > 0 ? `${plural(without, 'request')} without usage` : 'no request heard'})`
}

/** `∅ usage unknown (2 requests without usage)` in the unavailable colour. */
export function UnknownUsage(ctx: ViewContext, totals: Pick<LedgerTotals, 'requests' | 'requestsWithoutUsage'> | undefined) {
  const { Text } = ctx.els
  return (
    <Text color={ROLE.muted}>
      {MeasureTag(ctx, 'UNAVAILABLE', false)} {unknownUsageText(totals)}
    </Text>
  )
}

/** A share of a stated denominator, as exact arithmetic over two observed counts; undefined without a denominator. */
export function shareOf(part: number, denominator: number): number | undefined {
  return denominator > 0 ? (part / denominator) * 100 : undefined
}

/** `● 452k · 57%`: one OBSERVED label covers the count and its share of the stated denominator. */
export function shareText(processed: string, share: number | undefined): string {
  return share === undefined ? processed : `${processed} · ${pct(share)}`
}

/** The ≈$ run when cost is on and the figure exists; an empty string otherwise, so it can sit inside a Text. */
export function costRun(ctx: ViewContext, cost: CostEstimate | undefined, showCost: boolean) {
  return CostText(ctx, cost, showCost) ?? ''
}

/** How many cells `CostText` draws for this estimate (for right-aligned columns). */
export function costCells(cost: CostEstimate | undefined): number {
  return cost ? 1 + formatUsd(cost.usd).length + (cost.complete ? 0 : 1) : 0
}

/** "API-equivalent at <date> prices, not a charge": said wherever a ≈$ figure is drawn alone. */
export function costCaveat(cost: CostEstimate): string {
  return `API-equivalent at ${cost.priceDate} prices, not a charge`
}

// KIT-CANDIDATE: the cell width AgentChip draws without a name, so tables can align the columns after it.
export function chipCells(ctx: ViewContext, agentId: string): number {
  const agent = agentRecord(ctx.snapshot, agentId)
  if (agent?.isMain || (!agent && agentId === 'main')) return '◎ main'.length
  return (agent?.label ?? '?').length + 2
}

/** The words after an agent's chip: its type, or the short id of a loop never seen as an agent; none for main. */
export function agentWords(ctx: ViewContext, agentId: string): string {
  const agent = agentRecord(ctx.snapshot, agentId)
  if (agent?.isMain || (!agent && agentId === 'main')) return ''
  return agent ? (agent.type ?? 'type unknown') : shortId(agentId)
}

/** Text padded on the left to `width` cells (numbers in a terminal table, right-aligned by padding). */
export function padStart(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text
}

/** Text cut or padded on the right to exactly `width` cells. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length > width) return width === 1 ? '…' : `${text.slice(0, width - 1)}…`
  return text + ' '.repeat(width - text.length)
}

/** An agent's chip then its words, cut or padded to `width` cells in all (the terminal's padded columns). */
export function AgentCell(ctx: ViewContext, agentId: string, width: number, withWords: boolean) {
  const { Text } = ctx.els
  const chip = chipCells(ctx, agentId)
  const words = withWords ? agentWords(ctx, agentId) : ''
  const room = Math.max(0, width - chip)
  const rest = words && room > 1 ? ` ${fit(words, room - 1)}` : ' '.repeat(room)
  return (
    <Text>
      {AgentChip(ctx, agentId)}
      {rest}
    </Text>
  )
}

/** An agent's chip and its words with no padding, for a Box cell that sizes and cuts it (desktop). */
export function AgentName(ctx: ViewContext, agentId: string, withWords: boolean) {
  const { Text } = ctx.els
  const words = withWords ? agentWords(ctx, agentId) : ''
  return (
    <Text wrap="truncate-end">
      {AgentChip(ctx, agentId)}
      {words ? <Text> {words}</Text> : ''}
    </Text>
  )
}

/**
 * A sub-heading inside an agent's detail (the Live inspector and the Spend tab both draw it): the kit's level-2
 * `Heading`, then the agent's chip and words. Without an agent, the title alone.
 */
export function DetailHeading(ctx: ViewContext, title: string, agentId?: string) {
  const { Text } = ctx.els
  const words = agentId === undefined ? '' : agentWords(ctx, agentId)
  return (
    <Text wrap="truncate-end">
      {Heading(ctx, title, { level: 2 })}
      {agentId === undefined ? '' : <Text dimColor> · </Text>}
      {agentId === undefined ? '' : AgentChip(ctx, agentId)}
      {words ? <Text dimColor> {words}</Text> : ''}
    </Text>
  )
}

/**
 * A note from a view's `notes`. A note that states a count carries the OBSERVED label (the counts are read from the
 * ledger); the rest are plain sentences. Notes are housekeeping: `ROLE.neutral` where a caller colours them.
 */
export function NoteLine(ctx: ViewContext, note: string, color?: string) {
  const { Text } = ctx.els
  const counted = /\d/.test(note)
  return (
    <Text wrap="wrap" color={color} dimColor={color === undefined}>
      {counted ? MeasureTag(ctx, 'OBSERVED', false) : <Text>·</Text>} {note}
    </Text>
  )
}

// ── Sunset Glass: sections and cells ──

/** Cells a tile's round border and side padding take from its width (both surfaces size by the terminal's cells). */
const TILE_FRAME_CELLS = 4

// KIT-CANDIDATE: a section that is a glass tile from the medium layout up and plain lines in the compact one (§10: no
// tiles when compact). GlassPanel has no compact form today.
/** A section: a glass tile (`tone`) with its title from the medium layout up; a heading over plain lines when compact. */
export function Section(
  ctx: ViewContext,
  input: { key?: string; tone: GlassTone; edge?: string; title: string; summary?: string; width?: number; children?: RenderChildren },
) {
  const { Box } = ctx.els
  if (ctx.layout === 'compact') {
    return (
      <Box key={input.key} flexDirection="column" width={input.width}>
        {Heading(ctx, input.title, input.summary ? { summary: input.summary } : {})}
        {input.children ?? null}
      </Box>
    )
  }
  return GlassPanel(ctx, input)
}

/** The context inside a section of `width` cells (the tile's frame taken off when it is a tile); the layout stays. */
export function insideSection(ctx: ViewContext, width: number = ctx.width): ViewContext {
  return { ...ctx, width: ctx.layout === 'compact' ? width : Math.max(20, width - TILE_FRAME_CELLS) }
}

// KIT-CANDIDATE: fixed-width column cells (the desktop's aligned tables; events.tsx draws the same thing inline).
type CellOptions = { end?: boolean; grow?: boolean; indent?: number; key?: string }

/**
 * A column cell (desktop): `width` cells that never shrink, the content right-aligned with `end`. `grow` takes the room
 * the fixed cells leave (at least `width`), so the fixed columns after it line up on the right edge of every row.
 */
export function Cell(ctx: ViewContext, width: number, child: RenderChildren, opts: CellOptions = {}) {
  const { Box } = ctx.els
  const size = opts.grow ? { width: 0, flexGrow: 1, minWidth: Math.max(1, width) } : { width: Math.max(1, width), flexShrink: 0 }
  return (
    <Box
      key={opts.key}
      {...size}
      {...(opts.end ? { justifyContent: 'flex-end' as const } : {})}
      {...(opts.indent ? { paddingLeft: opts.indent } : {})}
    >
      {child}
    </Box>
  )
}

/** A cell of plain text, cut with an ending ellipsis rather than wrapped. */
export function TextCell(ctx: ViewContext, width: number, children: RenderChildren, opts: CellOptions & { dim?: boolean; bold?: boolean } = {}) {
  const { Text } = ctx.els
  return Cell(
    ctx,
    width,
    <Text wrap="truncate-end" dimColor={opts.dim === true} {...(opts.bold ? { weight: 'bold' as const } : {})}>
      {children}
    </Text>,
    opts,
  )
}

/**
 * A right-aligned figure cell: `mono` and `tabular`, so the digits of every row stand in the same columns. `mono: false`
 * keeps tabular digits in the body face, for a figure with words or separators (`● 452k · 57%`).
 */
export function FigureCell(ctx: ViewContext, width: number, children: RenderChildren, opts: { bold?: boolean; dim?: boolean; mono?: boolean } = {}) {
  const { Text } = ctx.els
  return Cell(
    ctx,
    width,
    <Text mono={opts.mono !== false} tabular wrap="truncate-end" dimColor={opts.dim === true} {...(opts.bold ? { weight: 'bold' as const } : {})}>
      {children}
    </Text>,
    { end: true },
  )
}
