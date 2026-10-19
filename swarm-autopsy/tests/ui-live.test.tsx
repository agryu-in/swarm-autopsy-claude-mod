// Workstream A · Live view, agent cards and context visuals (DESIGN-CONTRACT
// §8.2). The whole pane is mounted through the engine's own test host with a
// SIMULATED snapshot seeded through `state.get`, as the acceptance suite does,
// and the drawn tree is read as data: lines, button keys, borders and Svg.
// No live session, model or network is involved.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { compact } from '../hooks/lib/format'
import { applyUsage, buildLedgerView } from '../hooks/lib/ledger'
import { GLASS, ROLE, identityHex } from '../hooks/lib/palette'
import { PRICE_TABLE } from '../hooks/lib/pricing'
import { activityOf, bucketEvidence, filesOf, usageOf } from '../hooks/ui/live-facts'
import type { AgentOutcome, ContributionOutcome, LedgerRow, Snapshot, UsageRecord } from '../types'
import { build, spawn, tool, turnEnd, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { CLASSIC, applyTheme, themeFor } from '../hooks/lib/themes'
import { buttonKeys, drawingsOf, inline, logicalLines, treeSize, type DrawnNode, withClients } from './view-helpers'

const PLUGIN = 'swarm-autopsy'
const NOW = 1_100_000
const OPUS_1M = 'claude-opus-5-5[1m]'
/** A model the documented window table does not list: its agent can show no context %. */
const SONNET = 'claude-unlisted-9'
const SLOW = { timeoutMs: 120_000 }
/**
 * The mod draws the desktop pane's content inside a Client over the still scene, and a Client's tree carries no hover (its
 * client-tree schema has none): there a card no longer lights under the pointer. Its lines stay pressable Buttons.
 */
const cardHover = () => undefined

const PANE = (bodyColumns: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: {
    title: 'Swarm Autopsy',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
})

// ── SIMULATED fixture ──

type Options = { compaction?: boolean; mainActive?: boolean; percent?: number; task?: string }

/**
 * Main and five subagents. The explorer (A) searched a directory and read two files, on main's model (≈% allowed);
 * the implementer (B) edited a file and had a failing build, on another model (no %); the auditor's (C) requests all
 * came back without usage; the reviewer (D) is still active with two requests; `quiet` (E) has no request at all.
 */
function session(options: Options = {}): Snapshot {
  const base = build(
    ...(options.mainActive ? [turnStart(undefined, 'm-1')] : []),
    spawn('explorer', { type: 'Explore', description: options.task ?? 'investigate token expiry', prompt: 'Find why tokens expire early in src/auth/token.ts' }),
    turnStart('explorer', 't-x'),
    ...tool('explorer', 'g1', 'Grep', { pattern: 'expiry', path: '/repo/src' }),
    ...tool('explorer', 'r1', 'Read', { file_path: '/repo/src/auth/token.ts' }),
    ...tool('explorer', 'r2', 'Read', { file_path: '/repo/src/auth/session.ts' }),
    turnEnd('explorer', 't-x', 'Finding: `src/auth/token.ts` compares expiry in seconds against Date.now() in milliseconds.'),
    spawn('implementer', { description: 'fix token expiry', prompt: 'Fix the unit mismatch in src/auth/token.ts.' }),
    turnStart('implementer', 't-i'),
    ...tool('implementer', 'e1', 'Edit', { file_path: '/repo/src/auth/token.ts', old_string: 'exp < Date.now()', new_string: 'exp * 1000 < Date.now()' }),
    ...tool('implementer', 'b0', 'Bash', { command: 'npm run build' }, { isError: true, text: 'Exit code 1' }),
    turnEnd('implementer', 't-i', 'Changed the comparison to milliseconds.'),
    spawn('auditor', { type: 'docs-auditor', description: 'audit the README', prompt: 'Audit README.md for stale commands.' }),
    turnStart('auditor', 't-a'),
    ...tool('auditor', 'ra', 'Read', { file_path: '/repo/README.md' }),
    turnEnd('auditor', 't-a', 'Two commands in the README no longer exist.'),
    spawn('reviewer', { type: 'code-reviewer', description: 'review the fix', prompt: 'Review the change to token.ts.' }),
    turnStart('reviewer', 't-r'),
    ...tool('reviewer', 'rr', 'Read', { file_path: '/repo/src/auth/token.ts' }),
    spawn('quiet', { description: 'stand by for follow-ups', prompt: 'Wait for follow-up work.' }),
  )
  const records: UsageRecord[] = [
    usageRecord({ agentId: 'main', turnId: 'm', index: 0, at: NOW - 60_000, tokens: tokens(40, 60_000, 8_000, 900), requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'main', turnId: 'm', index: 1, at: NOW - 30_000, tokens: tokens(30, 80_000, 6_000, 1_200), requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'explorer', turnId: 'x', index: 0, at: NOW - 50_000, tokens: tokens(20, 30_000, 4_000, 700), requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'explorer', turnId: 'x', index: 1, at: NOW - 49_000, tokens: tokens(20, 40_000, 2_000, 800), requestedModel: OPUS_1M }),
    ...[0, 1, 2].map(i =>
      usageRecord({
        agentId: 'implementer',
        turnId: 'i',
        index: i,
        at: NOW - 40_000 + i * 1000,
        tokens: tokens(10, 140_000, 10_000, 500),
        requestedModel: SONNET,
        model: SONNET,
        stopReason: i === 2 && options.compaction ? 'max_tokens' : 'tool_use',
      }),
    ),
    usageRecord({ agentId: 'auditor', turnId: 'a', index: 0, at: NOW - 20_000, tokens: null, requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'auditor', turnId: 'a', index: 1, at: NOW - 19_000, tokens: null, requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'reviewer', turnId: 'r', index: 0, at: NOW - 10_000, tokens: tokens(15, 9_000, 500, 400), requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'reviewer', turnId: 'r', index: 1, at: NOW - 5_000, tokens: tokens(15, 12_000, 500, 300), requestedModel: OPUS_1M }),
  ]
  const variant = `${options.compaction ? 'c' : ''}${options.mainActive ? 'm' : ''}${options.task ? 't' : ''}${options.percent ?? 'p'}`
  const snapshot = { ...base, sessionId: `ui-live-${variant}` }
  return {
    ...snapshot,
    ledger: records.reduce((ledger, record) => applyUsage(ledger, record), snapshot.ledger),
    context: { window: 1_000_000, tokens: 86_030, percent: options.percent ?? 9, at: NOW - 1_000 },
    compactionMarks: options.compaction ? [{ agentId: 'implementer', at: NOW - 38_500, seq: 999, trigger: 'auto', tokensBefore: 41_000 }] : [],
  }
}

function seeded(on: On, seed: Snapshot) {
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: seed.sessionId ?? 'ui-live' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', (_$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

/** What these tests need of a mounted pane. */
type Ui = {
  drawn: () => Promise<unknown>
  drawings?: () => Promise<unknown[]>
  press: (args: { key: string }) => Promise<unknown>
  find: (query: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined>
  unmount: () => Promise<unknown>
}

async function mount($: Engine, surface: 'terminal' | 'desktop', width: number): Promise<Ui> {
  const ui: Ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
  await ui.press({ key: 'tab-live' })
  return ui
}

/** Turns ≈$ on (the pane's state outlives a mount within a test, so it presses only when cost is off). */
async function costOn(ui: Ui) {
  await ui.press({ key: 'tab-spend' })
  const toggle = await ui.find({ key: 'toggle-cost' })
  if (/show/.test(String(toggle?.props?.label))) await ui.press({ key: 'toggle-cost' })
  await ui.press({ key: 'tab-live' })
}

// ── reading the drawn tree ──

type El = Exclude<DrawnNode, string | number | boolean | null | undefined>

function kids(node: El): DrawnNode[] {
  if (Array.isArray(node.children)) return node.children
  const fromProps = node.props?.children
  if (Array.isArray(fromProps)) return fromProps as DrawnNode[]
  return fromProps === undefined ? [] : [fromProps as DrawnNode]
}

const isEl = (node: DrawnNode): node is El => node !== null && typeof node === 'object'

/** Every element in document order. */
function all(node: DrawnNode, out: El[] = []): El[] {
  if (!isEl(node)) return out
  out.push(node)
  for (const child of kids(node)) all(child, out)
  return out
}

function byKey(root: DrawnNode, key: string): El | undefined {
  return all(root).find(n => n.props?.key === key)
}

/**
 * Whether the Button `key` is drawn selected: the app's primary Button, or (where the theme draws a selection as glass:
 * Abyssal on desktop) a secondary Button inside its edged `sel-<key>` capsule.
 */
function isSelected(root: DrawnNode, key: string): boolean {
  const capsule = byKey(root, `sel-${key}`)
  return byKey(root, key)?.props?.variant === 'primary' || (typeof capsule?.props?.borderColor === 'string' && byKey(capsule as DrawnNode, key) !== undefined)
}

/** Each Text, Button and Svg as one line, whatever Box it sits in (rows are not joined). */
function lines(node: DrawnNode): string[] {
  if (!isEl(node)) return typeof node === 'string' || typeof node === 'number' ? [String(node)] : []
  if (node.type === 'Text' || node.type === 'Button' || node.type === 'Svg') {
    const text = inline(node)
    return text.trim() ? [text] : []
  }
  return kids(node).flatMap(lines)
}

const textOf = (node: DrawnNode | undefined) => (node === undefined ? '' : lines(node).join('\n'))

async function drawn(ui: Ui): Promise<DrawnNode> {
  return (await ui.drawn()) as DrawnNode
}

// The acceptance suite's own patterns (tests/acceptance.test.tsx), applied to this view's lines.
const OBSERVED_ZERO = /●\s*(in\s+)?0(\s|$)|●\s*0 tok|direct 0 tok/
const FORBIDDEN = /\b(wasted?|useless|lost|ignored|unused|inefficien\w*|more than expected|top contributors?)\b/i
const METRIC = /\d[\d.,]*\s?[kM]?\s?(tok|tokens|req|requests)\b|\d[\d.]*%/
const LABEL = /[●≈∅◆◇?]/
const EXEMPT = /^\[|^#\d|\+\d+:\d\d|page \d|show ≈\$|hide ≈\$|^▸|^▾|\blast \d+( of \d+)? requests?\b/

const AGENTS = ['explorer', 'implementer', 'auditor', 'reviewer', 'quiet'] as const

// ── compact (the terminal keeps one line per agent; the desktop draws cards at every width, below) ──

describe('Live: compact terminal layout (49 columns)', () => {
  test('one selectable line per agent, in spawn order: chip, state, task, mini meter, total, writes and errors', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 49)
    const tree = await drawn(ui)
    const keys = buttonKeys(tree).filter(k => k.startsWith('card-'))
    expect(keys).toEqual(['card-main', ...AGENTS.map(a => `card-${a}`)])
    expect(all(tree).filter(n => n.props?.borderStyle !== undefined)).toEqual([])
    const row = inline(byKey(tree, 'card-implementer'))
    expect(row.startsWith('▸')).toBe(true)
    expect(row).toContain(' B ')
    expect(row).toContain('fix token')
    expect(row).toContain('∅ % n/a')
    expect(row).toMatch(/● 452k/)
    expect(row).toContain('✎1')
    expect(row).toContain('✕1')
    const explorer = inline(byKey(tree, 'card-explorer'))
    expect(explorer).toMatch(/≈ 4\.2%/)
    expect(explorer).not.toContain('✎')
    await ui.unmount()
  })

  test('focusing an agent replaces the list with its inspector, and a button leads back', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 49)
    await ui.press({ key: 'card-explorer' })
    const focused = await drawn(ui)
    const keys = buttonKeys(focused)
    expect(keys).toContain('focus-back')
    expect(keys).toContain('card-explorer')
    expect(keys).not.toContain('card-implementer')
    expect(keys).not.toContain('card-main')
    expect(inline(byKey(focused, 'focus-back'))).toContain('◂ all agents')
    expect(textOf(focused)).toContain('compares expiry in seconds')
    await ui.press({ key: 'focus-back' })
    expect(buttonKeys(await drawn(ui))).toContain('card-implementer')
    await ui.press({ key: 'card-explorer' })
    await ui.press({ key: 'card-explorer' })
    expect(buttonKeys(await drawn(ui))).toContain('card-implementer')
    await ui.unmount()
  })

  test('with cost on, the rows carry ≈$ and the screen states the price date, API-equivalent and not a charge', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 49)
    await costOn(ui)
    for (const step of ['list', 'inspector']) {
      if (step === 'inspector') await ui.press({ key: 'card-explorer' })
      const text = textOf(await drawn(ui))
      expect(text).toMatch(/≈\$\d|≈<\$0\.01/)
      expect(text).toContain(PRICE_TABLE.date)
      expect(text).toContain('API-equivalent')
      expect(text).toContain('not a charge')
    }
    await ui.unmount()
  })
})

