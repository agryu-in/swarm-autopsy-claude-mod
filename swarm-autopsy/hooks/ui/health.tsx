// View F, Swarm Health (DESIGN-CONTRACT §8.7; Sunset Glass §11, §12): the
// findings the existing analyses already raised (lib/signals), grouped by source,
// each a card in its source's own level, with the level word beside its glyph,
// its evidence label, its own words, its agents and events, and its evidence and
// actions inside the card. Identical findings fold into one card that keeps every
// entry's own actions. A value (main's context fill) is a quiet pill, never an
// alarm card. No score, no threshold, no traffic light; colour only where an entry
// exists. Also Live's Health strip. Workstream 3 owns this file.

import type { Evidence, HealthLevel, HealthSignal, HealthSource } from '../../types'
import { EVIDENCE_COLOR, EVIDENCE_GLYPH, plural, truncate } from '../lib/format'
import { ROLE } from '../lib/palette'
import { findingsOf, isValueOnly, unresolvedOf } from '../lib/signals'
import type { ViewContext } from './common'
import {
  CARD_FRAME,
  CardGrid,
  ChipRuns,
  EvidencePanel,
  FindingCard,
  FooterRow,
  LevelHead,
  MAX_CHIPS,
  MIN_TEXT,
  chipsCells,
  headPrefix,
  whyRoom,
  type EvidenceToggleInput,
} from './health-cards'
import { Disclosure, EmptyState, EventChips, EvidenceTag, GlassPanel, Heading, headingInk, LEVEL_STYLE, Pill, isOpen, paintsGlass, type SignalAction } from './kit'
import type { Analyses } from './pane'

/** The sources in drawing order: group heading, where an entry came from, and where every one of them is listed. */
const GROUPS: ReadonlyArray<{ source: HealthSource; title: string; from: string; elsewhere: string }> = [
  { source: 'trail', title: 'Trail flags', from: 'a trail flag', elsewhere: 'the Trail shows every flag on its node' },
  { source: 'collisions', title: 'Collision signals', from: 'a collision signal', elsewhere: 'the Collisions tab lists every signal' },
  { source: 'context', title: 'Context', from: 'the captured context readings (F1)', elsewhere: "each agent's inspector on Live lists its context readings" },
  { source: 'ledger', title: 'Token ledger', from: 'the token ledger (F2)', elsewhere: 'the Spend tab lists every ledger row and note' },
  { source: 'outcome', title: 'Spend vs outcome', from: 'spend vs outcome (F3)', elsewhere: "the Spend tab lists every agent's outcome" },
  { source: 'coverage', title: 'Coverage gaps', from: 'what the collector could not capture', elsewhere: 'the footer lists every warning' },
]

/** The level counts under the heading, in this order: what is unsettled, what a source asks to look at, then the rest. */
const LEVEL_ORDER: readonly HealthLevel[] = ['unresolved', 'investigate', 'notice', 'unavailable', 'observed']

/** Cards drawn per group before "show N more". */
const GROUP_FIRST = 5
/** Cards a group draws at most once opened: a crowded session stays within the tree budget. */
const GROUP_MAX = 30

/** Agents a card offers "open" buttons for. */
const MAX_OPEN = 3
/** Source events drawn in an opened card before "+N more". */
const MAX_EVENTS = 6
/** A number with a measure word, as the acceptance scan reads one: such a line carries its label. */
const MEASURED = /\d[\d.,]*\s?[kM]?\s?(tok|tokens|req|requests)\b|\d[\d.]*%/

/**
 * One Health entry and its index in the list its keys are numbered by: `analyses.health` on the tab (`hl-<i>`,
 * `dc-h-ev-<i>`, `focus-h<i>-…`), `findingsOf(analyses.health)` on the Live strip (`sc-lv-sig-<i>`).
 */
type Member = { signal: HealthSignal; index: number }

/**
 * What the card says under its title: the rest of the source's sentence when the title is its lead, else the source's
 * text itself, else where the entry came from.
 */
