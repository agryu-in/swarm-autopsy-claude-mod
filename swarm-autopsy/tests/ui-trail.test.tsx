// Workstream C · Contribution Trail view tests (DESIGN-CONTRACT §8.3). SIMULATED
// snapshots in, the drawn tree out, read as logical lines (tests/view-helpers).
// Pure views through a stub element table, plus one mounted walk through the
// engine's own test host for the compact one-lane-open behaviour.

import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { analyzeCollisions } from '../hooks/lib/collisions'
import { EVIDENCE_COLOR, pct, subagents } from '../hooks/lib/format'
import { applyUsage, buildLedgerView } from '../hooks/lib/ledger'
import { buildSpendOutcome } from '../hooks/lib/outcome'
import { BUCKET_ROLE, GLASS, SVG_HEX, identityHex } from '../hooks/lib/palette'
import { gatherSignals, unresolvedOf } from '../hooks/lib/signals'
import { buildTrail, UNLINKED_TEXT, UNVERIFIED_STALE_TEXT, type Trail, type TrailNode } from '../hooks/lib/trail'
import type { ViewContext } from '../hooks/ui/common'
import { layoutFor } from '../hooks/ui/kit'
import { TrailView } from '../hooks/ui/trail'
import { badgeFor, bucketLabel, filterCounts, middleTruncate, pathOf } from '../hooks/ui/trail-model'
import { CELL_PX, MAP_MAX_SOURCE, layoutTrailMap, trailSvg } from '../hooks/ui/trailmap'
import type { HealthSignal, Snapshot, SpendOutcome, TrailFilter, UiState, UsageRecord } from '../types'
import { build, spawn, threeAgentSession, tool, turnEnd, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { NOOP_ACTIONS, buttonKeys, inline, logicalLines, treeSize, type DrawnNode, withClients } from './view-helpers'

// ── SIMULATED fixture ──

/**
 * explorer reports (its report is quoted verbatim in the implementer's prompt: LINKED); the implementer edits token.ts,
 * the tester's passing run follows, then the implementer edits token.ts again (the check is stale); the fixer's check
 * fails and its lint run ends inconclusive; the auditor's report is linked to nothing; the tidier's change is verified.
 */
function trailSession(): Snapshot {
  const base = build(
    ...threeAgentSession(),
    ...tool('implementer', 'e2', 'Edit', { file_path: '/repo/src/auth/token.ts', old_string: 'x', new_string: 'y' }),
    spawn('fixer', { description: 'fix cache eviction', prompt: 'Fix eviction in src/cache.ts.' }),
    turnStart('fixer', 't-fix'),
    ...tool('fixer', 'f1', 'Edit', { file_path: '/repo/src/cache.ts', old_string: 'a', new_string: 'b' }),
    ...tool('fixer', 'f2', 'Bash', { command: 'npm test -- cache FAILME' }, { isError: true, text: 'Exit code 1' }),
    ...tool('fixer', 'f3', 'Bash', { command: 'npm run lint' }, { result: { backgroundTaskId: 'bg1' } }),
    turnEnd('fixer', 't-fix', 'Tried twice.'),
    spawn('auditor', { type: 'docs-auditor', description: 'audit the README', prompt: 'Audit README.md for stale commands.' }),
    turnStart('auditor', 't-aud'),
    ...tool('auditor', 'ra', 'Read', { file_path: '/repo/README.md' }),
    turnEnd('auditor', 't-aud', 'The README lists three commands; two of them no longer exist in package.json scripts.'),
    spawn('tidier', { description: 'tidy util', prompt: 'Tidy src/util.ts.' }),
    turnStart('tidier', 't-tidy'),
    ...tool('tidier', 'u1', 'Edit', { file_path: '/repo/src/util.ts', old_string: 'a', new_string: 'b' }),
    ...tool('tidier', 'u2', 'Bash', { command: 'npm test -- util' }),
    turnEnd('tidier', 't-tidy', 'Tidied util.'),
  )
  const records: UsageRecord[] = [
    usageRecord({ agentId: 'main', turnId: 'm', index: 0, tokens: tokens(40, 60_000, 8_000, 900) }),
    usageRecord({ agentId: 'explorer', turnId: 'x', index: 0, tokens: tokens(20, 30_000, 4_000, 700) }),
    usageRecord({ agentId: 'implementer', turnId: 'i', index: 0, tokens: tokens(10, 140_000, 10_000, 500) }),
    usageRecord({ agentId: 'tester', turnId: 't', index: 0, tokens: tokens(5, 2_000, 100, 60) }),
    usageRecord({ agentId: 'fixer', turnId: 'f', index: 0, tokens: tokens(5, 20_000, 1_000, 80) }),
    usageRecord({ agentId: 'tidier', turnId: 'u', index: 0, tokens: tokens(5, 9_000, 500, 40) }),
    usageRecord({ agentId: 'auditor', turnId: 'a', index: 0, tokens: null }),
  ]
  return { ...base, ledger: records.reduce((ledger, record) => applyUsage(ledger, record), base.ledger) }
}

function analysesOf(snapshot: Snapshot): { trail: Trail; spend: SpendOutcome } {
  const trail = buildTrail(snapshot)
  const ledger = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
  return { trail, spend: buildSpendOutcome(snapshot, trail, ledger) }
}

// ── stub host ──

type Calls = {
  select: Array<string | undefined>
  toggleOpen: string[]
  trailFilter: TrailFilter[]
  view: string[]
  toggleFocus: string[]
  openEvent: string[]
}

type Drawn = { tree: DrawnNode; lines: string[]; keys: string[]; calls: Calls; ctx: ViewContext }

function render(
  snapshot: Snapshot,
  options: {
    width: number
    surface?: 'terminal' | 'desktop'
    ui?: Partial<UiState>
    analyses?: { trail: Trail; spend: SpendOutcome }
    health?: readonly HealthSignal[]
  },
): Drawn {
  const surface = options.surface ?? 'terminal'
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const els = { Box: element('Box'), Text: element('Text'), Button: element('Button'), ...(surface === 'desktop' ? { Svg: element('Svg') } : {}) }
  const calls: Calls = { select: [], toggleOpen: [], trailFilter: [], view: [], toggleFocus: [], openEvent: [] }
  const ctx: ViewContext = {
    els: els as unknown as ViewContext['els'],
    surface,
    width: options.width,
    rows: 60,
    layout: layoutFor(options.width),
    now: 0,
    snapshot,
    ui: { view: 'trail', filter: 'all', page: 0, ...options.ui },
    act: {
      ...NOOP_ACTIONS,
      select: id => calls.select.push(id),
      toggleOpen: id => calls.toggleOpen.push(id),
      trailFilter: f => calls.trailFilter.push(f),
      view: v => calls.view.push(v),
      toggleFocus: id => calls.toggleFocus.push(id),
      openEvent: id => calls.openEvent.push(id),
    },
  }
  const { trail, spend } = options.analyses ?? analysesOf(snapshot)
  const tree = TrailView(ctx, trail, spend, options.health) as unknown as DrawnNode
  return { tree, lines: logicalLines(tree), keys: buttonKeys(tree), calls, ctx }
}

type Element = { type: string; props: Record<string, unknown> }

function childrenOf(node: Element): DrawnNode[] {
  const children = node.props?.children
  return (Array.isArray(children) ? children.flat(Infinity) : children === undefined ? [] : [children]) as DrawnNode[]
}

function elements(node: DrawnNode | DrawnNode[], out: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node as DrawnNode[]) elements(child, out)
    return out
  }
  if (node === null || node === undefined || typeof node !== 'object') return out
  out.push(node as Element)
  for (const child of childrenOf(node as Element)) elements(child, out)
  return out
}

