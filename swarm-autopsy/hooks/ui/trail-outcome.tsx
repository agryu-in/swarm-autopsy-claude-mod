// The Trail's "Outcome so far" box (Workstream C; Sunset Glass WS2): a glass
// summary of agents by state, files changed and the one unresolved count; each
// verification command with its latest verdict (the command cut in the middle,
// so two commands stay apart); the command-level flags; and F3's spend vs
// outcome as the shared bucket bar, one row per bucket, every number tagged,
// the denominator's basis one press away (fixes O2). Desktop: count pills and
// aligned Box columns; the terminal keeps its compact lines.

import type { HealthSignal, SpendBucket, SpendOutcome, VerificationVerdict } from '../../types'
import { VERDICT_COLOR, VERDICT_GLYPH, compact, displayPath, pct, plural, subagents } from '../lib/format'
import { BUCKET_ROLE, ROLE } from '../lib/palette'
import { unresolvedOf } from '../lib/signals'
import type { Trail, TrailFlag, VerificationSummary } from '../lib/trail'
import type { ViewContext } from './common'
import { AgentChip, BucketBar, Disclosure, EvidenceTag, GlassPanel, Heading, MeasureTag, Pill, paintsGlass } from './kit'
import { bucketLabel, middleTruncate } from './trail-model'

/** Below this many columns a verification takes two lines: its verdict, then the whole width for the command. */
const ONE_LINE_FROM = 70
/** The terminal bar's widest; the desktop bar (Box segments, never wrapping) takes the box's width. */
const BAR_MAX = 64
const CHIPS_SHOWN = 8
/** Verification commands and command flags listed in the box (the tree budget); the rest are counted. */
const ROWS_SHOWN = 8
const FLAGS_SHOWN = 4
/** Desktop column widths in cells: an identity chip, and a check's "latest … · ● N runs". */
const CHIP_COLS = 6
const RUNS_COLS = 26
/** The order agent states are counted in. */
const STATES = ['active', 'completed', 'failed', 'stopped', 'unknown'] as const

/** Flags about a command's latest run: shown with the outcome rather than in one agent's lane. */
export const isCommandFlag = (flag: TrailFlag): boolean => flag.kind === 'still-failing' || flag.kind === 'inconclusive'

/** A trail flag verbatim, behind its evidence label. */
export function FlagLine(ctx: ViewContext, flag: TrailFlag) {
  const { Text } = ctx.els
  return (
    <Text wrap="wrap">
      {EvidenceTag(ctx, flag.evidence, false)} {flag.text}
    </Text>
  )
}

