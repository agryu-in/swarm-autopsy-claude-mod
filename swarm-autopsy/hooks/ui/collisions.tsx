// View C, Collaboration Collisions (DESIGN-CONTRACT §8.4; Sunset Glass §11): a
// file × agent matrix of who read and who wrote what, in a glass panel, and the
// signals worth a look, each a card with its severity glyph and word, evidence
// label, agents, why, and its evidence and actions inside the card. A shared read
// is never a conflict, and the same relative path in two worktrees is never one
// file (lib/collisions decides both; this view only draws). A file several agents
// wrote is a potential conflict: amber, never red. Workstream 3 owns this file.

import type { RenderChildren } from 'claude-code'

import { baseName } from '../lib/classify'
import type { Collisions, FileRow, Signal } from '../lib/collisions'
import { displayPath, plural } from '../lib/format'
import { ROLE, SVG_HEX, withAlpha } from '../lib/palette'
import { nodeForEvents } from '../lib/signals'
import type { Trail } from '../lib/trail'
import type { ViewContext } from './common'
import { CARD_FRAME, CappedGrid, EvidencePanel, FindingCard, MAX_CHIPS, type GridCaps } from './health-cards'
import { AgentChip, Disclosure, EmptyState, EventChips, GlassPanel, Heading, LEVEL_STYLE, layoutFor, paintsGlass, type SignalAction } from './kit'

/** The narrowest a file name column gets before agent columns are left out. */
const MIN_NAME = 10
/** Rows of the matrix drawn; the rest are counted. */
const MAX_ROWS = 24
/** The marker column: `⇄ ` on a file written by more than one agent. */
const MARK = 2
/** Agents a signal card offers "Forensics: X" buttons for. */
const MAX_FILTER_BUTTONS = 3
/** Source events listed under an opened signal before "+N more". */
const MAX_EVENTS_SHOWN = 12
/** In the wide layout the signals sit beside the matrix when this many cells are left for them. */
const SIDE_MIN = 44
/** The matrix column's least width beside the signals, so its heading and legend stay readable. */
const LEFT_MIN = 36
/** Cells the matrix's glass panel takes: its round border and side padding (the card frame). */
const PANEL_FRAME = CARD_FRAME
// KIT-CANDIDATE: a translucent caution tint in GLASS (a potential-conflict row band); drawn from the caution Svg hex here.
/** Desktop only: the faint amber band behind a row several agents wrote. */
const conflictBand = (): string => withAlpha(SVG_HEX.caution, '29')
/** Signal cards drawn first (investigate before notice, as lib/collisions orders them), the rest behind "show more". */
const SIGNAL_CAPS: GridCaps = {
  first: 8,
  max: 40,
  moreId: 'col-more',
  noun: ['signal', 'signals'],
  elsewhere: "Forensics' Signals filter shows every event they rest on",
}

type Cell = { text: string; color: string; bold?: boolean; dim?: boolean }

function cellWidthOf(ctx: ViewContext, agents: readonly string[]): number {
  const longest = Math.max(1, ...agents.map(id => (ctx.snapshot.agents[id]?.isMain ? 1 : (ctx.snapshot.agents[id]?.label ?? '?').length)))
  return Math.max(4, longest + 3)
}

function cell(row: FileRow, agentId: string, width: number): Cell {
  const touch = row.touches.find(t => t.agentId === agentId)
  const fit = (text: string) => ` ${text}`.padEnd(width)
  // Not touched: muted and dim, so it never reads like a read (muted, full strength).
  if (!touch) return { text: fit('·'), color: ROLE.muted, dim: true }
  if (touch.writes > 0) {
    const count = touch.writes > 9 ? '+' : String(touch.writes)
    return { text: fit(`W${count}`), color: row.writers > 1 ? ROLE.caution : ROLE.text, bold: true }
  }
  if (touch.failedWrites > 0) return { text: fit('×'), color: ROLE.fail }
  return { text: fit('r'), color: ROLE.muted }
}

function rowLabel(ctx: ViewContext, row: FileRow): string {
  const cwd = ctx.snapshot.cwd
  const inSessionTree = row.root !== null && cwd !== undefined && (cwd === row.root || cwd.startsWith(`${row.root}/`))
  const worktree = row.root && cwd && !inSessionTree ? `[${baseName(row.root)}] ` : ''
  return worktree + (row.root ? row.rel : displayPath(row.path, ctx.snapshot.cwd))
}

