// One timeline row, shared by Forensics and Live (recent activity, the
// inspector's last events): the event's number and time, the agent's identity
// chip, the event-kind glyph, the summary and the status in its verdict role.
// Live relies on its exported signatures.

import type { ForensicEvent } from '../../types'
import { VERDICT_COLOR, VERDICT_GLYPH, offset, truncate } from '../lib/format'
import { ROLE } from '../lib/palette'
import type { ViewContext } from './common'
import { AgentChip } from './kit'

/** Below this many columns a row drops the time column and shows its status as a glyph. */
const NARROW_LINE = 60
/** Cells an identity chip takes in an aligned row: ` A `, ` AB ` or `◎ main`, padded to this. */
const CHIP_COLS = 6

const KIND_GLYPH: Record<ForensicEvent['kind'], string> = {
  spawn: '⇢',
  'spawn-denied': '⊘',
  'turn-start': '▷',
  'turn-end': '◁',
  'agent-start': '▷',
  'agent-stop': '◁',
  roster: '☰',
  compaction: '⇊',
  session: '·',
  tool: '·',
}

const ACCESS_GLYPH: Record<string, string> = { read: '◦', write: '✎', search: '⌕', exec: '$', other: '·' }

/**
 * The event's kind as one glyph: ◦ read · ✎ write · ⌕ search · $ exec · ⇢ spawn · ⊘ denied · ▷ turn start ·
 * ◁ turn end · ⇊ compaction. A check shows its verdict instead (✓ ✕ ~, … while it runs); `⚑` is left to the Trail.
 */
export function eventGlyph(event: ForensicEvent): string {
  if (event.kind !== 'tool') return KIND_GLYPH[event.kind]
  if (event.outcome?.status === 'denied') return '⊘'
  if (event.tool?.verification) return VERDICT_GLYPH[event.outcome?.verdict ?? 'running']
  return ACCESS_GLYPH[event.tool?.access ?? 'other'] ?? '·'
}

/** The glyph's colour: a check's verdict role, a denial's caution, the rest plain. */
function glyphColor(event: ForensicEvent): string | undefined {
  if (event.kind === 'spawn-denied' || event.outcome?.status === 'denied') return ROLE.caution
  if (event.kind === 'tool' && event.tool?.verification) return VERDICT_COLOR[event.outcome?.verdict ?? 'running']
  return undefined
}

/** The result in words and its role: a check's verdict (with its exit code when failed), else the call's status. */
export function statusText(event: ForensicEvent): { text: string; color: string } {
  const outcome = event.outcome
  if (!outcome) return { text: '', color: ROLE.muted }
  if (outcome.verdict && outcome.verdict !== 'running') {
    return {
      text: outcome.verdict === 'failed' && outcome.exitCode !== undefined ? `failed (exit ${outcome.exitCode})` : outcome.verdict,
      color: VERDICT_COLOR[outcome.verdict],
    }
  }
  if (outcome.status === 'running') return { text: 'running', color: VERDICT_COLOR.running }
  if (outcome.status === 'error') return { text: outcome.exitCode !== undefined ? `error (exit ${outcome.exitCode})` : 'error', color: ROLE.fail }
  if (outcome.status === 'denied') return { text: 'denied', color: ROLE.caution }
  return { text: 'ok', color: ROLE.muted }
}

const SHORT_STATUS: Record<string, string> = {
  passed: '✓',
  failed: '✕',
  inconclusive: '~',
  running: '…',
  error: '✕',
  denied: '⊘',
}

/** The status glyph for a narrow row; none when the kind glyph already shows the verdict, or the call simply succeeded. */
function shortStatus(event: ForensicEvent): string {
  if (event.tool?.verification && event.outcome?.verdict) return ''
  return SHORT_STATUS[event.outcome?.verdict ?? event.outcome?.status ?? ''] ?? ''
}

/** Cells an agent's chip takes as drawn by AgentChip. */
function chipCells(ctx: ViewContext, agentId: string): number {
  const agent = Object.hasOwn(ctx.snapshot.agents, agentId) ? ctx.snapshot.agents[agentId] : undefined
  if (agent?.isMain || (!agent && agentId === 'main')) return 6
  return (agent?.label ?? '?').length + 2
}

