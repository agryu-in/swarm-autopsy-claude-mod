// Forensics: the timeline, its filters and rows, the shared timeline row, and
// the agent Select past 63 agents. Split from ui-collisions-forensics.test.tsx
// with no assertion changed. The whole pane is mounted through the engine's
// test host with a SIMULATED snapshot seeded through `state.get` (as the
// acceptance suite does), and read as logical lines; a few wiring checks call a
// view directly with plain-data stand-ins for the elements.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { analyzeCollisions } from '../hooks/lib/collisions'
import { applyUsage } from '../hooks/lib/ledger'
import { isFailure } from '../hooks/lib/timeline'
import { buildTrail } from '../hooks/lib/trail'
import { GLASS } from '../hooks/lib/palette'
import { CollisionsView } from '../hooks/ui/collisions'
import type { ViewContext } from '../hooks/ui/common'
import { EventLine, eventGlyph, statusText } from '../hooks/ui/events'
import { ForensicsView, type SignalRef } from '../hooks/ui/forensics'
import { layoutFor } from '../hooks/ui/kit'
import type { ForensicEvent, Snapshot, UiState } from '../types'
import { build, spawn, threeAgentSession, tool } from './fixtures'
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

/** Every Box laid out as a wrapping row, with the types of its direct children. */
function wrappingRows(node: DrawnNode, out: string[][] = []): string[][] {
  if (node === null || node === undefined || typeof node !== 'object') return out
  const children = (Array.isArray(node.children) ? node.children : (node.props?.children as DrawnNode[] | undefined)) ?? []
  const list = Array.isArray(children) ? children : [children]
  if (node.type === 'Box' && node.props?.flexDirection === 'row' && node.props?.flexWrap === 'wrap') {
    // A selected chip's glass capsule (Abyssal desktop, key `sel-…`) holds one Button: it counts as that Button.
    const typeOf = (c: { type: string; props?: Record<string, unknown> }) => (String(c.props?.key ?? '').startsWith('sel-') ? 'Button' : c.type)
    out.push(list.filter(c => c !== null && c !== undefined && typeof c === 'object').map(c => typeOf(c as { type: string; props?: Record<string, unknown> })))
  }
  for (const child of list) wrappingRows(child, out)
  return out
}

/** The total the Forensics header states, e.g. "12 events". */
const totalOf = (lines: readonly string[]) => Number(lines.join('\n').match(/(\d+) events? ·/)?.[1] ?? NaN)

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

function plainText(node: unknown): string {
  if (Array.isArray(node)) return node.map(plainText).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node === null || typeof node !== 'object') return ''
  const drawn = node as Plain
  return `${typeof drawn.props?.label === 'string' ? drawn.props.label : ''}${plainText(drawn.props?.children)}`
}

// ── Forensics ──