/** A path cut from the left, so the file name stays: `…/auth/token.ts`. */
function fitPath(label: string, width: number): string {
  if (label.length <= width) return label
  return `…${label.slice(label.length - Math.max(1, width - 1))}`
}

// KIT-CANDIDATE: AgentChip with a one-glyph main loop (` ◎ `), so a matrix column is as wide for main as for a letter.
function HeadChip(ctx: ViewContext, agentId: string) {
  const { Text } = ctx.els
  const agent = Object.hasOwn(ctx.snapshot.agents, agentId) ? ctx.snapshot.agents[agentId] : undefined
  if (agent?.isMain || (!agent && agentId === 'main')) {
    return (
      <Text color={ROLE.main} weight="bold">
        {' ◎ '}
      </Text>
    )
  }
  return AgentChip(ctx, agentId)
}

type MatrixPlan = { agents: string[]; hidden: number; cellWidth: number; nameWidth: number; width: number }

/** Column sizes: the name column as wide as the longest label that fits, agent columns left out only when none fit. */
function planMatrix(ctx: ViewContext, collisions: Collisions, width: number): MatrixPlan {
  const cellWidth = cellWidthOf(ctx, collisions.agents)
  const fits = Math.max(1, Math.floor((width - MARK - MIN_NAME) / cellWidth))
  const agents = collisions.agents.slice(0, fits)
  const longest = Math.max(MIN_NAME, ...collisions.files.slice(0, MAX_ROWS).map(row => rowLabel(ctx, row).length))
  const nameWidth = Math.max(MIN_NAME, Math.min(longest, width - MARK - agents.length * cellWidth - 1))
  return { agents, hidden: collisions.agents.length - agents.length, cellWidth, nameWidth, width: MARK + nameWidth + 1 + agents.length * cellWidth }
}

/** One file's row: `⇄` and its writes in amber when several agents wrote it, with a faint amber band on desktop. */
function MatrixRow(ctx: ViewContext, row: FileRow, plan: MatrixPlan) {
  const { Text } = ctx.els
  const shared = row.writers > 1
  const band = shared && paintsGlass(ctx) ? { backgroundColor: conflictBand() } : {}
  return (
    <Text mono wrap="truncate-end" {...band}>
      <Text color={ROLE.caution} weight="bold">
        {shared ? '⇄ ' : '  '}
      </Text>
      {fitPath(rowLabel(ctx, row), plan.nameWidth).padEnd(plan.nameWidth)}{' '}
      {plan.agents.map(id => {
        const c = cell(row, id, plan.cellWidth)
        return (
          <Text color={c.color} {...(c.bold ? { weight: 'bold' as const } : {})} {...(c.dim ? { dimColor: true } : {})}>
            {c.text}
          </Text>
        )
      })}
    </Text>
  )
}

function Matrix(ctx: ViewContext, collisions: Collisions, plan: MatrixPlan) {
  const { Box, Text } = ctx.els
  const rows = collisions.files.slice(0, MAX_ROWS)
  const lead = ' '.repeat(MARK + plan.nameWidth + 1)
  return (
    <Box flexDirection="column">
      <Text mono wrap="truncate-end">
        {lead}
        {plan.agents.map(id => (
          <Text>
            {HeadChip(ctx, id)}
            {' '.repeat(Math.max(0, plan.cellWidth - (ctx.snapshot.agents[id]?.isMain ? 3 : (ctx.snapshot.agents[id]?.label ?? '?').length + 2)))}
          </Text>
        ))}
      </Text>
      {rows.map(row => MatrixRow(ctx, row, plan))}
      {collisions.totalFiles > rows.length ? <Text dimColor>… {plural(collisions.totalFiles - rows.length, 'more written file')} not drawn</Text> : null}
      {plan.hidden > 0 ? (
        <Text dimColor wrap="wrap">
          … {plural(plan.hidden, 'more agent')} not drawn at this width; their writes still raise the signals below
        </Text>
      ) : null}
    </Box>
  )
}