export function whyAfterTitle(signal: HealthSignal): string {
  const rest = signal.why.startsWith(signal.title) ? signal.why.slice(signal.title.length).replace(/^\s*(—|;|:|\.)?\s*/, '') : signal.why
  if (rest.trim()) return rest
  return `from ${GROUPS.find(g => g.source === signal.source)?.from ?? 'an existing analysis'}`
}

/** The evidence toggle's words: the source's whole text, and its events when it names any. */
function evidenceLabel(signal: HealthSignal): string {
  const events = signal.eventIds.length
  return events > 0 ? `evidence · ${plural(events, 'source event')}` : 'evidence · full text'
}

function nameOf(ctx: ViewContext, agentId: string): string | undefined {
  const agent = Object.hasOwn(ctx.snapshot.agents, agentId) ? ctx.snapshot.agents[agentId] : undefined
  if (!agent) return undefined
  return agent.isMain ? 'main' : agent.label
}

function actionsFor(ctx: ViewContext, signal: HealthSignal, i: number): SignalAction[] {
  const nodeId = signal.nodeId
  const trail: SignalAction[] = nodeId ? [{ key: `sig-h${i}-tr`, label: 'show in Trail', onPress: () => ctx.act.showNode(nodeId) }] : []
  const open: SignalAction[] = signal.agentIds.flatMap(agentId => {
    const name = nameOf(ctx, agentId)
    return name === undefined
      ? []
      : [
          {
            key: `focus-h${i}-${agentId}`,
            label: `open ${name}`,
            onPress: () => {
              ctx.act.focus(agentId)
              ctx.act.view('live')
            },
          },
        ]
  })
  return [...trail, ...open.slice(0, MAX_OPEN)]
}

/** The entry's evidence toggle (`dc-h-ev-<i>`), opening and closing `h-ev-<i>`. */
function toggleFor(ctx: ViewContext, signal: HealthSignal, i: number): EvidenceToggleInput {
  const id = `h-ev-${i}`
  return { key: `dc-${id}`, open: isOpen(ctx, id), label: evidenceLabel(signal), onPress: () => ctx.act.toggleOpen(id) }
}

/** The opened evidence: the source's whole text with its label, and its events as buttons to Forensics. */
function EvidenceBody(ctx: ViewContext, signal: HealthSignal, i: number) {
  const { Box, Text } = ctx.els
  return EvidencePanel(
    ctx,
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">
        {EvidenceTag(ctx, signal.evidence, false)} {signal.why}
      </Text>
      {signal.eventIds.length > 0 ? <Text dimColor>source events:</Text> : null}
      {EventChips(ctx, `sig-h${i}`, signal.eventIds, MAX_EVENTS)}
    </Box>,
  )
}

/** The why fitted to one line, the evidence glyph before it when it states a measured number; `cut` when shortened. */
function fitWhy(why: string, evidence: Evidence, room: number): { shown: string; cut: boolean } {
  const flat = why.replace(/\s+/g, ' ').trim()
  const label = MEASURED.test(truncate(why, room)) ? EVIDENCE_GLYPH[evidence] : ''
  const text = truncate(why, label ? Math.max(MIN_TEXT, room - 2) : room)
  return { shown: label ? `${label} ${text}` : text, cut: text !== flat }
}

/** One entry as a card: its toggle when the why was cut, in the compact layout, or when it names events. */
function Entry(ctx: ViewContext, signal: HealthSignal, i: number) {
  const { Box } = ctx.els
  const chips = signal.agentIds.slice(0, MAX_CHIPS)
  const more = Math.max(0, signal.agentIds.length - MAX_CHIPS)
  const { shown, cut } = fitWhy(whyAfterTitle(signal), signal.evidence, whyRoom(ctx, chips, more))
  const toggle = cut || ctx.layout === 'compact' || signal.eventIds.length > 0 ? toggleFor(ctx, signal, i) : undefined
  return (
    <Box key={`hl-${i}`} flexDirection="column">
      {FindingCard(ctx, {
        key: `hl-${i}`,
        level: signal.level,
        evidence: signal.evidence,
        title: signal.title,
        why: shown,
        agentIds: chips,
        moreAgents: more,
        toggle,
        actions: actionsFor(ctx, signal, i),
        body: toggle?.open ? EvidenceBody(ctx, signal, i) : null,
      })}
    </Box>
  )
}