describe('forensics view', () => {
  test('filter chips carry their counts and the order label states the real order', SLOW, async ($, on) => {
    const seed = collidingSession()
    seededEngine(on, seed)
    const ui = await mountOn($, 'terminal', 116, 'forensics')
    const all = await ui.find({ key: 'filter-all' })
    expect(all?.props.label).toBe(`All ${seed.events.length}`)
    const failures = await ui.find({ key: 'filter-failures' })
    expect(failures?.props.label).toBe(`Failures ${seed.events.filter(isFailure).length}`)
    const lines = await linesOf(ui)
    expect(lines.join('\n')).toMatch(/page 1\/\d+ · newest/)
    expect(lines.join('\n')).toContain('rows oldest → newest')
    const seqs = lines.map(l => l.match(/#\s*(\d+)\s/)?.[1]).filter((s): s is string => s !== undefined).map(Number)
    expect(seqs.length).toBeGreaterThan(0)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(seqs).toContain(Math.max(...seed.events.map(e => e.seq)))
    // Signal-flagged events are marked ▲; ⚑ is left to verification in the Trail.
    expect(lines.some(l => /^▸ ▲/.test(l))).toBe(true)
    expect(lines.join('\n')).not.toContain('⚑')
    await ui.unmount()
  })

  test('the agent filter is a Select on the terminal; chips on the desktop, whose still pane draws no Select', SLOW, async ($, on) => {
    const seed = collidingSession()
    seededEngine(on, seed)
    const desk = await mountOn($, 'desktop', 116, 'forensics')
    expect(await desk.find({ key: 'agent-filter' })).toBeUndefined()
    await desk.press({ key: 'ag-a:implementer' })
    expect(totalOf(await linesOf(desk))).toBe(seed.events.filter(e => e.agentId === 'implementer').length)
    await desk.press({ key: 'ag-all' })
    expect(totalOf(await linesOf(desk))).toBe(seed.events.length)
    await desk.unmount()
    for (const [surface, width] of [['terminal', 80]] as const) {
      const ui = await mountOn($, surface, width, 'forensics')
      const select = await ui.find({ key: 'agent-filter' })
      expect(select?.type).toBe('Select')
      const options = select?.props.options as Array<{ value: string; label?: string }>
      expect(options.map(o => o.value)).toEqual(['all', ...seed.agentOrder])
      await ui.select({ key: 'agent-filter', value: 'implementer' })
      expect(totalOf(await linesOf(ui))).toBe(seed.events.filter(e => e.agentId === 'implementer').length)
      await ui.select({ key: 'agent-filter', value: 'all' })
      expect(totalOf(await linesOf(ui))).toBe(seed.events.length)
      await ui.unmount()
    }
  })

  test('the focused agent pre-filters, and "clear" lifts it', SLOW, async ($, on) => {
    const seed = collidingSession()
    seededEngine(on, seed)
    const ui = await mountOn($, 'terminal', 80, 'live')
    await ui.press({ key: 'card-tester' })
    await ui.press({ key: 'tab-forensics' })
    expect(totalOf(await linesOf(ui))).toBe(seed.events.filter(e => e.agentId === 'tester').length)
    expect((await ui.find({ key: 'agent-filter' }))?.props.value).toBe('tester')
    expect(await keysOf(ui)).toContain('focus-clear')
    await ui.press({ key: 'focus-clear' })
    expect(totalOf(await linesOf(ui))).toBe(seed.events.length)
    expect(await keysOf(ui)).not.toContain('focus-clear')
    await ui.unmount()
  })

  test('compact: no wrapping row mixes buttons and text, and the agent filter is chips', SLOW, async ($, on) => {
    seededEngine(on, collidingSession())
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const width of [30, 49]) {
        const ui = await mountOn($, surface, width, 'forensics')
        const tree = (await ui.drawn()) as DrawnNode
        for (const types of wrappingRows(tree)) {
          const buttons = types.filter(t => t === 'Button').length
          expect(buttons === 0 || buttons === types.length).toBe(true)
        }
        const keys = await keysOf(ui)
        expect(keys).toEqual(expect.arrayContaining(['ag-all', 'ag-a:tester', 'filter-all', 'filter-failures']))
        await ui.press({ key: 'ag-a:tester' })
        expect(totalOf(await linesOf(ui))).toBeGreaterThan(0)
        await ui.unmount()
      }
    }
  })

  test('a selected event keeps its whole evidence: source, paths, command, output and diff', SLOW, async ($, on) => {
    const seed = collidingSession()
    seededEngine(on, seed)
    const ui = await mountOn($, 'terminal', 116, 'forensics')
    const edit = seed.events.find(e => e.toolUseId === 'e9')
    await ui.press({ key: `row-ev-${edit?.seq}` })
    let text = (await linesOf(ui)).join('\n')
    expect(text).toContain(`evidence · event #${edit?.seq}`)
    expect(text).toContain(`source: ${edit?.source}`)
    expect(text).toMatch(/paths \(write\): \S*src\/auth\/token\.ts/)
    expect(text).toContain('− exp * 1000 < Date.now()')
    expect(text).toContain('+ exp * 1000 <= Date.now()')
    const run = seed.events.find(e => e.toolUseId === 'b2')
    await ui.press({ key: `row-ev-${run?.seq}` })
    text = (await linesOf(ui)).join('\n')
    expect(text).toContain('command (test command): npm test -- token')
    expect(text).toMatch(/result: failed \(exit 1\)/)
    expect(text).toContain('1 failing')
    await ui.unmount()
  })
})

