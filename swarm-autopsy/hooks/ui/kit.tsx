// The shared components (visual-redesign DESIGN-CONTRACT §6; Sunset Glass
// DESIGN-CONTRACT §8). Every view draws identity, state, meters, bars, costs,
// chips, signals, rows and glass surfaces through these, so each looks and labels
// the same everywhere. The block bars, glass surfaces and press rows live in
// bars.tsx, glass.tsx and press.tsx and are re-exported here. Lead-owned: a
// workstream that needs a variant asks for it rather than drawing its own.

import type { RenderChildren } from 'claude-code'

import type { AgentRecord, CostEstimate, Evidence, HealthLevel, Measure, SpendBucket, TokenCounts } from '../../types'
import { sparkline } from '../lib/context'
import { BUCKET_WORDS, EVIDENCE_COLOR, EVIDENCE_GLYPH, MEASURE_COLOR, MEASURE_GLYPH, STATE_GLYPH, compact, exact, pct, shortId, stateLabel, truncate } from '../lib/format'
import { BUCKET_ROLE, ROLE, STATE_ROLE, TOKEN_CATEGORIES, chipTextHex, identityHex } from '../lib/palette'
import { formatUsd } from '../lib/pricing'
import { activeTheme, themeFor } from '../lib/themes'
import { allocateCells, barCells, type BarPart } from './bars'
import type { ViewContext } from './common'
import { Pill, glass, paintsGlass } from './glass'
import { textRuns, type RunStyle } from './press'
import { ringSvg, sparkSvg, type SparkMarker } from './svg'

export { BarStrip, BucketBar, ShareBar, allocateCells, barCells, type BarPart } from './bars'
export { Backdrop, ContentAnchor, GlassPanel, LiveDot, Pill, SCENE_KEYS, SceneToolbar, ThemeLine, backgroundAlt, glass, glassHover, paintsGlass, paneTint, sceneFigures, toolbarRows, type GlassTone } from './glass'
export { PressRow, textRuns, type RunStyle } from './press'

// ── layout ──

export type Layout = 'compact' | 'medium' | 'wide'

/** Below this many body columns the pane is compact (the terminal dock at 120 columns gives 49). */
export const COMPACT_BELOW = 56
/** From this many body columns the pane is wide (the classic inline terminal gives 116). */
export const WIDE_FROM = 100

export function layoutFor(width: number): Layout {
  if (width < COMPACT_BELOW) return 'compact'
  return width < WIDE_FROM ? 'medium' : 'wide'
}

/** From this many body columns a wide pane is expanded (Sunset Glass §10): views reorganise, they do not stretch. */
export const EXPANDED_FROM = 140

/** Whether the pane is wide enough for the expanded arrangement (the desktop pane is often about 160 columns). */
export function isExpanded(ctx: Pick<ViewContext, 'layout' | 'width'>): boolean {
  return ctx.layout === 'wide' && ctx.width >= EXPANDED_FROM
}

/** Whether a disclosure or section id is open. */
export function isOpen(ctx: ViewContext, id: string): boolean {
  return ctx.ui.open?.includes(id) === true
}

/** Whether this surface draws Svg (desktop; never the terminal). */
export function drawsSvg(ctx: ViewContext): boolean {
  return ctx.surface !== 'terminal' && 'Svg' in ctx.els
}

function agentOf(ctx: ViewContext, id: string): AgentRecord | undefined {
  return Object.hasOwn(ctx.snapshot.agents, id) ? ctx.snapshot.agents[id] : undefined
}

// ── identity and state ──

/**
 * An agent's identity: its letter on its hue (white, bold), optionally its state glyph and its type. The main loop is
 * `◎ main` in the coordinator's colour; an id never seen as an agent is a grey `?` and its short id.
 */