/** The elements from the root down to `target`'s parent, outermost first; empty when `target` is not in the tree. */
function ancestorsOf(node: DrawnNode, target: Element, path: Element[] = []): Element[] {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (Array.isArray(node)) {
    for (const child of node as DrawnNode[]) {
      const found = ancestorsOf(child, target, path)
      if (found.length > 0) return found
    }
    return []
  }
  const element = node as Element
  for (const child of childrenOf(element)) {
    if (child === (target as unknown as DrawnNode)) return [...path, element]
    const found = ancestorsOf(child, target, [...path, element])
    if (found.length > 0) return found
  }
  return []
}

/** Every string a Text draws, its own and its nested Texts'. */
function textStrings(node: DrawnNode | DrawnNode[], out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node as DrawnNode[]) textStrings(child, out)
  else if (node !== null && node !== undefined && typeof node === 'object') for (const child of childrenOf(node as Element)) textStrings(child, out)
  return out
}

/** The health signals the register gathers for a snapshot (the analyses, built as `register.tsx` builds them). */
function healthOf(snapshot: Snapshot): HealthSignal[] {
  const trail = buildTrail(snapshot)
  const ledger = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
  const spend = buildSpendOutcome(snapshot, trail, ledger)
  return gatherSignals({ snapshot, trail, collisions: analyzeCollisions(snapshot), ledger, spend })
}

/** The Svg sizing rule (Sunset Glass §2, R1 §6.1): an interactive Svg carries both sizes, each a number in (0, 4096]. */
const sized = (n: unknown): boolean => typeof n === 'number' && n > 0 && n <= 4096

/** The text of a lane's header button (the line of it in the logical lines may carry more). */
function headerOf(drawn: Drawn, agentId: string): string {
  const button = elements(drawn.tree).find(e => e.type === 'Button' && e.props.key === `lane-${agentId}`)
  if (!button) throw new Error(`no header for ${agentId}`)
  return inline(button as unknown as DrawnNode)
}

/** Presses a Button by key in a drawn tree. */
function press(drawn: Drawn, key: string): void {
  const button = elements(drawn.tree).find(e => e.type === 'Button' && e.props.key === key)
  if (!button) throw new Error(`no button ${key}`)
  ;(button.props.onPress as () => void)()
}

const nodeOf = (trail: Trail, agentId: string, stage: TrailNode['stage'], has = ''): TrailNode => {
  const node = trail.lanes.flatMap(l => l.nodes).find(n => n.agentId === agentId && n.stage === stage && (n.title + (n.path ?? '')).includes(has))
  if (!node) throw new Error(`no ${stage} node for ${agentId}`)
  return node
}

const keyOf = (trail: Trail, node: TrailNode): string => {
  const lane = trail.lanes.findIndex(l => l.agentId === node.agentId)
  return `node-${lane}-${trail.lanes[lane]?.nodes.indexOf(node)}`
}

const labelOf = (snapshot: Snapshot, id: string) => snapshot.agents[id]?.label ?? '?'
const METRIC = /\d[\d.,]*\s?[kM]?\s?(tok|tokens|req|requests)\b|\d[\d.]*%/
/** Measure labels only (DESIGN-CONTRACT §4.1): evidence glyphs do not label a number. */
const LABEL = /[●≈∅]/
const FORBIDDEN = /\b(wasted?|useless|lost|ignored|unused|inefficien\w*|more than expected|top contributors?)\b/i

// ── the tests ──

describe('trail: model helpers', () => {
  test('middle truncation keeps the head and the tail of a command', () => {
    expect(middleTruncate('npm test -- cache', 40)).toBe('npm test -- cache')
    const a = middleTruncate('npm test -- packages/core/src/cache.test.ts --grep eviction-alpha', 24)
    const b = middleTruncate('npm test -- packages/core/src/cache.test.ts --grep eviction-beta', 24)
    expect(a.length).toBe(24)
    expect(a).toContain('…')
    expect(a.startsWith('npm test')).toBe(true)
    expect(a.endsWith('alpha')).toBe(true)
    expect(b.endsWith('beta')).toBe(true)
    expect(a).not.toBe(b)
  })

  test('filter membership and counts come from trail flags, verdicts and F3 contributions', () => {
    const { trail, spend } = analysesOf(trailSession())
    expect(filterCounts(trail, spend)).toEqual({ all: 6, verified: 1, unresolved: 4, inconclusive: 1, failed: 1 })
  })

  test('the path of a node is its incoming and outgoing edges and the nodes at their other ends', () => {
    const { trail } = analysesOf(trailSession())
    const change = nodeOf(trail, 'implementer', 'change')
    const path = pathOf(trail, change.id)
    const delegation = nodeOf(trail, 'implementer', 'delegation')
    const check = nodeOf(trail, 'tester', 'verification')
    const finding = nodeOf(trail, 'explorer', 'finding')
    expect(path.nodes.get(delegation.id)).toBe('LINKED')
    expect(path.nodes.get(check.id)).toBe('INFERRED')
    expect(path.nodes.get(finding.id)).toBe('INFERRED')
    expect([...path.edges].every(id => trail.edges.some(e => e.id === id && (e.from === change.id || e.to === change.id)))).toBe(true)
    expect(pathOf(trail, undefined).edges.size).toBe(0)
  })

  test('a lane badge is the F3 bucket, and verified is never stronger than INFERRED', () => {
    const { spend } = analysesOf(trailSession())
    expect(badgeFor(spend, 'tidier')).toMatchObject({ bucket: 'verified', label: 'verified', evidence: 'INFERRED' })
    expect(badgeFor(spend, 'auditor')).toMatchObject({ bucket: 'report-only', label: 'report only', evidence: 'UNRESOLVED' })
    expect(badgeFor(spend, 'main')?.evidence).toBeUndefined()
    expect(bucketLabel('no-usage-recorded')).toBe('no usage recorded')
  })
})

