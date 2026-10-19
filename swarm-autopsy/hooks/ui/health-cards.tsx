// Signal cards and their grid, shared by the Health and Collisions views
// (Sunset Glass DESIGN-CONTRACT §11, §12): one card look for both tabs. A card
// reads its level glyph and word, the source's own evidence label and title, the
// agents with the why, then a footer row with the evidence toggle and the actions;
// the opened evidence is drawn inside the card. The grid lays cards out in one
// column up to wide, two in the wide layout and three when expanded, with rows
// balanced (four cards are two by two) and a group of one card taking the whole
// row. Workstream 3 owns this file.

import type { RenderChildren } from 'claude-code'

import type { Evidence, HealthLevel } from '../../types'
import { EVIDENCE_GLYPH, plural } from '../lib/format'
import { ROLE } from '../lib/palette'
import type { ViewContext } from './common'
import { AgentChip, Disclosure, EvidenceTag, LEVEL_STYLE, glass, isExpanded, layoutFor, paintsGlass, type SignalAction } from './kit'

// ── the card ──

/** Cells a card's round border and side padding take, on both surfaces. */
export const CARD_FRAME = 4
/** The least a fitted title or why keeps before it is cut. */
export const MIN_TEXT = 12
/** Agent chips a card draws; the rest are counted (`+N more agents`). */
export const MAX_CHIPS = 8

// KIT-CANDIDATE: SignalCard draws the level word beside its glyph (§12 Option A), the chips on the why line and a
// footer row (evidence toggle + actions). Drawn here until the kit's SignalCard takes these options.
/** Levels whose card edge carries their colour (as the kit's SignalCard); the rest sit on the quiet glass edge. */
const LOUD_LEVELS: ReadonlySet<HealthLevel> = new Set(['investigate', 'unresolved'])

/** Whether the level word is drawn: always, unless the title already starts with it (`? unresolved: No captured outcome`). */
export function showsLevelWord(level: HealthLevel, title: string): boolean {
  return !title.toLowerCase().startsWith(LEVEL_STYLE[level].word)
}

/** The plain text a head draws before its title: the level glyph and word, and the source's evidence glyph. */
export function headPrefix(level: HealthLevel, evidence: Evidence, title: string): string {
  const style = LEVEL_STYLE[level]
  const word = showsLevelWord(level, title) ? ` ${style.word} ·` : ''
  const label = EVIDENCE_GLYPH[evidence] === style.glyph ? '' : ` ${EVIDENCE_GLYPH[evidence]}`
  return `${style.glyph}${word}${label} `
}

/**
 * A finding's head as Text runs: the level glyph and word in the level's colour, the source's evidence glyph (left out
 * where it only repeats the level's: `? ?`, `∅ ∅`, `● ●`), the title in its own words, and an optional dim note.
 */
export function LevelHead(ctx: ViewContext, input: { level: HealthLevel; evidence: Evidence; title: string; note?: string }) {
  const { Text } = ctx.els
  const style = LEVEL_STYLE[input.level]
  const repeats = EVIDENCE_GLYPH[input.evidence] === style.glyph
  return [
    <Text color={style.role} weight="bold">
      {style.glyph}
    </Text>,
    showsLevelWord(input.level, input.title) ? (
      <Text>
        <Text color={style.role}> {style.word}</Text>
        <Text dimColor> ·</Text>
      </Text>
    ) : (
      ''
    ),
    repeats ? '' : <Text> {EvidenceTag(ctx, input.evidence, false)}</Text>,
    ' ',
    <Text weight="semibold">{input.title}</Text>,
    input.note ? <Text dimColor> · {input.note}</Text> : '',
  ]
}

/** The cells an agent chip takes: ` A ` for a letter, `◎ main` for the main loop. */
function chipCells(ctx: ViewContext, agentId: string): number {
  const agent = Object.hasOwn(ctx.snapshot.agents, agentId) ? ctx.snapshot.agents[agentId] : undefined
  if (agent?.isMain || (!agent && agentId === 'main')) return '◎ main'.length
  return (agent?.label ?? '?').length + 2
}

/** The cells a run of chips and its `+N more agents` count take, spaces included. */
export function chipsCells(ctx: ViewContext, agentIds: readonly string[], more = 0): number {
  const chips = agentIds.reduce((sum, id, i) => sum + chipCells(ctx, id) + (i > 0 ? 1 : 0), 0)
  const extra = more > 0 ? ` +${plural(more, 'more agent')}`.length : 0
  return chips + extra
}