export function AgentChip(ctx: ViewContext, agentId: string, opts: { name?: boolean; state?: boolean; width?: number } = {}) {
  const { Text } = ctx.els
  const agent = agentOf(ctx, agentId)
  const state = opts.state && agent ? <Text color={STATE_ROLE[agent.state]}> {STATE_GLYPH[agent.state]}</Text> : ''
  if (agent?.isMain || (!agent && agentId === 'main')) {
    return (
      <Text>
        <Text color={ROLE.main} weight="bold">
          ◎ main
        </Text>
        {state}
      </Text>
    )
  }
  const hex = identityHex(agent)
  const letter = agent?.label ?? '?'
  const name = opts.name ? (agent ? (agent.type ?? 'type unknown') : shortId(agentId)) : ''
  const room = opts.width !== undefined ? Math.max(4, opts.width - letter.length - 4) : undefined
  return (
    <Text>
      {hex ? (
        <Text backgroundColor={hex} color={chipTextHex()} weight="bold">
          {` ${letter} `}
        </Text>
      ) : (
        <Text color={ROLE.muted} weight="bold">
          {` ${letter} `}
        </Text>
      )}
      {state}
      {name ? <Text> {room !== undefined ? truncate(name, room) : name}</Text> : ''}
    </Text>
  )
}

/** A lifecycle state as glyph and word in its role colour (`◉ idle` for the main loop when it has finished a turn). */
export function StateBadge(ctx: ViewContext, agent: AgentRecord) {
  const { Text } = ctx.els
  return (
    <Text color={STATE_ROLE[agent.state]}>
      {STATE_GLYPH[agent.state]} {stateLabel(agent)}
    </Text>
  )
}

// ── labels ──

/** A claim's evidence label: glyph, and the word unless `withWord` is false. */
export function EvidenceTag(ctx: ViewContext, evidence: Evidence, withWord = true) {
  const { Text } = ctx.els
  return (
    <Text color={EVIDENCE_COLOR[evidence]} weight="semibold">
      {EVIDENCE_GLYPH[evidence]}
      {withWord ? ` ${evidence}` : ''}
    </Text>
  )
}

/** How a number is supported: OBSERVED, ESTIMATED or UNAVAILABLE, as glyph and (optionally) word. */
export function MeasureTag(ctx: ViewContext, measure: Measure, withWord = true) {
  const { Text } = ctx.els
  return (
    <Text color={MEASURE_COLOR[measure]} weight="semibold">
      {MEASURE_GLYPH[measure]}
      {withWord ? ` ${measure}` : ''}
    </Text>
  )
}

/**
 * The only drawer of ≈$ (DESIGN-CONTRACT §4.6): `≈$1.23`, `+` when a model had no price, and nothing at all when the
 * person has not turned cost on, whatever the view carries.
 */
export function CostText(ctx: ViewContext, cost: CostEstimate | undefined, showCost: boolean) {
  const { Text } = ctx.els
  if (!showCost || !cost) return null
  // Every token unpriced: there is no estimate to show, and "≈$0.00+" would read as free.
  if (!cost.complete && cost.usd === 0) return <Text color={ROLE.muted}>{MEASURE_GLYPH.UNAVAILABLE} no price</Text>
  return (
    <Text color={ROLE.caution}>
      ≈{formatUsd(cost.usd)}
      {cost.complete ? '' : '+'}
    </Text>
  )
}

// ── structure ──

/**
 * A title's colour props: the theme's heading colour (Abyssal's pale sand), or none at all, so a classic drawing (and
 * the terminal) keeps the surface's own text colour and its tree exactly as before themes (SG-14).
 */
export function headingInk(): { color?: string } {
  const color = ROLE.heading
  return color ? { color } : {}
}

/** The sub-heading mark: the active theme's where glass is painted; the terminal always draws classic's `·`. */
function subMarkFor(ctx: ViewContext): string {
  return (paintsGlass(ctx) ? activeTheme() : themeFor(ctx.surface)).chrome.subMark
}

/**
 * A section heading: the accent `▌` mark and a semibold title in the theme's heading colour, with an optional dim
 * summary (Sunset Glass §7). `level: 2` is a sub-heading inside a panel: the theme's sub-heading mark in rose (classic
 * `·`, Abyssal `▎`), body size. With `toggleId` it opens and closes.
 */