// ── the shared timeline row ──

describe('event line', () => {
  const seed = collidingSession()
  const run = seed.events.find(e => e.toolUseId === 'b2') as ForensicEvent
  const read = seed.events.find(e => e.toolUseId === 'r1') as ForensicEvent

  test('checks show their verdict glyph, never ⚑; other kinds keep theirs', () => {
    expect(eventGlyph(run)).toBe('✕')
    expect(eventGlyph(seed.events.find(e => e.toolUseId === 'b1') as ForensicEvent)).toBe('✓')
    expect(eventGlyph(read)).toBe('◦')
    expect(eventGlyph(seed.events.find(e => e.toolUseId === 'e1') as ForensicEvent)).toBe('✎')
    expect(seed.events.map(eventGlyph)).not.toContain('⚑')
  })

  test('status words at 60 columns and wider, a glyph below; the agent as its chip', () => {
    expect(statusText(run).text).toBe('failed (exit 1)')
    const wide = inline(EventLine(stubContext(seed, 80), run, 80, true) as unknown as DrawnNode)
    expect(wide).toContain('failed (exit 1)')
    expect(wide).toContain(' C ')
    expect(wide).toContain('npm test')
    const narrow = inline(EventLine(stubContext(seed, 40), run, 40, true) as unknown as DrawnNode)
    expect(narrow).not.toContain('failed (exit 1)')
    expect(narrow).toContain('✕')
    expect(plainText(EventLine(stubContext(seed, 40), read, 40, false))).toContain('Read token.ts')
  })
})

// ── the timeline on glass (direct calls, both surfaces) ──

type Drawn = { type: string; props: Record<string, unknown> }

function kidsOf(node: Drawn): unknown[] {
  const children = node.props?.children
  return Array.isArray(children) ? children.flat(Infinity) : children === undefined ? [] : [children]
}

function all(node: unknown, out: Drawn[] = []): Drawn[] {
  if (Array.isArray(node)) {
    for (const child of node) all(child, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  out.push(node as Drawn)
  for (const child of kidsOf(node as Drawn)) all(child, out)
  return out
}

/** The elements from the root down to `target`'s parent, outermost first. */
function ancestors(node: unknown, target: Drawn, path: Drawn[] = []): Drawn[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = ancestors(child, target, path)
      if (found.length > 0) return found
    }
    return []
  }
  if (node === null || typeof node !== 'object') return []
  for (const child of kidsOf(node as Drawn)) {
    if (child === target) return [...path, node as Drawn]
    const found = ancestors(child, target, [...path, node as Drawn])
    if (found.length > 0) return found
  }
  return []
}

const strings = (node: unknown): string => (typeof node === 'string' ? node : all(node).flatMap(e => kidsOf(e).filter((c): c is string => typeof c === 'string')).join(''))
const ALPHA_COLOUR = /#[0-9a-f]{8}\b|#[0-9a-f]{4}\b|rgba?\(|hsla?\(/i

function viewContext(snapshot: Snapshot, surface: 'terminal' | 'desktop', width: number, ui: Partial<UiState> = {}): ViewContext {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const els = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Select: element('Select'), ...(surface === 'desktop' ? { Svg: element('Svg') } : {}) }
  return {
    els: els as unknown as ViewContext['els'],
    surface,
    width,
    rows: 40,
    layout: layoutFor(width),
    now: NOW,
    snapshot,
    ui: { view: 'forensics', filter: 'all', page: 0, ...ui },
    act: NOOP_ACTIONS,
  }
}

