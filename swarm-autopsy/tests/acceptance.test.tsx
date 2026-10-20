// Pane-wide acceptance tests (AT-1…AT-24).
// The whole pane is mounted through the engine's own test host with a SIMULATED
// snapshot seeded through `state.get`; every tab, selection and disclosure is
// walked on the terminal and desktop surfaces at several widths, and the drawn
// tree is read as logical lines (tests/view-helpers). These tests define "done"
// for every view.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { compact } from '../hooks/lib/format'
import { applyUsage, buildLedgerView } from '../hooks/lib/ledger'
import { DENOMINATOR_BASIS } from '../hooks/lib/outcome'
import { UNLINKED_TEXT } from '../hooks/lib/trail'
import type { Snapshot, UsageRecord } from '../types'
import { build, spawn, threeAgentSession, tool, turnEnd, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { buttonKeys, logicalLines, treeSize, type DrawnNode, withClients } from './view-helpers'

const PLUGIN = 'swarm-autopsy'
const SESSION = 'session-under-test'
const OPUS_1M = 'claude-opus-5-5[1m]'
/** A model the documented window table does not list: no context window is known for its agent. */
const UNLISTED_MODEL = 'claude-unlisted-9'
const VIEWS = ['live', 'trail', 'collisions', 'forensics', 'spend', 'health'] as const
/** Buttons that select, focus or open something; pressed one by one on every tab. */
const SELECTING = /^(card-|lg-|so-|bk-|node-|sig-|ag-|row-|focus-|lane-|hd-|dc-)/
const MAX_PRESSES_PER_TAB = 40
const NOW = 1_700_000_000_000
/** The walks mount the whole pane many times; they need more than the default time. */
const SLOW = { timeoutMs: 120_000 }

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

// ── SIMULATED fixtures ──

function withLedger(snapshot: Snapshot, records: readonly UsageRecord[]): Snapshot {
  return { ...snapshot, ledger: records.reduce((ledger, record) => applyUsage(ledger, record), snapshot.ledger) }
}

/**
 * The rich session: main and four subagents with real-shaped usage. The explorer asked for main's model (≈% against
 * main's window), the implementer a model no table lists (no % anywhere), the tester claude-haiku-5-5 (≈% against its
 * documented window) with 45 requests (history bounded at 40), the auditor's
 * requests all came back without usage, the reviewer used a model with no price, and a ledger row carries the id
 * `constructor` with no agent record.
 */
function richSession(options: { percent?: number; compaction?: boolean; dropped?: number } = {}): Snapshot {
  const base = build(
    ...threeAgentSession(),
    spawn('auditor', { type: 'docs-auditor', description: 'audit the README', prompt: 'Audit README.md for stale commands.' }),
    turnStart('auditor', 't-aud'),
    ...tool('auditor', 'ra', 'Read', { file_path: '/repo/README.md' }),
    turnEnd('auditor', 't-aud', 'The README lists three commands; two of them no longer exist in package.json scripts.'),
    spawn('reviewer', { type: 'code-reviewer', description: 'review the fix', prompt: 'Review the change to token.ts.' }),
    turnStart('reviewer', 't-rev'),
    ...tool('reviewer', 'rr', 'Read', { file_path: '/repo/src/auth/token.ts' }),
    turnEnd('reviewer', 't-rev', 'Looks correct.'),
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
        requestedModel: UNLISTED_MODEL,
        model: UNLISTED_MODEL,
        stopReason: i === 2 && options.compaction ? 'max_tokens' : 'tool_use',
      }),
    ),
    ...Array.from({ length: 45 }, (_, i) =>
      usageRecord({
        agentId: 'tester',
        turnId: 't',
        index: i,
        at: NOW - 35_000 + i * 100,
        tokens: tokens(5, 2_000, 100, 60),
        requestedModel: 'claude-haiku-5-5',
        model: 'claude-haiku-5-5',
      }),
    ),
    usageRecord({ agentId: 'auditor', turnId: 'a', index: 0, at: NOW - 20_000, tokens: null, requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'auditor', turnId: 'a', index: 1, at: NOW - 19_000, tokens: null, requestedModel: OPUS_1M }),
    usageRecord({
      agentId: 'reviewer',
      turnId: 'r',
      index: 0,
      at: NOW - 10_000,
      tokens: tokens(15, 9_000, 500, 400),
      requestedModel: 'mystery-model-9',
      model: 'mystery-model-9',
    }),
    usageRecord({ agentId: 'constructor', turnId: 'c', index: 0, at: NOW - 5_000, tokens: tokens(7, 3_000, 0, 70), requestedModel: OPUS_1M }),
  ]
  // A session id per variant: the pane memoises its analyses by session, revision and cost setting.
  const snapshot = withLedger({ ...base, sessionId: `${SESSION}#${JSON.stringify(options)}` }, records)
  return {
    ...snapshot,
    context: { window: 1_000_000, tokens: 86_030, ...(options.percent === undefined ? {} : { percent: options.percent }), at: NOW - 1_000 },
    engineCost: { usd: 3.5, at: NOW - 1_000 },
    compactionMarks: options.compaction ? [{ agentId: 'implementer', at: NOW - 38_500, seq: 999, trigger: 'auto', tokensBefore: 41_000 }] : [],
    droppedEvents: options.dropped ?? 0,
  }
}