// ── unknown usage (O5) ──

describe('Live: usage that came back without counts (O5)', () => {
  test('an agent whose requests all returned no usage, or with none heard, reads usage unknown, never an observed zero', SLOW, async ($, on) => {
    seeded(on, session())
    for (const width of [49, 80, 116]) {
      const ui = await mount($, 'terminal', width)
      const tree = await drawn(ui)
      const auditor = textOf(width < 56 ? byKey(tree, 'card-auditor') : byKey(tree, 'card-box-auditor'))
      const quiet = textOf(width < 56 ? byKey(tree, 'card-quiet') : byKey(tree, 'card-box-quiet'))
      expect(auditor).toContain('∅ usage unknown')
      expect(quiet).toContain('∅ usage unknown')
      if (width >= 56) {
        expect(auditor).toContain('∅ usage unknown (2 requests returned no usage)')
        expect(quiet).toContain('∅ usage unknown (no model request heard yet)')
      }
      expect(lines(tree).filter(l => OBSERVED_ZERO.test(l))).toEqual([])
      await ui.unmount()
    }
  })
})

// ── cards ──

describe('Live: agent cards (medium 80, wide 116)', () => {
  test('each card is a rounded box in the agent’s identity colour; the coordinator’s is claude', SLOW, async ($, on) => {
    const seed = session()
    seeded(on, seed)
    for (const width of [80, 116]) {
      const ui = await mount($, 'terminal', width)
      const tree = await drawn(ui)
      // The terminal draws the classic theme: its identity hues, and claude for the coordinator.
      applyTheme(CLASSIC)
      for (const id of AGENTS) {
        const box = byKey(tree, `card-box-${id}`)
        expect(box?.props?.borderStyle).toBe('round')
        expect(box?.props?.borderColor).toBe(identityHex(seed.agents[id]))
      }
      applyTheme(themeFor('desktop'))
      expect(byKey(tree, 'card-box-main')?.props?.borderColor).toBe('claude')
      await ui.unmount()
    }
  })

  test('a card reads: identity and state, task, one figures line (context, then tokens), activity and counts, sparkline', SLOW, async ($, on) => {
    const seed = session()
    seeded(on, seed)
    const ui = await mount($, 'terminal', 80)
    const tree = await drawn(ui)
    const explorer = logicalLines(byKey(tree, 'card-box-explorer') ?? null)
    expect(explorer).toHaveLength(5)
    expect(explorer[0]).toMatch(/^▸ +A +Explore ◉ completed/)
    expect(explorer[1]).toBe('“investigate token expiry”')
    expect(explorer[2]).toMatch(/^ctx .*≈ 4\.2% of 1\.0M · ● prompt 42k/)
    const view = buildLedgerView(seed.ledger, seed, { showCost: false })
    const processed = compact(view.rows.find(r => r.agentId === 'explorer')?.direct.processed ?? -1)
    // The figures line: the context gauge first, then the agent's own tokens processed with their bar, apart.
    expect(explorer[2]).toMatch(new RegExp(`prompt 42k · ● ${processed} processed █+$`))
    expect(explorer[3]).toMatch(/● 2 read/)
    expect(explorer[3]).toMatch(/✦ report/)
    expect(explorer.at(-1)).toMatch(/^[▁▂▃▄▅▆▇█]{2} ● last 2 requests · peak 42k/)
    const quiet = lines(byKey(tree, 'card-box-quiet'))
    expect(quiet.some(l => /[▁▂▃▄▅▆▇]/.test(l))).toBe(false)
    await ui.unmount()
    // A narrow card keeps every figure whole: the tokens move to a line of their own rather than being cut.
    for (const width of [116, 160]) {
      const narrow = await mount($, 'terminal', width)
      const card = logicalLines(byKey(await drawn(narrow), 'card-box-explorer') ?? null)
      expect(card.some(l => /≈ 4\.2% of 1\.0M · ● prompt 42k/.test(l))).toBe(true)
      expect(card.some(l => l.includes(`● ${processed} processed █`))).toBe(true)
      await narrow.unmount()
    }
  })

  test('an agent on another model shows ∅ % n/a and its latest prompt, never a capacity', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 80)
    const card = textOf(byKey(await drawn(ui), 'card-box-implementer'))
    expect(card).toContain('ctx ∅ % n/a · ● latest prompt 150k')
    expect(card).not.toMatch(/of 1\.0M|of 200k/)
    await ui.unmount()
  })

  test('an inactive agent’s sparkline is dim; an active one’s is in the context colour', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 80)
    const tree = await drawn(ui)
    // The sparkline is the card's last press line: its first run is the glyphs, in their colour.
    const sparkColour = (id: string) => {
      const line = all(byKey(tree, `card-box-${id}`)).find(n => n.type === 'Button' && /requests · peak/.test(inline(n)) && /^[▁-█]/.test(inline(n)))
      const first = line ? kids(line).find(isEl) : undefined
      return first?.props?.color
    }
    expect(sparkColour('explorer')).toBe('inactive')
    // The terminal draws the classic theme's context colour.
    applyTheme(CLASSIC)
    expect(sparkColour('reviewer')).toBe(ROLE.context)
    applyTheme(themeFor('desktop'))
    await ui.unmount()
  })

  test('the coordinator counts turns completed, never “0 turns” while active, and shows its spawn tree as overlapping', SLOW, async ($, on) => {
    seeded(on, session({ mainActive: true }))
    const ui = await mount($, 'terminal', 80)
    const card = textOf(byKey(await drawn(ui), 'card-box-main'))
    expect(card).toMatch(/◎ main ◐ active/)
    expect(card).not.toMatch(/\b0 turns?\b/)
    expect(card).toContain('first turn running')
    expect(card).toMatch(/● spawn tree \d+k · 6 agents \(overlaps their own figures; never added\)/)
    expect(card).not.toMatch(/descendant|session|total/i)
    await ui.unmount()
  })
})