describe('trail: lanes, nodes and edges', () => {
  test('each lane header carries the agent chip and its F3 bucket badge with the evidence label', () => {
    const snapshot = trailSession()
    for (const width of [49, 116]) {
      const drawn = render(snapshot, { width })
      // Wide: the badge ends the header; compact: it ends the lane's line, after the stage beads (chip → beads → outcome).
      const laneLine = (id: string) => drawn.lines.find(l => l.includes(headerOf(drawn, id))) ?? ''
      const tidier = laneLine('tidier')
      expect(tidier).toContain(` ${labelOf(snapshot, 'tidier')} `)
      expect(tidier).toContain('◇ verified')
      expect(drawn.lines.some(l => /[●◆] verified/.test(l))).toBe(false)
      expect(laneLine('auditor')).toContain('? report only')
      expect(laneLine('fixer')).toContain('failed or inconclusive')
      if (width === 49) expect(tidier.indexOf('✓')).toBeLessThan(tidier.indexOf('verified'))
      for (const id of ['explorer', 'implementer', 'tester', 'fixer', 'auditor', 'tidier']) expect(drawn.keys).toContain(`lane-${id}`)
    }
  })

  test('nodes are grouped by stage, verification rows show their verdict glyph and word', () => {
    const snapshot = trailSession()
    const { lines } = render(snapshot, { width: 116 })
    for (const stage of ['Delegation', 'Findings', 'Changes', 'Verification', 'Outcome']) expect(lines.some(l => l.trimStart().startsWith(stage))).toBe(true)
    expect(lines.some(l => l.includes('✕') && l.includes('npm test -- cache FAILME') && l.includes('failed'))).toBe(true)
    expect(lines.some(l => l.includes('~') && l.includes('npm run lint') && l.includes('inconclusive'))).toBe(true)
    expect(lines.some(l => l.includes('✓') && l.includes('npm test -- util') && l.includes('passed'))).toBe(true)
  })

  test('LINKED edges are drawn solid ◆ and INFERRED edges dashed ◇, each in its evidence colour', () => {
    const snapshot = trailSession()
    const { tree, lines } = render(snapshot, { width: 116 })
    expect(lines.some(l => l.includes('─◆→'))).toBe(true)
    expect(lines.some(l => l.includes('╌◇→'))).toBe(true)
    const texts = elements(tree).filter(e => e.type === 'Text')
    const linked = texts.find(e => String(e.props.children).includes('─◆→'))
    const inferred = texts.find(e => String(e.props.children).includes('╌◇→'))
    expect(linked?.props.color).toBe(EVIDENCE_COLOR.LINKED)
    expect(inferred?.props.color).toBe(EVIDENCE_COLOR.INFERRED)
    // No edge without a trail edge behind it: every connector line names a node or agent the trail links.
    const { trail } = analysesOf(snapshot)
    const connectors = lines.filter(l => /[─╌][◆◇]→/.test(l)).length
    expect(connectors).toBeLessThanOrEqual(trail.edges.length)
  })

  test('the report-to-parent hand-back stays in the list', () => {
    const snapshot = trailSession()
    const { lines } = render(snapshot, { width: 116 })
    expect(lines.some(l => l.includes('─◆→') && l.includes('main') && l.includes('hand-back'))).toBe(true)
  })

  test('a stale check keeps its "does not cover the final version" basis, and its edge says it ran before the last edit', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const change = nodeOf(trail, 'implementer', 'change')
    const plain = render(snapshot, { width: 116 })
    expect(plain.lines.some(l => l.includes('╌◇→') && l.includes('npm test -- token') && l.includes('before last edit'))).toBe(true)
    expect(plain.lines.some(l => l.includes(UNVERIFIED_STALE_TEXT))).toBe(true)
    const selected = render(snapshot, { width: 116, ui: { selected: `node:${change.id}` } })
    expect(selected.lines.some(l => l.includes('does not cover the final version'))).toBe(true)
  })

  test('the unlinked report states the exact unlinked text', () => {
    const snapshot = trailSession()
    expect(render(snapshot, { width: 116 }).lines.some(l => l.includes(UNLINKED_TEXT))).toBe(true)
    const { trail } = analysesOf(snapshot)
    const finding = nodeOf(trail, 'auditor', 'finding')
    expect(render(snapshot, { width: 49, ui: { selected: `node:${finding.id}` } }).lines.some(l => l.includes(UNLINKED_TEXT))).toBe(true)
  })

  test('node keys are node-<lane>-<node> over the trail lanes, and every key is unique', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const change = nodeOf(trail, 'implementer', 'change')
    for (const width of [49, 80, 116]) {
      for (const surface of ['terminal', 'desktop'] as const) {
        const { keys } = render(snapshot, { width, surface, ui: { selected: `node:${change.id}`, open: ['trail-denominator'] } })
        expect(new Set(keys).size).toBe(keys.length)
        expect(keys).toContain(keyOf(trail, change))
      }
    }
  })
})

describe('trail: selection', () => {
  test('selecting a node opens its evidence under that node, before the next lane, and marks its path', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const change = nodeOf(trail, 'implementer', 'change')
    const drawn = render(snapshot, { width: 116, ui: { selected: `node:${change.id}` } })
    const { lines } = drawn
    const row = lines.findIndex(l => l.includes('▾') && l.includes('src/auth/token.ts'))
    const evidence = lines.findIndex(l => l.includes('evidence ·'))
    const nextLane = lines.indexOf(headerOf(drawn, 'tester'))
    expect(row).toBeGreaterThan(-1)
    expect(evidence).toBeGreaterThan(row)
    expect(evidence).toBeLessThan(nextLane)
    expect(lines.filter(l => l.includes('evidence ·')).length).toBe(1)
    const tester = lines.find(l => l.includes('⚑') && l.includes('npm test -- token') && !/[─╌][◆◇]→/.test(l))
    expect(tester).toContain('◇ on path')
    const delegation = lines.find(l => l.includes('“fix token expiry”'))
    expect(delegation).toContain('◆ on path')
    const unrelated = lines.find(l => l.includes('⚑') && l.includes('npm test -- util') && !/[─╌][◆◇]→/.test(l))
    expect(unrelated).toBeDefined()
    expect(unrelated).not.toContain('on path')
  })

  test('pressing a node selects it, pressing it again clears the selection, and source events open in Forensics', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const change = nodeOf(trail, 'fixer', 'change')
    const key = keyOf(trail, change)
    const first = render(snapshot, { width: 80 })
    press(first, key)
    expect(first.calls.select).toEqual([`node:${change.id}`])
    const second = render(snapshot, { width: 80, ui: { selected: `node:${change.id}` } })
    press(second, key)
    expect(second.calls.select).toEqual([undefined])
    const sourceKey = second.keys.find(k => k.startsWith('src-'))
    expect(sourceKey).toBeDefined()
    press(second, sourceKey ?? '')
    expect(second.calls.openEvent.length).toBe(1)
  })

  test('the focused agent’s lane is marked', () => {
    const snapshot = trailSession()
    for (const width of [49, 116]) {
      const drawn = render(snapshot, { width, ui: { focus: 'fixer' } })
      expect(headerOf(drawn, 'fixer')).toContain('◂ focus')
      expect(drawn.lines.filter(l => l.includes('◂ focus')).length).toBe(1)
      press(drawn, 'lane-fixer')
    }
    const wide = render(snapshot, { width: 116 })
    press(wide, 'lane-fixer')
    expect(wide.calls.toggleFocus).toEqual(['fixer'])
  })
})

describe('trail: filters', () => {
  test('filter chips show each filter’s lane count and set the trail filter', () => {
    const snapshot = trailSession()
    const drawn = render(snapshot, { width: 80 })
    const chips = elements(drawn.tree).filter(e => e.type === 'Button' && String(e.props.key).startsWith('tf-'))
    expect(chips.map(c => c.props.label)).toEqual(['all 6', '◇ verified 1', 'unresolved 4', 'inconclusive 1', 'failed 1'])
    expect(chips[0]?.props.variant).toBe('primary')
    press(drawn, 'tf-failed')
    expect(drawn.calls.trailFilter).toEqual(['failed'])
  })

  test('a filter shows only the matching lanes', () => {
    const snapshot = trailSession()
    const failed = render(snapshot, { width: 116, ui: { trailFilter: 'failed' } })
    const laneKeys = failed.keys.filter(k => k.startsWith('lane-'))
    expect(laneKeys).toEqual(['lane-fixer'])
    const verified = render(snapshot, { width: 116, ui: { trailFilter: 'verified' } })
    expect(verified.keys.filter(k => k.startsWith('lane-'))).toEqual(['lane-tidier'])
    const unresolved = render(snapshot, { width: 116, ui: { trailFilter: 'unresolved' } })
    expect(unresolved.keys.filter(k => k.startsWith('lane-'))).toEqual(['lane-implementer', 'lane-tester', 'lane-fixer', 'lane-auditor'])
  })

  test('a filter that matches nothing says so', () => {
    const snapshot = build(...threeAgentSession())
    const { lines } = render(snapshot, { width: 80, ui: { trailFilter: 'failed' } })
    expect(lines.some(l => l.includes('No lane matches'))).toBe(true)
  })
})

