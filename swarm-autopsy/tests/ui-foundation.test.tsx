// Sunset Glass · the lead's foundation (docs/sunset-glass/DESIGN-CONTRACT.md
// §3–§9, §12). Tokens, rounding, the one unresolved count, the surface-aware
// primitives (glass, bars, press rows, timeline cells) and the pane shell
// (backdrop, title, tabs, KPI tiles). Kit pieces are called with a stub context;
// the shell is mounted through the engine's own test host with a SIMULATED
// snapshot seeded through `state.get`. No live session, model or network.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { analyzeCollisions } from '../hooks/lib/collisions'
import { BUCKET_WORDS, pct } from '../hooks/lib/format'
import { applyUsage, buildLedgerView } from '../hooks/lib/ledger'
import { buildSpendOutcome } from '../hooks/lib/outcome'
import { CLASSIC, applyTheme, themeFor } from '../hooks/lib/themes'
import { BUCKET_ROLE, GLASS, ROLE, STATE_ROLE, TOKEN_CATEGORIES } from '../hooks/lib/palette'
import { PRICE_TABLE } from '../hooks/lib/pricing'
import { gatherSignals, unresolvedOf } from '../hooks/lib/signals'
import { buildTrail } from '../hooks/lib/trail'
import type { ViewContext } from '../hooks/ui/common'
import { EventLine } from '../hooks/ui/events'
import { BarStrip, GlassPanel, Meter, PressRow, StackedBar, glass } from '../hooks/ui/kit'
import { cleanText, cleanTree } from '../hooks/ui/clean'
import { ringSvg } from '../hooks/ui/svg'
import type { ForensicEvent, HealthSignal, Snapshot, UsageRecord } from '../types'
import { build, spawn, tool, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { logicalLines, type DrawnNode, withClients } from './view-helpers'

const PLUGIN = 'swarm-autopsy'
const NOW = 1_100_000
const OPUS = 'claude-opus-5-5'
const SLOW = { timeoutMs: 120_000 }
const TABS = ['live', 'trail', 'collisions', 'forensics', 'spend', 'health'] as const
/** Colours the terminal cannot paint as written: alpha hex and functional notations (R1 §2.4). */
const ALPHA_COLOUR = /#[0-9a-f]{8}\b|#[0-9a-f]{4}\b|rgba?\(|hsla?\(/i

// ── reading trees ──

type El = { type: string; props?: Record<string, unknown>; children?: unknown }

function kids(node: El): unknown[] {
  const own = node.children ?? node.props?.children
  if (own === undefined || own === null) return []
  return Array.isArray(own) ? own.flat(Infinity) : [own]
}

const isEl = (node: unknown): node is El => node !== null && typeof node === 'object' && typeof (node as El).type === 'string'

function all(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) all(child, out)
    return out
  }
  if (!isEl(node)) return out
  out.push(node)
  for (const child of kids(node)) all(child, out)
  return out
}

/** The text a node draws (Buttons by their label or children). */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!isEl(node)) return ''
  if (node.type === 'Button' && typeof node.props?.label === 'string') return node.props.label
  return kids(node).map(textOf).join('')
}

/** Every string prop value in the tree (colours, labels), Svg sources left out. */
function propStrings(node: unknown): string[] {
  return all(node).flatMap(el =>
    Object.entries(el.props ?? {})
      .filter(([key, value]) => key !== 'children' && key !== 'source' && typeof value === 'string')
      .map(([, value]) => value as string),
  )
}

// ── a stub context for kit pieces ──

function stub(surface: 'terminal' | 'desktop', width = 80, snapshot?: Snapshot): ViewContext {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  return {
    els: { Box: element('Box'), Text: element('Text'), Button: element('Button'), ...(surface === 'desktop' ? { Svg: element('Svg') } : {}) },
    surface,
    width,
    rows: 40,
    layout: width < 56 ? 'compact' : width < 100 ? 'medium' : 'wide',
    now: NOW,
    snapshot: snapshot ?? build(),
    ui: { view: 'live', filter: 'all', page: 0 },
    act: {},
  } as unknown as ViewContext
}

// ── a SIMULATED session: main and one active scout with no outcome yet ──