// ── narrow desktop panes: the full cards at every width (the person's report, 2026-10-18) ──

/** Every Button label inside an agent's card, in drawing order (desktop: a line's words are its label). */
const cardLabels = (tree: DrawnNode, id: string) =>
  all(byKey(tree, `card-box-${id}`))
    .filter(n => n.type === 'Button')
    .map(inline)

/** A task long enough to need two lines in a narrow card. */
const LONG_TASK = 'investigate why refresh tokens expire early across regions'

describe('Live: narrow desktop panes draw the full cards', () => {
  test('at 40, 49 and 60 columns every agent and the coordinator get their glass card with every fact, none cut', SLOW, async ($, on) => {
    const seed = session({ mainActive: true })
    seeded(on, seed)
    const ledger = buildLedgerView(seed.ledger, seed, { showCost: false })
    const processed = (id: string) => `● ${compact(ledger.rows.find(r => r.agentId === id)?.direct.processed ?? -1)} processed`
    const facts: Record<string, string[]> = {
      main: ['coordinator', '● 9% · 86k of 1.0M', processed('main'), 'first turn running', '● spawn tree', 'never added'],
      explorer: ['Explore', 'investigate token expiry', '≈ 4.2% of 1.0M', '● prompt 42k', processed('explorer'), 'answered', '● 2 read', '✦ report', '● last 2 requests', 'peak 42k'],
      // An agent spawned without a type is recorded as general-purpose (tests/fixtures.ts).
      implementer: ['general-purpose', 'fix token expiry', '∅ % n/a', '● latest prompt 150k', processed('implementer'), '✎1', '✕1', '● last 3 requests'],
      auditor: ['docs-auditor', 'audit the README', '∅ usage unknown (2 requests returned no usage)'],
      reviewer: ['code-reviewer', 'review the fix', processed('reviewer'), 'Read token.ts', '● last 2 requests'],
      quiet: ['general-purpose', 'stand by for follow-ups', '∅ usage unknown (no model request heard yet)'],
    }
    for (const width of [40, 49, 60]) {
      const ui = await mount($, 'desktop', width)
      const tree = await drawn(ui)
      for (const id of ['main', ...AGENTS]) {
        const where = `desktop@${width} ${id}`
        const box = byKey(tree, `card-box-${id}`)
        const tile = { round: box?.props?.borderStyle, glass: box?.props?.backgroundColor, hover: (box as { hover?: unknown } | undefined)?.hover }
        expect({ where, tile }).toEqual({ where, tile: { round: 'round', glass: GLASS.raised, hover: cardHover() } })
        expect({ where, fits: Number(box?.props?.width) <= width }).toEqual({ where, fits: true })
        if (id !== 'main') expect({ where, edge: String(box?.props?.borderColor).startsWith(String(identityHex(seed.agents[id]))) }).toEqual({ where, edge: true })
        // Every fact is in the card's press targets, whole: a line that does not fit goes on to the next, never cut.
        const labels = cardLabels(tree, id)
        const said = labels.join(' ')
        expect({ where, missing: (facts[id] ?? []).filter(f => !said.includes(f)) }).toEqual({ where, missing: [] })
        expect({ where, cut: labels.filter(l => l.includes('…')) }).toEqual({ where, cut: [] })
        expect({ where, lines: lineKeys(tree, id).length >= (id === 'main' ? 4 : 5) }).toEqual({ where, lines: true })
      }
      // The ring stays where the identity line still fits whole beside it (49, 60); at 40 only the ring gives way.
      const rings = ['main', 'explorer', 'reviewer'].map(id => all(byKey(tree, `card-box-${id}`)).filter(n => n.type === 'Svg' && /^Context /.test(String(n.props?.alt))).length)
      expect({ width, rings }).toEqual({ width, rings: width < 49 ? [0, 0, 0] : [1, 1, 1] })
      // The chip and the state pill sit beside the identity line's words.
      expect(logicalLines(byKey(tree, 'card-box-explorer') ?? null).join('\n')).toMatch(/▸ +A +Explore ◉ completed/)
      expect(logicalLines(byKey(tree, 'card-box-main') ?? null).join('\n')).toMatch(/◎ main coordinator ◐ active/)
      await ui.unmount()
    }
  })

  test('a long task wraps onto a second line of the card rather than being cut', SLOW, async ($, on) => {
    seeded(on, session({ task: LONG_TASK }))
    for (const width of [40, 49]) {
      const ui = await mount($, 'desktop', width)
      const tree = await drawn(ui)
      const label = async (key: string) => String((await ui.find({ key }))?.props?.label ?? '')
      const task = [await label('cardrow-explorer-1'), await label('cardrow-explorer-1-1')]
      expect({ width, task: task.join(' ') }).toEqual({ width, task: `“${LONG_TASK}”` })
      expect({ width, keys: lineKeys(tree, 'explorer').slice(0, 3) }).toEqual({ width, keys: ['card-explorer', 'cardrow-explorer-1', 'cardrow-explorer-1-1'] })
      await ui.unmount()
    }
  })

  test('pressing a narrow card opens its details instead of the list, the card kept above them', SLOW, async ($, on) => {
    seeded(on, session())
    for (const width of [40, 49]) {
      const ui = await mount($, 'desktop', width)
      for (const id of ['explorer', 'main']) {
        const where = `desktop@${width} ${id}`
        await ui.press({ key: `card-${id}` })
        const open = await drawn(ui)
        const order = all(open).map(n => String(n.props?.key ?? ''))
        const card = order.indexOf(`card-box-${id}`)
        expect({ where, back: buttonKeys(open).includes('focus-back'), card: card >= 0, details: order.indexOf(`insp-${id}`) > card }).toEqual({ where, back: true, card: true, details: true })
        expect({ where, others: buttonKeys(open).filter(k => k.startsWith('card-') && k !== `card-${id}`) }).toEqual({ where, others: [] })
        await ui.press({ key: `card-${id}` })
        expect({ where, list: byKey(await drawn(ui), 'card-box-implementer') !== undefined }).toEqual({ where, list: true })
      }
      await ui.unmount()
    }
  })
})