function Legend(ctx: ViewContext) {
  const { Box, Text } = ctx.els
  return Disclosure(ctx, 'col-legend', 'what r, W, × and ⇄ mean', () => (
    <Box flexDirection="column">
      <Text dimColor wrap="wrap">
        W2: written twice (calls that succeeded) · r: read only · ×: only failed or refused edits · ·: not touched
      </Text>
      <Text dimColor wrap="wrap">
        ⇄: written by more than one agent, in amber. Several agents reading one file is never a conflict.
      </Text>
      <Text dimColor wrap="wrap">
        [name]: the folder of a git checkout outside this session's directory. Files only read are not listed.
      </Text>
    </Box>
  ))
}

/**
 * The matrix section: heading, matrix or empty state, worktree note (several roots only), legend. `framed`: in a glass
 * panel (medium and wider; the plan then left the panel's frame out of its width); compact draws it plain.
 */
function FilesSection(ctx: ViewContext, collisions: Collisions, plan: MatrixPlan, framed: boolean) {
  const { Box, Text } = ctx.els
  const roots = new Set(collisions.files.map(f => f.root).filter((r): r is string => r !== null)).size
  if (collisions.files.length === 0) {
    return EmptyState(ctx, 'No file writes observed', 'The matrix compares agents on files someone wrote; reads alone are not drawn.', { glyph: '✎' })
  }
  const summary = `● observed · ${plural(collisions.totalFiles, 'written file')}`
  const body = [
    Matrix(ctx, collisions, plan),
    roots > 1 ? (
      <Text dimColor wrap="wrap">
        {roots} worktrees seen: the same relative path in different worktrees is compared as divergence, never as one file.
      </Text>
    ) : null,
    Legend(ctx),
  ]
  if (framed) return GlassPanel(ctx, { key: 'col-matrix', tone: 'base', title: 'Files × agents', summary, children: body })
  return (
    <Box flexDirection="column">
      {Heading(ctx, 'Files × agents', { summary })}
      {body}
    </Box>
  )
}

const seqOf = (ctx: ViewContext, eventId: string | undefined) => ctx.snapshot.events.find(e => e.id === eventId)?.seq

function filterButtons(ctx: ViewContext, signal: Signal, i: number): SignalAction[] {
  return signal.agents.slice(0, MAX_FILTER_BUTTONS).map((agentId, j) => ({
    key: `sig-fx-${i}-${j}`,
    label: `Forensics: ${ctx.snapshot.agents[agentId]?.isMain ? 'main' : (ctx.snapshot.agents[agentId]?.label ?? '?')}`,
    onPress: () => {
      ctx.act.agentFilter(agentId)
      ctx.act.view('forensics')
    },
  }))
}

function trailButton(ctx: ViewContext, nodeId: string | undefined, i: number): SignalAction[] {
  return nodeId ? [{ key: `sig-tr-${i}`, label: 'show in Trail', onPress: () => ctx.act.showNode(nodeId) }] : []
}

/** The card's actions beside its evidence toggle: its first source event; wide and medium add Trail and Forensics filters. */
function actionsFor(ctx: ViewContext, signal: Signal, i: number, nodeId: string | undefined): SignalAction[] {
  const first = signal.eventIds[0]
  const seq = seqOf(ctx, first)
  const base: SignalAction[] = first && seq !== undefined ? [{ key: `sig-src-${i}`, label: `#${seq} in Forensics`, onPress: () => ctx.act.openEvent(first) }] : []
  if (ctx.layout === 'compact') return base
  return [...base, ...trailButton(ctx, nodeId, i), ...filterButtons(ctx, signal, i)]
}

/** The opened signal, inside its card: what its severity means, every detail line, its files, agents and events. */
function SignalEvidence(ctx: ViewContext, signal: Signal, i: number, nodeId: string | undefined) {
  const { Box, Button, Text } = ctx.els
  const style = LEVEL_STYLE[signal.severity]
  const more = ctx.layout === 'compact' ? [...trailButton(ctx, nodeId, i), ...filterButtons(ctx, signal, i)] : []
  return EvidencePanel(
    ctx,
    <Box flexDirection="column">
      <Text wrap="wrap">
        <Text color={style.role}>{style.glyph}</Text>{' '}
        <Text dimColor>
          {signal.severity === 'investigate' ? 'worth investigating' : 'for awareness'}; a signal is not a defect by itself.
        </Text>
      </Text>
      {signal.detail.map(line => (
        <Text dimColor wrap="wrap">
          {line}
        </Text>
      ))}
      {signal.paths.length > 0 ? (
        <Text dimColor wrap="wrap">
          files: {signal.paths.map(p => displayPath(p, ctx.snapshot.cwd)).join(', ')}
        </Text>
      ) : null}
      {signal.agents.map(id => (
        <Text wrap="truncate-end">{AgentChip(ctx, id, { name: true, state: true })}</Text>
      ))}
      <Text dimColor>source events:</Text>
      {EventChips(ctx, `sig-ev-${i}`, signal.eventIds, MAX_EVENTS_SHOWN)}
      {more.length > 0 ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {more.map(action => (
            <Button key={action.key} label={action.label} variant="secondary" onPress={action.onPress} />
          ))}
        </Box>
      ) : null}
    </Box>,
  )
}