const signalsOf = (snapshot: Snapshot): SignalRef[] =>
  analyzeCollisions(snapshot).signals.map(s => ({ id: s.id, title: s.title, eventIds: s.eventIds, level: s.severity }))

describe('forensics: glass', () => {
  test('desktop: the timeline is one glass panel of aligned rows; ▲ sits in a fixed cell and the selected row is lit', () => {
    const seed = collidingSession()
    const signals = signalsOf(seed)
    const flagged = new Set(signals.flatMap(s => s.eventIds))
    const first = all(ForensicsView(viewContext(seed, 'desktop', 116), signals)).filter(e => e.type === 'Button' && String(e.props.key).startsWith('row-ev-'))
    const seqs = first.map(b => Number(String(b.props.key).slice('row-ev-'.length)))
    const pick = seed.events.find(e => e.seq === seqs[1]) as ForensicEvent
    const tree = ForensicsView(viewContext(seed, 'desktop', 116, { selected: `ev:${pick.id}` }), signals)
    const rows = all(tree).filter(e => e.type === 'Button' && String(e.props.key).startsWith('row-ev-'))
    expect(rows.length).toBe(first.length)
    const panels = new Set(rows.map(b => ancestors(tree, b).findLast(e => e.props.borderStyle === 'round')))
    expect(panels.size).toBe(1)
    const panel = [...panels][0] as Drawn
    expect(String(panel.props.backgroundColor)).toMatch(/^#[0-9a-f]{8}$/)
    // Spans the pane: every Box above the panel is a column (a row, the engine's default, shrinks it to its content).
    expect(ancestors(tree, panel).filter(a => a.props.flexDirection !== 'column').map(a => a.type)).toEqual([])
    // ▲ in a two-cell column on every flagged row, and nothing padded with spaces in its place.
    const marks = all(tree).filter(e => e.type === 'Box' && e.props.width === 2 && strings(e).includes('▲'))
    const shownFlagged = seqs.filter(s => flagged.has(seed.events.find(e => e.seq === s)?.id ?? '')).length
    expect(shownFlagged).toBeGreaterThan(0)
    expect(marks.length).toBe(shownFlagged)
    expect(all(tree).filter(e => e.type === 'Text' && kidsOf(e).some(c => typeof c === 'string' && /^ {2,}$/.test(c)))).toEqual([])
    // Exactly the selected row is lit.
    const lit = all(tree).filter(e => e.type === 'Box' && e.props.backgroundColor === GLASS.hoverFill)
    expect(lit.length).toBe(1)
    expect(all(lit[0]).some(e => e.type === 'Button' && e.props.key === `row-ev-${pick.seq}`)).toBe(true)
    // Every row stretches across the panel: the box holding a row's cells sits in a column, so its flexible summary cell
    // keeps its room (in a row it shrinks to nothing, seen in the harness paint of a selected row, 2026-10-18).
    for (const button of rows) expect(ancestors(tree, button).at(-2)?.props.flexDirection).toBe('column')
  })

  test('desktop rows inside the glass panel keep their status words at the widths the terminal does (64 and up)', () => {
    const seed = collidingSession()
    for (const width of [64, 80]) {
      const lines = logicalLines(ForensicsView(viewContext(seed, 'desktop', width, { filter: 'failures' }), signalsOf(seed)) as DrawnNode)
      expect(lines.some(l => l.includes('failed (exit 1)'))).toBe(true)
    }
  })

  test('desktop: the selected event’s evidence sits in a sunken glass panel, its diff and command in mono, the diff in its colours', () => {
    const seed = collidingSession()
    const edit = seed.events.find(e => e.toolUseId === 'e9') as ForensicEvent
    const tree = ForensicsView(viewContext(seed, 'desktop', 116, { selected: `ev:${edit.id}` }), signalsOf(seed))
    const title = all(tree).find(e => e.type === 'Text' && strings(e).includes(`evidence · event #${edit.seq}`)) as Drawn
    expect(title).toBeDefined()
    const panel = ancestors(tree, title).find(e => e.props.borderStyle === 'round' && e.props.backgroundColor === GLASS.sunken) as Drawn
    expect(panel).toBeDefined()
    expect(ancestors(tree, panel).filter(a => a.props.flexDirection !== 'column').map(a => a.type)).toEqual([])
    const removed = all(tree).find(e => e.type === 'Text' && e.props.color === 'diffRemoved')
    const added = all(tree).find(e => e.type === 'Text' && e.props.color === 'diffAdded')
    expect(strings(removed)).toContain('− exp * 1000 < Date.now()')
    expect(strings(added)).toContain('+ exp * 1000 <= Date.now()')
    expect(removed?.props.mono).toBe(true)
    expect(added?.props.mono).toBe(true)
    const run = seed.events.find(e => e.toolUseId === 'b2') as ForensicEvent
    const runTree = ForensicsView(viewContext(seed, 'desktop', 116, { selected: `ev:${run.id}` }), signalsOf(seed))
    const command = all(runTree).find(e => e.type === 'Text' && e.props.mono === true && strings(e) === 'npm test -- token')
    expect(command).toBeDefined()
    expect(logicalLines(runTree as DrawnNode).join('\n')).toContain('command (test command): npm test -- token')
  })

  test('an empty filter draws the empty state with its glyph, as a sunken glass tile on desktop', () => {
    const seed = collidingSession()
    for (const surface of ['terminal', 'desktop'] as const) {
      const tree = ForensicsView(viewContext(seed, surface, 80, { agentFilter: 'nobody-here' }), signalsOf(seed))
      const line = logicalLines(tree as DrawnNode).find(l => l.includes('No events match these filters.')) ?? ''
      expect(line).toMatch(/^○ No events match these filters\.$/)
      const head = all(tree).find(e => e.type === 'Text' && strings(e).includes('No events match')) as Drawn
      const tile = ancestors(tree, head).at(-1)
      if (surface === 'desktop') expect(tile?.props.backgroundColor).toBe(GLASS.sunken)
      else expect(tile?.props.backgroundColor).toBeUndefined()
    }
  })

  test('the terminal Forensics tree carries no translucent colour, with and without a selected event', () => {
    const seed = collidingSession()
    const edit = seed.events.find(e => e.toolUseId === 'e9') as ForensicEvent
    for (const width of [30, 49, 80, 116]) {
      for (const selected of [undefined, `ev:${edit.id}`]) {
        const tree = ForensicsView(viewContext(seed, 'terminal', width, { selected }), signalsOf(seed))
        const colours = all(tree).flatMap(e => [e.props.color, e.props.backgroundColor, e.props.borderColor]).filter((c): c is string => typeof c === 'string')
        expect(colours.filter(c => ALPHA_COLOUR.test(c))).toEqual([])
      }
    }
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
  test('past 63 agents the Select lists the busiest and says so (the engine refuses more than 64 options)', SLOW, async ($, on) => {
    const seed = crowdedSession(70)
    seededEngine(on, seed)
    const ui = await mountOn($, 'terminal', 116, 'forensics')
    const options = (await ui.find({ key: 'agent-filter' }))?.props.options as Array<{ value: string }>
    expect(options.length).toBe(64)
    expect(options[0]?.value).toBe('all')
    expect((await linesOf(ui)).join('\n')).toMatch(/the 63 agents with the most events here, of 71/)
    await ui.press({ key: 'tab-health' })
    const health = (await linesOf(ui)).join('\n')
    expect(health).toMatch(/show \d+ more entries/)
    const size = treeSize((await ui.drawn()) as DrawnNode)
    expect(size.nodes).toBeLessThanOrEqual(2500)
    await ui.unmount()
  })
})