// ── files (D3) ──

describe('Live: files read and written (D3)', () => {
  test('a search root is not counted or listed as a file read; it is listed as a searched path', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 80)
    const card = textOf(byKey(await drawn(ui), 'card-box-explorer'))
    expect(card).toMatch(/● 2 read/)
    expect(card).not.toMatch(/3 read/)
    await ui.press({ key: 'card-explorer' })
    const text = lines(await drawn(ui))
    const read = text.find(l => l.startsWith('◦ read'))
    const searched = text.find(l => l.startsWith('⌕ searched'))
    expect(read).toContain('/repo/src/auth/token.ts')
    expect(read).toContain('/repo/src/auth/session.ts')
    expect(read?.split(/[:,] /)).not.toContain('/repo/src')
    expect(searched).toContain('/repo/src')
    expect(searched).toContain('paths, not files')
    await ui.unmount()
  })
})

// ── layouts ──

describe('Live: medium and wide placement', () => {
  test('medium: the inspector opens in place under the focused card', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 80)
    await ui.press({ key: 'card-explorer' })
    const text = logicalLines(await drawn(ui))
    const card = text.findIndex(l => l.includes('“investigate token expiry”'))
    const assumption = text.findIndex(l => l.includes("assumes the main session's window for the same model"))
    const next = text.findIndex(l => l.includes('“fix token expiry”'))
    expect(card).toBeGreaterThan(-1)
    expect(assumption).toBeGreaterThan(card)
    expect(next).toBeGreaterThan(assumption)
    await ui.unmount()
  })

  test('wide: master-detail, the list left (about 58%) and the focused agent’s detail right, with recent activity', SLOW, async ($, on) => {
    seeded(on, session())
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface, 116)
      const before = await drawn(ui)
      const list = byKey(before, 'lv-list')
      const detail = byKey(before, 'lv-detail')
      expect(Math.abs(Number(list?.props?.width) / 116 - 0.58)).toBeLessThan(0.03)
      expect(Number(list?.props?.width) + Number(detail?.props?.width)).toBeLessThanOrEqual(116)
      expect(textOf(detail)).toMatch(/Recent activity/)
      expect(lines(detail).filter(l => /^#\d/.test(l))).toHaveLength(5)
      expect(buttonKeys(list)).toContain('card-explorer')
      expect(textOf(byKey(before, 'card-box-main'))).toContain('◎ main')
      expect(buttonKeys(detail)).not.toContain('card-main')
      await ui.press({ key: 'card-explorer' })
      const after = await drawn(ui)
      expect(textOf(byKey(after, 'lv-detail'))).toContain("assumes the main session's window for the same model")
      expect(textOf(byKey(after, 'lv-list'))).not.toContain("assumes the main session's window")
      await ui.press({ key: 'card-explorer' })
      await ui.unmount()
    }
  })
})