function emptySession(): Snapshot {
  return { ...build(), sessionId: SESSION }
}

// ── the harness ──

type Screen = { surface: string; width: number; view: string; step: string; lines: string[] }

function seededEngine(on: On, seed: Snapshot) {
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: SESSION }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', ($, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

/** What the walk needs of a mounted pane. */
type Mounted = { drawn: () => Promise<unknown>; press: (args: { key: string }) => Promise<unknown>; unmount: () => Promise<unknown> }

async function screenOf(ui: Mounted, meta: Omit<Screen, 'lines'>): Promise<Screen & { tree: DrawnNode }> {
  const tree = (await ui.drawn()) as DrawnNode
  return { ...meta, lines: logicalLines(tree), tree }
}

/** A Button's label in a drawn tree, by key. */
function labelOf(node: DrawnNode, key: string): string | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (node.type === 'Button' && node.props?.key === key) return String(node.props?.label ?? '')
  for (const child of node.children ?? []) {
    const found = labelOf(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Puts cost display in the wanted state. The pane's UI state outlives a mount within one test, so the toggle is pressed
 * only when its label says the other state is on.
 */
async function setCost(ui: Mounted, showCost: boolean): Promise<void> {
  await ui.press({ key: 'tab-spend' })
  const label = labelOf((await ui.drawn()) as DrawnNode, 'toggle-cost') ?? ''
  const isOn = /hide/.test(label)
  if (isOn !== showCost) await ui.press({ key: 'toggle-cost' })
}

/** Every tab, then every selecting button on it (one at a time), on one surface and width, with cost off or on. */
async function walk($: Engine, surface: 'terminal' | 'desktop', width: number, showCost: boolean): Promise<Screen[]> {
  const ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
  const screens: Screen[] = []
  await setCost(ui, showCost)
  for (const view of VIEWS) {
    await ui.press({ key: `tab-${view}` })
    const first = await screenOf(ui, { surface, width, view, step: 'tab' })
    screens.push(first)
    const keys = buttonKeys(first.tree).filter(k => SELECTING.test(k)).slice(0, MAX_PRESSES_PER_TAB)
    for (const key of keys) {
      const present = buttonKeys((await ui.drawn()) as DrawnNode)
      if (!present.includes(key)) continue
      await ui.press({ key })
      screens.push(await screenOf(ui, { surface, width, view, step: key }))
    }
  }
  await ui.unmount()
  return screens
}

const SURFACE_WIDTHS: ReadonlyArray<['terminal' | 'desktop', number]> = [
  ['terminal', 30],
  ['terminal', 49],
  ['terminal', 80],
  ['terminal', 116],
  ['desktop', 49],
  ['desktop', 116],
]

async function walkAll($: Engine, showCost: boolean, widths = SURFACE_WIDTHS): Promise<Screen[]> {
  const all: Screen[] = []
  for (const [surface, width] of widths) all.push(...(await walk($, surface, width, showCost)))
  return all
}

const where = (s: Screen) => `${s.surface}@${s.width} ${s.view}/${s.step}`
const offenders = (screens: readonly Screen[], bad: (line: string) => boolean) =>
  screens.flatMap(s => s.lines.filter(bad).map(line => `${where(s)}: ${line}`))

// ── the tests ──

const DOLLAR = /\$\d|<\$0\.01/
const FORBIDDEN = /\b(wasted?|useless|lost|ignored|unused|inefficien\w*|more than expected|top contributors?)\b/i
const METRIC = /\d[\d.,]*\s?[kM]?\s?(tok|tokens|req|requests)\b|\d[\d.]*%/
const LABEL = /[●≈∅◆◇?]/
/** Lines exempt from AT-14: tabs and hotkeys, event numbers and clock offsets, pages, the toggle and section labels. */
const EXEMPT = /^\[|^#\d|\+\d+:\d\d|page \d|show ≈\$|hide ≈\$|^▸|^▾|\blast \d+( of \d+)? requests?\b/

describe('acceptance: cost', () => {
  test('AT-1 no $ amount anywhere while cost is hidden, even though the views can carry prices', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false)
    expect(offenders(screens, line => DOLLAR.test(line))).toEqual([])
  })

  test('AT-2 every $ amount is ESTIMATED, and its date, API-equivalent and not-a-charge are on the same screen', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, true)
    const untagged = offenders(screens, line => DOLLAR.test(line) && !line.includes('≈') && !/Claude Code|per million|\/MTok/.test(line))
    expect(untagged).toEqual([])
    const undated = screens
      .filter(s => s.lines.some(l => DOLLAR.test(l)))
      .filter(s => {
        const text = s.lines.join('\n')
        return !text.includes('2026-10-06') || !/API-equivalent/.test(text) || !/not a charge/.test(text)
      })
      .map(where)
    expect(undated).toEqual([])
  })

  test('AT-3 Claude Code’s own figure is drawn apart from the estimate and never summed with it', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const spend = (await walkAll($, true, [['terminal', 116]])).filter(s => s.view === 'spend')
    const text = spend.flatMap(s => s.lines).join('\n')
    expect(text).toMatch(/Claude Code.{0,60}\$3\.50/)
  })

  test('AT-4 an estimate that leaves out an unpriced model is marked partial', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const spend = (await walkAll($, true, [['terminal', 116]])).filter(s => s.view === 'spend')
    expect(spend.some(s => s.lines.some(l => /≈\$[\d.]+\+/.test(l)))).toBe(true)
  })

  test('AT-23 turning cost on changes no token figure', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    // The token figures on each tab's first screen: numbers with a k/M suffix or followed by tok/req, ≈$ runs taken out.
    const FIGURE = /(\d[\d.,]*\s?[kM])\b|(\d[\d.,]*)\s?(?:tok|tokens|req|requests)\b/g
    const figuresOf = (lines: readonly string[]) =>
      lines
        .map(line => line.replace(/≈\s*≈?\s*\$[<\d.,]+\+?/g, ''))
        .flatMap(line => [...line.matchAll(FIGURE)].map(m => m[0]))
        .sort()
    for (const [surface, width] of [['terminal', 116], ['terminal', 49]] as const) {
      const ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
      const tabs = async () => {
        const out: Record<string, string[]> = {}
        for (const view of VIEWS) {
          await ui.press({ key: `tab-${view}` })
          out[view] = figuresOf(logicalLines((await ui.drawn()) as DrawnNode))
        }
        return out
      }
      const off = await tabs()
      await ui.press({ key: 'tab-spend' })
      await ui.press({ key: 'toggle-cost' })
      const costOn = await tabs()
      expect(costOn).toEqual(off)
      await ui.unmount()
    }
  })
})