describe('trail: outcome box', () => {
  test('the spend-vs-outcome line is a stacked bar of F3 buckets, every number tagged, the basis reachable', () => {
    const snapshot = trailSession()
    const { spend } = analysesOf(snapshot)
    const closed = render(snapshot, { width: 116 })
    expect(closed.lines.some(l => /by outcome:/.test(l))).toBe(false)
    expect(closed.lines.some(l => l.includes('Outcome so far'))).toBe(true)
    expect(closed.lines.some(l => l.includes('tokens processed') && l.includes('●'))).toBe(true)
    const bars = elements(closed.tree).filter(e => e.type === 'Text' && /^█+$/.test(String(e.props.children)))
    expect(bars.length).toBeGreaterThan(1)
    expect(bars.every(b => Object.values(BUCKET_ROLE).includes(String(b.props.color)))).toBe(true)
    for (const bucket of spend.buckets) {
      // "verified" carries its ◇ (F3-4); the other buckets name themselves.
      const label = bucket.bucket === 'verified' ? '◇ verified' : bucketLabel(bucket.bucket)
      const line = closed.lines.find(l => l.includes(`■ ${label}`))
      expect(line).toBeDefined()
      if (bucket.bucket === 'no-usage-recorded') {
        expect(line).toContain('∅')
        expect(line).toContain('usage unknown')
        expect(line).not.toMatch(/\b0(\.0)?%/)
      } else {
        expect(line).toContain('●')
        expect(line).toContain(pct(bucket.percent))
      }
    }
    expect(closed.keys).toContain('dc-trail-denominator')
    expect(closed.lines.some(l => l.includes(spend.denominatorBasis))).toBe(false)
    const open = render(snapshot, { width: 116, ui: { open: ['trail-denominator'] } })
    expect(open.lines.some(l => l.includes(spend.denominatorBasis))).toBe(true)
    press(open, 'open-spend')
    expect(open.calls.view).toEqual(['spend'])
  })

  test('commands stay distinguishable at narrow widths: the middle is cut, not the end', () => {
    const snapshot = build(
      spawn('a', { description: 'run alpha' }),
      ...tool('a', 'b1', 'Bash', { command: 'npm test -- packages/core/src/cache.test.ts --grep eviction-alpha' }, { isError: true, text: 'Exit code 1' }),
      ...tool('a', 'b2', 'Bash', { command: 'npm test -- packages/core/src/cache.test.ts --grep eviction-beta' }),
    )
    const { lines } = render(snapshot, { width: 40 })
    const alpha = lines.find(l => l.includes('…') && l.endsWith('alpha'))
    const beta = lines.find(l => l.includes('…') && l.endsWith('beta'))
    expect(alpha).toBeDefined()
    expect(beta).toBeDefined()
    expect(alpha).not.toBe(beta)
  })

  test('every metric number carries a label, and no line judges the work, on every layout', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const selections = [undefined, ...trail.lanes.flatMap(l => l.nodes).map(n => `node:${n.id}`)]
    for (const width of [30, 49, 80, 116]) {
      for (const surface of ['terminal', 'desktop'] as const) {
        for (const selected of selections) {
          const { lines } = render(snapshot, { width, surface, ui: { selected, open: ['trail-denominator'] } })
          const untagged = lines.filter(l => METRIC.test(l) && !LABEL.test(l) && !l.trim().startsWith('['))
          expect(untagged).toEqual([])
          expect(lines.filter(l => FORBIDDEN.test(l))).toEqual([])
        }
      }
    }
  })
})

