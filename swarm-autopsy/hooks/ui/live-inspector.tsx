// Live's details for the focused agent: a summary tile (identity, state, the
// outcome bucket badge, the context gauge, the tokens and their bar, files, the
// last activity), then one section each, with one heading style and in this
// order: context, usage (Spend's ledger detail), outcome (Spend's outcome
// detail), delegation and report, files, and the last events. Ids and sources
// sit, muted and mono, behind "why?".
// Placement is the caller's: in place (medium), the detail column (wide) or the
// whole view (compact); the caller passes a context sized to that place.

import type { RenderChildren } from 'claude-code'

import type { AgentRecord } from '../../types'
import { contextViewFor } from '../lib/context'
import { MEASURE_GLYPH, agentName, ago, displayPath, exact, plural, truncate } from '../lib/format'
import { ROLE, SVG_HEX, identityHex } from '../lib/palette'
import type { ViewContext } from './common'
import { ContextPanel, contextMarkers } from './context'
import { EventLine } from './events'
import { AgentChip, BucketBadge, BucketPill, Disclosure, EvidenceTag, Heading, MeasureTag, StateBadge, glass, paintsGlass } from './kit'
import { AgentLedgerDetail } from './ledger'
import { CARD_FRAME, SpawnTree, StaticLine, figureParts, sized } from './live-cards'
import { activityOf, bucketEvidence, bucketOf, filesOf, outcomeOf, rowOf, type AgentFiles } from './live-facts'
import { AgentOutcomeDetail } from './outcome'
import type { Analyses } from './pane'

const LAST_EVENTS = 8
/** Lines of excerpt shown before "the whole …" (the rest is behind a disclosure). */
const EXCERPT_LINES = 3
/** The narrowest a section's content is drawn, whatever its column. */
const MIN_INNER = 20
/** How a basis names the tool call behind it; the id after it goes behind "why?" with the other ids. */
const TOOL_USE_ID = '; tool_use_id '

export type InspectorOptions = {
  /** Draw the agent's name as a heading (the compact layout's selected row already names it). */
  titled: boolean
  /** The agent's card is on screen; without it the summary carries what the card would (main's spawn tree). */
  cardShown: boolean
  /** Draw the summary as a tile and the sections on glass (medium and wide panes; compact draws plain lines). */
  panels?: boolean
}

/** A section: plain under its heading, or (panels, desktop) on its own glass with its content sized inside it. */
function Section(ctx: ViewContext, opts: InspectorOptions, draw: (inner: ViewContext) => RenderChildren) {
  const { Box } = ctx.els
  if (opts.panels && paintsGlass(ctx)) {
    return (
      <Box flexDirection="column" {...glass(ctx, 'base')} paddingX={1} marginTop={1}>
        {draw(sized(ctx, Math.max(MIN_INNER, ctx.width - CARD_FRAME)))}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      {draw(ctx)}
    </Box>
  )
}

// ── the summary tile ──

function edgeOf(ctx: ViewContext, agent: AgentRecord): string {
  if (agent.isMain) return paintsGlass(ctx) ? SVG_HEX.main : ROLE.main
  return identityHex(agent) ?? ROLE.muted
}

/** The bucket the agent's tokens are counted in, labelled by its weakest evidence (`verified` reads ◇ at best). */
function BucketLine(ctx: ViewContext, analyses: Analyses, agent: AgentRecord) {
  const { Box, Text } = ctx.els
  const bucket = bucketOf(analyses.spend, agent.id)
  if (!bucket) return null
  const evidence = bucketEvidence(bucket.bucket, outcomeOf(analyses.spend, agent.id))
  const badge = BucketBadge(ctx, bucket.bucket, { evidence })
  if (!paintsGlass(ctx)) {
    return (
      <Text wrap="wrap">
        {badge}
        <Text dimColor> · outcome bucket</Text>
      </Text>
    )
  }
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {BucketPill(ctx, bucket.bucket, { evidence })}
      <Text dimColor>outcome bucket</Text>
    </Box>
  )
}

/** Files at a glance: distinct paths written and read (≥ when older events were dropped); the lists are below. */
function FilesLine(ctx: ViewContext, files: AgentFiles) {
  const { Text } = ctx.els
  const ge = files.bounded ? '≥' : ''
  const count = (n: number, word: string) => (n > 0 ? `${ge}${n} ${word}` : `none ${word}`)
  const numbered = files.written.length + files.read.length > 0
  return (
    <Text wrap="truncate-end">
      {numbered ? <Text>{MeasureTag(ctx, 'OBSERVED', false)} </Text> : ''}✎ {count(files.written.length, 'written')} · ◦ {count(files.read.length, 'read')}
      <Text dimColor> · files</Text>
    </Text>
  )
}