function SignalsSection(ctx: ViewContext, collisions: Collisions, trail: Trail | undefined) {
  const { Box } = ctx.els
  const selectedId = ctx.ui.selected?.startsWith('sig:') ? ctx.ui.selected.slice('sig:'.length) : undefined
  const signals = collisions.signals
  const body: RenderChildren =
    signals.length === 0
      ? EmptyState(
          ctx,
          'No collision signals.',
          'No shared or overwritten writes, stale writes, tests during a change, repeated failures or contradictory results were observed in the retained events.',
          { glyph: '○' },
        )
      : CappedGrid(ctx, 'sig-cell', signals, SIGNAL_CAPS, (cell, signal, i) => {
          const selected = signal.id === selectedId
          const nodeId = trail ? nodeForEvents(trail, signal.eventIds) : undefined
          const events = signal.eventIds.length
          return FindingCard(cell, {
            key: `col-${i}`,
            level: signal.severity,
            evidence: signal.evidence,
            title: signal.title,
            why: signal.detail[0] ?? '',
            wrapWhy: true,
            agentIds: signal.agents.slice(0, MAX_CHIPS),
            moreAgents: Math.max(0, signal.agents.length - MAX_CHIPS),
            toggle: {
              key: `sig-${i}`,
              open: selected,
              label: events > 0 ? `evidence · ${plural(events, 'source event')}` : 'evidence',
              onPress: () => ctx.act.select(selected ? undefined : `sig:${signal.id}`),
            },
            actions: actionsFor(cell, signal, i, nodeId),
            body: selected ? SignalEvidence(cell, signal, i, nodeId) : null,
          })
        })
  return (
    <Box flexDirection="column">
      {Heading(ctx, 'Signals', { summary: `${signals.length} · a prompt to look, never a verdict` })}
      {body}
    </Box>
  )
}

/** A narrower view context for one column of a two-column layout. */
function column(ctx: ViewContext, width: number): ViewContext {
  return { ...ctx, width, layout: layoutFor(width) }
}

/**
 * The matrix, then the signals. Wide panes put the signals beside the matrix when it leaves them room. `trail`, when
 * the caller passes it, adds "show in Trail" to signals whose events a trail node holds.
 */
export function CollisionsView(ctx: ViewContext, collisions: Collisions, trail?: Trail) {
  const { Box, Text } = ctx.els
  const dropped = ctx.snapshot.droppedEvents
  const gap = dropped > 0 ? (
    <Text color={ROLE.muted} wrap="wrap">
      ∅ {plural(dropped, 'older event')} dropped from the timeline: the matrix and signals cover the retained events only.
    </Text>
  ) : null
  // Medium and wider draw the matrix in a glass panel: its frame comes out of the matrix's width.
  const framed = ctx.layout !== 'compact'
  const frame = framed ? PANEL_FRAME : 0
  const plan = planMatrix(ctx, collisions, ctx.width - frame)
  const leftWidth = Math.max(plan.width + frame, LEFT_MIN)
  const side = ctx.width - leftWidth - 1
  if (ctx.layout === 'wide' && collisions.files.length > 0 && side >= SIDE_MIN) {
    const left = column(ctx, leftWidth)
    const right = column(ctx, side)
    return (
      <Box flexDirection="column">
        {gap}
        <Box flexDirection="row" columnGap={1}>
          <Box flexDirection="column" width={leftWidth}>
            {FilesSection(left, collisions, plan, framed)}
          </Box>
          <Box flexDirection="column" width={side}>
            {SignalsSection(right, collisions, trail)}
          </Box>
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      {gap}
      {FilesSection(ctx, collisions, plan, framed)}
      <Box flexDirection="column" marginTop={1}>
        {SignalsSection(ctx, collisions, trail)}
      </Box>
    </Box>
  )
}