/** Subagents by state, from the snapshot's own agent list (Sunset Glass §12: every drawn state count uses it). */
function agentsByState(ctx: ViewContext): { total: number; words: string } {
  const agents = subagents(ctx.snapshot)
  const words = STATES.map(state => [state, agents.filter(a => a.state === state).length] as const)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${state}`)
    .join(' · ')
  return { total: agents.length, words }
}

/**
 * Agents by state, files changed and the one unresolved count (Sunset Glass SG-U): the findings Health marks `?`, so
 * this box, the header and the Health tab always say the same number. Desktop: three pills; terminal: one line.
 */
function Summary(ctx: ViewContext, trail: Trail, health: readonly HealthSignal[]) {
  const { Box, Text } = ctx.els
  const unresolved = unresolvedOf(health).length
  const { total, words } = agentsByState(ctx)
  const files = plural(trail.outcome.filesChanged.length, 'file')
  const loud = unresolved > 0 ? ROLE.caution : undefined
  if (!paintsGlass(ctx)) {
    return (
      <Text wrap="wrap">
        {MeasureTag(ctx, 'OBSERVED', false)} {plural(total, 'subagent')}
        {words ? `: ${words}` : ''} · {files} changed · <Text color={loud}>{`? ${unresolved} unresolved`}</Text>
        <Text dimColor> (in Health)</Text>
      </Text>
    )
  }
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {Pill(ctx, { children: [MeasureTag(ctx, 'OBSERVED', false), ` ${plural(total, 'subagent')}`, words ? <Text dimColor>{` · ${words}`}</Text> : ''] })}
      {Pill(ctx, { children: [MeasureTag(ctx, 'OBSERVED', false), ` ${files} changed`] })}
      {Pill(ctx, { edge: loud, children: [<Text color={loud}>{`? ${unresolved} unresolved`}</Text>, <Text dimColor> in Health</Text>] })}
    </Box>
  )
}

/** A check's verdict glyph in its colour. */
function VerdictGlyph(ctx: ViewContext, verdict: VerificationVerdict) {
  const { Text } = ctx.els
  return (
    <Text color={VERDICT_COLOR[verdict]} weight="semibold">
      {VERDICT_GLYPH[verdict]}
    </Text>
  )
}

/** Desktop: verdict, chip, command (mono, cut in the middle) and runs as Box cells, aligned on every row. */
function VerificationCells(ctx: ViewContext, v: VerificationSummary, where: string, inner: number) {
  const { Box, Text } = ctx.els
  const runs = (
    <Box width={RUNS_COLS} flexShrink={0}>
      <Text dimColor wrap="truncate-end">
        latest {v.latest} · {MeasureTag(ctx, 'OBSERVED', false)} {plural(v.runs, 'run')}
        {where}
      </Text>
    </Box>
  )
  const chip = (
    <Box width={CHIP_COLS} flexShrink={0}>
      <Text wrap="truncate-end">{AgentChip(ctx, v.agentId)}</Text>
    </Box>
  )
  const glyph = (
    <Box width={1} flexShrink={0}>
      {VerdictGlyph(ctx, v.latest)}
    </Box>
  )
  if (ctx.width >= ONE_LINE_FROM) {
    const room = Math.max(16, inner - 1 - CHIP_COLS - RUNS_COLS - 3)
    return (
      <Box flexDirection="row" columnGap={1}>
        {glyph}
        {chip}
        <Box width={0} flexGrow={1}>
          <Text mono wrap="truncate-end">
            {middleTruncate(v.command, room)}
          </Text>
        </Box>
        {runs}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        {glyph}
        {chip}
        {runs}
      </Box>
      <Box marginLeft={2}>
        <Text mono wrap="truncate-end">
          {middleTruncate(v.command, Math.max(12, inner - 2))}
        </Text>
      </Box>
    </Box>
  )
}

function Verification(ctx: ViewContext, v: VerificationSummary, showCwd: boolean, inner: number) {
  const { Box, Text } = ctx.els
  const where = showCwd && v.cwd ? ` in ${displayPath(v.cwd, ctx.snapshot.cwd)}` : ''
  if (paintsGlass(ctx)) return VerificationCells(ctx, v, where, inner)
  const runs = (
    <Text dimColor>
      latest {v.latest} · {MeasureTag(ctx, 'OBSERVED', false)} {plural(v.runs, 'run')}
      {where}
    </Text>
  )
  if (ctx.width >= ONE_LINE_FROM) {
    const room = Math.max(16, inner - 36 - where.length)
    return (
      <Text wrap="truncate-end">
        {VerdictGlyph(ctx, v.latest)} {middleTruncate(v.command, room)} {AgentChip(ctx, v.agentId)} {runs}
      </Text>
    )
  }
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {VerdictGlyph(ctx, v.latest)} {AgentChip(ctx, v.agentId)} {runs}
      </Text>
      <Text>{`  ${middleTruncate(v.command, Math.max(12, inner - 2))}`}</Text>
    </Box>
  )
}

/** Latest verdicts that need a look come first: failed, inconclusive, running, then passed (stable within each). */
const VERDICT_ORDER: Record<VerificationVerdict, number> = { failed: 0, inconclusive: 1, running: 2, passed: 3 }

function Verifications(ctx: ViewContext, trail: Trail, inner: number) {
  const { Text } = ctx.els
  const list = trail.outcome.verifications
  if (list.length === 0) return <Text dimColor>No verification command (tests, type checks, linters, builds) was captured.</Text>
  const repeated = new Set(list.map(v => v.command).filter((c, i, all) => all.indexOf(c) !== i))
  const ordered = [...list].sort((a, b) => VERDICT_ORDER[a.latest] - VERDICT_ORDER[b.latest])
  const shown = ordered.slice(0, ROWS_SHOWN)
  return [
    ...shown.map(v => Verification(ctx, v, repeated.has(v.command), inner)),
    list.length > shown.length ? <Text dimColor>+{list.length - shown.length} more commands · Forensics' tests filter lists every run</Text> : null,
  ]
}

/** The command-level flags (still failing, inconclusive), capped; Health lists every one. */
function CommandFlags(ctx: ViewContext, trail: Trail) {
  const { Text } = ctx.els
  const flags = trail.flags.filter(isCommandFlag)
  const shown = flags.slice(0, FLAGS_SHOWN)
  return [
    ...shown.map(flag => FlagLine(ctx, flag)),
    flags.length > shown.length ? <Text dimColor>+{flags.length - shown.length} more command flags · the Health tab lists every one</Text> : null,
  ]
}

/** A bucket's figures: its tokens and share (● OBSERVED), or why it has none (∅). */
function Figures(ctx: ViewContext, bucket: SpendBucket) {
  const { Text } = ctx.els
  if (bucket.bucket === 'no-usage-recorded') {
    return (
      <Text color={ROLE.muted}>
        {MeasureTag(ctx, 'UNAVAILABLE', false)} usage unknown · {plural(bucket.agents.length, 'agent')}
      </Text>
    )
  }
  if (bucket.percent === undefined) return <Text color={ROLE.muted}>{MeasureTag(ctx, 'UNAVAILABLE', false)} no share: no usage recorded yet</Text>
  return (
    <Text>
      {MeasureTag(ctx, 'OBSERVED', false)} {compact(bucket.processed)} · {pct(bucket.percent)}
    </Text>
  )
}

/** The bucket's agents as chips (none in the compact layout), and how many more. */
function BucketChips(ctx: ViewContext, bucket: SpendBucket) {
  const { Text } = ctx.els
  const shown = ctx.layout === 'compact' ? [] : bucket.agents.slice(0, CHIPS_SHOWN)
  const more = ctx.layout === 'compact' ? 0 : bucket.agents.length - shown.length
  return [
    ...shown.map(id => <Text> {AgentChip(ctx, id, { name: !Object.hasOwn(ctx.snapshot.agents, id) })}</Text>),
    more > 0 ? <Text dimColor> +{more} more</Text> : '',
  ]
}

/** The swatch and the bucket's words; "verified" is at best ◇ INFERRED (F3-4), so its label says so beside any ●. */
function BucketName(ctx: ViewContext, bucket: SpendBucket) {
  const { Text } = ctx.els
  const verified = bucket.bucket === 'verified'
  return [<Text color={BUCKET_ROLE[bucket.bucket]}>■</Text>, ' ', verified ? EvidenceTag(ctx, 'INFERRED', false) : '', verified ? ' ' : '', bucketLabel(bucket.bucket)]
}

function BucketLine(ctx: ViewContext, bucket: SpendBucket, pad: number) {
  const { Text } = ctx.els
  const label = bucketLabel(bucket.bucket)
  const verified = bucket.bucket === 'verified'
  return (
    <Text wrap="truncate-end">
      <Text color={BUCKET_ROLE[bucket.bucket]}>■</Text> {verified ? EvidenceTag(ctx, 'INFERRED', false) : ''}
      {verified ? ' ' : ''}
      {label.padEnd(verified ? Math.max(0, pad - 2) : pad)} {Figures(ctx, bucket)}
      {BucketChips(ctx, bucket)}
    </Text>
  )
}

/** Desktop: the bucket's name, figures and agents in Box columns, so every row's figures start at one place. */
function BucketCells(ctx: ViewContext, bucket: SpendBucket, labelCols: number, figureCols: number) {
  const { Box, Text } = ctx.els
  const name = (
    <Box width={labelCols} flexShrink={0}>
      <Text wrap="truncate-end">{BucketName(ctx, bucket)}</Text>
    </Box>
  )
  // A share sits in the figures column; a missing one says why across the rest of the row.
  if (bucket.percent === undefined || bucket.bucket === 'no-usage-recorded') {
    return (
      <Box flexDirection="row" columnGap={1}>
        {name}
        <Box width={0} flexGrow={1}>
          <Text wrap="truncate-end">
            {Figures(ctx, bucket)}
            {BucketChips(ctx, bucket)}
          </Text>
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="row" columnGap={1}>
      {name}
      <Box width={figureCols} flexShrink={0}>
        <Text wrap="truncate-end" tabular>
          {Figures(ctx, bucket)}
        </Text>
      </Box>
      <Box width={0} flexGrow={1}>
        <Text wrap="truncate-end">{BucketChips(ctx, bucket)}</Text>
      </Box>
    </Box>
  )
}

/** F3 spend vs outcome: the shared bucket bar, one row per bucket, the denominator and its basis, and the way to Spend. */
function SpendBar(ctx: ViewContext, spend: SpendOutcome, inner: number) {
  const { Box, Button, Text } = ctx.els
  const measured = spend.denominator > 0
  const glassy = paintsGlass(ctx)
  const nameOf = (b: SpendBucket) => bucketLabel(b.bucket).length + (b.bucket === 'verified' ? 2 : 0)
  const pad = ctx.layout === 'compact' ? 0 : Math.max(0, ...spend.buckets.map(nameOf))
  const labelCols = Math.max(0, ...spend.buckets.map(nameOf)) + 2
  const shareText = (b: SpendBucket) => (b.percent === undefined ? 0 : `● ${compact(b.processed)} · ${pct(b.percent)}`.length)
  const figureCols = Math.max(0, ...spend.buckets.map(shareText)) + 1
  return (
    <Box flexDirection="column" marginTop={1}>
      {glassy ? Heading(ctx, 'Spend by outcome', { level: 2 }) : null}
      <Text wrap="wrap">
        {measured ? (
          <Text>
            {MeasureTag(ctx, 'OBSERVED', false)} {compact(spend.denominator)} tokens processed <Text dimColor>· the whole bar, by outcome</Text>
          </Text>
        ) : (
          <Text color={ROLE.muted}>{MeasureTag(ctx, 'UNAVAILABLE', false)} no token usage recorded yet, so no shares are shown</Text>
        )}
      </Text>
      {measured ? BucketBar(ctx, spend, glassy ? inner : Math.min(BAR_MAX, inner)) : null}
      {spend.buckets.map(bucket => (glassy ? BucketCells(ctx, bucket, labelCols, figureCols) : BucketLine(ctx, bucket, pad)))}
      {Disclosure(ctx, 'trail-denominator', 'what the whole bar counts', () => (
        <Text dimColor wrap="wrap">
          {spend.denominatorBasis}
        </Text>
      ))}
      <Button key="open-spend" label="Spend: how each share was classified" variant="secondary" onPress={() => ctx.act.view('spend')} />
    </Box>
  )
}

export function OutcomeBox(ctx: ViewContext, trail: Trail, spend: SpendOutcome, health: readonly HealthSignal[] = []) {
  const { Box } = ctx.els
  const inner = Math.max(20, ctx.width - 4)
  const checks = trail.outcome.verifications.length > 0 && paintsGlass(ctx) ? Heading(ctx, 'Verification commands', { level: 2 }) : null
  return GlassPanel(ctx, {
    tone: 'base',
    title: 'Outcome so far',
    children: [
      Summary(ctx, trail, health),
      <Box flexDirection="column" marginTop={paintsGlass(ctx) ? 1 : 0}>
        {checks}
        {Verifications(ctx, trail, inner)}
        {CommandFlags(ctx, trail)}
      </Box>,
      SpendBar(ctx, spend, inner),
    ],
  })
}
