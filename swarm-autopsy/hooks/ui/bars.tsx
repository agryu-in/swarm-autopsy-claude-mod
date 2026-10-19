// Sunset Glass bars (docs/sunset-glass/DESIGN-CONTRACT.md §8, SG-5): the cell
// arithmetic every bar shares, and the block bars that stand on their own line.
// On the desktop a block bar is a row of Box segments sized by integer weights,
// so it can never overflow its slot the way a proportional `█` does (R1 §5.2);
// on the terminal it is coloured `█` text, exact to the cell. Lead-owned; the
// kit re-exports everything here. Pure: arithmetic over the values given.

import type { SpendOutcome } from '../../types'
import { BUCKET_ROLE, GLASS, ROLE, withAlpha } from '../lib/palette'
import type { ViewContext } from './common'

const EIGHTHS = '▏▎▍▌▋▊▉'

/** A bar of `cells` cells filled to `fraction` (0–1) with eighth-block precision; the rest is the track. */
export function barCells(fraction: number, cells: number): { filled: string; track: string } {
  const width = Math.max(1, Math.floor(cells))
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const units = Math.round(f * width * 8)
  const full = Math.floor(units / 8)
  const rem = units % 8
  const filled = '█'.repeat(full) + (rem > 0 ? (EIGHTHS[rem - 1] ?? '') : '')
  return { filled, track: '·'.repeat(Math.max(0, width - full - (rem > 0 ? 1 : 0))) }
}

/**
 * Splits `cells` cells among values by largest remainder; every non-zero value gets at least one cell when there are
 * enough cells. Exact arithmetic on the values given, nothing else.
 */
export function allocateCells(values: readonly number[], cells: number): number[] {
  const width = Math.max(0, Math.floor(cells))
  const clean = values.map(v => (Number.isFinite(v) && v > 0 ? v : 0))
  const total = clean.reduce((a, b) => a + b, 0)
  if (total <= 0 || width === 0) return clean.map(() => 0)
  const raw = clean.map(v => (v / total) * width)
  const alloc = raw.map(Math.floor)
  let left = width - alloc.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    alloc[i] = (alloc[i] ?? 0) + 1
    left -= 1
  }
  const nonZero = clean.filter(v => v > 0).length
  if (nonZero <= width) {
    for (let i = 0; i < clean.length; i++) {
      if ((clean[i] ?? 0) > 0 && alloc[i] === 0) {
        const donor = alloc.reduce((best, n, j) => (n > (alloc[best] ?? 0) ? j : best), 0)
        if ((alloc[donor] ?? 0) > 1) {
          alloc[donor] = (alloc[donor] ?? 0) - 1
          alloc[i] = 1
        }
      }
    }
  }
  return alloc
}

export type BarPart = { value: number; role: string; unknown?: boolean }

/** Box weights out of this total: integers, far under the engine's flexGrow limit of 10,000. */
const WEIGHT_TOTAL = 1000
/** A desktop bar is half a line tall: thin enough to read as a bar beside text, never a block of type. */
const DESKTOP_BAR_ROWS = 0.5

/** A segment's colour on the desktop: an unknown part is its colour, translucent, so it reads as "not counted". */
function segmentColour(part: BarPart): string {
  return part.unknown ? withAlpha(part.role, '66') : part.role
}

/** The terminal's form of a block bar: coloured `█` runs (`░` for an unknown part), one cell each. */
function textBar(ctx: ViewContext, parts: readonly BarPart[], cells: number) {
  const { Text } = ctx.els
  const alloc = allocateCells(
    parts.map(p => p.value),
    cells,
  )
  return (
    <Text mono>
      {parts.map((part, i) =>
        (alloc[i] ?? 0) > 0 ? (
          part.unknown ? (
            <Text color={part.role}>{'░'.repeat(alloc[i] ?? 0)}</Text>
          ) : (
            <Text color={part.role} backgroundColor={part.role}>
              {'█'.repeat(alloc[i] ?? 0)}
            </Text>
          )
        ) : (
          ''
        ),
      )}
    </Text>
  )
}