function session(variant: 'usage' | 'no-usage'): Snapshot {
  const base = build(
    turnStart(undefined, 'm-1'),
    spawn('scout', { type: 'Explore', description: 'map the auth module', prompt: 'Map src/auth.' }),
    turnStart('scout', 't-s'),
    ...tool('scout', 'r1', 'Read', { file_path: '/repo/src/auth/token.ts' }),
  )
  const usage = (agentId: string, index: number): UsageRecord =>
    usageRecord({
      agentId,
      turnId: agentId === 'main' ? 'm' : 's',
      index,
      at: NOW - 30_000 + index * 1000,
      tokens: variant === 'usage' ? tokens(20, 40_000 + index * 1000, 3_000, 500) : null,
      requestedModel: OPUS,
    })
  const records = [usage('main', 0), usage('main', 1), usage('scout', 0)]
  const snapshot = { ...base, sessionId: `ui-foundation-${variant}` }
  return {
    ...snapshot,
    ledger: records.reduce((ledger, record) => applyUsage(ledger, record), snapshot.ledger),
    context: { window: 1_000_000, tokens: 110_000, percent: 11, at: NOW - 1_000 },
  }
}

/** The register's analyses, built the same way (`register.tsx` analysesOf), for expected counts. */
function healthOf(snapshot: Snapshot): { health: HealthSignal[]; trailUnresolved: number } {
  const trail = buildTrail(snapshot)
  const ledger = buildLedgerView(snapshot.ledger, snapshot, { showCost: false, engineCostUsd: undefined, prices: PRICE_TABLE })
  const collisions = analyzeCollisions(snapshot)
  const spend = buildSpendOutcome(snapshot, trail, ledger)
  return { health: gatherSignals({ snapshot, trail, collisions, ledger, spend }), trailUnresolved: trail.outcome.unresolved }
}

const PANE = (bodyColumns: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
})