// ── the inspector ──

describe('Live: inspector', () => {
  test('sections in order: summary, context, usage, outcome, delegation and report, files, last events', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 80)
    await ui.press({ key: 'card-explorer' })
    const text = logicalLines(await drawn(ui))
    const at = (re: RegExp) => text.findIndex(l => re.test(l))
    const order = [
      at(/^▌ A · Explore/),
      at(/^▌ context/),
      at(/── ledger|^▌ (usage|ledger)/),
      at(/── outcome|^▌ outcome/),
      at(/^▌ delegation and report/),
      at(/^▌ files/),
      at(/^▌ last \d+ events/),
    ]
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(text.join('\n')).toContain('compares expiry in seconds')
    await ui.unmount()
  })

  test('the window basis sits behind a disclosure, closed by default', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 116)
    await ui.press({ key: 'card-explorer' })
    expect(textOf(await drawn(ui))).not.toContain('autoCompactWindow')
    await ui.press({ key: 'dc-ctx-explorer' })
    expect(textOf(await drawn(ui))).toContain('autoCompactWindow')
    await ui.unmount()
  })

  test('a captured compaction and context stop are listed in text and marked on the desktop chart', SLOW, async ($, on) => {
    seeded(on, session({ compaction: true }))
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface, 116)
      await ui.press({ key: 'card-implementer' })
      const tree = await drawn(ui)
      const text = textOf(tree)
      expect(text).toContain('compacted (auto)')
      expect(text).toContain('after not captured')
      expect(text).toContain('stop max_tokens')
      const charts = all(byKey(tree, 'lv-detail')).filter(n => n.type === 'Svg' && /prompt size per request/.test(String(n.props?.alt)))
      if (surface === 'desktop') {
        expect(charts).toHaveLength(1)
        expect(String(charts[0]?.props?.alt)).toMatch(/1 compaction and 1 context stop marked/)
        expect(String(charts[0]?.props?.source).split('stroke-dasharray="3 2"')).toHaveLength(3)
      } else {
        expect(charts).toEqual([])
      }
      await ui.press({ key: 'card-implementer' })
      await ui.unmount()
    }
  })

  test('nothing is marked when no compaction or context stop was captured', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'desktop', 116)
    await ui.press({ key: 'card-implementer' })
    const text = textOf(await drawn(ui))
    expect(text).not.toMatch(/⇊|compacted|max_tokens|marked/)
    await ui.unmount()
  })
})

// ── filters and the health strip ──

describe('Live: filters and the health strip', () => {
  test('filter chips carry counts; a filter keeps spawn order and the coordinator', SLOW, async ($, on) => {
    seeded(on, session())
    const ui = await mount($, 'terminal', 80)
    const tree = await drawn(ui)
    const label = (key: string) => String(byKey(tree, key)?.props?.label)
    expect([label('lf-all'), label('lf-active'), label('lf-completed'), label('lf-failed')]).toEqual(['all 5', 'active 2', 'completed 3', 'failed 0'])
    await ui.press({ key: 'lf-active' })
    expect(buttonKeys(await drawn(ui)).filter(k => k.startsWith('card-'))).toEqual(['card-main', 'card-reviewer', 'card-quiet'])
    await ui.press({ key: 'lf-all' })
    await ui.unmount()
  })

  test('the health strip shows the first three signals and opens the Health tab', SLOW, async ($, on) => {
    seeded(on, session())
    for (const width of [49, 80, 116]) {
      const ui = await mount($, 'terminal', width)
      const tree = await drawn(ui)
      const badge = Number(/\((\d+)\)$/.exec(String(byKey(tree, 'tab-health')?.props?.label))?.[1] ?? 0)
      expect(badge).toBeGreaterThan(0)
      const cards = all(tree).filter(n => String(n.props?.key ?? '').startsWith('sc-lv-'))
      expect(cards).toHaveLength(Math.min(3, badge))
      expect(textOf(tree)).toMatch(/▌ Health/)
      await ui.press({ key: 'lv-health' })
      expect(byKey(await drawn(ui), 'tab-health')?.props?.variant).toBe('primary')
      await ui.unmount()
    }
  })
})

// ── platform and labels ──