/** One folded entry's row: its chips, then its own evidence toggle and actions; its evidence opens under the row. */
function MemberRow(ctx: ViewContext, member: Member, cut: boolean) {
  const { Box, Text } = ctx.els
  const { signal, index: i } = member
  const chips = signal.agentIds.slice(0, MAX_CHIPS)
  const more = Math.max(0, signal.agentIds.length - MAX_CHIPS)
  const toggle = cut || signal.eventIds.length > 0 ? toggleFor(ctx, signal, i) : undefined
  return (
    <Box key={`hl-m-${i}`} flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        {chips.length > 0 || more > 0 ? (
          <Box flexShrink={0}>
            <Text>{ChipRuns(ctx, chips, more)}</Text>
          </Box>
        ) : null}
        <Box flexDirection="column" flexShrink={1}>
          {FooterRow(ctx, toggle, actionsFor(ctx, signal, i))}
        </Box>
      </Box>
      {toggle?.open ? EvidenceBody(ctx, signal, i) : null}
    </Box>
  )
}

/**
 * Identical entries (same source, level, label, title and why) as one card: the shared words once, then one row per
 * entry with its chips and every one of its own actions, so each per-entry key stays drawn and reachable.
 */
function FoldedEntry(ctx: ViewContext, members: readonly Member[]) {
  const { Box } = ctx.els
  const [first] = members
  if (!first) return null
  const signal = first.signal
  const { shown, cut } = fitWhy(whyAfterTitle(signal), signal.evidence, whyRoom(ctx, []))
  return (
    <Box key={`hl-${first.index}`} flexDirection="column">
      {FindingCard(ctx, {
        key: `hl-${first.index}`,
        level: signal.level,
        evidence: signal.evidence,
        title: signal.title,
        note: plural(members.length, 'entry', 'entries'),
        why: shown,
        agentIds: [],
        actions: [],
        body: members.map(member => MemberRow(ctx, member, cut)),
      })}
    </Box>
  )
}

/** A value shown for reference (main's context fill): a quiet pill and its source, never a card, never a finding. */
function ValueEntry(ctx: ViewContext, signal: HealthSignal, i: number) {
  const { Box, Text } = ctx.els
  const glyph = EVIDENCE_GLYPH[signal.evidence]
  const lead = 'value only · '
  // The pill's own frame on desktop: a round border and one cell of padding each side.
  const pill = `${glyph} ${signal.title}`.length + (paintsGlass(ctx) ? CARD_FRAME : 0)
  const { shown, cut } = fitWhy(whyAfterTitle(signal), signal.evidence, Math.max(MIN_TEXT, ctx.width - pill - 1 - lead.length))
  const toggle = cut || ctx.layout === 'compact' || signal.eventIds.length > 0 ? toggleFor(ctx, signal, i) : undefined
  return (
    <Box key={`hl-${i}`} flexDirection="column">
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {Pill(ctx, {
          children: [
            <Text color={EVIDENCE_COLOR[signal.evidence]} weight="semibold">
              {glyph}
            </Text>,
            ' ',
            <Text weight="medium">{signal.title}</Text>,
          ],
        })}
        <Text dimColor wrap="truncate-end">
          {lead}
          {shown}
        </Text>
      </Box>
      {FooterRow(ctx, toggle, actionsFor(ctx, signal, i))}
      {toggle?.open ? EvidenceBody(ctx, signal, i) : null}
    </Box>
  )
}