/** `opens`, when given, records the `columns` each `$.ui.open` asked for (undefined: the surface's own share). */
function seeded(on: On, seed: Snapshot, opens?: (number | undefined)[]) {
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: seed.sessionId ?? 'ui-foundation' }))
  on('ui.open', (_$, e) => {
    opens?.push(e.columns)
    return { value: { isPlaced: true } }
  })
  on('state.get', (_$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

type Ui = {
  drawn: () => Promise<unknown>
  press: (args: { key: string }) => Promise<unknown>
  find: (query: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined>
  unmount: () => Promise<unknown>
}

async function mount($: Engine, surface: 'terminal' | 'desktop', width: number, view: (typeof TABS)[number] = 'live'): Promise<Ui> {
  const ui: Ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
  await ui.press({ key: `tab-${view}` })
  return ui
}

async function lines(ui: Ui): Promise<string[]> {
  return logicalLines((await ui.drawn()) as DrawnNode)
}

// ── tokens and rounding ──

describe('Sunset Glass tokens', () => {
  test('pct rounds to one decimal first, then picks the format', () => {
    expect(pct(9.96)).toBe('10%')
    expect(pct(9.99)).toBe('10%')
    expect(pct(9.94)).toBe('9.9%')
    expect(pct(4.2)).toBe('4.2%')
    expect(pct(10.4)).toBe('10%')
    expect(pct(5)).toBe('5%')
    expect(pct(0.05)).toBe('<0.1%')
    expect(pct(undefined)).toBe('n/a')
  })

  test('the ring prints its percentage with pct, like the text beside it', () => {
    expect(ringSvg({ percent: 9.94, measure: 'ESTIMATED' })?.alt).toContain('≈9.9%')
    expect(ringSvg({ percent: 9.96, measure: 'OBSERVED' })?.alt).toContain('10%')
  })

  test('planMode is retired: green means verified only, and the active state is the context cyan', () => {
    const roles = [...Object.values(ROLE), ...Object.values(STATE_ROLE), ...Object.values(BUCKET_ROLE), ...TOKEN_CATEGORIES.map(c => c.role)]
    expect(roles).not.toContain('planMode')
    expect(STATE_ROLE.active).toBe(ROLE.context)
    // In classic (the terminal), green is the theme's success key and only verified wears it.
    applyTheme(CLASSIC)
    const classic = [...Object.values(ROLE), ...Object.values(STATE_ROLE), ...Object.values(BUCKET_ROLE), ...TOKEN_CATEGORIES.map(c => c.role)]
    expect(ROLE.ok).toBe('success')
    expect(classic.filter(r => r === 'success')).toEqual(['success', 'success'])
    applyTheme(themeFor('desktop'))
  })

  test('unresolved and unknown usage are drawn in the quiet unknown fill, never the bright secondary text', () => {
    expect(BUCKET_ROLE.unresolved).toBe(ROLE.unknownFill)
    expect(BUCKET_ROLE['no-usage-recorded']).toBe(ROLE.unknownFill)
  })

  test('token categories are four distinct 6-digit hex colours, the same on every surface', () => {
    const hexes = TOKEN_CATEGORIES.map(c => c.role)
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(hexes).size).toBe(4)
    expect(TOKEN_CATEGORIES.map(c => c.hex)).toEqual(hexes)
  })

  test('glass tokens are translucent hex for the desktop; the pane background and bar track are solid', () => {
    for (const [key, value] of Object.entries(GLASS)) expect({ key, ok: (key === 'tint' || key === 'track' ? /^#[0-9a-f]{6}$/ : /^#[0-9a-f]{8}$/).test(String(value)) }).toEqual({ key, ok: true })
  })

  test('one bucket wording for every view', () => {
    expect(BUCKET_WORDS['changed-unverified']).toBe('changed, unverified')
    expect(BUCKET_WORDS['no-usage-recorded']).toBe('no usage recorded')
    expect(BUCKET_WORDS['report-only']).toBe('report only')
  })
})

// ── the one unresolved count ──

describe('one unresolved count (SG-U)', () => {
  test('unresolvedOf keeps the findings at level unresolved, never a value-only entry', () => {
    const signal = (id: string, level: HealthSignal['level']): HealthSignal => ({
      id,
      source: 'outcome',
      level,
      evidence: level === 'unresolved' ? 'UNRESOLVED' : 'OBSERVED',
      title: id,
      why: id,
      agentIds: [],
      eventIds: [],
    })
    const health = [signal('a', 'unresolved'), signal('b', 'observed'), signal('c', 'unresolved'), signal('ctx:main:percent', 'observed')]
    expect(unresolvedOf(health).map(s => s.id)).toEqual(['a', 'c'])
  })

  test('the status row, the signals tile, the Trail outcome box and the Health heading draw the same count', SLOW, async ($: Engine, on: On) => {
    const seed = session('usage')
    const { health, trailUnresolved } = healthOf(seed)
    const n = unresolvedOf(health).length
    // The case that drew "0 unresolved" beside three unresolved findings: the trail has no unresolved flag.
    expect(n).toBeGreaterThan(0)
    expect(trailUnresolved).not.toBe(n)
    seeded(on, seed)
    const live = await mount($, 'desktop', 116)
    const header = (await lines(live)).join('\n')
    expect(header.match(new RegExp(`\\? ${n} unresolved`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(header).not.toMatch(/\b0 unresolved/)
    await live.unmount()
    const trail = await mount($, 'terminal', 116, 'trail')
    const box = (await lines(trail)).join('\n').split('Contribution flow')[0] ?? ''
    expect(box).toMatch(new RegExp(`\\? ${n} unresolved`))
    await trail.unmount()
    const tab = await mount($, 'terminal', 116, 'health')
    const heading = (await lines(tab)).find(l => /Swarm health/.test(l)) ?? ''
    expect(heading).toMatch(new RegExp(`\\? ${n} unresolved`))
    await tab.unmount()
  })
})

// ── surface-aware primitives ──

describe('glass surfaces', () => {
  test('desktop glass is a translucent round panel; the terminal gets a round border and no fill', () => {
    const desk = glass(stub('desktop'), 'raised')
    expect(desk.borderStyle).toBe('round')
    expect(String(desk.backgroundColor)).toMatch(/^#[0-9a-f]{8}$/)
    const term = glass(stub('terminal'), 'raised')
    expect(term.borderStyle).toBe('round')
    expect(term.backgroundColor).toBeUndefined()
    expect(String(term.borderColor ?? '')).not.toMatch(ALPHA_COLOUR)
  })

  test('an edge tint stays opaque on the terminal', () => {
    const term = glass(stub('terminal'), 'base', '#8b5cf6')
    expect(term.borderColor).toBe('#8b5cf6')
    const desk = glass(stub('desktop'), 'base', '#8b5cf6')
    expect(String(desk.borderColor)).toMatch(/^#8b5cf6[0-9a-f]{2}$/)
  })

  test('a glass panel carries its title and children on both surfaces', () => {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ctx = stub(surface)
      const { Text } = ctx.els
      const panel = GlassPanel(ctx, { tone: 'base', title: 'Recent activity', summary: 'last 5', children: <Text>row</Text> })
      expect(textOf(panel)).toContain('Recent activity')
      expect(textOf(panel)).toContain('row')
    }
  })
})

describe('bars that never wrap', () => {
  const parts = [
    { value: 10, role: TOKEN_CATEGORIES[0]!.role },
    { value: 600, role: TOKEN_CATEGORIES[1]!.role },
    { value: 300, role: TOKEN_CATEGORIES[2]!.role },
    { value: 90, role: TOKEN_CATEGORIES[3]!.role },
  ]

  test('desktop: a block bar is Box segments sized by integer weights, with no glyph to overflow', () => {
    const bar = BarStrip(stub('desktop'), parts, 40)
    expect(textOf(bar)).not.toContain('█')
    const segments = all(bar).filter(el => el.type === 'Box' && el.props?.flexGrow !== undefined)
    expect(segments).toHaveLength(4)
    for (const segment of segments) {
      expect(Number.isInteger(segment.props?.flexGrow)).toBe(true)
      expect(Number(segment.props?.flexGrow)).toBeGreaterThan(0)
      expect(Number(segment.props?.flexGrow)).toBeLessThanOrEqual(10_000)
      expect(segment.props?.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(all(bar)[0]?.props?.width).toBe(40)
  })

  test('terminal: the same block bar is cell-exact █ text', () => {
    const bar = BarStrip(stub('terminal'), parts, 40)
    expect(textOf(bar).replace(/[^█]/g, '')).toHaveLength(40)
  })

  test('inline text bars and meters are drawn in the monospaced face, so a desktop █ is one cell', () => {
    for (const drawn of [StackedBar(stub('desktop'), parts, 20), Meter(stub('desktop'), { percent: 40, measure: 'OBSERVED', width: 10 })]) {
      const barRuns = all(drawn).filter(el => el.type === 'Text' && /[█▏▎▍▌▋▊▉·]/.test(textOf(el)) && !kids(el).some(isEl))
      expect(barRuns.length).toBeGreaterThan(0)
      for (const run of barRuns) expect(run.props?.mono).toBe(true)
    }
  })
})

describe('press rows (the whole-card press, §9)', () => {
  function row(surface: 'terminal' | 'desktop') {
    const ctx = stub(surface)
    const { Text } = ctx.els
    let pressed = 0
    const drawn = PressRow(ctx, {
      key: 'cardrow-a-2',
      onPress: () => {
        pressed += 1
      },
      lead: <Text backgroundColor="#0891b2">{' A '}</Text>,
      children: [
        <Text color={ROLE.caution}>≈</Text>,
        <Text> 9.9% of 1.0M · </Text>,
        <Text color="text">●</Text>,
        <Text> prompt 99k</Text>,
      ],
    })
    return { drawn, presses: () => pressed }
  }

  test('terminal: one plain Button holding the styled runs, the lead included', () => {
    const { drawn, presses } = row('terminal')
    const button = all(drawn).find(el => el.type === 'Button')
    expect(button?.props?.key).toBe('cardrow-a-2')
    expect(button?.props?.plain).toBe(true)
    expect(textOf(button)).toBe(' A ≈ 9.9% of 1.0M · ● prompt 99k')
    expect(all(button).some(el => el.type === 'Text' && el.props?.color === ROLE.caution)).toBe(true)
    ;(button?.props?.onPress as () => void)()
    expect(presses()).toBe(1)
  })

  test('desktop: the label is the plain text of the line; the styled lead sits beside the Button, never inside it', () => {
    const { drawn, presses } = row('desktop')
    const button = all(drawn).find(el => el.type === 'Button')
    expect(button?.props?.key).toBe('cardrow-a-2')
    expect(button?.props?.plain).toBe(true)
    expect(button?.props?.label).toBe('≈ 9.9% of 1.0M · ● prompt 99k')
    expect(kids(button!)).toHaveLength(0)
    expect(textOf(drawn)).toContain(' A ')
    ;(button?.props?.onPress as () => void)()
    expect(presses()).toBe(1)
  })
})

describe('timeline rows align on desktop (§8)', () => {
  const event = (seq: number, summary: string): ForensicEvent =>
    ({
      id: `e${seq}`,
      seq,
      at: 1_000_000 + seq * 1000,
      agentId: 'main',
      kind: 'tool',
      summary,
      tool: { name: 'Read', access: 'read' },
      outcome: { status: 'ok' },
    }) as unknown as ForensicEvent

  test('desktop: the status sits in its own fixed-width cell on every row', () => {
    const ctx = stub('desktop', 116)
    const rows = [event(1, 'Read a.ts'), event(12, 'Read a much longer path/to/somewhere/deep/file.ts')].map(e => EventLine(ctx, e, 116, true))
    const statusCells = rows.map(r => all(r).find(el => el.type === 'Box' && textOf(el).trim() === 'ok'))
    for (const cell of statusCells) expect(typeof cell?.props?.width).toBe('number')
    expect(statusCells[0]?.props?.width).toBe(statusCells[1]?.props?.width)
  })

  test('terminal: today’s padded text line is unchanged', () => {
    const line = textOf(EventLine(stub('terminal', 116), event(1, 'Read a.ts'), 116, true))
    expect(line).toMatch(/^#\s+1 /)
    expect(line.trimEnd()).toMatch(/ ok$/)
  })
})

// ── the pane shell ──

describe('pane shell', () => {
  test('desktop: the pane never scrolls; the scene is a still layer the pane tall, the content scrolls in front of it; every tab; the terminal draws none', SLOW, async ($: Engine, on: On) => {
    // The pane is exactly the visible rows tall and clips; the scene Client fills it as an absolute layer, the content
    // Client scrolls inside its own region in front. Whatever the scroll offset, the drawing is the same.
    const seed = session('usage')
    seeded(on, seed)
    for (const [offset, rows] of [[0, 30], [7, 40]] as const) {
      for (const view of TABS) {
        const desk: Ui = withClients(await $.ui.mount({ ...PANE(116), props: { ...PANE(116).props, scroll: { offset, bodyRows: rows } }, surface: 'desktop' }))
        await desk.press({ key: `tab-${view}` })
        const root = (await desk.drawn()) as El
        const children = kids(root).filter(isEl)
        expect(root.props).toMatchObject({ backgroundColor: GLASS.tint, height: rows, overflow: 'hidden' })
        expect(children.length).toBe(2)
        const scene = children[0] as El
        expect({ view, props: scene.props }).toMatchObject({ view, props: { key: 'still-scene', position: 'absolute', top: 0, left: 0, width: '100%', height: rows } })
        const pictures = all(scene).filter(el => el.type === 'Svg')
        expect(pictures.length).toBe(1)
        const picture = pictures[0] as El
        expect(String(picture.props?.alt).trim()).not.toBe('')
        expect(Number(picture.props?.width)).toBeLessThanOrEqual(4096)
        expect(Number(picture.props?.height)).toBeLessThanOrEqual(4096)
        expect(String(picture.props?.source)).toMatch(/preserveAspectRatio="xMidYMid slice"/)
        // The content: the header first (its theme line), every tab's own view after it.
        const content = children[1] as El
        expect({ view, tabs: all(content).some(el => el.type === 'Button' && el.props?.key === `tab-${view}`) }).toEqual({ view, tabs: true })
        await desk.unmount()
      }
    }
    const term = await mount($, 'terminal', 116)
    const termRoot = (await term.drawn()) as El
    expect(termRoot.props?.backgroundColor).toBeUndefined()
    expect(all(termRoot).some(el => el.props?.position === 'absolute' || el.type === 'Svg' || el.type === 'Client')).toBe(false)
    await term.unmount()
  })

  test('every picture the desktop draws passes the desktop app\'s own check, on every tab: an alt with words, a source and a size within its bounds', SLOW, async ($: Engine, on: On) => {
    // The app parses each drawn tree before painting (desktop 2.1.299 bundle: Svg alt `string().trim().min(1)`, source at
    // most 131,072 characters, width and height at most 4,096). A picture that fails is silently replaced by nothing:
    // every empty-alt backdrop (dusk wash, horizon bands, fence, the Abyssal scene) vanished this way in the real pane.
    const seed = session('usage')
    seeded(on, seed)
    for (const width of [49, 116]) {
      for (const view of TABS) {
        const desk = await mount($, 'desktop', width, view)
        const pictures = all(await desk.drawn()).filter(el => el.type === 'Svg')
        const rejected = pictures.filter(el => {
          const p = el.props ?? {}
          const size = (v: unknown) => v === undefined || (typeof v === 'number' && v > 0 && v <= 4096)
          return typeof p.alt !== 'string' || p.alt.trim() === '' || typeof p.source !== 'string' || p.source.length === 0 || p.source.length > 131_072 || !size(p.width) || !size(p.height)
        })
        expect({ width, view, rejected: rejected.map(el => String(el.props?.alt).slice(0, 40)) }).toEqual({ width, view, rejected: [] })
        await desk.unmount()
      }
    }
  })

  test('no alpha colour ever reaches the terminal, on any tab or width', SLOW, async ($: Engine, on: On) => {
    const seed = session('usage')
    seeded(on, seed)
    for (const width of [49, 80, 116]) {
      for (const view of TABS) {
        const ui = await mount($, 'terminal', width, view)
        const bad = propStrings(await ui.drawn()).filter(value => ALPHA_COLOUR.test(value))
        expect({ width, view, bad }).toEqual({ width, view, bad: [] })
        await ui.unmount()
      }
    }
  })

  test('desktop: every █ is drawn in the monospaced face or as a Box, on every tab', SLOW, async ($: Engine, on: On) => {
    const seed = session('usage')
    seeded(on, seed)
    for (const width of [116, 160]) {
      for (const view of TABS) {
        const ui = await mount($, 'desktop', width, view)
        const loose = all(await ui.drawn()).filter(
          el => el.type === 'Text' && el.props?.mono !== true && kids(el).some(c => typeof c === 'string' && c.includes('█')),
        )
        expect({ width, view, loose: loose.length }).toEqual({ width, view, loose: 0 })
        await ui.unmount()
      }
    }
  })

  test('the title is in title case, and a tab badge reads as a count in parentheses', SLOW, async ($: Engine, on: On) => {
    const seed = session('usage')
    const n = healthOf(seed).health.filter(s => s.id !== 'ctx:main:percent').length
    seeded(on, seed)
    const ui = await mount($, 'desktop', 116)
    const text = (await lines(ui)).join('\n')
    expect(text).toContain('Swarm Autopsy')
    expect(text).not.toContain('SWARM AUTOPSY')
    expect(String((await ui.find({ key: 'tab-health' }))?.props?.label)).toBe(`Health (${n})`)
    await ui.unmount()
  })

  test('desktop: no wider/narrower button, since the app sizes its dock itself and ignores a requested width', SLOW, async ($: Engine, on: On) => {
    // Desktop 2.1.299 bundle: the roster keeps a pane's `columns` but the dock never reads it; its width is the one the
    // person drags (280 to 640 px). A button asking for a width there changed nothing (the person's report, 2026-10-18).
    seeded(on, session('usage'))
    for (const width of [49, 116, 160]) {
      const desk = await mount($, 'desktop', width)
      expect({ width, wide: await desk.find({ key: 'toggle-wide' }) }).toEqual({ width, wide: undefined })
      expect({ width, pause: (await desk.find({ key: 'toggle-pause' }))?.props?.label }).toEqual({ width, pause: '⏸ pause' })
      await desk.unmount()
    }
  })

  test('terminal: wider asks the dock for 120 columns, narrower for its own share, the label following', SLOW, async ($: Engine, on: On) => {
    const opens: (number | undefined)[] = []
    seeded(on, session('usage'), opens)
    const term = await mount($, 'terminal', 116)
    expect((await term.find({ key: 'toggle-wide' }))?.props?.label).toBe('⇔ wider')
    opens.length = 0
    await term.press({ key: 'toggle-wide' })
    expect((await term.find({ key: 'toggle-wide' }))?.props?.label).toBe('⇔ narrower')
    expect(opens).toEqual([120])
    await term.press({ key: 'toggle-wide' })
    expect((await term.find({ key: 'toggle-wide' }))?.props?.label).toBe('⇔ wider')
    expect(opens).toEqual([120, undefined])
    await term.unmount()
  })

  test('the tokens tile reads usage unknown, never an observed zero, when every request came back without usage', SLOW, async ($: Engine, on: On) => {
    const seed = session('no-usage')
    seeded(on, seed)
    const ui = await mount($, 'desktop', 116)
    const text = (await lines(ui)).join('\n')
    const tile = text.slice(text.indexOf('tokens processed')).split('main context')[0] ?? ''
    expect(tile).toMatch(/∅ usage unknown/)
    expect(tile).not.toMatch(/●\s*0\b/)
    await ui.unmount()
  })
})

// ── captured text never stops the pane drawing ──

describe('captured text with control characters', () => {
  /** A command and output as a terminal leaves them: colour escapes, a carriage return, a NUL, half an emoji. */
  const NASTY = 'npm test \u001b[31mFAIL\u001b[0m\r\u0000 \ud83d done'

  function dirty(): Snapshot {
    const base = build(
      turnStart(undefined, 'm-1'),
      spawn('scout', { type: 'Explore', description: `map ${NASTY}`, prompt: `Run ${NASTY}` }),
      turnStart('scout', 't-s'),
      ...tool('scout', 'b1', 'Bash', { command: NASTY }, { text: `out ${NASTY}\r\n` }),
    )
    return { ...base, sessionId: 'ui-foundation-dirty' }
  }

  test('cleanText strips terminal escapes and control characters, keeps tab and newline in text, and mends split emoji', () => {
    expect(cleanText('a\u001b[31mb\u001b[0mc')).toBe('abc')
    expect(cleanText('a\rb\u0000c\u007fd')).toBe('a b c d')
    expect(cleanText('one\ttwo\nthree')).toBe('one\ttwo\nthree')
    expect(cleanText('one\ttwo\nthree', { oneLine: true })).toBe('one two three')
    expect(cleanText('x\ud83dy')).toBe('x�y')
    expect(cleanText('ok 😀')).toBe('ok 😀')
    // The engine's own placeholder code point is refused like a control character.
    expect(cleanText('a\u{10eeee}b')).toBe('a b')
  })

  test('cleanTree drops or bounds every number and colour the engine would refuse the whole drawing for', () => {
    // The engine's rules (2.1.299): sizes finite 0–10,000; other numbers finite within ±10,000; position offsets whole
    // cells; colours a theme key, a name or hex (/^[#a-zA-Z0-9_().,% -]{1,40}$/); Svg width and height 1–4,096 pixels.
    const tree = {
      type: 'Box',
      props: { width: Number.NaN, height: -3, minWidth: 20_000, flexGrow: Number.POSITIVE_INFINITY, marginLeft: -12_000, top: 1.6, backgroundColor: 'not a colour!', borderColor: '#ffffff0d' },
      children: [
        { type: 'Text', props: { color: '', weight: 'bold' }, children: ['fine'] },
        { type: 'Svg', props: { source: '<svg/>', alt: 'a', width: 9000, height: Number.NaN } },
      ],
    }
    const out = cleanTree(tree) as unknown as { props: object; children: Array<{ props: object }> }
    expect(out.props).toEqual({ height: 0, minWidth: 10_000, marginLeft: -10_000, top: 2, borderColor: '#ffffff0d' })
    expect(out.children[0]?.props).toEqual({ weight: 'bold' })
    expect(out.children[1]?.props).toEqual({ source: '<svg/>', alt: 'a', width: 4096 })
    // A percentage size and a sound tree pass through unchanged.
    expect(cleanTree({ type: 'Box', props: { width: '50%', flexGrow: 3, color: 'claude' }, children: [] })).toEqual({ type: 'Box', props: { width: '50%', flexGrow: 3, color: 'claude' }, children: [] })
  })

  test('every tab still draws on both surfaces, and no control character reaches the tree', SLOW, async ($: Engine, on: On) => {
    seeded(on, dirty())
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const width of [49, 116]) {
        for (const view of TABS) {
          const ui = await mount($, surface, width, view)
          const tree = JSON.stringify(await ui.drawn())
          expect({ surface, width, view, control: /\\u00(0[0-8]|0b|0c|0e|0f|1[0-9a-f]|7f)|\\r|\\u001b/i.test(tree) }).toEqual({ surface, width, view, control: false })
          await ui.unmount()
        }
      }
    }
  })
})
