// Collisions and Health (Sunset Glass Workstream 3; DESIGN-CONTRACT §8.4,
// §8.7): the Collisions matrix and signal cards, and the Health list. Split from
// ui-collisions-forensics.test.tsx with no assertion changed. The whole pane is
// mounted through the engine's test host with a SIMULATED snapshot seeded through
// `state.get` (as the acceptance suite does), and read as logical lines; a few
// wiring checks call a view directly with plain-data stand-ins for the elements.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { analyzeCollisions } from '../hooks/lib/collisions'
import { applyUsage, buildLedgerView } from '../hooks/lib/ledger'
import { buildSpendOutcome } from '../hooks/lib/outcome'
import { GLASS, ROLE } from '../hooks/lib/palette'
import { PRICE_TABLE } from '../hooks/lib/pricing'
import { findingsOf, gatherSignals, isValueOnly } from '../hooks/lib/signals'
import { applyTheme, themeFor } from '../hooks/lib/themes'
import { buildTrail } from '../hooks/lib/trail'
import { CollisionsView } from '../hooks/ui/collisions'
import type { ViewContext } from '../hooks/ui/common'
import { CardGrid } from '../hooks/ui/health-cards'
import { LEVEL_STYLE, layoutFor } from '../hooks/ui/kit'
import type { HealthSignal, Snapshot } from '../types'
import { build, spawn, threeAgentSession, tool, turnEnd, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { NOOP_ACTIONS, buttonKeys, inline, logicalLines, treeSize, type DrawnNode, withClients } from './view-helpers'

const PLUGIN = 'swarm-autopsy'
const SESSION = 'session-under-test'
const NOW = 1_700_000_000_000
const SLOW = { timeoutMs: 60_000 }
const LONG_PATH = '/repo/src/auth/very/long/directory/name/for/testing/session-store.ts'

const PANE = (bodyColumns: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
})

/** Explore → implement → test, then the tester edits the implementer's line and fails twice to edit another file. */
function collidingSession(): Snapshot {
  const snapshot = build(
    ...threeAgentSession(),
    ...tool('tester', 'e9', 'Edit', { file_path: '/repo/src/auth/token.ts', old_string: 'exp * 1000 < Date.now()', new_string: 'exp * 1000 <= Date.now()' }),
    ...tool('tester', 'e10', 'Edit', { file_path: LONG_PATH, old_string: 'a', new_string: 'b' }, { isError: true, text: 'String not found' }),
    ...tool('tester', 'e11', 'Edit', { file_path: LONG_PATH, old_string: 'a', new_string: 'b' }, { isError: true, text: 'String not found' }),
    ...tool('tester', 'b2', 'Bash', { command: 'npm test -- token' }, { isError: true, text: 'Exit code 1\n1 failing' }),
  )
  return { ...snapshot, sessionId: SESSION }
}

/** The colliding session with usage: a request without usage, an unknown id carrying usage, a context stop and main's fill. */
function collidingWithUsage(): Snapshot {
  const snapshot = collidingSession()
  const records = [
    usageRecord({ agentId: 'main', turnId: 'm', index: 0, at: NOW - 9_000, tokens: tokens(10, 50_000, 900, 300) }),
    usageRecord({ agentId: 'tester', turnId: 't', index: 0, at: NOW - 8_000, tokens: tokens(10, 9_000, 100, 50), stopReason: 'max_tokens' }),
    usageRecord({ agentId: 'tester', turnId: 't', index: 1, at: NOW - 7_000, tokens: null }),
    usageRecord({ agentId: 'fork-9', turnId: 'f', index: 0, at: NOW - 6_000, tokens: tokens(7, 3_000, 0, 70) }),
  ]
  return {
    ...snapshot,
    ledger: records.reduce((ledger, record) => applyUsage(ledger, record), snapshot.ledger),
    context: { window: 1_000_000, tokens: 51_000, percent: 5, at: NOW - 1_000 },
    droppedEvents: 2,
  }
}

function seededEngine(on: On, seed: Snapshot) {
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: SESSION }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', ($, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

/** What these tests need of a mounted pane (terminal and desktop both carry Select). */
type Mounted = {
  drawn: () => Promise<unknown>
  press: (target: { key: string }) => Promise<unknown>
  select: (target: { key: string; value: string }) => Promise<unknown>
  find: (query: { key?: string; text?: string | RegExp; type?: string }) => Promise<{ type: string; props: Record<string, unknown>; text: string } | undefined>
  unmount: () => Promise<unknown>
}

async function mountOn($: Engine, surface: 'terminal' | 'desktop', width: number, view: string): Promise<Mounted> {
  const ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
  await ui.press({ key: `tab-${view}` })
  return ui
}

async function linesOf(ui: Mounted): Promise<string[]> {
  return logicalLines((await ui.drawn()) as DrawnNode)
}

async function keysOf(ui: Mounted): Promise<string[]> {
  return buttonKeys((await ui.drawn()) as DrawnNode)
}

// ── stand-in context for direct calls ──

type Plain = { type: string; props: Record<string, unknown> }

function stubContext(snapshot: Snapshot, width: number, calls: string[] = []): ViewContext {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  return {
    els: { Box: element('Box'), Text: element('Text'), Button: element('Button') } as unknown as ViewContext['els'],
    surface: 'terminal',
    width,
    rows: 40,
    layout: layoutFor(width),
    now: NOW,
    snapshot,
    ui: { view: 'collisions', filter: 'all', page: 0 },
    act: { ...NOOP_ACTIONS, showNode: id => calls.push(`node:${id}`), openEvent: id => calls.push(`event:${id}`) },
  }
}

