// The Spend tab: session block, ledger table, largest token use, spend vs
// outcome, and the two agent details the Live inspector also calls. SIMULATED
// fixtures only. Views are drawn with a plain-data element table and read as
// logical lines (tests/view-helpers); the last block mounts the whole pane
// through the engine's test host, so a prop the surface refuses fails here on
// both surfaces.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { analyzeCollisions } from '../hooks/lib/collisions'
import { BUCKET_WORDS, compact } from '../hooks/lib/format'
import { applyUsage, buildLedgerView } from '../hooks/lib/ledger'
import { BUCKET_MEANING, DENOMINATOR_BASIS, buildSpendOutcome } from '../hooks/lib/outcome'
import { BUCKET_ROLE, GLASS, ROLE, TOKEN_CATEGORIES, withAlpha } from '../hooks/lib/palette'
import { gatherSignals } from '../hooks/lib/signals'
import { applyTheme, themeFor } from '../hooks/lib/themes'
import { UNLINKED_TEXT, buildTrail } from '../hooks/lib/trail'
import type { ViewContext } from '../hooks/ui/common'
import { layoutFor } from '../hooks/ui/kit'
import { AgentLedgerDetail } from '../hooks/ui/ledger'
import { AgentOutcomeDetail } from '../hooks/ui/outcome'
import type { Analyses } from '../hooks/ui/pane'
import { SpendView } from '../hooks/ui/spend'
import type { Snapshot, UiState, UsageRecord } from '../types'
import { build, spawn, threeAgentSession, tool, turnEnd, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { NOOP_ACTIONS, buttonKeys, inline, logicalLines, treeSize, type DrawnNode, withClients } from './view-helpers'

const NOW = 1_700_000_000_000
const OPUS_1M = 'claude-opus-5-5[1m]'

// ── SIMULATED fixtures ──

function withLedger(snapshot: Snapshot, records: readonly UsageRecord[]): Snapshot {
  return { ...snapshot, ledger: records.reduce((ledger, record) => applyUsage(ledger, record), snapshot.ledger) }
}

/**
 * Main and five subagents (the acceptance suite's shape): the auditor's requests all came back without usage, the
 * reviewer answered with a model that has no price (unless `priced`), and a ledger row carries the id `constructor`
 * with no agent record. The session directory is /repo, so paths under it display relative.
 */
function richSession(options: { priced?: boolean } = {}): Snapshot {
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
  const reviewerModel = options.priced ? 'claude-opus-5-5' : 'mystery-model-9'
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
        requestedModel: 'claude-sonnet-5-5',
        model: 'claude-sonnet-5-5',
      }),
    ),
    ...Array.from({ length: 45 }, (_, i) =>
      usageRecord({ agentId: 'tester', turnId: 't', index: i, at: NOW - 35_000 + i * 100, tokens: tokens(5, 2_000, 100, 60), requestedModel: OPUS_1M }),
    ),
    usageRecord({ agentId: 'auditor', turnId: 'a', index: 0, at: NOW - 20_000, tokens: null, requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'auditor', turnId: 'a', index: 1, at: NOW - 19_000, tokens: null, requestedModel: OPUS_1M }),
    usageRecord({ agentId: 'reviewer', turnId: 'r', index: 0, at: NOW - 10_000, tokens: tokens(15, 9_000, 500, 400), requestedModel: reviewerModel, model: reviewerModel }),
    usageRecord({ agentId: 'constructor', turnId: 'c', index: 0, at: NOW - 5_000, tokens: tokens(7, 3_000, 0, 70), requestedModel: OPUS_1M }),
  ]
  const snapshot = withLedger({ ...base, cwd: '/repo' }, records)
  return { ...snapshot, engineCost: { usd: 3.5, at: NOW - 1_000 } }
}

/** The figures the fixture's ledger gives (exact arithmetic over the records above). */
const SESSION_TOTAL = 795_657
const MAIN_DIRECT = 156_170
const MAIN_SUBTREE = SESSION_TOTAL - 3_077

// ── drawing with a plain-data element table ──

type Calls = { toggleFocus: string[]; focus: Array<string | undefined>; select: Array<string | undefined>; toggleOpen: string[]; toggleCost: number; open: string[]; node: string[] }

type Draw = { focus?: string; selected?: string; open?: string[]; showCost?: boolean; surface?: 'terminal' | 'desktop' }

function analysesFor(snapshot: Snapshot, priced: boolean): Analyses {
  const trail = buildTrail(snapshot)
  const ledger = buildLedgerView(snapshot.ledger, snapshot, { showCost: priced, engineCostUsd: snapshot.engineCost?.usd })
  const collisions = analyzeCollisions(snapshot)
  const spend = buildSpendOutcome(snapshot, trail, ledger)
  return { trail, collisions, ledger, spend, health: gatherSignals({ snapshot, trail, collisions, ledger, spend }), prices: {} }
}

function stub(snapshot: Snapshot, width: number, draw: Draw = {}) {
  const calls: Calls = { toggleFocus: [], focus: [], select: [], toggleOpen: [], toggleCost: 0, open: [], node: [] }
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const ui: UiState = {
    view: 'spend',
    filter: 'all',
    page: 0,
    ...(draw.showCost ? { showCost: true } : {}),
    ...(draw.focus !== undefined ? { focus: draw.focus } : {}),
    ...(draw.selected !== undefined ? { selected: draw.selected } : {}),
    ...(draw.open ? { open: draw.open } : {}),
  }
  const ctx: ViewContext = {
    els: { Box: element('Box'), Text: element('Text'), Button: element('Button') } as unknown as ViewContext['els'],
    surface: draw.surface ?? 'terminal',
    width,
    rows: 60,
    layout: layoutFor(width),
    now: NOW,
    snapshot,
    ui,
    act: {
      ...NOOP_ACTIONS,
      toggleFocus: id => calls.toggleFocus.push(id),
      focus: id => calls.focus.push(id),
      select: id => calls.select.push(id),
      toggleOpen: id => calls.toggleOpen.push(id),
      toggleCost: () => {
        calls.toggleCost += 1
      },
      openEvent: id => calls.open.push(id),
      showNode: id => calls.node.push(id),
    },
  }
  return { ctx, calls }
}

type Screen = { tree: DrawnNode; lines: string[]; text: string; keys: string[]; calls: Calls; press: (key: string) => void }