describe('acceptance: context', () => {
  test('AT-5 no estimated % is drawn for a subagent on another model, and none against an assumed 200k', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false)
    // The implementer asked for a model the documented table does not list while main asked for claude-opus-5-5[1m]:
    // its prompt (150k) would read 15% of 1.0M, and no line may say so.
    expect(offenders(screens, line => /(^|[^\d.])15(\.\d)?%/.test(line))).toEqual([])
    expect(offenders(screens, line => /\/\s?200k|of 200k/.test(line))).toEqual([])
  })

  test('AT-5b a subagent on another documented model shows an ESTIMATED % against that model’s documented window', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false, [['terminal', 116], ['desktop', 116]])
    // The tester asked for claude-haiku-5-5 under an opus main loop: its window comes from the dated model table.
    expect(screens.some(s => s.lines.some(l => l.includes('assumes the documented window for claude-haiku-5-5')))).toBe(true)
  })

  test('AT-6 a same-model subagent’s % is ESTIMATED and its assumption is reachable', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false)
    expect(screens.some(s => s.lines.some(l => /≈\s?[\d.]+%/.test(l)))).toBe(true)
    expect(screens.some(s => s.lines.some(l => l.includes("assumes the main session's window for the same model")))).toBe(true)
  })

  test('AT-7 main’s % is OBSERVED from session.measure, and absent when the reading has no fill', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false, [['terminal', 49], ['terminal', 116]])
    const nine = screens.flatMap(s => s.lines).filter(l => /(^|[^\d.])9(\.0)?%/.test(l))
    expect(nine.length).toBeGreaterThan(0)
    expect(nine.filter(l => !l.includes('●'))).toEqual([])
  })

  test('AT-7b without a fill reading no % is drawn for main', SLOW, async ($, on) => {
    seededEngine(on, richSession({}))
    const screens = await walkAll($, false, [['terminal', 116]])
    expect(offenders(screens, line => /ctx\s+[●≈]?\s*\d[\d.]*%|main context\s+[●≈]\s*\d[\d.]*%/.test(line))).toEqual([])
  })

  test('AT-8 cumulative tokens are never drawn as context', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false)
    // The implementer's three prompts are 150k each; 450k is their sum, never its context.
    expect(offenders(screens, line => /context|ctx/i.test(line) && /\b450k\b/.test(line))).toEqual([])
  })

  test('AT-18a no compaction or context-stop marker is drawn when none was captured', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false)
    expect(offenders(screens, line => /⇊|compacted|max_tokens/.test(line))).toEqual([])
  })

  test('AT-18b a captured compaction and stop reason are drawn, with the missing size said', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9, compaction: true }))
    const screens = await walkAll($, false, [['terminal', 116], ['desktop', 116]])
    const text = screens.flatMap(s => s.lines).join('\n')
    expect(text).toMatch(/compacted|compaction/)
    expect(text).toMatch(/after not captured/)
    expect(text).toMatch(/max_tokens/)
  })
})