/** Agent chips as Text runs, a dim `+N more agents` after them. */
export function ChipRuns(ctx: ViewContext, agentIds: readonly string[], more = 0) {
  const { Text } = ctx.els
  return [
    ...agentIds.map((id, i) => (
      <Text>
        {i > 0 ? ' ' : ''}
        {AgentChip(ctx, id)}
      </Text>
    )),
    more > 0 ? <Text dimColor> +{plural(more, 'more agent')}</Text> : '',
  ]
}

/** The cells left for a card's why line beside its chips (a compact row has no frame). */
export function whyRoom(ctx: ViewContext, agentIds: readonly string[], more = 0): number {
  const frame = ctx.layout === 'compact' ? 0 : CARD_FRAME
  const chips = agentIds.length > 0 || more > 0 ? chipsCells(ctx, agentIds, more) + 1 : 0
  return Math.max(MIN_TEXT, ctx.width - frame - chips)
}

export type EvidenceToggleInput = { key: string; open: boolean; label: string; onPress: () => void }

/**
 * The evidence toggle: `▸ evidence · 2 source events`, `▾` when open. A plain Button: on the terminal its marker keeps
 * the accent colour; on desktop, which draws a Button as one plain line (R1 §4.1), it is a dim plain label.
 */
export function EvidenceToggle(ctx: ViewContext, toggle: EvidenceToggleInput) {
  const { Button, Text } = ctx.els
  const marker = toggle.open ? '▾' : '▸'
  if (paintsGlass(ctx)) return <Button key={toggle.key} plain dimColor label={`${marker} ${toggle.label}`} onPress={toggle.onPress} />
  return (
    <Button key={toggle.key} plain onPress={toggle.onPress}>
      <Text color={ROLE.accent}>{marker}</Text>
      <Text dimColor> {toggle.label}</Text>
    </Button>
  )
}

/** A card's footer row: the evidence toggle first, then the actions. Buttons only, so it wraps cleanly on the terminal. */
export function FooterRow(ctx: ViewContext, toggle: EvidenceToggleInput | undefined, actions: readonly SignalAction[]) {
  const { Box, Button } = ctx.els
  if (!toggle && actions.length === 0) return null
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {toggle ? EvidenceToggle(ctx, toggle) : null}
      {actions.map(action => (
        <Button key={action.key} label={action.label} variant="secondary" onPress={action.onPress} />
      ))}
    </Box>
  )
}

/**
 * The opened evidence inside a card: a sunken glass panel on desktop (a selected detail, the one nesting §6 allows),
 * an indented block on the terminal, where a second border would cost two rows and four cells.
 */
export function EvidencePanel(ctx: ViewContext, children: RenderChildren) {
  const { Box } = ctx.els
  if (!paintsGlass(ctx)) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {children}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" {...glass(ctx, 'sunken')} paddingX={1}>
      {children}
    </Box>
  )
}

export type FindingCardInput = {
  /** The card Box is keyed `sc-<key>`. */
  key: string
  level: HealthLevel
  evidence: Evidence
  /** The source's own title, verbatim. */
  title: string
  /** A dim aside after the title (a folded card's "3 entries"). */
  note?: string
  /** Why it was raised: one line beside the chips, fitted by the caller; wrapped at medium and wider with `wrapWhy`. */
  why: string
  wrapWhy?: boolean
  agentIds: readonly string[]
  /** Agents past the chips, counted after them. */
  moreAgents?: number
  toggle?: EvidenceToggleInput
  actions: readonly SignalAction[]
  /** Inside the card, under the footer row: the opened evidence, or a folded card's rows. */
  body?: RenderChildren
}

/**
 * One finding as a card. Medium and wider: a glass card, its edge amber only for `investigate` and `unresolved` (a
 * value or an observation never looks alarmed), the head wrapping. Compact: the same lines without a frame, each
 * fitted to one row.
 */
export function FindingCard(ctx: ViewContext, input: FindingCardInput) {
  const { Box, Text } = ctx.els
  const compact = ctx.layout === 'compact'
  const more = input.moreAgents ?? 0
  // The title stays verbatim in the tree; a compact row is cut at its end by the surface, never in the text.
  const head = (
    <Text wrap={compact ? 'truncate-end' : 'wrap'}>{LevelHead(ctx, { level: input.level, evidence: input.evidence, title: input.title, note: input.note })}</Text>
  )
  const chips = input.agentIds.length > 0 || more > 0
  const wraps = input.wrapWhy === true && !compact
  const why = input.why
  const whyLine =
    chips || why.trim() ? (
      <Text wrap={wraps ? 'wrap' : 'truncate-end'}>
        {chips ? ChipRuns(ctx, input.agentIds, more) : ''}
        {chips && why.trim() ? ' ' : ''}
        <Text dimColor>{why}</Text>
      </Text>
    ) : null
  const lines = [head, whyLine, FooterRow(ctx, input.toggle, input.actions), input.body ?? null]
  if (compact) {
    return (
      <Box key={`sc-${input.key}`} flexDirection="column">
        {lines}
      </Box>
    )
  }
  const edge = LOUD_LEVELS.has(input.level) ? LEVEL_STYLE[input.level].role : undefined
  return (
    <Box key={`sc-${input.key}`} flexDirection="column" {...glass(ctx, 'base', edge)} paddingX={1}>
      {lines}
    </Box>
  )
}