function Summary(ctx: ViewContext, analyses: Analyses, agent: AgentRecord, opts: InspectorOptions) {
  const { Box, Text } = ctx.els
  const tile = opts.panels === true
  const inner = tile ? Math.max(MIN_INNER, ctx.width - CARD_FRAME) : ctx.width
  const body = sized(ctx, inner)
  const activity = activityOf(ctx.snapshot, agent)
  const view = contextViewFor(ctx.snapshot, agent.id)
  const tools = agent.counts.tools > 0 ? plural(agent.counts.tools, 'tool call') : 'no tool calls yet'
  const errors = agent.counts.errors > 0 ? <Text color={ROLE.fail}> · ✕ {plural(agent.counts.errors, 'error')}</Text> : ''
  const turns = agent.isMain ? `${agent.turns > 0 ? `${plural(agent.turns, 'turn')} completed` : 'no turn completed yet'} · ` : ''
  const numbered = agent.counts.tools > 0 || agent.counts.errors > 0 || (agent.isMain && agent.turns > 0)
  const lines = [
    opts.titled ? Heading(ctx, agent.isMain ? 'main · coordinator' : agentName(agent), { summary: 'selected' }) : null,
    // Compact draws no card above the details, and its one-line row cuts the task: give it whole here.
    !opts.cardShown && !agent.isMain ? (
      <Text wrap="wrap" weight="medium">
        {agent.description ? `“${agent.description}”` : <Text dimColor>task description unavailable</Text>}
      </Text>
    ) : null,
    <Text wrap="wrap">
      {StateBadge(ctx, agent)} <Text dimColor>· </Text>
      {EvidenceTag(ctx, 'OBSERVED', false)} <Text dimColor>{agent.stateBasis}</Text>
    </Text>,
    BucketLine(ctx, analyses, agent),
    figureParts(body, view, rowOf(analyses, agent.id), inner).map(parts => StaticLine(body, inner, parts)),
    FilesLine(ctx, filesOf(ctx.snapshot, agent)),
    <Text wrap="truncate-end" color={activity.live ? ROLE.context : undefined} dimColor={!activity.live}>
      {activity.text}
      {activity.seen ? ` · ${ago(ctx.now, activity.at)}` : ''}
    </Text>,
    <Text wrap="wrap">
      {numbered ? <Text>{MeasureTag(ctx, 'OBSERVED', false)} </Text> : ''}
      {turns}
      {tools}
      {errors}
      <Text dimColor> · since the collector started</Text>
    </Text>,
    agent.isMain && !opts.cardShown ? SpawnTree(ctx, analyses, agent) : null,
  ]
  if (!tile) return <Box flexDirection="column">{lines}</Box>
  return (
    <Box flexDirection="column" {...glass(ctx, 'raised', edgeOf(ctx, agent))} paddingX={1}>
      {lines}
    </Box>
  )
}

// ── delegation and report ──

/** A long text's first lines; the whole of it (as captured) behind a disclosure. */
function Excerpt(ctx: ViewContext, id: string, label: string, text: string) {
  const { Box, Text } = ctx.els
  const room = Math.max(40, ctx.width * EXCERPT_LINES)
  const flat = text.replace(/\s+/g, ' ').trim()
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text dimColor wrap="wrap">
        {truncate(flat, room)}
      </Text>
      {flat.length > room
        ? Disclosure(ctx, id, label, () => (
            <Text dimColor wrap="wrap">
              {text}
            </Text>
          ))
        : null}
    </Box>
  )
}

/** The ids and sources behind the delegation and the report, for "why?": the tool calls, the report's source, the transcript. */
function idsOf(agent: AgentRecord): string[] {
  const [, ...calls] = agent.parentBasis.split(TOOL_USE_ID)
  const named = calls.join(TOOL_USE_ID)
  return [
    ...(named ? [`parent: tool_use_id ${named}`] : []),
    ...(agent.spawnToolUseId && agent.spawnToolUseId !== named ? [`agent.spawn: tool_use_id ${agent.spawnToolUseId}`] : []),
    ...(agent.report ? [`report: ${agent.report.source}`] : []),
    ...(agent.transcriptPath ? [`transcript: ${agent.transcriptPath}`] : []),
  ]
}