describe('acceptance: totals and outcomes', () => {
  test('AT-9/10 the session total is drawn as Σ direct, never as main’s subtree', SLOW, async ($, on) => {
    const seed = richSession({ percent: 9 })
    seededEngine(on, seed)
    const view = buildLedgerView(seed.ledger, seed, { showCost: false })
    const total = compact(view.session.processed)
    const mainSubtree = compact(view.rows.find(r => r.agentId === 'main')?.subtree.processed ?? 0)
    expect(mainSubtree).not.toBe(total)
    const screens = await walkAll($, false, [['terminal', 49], ['terminal', 116]])
    const text = screens.flatMap(s => s.lines).join('\n')
    expect(text).toContain(total)
    expect(offenders(screens, line => /session|total/i.test(line) && line.includes(mainSubtree))).toEqual([])
  })

  test('AT-11 every outcome bucket is drawn, the coordinator and unknown usage included, with the denominator basis', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const spend = (await walkAll($, false, [['terminal', 116]])).filter(s => s.view === 'spend')
    const text = spend.flatMap(s => s.lines).join('\n')
    expect(text).toMatch(/coordinator/)
    expect(text).toMatch(/no usage recorded|usage unknown|unknown usage/)
    expect(text).not.toMatch(/no usage recorded[^\n]*\b0(\.0)?%/)
    expect(text).toContain(DENOMINATOR_BASIS)
  })

  test('AT-13 no drawn text on any tab judges the work', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9, compaction: true }))
    const screens = await walkAll($, true)
    expect(offenders(screens, line => FORBIDDEN.test(line))).toEqual([])
  })

  test('AT-14 every metric number carries a measure label on its line', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, true, [['terminal', 49], ['terminal', 116], ['desktop', 116]])
    expect(offenders(screens, line => METRIC.test(line) && !LABEL.test(line) && !EXEMPT.test(line.trim()))).toEqual([])
  })

  test('AT-17 an unlinked report states the exact unlinked text when selected', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false, [['terminal', 116]])
    expect(screens.some(s => s.lines.some(l => l.includes(UNLINKED_TEXT)))).toBe(true)
  })

  test('AT-19 usage that came back without counts is never drawn as an observed zero', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = await walkAll($, false)
    expect(offenders(screens, line => /●\s*(in\s+)?0(\s|$)|●\s*0 tok|direct 0 tok/.test(line))).toEqual([])
  })

  test('AT-20 bounded figures say so: dropped events and requests past the kept history', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9, dropped: 3 }))
    const screens = await walkAll($, false, [['terminal', 116]])
    const text = screens.flatMap(s => s.lines).join('\n')
    expect(text).toMatch(/dropped from the timeline/)
    expect(text).toMatch(/last \d+ of \d+|not kept/)
  })
})