describe('Live: platform boundary and labels', () => {
  test('every screen: unique keys, Buttons hold only Text, within the tree budget, labelled metrics, no judging words', SLOW, async ($, on) => {
    seeded(on, session({ compaction: true }))
    for (const surface of ['terminal', 'desktop'] as const) {
      // 160: the expanded layout (three columns) is held to the same rules.
      for (const width of [30, 49, 80, 116, 160]) {
        const ui = await mount($, surface, width)
        await costOn(ui)
        for (const focus of [undefined, 'main', ...AGENTS]) {
          if (focus) await ui.press({ key: `card-${focus}` })
          const tree = await drawn(ui)
          const where = `${surface}@${width} ${focus ?? 'list'}`
          const keys = buttonKeys(tree)
          expect({ where, dupes: keys.filter((k, i) => keys.indexOf(k) !== i) }).toEqual({ where, dupes: [] })
          const boxed = all(tree)
            .filter(n => n.type === 'Button')
            .flatMap(b => all(b).slice(1))
            .filter(n => n.type !== 'Text')
          expect({ where, boxed: boxed.map(n => n.type) }).toEqual({ where, boxed: [] })
          // Each drawing a host validates apart: the pane's tree and, on the desktop Live tab, each Client's tree.
          for (const drawing of await drawingsOf(ui)) {
            const size = treeSize(drawing as DrawnNode)
            expect({ where, ok: size.depth <= 20 && size.nodes <= 2500 }).toEqual({ where, ok: true })
          }
          const live = lines(tree)
          expect({ where, bad: live.filter(l => FORBIDDEN.test(l)) }).toEqual({ where, bad: [] })
          // The auditor's inspector holds Workstream B's ledger detail, whose zero line is B's O5 fix (DESIGN-CONTRACT §10.1).
          const zeros = focus === 'auditor' ? [] : lines(byKey(tree, 'lv-root')).filter(l => OBSERVED_ZERO.test(l))
          expect({ where, zeros }).toEqual({ where, zeros: [] })
          const mine = lines(byKey(tree, 'lv-root'))
          const untagged = mine.filter(l => METRIC.test(l) && !LABEL.test(l) && !EXEMPT.test(l.trim()))
          expect({ where, untagged }).toEqual({ where, untagged: [] })
          if (focus) await ui.press({ key: `card-${focus}` })
        }
        await ui.unmount()
      }
    }
  })

  test('Svg only on desktop: a ring only where a % is available, always beside its native twin', SLOW, async ($, on) => {
    seeded(on, session())
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface, 80)
      const tree = await drawn(ui)
      const pictures = (id: string) => all(byKey(tree, `card-box-${id}`)).filter(n => n.type === 'Svg')
      const rings = (id: string) => pictures(id).filter(n => /^Context /.test(String(n.props?.alt)))
      if (surface === 'terminal') {
        expect(all(tree).filter(n => n.type === 'Svg')).toEqual([])
      } else {
        expect(rings('main')).toHaveLength(1)
        expect(rings('explorer')).toHaveLength(1)
        expect(rings('reviewer')).toHaveLength(1)
        expect(rings('implementer')).toEqual([])
        expect(rings('auditor')).toEqual([])
        expect(rings('quiet')).toEqual([])
        // Desktop cards draw their per-request prompt sizes as a small chart: every other picture is that chart, its alt
        // the words of the label drawn beside it, and only where two or more requests reported usage.
        for (const id of ['main', ...AGENTS]) {
          const charts = pictures(id).filter(n => !/^Context /.test(String(n.props?.alt)))
          const label = lines(byKey(tree, `card-box-${id}`)).find(l => /^● last \d+ requests/.test(l))
          expect({ id, charts: charts.length }).toEqual({ id, charts: label ? 1 : 0 })
          if (label) expect(String(charts[0]?.props?.alt)).toContain(label.replace(/^● /, ''))
        }
        expect(pictures('quiet')).toEqual([])
      }
      expect(textOf(byKey(tree, 'card-box-main'))).toMatch(/● 9% · 86k of 1\.0M/)
      await ui.unmount()
    }
  })
})

// ── many agents ──

/** SIMULATED: 45 spawned agents; the first ran a failing command and no request of any was heard. */
function crowd(): Snapshot {
  const ids = Array.from({ length: 45 }, (_, i) => `x${i}`)
  const base = build(
    ...ids.map(id => spawn(id, { description: `task ${id}` })),
    ...tool('x0', 'f0', 'Bash', { command: 'npm run lint' }, { isError: true, text: 'Exit code 1' }),
  )
  return { ...base, sessionId: 'ui-live-crowd' }
}

describe('Live: many agents', () => {
  test('past 40 agents the rest fold behind a disclosure; a focused agent past the cap keeps its inspector', SLOW, async ($, on) => {
    seeded(on, crowd())
    const ui = await mount($, 'terminal', 80)
    const before = await drawn(ui)
    const cards = (tree: DrawnNode) => buttonKeys(tree).filter(k => /^card-x/.test(k))
    expect(cards(before)).toHaveLength(40)
    expect(inline(byKey(before, 'dc-live-all'))).toContain('show 5 more agents')
    await ui.press({ key: 'dc-live-all' })
    expect(cards(await drawn(ui))).toHaveLength(45)
    await ui.press({ key: 'card-x44' })
    await ui.press({ key: 'dc-live-all' })
    const folded = await drawn(ui)
    expect(cards(folded)).toHaveLength(41)
    expect(byKey(folded, 'insp-x44')).toBeDefined()
    const size = treeSize(folded)
    expect(size.depth <= 20 && size.nodes <= 2500).toBe(true)
    await ui.press({ key: 'card-x44' })
    await ui.unmount()
  })

  test('a compact line with unknown usage still labels its observed counts', SLOW, async ($, on) => {
    seeded(on, crowd())
    const ui = await mount($, 'terminal', 49)
    expect(inline(byKey(await drawn(ui), 'card-x0'))).toMatch(/∅ usage unknown ● ✕1 task x0/)
    await ui.unmount()
  })

  test('the wide list goes to two card columns once it has room for both', SLOW, async ($, on) => {
    seeded(on, crowd())
    // From 140 columns the expanded layout gives the list its own column beside the details and the activity, so two
    // card columns need a pane of about 225 columns.
    for (const [width, columns] of [[116, 1], [170, 1], [240, 2]] as const) {
      const ui = await mount($, 'terminal', width)
      const list = byKey(await drawn(ui), 'lv-list')
      const listWidth = Number(list?.props?.width)
      const card = byKey(list, 'card-box-x0')
      expect(Number(card?.props?.width)).toBe(Math.floor((listWidth - (columns - 1)) / columns))
      const grid = all(list).find(n => n.props?.flexWrap === 'wrap' && byKey(n, 'card-box-x0') !== undefined)
      expect(grid !== undefined).toBe(columns === 2)
      await ui.unmount()
    }
  })
})

// ── the whole card opens its details (Sunset Glass DESIGN-CONTRACT §9) ──

/** A card's press targets in drawing order: `card-<id>` first, then its `cardrow-<id>-<n>` lines. */
function lineKeys(tree: DrawnNode, id: string): string[] {
  return buttonKeys(tree).filter(k => k === `card-${id}` || k.startsWith(`cardrow-${id}-`))
}

/** Text no press reaches: outside every Button, and in no row that holds a Button (a line nothing presses). */
function unpressable(node: DrawnNode, row?: El, out: string[] = []): string[] {
  if (!isEl(node) || node.type === 'Button' || node.type === 'Svg') return out
  if (node.type === 'Text') {
    const text = inline(node).trim()
    if (text && !(row && buttonKeys(row).length > 0)) out.push(text)
    return out
  }
  const near = node.props?.flexDirection === 'row' ? node : row
  for (const child of kids(node)) unpressable(child, near, out)
  return out
}