function plainButtons(node: unknown, out: Plain[] = []): Plain[] {
  if (Array.isArray(node)) {
    for (const child of node) plainButtons(child, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  const drawn = node as Plain
  if (drawn.type === 'Button') out.push(drawn)
  plainButtons(drawn.props?.children, out)
  return out
}

// ── Collisions ──

describe('collisions view', () => {
  test('the matrix fits the 49-cell dock: agent chips over r / W / × cells, the multi-writer row marked', SLOW, async ($, on) => {
    seededEngine(on, collidingSession())
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountOn($, surface, 49, 'collisions')
      const lines = await linesOf(ui)
      // Matrix rows lead with `⇄ ` or two spaces; a card head ("▲ investigate · …token.ts…") names the same files.
      const matrix = lines.filter(l => /^(⇄ | {2}\S)/.test(l) && /token\.ts|session-store\.ts/.test(l) && /W\d|×|·/.test(l))
      expect(matrix.length).toBeGreaterThanOrEqual(2)
      for (const line of matrix) expect(line.length).toBeLessThanOrEqual(49)
      const token = matrix.find(l => l.includes('token.ts'))
      expect(token).toMatch(/^⇄/)
      expect(token).toMatch(/\br\b/)
      expect(token).toMatch(/W1.*W1/)
      expect(matrix.find(l => l.includes('session-store.ts'))).toMatch(/×/)
      // Column heads are the agents' identity chips, letters in order.
      expect(lines.some(l => /^\s+A\s+B\s+C\s*$/.test(l))).toBe(true)
      // The legend's long form waits behind its disclosure (the opened set is shared by both mounts, so toggle it).
      const before = lines.join('\n').includes('written by more than one agent')
      expect(before).toBe(surface === 'desktop')
      await ui.press({ key: 'dc-col-legend' })
      expect((await linesOf(ui)).join('\n').includes('written by more than one agent')).toBe(!before)
      await ui.unmount()
    }
  })

  test('one worktree draws no worktree sentence; no writes draws the empty state', SLOW, async ($, on) => {
    seededEngine(on, { ...build(...threeAgentSession().slice(0, 5)), sessionId: SESSION })
    const ui = await mountOn($, 'terminal', 80, 'collisions')
    const text = (await linesOf(ui)).join('\n')
    expect(text).toContain('No file writes observed')
    expect(text).not.toMatch(/worktree/)
    await ui.unmount()
  })

  test('signals are cards with severity, evidence, title, why, agent chips and actions', SLOW, async ($, on) => {
    const seed = collidingSession()
    seededEngine(on, seed)
    const signals = analyzeCollisions(seed).signals
    const ui = await mountOn($, 'terminal', 116, 'collisions')
    const lines = await linesOf(ui)
    const first = signals[0]
    expect(first?.severity).toBe('investigate')
    expect(lines.some(l => l.includes('▲') && l.includes(first?.title ?? '∅'))).toBe(true)
    expect(lines.some(l => l.includes(first?.detail[0] ?? '∅'))).toBe(true)
    const notice = signals.find(s => s.severity === 'notice')
    expect(lines.some(l => l.includes('△') && l.includes(notice?.title ?? '∅'))).toBe(true)
    expect(lines.join('\n')).not.toContain('⚑')
    const keys = await keysOf(ui)
    expect(keys).toEqual(expect.arrayContaining(['sig-0', 'sig-src-0', 'sig-fx-0-0']))
    // Selecting opens the whole evidence under the card; selecting again closes it.
    await ui.press({ key: 'sig-0' })
    let text = (await linesOf(ui)).join('\n')
    expect(text).toContain('not a defect by itself')
    for (const line of first?.detail ?? []) expect(text).toContain(line)
    await ui.press({ key: 'sig-0' })
    text = (await linesOf(ui)).join('\n')
    expect(text).not.toContain('not a defect by itself')
    // Filter Forensics to the signal's first agent.
    await ui.press({ key: 'sig-fx-0-0' })
    const select = await ui.find({ key: 'agent-filter' })
    expect(select?.type).toBe('Select')
    expect(select?.props.value).toBe(first?.agents[0])
    // Open its source events in Forensics.
    await ui.press({ key: 'tab-collisions' })
    await ui.press({ key: 'sig-src-0' })
    expect(await ui.find({ text: /evidence · event #/ })).toBeDefined()
    await ui.unmount()
  })

  test('compact signals are rows with the same actions, and the whole tab fits 49 cells', SLOW, async ($, on) => {
    seededEngine(on, collidingSession())
    const ui = await mountOn($, 'terminal', 49, 'collisions')
    const keys = await keysOf(ui)
    expect(keys).toEqual(expect.arrayContaining(['sig-0', 'sig-src-0']))
    await ui.press({ key: 'sig-0' })
    expect((await linesOf(ui)).join('\n')).toContain('not a defect by itself')
    await ui.unmount()
  })

  test('"show in Trail" appears when a trail node holds the signal’s events', () => {
    const seed = collidingSession()
    const calls: string[] = []
    const ctx = stubContext(seed, 116, calls)
    const buttons = plainButtons(CollisionsView(ctx, analyzeCollisions(seed), buildTrail(seed)))
    const show = buttons.find(b => b.props.key === 'sig-tr-0')
    expect(show).toBeDefined()
    ;(show?.props.onPress as () => void)()
    expect(calls[0]).toMatch(/^node:n:/)
    // Without the trail, no such button is drawn.
    expect(plainButtons(CollisionsView(ctx, analyzeCollisions(seed))).some(b => b.props.key === 'sig-tr-0')).toBe(false)
  })
})

// ── many agents ──

/** Agents each reading then editing one shared file: one wide shared-write signal and a crowded matrix. */
function crowdedSession(agents = 30): Snapshot {
  const ids = Array.from({ length: agents }, (_, i) => `w${i}`)
  const snapshot = build(
    ...ids.flatMap(id => [
      spawn(id, { description: `worker ${id}` }),
      ...tool(id, `r-${id}`, 'Read', { file_path: '/repo/src/shared/config.ts' }),
      ...tool(id, `e-${id}`, 'Edit', { file_path: '/repo/src/shared/config.ts', old_string: `a${id}`, new_string: `b${id}` }),
    ]),
  )
  return { ...snapshot, sessionId: SESSION }
}

describe('many agents', () => {
  test('the matrix leaves out agent columns it cannot fit and says so; my tabs stay within the tree budget', SLOW, async ($, on) => {
    seededEngine(on, crowdedSession())
    for (const [surface, width] of [['terminal', 49], ['desktop', 116]] as const) {
      const ui = await mountOn($, surface, width, 'collisions')
      const lines = await linesOf(ui)
      expect(lines.some(l => /more agents? not drawn at this width/.test(l))).toBe(true)
      for (const line of lines.filter(l => l.includes('config.ts') && /W\d/.test(l))) expect(line.length).toBeLessThanOrEqual(width)
      for (const view of ['collisions', 'forensics', 'health']) {
        await ui.press({ key: `tab-${view}` })
        const size = treeSize((await ui.drawn()) as DrawnNode)
        expect(size.depth).toBeLessThanOrEqual(20)
        expect(size.nodes).toBeLessThanOrEqual(2500)
      }
      await ui.unmount()
    }
  })
})

// ── Health ──

const METRIC = /\d[\d.,]*\s?[kM]?\s?(tok|tokens|req|requests)\b|\d[\d.]*%/
const LABEL = /[●≈∅◆◇?]/

describe('health view', () => {
  test('signals are grouped by source under headings, each a card with its evidence and actions', SLOW, async ($, on) => {
    seededEngine(on, collidingSession())
    const ui = await mountOn($, 'terminal', 116, 'health')
    const text = (await linesOf(ui)).join('\n')
    expect(text).toContain('Trail flags')
    expect(text).toContain('Collision signals')
    expect(text).toContain('Spend vs outcome')
    expect(text).toContain('The latest captured run of `npm test -- token` failed')
    expect(text).toContain('no score, no thresholds')
    const keys = await keysOf(ui)
    const trailKey = keys.find(k => /^sig-h\d+-tr$/.test(k))
    const focusKey = keys.find(k => /^focus-h\d+-/.test(k))
    expect(trailKey).toBeDefined()
    expect(focusKey).toBeDefined()
    // The source's whole text and its events open under the card.
    expect(keys.some(k => /^sig-h\d+-ev-/.test(k))).toBe(false)
    const evidenceKey = keys.find(k => /^dc-h-ev-\d+$/.test(k))
    await ui.press({ key: evidenceKey ?? '' })
    expect((await keysOf(ui)).some(k => /^sig-h\d+-ev-/.test(k))).toBe(true)
    expect((await linesOf(ui)).join('\n')).toContain('source events:')
    await ui.press({ key: trailKey ?? '' })
    expect(await ui.find({ text: /Swarm health/ })).toBeUndefined()
    await ui.press({ key: 'tab-health' })
    await ui.press({ key: focusKey ?? '' })
    expect(await ui.find({ text: /Swarm health/ })).toBeUndefined()
    await ui.unmount()
  })

  test('an empty session reads as nothing raised, and names the sources it looked at', SLOW, async ($, on) => {
    seededEngine(on, { ...build(), sessionId: SESSION })
    const ui = await mountOn($, 'terminal', 49, 'health')
    const text = (await linesOf(ui)).join('\n')
    expect(text).toContain('No signals raised')
    expect(text).toMatch(/trail flags.*collision signals/i)
    await ui.unmount()
  })

  test('every number on the Health tab carries a label, at 49 and 116 cells', SLOW, async ($, on) => {
    seededEngine(on, collidingWithUsage())
    for (const width of [49, 116]) {
      const ui = await mountOn($, 'terminal', width, 'health')
      const lines = await linesOf(ui)
      expect(lines.join('\n')).toMatch(/request resolved with no usage/)
      expect(lines.join('\n')).toMatch(/main context 5%/)
      expect(lines.filter(l => METRIC.test(l) && !LABEL.test(l))).toEqual([])
      await ui.unmount()
    }
  })
})

// ── Sunset Glass (Workstream 3): reading the drawn tree ──

type El = Exclude<DrawnNode, string | number | boolean | null | undefined>

const isEl = (node: DrawnNode): node is El => node !== null && typeof node === 'object'

function kidsOf(node: El): DrawnNode[] {
  if (Array.isArray(node.children)) return node.children
  const fromProps = node.props?.children
  if (Array.isArray(fromProps)) return fromProps as DrawnNode[]
  return fromProps === undefined ? [] : [fromProps as DrawnNode]
}

/** Every element in document order. */
function every(node: DrawnNode, out: El[] = []): El[] {
  if (!isEl(node)) return out
  out.push(node)
  for (const child of kidsOf(node)) every(child, out)
  return out
}

const keyed = (root: DrawnNode, key: string) => every(root).find(n => n.props?.key === key)
/**
 * Whether the Button `key` is drawn selected: the app's primary Button, or (where the theme draws a selection as glass:
 * Abyssal on desktop) a secondary Button inside its edged `sel-<key>` capsule.
 */
function isSelected(root: DrawnNode, key: string): boolean {
  const capsule = keyed(root, `sel-${key}`)
  return keyed(root, key)?.props?.variant === 'primary' || (typeof capsule?.props?.borderColor === 'string' && keyed(capsule as DrawnNode, key) !== undefined)
}
const keyedLike = (root: DrawnNode, prefix: RegExp) => every(root).filter(n => prefix.test(String(n.props?.key ?? '')))
const linesIn = (node: DrawnNode | undefined) => (node === undefined ? [] : logicalLines(node))
const textIn = (node: DrawnNode | undefined) => linesIn(node).join('\n')

/** Every string a drawn tree carries in its props (colours included), for the terminal alpha scan. */
function propStrings(node: DrawnNode, out: string[] = []): string[] {
  if (!isEl(node)) return out
  for (const [k, v] of Object.entries(node.props ?? {})) if (k !== 'children' && typeof v === 'string') out.push(v)
  for (const child of kidsOf(node)) propStrings(child, out)
  return out
}

const ALPHA_COLOUR = /#[0-9a-f]{8}\b|#[0-9a-f]{4}\b|rgba?\(|hsla?\(/i

/** The first line of every card keyed `sc-<prefix><n>`: its glyph, level word, label and title (a wrapping grid joins cards). */
const headsOf = (root: DrawnNode, prefix: string) => keyedLike(root, new RegExp(`^sc-${prefix}\\d+$`)).map(card => linesIn(card)[0] ?? '')

/** The analyses' Health entries for a snapshot, built the way the pane builds them. */
function healthFor(snapshot: Snapshot): HealthSignal[] {
  const trail = buildTrail(snapshot)
  const ledger = buildLedgerView(snapshot.ledger, snapshot, { showCost: false, engineCostUsd: undefined, prices: PRICE_TABLE })
  const collisions = analyzeCollisions(snapshot)
  const spend = buildSpendOutcome(snapshot, trail, ledger)
  return gatherSignals({ snapshot, trail, collisions, ledger, spend })
}

/**
 * SIMULATED: three agents still active with nothing captured (three identical "unresolved: No captured outcome"
 * findings at ?), and two that ended without a report (two identical trail flags and two identical F3 findings at ∅).
 */
function quietSwarm(): Snapshot {
  const snapshot = build(
    ...['a1', 'a2', 'a3'].flatMap(id => [spawn(id, { description: `wait ${id}` }), turnStart(id, `t-${id}`)]),
    ...['e1', 'e2'].flatMap(id => [spawn(id, { description: `end ${id}` }), turnStart(id, `t-${id}`), turnEnd(id, `t-${id}`, '')]),
  )
  return { ...snapshot, sessionId: SESSION }
}

/** A stand-in context for a direct call on a given surface and width. */
function surfaceContext(snapshot: Snapshot, width: number, surface: 'terminal' | 'desktop'): ViewContext {
  return { ...stubContext(snapshot, width), surface }
}

// ── Sunset Glass: Collisions ──

describe('collisions: Sunset Glass', () => {
  test('the matrix sits in a glass panel at medium and wide (translucent on desktop, a round border on the terminal), plain at compact', SLOW, async ($, on) => {
    seededEngine(on, collidingSession())
    for (const [surface, width] of [['desktop', 116], ['terminal', 116], ['terminal', 80], ['desktop', 160]] as const) {
      const ui = await mountOn($, surface, width, 'collisions')
      const tree = (await ui.drawn()) as DrawnNode
      const panel = keyed(tree, 'col-matrix')
      const where = `${surface}@${width}`
      expect({ where, border: panel?.props?.borderStyle }).toEqual({ where, border: 'round' })
      if (surface === 'desktop') expect(String(panel?.props?.backgroundColor)).toMatch(/^#[0-9a-f]{8}$/)
      else expect(panel?.props?.backgroundColor).toBeUndefined()
      const inside = linesIn(panel)
      expect(inside.join('\n')).toContain('Files × agents')
      // The panel's border and padding take four cells: every matrix row fits inside them.
      const rows = inside.filter(l => /token\.ts|session-store\.ts/.test(l) && /W\d|×|·/.test(l))
      expect(rows.length).toBe(2)
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(width - 4)
      await ui.unmount()
    }
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountOn($, surface, 49, 'collisions')
      expect(keyed((await ui.drawn()) as DrawnNode, 'col-matrix')).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a multi-writer row is marked amber with ⇄, never red; r, W, × and · are drawn apart', SLOW, async ($, on) => {
    seededEngine(on, collidingSession())
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountOn($, surface, 80, 'collisions')
      const tree = (await ui.drawn()) as DrawnNode
      // The colours of the theme this surface draws (the terminal classic, the desktop its scene).
      applyTheme(themeFor(surface))
      const rowOf = (file: RegExp) => every(tree).find(n => n.type === 'Text' && n.props?.mono === true && file.test(inline(n)))
      const shared = rowOf(/token\.ts/)
      const failed = rowOf(/session-store\.ts/)
      const runs = (row: El | undefined) => (row ? kidsOf(row).filter(isEl) : [])
      const run = (row: El | undefined, text: RegExp) => runs(row).find(r => text.test(inline(r)))
      expect(run(shared, /⇄/)?.props?.color).toBe(ROLE.caution)
      const writes = runs(shared).filter(r => /W\d/.test(inline(r)))
      expect(writes.length).toBe(2)
      for (const w of writes) expect(w.props?.color).toBe(ROLE.caution)
      // A potential conflict is amber; red is kept for the failed edits alone.
      expect(run(failed, /×/)?.props?.color).toBe(ROLE.fail)
      expect(runs(shared).some(r => r.props?.color === ROLE.fail)).toBe(false)
      // A read is muted; "not touched" is muted and dim, so the two never look alike.
      const read = run(shared, /^\s*r\s*$/)
      const untouched = run(failed, /^\s*·\s*$/)
      expect(read?.props?.color).toBe(ROLE.muted)
      expect(read?.props?.dimColor).not.toBe(true)
      expect(untouched?.props?.dimColor).toBe(true)
      // Desktop: the multi-writer row carries a faint amber band; a single-writer row none. The terminal gets no band.
      if (surface === 'desktop') {
        expect(String(shared?.props?.backgroundColor)).toMatch(/^#[0-9a-f]{8}$/)
        expect(failed?.props?.backgroundColor).toBeUndefined()
      } else {
        expect(shared?.props?.backgroundColor).toBeUndefined()
      }
      await ui.unmount()
    }
  })

  test('the empty states are tiles with a glyph, their line and the explanation', SLOW, async ($, on) => {
    seededEngine(on, { ...build(...threeAgentSession().slice(0, 5)), sessionId: SESSION })
    const desk = await mountOn($, 'desktop', 116, 'collisions')
    const tree = (await desk.drawn()) as DrawnNode
    const tiles = every(tree).filter(n => n.type === 'Box' && n.props?.backgroundColor === GLASS.sunken)
    const writes = tiles.find(t => textIn(t).includes('No file writes observed'))
    const signals = tiles.find(t => textIn(t).includes('No collision signals.'))
    expect(linesIn(writes)[0]).toMatch(/^✎ No file writes observed$/)
    expect(textIn(writes)).toContain('reads alone are not drawn')
    expect(linesIn(signals)[0]).toMatch(/^○ No collision signals\.$/)
    expect(textIn(signals)).toContain('contradictory results')
    await desk.unmount()
    const term = await mountOn($, 'terminal', 49, 'collisions')
    const text = (await linesOf(term)).join('\n')
    expect(text).toContain('✎ No file writes observed')
    expect(text).toContain('○ No collision signals.')
    await term.unmount()
  })

  test('a signal card holds its evidence toggle, its actions and the opened evidence inside the card', SLOW, async ($, on) => {
    const seed = collidingSession()
    seededEngine(on, seed)
    const first = analyzeCollisions(seed).signals[0]
    for (const [surface, width] of [['terminal', 116], ['desktop', 116], ['terminal', 49]] as const) {
      const ui = await mountOn($, surface, width, 'collisions')
      let card = keyed((await ui.drawn()) as DrawnNode, 'sc-col-0')
      expect(buttonKeys(card)).toEqual(expect.arrayContaining(['sig-0', 'sig-src-0']))
      if (width > 49) expect(buttonKeys(card)).toEqual(expect.arrayContaining(['sig-fx-0-0']))
      expect(textIn(card)).toMatch(/▸ evidence · \d+ source events?/)
      await ui.press({ key: 'sig-0' })
      card = keyed((await ui.drawn()) as DrawnNode, 'sc-col-0')
      expect(textIn(card)).toContain('not a defect by itself')
      expect(textIn(card)).toMatch(/▾ evidence/)
      for (const line of first?.detail ?? []) expect(textIn(card)).toContain(line)
      await ui.press({ key: 'sig-0' })
      // Desktop draws a Button as one plain line: the toggle is a plain label, never styled children.
      if (surface === 'desktop') {
        const toggle = keyed((await ui.drawn()) as DrawnNode, 'sig-0')
        expect(String(toggle?.props?.label)).toMatch(/^▸ evidence/)
        expect(kidsOf(toggle as El).filter(isEl)).toEqual([])
      }
      await ui.unmount()
    }
  })
})

// ── Sunset Glass: Health ──

describe('health: Sunset Glass', () => {
  test('every card draws its level word beside its glyph, so an F3 entry titled "unresolved:" at ∅ reads as unavailable', SLOW, async ($, on) => {
    seededEngine(on, quietSwarm())
    for (const [surface, width] of [['terminal', 49], ['terminal', 116], ['desktop', 160]] as const) {
      const ui = await mountOn($, surface, width, 'health')
      const heads = headsOf((await ui.drawn()) as DrawnNode, 'hl-')
      const where = `${surface}@${width}`
      expect({ where, active: heads.some(l => l.startsWith('? unresolved: No captured outcome')) }).toEqual({ where, active: true })
      expect({ where, ended: heads.some(l => l.startsWith('∅ unavailable · unresolved: No captured outcome')) }).toEqual({ where, ended: true })
      expect({ where, flag: heads.some(l => l.startsWith('∅ unavailable · Ended (completed)')) }).toEqual({ where, flag: true })
      // The word is never doubled where the title already starts with it.
      expect({ where, doubled: heads.filter(l => /unresolved · unresolved/.test(l)) }).toEqual({ where, doubled: [] })
      await ui.unmount()
    }
  })

  test('collision and observed entries read glyph, level word, then their own evidence label and title', SLOW, async ($, on) => {
    seededEngine(on, collidingWithUsage())
    for (const tab of ['health', 'collisions']) {
      const ui = await mountOn($, 'terminal', 116, tab)
      const heads = headsOf((await ui.drawn()) as DrawnNode, tab === 'health' ? 'hl-' : 'col-')
      expect(heads.some(l => l.startsWith('▲ investigate · ◆ C replaced text in token.ts that B had written'))).toBe(true)
      expect(heads.some(l => l.startsWith('△ notice · ● Sequential edits to token.ts by B, C'))).toBe(true)
      if (tab === 'health') expect(heads.some(l => l.startsWith('● observed · ◇ failed-or-inconclusive: Changed'))).toBe(true)
      await ui.unmount()
    }
  })

  test('identical findings fold into one card with all their chips, and every per-signal action stays drawn', SLOW, async ($, on) => {
    const seed = quietSwarm()
    seededEngine(on, seed)
    const health = healthFor(seed)
    const expected = health.flatMap((s, i) => [
      ...s.agentIds.map(id => `focus-h${i}-${id}`),
      ...(s.nodeId ? [`sig-h${i}-tr`] : []),
      ...(s.eventIds.length > 0 ? [`dc-h-ev-${i}`] : []),
    ])
    expect(expected.length).toBeGreaterThan(10)
    const active = health.map((s, i) => ({ s, i })).filter(e => e.s.source === 'outcome' && e.s.level === 'unresolved')
    expect(active.length).toBe(3)
    for (const [surface, width] of [['terminal', 116], ['desktop', 160], ['terminal', 80], ['terminal', 49]] as const) {
      const ui = await mountOn($, surface, width, 'health')
      const tree = (await ui.drawn()) as DrawnNode
      const where = `${surface}@${width}`
      expect({ where, missing: expected.filter(k => !buttonKeys(tree).includes(k)) }).toEqual({ where, missing: [] })
      const heads = headsOf(tree, 'hl-').filter(l => /^[?∅] .*No captured outcome/.test(l))
      // Compact keeps one row per entry; wider panes fold the identical ones (? ×3 and ∅ ×2) into two cards.
      expect({ where, heads: heads.length }).toEqual({ where, heads: width === 49 ? 5 : 2 })
      if (width > 49) {
        const card = keyed(tree, `sc-hl-${active[0]?.i}`)
        const text = textIn(card)
        for (const chip of [' A ', ' B ', ' C ']) expect(text).toContain(chip)
        expect(text).toContain('3 entries')
        // Each folded entry's own evidence opens inside the folded card.
        for (const { i } of active) {
          await ui.press({ key: `dc-h-ev-${i}` })
          const opened = keyed((await ui.drawn()) as DrawnNode, `sc-hl-${active[0]?.i}`)
          expect(buttonKeys(opened).some(k => k.startsWith(`sig-h${i}-ev-`))).toBe(true)
          await ui.press({ key: `dc-h-ev-${i}` })
        }
      }
      await ui.unmount()
    }
  })

  test('a crowd of identical findings keeps the caps: five entries first, the rest behind "show N more entries"', SLOW, async ($, on) => {
    // SIMULATED: forty agents still active with nothing captured, forty identical "unresolved: No captured outcome".
    const ids = Array.from({ length: 40 }, (_, i) => `idle${i}`)
    seededEngine(on, { ...build(...ids.flatMap(id => [spawn(id, { description: `wait ${id}` }), turnStart(id, `t-${id}`)])), sessionId: SESSION })
    for (const [surface, width] of [['terminal', 116], ['desktop', 160]] as const) {
      const ui = await mountOn($, surface, width, 'health')
      let tree = (await ui.drawn()) as DrawnNode
      const where = `${surface}@${width}`
      // The caps count entries, then each slice folds: no folded card holds more rows than the first five.
      expect({ where, more: logicalLines(tree).some(l => /show \d+ more entries/.test(l)) }).toEqual({ where, more: true })
      const rows = (card: El) => keyedLike(card, /^hl-m-/).length
      const folded = keyedLike(tree, /^sc-hl-\d+$/).filter(card => rows(card) > 1)
      expect({ where, folded: folded.length }).toEqual({ where, folded: 1 })
      for (const card of keyedLike(tree, /^sc-hl-\d+$/)) expect({ where, rows: rows(card) <= 5 }).toEqual({ where, rows: true })
      for (const key of buttonKeys(tree).filter(k => /^dc-hl-more-/.test(k))) await ui.press({ key })
      tree = (await ui.drawn()) as DrawnNode
      for (const card of keyedLike(tree, /^sc-hl-\d+$/)) expect({ where, rows: rows(card) <= 25 }).toEqual({ where, rows: true })
      const size = treeSize(tree)
      expect({ where, ok: size.depth <= 20 && size.nodes <= 2500 }).toEqual({ where, ok: true })
      for (const key of buttonKeys(tree).filter(k => /^dc-hl-more-/.test(k))) await ui.press({ key })
      await ui.unmount()
    }
  })

  test('a value-only entry is a quiet pill with its actions, never an alarm card', SLOW, async ($, on) => {
    const seed = collidingWithUsage()
    seededEngine(on, seed)
    const index = healthFor(seed).findIndex(isValueOnly)
    expect(index).toBeGreaterThanOrEqual(0)
    for (const [surface, width] of [['desktop', 116], ['terminal', 116], ['terminal', 49]] as const) {
      const ui = await mountOn($, surface, width, 'health')
      const tree = (await ui.drawn()) as DrawnNode
      expect(keyed(tree, `sc-hl-${index}`)).toBeUndefined()
      const entry = keyed(tree, `hl-${index}`)
      const line = linesIn(entry).find(l => l.includes('main context 5%'))
      expect(line).toMatch(/● main context 5%.*value only/)
      expect(buttonKeys(entry)).toContain(`focus-h${index}-main`)
      // Not inside any bordered card: on desktop it is a pill (a round capsule without vertical padding).
      const bordered = every(entry).filter(n => n.type === 'Box' && n.props?.borderStyle !== undefined)
      if (surface === 'desktop') {
        expect(bordered.length).toBe(1)
        expect(bordered[0]?.props?.paddingY).toBe(0)
        expect(textIn(bordered[0])).toBe('● main context 5%')
      } else {
        expect(bordered).toEqual([])
      }
      await ui.unmount()
    }
  })

  test('group headers carry their count as a pill, and the level counts sit under the heading', SLOW, async ($, on) => {
    const seed = collidingWithUsage()
    seededEngine(on, seed)
    const findings = findingsOf(healthFor(seed))
    const count = (level: string) => findings.filter(s => s.level === level).length
    const levels = (['unresolved', 'investigate', 'notice', 'unavailable', 'observed'] as const)
      .filter(level => count(level) > 0)
      .map(level => `${LEVEL_STYLE[level].glyph} ${count(level)} ${LEVEL_STYLE[level].word}`)
    expect(levels.length).toBeGreaterThanOrEqual(4)
    const desk = await mountOn($, 'desktop', 116, 'health')
    const tree = (await desk.drawn()) as DrawnNode
    const header = every(tree).find(n => n.type === 'Box' && n.props?.flexDirection === 'row' && /Collision signals/.test(textIn(n)) && !/investigate ·/.test(textIn(n)))
    const pill = every(header).find(n => n.type === 'Box' && n.props?.borderStyle === 'round')
    expect(textIn(pill)).toBe('4 signals')
    const context = every(tree).find(n => n.type === 'Box' && n.props?.flexDirection === 'row' && textIn(n).startsWith(`${themeFor('desktop').chrome.subMark} Context`))
    expect(textIn(context)).toMatch(/1 signal \+ 1 value/)
    const all = logicalLines(tree).join('\n')
    for (const level of levels) expect(all).toContain(level)
    await desk.unmount()
    const term = await mountOn($, 'terminal', 116, 'health')
    const lines = await linesOf(term)
    expect(lines).toContain('· Collision signals · 4 signals')
    expect(lines.find(l => l.startsWith(levels[0] ?? '∅'))).toBe(levels.join(' · '))
    await term.unmount()
  })

  test('expanded panes draw three card columns, wide two, and a lone card takes the whole row', () => {
    const seed = collidingSession()
    const widths = (ctx: ViewContext, n: number) => {
      const drawn = CardGrid(ctx, 'g', Array.from({ length: n }, (_, i) => i), (cell, item) => ({ type: 'Text', props: { children: `${item}@${cell.width}:${cell.layout}` } }) as never)
      return every(drawn as DrawnNode)
        .filter(n => n.type === 'Text')
        .map(n => String(n.props?.children))
    }
    // 160 cells: (160 − 2 gaps) / 3 = 52 a column, still drawn as cards (never the compact rows).
    expect(widths(surfaceContext(seed, 160, 'desktop'), 6)).toEqual(['0@52:medium', '1@52:medium', '2@52:medium', '3@52:medium', '4@52:medium', '5@52:medium'])
    // Rows are balanced: four cards are two by two, not three and one.
    expect(widths(surfaceContext(seed, 160, 'desktop'), 4).map(t => t.split('@')[1])).toEqual(['79:medium', '79:medium', '79:medium', '79:medium'])
    expect(widths(surfaceContext(seed, 116, 'terminal'), 3).map(t => t.split('@')[1])).toEqual(['57:medium', '57:medium', '57:medium'])
    // One card is never half a row.
    expect(widths(surfaceContext(seed, 160, 'desktop'), 1)).toEqual(['0@160:wide'])
    expect(widths(surfaceContext(seed, 80, 'terminal'), 3)).toEqual(['0@80:medium', '1@80:medium', '2@80:medium'])
  })
})

// ── Sunset Glass: the Live strip ──

describe('the Live health strip', () => {
  test('identical titles fold into one line with every agent chip, then all N in Health', SLOW, async ($, on) => {
    const seed = quietSwarm()
    seededEngine(on, seed)
    const findings = findingsOf(healthFor(seed))
    expect(findings.length).toBe(7)
    for (const [surface, width] of [['terminal', 49], ['terminal', 80], ['terminal', 116], ['desktop', 116], ['desktop', 160]] as const) {
      const ui = await mountOn($, surface, width, 'live')
      const tree = (await ui.drawn()) as DrawnNode
      const where = `${surface}@${width}`
      const strip = keyedLike(tree, /^sc-lv-/).map(n => linesIn(n).join(' '))
      expect({ where, n: strip.length }).toEqual({ where, n: 3 })
      const active = strip.find(l => l.startsWith('? unresolved: No capt'))
      // At 49 cells the title gives way to the chips: "∅ unavailable · unresolved: No capture… · D E".
      const ended = strip.find(l => l.startsWith('∅ unavailable · unresolved: No capt'))
      const flags = strip.find(l => l.startsWith('∅ unavailable · Ended (completed)'))
      for (const chip of [' A ', ' B ', ' C ']) expect({ where, chip, has: active?.includes(chip) }).toEqual({ where, chip, has: true })
      for (const chip of [' D ', ' E ']) {
        expect({ where, chip, has: ended?.includes(chip) }).toEqual({ where, chip, has: true })
        expect({ where, chip, has: flags?.includes(chip) }).toEqual({ where, chip, has: true })
      }
      // A narrow column moves a line's chips under its title. The terminal cuts a title to its cells, so every drawn
      // line fits the pane; desktop keeps the whole title and wraps it in its own column (its renderer wraps nested runs).
      if (surface === 'terminal') {
        for (const line of keyedLike(tree, /^sc-lv-/).flatMap(n => linesIn(n))) expect({ where, line, fits: line.length <= width }).toEqual({ where, line, fits: true })
      } else {
        const heads = keyedLike(tree, /^sc-lv-/).map(n => every(n).find(t => t.type === 'Text' && /No captured outcome|Ended \(completed\)/.test(inline(t))))
        for (const head of heads) expect({ where, wrap: head?.props?.wrap, whole: /No captured outcome$|captured report$/.test(inline(head)) }).toEqual({ where, wrap: 'wrap', whole: true })
      }
      expect(textIn(tree)).toMatch(/▌ Health · 7 of 7 signals from existing analyses/)
      expect(keyed(tree, 'lv-health')?.props?.label).toBe('all 7 in Health')
      await ui.press({ key: 'lv-health' })
      expect(isSelected((await ui.drawn()) as DrawnNode, 'tab-health')).toBe(true)
      await ui.unmount()
    }
  })

  test('the strip always covers the first three findings, each with its own chips', SLOW, async ($, on) => {
    const seed = collidingWithUsage()
    seededEngine(on, seed)
    const findings = findingsOf(healthFor(seed))
    for (const [surface, width] of [['terminal', 116], ['desktop', 116]] as const) {
      const ui = await mountOn($, surface, width, 'live')
      const strip = keyedLike((await ui.drawn()) as DrawnNode, /^sc-lv-/).map(n => linesIn(n).join(' '))
      for (const finding of findings.slice(0, 3)) {
        const line = strip.find(l => l.includes(finding.title.slice(0, 24)))
        expect({ title: finding.title, drawn: line !== undefined }).toEqual({ title: finding.title, drawn: true })
        for (const id of finding.agentIds) {
          const label = seed.agents[id]?.isMain ? '◎ main' : ` ${seed.agents[id]?.label ?? '?'} `
          expect(line).toContain(label)
        }
      }
      await ui.unmount()
    }
  })
})

// ── Sunset Glass: platform ──

/** Every tab of mine on both surfaces and four widths: unique keys, Buttons hold only Text, no terminal alpha, the budget. */
async function platformScan($: Engine, opened: boolean) {
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const width of [49, 80, 116, 160]) {
      const ui = await mountOn($, surface, width, 'collisions')
      if (opened) await ui.press({ key: 'sig-0' })
      for (const view of ['collisions', 'health', 'live']) {
        await ui.press({ key: `tab-${view}` })
        const tree = (await ui.drawn()) as DrawnNode
        const where = `${surface}@${width} ${view}`
        const keys = buttonKeys(tree)
        expect({ where, dupes: keys.filter((k, i) => keys.indexOf(k) !== i) }).toEqual({ where, dupes: [] })
        const boxed = every(tree)
          .filter(n => n.type === 'Button')
          .flatMap(b => every(b).slice(1))
          .filter(n => n.type !== 'Text')
        expect({ where, boxed: boxed.map(n => n.type) }).toEqual({ where, boxed: [] })
        if (surface === 'terminal') expect({ where, bad: propStrings(tree).filter(v => ALPHA_COLOUR.test(v)) }).toEqual({ where, bad: [] })
        const size = treeSize(tree)
        expect({ where, ok: size.depth <= 20 && size.nodes <= 2500 }).toEqual({ where, ok: true })
      }
      await ui.unmount()
    }
  }
}

describe('collisions and health: platform boundary', () => {
  test('colliding session, a signal opened: unique keys, Buttons hold only Text, no alpha on the terminal, within budget', SLOW, async ($, on) => {
    seededEngine(on, collidingWithUsage())
    await platformScan($, true)
  })

  test('identical findings folded: unique keys, Buttons hold only Text, no alpha on the terminal, within budget', SLOW, async ($, on) => {
    seededEngine(on, quietSwarm())
    await platformScan($, false)
  })

  test('the evidence label stays on every measured line of the strip and the cards', SLOW, async ($, on) => {
    seededEngine(on, collidingWithUsage())
    for (const [surface, width] of [['terminal', 49], ['terminal', 116], ['desktop', 160]] as const) {
      const health = await mountOn($, surface, width, 'health')
      const all = await linesOf(health)
      const mine = all.slice(all.findIndex(l => /Swarm health/.test(l)), all.findIndex(l => /^─+$/.test(l)))
      expect(mine.length).toBeGreaterThan(5)
      await health.unmount()
      const live = await mountOn($, surface, width, 'live')
      const strip = keyedLike((await live.drawn()) as DrawnNode, /^sc-lv-/).flatMap(n => linesIn(n))
      expect(strip.length).toBeGreaterThan(0)
      await live.unmount()
      const where = `${surface}@${width}`
      const untagged = [...mine, ...strip].filter(l => METRIC.test(l) && !LABEL.test(l) && !/^\[|^▸|^▾/.test(l.trim()))
      expect({ where, untagged }).toEqual({ where, untagged: [] })
      // A level word is drawn only beside its own glyph.
      const words = Object.values(LEVEL_STYLE)
      const mismatched = [...mine, ...strip].filter(l => words.some(w => words.some(o => o !== w && l.includes(`${o.glyph} ${w.word} ·`))))
      expect({ where, mismatched }).toEqual({ where, mismatched: [] })
    }
  })
})