describe('acceptance: structure', () => {
  test('AT-21 the one-line legend names every label on every tab', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9 }))
    const screens = (await walkAll($, false)).filter(s => s.step === 'tab')
    const missing = screens.filter(s => !s.lines.some(l => ['●', '◆', '◇', '?', '∅', '≈'].every(g => l.includes(g)))).map(where)
    expect(missing).toEqual([])
  })

  test('AT-22 an empty session draws no agent, no ring and no number from the concepts', SLOW, async ($, on) => {
    seededEngine(on, emptySession())
    const screens = await walkAll($, false)
    expect(offenders(screens, line => /Explorer|Implementer|Claude 3\.5|\$12\.48|1\.2M|172 events/.test(line))).toEqual([])
    // No chart and no ring: the one picture allowed is the scene at the top, and it shows nothing measured (no context
    // reading, no subagent figure).
    const pictures = screens.flatMap(s => s.lines.flatMap(l => l.match(/\[svg: [^\]]*\]/g) ?? []))
    expect(pictures.length).toBeGreaterThan(0)
    expect(pictures.filter(p => !/^\[svg: [A-Za-z ]+: [^\]]* Main context —, shown as [^\]]*; no [a-z' -]+s: no subagent is active\.\]$/.test(p))).toEqual([])
  })

  test('every tab mounts within the tree budget on both surfaces', SLOW, async ($, on) => {
    seededEngine(on, richSession({ percent: 9, compaction: true, dropped: 3 }))
    const over: string[] = []
    for (const [surface, width] of SURFACE_WIDTHS) {
      const ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
      for (const view of VIEWS) {
        await ui.press({ key: `tab-${view}` })
        const size = treeSize((await ui.drawn()) as DrawnNode)
        if (size.depth > 20 || size.nodes > 2500) over.push(`${surface}@${width} ${view}: depth ${size.depth}, ${size.nodes} nodes`)
      }
      await ui.unmount()
    }
    expect(over).toEqual([])
  })
})