function screenOf(tree: unknown, calls: Calls): Screen {
  const node = tree as DrawnNode
  const lines = logicalLines(node)
  const press = (key: string) => {
    const found = findButton(node, key)
    if (!found) throw new Error(`no button ${key}`)
    ;(found.props?.onPress as () => void)()
  }
  return { tree: node, lines, text: lines.join('\n'), keys: buttonKeys(node), calls, press }
}

function findButton(node: DrawnNode, key: string): { props?: Record<string, unknown> } | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (node.type === 'Button' && node.props?.key === key) return node
  const fromProps = node.props?.children
  const kids = Array.isArray(node.children) ? node.children : Array.isArray(fromProps) ? (fromProps as DrawnNode[]) : fromProps === undefined ? [] : [fromProps as DrawnNode]
  for (const child of kids) {
    const hit = findButton(child, key)
    if (hit) return hit
  }
  return undefined
}

/** The Spend tab as drawn; `priced` builds the views with prices whatever `showCost` says. */
function spend(snapshot: Snapshot, width: number, draw: Draw = {}, priced = draw.showCost === true): Screen {
  const { ctx, calls } = stub(snapshot, width, draw)
  return screenOf(SpendView(ctx, analysesFor(snapshot, priced)), calls)
}

const DOLLAR = /\$\d|<\$0\.01/
const METRIC = /\d[\d.,]*\s?[kM]?\s?(tok|tokens|req|requests)\b|\d[\d.]*%/
const LABEL = /[●≈∅◆◇?]/
const EXEMPT = /^\[|^#\d|\+\d+:\d\d|page \d|show ≈\$|hide ≈\$|^▸|^▾|\blast \d+( of \d+)? requests?\b/
const OBSERVED_ZERO = /●\s*(in\s+)?0(\s|$)|●\s*0 tok|direct 0 tok/
const FORBIDDEN = /\b(wasted?|useless|lost|ignored|unused|inefficien\w*|more than expected|top contributors?)\b/i

const ALL_OPEN = ['spend-prices', 'spend-notes', 'spend-basis', 'spend-meanings']
const AGENTS = ['main', 'explorer', 'implementer', 'tester', 'auditor', 'reviewer', 'constructor']
const indexOfLine = (lines: readonly string[], re: RegExp) => lines.findIndex(l => re.test(l))

// ── session block ──

describe('Spend · session block', () => {
  test('the session total is drawn first, observed, with its token bar, legend and requests', () => {
    const s = spend(richSession(), 116)
    expect(s.text).toMatch(/● 796k tokens processed · 54 requests with usage · 2 without usage/)
    expect(s.lines.some(l => /^█{20,}$/.test(l))).toBe(true)
    expect(s.text).toContain('● ■ in 387 · ■ cache read 732k · ■ cache write 55k · ■ out 8.3k')
    expect(s.text).toContain("The session total is the sum of every row's direct usage")
    expect(indexOfLine(s.lines, /796k tokens processed/)).toBeLessThan(indexOfLine(s.lines, /◎ main/))
    expect(s.keys).toContain('toggle-cost')
  })

  test('the session total is Σ direct, never main’s spawn tree, on any line naming the session or a total', () => {
    expect(compact(MAIN_SUBTREE)).not.toBe(compact(SESSION_TOTAL))
    for (const width of [30, 49, 80, 116]) {
      const s = spend(richSession(), width, { showCost: true, open: ALL_OPEN, focus: 'main', selected: 'bk:coordinator' })
      expect(s.text).toContain(compact(SESSION_TOTAL))
      expect(s.lines.filter(l => /session|total/i.test(l) && l.includes(compact(MAIN_SUBTREE)))).toEqual([])
    }
  })

  test('with cost off no $ amount, date, assumption or engine figure is drawn', () => {
    for (const width of [30, 49, 80, 116]) {
      const s = spend(richSession(), width, { open: ALL_OPEN, focus: 'implementer', selected: 'bk:verified' })
      expect(s.lines.filter(l => DOLLAR.test(l))).toEqual([])
      expect(s.text).not.toContain('2026-10-06')
      expect(s.text).toContain('[show ≈$ estimates]')
    }
  })

  test('with cost on: ≈$ dated, API-equivalent and not a charge, partial marked +, Claude Code’s own figure apart', () => {
    const s = spend(richSession(), 116, { showCost: true })
    const costLine = s.lines.find(l => /≈\$[\d.]+\+/.test(l) && l.includes('API-equivalent at 2026-10-06 prices, not a charge')) ?? ''
    expect(costLine).toContain('leaves out mystery-model-9 (no price)')
    const engine = s.lines.find(l => l.includes("Claude Code's own session figure $3.50")) ?? ''
    expect(engine).toContain('●')
    expect(engine).not.toContain('≈')
    expect(s.text).toContain('This estimate is below Claude Code’s own figure')
    expect(s.lines.filter(l => l.includes('This estimate is') && DOLLAR.test(l))).toEqual([])
    expect(s.text).toContain('[hide ≈$ estimates]')
  })

  test('assumptions and the cache-write rule sit behind a disclosure that exists only with cost on', () => {
    const closed = spend(richSession(), 116, { showCost: true })
    expect(closed.keys).toContain('dc-spend-prices')
    expect(closed.text).not.toContain('1.25× input')
    const open = spend(richSession(), 116, { showCost: true, open: ['spend-prices'] })
    expect(open.text).toContain('1.25× input')
    expect(open.text).toContain('Cache writes: the main loop at the')
    expect(open.text).toContain('Not a charge or a subscription cost')
    expect(spend(richSession(), 116).keys).not.toContain('dc-spend-prices')
  })

  test('the toggle acts through ctx.act', () => {
    const s = spend(richSession(), 49)
    s.press('toggle-cost')
    expect(s.calls.toggleCost).toBe(1)
  })

  test('an empty session says nothing was recorded and draws no figure', () => {
    const s = spend({ ...build(), sessionId: 'empty' }, 49)
    expect(s.text).toContain('No token usage recorded yet')
    expect(s.lines.filter(l => OBSERVED_ZERO.test(l))).toEqual([])
    expect(s.text).not.toMatch(/\d+(\.\d)?%/)
    expect(s.keys).toContain('toggle-cost')
  })
})

// ── ledger table ──

describe('Spend · ledger table', () => {
  test('wide: a header, the session total row first, one row per agent with every category and its bucket', () => {
    const s = spend(richSession(), 116)
    const header = s.lines.find(l => /\bin\b.*cache read.*cache write.*\bout\b.*total.*req.*outcome/.test(l))
    expect(header).toBeDefined()
    const sessionRow = indexOfLine(s.lines, /Σ session/)
    const mainRow = indexOfLine(s.lines, /◎ main.*●/)
    expect(sessionRow).toBeGreaterThan(-1)
    expect(sessionRow).toBeLessThan(mainRow)
    expect(s.lines[sessionRow]).toMatch(/387.*732k.*55k.*8\.3k.*796k.*54/)
    expect(s.lines[mainRow]).toMatch(/● +70 +140k +14k +2\.1k +156k +2 .*coordinator/)
    for (const id of AGENTS) expect(s.keys).toContain(`lg-${id}`)
  })

  test('the spawn tree is a dim second line under an agent with descendants, labelled as overlapping', () => {
    const s = spend(richSession(), 116)
    const mainRow = indexOfLine(s.lines, /◎ main.*●/)
    expect(s.lines[mainRow + 1]).toMatch(/spawn tree \(overlaps\) ● 793k · 6 agents/)
    expect(s.lines.filter(l => l.includes('spawn tree'))).toHaveLength(1)
  })

  test('an agent whose requests all returned no usage reads as unknown, never as observed zeros', () => {
    for (const width of [30, 49, 80, 116]) {
      const s = spend(richSession(), width, { open: ALL_OPEN, focus: 'auditor', selected: 'bk:no-usage-recorded' })
      expect(s.text).toContain('∅ usage unknown (2 requests without usage)')
      expect(s.lines.filter(l => OBSERVED_ZERO.test(l))).toEqual([])
    }
  })

  test('compact: chip, total and a mini token bar per row, categories only once the agent is focused', () => {
    const s = spend(richSession(), 49)
    const explorer = s.lines.find(l => /^▸ +A +● +78k █+$/.test(l))
    expect(explorer).toBeDefined()
    expect(s.text).not.toContain('cache read 70,000')
    const focused = spend(richSession(), 49, { focus: 'explorer' })
    expect(focused.text).toContain('● ■ in 40 · ■ cache read 70,000 · ■ cache write 6,000 · ■ out 1,500')
    expect(focused.lines.some(l => /^▾ +A +● +78k/.test(l))).toBe(true)
  })

  test('a row focuses its agent pane-wide; the focused agent’s ledger and outcome details open under its row', () => {
    const s = spend(richSession(), 80)
    s.press('lg-explorer')
    expect(s.calls.toggleFocus).toEqual(['explorer'])
    const focused = spend(richSession(), 80, { focus: 'explorer' })
    const row = indexOfLine(focused.lines, /^▾ .*A/)
    const ledger = indexOfLine(focused.lines, /^· ledger · /)
    const outcome = indexOfLine(focused.lines, /^· outcome · /)
    const next = indexOfLine(focused.lines, /^▸ .*B/)
    expect(row).toBeGreaterThan(-1)
    expect(ledger).toBeGreaterThan(row)
    expect(outcome).toBeGreaterThan(ledger)
    expect(next).toBeGreaterThan(outcome)
  })

  test('wide: the two details sit side by side under the focused row', () => {
    const s = spend(richSession(), 116, { focus: 'explorer' })
    expect(s.lines.some(l => l.includes('· ledger ·') && l.includes('· outcome ·'))).toBe(true)
  })

  test('cost on adds a ≈$ column without changing any token figure', () => {
    const figures = (lines: readonly string[]) =>
      lines
        .map(l => l.replace(/≈\s*≈?\s*\$[<\d.,]+\+?/g, ''))
        .flatMap(l => [...l.matchAll(/(\d[\d.,]*\s?[kM])\b|(\d[\d.,]*)\s?(?:tok|tokens|req|requests)\b/g)].map(m => m[0]))
        .sort()
    for (const width of [49, 116]) {
      const off = spend(richSession(), width)
      const on = spend(richSession(), width, { showCost: true })
      expect(figures(on.lines)).toEqual(figures(off.lines))
      expect(on.lines.filter(l => /◎ main/.test(l) && /≈\$/.test(l)).length).toBeGreaterThan(0)
    }
  })

  test('ids named like Object.prototype members keep their own row, chip and focus', () => {
    for (const id of ['constructor', '__proto__', 'toString']) {
      const snapshot = withLedger(build(spawn('a')), [
        usageRecord({ agentId: 'main', turnId: 'm', tokens: tokens(10, 0, 0, 0) }),
        usageRecord({ agentId: 'a', turnId: 'a', tokens: tokens(20, 0, 0, 0) }),
        usageRecord({ agentId: id, turnId: 'x', tokens: tokens(70, 0, 0, 0) }),
      ])
      const s = spend(snapshot, 116)
      expect(s.keys).toContain(`lg-${id}`)
      s.press(`lg-${id}`)
      expect(s.calls.toggleFocus).toEqual([id])
      const focused = spend(snapshot, 116, { focus: id })
      expect(focused.text).toContain('never seen as an agent')
      expect(focused.text).toContain('Usage only: no agent record')
      expect(focused.text).toContain('● 70 tokens processed')
    }
  })
})

// ── largest token use ──

describe('Spend · largest token use', () => {
  const section = (s: Screen) => {
    const from = indexOfLine(s.lines, /largest token use/)
    const to = indexOfLine(s.lines, /spend vs outcome/)
    return s.lines.slice(from, to)
  }

  test('direct usage per agent, largest first, as a share of the session total; never the spawn tree', () => {
    for (const width of [49, 116]) {
      const lines = section(spend(richSession(), width))
      const order = ['452k · 57%', '156k · 20%', '97k · 12%', '78k · 9.7%', '9.9k · 1.2%', '3.1k · 0.4%'].map(f => indexOfLine(lines, new RegExp(`● ${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)))
      expect(order.every(i => i > 0)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(lines.join('\n')).not.toContain(compact(MAIN_SUBTREE))
      expect(lines.join('\n')).toContain('∅ usage unknown')
      expect(lines.join('\n')).not.toMatch(FORBIDDEN)
    }
  })

  test('≈$ bars only with cost on and every estimate complete; never mixed with token shares', () => {
    const partial = section(spend(richSession(), 116, { showCost: true }))
    expect(partial.join('\n')).toContain('≈$ bars are drawn only when every model has a price')
    const complete = section(spend(richSession({ priced: true }), 116, { showCost: true }))
    const costBars = complete.filter(l => /█/.test(l) && /≈\$/.test(l))
    expect(costBars.length).toBeGreaterThan(0)
    expect(costBars.filter(l => /%/.test(l))).toEqual([])
    expect(complete.join('\n')).toContain('API-equivalent at 2026-10-06 prices, not a charge')
    expect(section(spend(richSession({ priced: true }), 116)).join('\n')).not.toContain('≈$')
  })
})

// ── spend vs outcome ──

describe('Spend · spend vs outcome', () => {
  test('a 100% bar of every bucket, the unknown usage drawn ░, the denominator stated and its basis reachable', () => {
    const s = spend(richSession(), 116)
    const bar = s.lines.find(l => /^█+ ░+$/.test(l.replace(/[^█░ ]/g, '')) && l.includes('░'))
    expect(bar).toBeDefined()
    expect(s.text).toMatch(/● 796k tokens processed = 100%/)
    expect(s.text).not.toContain(DENOMINATOR_BASIS)
    expect(s.keys).toContain('dc-spend-basis')
    expect(spend(richSession(), 116, { open: ['spend-basis'] }).text).toContain(DENOMINATOR_BASIS)
  })

  test('one selectable row per bucket, the coordinator and no-usage included; unknown is never 0%', () => {
    const snapshot = richSession()
    const outcome = analysesFor(snapshot, false).spend
    const s = spend(snapshot, 116)
    expect(outcome.buckets.map(b => b.bucket)).toEqual(['coordinator', 'verified', 'report-only', 'unresolved', 'no-usage-recorded'])
    for (const bucket of outcome.buckets) expect(s.keys).toContain(`bk-${bucket.bucket}`)
    expect(s.text).toMatch(/coordinator · 1 agent · ● 156k · 20%/)
    expect(s.text).toMatch(/verified · 2 agents · ● 549k · 69%/)
    const unknown = s.lines.find(l => l.includes('no usage recorded · 1 agent')) ?? ''
    expect(unknown).toContain('∅ usage unknown (2 requests without usage)')
    expect(unknown).not.toMatch(/\b0(\.0)?%/)
    expect(s.text).toContain('none in: changed, unverified · failed or inconclusive · mixed')
  })

  test('selecting a bucket lists its agents and their contributions’ evidence; an agent there focuses it', () => {
    const s = spend(richSession(), 80)
    s.press('bk-verified')
    expect(s.calls.select).toEqual(['bk:verified'])
    const open = spend(richSession(), 80, { selected: 'bk:verified' })
    expect(open.keys).toContain('so-implementer')
    expect(open.keys).toContain('so-tester')
    expect(open.keys).not.toContain('so-explorer')
    expect(open.lines.some(l => /^[◇◆●] verified · /.test(l.trim()))).toBe(true)
    open.press('so-tester')
    expect(open.calls.toggleFocus).toEqual(['tester'])
    open.press('bk-verified')
    expect(open.calls.select).toEqual([undefined])
  })

  test('bucket meanings sit behind a disclosure', () => {
    const closed = spend(richSession(), 116)
    expect(closed.text).not.toContain(BUCKET_MEANING.verified)
    const open = spend(richSession(), 116, { open: ['spend-meanings'] })
    for (const bucket of ['coordinator', 'verified', 'report-only', 'unresolved', 'no-usage-recorded'] as const) {
      expect(open.text).toContain(BUCKET_MEANING[bucket])
    }
  })

  test('bucket ≈$ appears only with cost on, once tagged, never doubled', () => {
    const on = spend(richSession(), 116, { showCost: true, selected: 'bk:verified', focus: 'implementer', open: ALL_OPEN })
    expect(on.lines.some(l => /verified · 2 agents .*≈\$/.test(l))).toBe(true)
    expect(on.lines.filter(l => /≈\s*≈|≈ \$/.test(l))).toEqual([])
  })
})

// ── the two details (also the Live inspector's) ──

describe('AgentLedgerDetail and AgentOutcomeDetail', () => {
  const detail = (id: string, width: number, draw: Draw = {}, priced = draw.showCost === true) => {
    const snapshot = richSession()
    const analyses = analysesFor(snapshot, priced)
    const { ctx, calls } = stub(snapshot, width, draw)
    const row = analyses.ledger.rows.find(r => r.agentId === id)
    const agent = analyses.spend.agents.find(a => a.agentId === id)
    return {
      ledger: screenOf(AgentLedgerDetail(ctx, row, draw.showCost === true), calls),
      outcome: screenOf(AgentOutcomeDetail(ctx, agent, analyses.trail), calls),
    }
  }

  test('the ledger detail states attribution once, the categories once and one request table', () => {
    const { ledger, outcome } = detail('tester', 116)
    expect(ledger.lines[0]).toMatch(/^· ledger · /)
    expect(ledger.text).toContain('turn.step carried agentId tester')
    expect(ledger.text).toContain('● ■ in 225 · ■ cache read 90,000 · ■ cache write 4,500 · ■ out 2,700')
    expect(ledger.text).toMatch(/last 8 of 45 requests/)
    expect(ledger.text).toMatch(/not kept here/)
    expect(ledger.lines.filter(l => l.includes('t:44'))).toHaveLength(1)
    const both = `${ledger.text}\n${outcome.text}`
    expect(both.split('turn.step carried agentId tester').length - 1).toBe(1)
    expect(both.split('cache read 90,000').length - 1).toBe(1)
    expect(outcome.text).not.toMatch(/last \d+ of/)
  })

  test('no usage at all reads ∅ usage unknown in both details', () => {
    const { ledger, outcome } = detail('auditor', 49)
    expect(ledger.text).toContain('∅ usage unknown (2 requests without usage)')
    expect(outcome.text).toContain('∅ usage unknown (2 requests without usage)')
    for (const s of [ledger, outcome]) expect(s.lines.filter(l => OBSERVED_ZERO.test(l))).toEqual([])
  })

  test('an unlinked report states its unlinked text once, with its evidence label and a way to the Trail', () => {
    const { outcome } = detail('auditor', 80)
    expect(outcome.text.split(UNLINKED_TEXT).length - 1).toBe(1)
    expect(outcome.lines.some(l => l.startsWith('? UNRESOLVED report only · '))).toBe(true)
    expect(outcome.keys.some(k => k.startsWith('od-tr-'))).toBe(true)
  })

  test('a priced view with cost hidden draws no $ anywhere, in either detail or on the tab', () => {
    for (const id of AGENTS) {
      const { ledger, outcome } = detail(id, 80, { showCost: false }, true)
      expect([...ledger.lines, ...outcome.lines].filter(l => DOLLAR.test(l))).toEqual([])
    }
    for (const width of [30, 49, 80, 116]) {
      for (const focus of AGENTS) {
        const s = spend(richSession(), width, { showCost: false, focus, selected: 'bk:verified', open: ALL_OPEN }, true)
        expect(s.lines.filter(l => DOLLAR.test(l))).toEqual([])
      }
    }
  })

  test('with cost on the outcome detail’s ≈$ is drawn once through CostText, dated and not a charge', () => {
    const { outcome } = detail('implementer', 80, { showCost: true })
    const line = outcome.lines.find(l => /≈\$/.test(l)) ?? ''
    expect(line).toContain('API-equivalent at 2026-10-06 prices, not a charge')
    expect(outcome.lines.filter(l => /≈\s*≈|≈ \$/.test(l))).toEqual([])
  })

  test('outcome edges name their targets by display path, and evidence opens events and the trail', () => {
    const { outcome } = detail('tester', 116)
    expect(outcome.text).toContain('B changed src/auth/token.ts')
    expect(outcome.text).not.toContain('changed /repo/')
    const event = outcome.keys.find(k => k.startsWith('od-'))
    expect(event).toBeDefined()
    outcome.press(event ?? '')
    expect(outcome.calls.open.length + outcome.calls.node.length).toBe(1)
    const trailKey = outcome.keys.find(k => k.startsWith('od-tr-'))
    expect(trailKey).toBeDefined()
    outcome.press(trailKey ?? '')
    expect(outcome.calls.node.length).toBeGreaterThan(0)
  })

  test('an agent with nothing recorded draws its gap, not a crash', () => {
    const snapshot = build(spawn('idle'))
    const analyses = analysesFor(snapshot, true)
    const { ctx } = stub(snapshot, 30, { showCost: true })
    const text = logicalLines(AgentLedgerDetail(ctx, analyses.ledger.rows.find(r => r.agentId === 'idle'), true) as DrawnNode).join('\n')
    expect(text).toContain('no turn.step heard for this agent')
    expect(text).toContain('∅ usage unknown (no request heard)')
    expect(logicalLines(AgentLedgerDetail(ctx, undefined, true) as DrawnNode).join('\n')).toContain('no ledger row')
    expect(logicalLines(AgentOutcomeDetail(ctx, undefined, analyses.trail) as DrawnNode).join('\n').length).toBeGreaterThan(0)
  })
})

// ── ledger notes ──

describe('Spend · ledger notes', () => {
  test('notes that change how to read the figures stay visible; the rest sit behind a disclosure titled with their count', () => {
    const s = spend(richSession(), 116)
    expect(s.text).toContain('never seen as an agent')
    expect(s.text).toContain('When token counting began is unknown')
    expect(s.text).not.toContain('resolved with no usage')
    expect(s.lines.some(l => /^▸ 2 more ledger notes$/.test(l))).toBe(true)
    const open = spend(richSession(), 116, { open: ['spend-notes'] })
    const counted = open.lines.find(l => l.includes('2 requests resolved with no usage')) ?? ''
    expect(counted).toMatch(LABEL)
  })
})

// ── the desktop drawing ──

type El = Exclude<DrawnNode, string | number | boolean | null | undefined>
const isEl = (node: DrawnNode): node is El => node !== null && typeof node === 'object'

function kidsOf(node: El): DrawnNode[] {
  const fromProps = node.props?.children
  const list = Array.isArray(node.children) ? node.children : Array.isArray(fromProps) ? fromProps : fromProps === undefined ? [] : [fromProps]
  return (list as unknown[]).flat(8) as DrawnNode[]
}

function everyEl(node: DrawnNode, out: El[] = []): El[] {
  if (!isEl(node)) return out
  out.push(node)
  for (const child of kidsOf(node)) everyEl(child, out)
  return out
}

const byKey = (root: DrawnNode, key: string): El | undefined => everyEl(root).find(el => el.props?.key === key)
const textIn = (node: DrawnNode): string => logicalLines(node).join('\n')
const isBox = (el: El) => el.type === 'Box'
const bordered = (el: El) => isBox(el) && el.props?.borderStyle === 'round'
/** A table's figure columns: the right-aligned cells. */
const figureCells = (row: DrawnNode) => everyEl(row).filter(el => isBox(el) && el.props?.justifyContent === 'flex-end')
const TOKEN_HEX = TOKEN_CATEGORIES.map(c => c.hex)
const desk = (snapshot: Snapshot, width: number, draw: Draw = {}) => spend(snapshot, width, { ...draw, surface: 'desktop' })

describe('Spend · glass: the session hero tile', () => {
  test('desktop: the total sits in a raised glass tile, with a Box token bar, legend pills with exact figures, the requests and the toggle', () => {
    const s = desk(richSession(), 116)
    const hero = byKey(s.tree, 'sp-hero')
    expect(hero?.props?.borderStyle).toBe('round')
    expect(hero?.props?.backgroundColor).toBe(GLASS.raised)
    const els = everyEl(hero)
    const big = els.find(el => el.type === 'Text' && el.props?.size === 'title')
    expect(textIn(big)).toBe('796k')
    expect(big?.props?.mono).toBe(true)
    // The bar: one Box segment per category in its fixed hex, never block text.
    expect(els.filter(el => isBox(el) && TOKEN_HEX.includes(String(el.props?.backgroundColor))).length).toBe(4)
    expect(textIn(hero)).not.toContain('█')
    // The legend: one ● for the line, a pill per category with its exact count.
    const pills = els.filter(el => bordered(el) && el !== hero).map(textIn)
    for (const want of ['■ in 387', '■ cache read 732,000', '■ cache write 55,000', '■ out 8,270']) expect(pills).toContain(want)
    const lines = logicalLines(hero)
    expect(lines.some(l => l.startsWith('● ■ in 387 ■ cache read 732,000'))).toBe(true)
    expect(lines).toContain('● 54 requests with usage · 2 without usage')
    expect(textIn(hero)).toContain("The session total is the sum of every row's direct usage")
    // Reading notes stay visible, in the hero, in the housekeeping colour (not the estimate amber).
    const note = els.find(el => el.type === 'Text' && inline(el).includes('never seen as an agent'))
    expect(note?.props?.color).toBe(ROLE.neutral)
    expect(buttonKeys(hero)).toContain('toggle-cost')
  })

  test('desktop: with cost on, ≈$ sits in its own amber sub-tile, dated, API-equivalent and not a charge; Claude Code’s own figure apart', () => {
    const s = desk(richSession(), 116, { showCost: true })
    const hero = byKey(s.tree, 'sp-hero')
    const estimate = byKey(hero, 'sp-cost-est')
    const own = byKey(hero, 'sp-cost-cc')
    // A glass edge tinted by the caution colour (a scene's hex takes the edge's alpha).
    expect(estimate?.props?.borderColor).toBe(withAlpha(ROLE.caution, '99'))
    const est = textIn(estimate)
    expect(est).toMatch(/≈\$[\d.]+\+/)
    expect(est).toContain('API-equivalent at 2026-10-06 prices, not a charge')
    expect(est).toContain('leaves out mystery-model-9 (no price)')
    expect(est).not.toContain('Claude Code')
    const engine = textIn(own)
    expect(engine).toContain("● Claude Code's own session figure $3.50")
    expect(engine).not.toContain('≈')
    expect(everyEl(estimate)).not.toContain(own)
    expect(everyEl(own)).not.toContain(estimate)
    expect(s.lines.filter(l => DOLLAR.test(l) && !l.includes('≈') && !l.includes('Claude Code'))).toEqual([])
    // With cost off neither sub-tile exists.
    expect(byKey(desk(richSession(), 116).tree, 'sp-cost-est')).toBeUndefined()
  })

  test('terminal: the hero is a round-bordered tile with no fill from medium up, and plain lines in the compact layout', () => {
    const wide = spend(richSession(), 116)
    const hero = byKey(wide.tree, 'sp-hero')
    expect(hero?.props?.borderStyle).toBe('round')
    expect(hero?.props?.backgroundColor).toBeUndefined()
    expect(logicalLines(hero).some(l => /^█{20,}$/.test(l))).toBe(true)
    const narrow = spend(richSession(), 49)
    expect(everyEl(narrow.tree).filter(bordered)).toEqual([])
    expect(narrow.text).toMatch(/● 796k tokens processed · 54 requests with usage · 2 without usage/)
  })
})

describe('Spend · glass: the ledger table', () => {
  test('desktop: fixed-width Box cells, figures mono and right-aligned, the same columns on the header, the session row and every agent row', () => {
    for (const showCost of [false, true]) {
      const s = desk(richSession(), 116, { showCost })
      const widths = (row: DrawnNode) => figureCells(row).map(el => el.props?.width)
      const head = widths(byKey(s.tree, 'lgt-head'))
      expect(head.length).toBe(showCost ? 7 : 6)
      expect(head.every(w => typeof w === 'number' && w > 0)).toBe(true)
      expect(widths(byKey(s.tree, 'lgt-session'))).toEqual(head)
      for (const id of ['main', 'explorer', 'implementer', 'tester', 'reviewer', 'constructor']) {
        const row = byKey(s.tree, `row-lg-${id}`)
        expect(widths(row)).toEqual(head)
        for (const cell of figureCells(row)) {
          const texts = kidsOf(cell).filter(isEl)
          expect(texts.every(t => t.type === 'Text' && t.props?.mono === true)).toBe(true)
          // Aligned by the cell, never by padding spaces.
          expect(texts.every(t => inline(t) === inline(t).trim())).toBe(true)
        }
      }
      expect(textIn(byKey(s.tree, 'lgt-head'))).toMatch(/agent.*\bin\b.*cache read.*cache write.*\bout\b.*total.*req.*outcome/)
    }
  })

  test('desktop: the session row is highlighted, the spawn tree a muted sub-row labelled as overlapping, and each bucket a pill', () => {
    const s = desk(richSession(), 116)
    const session = byKey(s.tree, 'lgt-session')
    expect(session?.props?.backgroundColor).toBe(GLASS.raised)
    expect(textIn(session)).toMatch(/Σ session.*●.*387.*732k.*55k.*8\.3k.*796k.*54/)
    const tree = everyEl(s.tree).filter(el => el.type === 'Text' && el.props?.dimColor === true && inline(el).startsWith('spawn tree (overlaps)'))
    expect(tree).toHaveLength(1)
    const line = s.lines.find(l => l.includes('spawn tree (overlaps)')) ?? ''
    expect(line).toMatch(/spawn tree \(overlaps\) ● 793k · 6 agents/)
    expect(line).not.toMatch(/session|total/i)
    const main = byKey(s.tree, 'row-lg-main')
    expect(everyEl(main).filter(bordered).map(textIn)).toEqual(['■ coordinator'])
    const auditor = byKey(s.tree, 'row-lg-auditor')
    expect(textIn(auditor)).toContain('∅ usage unknown (2 requests without usage)')
    expect(everyEl(auditor).filter(bordered).map(textIn)).toEqual(['░ no usage recorded'])
  })

  test('the terminal keeps its padded text table, with no translucent colour anywhere', () => {
    const s = spend(richSession(), 116, { showCost: true, focus: 'explorer' })
    expect(byKey(s.tree, 'lgt-head')).toBeUndefined()
    const values = everyEl(s.tree).flatMap(el => [el.props?.backgroundColor, el.props?.borderColor].map(String))
    expect(values.filter(v => /^#[0-9a-f]{8}$/i.test(v))).toEqual([])
  })
})

describe('Spend · glass: largest token use', () => {
  const IDS = ['implementer', 'main', 'tester', 'explorer', 'reviewer', 'constructor']

  test('desktop: ShareBars in one analytical hue, aligned starts, the figures in a right column', () => {
    const s = desk(richSession(), 116)
    const rows = IDS.map(id => byKey(s.tree, `lu-${id}`))
    const names = rows.map(row => (row ? kidsOf(row).filter(isEl)[0] : undefined))
    expect(new Set(names.map(n => n?.props?.width)).size).toBe(1)
    expect(typeof names[0]?.props?.width).toBe('number')
    for (const row of rows) {
      const fills = everyEl(row).filter(el => isBox(el) && el.props?.backgroundColor !== undefined && el.props.backgroundColor !== GLASS.track)
      expect(fills.map(f => f.props?.backgroundColor)).toEqual([ROLE.analytic])
      const figure = row ? kidsOf(row).filter(isEl).at(-1) : undefined
      expect(figure?.props?.justifyContent).toBe('flex-end')
      expect(textIn(figure)).toMatch(/^● \S+ · [\d.]+%$/)
    }
  })

  test('terminal: the token share bars use the analytical hue, never the coral chrome', () => {
    const largest = byKey(spend(richSession(), 116).tree, 'sp-largest')
    const fills = everyEl(largest).filter(el => el.type === 'Text' && el.props?.color === ROLE.analytic && /^[█▏▎▍▌▋▊▉]+$/.test(inline(el)))
    expect(fills).toHaveLength(IDS.length)
    // Every run of block text in the section is one of those fills (the coral `▌` heading mark is chrome, not a bar).
    const blocks = everyEl(largest).filter(el => el.type === 'Text' && kidsOf(el).every(k => typeof k === 'string') && /█/.test(inline(el)))
    expect(blocks.filter(el => el.props?.color !== ROLE.analytic)).toEqual([])
  })

  test('≈$ bars are amber (an estimate), apart from the token shares, with their caveat', () => {
    const s = desk(richSession({ priced: true }), 116, { showCost: true })
    const rows = everyEl(s.tree).filter(el => String(el.props?.key ?? '').startsWith('lc-'))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const fills = everyEl(row).filter(el => isBox(el) && el.props?.backgroundColor !== undefined && el.props.backgroundColor !== GLASS.track)
      expect(fills.map(f => f.props?.backgroundColor)).toEqual([ROLE.caution])
      expect(textIn(row)).toMatch(/≈<?\$/)
      expect(textIn(row)).not.toMatch(/%/)
    }
    expect(s.text).toContain('API-equivalent at 2026-10-06 prices, not a charge')
  })
})

describe('Spend · glass: spend vs outcome', () => {
  test('desktop: the shared bucket bar with unknown usage quiet, bucket rows as pills, "none in" as muted chips', () => {
    const s = desk(richSession(), 116)
    const bar = byKey(s.tree, 'spo-bar')
    const segments = everyEl(bar).filter(el => isBox(el) && el.props?.backgroundColor !== undefined)
    expect(segments.map(x => x.props?.backgroundColor)).toEqual([BUCKET_ROLE.coordinator, BUCKET_ROLE.verified, BUCKET_ROLE['report-only'], ROLE.unknownFill])
    expect(everyEl(bar).find(el => el.type === 'Text' && inline(el) === '░░')?.props?.color).toBe(ROLE.unknownFill)
    for (const bucket of ['coordinator', 'verified', 'report-only', 'unresolved', 'no-usage-recorded'] as const) {
      const pills = everyEl(byKey(s.tree, `row-bk-${bucket}`)).filter(bordered)
      expect(pills.map(textIn)).toEqual([`${bucket === 'no-usage-recorded' ? '░' : '■'} ${BUCKET_WORDS[bucket]}`])
      if (bucket === 'unresolved' || bucket === 'no-usage-recorded') expect(String(pills[0]?.props?.borderColor)).toContain(ROLE.unknownFill)
    }
    const none = byKey(s.tree, 'spo-none')
    expect(textIn(none)).toMatch(/^none in:/)
    const chips = everyEl(none).filter(bordered)
    expect(chips.map(textIn)).toEqual(['changed, unverified', 'failed or inconclusive', 'mixed'])
    for (const chip of chips) expect(everyEl(chip).some(el => el.type === 'Text' && el.props?.dimColor === true)).toBe(true)
    expect(s.text).toMatch(/● 796k tokens processed = 100% · each share below is of this total/)
    expect(s.keys).toContain('dc-spend-basis')
  })

  test('desktop: a bucket’s agents keep their so- rows, focusing the agent', () => {
    const s = desk(richSession(), 116, { selected: 'bk:verified' })
    expect(s.keys).toContain('so-implementer')
    expect(textIn(byKey(s.tree, 'row-so-tester'))).toMatch(/● \S+ · [\d.]+%/)
    s.press('so-tester')
    expect(s.calls.toggleFocus).toEqual(['tester'])
  })
})

describe('Spend · glass: the agent details', () => {
  const detail = (id: string, width: number, surface: 'terminal' | 'desktop') => {
    const snapshot = richSession()
    const analyses = analysesFor(snapshot, false)
    const { ctx, calls } = stub(snapshot, width, { surface })
    return {
      ledger: screenOf(AgentLedgerDetail(ctx, analyses.ledger.rows.find(r => r.agentId === id), false), calls),
      outcome: screenOf(AgentOutcomeDetail(ctx, analyses.spend.agents.find(a => a.agentId === id), analyses.trail), calls),
    }
  }

  test('one heading style on both surfaces: the kit’s level-2 heading, then the agent', () => {
    for (const surface of ['terminal', 'desktop'] as const) {
      // The theme the render hook applies for this surface: its sub-heading mark (classic `·`, Abyssal's on desktop).
      applyTheme(themeFor(surface))
      const sub = themeFor(surface).chrome.subMark
      const { ledger, outcome } = detail('tester', 116, surface)
      expect(ledger.lines[0]).toMatch(new RegExp(`^${sub} ledger · +C +general-purpose$`))
      expect(outcome.lines[0]).toMatch(new RegExp(`^${sub} outcome · +C +general-purpose$`))
      for (const s of [ledger, outcome]) {
        expect(s.text).not.toContain('──')
        const mark = everyEl(s.tree).find(el => el.type === 'Text' && inline(el) === sub)
        expect(mark?.props?.color).toBe(ROLE.rose)
      }
    }
    applyTheme(themeFor('desktop'))
  })

  test('desktop: the request table is aligned cells, ids muted mono, the same columns on every row', () => {
    const { ledger } = detail('tester', 116, 'desktop')
    const rows = everyEl(ledger.tree).filter(el => /^rq-tester-(?!head$).+/.test(String(el.props?.key ?? '')))
    expect(rows).toHaveLength(8)
    const widths = (row: El) => kidsOf(row).filter(isEl).map(el => el.props?.width)
    for (const row of rows) {
      expect(row.props?.flexDirection).toBe('row')
      expect(widths(row)).toEqual(widths(rows[0] as El))
      expect(textIn(row)).toMatch(/^●/)
    }
    const id = everyEl(rows[0]).find(el => el.type === 'Text' && inline(el) === 't:44')
    expect(id?.props?.mono).toBe(true)
    expect(id?.props?.dimColor).toBe(true)
    expect(textIn(byKey(ledger.tree, 'rq-tester-head'))).toMatch(/prompt.*out.*stop/)
  })
})

describe('Spend · glass: layouts', () => {
  test('expanded (≥ 140): the hero tile and the ledger table sit side by side; a narrower pane stacks them', () => {
    const wide = desk(richSession(), 160)
    const top = byKey(wide.tree, 'sp-top')
    expect(top?.props?.flexDirection).toBe('row')
    const columns = top ? kidsOf(top).filter(isEl) : []
    expect(columns).toHaveLength(2)
    expect(byKey(columns[0], 'sp-hero')).toBeDefined()
    expect(buttonKeys(columns[1])).toContain('lg-main')
    expect(Number(columns[0]?.props?.width) + Number(columns[1]?.props?.width)).toBeLessThanOrEqual(160)
    expect(byKey(columns[1], 'lgt-head')).toBeDefined()
    expect(byKey(desk(richSession(), 116).tree, 'sp-top')?.props?.flexDirection).not.toBe('row')
    // Reorganised, not stretched: largest use and spend vs outcome share the row below.
    const bottom = byKey(wide.tree, 'sp-bottom')
    expect(bottom?.props?.flexDirection).toBe('row')
    const halves = bottom ? kidsOf(bottom).filter(isEl) : []
    expect(byKey(halves[0], 'sp-largest')).toBeDefined()
    expect(byKey(halves[1], 'sp-outcome')).toBeDefined()
    expect(byKey(desk(richSession(), 116).tree, 'sp-bottom')).toBeUndefined()
    // The narrow hero keeps its title on one line: its summary moves to a line of its own.
    const heroTitle = logicalLines(byKey(wide.tree, 'sp-hero'))[0] ?? ''
    expect(heroTitle).toMatch(/session tokens$/)
    expect(textIn(byKey(wide.tree, 'sp-hero'))).toContain('each recorded turn.step request counted once')
  })

  test('compact (49): no glass tiles, one-line rows that fit, no miniature bars in the rows', () => {
    const s = desk(richSession(), 49)
    expect(everyEl(s.tree).filter(el => isBox(el) && el.props?.backgroundColor === GLASS.raised)).toEqual([])
    const sections = everyEl(s.tree).filter(el => bordered(el) && /tokens processed|largest token use|spend vs outcome|by agent/.test(textIn(el)))
    expect(sections).toEqual([])
    for (const id of AGENTS) {
      const row = byKey(s.tree, `row-lg-${id}`)
      expect(row).toBeDefined()
      expect(everyEl(row).filter(el => isBox(el) && TOKEN_HEX.includes(String(el.props?.backgroundColor)))).toEqual([])
      const texts = everyEl(row).filter(isBox).flatMap(el => kidsOf(el).filter(isEl).filter(k => k.type === 'Text'))
      expect(texts.length).toBeGreaterThan(0)
      expect(texts.every(t => t.props?.wrap === 'truncate-end')).toBe(true)
    }
  })
})

// ── whole-tab scans ──

describe('Spend · labels and wording on every state', () => {
  const states = (width: number): Screen[] => [
    spend(richSession(), width, { showCost: true, open: ALL_OPEN }),
    ...AGENTS.map(focus => spend(richSession(), width, { showCost: true, open: ALL_OPEN, focus })),
    ...['coordinator', 'verified', 'report-only', 'unresolved', 'no-usage-recorded'].map(b =>
      spend(richSession(), width, { showCost: true, open: ALL_OPEN, selected: `bk:${b}` }),
    ),
  ]

  test('every metric number carries a measure label on its line (AT-14 rule), at 30, 49, 80 and 116', () => {
    for (const width of [30, 49, 80, 116]) {
      const bad = states(width).flatMap(s => s.lines.filter(l => METRIC.test(l) && !LABEL.test(l) && !EXEMPT.test(l.trim())))
      expect(bad).toEqual([])
    }
  })

  test('strict: every figure on every line, rows included, carries a measure label (● ≈ ∅)', () => {
    // Stricter than AT-14: Row lines (▸/▾) are not exempt, a bare 78k counts, and only measure labels count.
    const FIGURE = /\d[\d.,]*[kM]\b|\d[\d.]*%|\d[\d.,]*\s?(tok|tokens|req|requests)\b/
    const MEASURE = /[●≈∅]/
    const ITEM_COUNT = /^[▸▾] \d+ more (ledger notes?|agents?)$/
    for (const width of [30, 49, 80, 116]) {
      const bad = states(width).flatMap(s => s.lines.filter(l => FIGURE.test(l) && !MEASURE.test(l) && !ITEM_COUNT.test(l.trim())))
      expect(bad).toEqual([])
    }
  })

  test('no drawn text judges the work, and no unknown usage reads as an observed zero', () => {
    for (const width of [30, 116]) {
      for (const s of states(width)) {
        expect(s.lines.filter(l => FORBIDDEN.test(l))).toEqual([])
        expect(s.lines.filter(l => OBSERVED_ZERO.test(l))).toEqual([])
      }
    }
  })

  test('Button keys are unique and the selecting ones use lg-, so- and bk-', () => {
    for (const width of [49, 116]) {
      for (const s of states(width)) {
        expect(new Set(s.keys).size).toBe(s.keys.length)
        expect(s.keys.filter(k => /^(card-|node-|sig-|ag-|row-|focus-|lane-)/.test(k))).toEqual([])
      }
    }
  })
})

// ── the whole pane, mounted on both surfaces ──

const PLUGIN = 'swarm-autopsy'
const SESSION = 'session-under-test'
const SLOW = { timeoutMs: 120_000 }

const PANE = (bodyColumns: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
})

function seeded(on: On, seed: Snapshot) {
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: SESSION }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', ($, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

async function walkSpend($: Engine, surface: 'terminal' | 'desktop', width: number) {
  const ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
  await ui.press({ key: 'tab-spend' })
  await ui.press({ key: 'toggle-cost' })
  const first = (await ui.drawn()) as DrawnNode
  const sizes = [treeSize(first)]
  const dupes: string[] = []
  for (const key of buttonKeys(first).filter(k => /^(lg-|so-|bk-|dc-spend)/.test(k))) {
    if (!buttonKeys((await ui.drawn()) as DrawnNode).includes(key)) continue
    await ui.press({ key })
    const tree = (await ui.drawn()) as DrawnNode
    const keys = buttonKeys(tree)
    if (new Set(keys).size !== keys.length) dupes.push(`${surface}@${width} after ${key}`)
    sizes.push(treeSize(tree))
  }
  await ui.unmount()
  return { sizes, dupes }
}

describe('Spend · mounted', () => {
  test('the tab draws on terminal and desktop at every width, within the tree budget, with unique keys', SLOW, async ($, on) => {
    seeded(on, { ...richSession(), sessionId: SESSION })
    for (const [surface, width] of [['terminal', 30], ['terminal', 49], ['terminal', 80], ['terminal', 116], ['desktop', 49], ['desktop', 116]] as const) {
      const { sizes, dupes } = await walkSpend($, surface, width)
      expect(dupes).toEqual([])
      expect(sizes.filter(s => s.depth > 20 || s.nodes > 2500)).toEqual([])
    }
  })
})