export function Heading(ctx: ViewContext, title: string, opts: { summary?: string; toggleId?: string; level?: 1 | 2 } = {}) {
  const { Text, Button } = ctx.els
  const summary = opts.summary ? (
    <Text dimColor wrap="truncate-end">
      {' · '}
      {opts.summary}
    </Text>
  ) : (
    ''
  )
  const sub = opts.level === 2
  if (opts.toggleId) {
    const id = opts.toggleId
    if (paintsGlass(ctx)) {
      const marker = isOpen(ctx, id) ? '▾' : '▸'
      return <Button key={`hd-${id}`} plain label={`${marker} ${title}${opts.summary ? ` · ${opts.summary}` : ''}`} onPress={() => ctx.act.toggleOpen(id)} />
    }
    return (
      <Button key={`hd-${id}`} plain onPress={() => ctx.act.toggleOpen(id)}>
        <Text color={ROLE.accent}>{isOpen(ctx, id) ? '▾' : '▸'} </Text>
        <Text weight="semibold" {...headingInk()}>
          {title}
        </Text>
        {summary}
      </Button>
    )
  }
  return (
    <Text wrap="truncate-end">
      <Text color={sub ? ROLE.rose : ROLE.accent}>{sub ? subMarkFor(ctx) : '▌'}</Text>
      <Text weight="semibold" size={sub ? 'body' : 'heading'} wrap="truncate-end" {...headingInk()}>
        {' '}
        {title}
      </Text>
      {summary}
    </Text>
  )
}

/** A "why?" block: a button that shows or hides `body`, closed unless the person opened it. */
export function Disclosure(ctx: ViewContext, id: string, label: string, body: () => RenderChildren) {
  const { Box, Text, Button } = ctx.els
  const open = isOpen(ctx, id)
  // The desktop draws a Button's label only, one plain line (R1 §4.1): there the marker and words are the label.
  const button = paintsGlass(ctx) ? (
    <Button key={`dc-${id}`} plain dimColor label={`${open ? '▾' : '▸'} ${label}`} onPress={() => ctx.act.toggleOpen(id)} />
  ) : (
    <Button key={`dc-${id}`} plain onPress={() => ctx.act.toggleOpen(id)}>
      <Text color={ROLE.accent}>{open ? '▾' : '▸'}</Text>
      <Text dimColor> {label}</Text>
    </Button>
  )
  return (
    <Box flexDirection="column">
      {button}
      {open ? body() : null}
    </Box>
  )
}

/**
 * The one selectable-row look: ▸ / ▾ in the accent colour, the row bold when selected. Children are Text runs.
 *
 * The desktop app styles only a Button's direct Text children (a chip or a meter nested one level deeper is drawn
 * plain; seen in the desktop paint, 2026-10-18), so the row's content is flattened into sibling runs that each carry
 * their whole style. The terminal wraps a Button's text whatever a Text says, so callers size their rows to the pane.
 */
export function Row(
  ctx: ViewContext,
  props: { key: string; selected: boolean; onPress: () => void; children: RenderChildren; cells?: RenderChildren },
) {
  const { Box, Text, Button } = ctx.els
  const markerText = `${props.selected ? '▾' : '▸'} `
  if (ctx.surface !== 'terminal') {
    // The desktop app draws a Button's content without its runs' styles (seen in its paint, 2026-10-18: no chip, no
    // meter colour), so on desktop the marker is the Button and the styled content sits beside it, unstyled by no one.
    // `cells` (aligned columns as fixed-width Boxes, Sunset Glass §8) replace the content's text there when given.
    return (
      <Box key={`row-${props.key}`} flexDirection="row">
        <Button key={props.key} plain label={markerText} onPress={props.onPress} />
        {props.cells ?? <Text wrap="truncate-end">{props.selected ? <Text weight="bold">{props.children}</Text> : props.children}</Text>}
      </Box>
    )
  }
  const marker = { style: { color: ROLE.accent } as RunStyle, text: markerText }
  const runs = [marker, ...textRuns(props.children, props.selected ? { weight: 'bold' } : {})]
  return (
    <Button key={props.key} plain onPress={props.onPress}>
      {runs.map(run => (
        <Text {...(run.style as Record<string, never>)}>{run.text}</Text>
      ))}
    </Button>
  )
}

/**
 * An empty or not-yet state: a semibold line (a title, in the theme's heading colour) and one dim sentence. On desktop
 * it is a quiet sunken glass tile with an optional glyph, so an empty screen looks intended; the terminal keeps the two
 * plain lines.
 */