describe('trail: desktop map', () => {
  test('the map fills the pane width in image mode: no isInteractive, its size its own viewBox (a Client requires one), in a column Box on a glass panel', () => {
    const snapshot = trailSession()
    const wide = render(snapshot, { width: 116, surface: 'desktop' })
    const svg = elements(wide.tree).find(e => e.type === 'Svg')
    expect(svg).toBeDefined()
    // Image mode with no size props fills its slot at the drawing's own ratio; an interactive frame without both sizes
    // is the 300 × 150 thumbnail the person saw (R1 §6.1, §6.3d).
    expect(svg?.props.isInteractive).toBeUndefined()
    const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(String(svg?.props.source))
    expect(svg?.props.width).toBe(Math.round(Number(viewBox?.[1])))
    expect(svg?.props.height).toBe(Math.round(Number(viewBox?.[2])))
    const parent = ancestorsOf(wide.tree, svg as Element).at(-1)
    expect(parent?.type).toBe('Box')
    expect(parent?.props.flexDirection).toBe('column')
    expect(parent?.props.borderStyle).toBe('round')
    expect(String(parent?.props.backgroundColor)).toMatch(/^#[0-9a-f]{8}$/)
    const source = String(svg?.props.source)
    expect(source).not.toContain('842')
    expect(source).toContain('viewBox="0 0 928 ')
    // The root carries no fixed size: the image takes the slot's width.
    expect(source.slice(0, source.indexOf('>'))).not.toMatch(/\s(width|height)=/)
    const wider = elements(render(snapshot, { width: 140, surface: 'desktop' }).tree).find(e => e.type === 'Svg')
    expect(String(wider?.props.source)).toContain('viewBox="0 0 1120 ')
    expect(String(svg?.props.alt)).toMatch(/\d+ lanes/)
    expect(render(snapshot, { width: 116, surface: 'terminal' }).lines.some(l => l.includes('[svg:'))).toBe(false)
  })

  test('no Trail Svg is ever isInteractive without both sizes, on any layout, selection, filter or lane cap', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const change = `node:${nodeOf(trail, 'implementer', 'change').id}`
    let seen = 0
    for (const width of [40, 60, 80, 116, 160]) {
      for (const selected of [undefined, change]) {
        for (const trailFilter of ['all', 'failed'] as const) {
          for (const open of [[], ['trail-all-lanes']]) {
            const drawn = render(snapshot, { width, surface: 'desktop', ui: { selected, trailFilter, open } })
            for (const svg of elements(drawn.tree).filter(e => e.type === 'Svg')) {
              seen += 1
              if (svg.props.isInteractive) {
                expect(sized(svg.props.width)).toBe(true)
                expect(sized(svg.props.height)).toBe(true)
              }
              // Every Box above it is a column: in a row (the engine's default) the panel shrinks to its content, and an
              // image with no size of its own then shrinks to nothing (seen in the harness paint, 2026-10-18).
              expect(ancestorsOf(drawn.tree, svg).filter(a => a.props.flexDirection !== 'column').map(a => a.type)).toEqual([])
            }
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  test('edges are drawn before nodes, run only in gutters, and leave report hand-backs to the list', () => {
    const snapshot = trailSession()
    const { trail, spend } = analysesOf(snapshot)
    const input = { widthPx: 928, spend }
    const map = trailSvg(snapshot, trail, input)
    expect(map).toBeDefined()
    const source = map?.source ?? ''
    expect(source.indexOf('class="edge')).toBeGreaterThan(-1)
    expect(source.indexOf('class="edge')).toBeLessThan(source.indexOf('class="node'))
    const layout = layoutTrailMap(trail, input)
    const backEdges = trail.edges.filter(e => e.to.startsWith('agent:'))
    expect(backEdges.length).toBeGreaterThan(0)
    expect(layout.edges.some(e => backEdges.some(b => b.id === e.id))).toBe(false)
    expect(layout.droppedBackEdges).toBe(backEdges.length)
    // No edge segment enters a node box or a lane label box (except where it ends on its own target's side).
    const boxes = [...layout.nodes, ...layout.labels]
    const crossings: string[] = []
    for (const edge of layout.edges) {
      for (let i = 1; i < edge.points.length; i++) {
        const [x1, y1] = edge.points[i - 1] as [number, number]
        const [x2, y2] = edge.points[i] as [number, number]
        for (const box of boxes) {
          const inX = Math.max(Math.min(x1, x2), box.x + 1) < Math.min(Math.max(x1, x2), box.x + box.w - 1)
          const inY = Math.max(Math.min(y1, y2), box.y + 1) < Math.min(Math.max(y1, y2), box.y + box.h - 1)
          const horizontalIn = y1 === y2 && y1 > box.y + 1 && y1 < box.y + box.h - 1 && inX
          const verticalIn = x1 === x2 && x1 > box.x + 1 && x1 < box.x + box.w - 1 && inY
          if (horizontalIn || verticalIn) crossings.push(`${edge.id} through ${box.id}`)
        }
      }
    }
    expect(crossings).toEqual([])
  })

  test('the map carries an in-map legend, identity-tinted lanes, readable labels in the pane’s ink, and no dead tooltips', () => {
    const snapshot = trailSession()
    const { trail, spend } = analysesOf(snapshot)
    const input = { widthPx: 928, spend }
    const source = trailSvg(snapshot, trail, input)?.source ?? ''
    expect(source).toContain('LINKED')
    expect(source).toContain('INFERRED')
    expect(source).toMatch(/stroke-dasharray/)
    // Image mode shows no tooltip, so none is carried (Sunset Glass SG-9: the native list is the detail).
    expect(source).not.toContain('<title>')
    const fixer = identityHex(snapshot.agents.fixer) ?? 'missing'
    expect(source).toMatch(new RegExp(`<rect class="lane"[^>]*fill="${fixer}"`))
    // Text follows the pane's own ink (the renderer gives the root the pane's text colour), on dark and light alike.
    expect(source).toContain('fill:currentColor')
    const layout = layoutTrailMap(trail, input)
    expect(layout.labelChars).toBeGreaterThanOrEqual(18)
    expect(layout.labelChars).toBeLessThanOrEqual(24)
    expect(source.length).toBeLessThanOrEqual(MAP_MAX_SOURCE)
  })

  test('nodes are stage pills; edges keep their evidence hue, line and diamond; the selected path is warm, the rest dimmed but drawn', () => {
    const snapshot = trailSession()
    const { trail, spend } = analysesOf(snapshot)
    const layout = layoutTrailMap(trail, { widthPx: 928, spend })
    // Every drawn connection is a real trail edge, and every edge between drawn nodes is drawn.
    expect(layout.edges.every(e => trail.edges.includes(e.edge))).toBe(true)
    const plain = trailSvg(snapshot, trail, { widthPx: 928, spend }).source
    const pills = plain.match(/<rect class="pill"[^>]*>/g) ?? []
    expect(pills.length).toBe(layout.nodes.length)
    for (const pill of pills) expect(pill).toContain(`rx="${layout.nodes[0]?.h ? layout.nodes[0].h / 2 : -1}"`)
    const paths = plain.match(/<path d="[^"]*" class="edge [a-z]+"[^>]*>/g) ?? []
    expect(paths.length).toBe(layout.edges.length)
    const linked = paths.filter(p => p.includes('sa-dia-LINKED'))
    const inferred = paths.filter(p => p.includes('sa-dia-INFERRED'))
    expect(linked.length + inferred.length).toBe(paths.length)
    expect(linked.length).toBe(layout.edges.filter(e => e.edge.evidence === 'LINKED').length)
    for (const p of linked) {
      expect(p).toContain(`stroke="${SVG_HEX.link}"`)
      expect(p).not.toContain('stroke-dasharray')
    }
    for (const p of inferred) {
      expect(p).toContain(`stroke="${SVG_HEX.caution}"`)
      expect(p).toContain('stroke-dasharray')
    }
    // ◆ is filled, ◇ is hollow: the two diamonds differ as the list's connectors do.
    const marker = (kind: string) => plain.match(new RegExp(`<marker id="sa-dia-${kind}"[^]*?</marker>`))?.[0] ?? ''
    expect(marker('LINKED')).toContain(`fill="${SVG_HEX.link}"`)
    expect(marker('INFERRED')).toMatch(/fill-opacity="0\.\d+"/)
    expect(plain).not.toContain('class="halo"')
    // Selected: the path's edges glow coral under their own hue, the selected node is ringed, the rest dim but remain.
    const change = nodeOf(trail, 'implementer', 'change')
    const path = pathOf(trail, change.id)
    const drawnOnPath = layout.edges.filter(e => path.edges.has(e.id)).length
    const selected = trailSvg(snapshot, trail, { widthPx: 928, spend, selectedNodeId: change.id }).source
    const halos = selected.match(/<path d="[^"]*" class="halo"[^>]*>/g) ?? []
    expect(halos.length).toBe(drawnOnPath)
    for (const halo of halos) expect(halo).toContain(`stroke="${SVG_HEX.accent}"`)
    expect((selected.match(/class="edge on"/g) ?? []).length).toBe(drawnOnPath)
    expect((selected.match(/class="edge off"[^>]*opacity="0\.\d+"/g) ?? []).length).toBe(layout.edges.length - drawnOnPath)
    expect(selected).toMatch(new RegExp(`class="ring sel"[^>]*stroke="${SVG_HEX.accent}"`))
    const dimmed = (selected.match(/<g class="node" opacity="0\.\d+"/g) ?? []).length
    expect(dimmed).toBe(layout.nodes.length - 1 - [...path.nodes.keys()].filter(id => layout.nodes.some(n => n.id === id)).length)
    expect((selected.match(/<rect class="pill"/g) ?? []).length).toBe(layout.nodes.length)
  })

  test('a flagged node’s label leaves room for its ? (the two never overlap)', () => {
    const snapshot = trailSession()
    const { trail, spend } = analysesOf(snapshot)
    const layout = layoutTrailMap(trail, { widthPx: 928, spend })
    const source = trailSvg(snapshot, trail, { widthPx: 928, spend }).source
    const groups = source.match(/<g class="node"[^]*?<\/g>/g) ?? []
    const flagged = groups.filter(g => />\?<\/text>/.test(g))
    expect(flagged.length).toBeGreaterThan(0)
    for (const g of flagged) {
      const label = g.match(/class="t"[^>]*>([^<]*)<\/text>/)?.[1] ?? ''
      expect([...label.replace(/&[a-z]+;/g, '_')].length).toBeLessThanOrEqual(layout.labelChars - 3)
    }
  })

  test('an expanded pane gives the map more room: a wider drawing, larger type and longer labels', () => {
    const snapshot = trailSession()
    const { trail, spend } = analysesOf(snapshot)
    const at = (columns: number) => layoutTrailMap(trail, { widthPx: columns * CELL_PX, spend })
    expect(at(160).width).toBe(160 * CELL_PX)
    expect(at(160).fontSize).toBeGreaterThan(at(116).fontSize)
    expect(at(160).labelChars).toBeGreaterThan(at(116).labelChars)
    const svg = elements(render(snapshot, { width: 160, surface: 'desktop' }).tree).find(e => e.type === 'Svg')
    expect(String(svg?.props.source)).toContain(`viewBox="0 0 ${160 * CELL_PX} `)
    expect(String(svg?.props.source)).toContain('class="edge')
  })

  test('the selected node’s edges are emphasised in the map and the rest stay visible', () => {
    const snapshot = trailSession()
    const { trail, spend } = analysesOf(snapshot)
    const change = nodeOf(trail, 'implementer', 'change')
    const source = trailSvg(snapshot, trail, { widthPx: 928, spend, selectedNodeId: change.id })?.source ?? ''
    expect(source).toContain('class="edge on')
    expect(source).toContain('class="edge off')
  })

  test('narrower desktop panes never draw a miniature map: medium draws the stage overview, compact no chart, an empty trail no Svg', () => {
    const snapshot = trailSession()
    const medium = elements(render(snapshot, { width: 80, surface: 'desktop' }).tree).find(e => e.type === 'Svg')
    expect(medium).toBeDefined()
    expect(String(medium?.props.source)).not.toContain('class="edge')
    // Compact (Sunset Glass V-9): no miniature chart; the native lanes and their beads carry the flow.
    for (const width of [40, 49]) {
      const compact = render(snapshot, { width, surface: 'desktop' })
      expect(elements(compact.tree).some(e => e.type === 'Svg')).toBe(false)
      for (const lane of analysesOf(snapshot).trail.lanes) expect(compact.keys).toContain(`lane-${lane.agentId}`)
    }
    const empty = render(build(), { width: 116, surface: 'desktop' })
    expect(elements(empty.tree).some(e => e.type === 'Svg')).toBe(false)
  })
})

/** A desktop Button the desktop app can draw as it is: a plain label, no styled runs inside (R1 §4.1). */
function isPlainButton(button: Element): boolean {
  const styled = elements(childrenOf(button)).some(e => e.type === 'Text' && ['color', 'backgroundColor', 'weight', 'dimColor', 'bold'].some(k => e.props[k] !== undefined))
  return typeof button.props.label === 'string' && !styled
}

describe('trail: Sunset Glass lanes and outcome box', () => {
  test('desktop lane headers draw the identity chip beside a plain Button that keeps the lane- key and its action', () => {
    const snapshot = trailSession()
    for (const width of [80, 116, 160]) {
      const drawn = render(snapshot, { width, surface: 'desktop', ui: { focus: 'fixer' } })
      for (const id of ['explorer', 'implementer', 'tester', 'fixer', 'auditor', 'tidier']) {
        const button = elements(drawn.tree).find(e => e.type === 'Button' && e.props.key === `lane-${id}`)
        expect(button).toBeDefined()
        expect(isPlainButton(button as Element)).toBe(true)
        // The chip sits beside the Button, on its row, in the agent's own hue.
        const row = ancestorsOf(drawn.tree, button as Element).at(-1) as Element
        expect(row.props.flexDirection).toBe('row')
        const chip = elements(childrenOf(row)).find(e => e.type === 'Text' && e.props.backgroundColor === identityHex(snapshot.agents[id]))
        expect(chip).toBeDefined()
      }
      expect(String(elements(drawn.tree).find(e => e.props?.key === 'lane-fixer')?.props.label)).toContain('◂ focus')
      press(drawn, 'lane-tidier')
      expect(drawn.calls.toggleFocus).toEqual(['tidier'])
    }
    // Compact: the header still toggles the one open lane, its chip beside a plain Button too.
    const compact = render(snapshot, { width: 49, surface: 'desktop' })
    const header = elements(compact.tree).find(e => e.type === 'Button' && e.props.key === 'lane-fixer') as Element
    expect(isPlainButton(header)).toBe(true)
    const row = ancestorsOf(compact.tree, header).at(-1) as Element
    expect(elements(childrenOf(row)).some(e => e.type === 'Text' && e.props.backgroundColor === identityHex(snapshot.agents.fixer))).toBe(true)
    press(compact, 'lane-fixer')
    expect(compact.calls.toggleOpen).toEqual(['lane-fixer'])
    expect(compact.calls.toggleFocus).toEqual([])
  })

  test('the Trail’s own desktop Buttons hold only a plain label (lanes, nodes, beads, filters, the way to Spend)', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const selected = `node:${nodeOf(trail, 'implementer', 'change').id}`
    for (const width of [49, 80, 116]) {
      const drawn = render(snapshot, { width, surface: 'desktop', ui: { selected } })
      const mine = elements(drawn.tree).filter(e => e.type === 'Button' && /^(lane-|node-|tf-|open-spend)/.test(String(e.props.key)))
      expect(mine.length).toBeGreaterThan(5)
      expect(mine.filter(b => !isPlainButton(b)).map(b => b.props.key)).toEqual([])
    }
  })

  test('medium and wide lanes are glass cards edged in the agent’s identity; the terminal gets the round border without a fill', () => {
    const snapshot = trailSession()
    for (const surface of ['desktop', 'terminal'] as const) {
      const drawn = render(snapshot, { width: 116, surface })
      for (const id of ['explorer', 'fixer', 'tidier']) {
        const button = elements(drawn.tree).find(e => e.type === 'Button' && e.props.key === `lane-${id}`) as Element
        const card = ancestorsOf(drawn.tree, button).findLast(e => e.props.borderStyle === 'round')
        expect(card).toBeDefined()
        const hex = identityHex(snapshot.agents[id]) ?? 'missing'
        if (surface === 'desktop') {
          expect(String(card?.props.borderColor)).toMatch(new RegExp(`^${hex}[0-9a-f]{2}$`))
          expect(String(card?.props.backgroundColor)).toMatch(/^#[0-9a-f]{8}$/)
        } else {
          expect(card?.props.borderColor).toBe(hex)
          expect(card?.props.backgroundColor).toBeUndefined()
        }
      }
    }
  })

  test('desktop columns are Box cells: the stage gutter is a fixed-width cell, and no text is padded with runs of spaces', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const selected = `node:${nodeOf(trail, 'implementer', 'change').id}`
    for (const width of [80, 116, 160]) {
      const drawn = render(snapshot, { width, surface: 'desktop', ui: { selected, open: ['trail-denominator'] } })
      const gutters = elements(drawn.tree).filter(e => e.type === 'Box' && e.props.width === 13)
      const titles = new Set(gutters.flatMap(g => textStrings(childrenOf(g))).map(s => s.trim()))
      for (const stage of ['Delegation', 'Findings', 'Changes', 'Verification', 'Outcome']) expect(titles.has(stage)).toBe(true)
      const padded = elements(drawn.tree)
        .filter(e => e.type === 'Text')
        .flatMap(e => textStrings(childrenOf(e)))
        .filter(s => / {2,}/.test(s))
      expect(padded).toEqual([])
      // The selected node's evidence sits in a sunken glass panel under its row (the active theme's sunken fill).
      const evidence = elements(drawn.tree).find(e => e.type === 'Text' && textStrings(childrenOf(e)).join('').startsWith('evidence ·')) as Element
      expect(ancestorsOf(drawn.tree, evidence).some(e => e.props.borderStyle === 'round' && e.props.backgroundColor === GLASS.sunken)).toBe(true)
    }
  })

  test('the outcome box is a glass summary: count pills, the shared unresolved count “in Health”, the shared F3 bar and aligned bucket rows', () => {
    const snapshot = trailSession()
    const health = healthOf(snapshot)
    const n = unresolvedOf(health).length
    expect(n).toBeGreaterThan(0)
    const subs = subagents(snapshot)
    const drawn = render(snapshot, { width: 116, surface: 'desktop', health })
    const all = elements(drawn.tree)
    const panel = all.find(e => e.type === 'Box' && e.props.borderStyle === 'round' && textStrings(childrenOf(e)).join('').includes('Outcome so far'))
    expect(String(panel?.props.backgroundColor)).toMatch(/^#[0-9a-f]{8}$/)
    const box = elements(childrenOf(panel as Element))
    const pills = box.filter(e => e.type === 'Box' && e.props.borderStyle === 'round' && e.props.paddingY === 0).map(p => textStrings(childrenOf(p)).join(''))
    expect(pills.some(p => p.includes(`${subs.length} subagents`))).toBe(true)
    expect(pills.some(p => /\d+ files? changed/.test(p))).toBe(true)
    expect(pills.some(p => p.includes(`? ${n} unresolved`) && p.includes('in Health'))).toBe(true)
    // The F3 bar is the shared BucketBar: Box segments in the bucket colours on desktop, never a run of █ text.
    expect(box.some(e => e.type === 'Text' && textStrings(childrenOf(e)).some(s => s.includes('█')))).toBe(false)
    const segments = box.filter(e => e.type === 'Box' && typeof e.props.flexGrow === 'number' && e.props.backgroundColor !== undefined)
    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every(s => Object.values(BUCKET_ROLE).includes(String(s.props.backgroundColor)))).toBe(true)
    // Bucket rows: the label in a fixed-width cell, the same width on every row.
    const { spend } = analysesOf(snapshot)
    const labelCells = box.filter(e => e.type === 'Box' && typeof e.props.width === 'number' && textStrings(childrenOf(e)).join('').startsWith('■'))
    expect(labelCells.length).toBe(spend.buckets.length)
    expect(new Set(labelCells.map(c => c.props.width)).size).toBe(1)
    // The terminal keeps the one summary line with the same count.
    const terminal = render(snapshot, { width: 116, health })
    const summary = terminal.lines.find(l => l.includes('subagents')) ?? ''
    expect(summary).toContain(`? ${n} unresolved`)
    expect(summary).toContain('(in Health)')
    expect(summary).toContain(`${subs.length} subagents`)
  })
})

describe('trail: compact layout', () => {
  test('below 56 columns the lanes are collapsed, each a header and its stage beads, until one is opened', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const closed = render(snapshot, { width: 49 })
    expect(closed.lines.some(l => l.includes('⚑') && l.includes('FAILME'))).toBe(false)
    for (const lane of trail.lanes) expect(closed.keys).toContain(`lane-${lane.agentId}`)
    // Every node stays pressable as a bead while its lane is closed.
    for (const [l, lane] of trail.lanes.entries()) lane.nodes.forEach((_, n) => expect(closed.keys).toContain(`node-${l}-${n}`))
    const open = render(snapshot, { width: 49, ui: { open: ['lane-fixer'] } })
    expect(open.lines.some(l => l.includes('⚑') && l.includes('npm test -- cache FAILME') && l.includes('failed'))).toBe(true)
    expect(open.lines.some(l => l.includes('src/auth/token.ts ('))).toBe(false)
  })

  test('only one lane is open at a time: the last opened wins, and opening another closes the first', () => {
    const snapshot = trailSession()
    const both = render(snapshot, { width: 49, ui: { open: ['lane-fixer', 'lane-implementer'] } })
    expect(both.lines.some(l => l.includes('src/auth/token.ts ('))).toBe(true)
    expect(both.lines.some(l => l.includes('⚑') && l.includes('FAILME'))).toBe(false)
    const one = render(snapshot, { width: 49, ui: { open: ['lane-fixer'] } })
    press(one, 'lane-tidier')
    expect(one.calls.toggleOpen).toEqual(['lane-fixer', 'lane-tidier'])
    const closing = render(snapshot, { width: 49, ui: { open: ['lane-fixer'] } })
    press(closing, 'lane-fixer')
    expect(closing.calls.toggleOpen).toEqual(['lane-fixer'])
  })

  test('a closed lane with more nodes than fit shows the first beads and a count; opened, it lists them all', () => {
    const runs = Array.from({ length: 20 }, (_, i) => tool('busy', `b${i}`, 'Bash', { command: `npm test -- part${i}` }))
    const snapshot = build(spawn('busy', { description: 'run every part' }), ...runs.flat())
    const closed = render(snapshot, { width: 49 })
    const line = closed.lines.find(l => l.includes(headerOf(closed, 'busy'))) ?? ''
    expect(line).toContain('+8')
    expect(closed.keys.filter(k => k.startsWith('node-0-')).length).toBe(13)
    // Opened, a stage lists its first 8 nodes and counts the rest; "show up to 18 lanes and their nodes" lists more.
    const open = render(snapshot, { width: 49, ui: { open: ['lane-busy'] } })
    expect(open.keys.filter(k => k.startsWith('node-0-')).length).toBe(9)
    expect(open.lines.some(l => l.includes('+12 more in Verification'))).toBe(true)
    const all = render(snapshot, { width: 49, ui: { open: ['lane-busy', 'trail-all-lanes'] } })
    expect(all.keys.filter(k => k.startsWith('node-0-')).length).toBe(21)
  })

  test('selecting a bead opens its lane and draws the evidence under the node', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const check = nodeOf(trail, 'tester', 'verification')
    const { lines } = render(snapshot, { width: 49, ui: { selected: `node:${check.id}` } })
    const row = lines.findIndex(l => l.includes('▾') && l.includes('npm test -- token'))
    const evidence = lines.findIndex(l => l.includes('evidence ·'))
    expect(row).toBeGreaterThan(-1)
    expect(evidence).toBe(row + 1)
  })
})

/** Many agents: each delegated, two files changed, two checks run (one failing). SIMULATED. */
function crowdSession(agents: number): Snapshot {
  return build(
    ...Array.from({ length: agents }, (_, i) => [
      spawn(`ag${i}`, { description: `part ${i}`, prompt: `Fix src/part${i}a.ts and src/part${i}b.ts.` }),
      ...tool(`ag${i}`, `a${i}`, 'Edit', { file_path: `/repo/src/part${i}a.ts`, old_string: 'a', new_string: 'b' }),
      ...tool(`ag${i}`, `b${i}`, 'Edit', { file_path: `/repo/src/part${i}b.ts`, old_string: 'a', new_string: 'b' }),
      ...tool(`ag${i}`, `c${i}`, 'Bash', { command: `npm test -- part${i}a` }),
      ...tool(`ag${i}`, `d${i}`, 'Bash', { command: `npm test -- part${i}b` }, { isError: true, text: 'Exit code 1' }),
    ]).flat(),
  )
}

/** A report naming four files, four fixers with their own checks, and a QA agent whose checks name several files. */
function denseSession(): Snapshot {
  const names = ['alpha', 'beta', 'gamma', 'delta']
  return build(
    spawn('scout', { description: 'map the modules', prompt: 'Find where dates are parsed by hand.' }),
    turnStart('scout', 't-s'),
    ...tool('scout', 's1', 'Read', { file_path: '/repo/src/alpha.ts' }),
    turnEnd('scout', 't-s', 'Dates are parsed by hand in src/alpha.ts, src/beta.ts, src/gamma.ts and src/delta.ts.'),
    ...names.flatMap((name, i) => [
      spawn(`fix-${name}`, { description: `fix ${name}`, prompt: `Fix date parsing in src/${name}.ts.` }),
      ...tool(`fix-${name}`, `e-${name}`, 'Edit', { file_path: `/repo/src/${name}.ts`, old_string: 'a', new_string: 'b' }),
      ...tool(`fix-${name}`, `t-${name}`, 'Bash', { command: `npm test -- ${name}` }, i % 2 ? { isError: true, text: 'Exit code 1' } : { text: 'ok' }),
    ]),
    spawn('qa', { description: 'run the suites', prompt: 'Run the date suites.' }),
    ...tool('qa', 'q1', 'Bash', { command: 'npm test -- alpha beta gamma delta' }),
    ...tool('qa', 'q2', 'Bash', { command: 'npm run lint -- src/alpha.ts src/gamma.ts' }),
  )
}

type Segment = { x1: number; y1: number; x2: number; y2: number }

/** Whether two axis-aligned segments run along the same line and overlap for more than half a pixel. */
function collinearOverlap(a: Segment, b: Segment): boolean {
  const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2))
  if (a.y1 === a.y2 && b.y1 === b.y2 && a.y1 === b.y1) return overlap(a.x1, a.x2, b.x1, b.x2) > 0.5
  if (a.x1 === a.x2 && b.x1 === b.x2 && a.x1 === b.x1) return overlap(a.y1, a.y2, b.y1, b.y2) > 0.5
  return false
}

describe('trail: review findings', () => {
  test('"verified" never stands beside a ● without its ◇, in the bucket legend or the filter chip', () => {
    const snapshot = trailSession()
    const { lines } = render(snapshot, { width: 116 })
    const legend = lines.find(l => l.includes('■') && l.includes('verified'))
    expect(legend).toContain('◇ verified')
    expect(lines.filter(l => /(^|[^◇] )verified/.test(l) && !l.includes('◇ verified'))).toEqual([])
  })

  test('the unresolved filter also shows a lane whose outcome is unresolved for lack of evidence', () => {
    const snapshot = build(spawn('quiet'), turnStart('quiet', 't1'), turnEnd('quiet', 't1', ''), ...threeAgentSession())
    const { trail, spend } = analysesOf(snapshot)
    expect(badgeFor(spend, 'quiet')).toMatchObject({ bucket: 'unresolved', evidence: 'UNAVAILABLE' })
    const drawn = render(snapshot, { width: 116, ui: { trailFilter: 'unresolved' } })
    expect(drawn.keys).toContain('lane-quiet')
    expect(filterCounts(trail, spend).unresolved).toBeGreaterThanOrEqual(1)
  })

  test('a path with " (" in it is shown once, with its edit count', () => {
    const snapshot = build(spawn('w'), ...tool('w', 'e1', 'Edit', { file_path: '/repo/My Docs (copy)/notes.md', old_string: 'a', new_string: 'b' }))
    const { lines } = render(snapshot, { width: 116 })
    const row = lines.find(l => l.includes('✎') && l.includes('notes.md (1 edit)'))
    expect(row).toBeDefined()
    expect(row).not.toContain('(copy)/notes.md (copy)')
  })

  test('the map markup holds no lone surrogate and no non-character, whatever the text it clips', () => {
    const odd = `fix ${'😀'.repeat(30)} ￿ end`
    const snapshot = build(spawn('emoji', { description: odd }), ...tool('emoji', 'e1', 'Edit', { file_path: `/repo/src/${'😀'.repeat(20)}.ts`, old_string: 'a', new_string: 'b' }))
    const { trail, spend } = analysesOf(snapshot)
    for (const widthPx of [800, 928, 1120]) {
      const source = trailSvg(snapshot, trail, { widthPx, spend }).source
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(source)).toBe(false)
      expect(/[￾￿]/.test(source)).toBe(false)
    }
    expect(middleTruncate('😀😀😀😀😀😀', 4)).toBe('😀😀…😀')
    expect(middleTruncate('anything', 0)).toBe('')
  })

  test('edges with different ends never share a stretch of line in the map', () => {
    for (const snapshot of [trailSession(), denseSession()]) {
      const { trail, spend } = analysesOf(snapshot)
      const layout = layoutTrailMap(trail, { widthPx: 928, spend })
      expect(layout.edges.length).toBeGreaterThan(4)
      const segments = layout.edges.map(e => ({ e, segs: e.points.slice(1).map((p, i) => ({ x1: (e.points[i] as [number, number])[0], y1: (e.points[i] as [number, number])[1], x2: p[0], y2: p[1] })) }))
      const shared: string[] = []
      for (const a of segments) {
        for (const b of segments) {
          if (a.e.id >= b.e.id || a.e.edge.from === b.e.edge.from || a.e.edge.to === b.e.edge.to) continue
          if (a.segs.some(sa => b.segs.some(sb => collinearOverlap(sa, sb)))) shared.push(`${a.e.id} / ${b.e.id}`)
        }
      }
      expect(shared).toEqual([])
    }
  })

  test('the stale qualifier fits its line at the compact width', () => {
    const snapshot = trailSession()
    const { lines } = render(snapshot, { width: 49, ui: { open: ['lane-implementer'] } })
    const edge = lines.find(l => l.includes('╌◇→') && l.includes('before last edit'))
    expect(edge).toBeDefined()
    expect([...(edge ?? '')].length).toBeLessThanOrEqual(47)
  })

  test('a crowd of agents stays within the tree budget: lanes are capped, with a way to show more', () => {
    const snapshot = crowdSession(140)
    const analyses = analysesOf(snapshot)
    expect(analyses.trail.lanes.length).toBe(140)
    for (const width of [30, 49, 80, 116]) {
      for (const surface of ['terminal', 'desktop'] as const) {
        const drawn = render(snapshot, { width, surface, analyses })
        const size = treeSize(drawn.tree)
        expect(size.nodes).toBeLessThanOrEqual(2500)
        expect(size.depth).toBeLessThanOrEqual(15)
        expect(drawn.keys).toContain('dc-trail-all-lanes')
        expect(drawn.lines.some(l => /12 of 140 lanes/.test(l))).toBe(true)
        const all = render(snapshot, { width, surface, analyses, ui: { open: ['trail-all-lanes'] } })
        expect(treeSize(all.tree).nodes).toBeLessThanOrEqual(2500)
        expect(all.lines.some(l => /18 of 140 lanes/.test(l))).toBe(true)
      }
    }
    // A focused agent past the cap is still drawn.
    const focused = render(snapshot, { width: 116, analyses, ui: { focus: 'ag99' } })
    expect(focused.keys).toContain('lane-ag99')
  })

  test('a map too large for the source budget is not built, and the view falls back to the overview', () => {
    const snapshot = crowdSession(40)
    const analyses = analysesOf(snapshot)
    // Every lane (no cap): 200 nodes, past MAP_MAX_NODES: the map is not even built.
    const map = trailSvg(snapshot, analyses.trail, { widthPx: 928, spend: analyses.spend })
    expect(map.drawable).toBe(false)
    expect(map.source).toBe('')
    for (const open of [[], ['trail-all-lanes']]) {
      const drawn = render(snapshot, { width: 116, surface: 'desktop', analyses, ui: { open } })
      const svg = elements(drawn.tree).find(e => e.type === 'Svg')
      expect(svg).toBeDefined()
      expect(String(svg?.props.source).length).toBeLessThanOrEqual(MAP_MAX_SOURCE)
    }
  })
})