function Delegation(ctx: ViewContext, agent: AgentRecord) {
  const { Box, Text } = ctx.els
  const report = agent.report
  const prompt = agent.prompt
  const promptLength = agent.promptLength ?? prompt?.length ?? 0
  const capped = prompt !== undefined && promptLength > prompt.length ? ` (the first ${exact(prompt.length)} kept)` : ''
  const said = agent.parentBasis.split(TOOL_USE_ID)[0] ?? agent.parentBasis
  const ids = idsOf(agent)
  return [
    Heading(ctx, 'delegation and report'),
    <Text wrap="wrap">
      {EvidenceTag(ctx, agent.parentEvidence, false)} parent {agent.parentId ? AgentChip(ctx, agent.parentId) : 'unknown'}
      <Text dimColor> · {said}</Text>
    </Text>,
    prompt ? (
      <Box flexDirection="column">
        <Text wrap="wrap">
          {EvidenceTag(ctx, 'OBSERVED', false)} delegated task · {exact(promptLength)} chars{capped}
        </Text>
        {Excerpt(ctx, `prompt-${agent.id}`, 'the whole delegation prompt', prompt)}
      </Box>
    ) : (
      <Text wrap="wrap">{EvidenceTag(ctx, 'UNAVAILABLE', false)} delegated task: no agent.spawn event was observed for this agent</Text>
    ),
    report ? (
      <Box flexDirection="column">
        <Text wrap="wrap">
          {EvidenceTag(ctx, 'OBSERVED', false)} report · {exact(report.length)} chars
        </Text>
        {Excerpt(ctx, `report-${agent.id}`, 'the whole report excerpt', report.excerpt)}
      </Box>
    ) : (
      <Text wrap="wrap">
        {agent.state === 'active' || agent.state === 'unknown'
          ? [EvidenceTag(ctx, 'UNRESOLVED', false), ' report: none returned yet']
          : [EvidenceTag(ctx, 'UNAVAILABLE', false), ' report: none captured']}
      </Text>
    ),
    ids.length
      ? Disclosure(ctx, `ids-${agent.id}`, 'why? ids and sources', () => (
          <Box flexDirection="column" paddingLeft={2}>
            {ids.map(line => (
              <Text mono dimColor wrap="wrap">
                {line}
              </Text>
            ))}
          </Box>
        ))
      : null,
  ]
}

// ── files and events ──

function Files(ctx: ViewContext, agent: AgentRecord) {
  const { Text } = ctx.els
  const files = filesOf(ctx.snapshot, agent)
  const cwd = ctx.snapshot.cwd
  const room = Math.max(40, ctx.width * 3)
  const list = (paths: readonly string[]) => truncate(paths.map(p => displayPath(p, cwd)).join(', '), room)
  const ge = files.bounded ? '≥' : ''
  const count = (n: number, word: string) => (n > 0 ? `${ge}${n} ${word}` : `none ${word}`)
  const numbered = files.written.length + files.read.length > 0
  const summary = `${numbered ? `${MEASURE_GLYPH.OBSERVED} ` : ''}${count(files.written.length, 'written')} · ${count(files.read.length, 'read')} · distinct paths`
  return [
    Heading(ctx, 'files', { summary }),
    files.written.length ? (
      <Text wrap="wrap">
        ✎ written: <Text mono>{list(files.written)}</Text>
      </Text>
    ) : (
      <Text dimColor>✎ written: none observed</Text>
    ),
    files.read.length ? (
      <Text wrap="wrap">
        ◦ read: <Text mono>{list(files.read)}</Text>
      </Text>
    ) : (
      <Text dimColor>◦ read: none observed</Text>
    ),
    files.searched.length ? (
      <Text dimColor wrap="wrap">
        ⌕ searched (paths, not files): <Text mono>{list(files.searched)}</Text>
      </Text>
    ) : null,
    files.bounded ? (
      <Text color={ROLE.caution} wrap="wrap">
        Counted over the retained timeline: older events were dropped, so this agent may have touched more files.
      </Text>
    ) : null,
  ]
}

function LastEvents(ctx: ViewContext, agent: AgentRecord) {
  const { Box, Text } = ctx.els
  const events = ctx.snapshot.events.filter(e => e.agentId === agent.id)
  const shown = events.slice(-LAST_EVENTS)
  const of = events.length > shown.length ? `of ${events.length} kept · ` : ''
  return [
    Heading(ctx, shown.length ? `last ${shown.length} events` : 'events', { summary: `${of}oldest first` }),
    shown.length === 0 ? (
      <Text dimColor>No event attributed to this agent in the kept timeline.</Text>
    ) : (
      <Box flexDirection="column">{shown.map(e => EventLine(ctx, e, ctx.width, false))}</Box>
    ),
  ]
}

/** The focused agent's details (the one detail drawer every card press opens), in a fixed order. */
export function Inspector(ctx: ViewContext, analyses: Analyses, agent: AgentRecord, opts: InspectorOptions) {
  const { Box } = ctx.els
  const view = contextViewFor(ctx.snapshot, agent.id)
  const row = rowOf(analyses, agent.id)
  return (
    <Box key={`insp-${agent.id}`} flexDirection="column">
      {Summary(ctx, analyses, agent, opts)}
      {Section(ctx, opts, c => ContextPanel(c, view, { id: agent.id, requestsWithUsage: row?.direct.requests, markers: contextMarkers(c.snapshot, view) }))}
      {Section(ctx, opts, c => [Heading(c, 'usage', { summary: 'direct: this agent’s own requests' }), AgentLedgerDetail(c, row, c.ui.showCost === true)])}
      {Section(ctx, opts, c => [Heading(c, 'outcome', { summary: 'spend vs outcome' }), AgentOutcomeDetail(c, outcomeOf(analyses.spend, agent.id), analyses.trail)])}
      {agent.isMain ? null : Section(ctx, opts, c => Delegation(c, agent))}
      {Section(ctx, opts, c => Files(c, agent))}
      {Section(ctx, opts, c => LastEvents(c, agent))}
    </Box>
  )
}