/** Entries in first-appearance order, gathered by `keyOf`. */
function foldBy(members: readonly Member[], keyOf: (signal: HealthSignal) => string): Member[][] {
  const groups = new Map<string, Member[]>()
  for (const member of members) {
    const key = keyOf(member.signal)
    groups.set(key, [...(groups.get(key) ?? []), member])
  }
  return [...groups.values()]
}

/** Identical findings: everything the card draws once is the same. */
const sameFinding = (s: HealthSignal) => JSON.stringify([s.source, s.level, s.evidence, s.title, s.why])

/** A group heading with its count as a pill on desktop, as the dim summary on the terminal. */
function GroupHeader(ctx: ViewContext, title: string, count: string) {
  if (!paintsGlass(ctx)) return Heading(ctx, title, { level: 2, summary: count })
  const { Box } = ctx.els
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {Heading(ctx, title, { level: 2 })}
      {Pill(ctx, { children: count })}
    </Box>
  )
}

/** The findings counted by their own level: a priority to read in, never a score (no level is weighed against another). */
function LevelSummary(ctx: ViewContext, findings: readonly HealthSignal[]) {
  const { Box, Text } = ctx.els
  const counts = LEVEL_ORDER.map(level => ({ level, n: findings.filter(s => s.level === level).length })).filter(c => c.n > 0)
  if (counts.length === 0) return null
  const item = (level: HealthLevel, n: number) => [<Text color={LEVEL_STYLE[level].role}>{LEVEL_STYLE[level].glyph}</Text>, ` ${n} ${LEVEL_STYLE[level].word}`]
  if (paintsGlass(ctx)) {
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {counts.map(c => Pill(ctx, { key: `hl-lv-${c.level}`, children: item(c.level, c.n) }))}
      </Box>
    )
  }
  return (
    <Text wrap="wrap">
      {counts.map((c, i) => (
        <Text>
          {i > 0 ? <Text dimColor> · </Text> : ''}
          {item(c.level, c.n)}
        </Text>
      ))}
    </Text>
  )
}

type Group = (typeof GROUPS)[number] & { entries: Member[] }

/** A card per entry in the compact layout; identical entries folded into one card from medium up. */
function cardsOf(ctx: ViewContext, entries: readonly Member[]): Member[][] {
  return ctx.layout === 'compact' ? entries.map(e => [e]) : foldBy(entries, sameFinding)
}

function drawCard(cell: ViewContext, card: readonly Member[]) {
  const [first] = card
  if (!first) return null
  return card.length > 1 ? FoldedEntry(cell, card) : Entry(cell, first.signal, first.index)
}

/**
 * A group's findings: the first GROUP_FIRST entries, up to GROUP_MAX behind "show N more entries", then a count of the
 * rest with where they are all listed. The caps count entries, and each slice is folded on its own, so a folded card
 * never holds more rows than its slice and a crowded session stays within the tree budget.
 */
function GroupCards(ctx: ViewContext, group: Group, found: readonly Member[]) {
  const { Box, Text } = ctx.els
  const head = found.slice(0, GROUP_FIRST)
  const rest = found.slice(GROUP_FIRST, GROUP_MAX)
  const beyond = found.length - head.length - rest.length
  const more = (n: number) => plural(n, 'more entry', 'more entries')
  return (
    <Box flexDirection="column">
      {CardGrid(ctx, `hl-cell-${group.source}`, cardsOf(ctx, head), drawCard)}
      {rest.length > 0
        ? Disclosure(ctx, `hl-more-${group.source}`, `show ${more(rest.length)}`, () => (
            <Box flexDirection="column" marginTop={ctx.layout === 'compact' ? 0 : 1}>
              {CardGrid(ctx, `hl-cell-${group.source}-more`, cardsOf(ctx, rest), drawCard)}
              {beyond > 0 ? (
                <Text dimColor wrap="wrap">
                  +{more(beyond)} not drawn here; {group.elsewhere}.
                </Text>
              ) : null}
            </Box>
          ))
        : null}
    </Box>
  )
}