describe('trail: budget', () => {
  test('the Trail view stays within the tree budget on every layout and surface', () => {
    const snapshot = trailSession()
    const { trail } = analysesOf(snapshot)
    const selected = `node:${nodeOf(trail, 'implementer', 'change').id}`
    for (const width of [30, 49, 80, 116]) {
      for (const surface of ['terminal', 'desktop'] as const) {
        const size = treeSize(render(snapshot, { width, surface, ui: { selected, open: ['trail-denominator', 'lane-fixer'] } }).tree)
        expect(size.depth).toBeLessThanOrEqual(15)
        expect(size.nodes).toBeLessThanOrEqual(1500)
      }
    }
  })
})

// ── mounted: the real actions behind the compact lane headers ──

const PLUGIN = 'swarm-autopsy'
const SESSION = 'session-under-test'

function seeded(on: On, seed: Snapshot) {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.id', () => ({ value: SESSION }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', (_$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

const PANE = (bodyColumns: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
})

describe('trail: mounted', () => {
  test('compact lane headers open one lane at a time through the real actions', { timeoutMs: 60_000 }, async ($, on) => {
    seeded(on, { ...trailSession(), sessionId: SESSION })
    const ui = withClients(await $.ui.mount({ ...PANE(49), surface: 'terminal' }))
    await ui.press({ key: 'tab-trail' })
    const lines = async () => logicalLines((await ui.drawn()) as DrawnNode)
    const fixerOpen = (all: string[]) => all.some(l => l.includes('⚑') && l.includes('FAILME'))
    expect(fixerOpen(await lines())).toBe(false)
    await ui.press({ key: 'lane-fixer' })
    expect(fixerOpen(await lines())).toBe(true)
    await ui.press({ key: 'lane-implementer' })
    const after = await lines()
    expect(after.some(l => l.includes('src/auth/token.ts ('))).toBe(true)
    expect(fixerOpen(after)).toBe(false)
    await ui.press({ key: 'lane-implementer' })
    expect((await lines()).some(l => l.includes('src/auth/token.ts ('))).toBe(false)
    await ui.unmount()
  })
})