// ── the grid ──

/** Cells between the grid's columns. */
const COLUMN_GAP = 1
/** The narrowest grid column a card is drawn in; below it the cards stack. */
const COLUMN_MIN = 44

const columnWidth = (width: number, columns: number) => Math.floor((width - COLUMN_GAP * (columns - 1)) / columns)

/**
 * How many columns `count` cards take: one up to wide, two in the wide layout, three when expanded; never more columns
 * than cards, never a column under COLUMN_MIN, and rows balanced (four cards are two by two, not three and one).
 */
function columnsFor(ctx: ViewContext, count: number): number {
  const most = ctx.layout !== 'wide' ? 1 : isExpanded(ctx) ? 3 : 2
  let columns = Math.min(most, Math.max(1, count))
  while (columns > 1 && columnWidth(ctx.width, columns) < COLUMN_MIN) columns -= 1
  if (columns <= 1) return 1
  return Math.ceil(count / Math.ceil(count / columns))
}

/**
 * Cards in balanced columns, each drawn with its column's own width. A column's context keeps the card form (medium)
 * even where its width alone would read as compact: a grid column of a wide pane has room for a card.
 */
export function CardGrid<T>(ctx: ViewContext, keyPrefix: string, items: readonly T[], draw: (cell: ViewContext, item: T, index: number) => RenderChildren) {
  const { Box } = ctx.els
  const columns = columnsFor(ctx, items.length)
  if (columns === 1) {
    return (
      <Box flexDirection="column" rowGap={ctx.layout === 'compact' ? 0 : 1}>
        {items.map((item, index) => draw(ctx, item, index))}
      </Box>
    )
  }
  const width = columnWidth(ctx.width, columns)
  const layout = layoutFor(width)
  const cell: ViewContext = { ...ctx, width, layout: layout === 'compact' ? 'medium' : layout }
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={COLUMN_GAP} rowGap={1}>
      {items.map((item, index) => (
        <Box key={`${keyPrefix}-${index}`} flexDirection="column" width={width}>
          {draw(cell, item, index)}
        </Box>
      ))}
    </Box>
  )
}

export type GridCaps = {
  /** Cards drawn before "show N more". */
  first: number
  /** Cards drawn at most once opened; the rest are counted, with where to find them. */
  max: number
  /** The disclosure id that opens the rest. */
  moreId: string
  /** What a card is, one and many, for "show 1 more signal" and "show 12 more signals". */
  noun: readonly [string, string]
  /** Where every item is listed when more exist than are drawn here. */
  elsewhere: string
}

/**
 * A CardGrid of the first few cards, the rest behind "show N more" (up to a hard maximum, so a crowded session stays
 * within the tree budget), and a count of any past that maximum with where they are all listed.
 */
export function CappedGrid<T>(
  ctx: ViewContext,
  keyPrefix: string,
  items: readonly T[],
  caps: GridCaps,
  draw: (cell: ViewContext, item: T, index: number) => RenderChildren,
) {
  const { Box, Text } = ctx.els
  const head = items.slice(0, caps.first)
  const rest = items.slice(caps.first, caps.max)
  const beyond = items.length - head.length - rest.length
  const more = (n: number) => plural(n, `more ${caps.noun[0]}`, `more ${caps.noun[1]}`)
  return (
    <Box flexDirection="column">
      {CardGrid(ctx, keyPrefix, head, draw)}
      {rest.length > 0
        ? Disclosure(ctx, caps.moreId, `show ${more(rest.length)}`, () => (
            <Box flexDirection="column" marginTop={ctx.layout === 'compact' ? 0 : 1}>
              {CardGrid(ctx, `${keyPrefix}-more`, rest, (cell, item, index) => draw(cell, item, index + caps.first))}
              {beyond > 0 ? (
                <Text dimColor wrap="wrap">
                  +{more(beyond)} not drawn here; {caps.elsewhere}.
                </Text>
              ) : null}
            </Box>
          ))
        : null}
    </Box>
  )
}