/** One source's group: its heading and count, its values as pills, then its findings as cards (folded from medium up). */
function GroupSection(ctx: ViewContext, group: Group) {
  const { Box } = ctx.els
  const values = group.entries.filter(e => isValueOnly(e.signal))
  const found = group.entries.filter(e => !isValueOnly(e.signal))
  const count = found.length === 0 ? 'value only' : `${plural(found.length, 'signal')}${values.length > 0 ? ` + ${plural(values.length, 'value')}` : ''}`
  return (
    <Box key={`hl-group-${group.source}`} flexDirection="column" marginTop={1}>
      {GroupHeader(ctx, group.title, count)}
      {values.map(e => ValueEntry(ctx, e.signal, e.index))}
      {found.length > 0 ? GroupCards(ctx, group, found) : null}
    </Box>
  )
}

export function HealthView(ctx: ViewContext, analyses: Analyses) {
  const { Box, Text } = ctx.els
  const signals = analyses.health
  const looked = GROUPS.map(g => g.title.toLowerCase()).join(', ')
  if (signals.length === 0) {
    return EmptyState(
      ctx,
      'No signals raised.',
      `Looked at ${looked}: none has raised anything so far. An empty list says nothing was flagged, not that the work was checked.`,
      { glyph: '○' },
    )
  }
  const indexed = signals.map((signal, index) => ({ signal, index }))
  const groups = GROUPS.map(group => ({ ...group, entries: indexed.filter(e => e.signal.source === group.source) }))
  const quiet = groups.filter(g => g.entries.length === 0).map(g => g.title.toLowerCase())
  const findings = findingsOf(signals)
  const values = signals.length - findings.length
  return (
    <Box flexDirection="column">
      {Heading(ctx, 'Swarm health', {
        summary: `${plural(findings.length, 'signal')}${values > 0 ? ` + ${plural(values, 'value')}` : ''} from existing analyses · ? ${unresolvedOf(signals).length} unresolved · no score, no thresholds`,
      })}
      {LevelSummary(ctx, findings)}
      <Text dimColor wrap="wrap">
        Each entry is one analysis's own finding, in its own words and on its own scale: a prompt to look, never a verdict.
      </Text>
      {groups.filter(g => g.entries.length > 0).map(group => GroupSection(ctx, group))}
      {quiet.length > 0 ? (
        <Text color={ROLE.muted} wrap="wrap">
          Nothing raised by: {quiet.join(', ')}.
        </Text>
      ) : null}
    </Box>
  )
}

// ── the Live strip ──

/** Lines the Live strip draws before "all N in Health": each line one title with all its entries' agents. */
const STRIP_LINES = 3
/** The least a strip line's title keeps beside its chips (unless it fits whole); else the chips take a second line. */
const STRIP_TITLE_MIN = 24
/** The `· ` before a strip line's chips. */
const STRIP_SEP = 2

/** Entries the strip draws as one line: the same level, label and title. */
const sameTitle = (s: HealthSignal) => JSON.stringify([s.level, s.evidence, s.title])

/** How many of `ids` fit in `budget` cells as chips, a `+N more agents` count standing for the rest. */
function chipsThatFit(ctx: ViewContext, ids: readonly string[], budget: number): number {
  if (chipsCells(ctx, ids) <= budget) return ids.length
  let fits = ids.length - 1
  while (fits > 0 && chipsCells(ctx, ids.slice(0, fits), ids.length - fits) > budget) fits -= 1
  return fits
}

/**
 * One strip line: glyph, level word, label and title, then every agent of the entries it stands for, fitted to `width`.
 * Where the chips would leave the title under STRIP_TITLE_MIN cells, they move to a second, indented line.
 */