/** Every Button's label (desktop) or its text (terminal), joined: what a press on the card's lines covers. */
const pressedText = (node: DrawnNode) =>
  all(node)
    .filter(n => n.type === 'Button')
    .map(inline)
    .join('\n')

/** Where the inspector of `id` is drawn: replacing the list (compact), in place (medium) or in the detail column (wide). */
function placement(tree: DrawnNode, id: string, width: number): boolean {
  const order = all(tree).map(n => String(n.props?.key ?? ''))
  if (width < 56) return buttonKeys(tree).includes('focus-back') && !buttonKeys(tree).some(k => k.startsWith('card-') && k !== `card-${id}`)
  if (width < 100) {
    if (id === 'main') return order.indexOf('insp-main') > order.indexOf('card-box-main')
    return byKey(byKey(tree, `lv-entry-${id}`), `insp-${id}`) !== undefined && byKey(byKey(tree, `lv-entry-${id}`), `card-box-${id}`) !== undefined
  }
  return byKey(byKey(tree, 'lv-detail'), `insp-${id}`) !== undefined && byKey(byKey(tree, 'lv-list'), `insp-${id}`) === undefined
}

describe('Live: the whole card opens its details (§9)', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: every pressable line of a card and of the coordinator toggles that agent’s existing details, narrow to wide`, SLOW, async ($, on) => {
      seeded(on, session({ mainActive: true }))
      // The terminal's compact pane draws one line per agent; the desktop draws the full cards at every width.
      for (const width of surface === 'terminal' ? [49, 80, 116] : [40, 49, 80, 116]) {
        const ui = await mount($, surface, width)
        const list = await drawn(ui)
        // One `card-` key per agent whatever the layout: the other lines never start with `card-` (the acceptance walk).
        expect({ width, cards: buttonKeys(list).filter(k => k.startsWith('card-')) }).toEqual({ width, cards: ['card-main', ...AGENTS.map(a => `card-${a}`)] })
        for (const id of ['main', 'explorer', 'implementer', 'auditor', 'quiet']) {
          const keys = lineKeys(await drawn(ui), id)
          const where = `${surface}@${width} ${id}`
          expect({ where, first: keys[0] }).toEqual({ where, first: `card-${id}` })
          if (width < 56 && surface === 'terminal') expect({ where, keys }).toEqual({ where, keys: [`card-${id}`] })
          else expect({ where, lines: keys.length >= (id === 'main' ? 3 : 4) }).toEqual({ where, lines: true })
          for (const key of keys) {
            await ui.press({ key })
            const open = await drawn(ui)
            expect({ where, key, open: byKey(open, `insp-${id}`) !== undefined, placed: placement(open, id, width) }).toEqual({ where, key, open: true, placed: true })
            // Only the focused agent's details: pressing a line never opens a second inspector or another agent's.
            expect({ where, key, inspectors: all(open).filter(n => String(n.props?.key ?? '').startsWith('insp-')).length }).toEqual({ where, key, inspectors: 1 })
            // Compact replaces the list, so the line left to press again is the agent's own line.
            await ui.press({ key: width < 56 ? `card-${id}` : key })
            expect({ where, key, closed: byKey(await drawn(ui), `insp-${id}`) === undefined }).toEqual({ where, key, closed: true })
          }
        }
        await ui.unmount()
      }
    })
  }

  test('terminal: every text line of a card is inside its press targets; desktop: every line holds one, with its words as the label', SLOW, async ($, on) => {
    seeded(on, session({ mainActive: true }))
    for (const surface of ['terminal', 'desktop'] as const) {
      // Desktop cards at every width, the narrow dock (40–55 columns) included.
      for (const width of surface === 'terminal' ? [80, 116] : [40, 49, 60, 80, 116]) {
        const ui = await mount($, surface, width)
        const tree = await drawn(ui)
        for (const id of ['main', ...AGENTS]) {
          const card = byKey(tree, `card-box-${id}`)
          const where = `${surface}@${width} ${id}`
          expect({ where, keys: buttonKeys(card) }).toEqual({ where, keys: lineKeys(tree, id) })
          expect({ where, unpressed: unpressable(card ?? null) }).toEqual({ where, unpressed: [] })
          // Desktop draws a Button's label only: what a line says must be in it, not beside it.
          const words = pressedText(card ?? null)
          if (surface === 'desktop') for (const button of all(card).filter(n => n.type === 'Button')) expect(kids(button)).toEqual([])
          if (id === 'explorer') {
            for (const part of ['investigate token expiry', '≈ 4.2% of 1.0M', 'processed', 'answered', 'last 2 requests']) expect({ where, part, pressed: words.includes(part) }).toEqual({ where, part, pressed: true })
          }
          if (id === 'main') for (const part of ['first turn running', '● 9% · 86k of 1.0M', 'spawn tree']) expect({ where, part, pressed: words.includes(part) }).toEqual({ where, part, pressed: true })
        }
        await ui.unmount()
      }
    }
  })

  test('desktop: the card is one glass tile that lights as a whole under the pointer; the terminal keeps its plain round border', SLOW, async ($, on) => {
    const seed = session()
    seeded(on, seed)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface, 80)
      const tree = await drawn(ui)
      for (const id of ['main', ...AGENTS]) {
        const box = byKey(tree, `card-box-${id}`)
        expect(box?.props?.borderStyle).toBe('round')
        if (surface === 'desktop') {
          // The drawn tree carries a Box's hover beside its props.
          expect((box as { hover?: unknown } | undefined)?.hover).toEqual(cardHover())
          expect(box?.props?.backgroundColor).toBe(GLASS.raised)
          if (id !== 'main') expect(String(box?.props?.borderColor).startsWith(String(identityHex(seed.agents[id])))).toBe(true)
        } else {
          expect((box as { hover?: unknown } | undefined)?.hover).toBeUndefined()
          expect(box?.props?.backgroundColor).toBeUndefined()
        }
      }
      await ui.unmount()
    }
  })

  test('independent controls keep their own action and never open a card’s details', SLOW, async ($, on) => {
    seeded(on, session())
    const noInspector = (tree: DrawnNode) => all(tree).filter(n => String(n.props?.key ?? '').startsWith('insp-')).length === 0
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const width of [49, 80, 116]) {
        const ui = await mount($, surface, width)
        const where = `${surface}@${width}`
        await ui.press({ key: 'lf-active' })
        const filtered = await drawn(ui)
        expect({ where, filter: isSelected(filtered, 'lf-active'), none: noInspector(filtered) }).toEqual({ where, filter: true, none: true })
        await ui.press({ key: 'lf-all' })
        await ui.press({ key: 'lv-health' })
        const health = await drawn(ui)
        expect({ where, tab: isSelected(health, 'tab-health'), none: noInspector(health) }).toEqual({ where, tab: true, none: true })
        await ui.press({ key: 'tab-live' })
        // The context basis disclosure opens inside the details and leaves the focus where it was.
        await ui.press({ key: width < 56 ? 'card-explorer' : 'cardrow-explorer-1' })
        await ui.press({ key: 'dc-ctx-explorer' })
        const basis = await drawn(ui)
        expect({ where, still: byKey(basis, 'insp-explorer') !== undefined, opened: textOf(basis).includes('autoCompactWindow') }).toEqual({ where, still: true, opened: true })
        await ui.press({ key: 'dc-ctx-explorer' })
        if (width < 56) {
          await ui.press({ key: 'focus-back' })
          expect({ where, back: noInspector(await drawn(ui)) }).toEqual({ where, back: true })
        } else {
          await ui.press({ key: 'cardrow-explorer-1' })
        }
        expect({ where, closed: noInspector(await drawn(ui)) }).toEqual({ where, closed: true })
        await ui.unmount()
      }
    }
  })

  test('the “show more agents” disclosure folds and unfolds the list and never focuses an agent', SLOW, async ($, on) => {
    seeded(on, crowd())
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface, 80)
      await ui.press({ key: 'dc-live-all' })
      const open = await drawn(ui)
      expect(all(open).filter(n => String(n.props?.key ?? '').startsWith('insp-'))).toEqual([])
      expect(buttonKeys(open).filter(k => /^card-x/.test(k))).toHaveLength(45)
      await ui.press({ key: 'dc-live-all' })
      await ui.unmount()
    }
  })
})

// ── expanded (≥ 140 columns): a third column, not a stretch (§10) ──

describe('Live: expanded layout', () => {
  test('cards, details, and activity with Health each get a column; the press opens the details in the middle one', SLOW, async ($, on) => {
    seeded(on, session())
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mount($, surface, 160)
      const before = await drawn(ui)
      const list = byKey(before, 'lv-list')
      const detail = byKey(before, 'lv-detail')
      const side = byKey(before, 'lv-side')
      const widths = [list, detail, side].map(n => Number(n?.props?.width))
      expect(widths.every(w => w > 0)).toBe(true)
      expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(160)
      expect(textOf(side)).toMatch(/Recent activity/)
      expect(lines(side).filter(l => /^#\d/.test(l))).toHaveLength(5)
      expect(textOf(side)).toMatch(/▌ Health/)
      expect(buttonKeys(side)).toContain('lv-health')
      expect(buttonKeys(list)).toContain('card-explorer')
      expect(textOf(detail)).toContain('No agent selected.')
      await ui.press({ key: 'cardrow-explorer-1' })
      const after = await drawn(ui)
      expect(byKey(byKey(after, 'lv-detail'), 'insp-explorer')).toBeDefined()
      expect(byKey(byKey(after, 'lv-list'), 'insp-explorer')).toBeUndefined()
      await ui.press({ key: 'cardrow-explorer-1' })
      await ui.unmount()
    }
  })
})

// ── live-facts: pure ──

describe('live-facts', () => {
  const seed = session()
  const agent = (id: string) => {
    const record = seed.agents[id]
    if (!record) throw new Error(`no agent ${id}`)
    return record
  }

  test('filesOf: distinct read and written paths, search roots apart, ≥ only when the agent’s events may be dropped', () => {
    expect(filesOf(seed, agent('explorer'))).toEqual({
      read: ['/repo/src/auth/token.ts', '/repo/src/auth/session.ts'],
      written: [],
      searched: ['/repo/src'],
      bounded: false,
    })
    expect(filesOf(seed, agent('implementer')).written).toEqual(['/repo/src/auth/token.ts'])
    const trimmed = { ...seed, events: seed.events.slice(5), droppedEvents: 5 }
    expect(filesOf(trimmed, agent('explorer')).bounded).toBe(true)
    expect(filesOf(trimmed, agent('reviewer')).bounded).toBe(false)
  })

  test('activityOf: a running tool is “now” only while the agent is active; otherwise its last event in plain words', () => {
    const running = { tool: 'Bash', toolUseId: 'toolu_x', at: NOW - 2_000, label: 'Bash: npm test' }
    expect(activityOf(seed, { ...agent('reviewer'), currentTool: running })).toEqual({ text: 'now: Bash: npm test', at: NOW - 2_000, live: true, seen: true })
    const stopped = activityOf(seed, { ...agent('implementer'), state: 'stopped', currentTool: running })
    expect(stopped.live).toBe(false)
    expect(stopped.text).toBe('answered')
    expect(activityOf(seed, agent('reviewer')).text).toBe('Read token.ts')
    const lastTool = { ...seed, events: seed.events.filter(e => !(e.agentId === 'implementer' && e.kind === 'turn-end')) }
    expect(activityOf(lastTool, agent('implementer')).text).toMatch(/^ran npm run build \(.*exit 1/)
  })

  test('usageOf: none heard and all-without-usage are unknown with their reason; otherwise the direct totals', () => {
    const row = (requests: number, requestsWithoutUsage: number) =>
      ({ direct: { requests, requestsWithoutUsage, tokens: tokens(0), processed: requests ? 10 : 0 } }) as unknown as LedgerRow
    expect(usageOf(undefined)).toEqual({ known: false, reason: 'no model request heard yet' })
    expect(usageOf(row(0, 0))).toEqual({ known: false, reason: 'no model request heard yet' })
    expect(usageOf(row(0, 2))).toEqual({ known: false, reason: '2 requests returned no usage' })
    expect(usageOf(row(1, 2)).known).toBe(true)
  })

  test('bucketEvidence: the weakest contribution’s label; the coordinator observed, unknown usage unavailable', () => {
    const outcome = (...evidence: ContributionOutcome['evidence'][]) =>
      ({ contributions: evidence.map(e => ({ evidence: e })) }) as unknown as AgentOutcome
    expect(bucketEvidence('coordinator', outcome())).toBe('OBSERVED')
    expect(bucketEvidence('no-usage-recorded', outcome('OBSERVED'))).toBe('UNAVAILABLE')
    expect(bucketEvidence('verified', outcome('INFERRED', 'INFERRED'))).toBe('INFERRED')
    expect(bucketEvidence('mixed', outcome('LINKED', 'UNRESOLVED', 'OBSERVED'))).toBe('UNRESOLVED')
    expect(bucketEvidence('changed-unverified', outcome('OBSERVED'))).toBe('OBSERVED')
    expect(bucketEvidence('unresolved', undefined)).toBe('UNRESOLVED')
  })
})