export function EmptyState(ctx: ViewContext, title: string, why: string, opts: { glyph?: string } = {}) {
  const { Box, Text } = ctx.els
  const head = (
    <Text weight="semibold" wrap="wrap" {...headingInk()}>
      {opts.glyph ? <Text color={ROLE.neutral}>{opts.glyph} </Text> : ''}
      {title}
    </Text>
  )
  const body = (
    <Text dimColor wrap="wrap">
      {why}
    </Text>
  )
  if (!paintsGlass(ctx)) {
    return (
      <Box flexDirection="column">
        {head}
        {body}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" {...glass(ctx, 'sunken')} paddingX={1}>
      {head}
      {body}
    </Box>
  )
}

// ── meters and bars ──

/**
 * A context meter: a text bar filled to `percent` and its measure label and value. UNAVAILABLE draws `∅ n/a` and no bar.
 * The percent is the view's own (F1's), never computed here.
 */
export function Meter(ctx: ViewContext, input: { percent?: number; measure: Measure; width: number; bare?: boolean }) {
  const { Text } = ctx.els
  if (input.measure === 'UNAVAILABLE' || input.percent === undefined || !Number.isFinite(input.percent)) {
    return <Text color={ROLE.muted}>{MEASURE_GLYPH.UNAVAILABLE} % n/a</Text>
  }
  const { filled, track } = barCells(input.percent / 100, Math.max(4, input.width))
  const role = input.measure === 'ESTIMATED' ? ROLE.caution : ROLE.context
  const full = filled.replace(/[^█]/g, '')
  const partial = filled.slice(full.length)
  // Every bar run is `mono`: in the desktop's monospaced face a `█` is one cell (R1 §5.2), so the meter fits its cells.
  const bar = (
    <Text>
      {full ? (
        <Text mono color={role} backgroundColor={role}>
          {full}
        </Text>
      ) : (
        ''
      )}
      {partial ? (
        <Text mono color={role}>
          {partial}
        </Text>
      ) : (
        ''
      )}
    </Text>
  )
  // `bare`: the bar alone, where the same labelled value is already drawn beside it (a KPI tile).
  if (input.bare) {
    return (
      <Text>
        {bar}
        <Text mono dimColor>
          {track}
        </Text>
      </Text>
    )
  }
  return (
    <Text>
      {bar}
      <Text mono dimColor>
        {track}
      </Text>{' '}
      <Text color={MEASURE_COLOR[input.measure]}>{MEASURE_GLYPH[input.measure]}</Text> {pct(input.percent)}
    </Text>
  )
}

/** A desktop context ring beside the Meter; null on the terminal or when UNAVAILABLE. */
export function Ring(ctx: ViewContext, input: { percent?: number; measure: Measure; label?: string }) {
  if (!drawsSvg(ctx) || input.percent === undefined) return null
  const picture = ringSvg({ percent: input.percent, measure: input.measure, label: input.label })
  if (!picture || !('Svg' in ctx.els)) return null
  const { Svg } = ctx.els
  return <Svg source={picture.source} alt={picture.alt} width={picture.height} height={picture.height} />
}

/**
 * A 100% stacked bar of coloured runs, for use inside a line of text; an unknown part draws `░`. The legend is drawn
 * separately, with its numbers. Every run is `mono`, so on desktop each `█` is one cell and the bar fits its width. A
 * bar on its own line is `BarStrip` (Box segments on desktop).
 */
export function StackedBar(ctx: ViewContext, parts: readonly BarPart[], width: number) {
  const { Text } = ctx.els
  const cells = allocateCells(
    parts.map(p => p.value),
    Math.max(1, width),
  )
  return (
    <Text>
      {parts.map((part, i) =>
        (cells[i] ?? 0) > 0 ? (
          part.unknown ? (
            <Text mono color={part.role}>
              {'░'.repeat(cells[i] ?? 0)}
            </Text>
          ) : (
            // Background and glyph in one colour: a desktop font leaves gaps between block glyphs, a background does not.
            <Text mono color={part.role} backgroundColor={part.role}>
              {'█'.repeat(cells[i] ?? 0)}
            </Text>
          )
        ) : (
          ''
        ),
      )}
    </Text>
  )
}

/** The four token categories as one stacked bar in their fixed colours. */
export function TokenBar(ctx: ViewContext, tokens: TokenCounts, width: number) {
  return StackedBar(
    ctx,
    TOKEN_CATEGORIES.map(c => ({ value: tokens[c.key], role: c.role })),
    width,
  )
}

/** The token categories' legend with their counts: one OBSERVED label for the whole line. */
export function TokenLegend(ctx: ViewContext, tokens: TokenCounts, opts: { exact?: boolean } = {}) {
  const { Text } = ctx.els
  const n = (v: number) => (opts.exact ? exact(v) : compact(v))
  return (
    <Text wrap="wrap">
      {MeasureTag(ctx, 'OBSERVED', false)}
      {TOKEN_CATEGORIES.map((c, i) => (
        <Text>
          {i === 0 ? ' ' : ' · '}
          <Text color={c.role}>■</Text> {c.short} {n(tokens[c.key])}
        </Text>
      ))}
    </Text>
  )
}

/** A text sparkline of per-request values (oldest first) in the context colour, with an optional dim label. `mono`. */
export function Sparkline(ctx: ViewContext, values: readonly number[], width: number, opts: { label?: string; dim?: boolean } = {}) {
  const { Text } = ctx.els
  const spark = sparkline(values, Math.max(1, width))
  if (!spark) return null
  return (
    <Text wrap="truncate-end">
      <Text mono color={opts.dim ? ROLE.muted : ROLE.context}>
        {spark}
      </Text>
      {opts.label ? <Text dimColor> {opts.label}</Text> : ''}
    </Text>
  )
}

/** The desktop area chart's width in CSS px (its height is the chart's own, 48 px). */
const SPARK_CHART_PX = 260

/** The desktop area chart of per-request values with captured markers; null on the terminal or with under two values. */
export function SparkChart(ctx: ViewContext, input: { values: readonly number[]; markers?: readonly SparkMarker[]; label: string }) {
  if (!drawsSvg(ctx) || !('Svg' in ctx.els)) return null
  const picture = sparkSvg(input)
  if (!picture) return null
  const { Svg } = ctx.els
  // Both sizes: an interactive Svg without a height is a 150 px frame with the chart letterboxed in it (R1 §6.1).
  return <Svg source={picture.source} alt={picture.alt} width={SPARK_CHART_PX} height={picture.height} isInteractive />
}

// ── tiles, chips, signals, events ──

/**
 * A headline figure. Medium and wide layouts draw a tile (a quiet rounded card); compact draws one inline line.
 * `value` is drawn after its measure label, so the tile's number is never untagged.
 */
export function Kpi(ctx: ViewContext, input: { key: string; label: string; value: string; measure: Measure; width?: number; children?: RenderChildren }) {
  const { Box, Text } = ctx.els
  // The terminal's compact pane draws the figure as a line; the desktop draws a tile at every width.
  if (ctx.layout === 'compact' && !paintsGlass(ctx)) {
    return (
      <Box key={`kpi-${input.key}`} flexDirection="column">
        <Text wrap="truncate-end">
          <Text dimColor>{input.label} </Text>
          {MeasureTag(ctx, input.measure, false)} <Text weight="bold">{input.value}</Text>
        </Text>
        {input.children ?? null}
      </Box>
    )
  }
  return (
    <Box key={`kpi-${input.key}`} flexDirection="column" {...glass(ctx, 'raised')} paddingX={1} width={input.width}>
      <Text dimColor wrap="truncate-end">
        {input.label}
      </Text>
      <Text wrap="truncate-end">
        {MeasureTag(ctx, input.measure, false)}{' '}
        <Text weight="semibold" size="title" tabular>
          {input.value}
        </Text>
      </Text>
      {input.children ?? null}
    </Box>
  )
}

export type ChipOption = { id: string; label: string; count?: number; active: boolean }

/**
 * A tab or chip: a Button, selected or not. The app paints a selected Button as its primary (white) slab; a theme with a
 * selection edge (Abyssal) draws it instead as a secondary Button in a capsule lit by that edge (key `sel-<key>`), so the
 * content stays the brightest thing in the pane. The press is the Button's own either way. Classic and the terminal
 * keep the primary Button.
 */
export function ChoiceButton(ctx: ViewContext, input: { key: string; label: string; hotkey?: string; selected: boolean; onPress: () => void }) {
  const { Box, Button } = ctx.els
  const edge = paintsGlass(ctx) ? activeTheme().glass.selected : undefined
  const button = (
    <Button
      key={input.key}
      label={input.label}
      {...(input.hotkey ? { hotkey: input.hotkey } : {})}
      variant={input.selected && !edge ? 'primary' : 'secondary'}
      onPress={input.onPress}
    />
  )
  if (!input.selected || !edge) return button
  return (
    <Box key={`sel-${input.key}`} borderStyle="round" borderColor={edge} paddingX={0} paddingY={0}>
      {button}
    </Box>
  )
}

/** Filter chips: one per option, selected when active (`ChoiceButton`), its count in the label. */
export function Chips(ctx: ViewContext, keyPrefix: string, options: readonly ChipOption[], onPick: (id: string) => void) {
  const { Box } = ctx.els
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {options.map(option =>
        ChoiceButton(ctx, {
          key: `${keyPrefix}-${option.id}`,
          label: option.count !== undefined ? `${option.label} ${option.count}` : option.label,
          selected: option.active,
          onPress: () => onPick(option.id),
        }),
      )}
    </Box>
  )
}