function StripLine(ctx: ViewContext, members: readonly Member[], width: number) {
  const { Box, Text } = ctx.els
  const [first] = members
  if (!first) return null
  const signal = first.signal
  const ids = [...new Set(members.flatMap(m => m.signal.agentIds))]
  const prefix = headPrefix(signal.level, signal.evidence, signal.title).length
  // The terminal cuts the title to its exact cells. Desktop text is proportional (about 0.78 cell a character, R1
  // §5.2), and its renderer wraps a styled run nested in a truncating Text anyway (seen in the harness: nested runs
  // get `white-space:pre-wrap`), so there the whole title wraps inside its own shrinking Box beside the chips.
  const desktop = paintsGlass(ctx)
  const fit = (cells: number) => (desktop ? signal.title : truncate(signal.title, Math.max(1, cells)))
  const head = (title: string) => (
    <Box flexShrink={1} minWidth={0}>
      <Text wrap={desktop ? 'wrap' : 'truncate-end'}>{LevelHead(ctx, { level: signal.level, evidence: signal.evidence, title })}</Text>
    </Box>
  )
  const key = `sc-lv-sig-${first.index}`
  if (ids.length === 0) return <Box key={key}>{head(fit(width - prefix))}</Box>
  const oneLine = chipsCells(ctx, ids) <= width - prefix - Math.min(signal.title.length, STRIP_TITLE_MIN) - 1 - STRIP_SEP
  if (oneLine) {
    return (
      <Box key={key} flexDirection="row" columnGap={1}>
        {head(fit(width - prefix - 1 - STRIP_SEP - chipsCells(ctx, ids)))}
        <Box flexShrink={0}>
          <Text>
            <Text dimColor>·</Text> {ChipRuns(ctx, ids)}
          </Text>
        </Box>
      </Box>
    )
  }
  const fits = chipsThatFit(ctx, ids, width - STRIP_SEP)
  return (
    <Box key={key} flexDirection="column">
      {head(fit(width - prefix))}
      <Text wrap="truncate-end">
        {'  '}
        {ChipRuns(ctx, ids.slice(0, fits), ids.length - fits)}
      </Text>
    </Box>
  )
}

/**
 * Live's Health strip: the first findings of the Health tab, identical titles folded into one line with all their
 * agents (the first three findings are always among them), and the way to the tab. A sunken glass panel from medium
 * up. Drawn by Live (Workstream 1 places it); its look belongs to Health (Workstream 3). Signature frozen.
 */
export function HealthStrip(ctx: ViewContext, analyses: Analyses) {
  const { Box, Button, Text } = ctx.els
  const findings = findingsOf(analyses.health)
  const lines = foldBy(
    findings.map((signal, index) => ({ signal, index })),
    sameTitle,
  ).slice(0, STRIP_LINES)
  const covered = lines.reduce((n, line) => n + line.length, 0)
  const summary = findings.length > 0 ? `${covered} of ${findings.length} signals from existing analyses` : 'no signal raised'
  // A sunken panel on desktop (beside Live's own panels, whatever the column) and from medium up on the terminal,
  // where a compact dock keeps its rows.
  const framed = paintsGlass(ctx) || ctx.layout !== 'compact'
  const inner = ctx.width - (framed ? CARD_FRAME : 0)
  // The Health mark is rose (secondary chrome, §4.1), so the strip reads apart from Live's own sections.
  const heading = (
    <Text wrap="truncate-end">
      <Text color={ROLE.rose}>▌</Text>
      <Text weight="semibold" size="heading" {...headingInk()}>
        {' '}
        Health
      </Text>
      <Text dimColor> · {summary}</Text>
    </Text>
  )
  const body = [
    heading,
    ...lines.map(line => StripLine(ctx, line, inner)),
    findings.length > 0 ? (
      <Box flexDirection="row">
        <Button key="lv-health" label={`all ${findings.length} in Health`} variant="secondary" onPress={() => ctx.act.view('health')} />
      </Box>
    ) : null,
  ]
  return (
    <Box flexDirection="column" marginTop={1}>
      {framed ? GlassPanel(ctx, { tone: 'sunken', children: body }) : body}
    </Box>
  )
}