/**
 * A 100% stacked bar on its own line, `cells` wide. Desktop: Box segments with integer weights (exact proportions,
 * never wider than its cells); terminal: `█` text. The legend, with its numbers, is drawn separately by the caller.
 * Place it as a child of a Box, never inside a Text (for an inline bar use the kit's `StackedBar`).
 */
export function BarStrip(ctx: ViewContext, parts: readonly BarPart[], cells: number) {
  const width = Math.max(1, Math.floor(cells))
  if (ctx.surface === 'terminal') return textBar(ctx, parts, width)
  const { Box } = ctx.els
  const weights = allocateCells(
    parts.map(p => p.value),
    WEIGHT_TOTAL,
  )
  return (
    <Box flexDirection="row" width={width} height={DESKTOP_BAR_ROWS} alignSelf="center">
      {parts.map((part, i) =>
        (weights[i] ?? 0) > 0 ? <Box width={0} flexGrow={weights[i] ?? 0} height={DESKTOP_BAR_ROWS} backgroundColor={segmentColour(part)} /> : null,
      )}
    </Box>
  )
}

/**
 * One share against its track, `cells` wide (largest token use, ≈$ by agent): `fraction` of the bar in `role`, the rest
 * the quiet track. Desktop: two Box segments; terminal: eighth-block text with a dim `·` track.
 */
export function ShareBar(ctx: ViewContext, fraction: number, cells: number, role: string = ROLE.context) {
  const width = Math.max(1, Math.floor(cells))
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  if (ctx.surface === 'terminal') {
    const { Text } = ctx.els
    const { filled, track } = barCells(f, width)
    return (
      <Text mono>
        <Text color={role}>{filled}</Text>
        <Text dimColor>{track}</Text>
      </Text>
    )
  }
  const { Box } = ctx.els
  const fill = Math.round(f * WEIGHT_TOTAL)
  // A positive share never vanishes: at least one weight unit, as the text bar shows at least an eighth.
  const shown = f > 0 ? Math.max(1, fill) : 0
  return (
    <Box flexDirection="row" width={width} height={DESKTOP_BAR_ROWS} alignSelf="center">
      {shown > 0 ? <Box width={0} flexGrow={shown} height={DESKTOP_BAR_ROWS} backgroundColor={role} /> : null}
      {WEIGHT_TOTAL - shown > 0 ? <Box width={0} flexGrow={WEIGHT_TOTAL - shown} height={DESKTOP_BAR_ROWS} backgroundColor={GLASS.track} /> : null}
    </Box>
  )
}

/** Cells the unknown-usage tail takes after a bucket bar. */
const UNKNOWN_TAIL_CELLS = 2

/**
 * F3's spend vs outcome as one bar (§8): every bucket with recorded usage in its colour, then a `░` tail when some
 * agents' usage is unknown (never drawn as a share). `cells` is the whole width, tail included. Nothing when no tokens
 * were processed. Shared by the Trail's outcome box and Spend.
 */
export function BucketBar(ctx: ViewContext, outcome: SpendOutcome, cells: number) {
  const { Box, Text } = ctx.els
  if (outcome.denominator <= 0) return null
  const known = outcome.buckets.filter(b => b.bucket !== 'no-usage-recorded' && b.processed > 0)
  const unknown = outcome.buckets.some(b => b.bucket === 'no-usage-recorded')
  const width = Math.max(4, Math.floor(cells) - (unknown ? UNKNOWN_TAIL_CELLS + 1 : 0))
  const bar = BarStrip(
    ctx,
    known.map(b => ({ value: b.processed, role: BUCKET_ROLE[b.bucket] })),
    width,
  )
  // Always a row Box: the bar's `alignSelf: center` then centres it on its line, never across a column parent.
  return (
    <Box flexDirection="row" columnGap={1}>
      {bar}
      {unknown ? (
        <Text mono color={ROLE.unknownFill}>
          {'░'.repeat(UNKNOWN_TAIL_CELLS)}
        </Text>
      ) : null}
    </Box>
  )
}