/** A source's own scale as glyph and colour (DESIGN-CONTRACT §3.2): never a new severity. */
export const LEVEL_STYLE: Record<HealthLevel, { glyph: string; role: string; word: string }> = {
  investigate: {
    glyph: '▲',
    get role() {
      return ROLE.caution
    },
    word: 'investigate',
  },
  notice: {
    glyph: '△',
    get role() {
      return ROLE.muted
    },
    word: 'notice',
  },
  unresolved: {
    glyph: '?',
    get role() {
      return ROLE.caution
    },
    word: 'unresolved',
  },
  unavailable: {
    glyph: '∅',
    get role() {
      return ROLE.muted
    },
    word: 'unavailable',
  },
  observed: {
    glyph: '●',
    get role() {
      return ROLE.text
    },
    word: 'observed',
  },
}

export type SignalAction = { key: string; label: string; onPress: () => void }

// ── buckets ──

/**
 * An F3 bucket in its colour and words (`BUCKET_WORDS`), led by the evidence glyph of the contribution that set it when
 * given (`verified` reads `◇` at best), else by a swatch (`░` for unknown usage, never a filled share). The one badge
 * every view draws (Sunset Glass §8).
 */
export function BucketBadge(ctx: ViewContext, bucket: SpendBucket['bucket'], opts: { evidence?: Evidence } = {}) {
  const { Text } = ctx.els
  if (opts.evidence) {
    return (
      <Text>
        {EvidenceTag(ctx, opts.evidence, false)}{' '}
        <Text color={BUCKET_ROLE[bucket]} weight="semibold">
          {BUCKET_WORDS[bucket]}
        </Text>
      </Text>
    )
  }
  return (
    <Text color={BUCKET_ROLE[bucket]}>
      {bucket === 'no-usage-recorded' ? '░' : '■'} {BUCKET_WORDS[bucket]}
    </Text>
  )
}

/** The badge as a pill edged in its bucket's colour (desktop); the plain badge on the terminal. */
export function BucketPill(ctx: ViewContext, bucket: SpendBucket['bucket'], opts: { evidence?: Evidence } = {}) {
  return Pill(ctx, { edge: BUCKET_ROLE[bucket], children: BucketBadge(ctx, bucket, opts) })
}

/** Source events as `#seq` buttons that open them in Forensics, `+N more` past `max`. */
export function EventChips(ctx: ViewContext, keyPrefix: string, eventIds: readonly string[], max = 6) {
  const { Box, Text, Button } = ctx.els
  if (eventIds.length === 0) return null
  const seqOf = new Map(ctx.snapshot.events.map(e => [e.id, e.seq]))
  const shown = eventIds.slice(0, max)
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {shown.map(id => {
        const seq = seqOf.get(id)
        return seq !== undefined ? (
          <Button key={`${keyPrefix}-ev-${id}`} label={`#${seq}`} variant="secondary" onPress={() => ctx.act.openEvent(id)} />
        ) : (
          <Text dimColor>#? (dropped)</Text>
        )
      })}
      {eventIds.length > max ? <Text dimColor>+{eventIds.length - max} more</Text> : null}
    </Box>
  )
}