/** Event kinds that frame the work rather than do it: drawn quieter so the calls, checks and delegations stand out. */
const FRAMING: ReadonlySet<ForensicEvent['kind']> = new Set(['turn-start', 'turn-end', 'agent-start', 'agent-stop', 'session'])

/** Desktop cell widths of a timeline row: the number and time, and the status column. */
const HEAD_COLS = 13
const NARROW_HEAD_COLS = 6
const STATUS_COLS = 18
const NARROW_STATUS_COLS = 2

/**
 * The desktop row: fixed-width Box cells, so the status column lines up on every row whatever the proportional font
 * does with the text before it. The summary takes the room left and ends in an ellipsis.
 */
function EventCells(ctx: ViewContext, event: ForensicEvent, narrow: boolean, withAgent: boolean) {
  const { Box, Text } = ctx.els
  const status = statusText(event)
  const shown = narrow ? shortStatus(event) : status.text
  const quiet = FRAMING.has(event.kind)
  const head = narrow ? `#${event.seq}` : `#${event.seq} ${offset(ctx.snapshot.startedAt, event.at)}`
  return (
    <Box flexDirection="row" flexGrow={1} columnGap={1}>
      <Box width={narrow ? NARROW_HEAD_COLS : HEAD_COLS} flexShrink={0}>
        <Text dimColor tabular wrap="truncate-end">
          {head}
        </Text>
      </Box>
      {withAgent ? (
        <Box width={CHIP_COLS} flexShrink={0}>
          <Text wrap="truncate-end">{AgentChip(ctx, event.agentId)}</Text>
        </Box>
      ) : null}
      <Box width={0} flexGrow={1}>
        <Text wrap="truncate-end" dimColor={quiet}>
          <Text color={glyphColor(event)}>{eventGlyph(event)}</Text> {event.summary}
        </Text>
      </Box>
      <Box width={narrow ? NARROW_STATUS_COLS : STATUS_COLS} flexShrink={0} justifyContent="flex-end">
        {shown ? (
          <Text color={status.color} wrap="truncate-end">
            {shown}
          </Text>
        ) : null}
      </Box>
    </Box>
  )
}

/**
 * One timeline row: `#seq +m:ss` (dim), the agent's chip, the kind glyph, the summary and the status, right-aligned.
 * Below 60 columns it drops the time column, does not pad the chip, and shortens the status to a glyph. On desktop the
 * row is a Box of aligned cells (place it in a Box, or as a `Row`'s `cells`); on the terminal it is one padded Text.
 * Turn and session framing events are drawn quieter on both.
 */
export function EventLine(ctx: ViewContext, event: ForensicEvent, width: number, withAgent: boolean) {
  const { Text } = ctx.els
  const narrow = width < NARROW_LINE
  if (ctx.surface !== 'terminal') return EventCells(ctx, event, narrow, withAgent)
  const status = statusText(event)
  const shown = narrow ? shortStatus(event) : status.text
  const head = narrow ? `#${event.seq} ` : `#${String(event.seq).padStart(3)} ${offset(ctx.snapshot.startedAt, event.at).padStart(7)} `
  const cells = withAgent ? chipCells(ctx, event.agentId) : 0
  const pad = withAgent && !narrow ? ' '.repeat(Math.max(1, CHIP_COLS + 1 - cells)) : withAgent ? ' ' : ''
  const glyph = eventGlyph(event)
  const used = head.length + cells + pad.length + glyph.length + 1
  const room = Math.max(8, width - used - (shown ? shown.length + 1 : 0))
  const summary = truncate(event.summary, room)
  return (
    <Text wrap="truncate-end">
      <Text dimColor>{head}</Text>
      {withAgent ? AgentChip(ctx, event.agentId) : ''}
      {pad}
      <Text color={glyphColor(event)}>{glyph}</Text> <Text dimColor={FRAMING.has(event.kind)}>{shown ? summary.padEnd(room) : summary}</Text>
      {shown ? <Text color={status.color}> {shown}</Text> : ''}
    </Text>
  )
}
