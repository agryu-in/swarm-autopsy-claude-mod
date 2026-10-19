// Scene themes: each scene's palette recolours the pane's chrome (its solid
// background, headings, marks, glass) and nothing that carries meaning. Headings
// read the scene's ink; the classic theme, and so the terminal, keeps its own text
// colour and draws exactly what it drew before, with no scene and no pickers.
// Kit pieces are called with a stub context; the pane is mounted through the
// engine's own test host with a SIMULATED snapshot seeded through `state.get`.
// No live session, model or network.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { applyUsage } from '../hooks/lib/ledger'
import { BUCKET_ROLE, IDENTITY_HEX, ROLE, STATE_ROLE, SVG_HEX, TOKEN_CATEGORIES } from '../hooks/lib/palette'
import { contrast as wcag, distance, over as overHex, toLch } from '../hooks/lib/color.ts'
import { SCENES, SCENE_IDS, cleanMood } from '../hooks/lib/scenes.ts'
import { CLASSIC, DEFAULT_THEME, THEMES, applyTheme, themeFor, type ThemeTokens } from '../hooks/lib/themes'
import type { ViewContext } from '../hooks/ui/common'
import { EmptyState, Heading } from '../hooks/ui/kit'
import type { Snapshot, UsageRecord } from '../types'
import { build, spawn, tool, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { withClients } from './view-helpers'

const PLUGIN = 'swarm-autopsy'
const NOW = 1_100_000
const SLOW = { timeoutMs: 120_000 }
const TABS = ['live', 'trail', 'collisions', 'forensics', 'spend', 'health'] as const

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

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!isEl(node)) return ''
  if (node.type === 'Button' && typeof node.props?.label === 'string') return node.props.label
  return kids(node).map(textOf).join('')
}

/** The innermost Text runs that draw exactly `words` (surrounding spaces aside). */
function runsOf(node: unknown, words: string): El[] {
  return all(node).filter(el => el.type === 'Text' && !kids(el).some(isEl) && textOf(el).trim() === words)
}

/** Every string prop value in the tree (colours, labels), Svg sources left out. */
function propStrings(node: unknown): string[] {
  return all(node).flatMap(el =>
    Object.entries(el.props ?? {})
      .filter(([key, value]) => key !== 'children' && key !== 'source' && typeof value === 'string')
      .map(([, value]) => value as string),
  )
}

// ── colour arithmetic (WCAG 2.x relative luminance) ──

function channels(hex: string): { rgb: [number, number, number]; alpha: number } {
  const h = hex.slice(1)
  const at = (i: number) => parseInt(h.slice(i, i + 2), 16)
  return { rgb: [at(0), at(2), at(4)], alpha: h.length === 8 ? at(6) / 255 : 1 }
}

/** `top` (6- or 8-digit hex) composited over the opaque `under`, as 6-digit hex. */
function over(top: string, under: string): string {
  const t = channels(top)
  const u = channels(under).rgb
  return `#${t.rgb.map((c, i) => Math.round(c * t.alpha + (u[i] ?? 0) * (1 - t.alpha)).toString(16).padStart(2, '0')).join('')}`
}

function luminance(hex: string): number {
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = channels(hex).rgb
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}


/** The background picture behind the pane (an Svg keeps no key of its own: found in the scene layer). */
const backgroundArt = (root: unknown): El | undefined => all(all(root).find(el => el.props?.key === 'still-scene')).find(el => el.type === 'Svg')

/** Every surface a heading or mark can sit on: the scene's base, and each glass tone over it. */
function surfaces(theme: ThemeTokens): string[] {
  return [theme.tint, over(theme.glass.fill, theme.tint), over(theme.glass.raised, theme.tint), over(theme.glass.sunken, theme.tint)]
}

const SCENE_THEMES = SCENE_IDS.map(id => THEMES[id])
const DEFAULT = THEMES[DEFAULT_THEME]

// ── a stub context for kit pieces ──

function stub(surface: 'terminal' | 'desktop'): ViewContext {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  return {
    els: { Box: element('Box'), Text: element('Text'), Button: element('Button'), ...(surface === 'desktop' ? { Svg: element('Svg') } : {}) },
    surface,
    width: 116,
    rows: 40,
    layout: 'wide',
    now: NOW,
    snapshot: build(),
    ui: { view: 'live', filter: 'all', page: 0 },
    act: {},
  } as unknown as ViewContext
}

/** Runs `draw` with the theme the render hook would apply for `surface`, then restores the desktop's. */
function drawnOn<T>(surface: 'terminal' | 'desktop', draw: (ctx: ViewContext) => T): T {
  applyTheme(themeFor(surface))
  try {
    return draw(stub(surface))
  } finally {
    applyTheme(themeFor('desktop'))
  }
}

// ── a SIMULATED session: main and one active scout ──

function session(): Snapshot {
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
      tokens: tokens(20, 40_000 + index * 1000, 3_000, 500),
      requestedModel: 'claude-opus-5-5',
    })
  const records = [usage('main', 0), usage('main', 1), usage('scout', 0)]
  const snapshot = { ...base, sessionId: 'ui-theme' }
  return {
    ...snapshot,
    ledger: records.reduce((ledger, record) => applyUsage(ledger, record), snapshot.ledger),
    context: { window: 1_000_000, tokens: 110_000, percent: 11, at: NOW - 1_000 },
  }
}

const PANE = (bodyColumns: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
})

function seeded(on: On, seed: Snapshot, store = new Map<string, unknown>()) {
  mock.clock(on, { now: NOW })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.id', () => ({ value: seed.sessionId ?? 'ui-theme' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', (_$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

type Ui = { drawn: () => Promise<unknown>; press: (args: { key: string }) => Promise<unknown>; unmount: () => Promise<unknown> }

async function mount($: Engine, surface: 'terminal' | 'desktop', width: number, view: (typeof TABS)[number]): Promise<Ui> {
  const ui: Ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
  await ui.press({ key: `tab-${view}` })
  return ui
}

/** A heading each tab draws through the kit (or the Health strip), whose title takes the theme's heading colour. */
const TAB_HEADING: Partial<Record<(typeof TABS)[number], string>> = {
  live: 'Health',
  trail: 'Contribution flow',
  forensics: 'Forensics',
  health: 'Swarm health',
}

// ── tokens ──

describe('scene themes', () => {
  test('the desktop draws the chosen scene (the cemetery by default); the terminal is always classic', () => {
    expect(themeFor('desktop')).toBe(DEFAULT)
    expect(DEFAULT.id).toBe('fogbound-cemetery')
    for (const id of SCENE_IDS) expect(themeFor('desktop', id).id).toBe(id)
    expect(themeFor('desktop', 'abyssal')).toBe(DEFAULT)
    expect(themeFor('terminal')).toBe(CLASSIC)
    expect(themeFor('terminal', 'crooked-manor')).toBe(CLASSIC)
  })

  test('each scene recolours the pane: its base is the solid background, its ink the headings, its light the marks', () => {
    for (const id of SCENE_IDS) {
      const theme = THEMES[id]
      const p = SCENES[id].palette
      expect({ id, tint: theme.tint, heading: theme.chrome.heading, accent: theme.chrome.accent }).toEqual({ id, tint: p.base, heading: p.ink, accent: p.accent })
      expect(theme.tint).toMatch(/^#[0-9a-f]{6}$/)
      for (const [key, value] of Object.entries(theme.chrome)) if (key !== 'subMark') expect({ id, key, value: /^#[0-9a-f]{6}$/.test(String(value)) }).toEqual({ id, key, value: true })
      for (const [key, value] of Object.entries(theme.glass)) if (key !== 'track') expect({ id, key, value: /^#[0-9a-f]{8}$/.test(String(value)) }).toEqual({ id, key, value: true })
    }
  })

  test('the heading role follows the theme; classic keeps the surface’s own text colour', () => {
    applyTheme(THEMES['mire-lights'])
    expect(ROLE.heading).toBe(SCENES['mire-lights'].palette.ink)
    applyTheme(CLASSIC)
    expect(ROLE.heading).toBeUndefined()
    applyTheme(themeFor('desktop'))
  })

  test('every scene gives each meaning its own colour: green still verified, red still a failure, the context its own light', () => {
    for (const id of SCENE_IDS) {
      const theme = THEMES[id]
      const d = theme.data
      expect(d).toBeDefined()
      if (!d) continue
      // The context gauge is the light the scene draws its gauge with (the clock face's gold in the clocktower).
      expect(d.context).toBe(id === 'clocktower' ? SCENES[id].palette.accent2 : SCENES[id].palette.accent)
      applyTheme(theme)
      expect([ROLE.context, ROLE.ok, ROLE.fail, ROLE.caution, ROLE.link, ROLE.analytic, ROLE.main]).toEqual([d.context, d.ok, d.fail, d.caution, d.link, d.analytic, d.main])
      expect(TOKEN_CATEGORIES.map(c => c.hex)).toEqual([d.tokens.input, d.tokens.cacheRead, d.tokens.cacheWrite, d.tokens.output])
      expect([SVG_HEX.context, SVG_HEX.ok, SVG_HEX.fail]).toEqual([d.context, d.ok, d.fail])
      expect({ id, bucket: BUCKET_ROLE.verified, state: STATE_ROLE.active }).toEqual({ id, bucket: d.ok, state: d.context })
      // Each meaning keeps its hue family: verified greenish, a failure reddish, caution warm.
      const hue = (hex: string) => toLch(hex).h
      expect({ id, ok: hue(d.ok) > 110 && hue(d.ok) < 190 }).toEqual({ id, ok: true })
      expect({ id, fail: hue(d.fail) < 45 || hue(d.fail) > 340 }).toEqual({ id, fail: true })
      expect({ id, caution: hue(d.caution) > 25 && hue(d.caution) < 115 }).toEqual({ id, caution: true })
    }
    applyTheme(CLASSIC)
    expect([ROLE.ok, ROLE.fail, ROLE.caution, ROLE.main]).toEqual(['success', 'error', 'warning', 'claude'])
    expect(TOKEN_CATEGORIES.map(c => c.hex)).toEqual(['#6f9cf0', '#3f6fd1', '#a17ee8', '#e879a6'])
    applyTheme(themeFor('desktop'))
  })

  test('in every scene the meaning colours read on its glass and stay apart from each other', () => {
    for (const id of SCENE_IDS) {
      const theme = THEMES[id]
      const d = theme.data
      if (!d) throw new Error(`no data palette for ${id}`)
      const glassUnder = overHex(theme.glass.raised, theme.tint)
      const text = { context: d.context, ok: d.ok, fail: d.fail, caution: d.caution, link: d.link, analytic: d.analytic, main: d.main }
      for (const [role, hex] of Object.entries(text)) expect({ id, role, readable: wcag(hex, glassUnder) >= 4.5 }).toEqual({ id, role, readable: true })
      const apart = (set: Record<string, string>, least: number) => {
        const entries = Object.entries(set)
        for (let i = 0; i < entries.length; i++)
          for (let j = i + 1; j < entries.length; j++) {
            const [a, x] = entries[i]!
            const [b, y] = entries[j]!
            expect({ id, a, b, apart: distance(x, y) >= least }).toEqual({ id, a, b, apart: true })
          }
      }
      apart(text, 0.065)
      apart(d.tokens, 0.08)
      apart(Object.fromEntries(d.identity.map((hex, i) => [`identity ${i}`, hex])), 0.1)
      // An identity chip's letter reads on every chip.
      for (const hex of d.identity) expect({ id, hex, chip: wcag(d.chipText, hex) >= 4.5 }).toEqual({ id, hex, chip: true })
    }
  })

  test('text chrome reads at 4.5:1 or better on the background and every glass tone; marks at 3:1, in every scene', () => {
    for (const theme of SCENE_THEMES) {
      const { heading, neutral, accent, rose, violet } = theme.chrome
      for (const surface of surfaces(theme)) {
        for (const [role, hex] of Object.entries({ heading, neutral })) {
          expect({ theme: theme.id, role, surface, readable: contrast(hex ?? '', surface) >= 4.5 }).toEqual({ theme: theme.id, role, surface, readable: true })
        }
        for (const [role, hex] of Object.entries({ accent, rose, violet })) {
          expect({ theme: theme.id, role, surface, visible: contrast(hex, surface) >= 3 }).toEqual({ theme: theme.id, role, surface, visible: true })
        }
      }
    }
  })

  test('glass edges stay hairlines: visible on the background, quieter than the headings', () => {
    for (const theme of SCENE_THEMES) {
      for (const edge of [theme.glass.edge, theme.glass.edgeStrong]) {
        const drawn = over(edge, theme.tint)
        expect({ theme: theme.id, edge, visible: contrast(drawn, theme.tint) >= 1.8 }).toEqual({ theme: theme.id, edge, visible: true })
        expect(contrast(drawn, theme.tint)).toBeLessThan(contrast(theme.chrome.heading ?? '', theme.tint))
      }
      expect(luminance(over(theme.glass.edgeStrong, theme.tint))).toBeGreaterThan(luminance(over(theme.glass.edge, theme.tint)))
    }
  })

  test('panels lift off the background (fill and raised lighter), the sunken tone sinks below it', () => {
    for (const theme of SCENE_THEMES) {
      expect({ theme: theme.id, lifted: luminance(over(theme.glass.raised, theme.tint)) > luminance(theme.tint) }).toEqual({ theme: theme.id, lifted: true })
      expect({ theme: theme.id, lifted: luminance(over(theme.glass.fill, theme.tint)) > luminance(theme.tint) }).toEqual({ theme: theme.id, lifted: true })
      expect({ theme: theme.id, sunk: luminance(over(theme.glass.sunken, theme.tint)) < luminance(theme.tint) }).toEqual({ theme: theme.id, sunk: true })
    }
  })
})

// ── kit chrome ──

describe('kit headings follow the theme', () => {
  test('desktop: a section heading and a sub-heading draw their titles in the heading colour, under the theme’s marks', () => {
    const [section, sub, mark, subMark] = drawnOn('desktop', ctx => {
      const h1 = Heading(ctx, 'Signals', { summary: '2' })
      const h2 = Heading(ctx, 'Trail flags', { level: 2 })
      return [runsOf(h1, 'Signals')[0], runsOf(h2, 'Trail flags')[0], runsOf(h1, '▌')[0], runsOf(h2, DEFAULT.chrome.subMark)[0]]
    })
    expect(section?.props?.color).toBe(DEFAULT.chrome.heading)
    expect(sub?.props?.color).toBe(DEFAULT.chrome.heading)
    expect(mark?.props?.color).toBe(DEFAULT.chrome.accent)
    expect(subMark?.props?.color).toBe(DEFAULT.chrome.rose)
  })

  test('desktop: an empty state’s title is a heading, its glyph housekeeping', () => {
    const [title, glyph] = drawnOn('desktop', ctx => {
      const drawn = EmptyState(ctx, 'No agent selected.', 'Press a card.', { glyph: '○' })
      return [runsOf(drawn, 'No agent selected.')[0] ?? all(drawn).find(el => el.type === 'Text' && textOf(el).includes('No agent selected.')), runsOf(drawn, '○')[0]]
    })
    expect(title?.props?.color).toBe(DEFAULT.chrome.heading)
    expect(glyph?.props?.color).toBe(DEFAULT.chrome.neutral)
  })

  test('terminal: the same headings carry no colour key at all, and the sub-heading keeps its rose ·, exactly as before themes', () => {
    const [titles, dot] = drawnOn('terminal', ctx => {
      const h2 = Heading(ctx, 'Trail flags', { level: 2 })
      return [[...runsOf(Heading(ctx, 'Signals', { summary: '2' }), 'Signals'), ...runsOf(h2, 'Trail flags')], runsOf(h2, '·')[0]] as const
    })
    expect(titles.length).toBe(2)
    for (const title of titles) expect(Object.hasOwn(title.props ?? {}, 'color')).toBe(false)
    expect(dot?.props?.color).toBe(CLASSIC.chrome.rose)
  })

  test('Svg chrome follows the theme’s accent as hex (Svg takes no theme keys); classic keeps its own', () => {
    applyTheme(THEMES.clocktower)
    expect(SVG_HEX.accent).toBe(SCENES.clocktower.palette.accent)
    applyTheme(CLASSIC)
    expect(SVG_HEX.accent).toBe('#d77757')
    applyTheme(themeFor('desktop'))
  })
})

// ── the mounted pane ──

describe('the pane in a scene', () => {
  test('desktop: the scene still behind every tab, the content over it in the scene’s design language', SLOW, async ($: Engine, on: On) => {
    seeded(on, session())
    for (const view of TABS) {
      const ui = await mount($, 'desktop', 116, view)
      const root = (await ui.drawn()) as El
      // The pane never scrolls: exactly the visible rows, the scene's base colour, the scene layer behind the content.
      expect({ view, props: root.props }).toMatchObject({ view, props: { backgroundColor: DEFAULT.tint, height: 60, overflow: 'hidden' } })
      const art = backgroundArt(root)
      expect({ view, alt: String(art?.props?.alt ?? '').startsWith('Background: Fogbound Cemetery: Every agent leaves a stone. Main context 11%') }).toEqual({ view, alt: true })
      // The scene's gauge is drawn (the lantern's oil), without its caption: the header carries the figure.
      expect(String(art?.props?.source ?? '')).toContain('sa-fogbound-cemetery-bg-oil')
      expect(String(art?.props?.source ?? '')).not.toContain('LANTERN')
      // The toolbar, fixed above the content: the mode and the scene as the app's own dropdowns; under the title the
      // scene's name and motto.
      for (const key of ['sa-pick-mode', 'sa-pick-scene']) expect({ view, key, drawn: all(root).some(el => el.type === 'Select' && el.props?.key === key) }).toEqual({ view, key, drawn: true })
      expect(textOf(root)).toContain('Fogbound Cemetery · Every agent leaves a stone.')
      const title = runsOf(root, 'Swarm Autopsy')[0]
      expect({ view, title: title?.props?.color }).toEqual({ view, title: DEFAULT.chrome.heading })
      const heading = TAB_HEADING[view]
      if (heading) {
        const runs = runsOf(root, heading).filter(el => el.props?.weight === 'semibold')
        expect({ view, heading, colours: runs.map(el => el.props?.color) }).toEqual({ view, heading, colours: runs.map(() => DEFAULT.chrome.heading) })
        expect(runs.length).toBeGreaterThan(0)
      }
      const tiles = all(root).filter(el => el.type === 'Box' && el.props?.backgroundColor === DEFAULT.glass.raised && textOf(el).includes('main context'))
      expect({ view, tiles: tiles.length > 0, edge: tiles.at(-1)?.props?.borderColor }).toEqual({ view, tiles: true, edge: DEFAULT.glass.edgeStrong })
      // The selected tab is a secondary Button in a lit glass capsule (never the app's white primary); the others are bare.
      const capsule = all(root).find(el => el.props?.key === `sel-tab-${view}`)
      const tab = all(capsule).find(el => el.type === 'Button' && el.props?.key === `tab-${view}`)
      expect({ view, edge: capsule?.props?.borderColor, variant: tab?.props?.variant }).toEqual({ view, edge: DEFAULT.glass.selected, variant: 'secondary' })
      await ui.unmount()
    }
  })

  test('desktop: choosing a mode or scene in the toolbar recolours the whole pane at once and keeps the choice for every chat', SLOW, async ($: Engine, on: On) => {
    const store = new Map<string, unknown>()
    seeded(on, session(), store)
    const ui = (await mount($, 'desktop', 116, 'live')) as Ui & { select: (args: { key: string; value: string }) => Promise<unknown> }
    // The two categories, in the mode dropdown.
    let root = await ui.drawn()
    const modeSelect = all(root).find(el => el.type === 'Select' && el.props?.key === 'sa-pick-mode')
    expect((modeSelect?.props?.options as Array<{ value: string; label: string }>).map(o => o.label)).toEqual(['Spooky', 'Cozy'])
    // Mode: Cozy brings its remembered scene, the cat café; the scene list follows the mode.
    await ui.select({ key: 'sa-pick-mode', value: 'cozy' })
    root = await ui.drawn()
    expect((root as El).props?.backgroundColor).toBe(THEMES['cat-cafe'].tint)
    expect(String(backgroundArt(root)?.props?.alt)).toMatch(/^Background: Rainy Cat Café:/)
    expect(runsOf(root, 'Swarm Autopsy')[0]?.props?.color).toBe(THEMES['cat-cafe'].chrome.heading)
    const sceneSelect = all(root).find(el => el.type === 'Select' && el.props?.key === 'sa-pick-scene')
    expect((sceneSelect?.props?.options as Array<{ value: string }>).map(o => o.value)).toEqual([
      'cat-cafe',
      'fireside-tea',
      'golden-porch',
      'sunset-pier',
      'flower-shop',
      'forest-cabin',
    ])
    await ui.select({ key: 'sa-pick-scene', value: 'sunset-pier' })
    root = await ui.drawn()
    expect((root as El).props?.backgroundColor).toBe(THEMES['sunset-pier'].tint)
    expect(store.get('mood')).toEqual({ mode: 'cozy', sceneByMode: { spooky: 'fogbound-cemetery', cozy: 'sunset-pier' } })
    // Back to Spooky: its six scenes, its remembered one.
    await ui.select({ key: 'sa-pick-mode', value: 'spooky' })
    root = await ui.drawn()
    expect((root as El).props?.backgroundColor).toBe(THEMES['fogbound-cemetery'].tint)
    const spooky = all(root).find(el => el.type === 'Select' && el.props?.key === 'sa-pick-scene')
    expect((spooky?.props?.options as Array<{ value: string }>).length).toBe(6)
    await ui.unmount()
  })

  test('a mood kept from before the two categories opens as Spooky, on the scene it was showing', () => {
    expect(cleanMood({ mode: 'midnight', sceneByMode: { 'gray-hour': 'drowned-lighthouse', midnight: 'crooked-manor', witching: 'mire-lights' } })).toEqual({
      mode: 'spooky',
      sceneByMode: { spooky: 'crooked-manor', cozy: 'cat-cafe' },
    })
    expect(cleanMood({ mode: 'witching', sceneByMode: { witching: 'mire-lights' } })).toEqual({ mode: 'spooky', sceneByMode: { spooky: 'mire-lights', cozy: 'cat-cafe' } })
    expect(cleanMood({ mode: 'cozy', sceneByMode: { cozy: 'mire-lights' } })).toEqual({ mode: 'cozy', sceneByMode: { spooky: 'fogbound-cemetery', cozy: 'cat-cafe' } })
    expect(cleanMood('nonsense')).toEqual({ mode: 'spooky', sceneByMode: { spooky: 'fogbound-cemetery', cozy: 'cat-cafe' } })
  })

  test('a new chat opens on the scene the store holds', SLOW, async ($: Engine, on: On) => {
    const store = new Map<string, unknown>([['mood', { mode: 'cozy', sceneByMode: { spooky: 'mire-lights', cozy: 'flower-shop' } }]])
    seeded(on, session(), store)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/repo' }))
    on('session.turns', () => ({ value: 0 }))
    on('agent.list', () => ({ value: [] }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
    const ui = await mount($, 'desktop', 116, 'live')
    const root = await ui.drawn()
    expect((root as El).props?.backgroundColor).toBe(THEMES['flower-shop'].tint)
    expect(String(backgroundArt(root)?.props?.alt)).toMatch(/^Background: Twilight Flower Shop:/)
    await ui.unmount()
  })

  test('terminal: no scene colour, scene or picker reaches any tab at any width, and the title keeps its own text colour', SLOW, async ($: Engine, on: On) => {
    seeded(on, session())
    const sceneColours = new Set(SCENE_THEMES.flatMap(theme => [theme.tint, ...Object.values(theme.glass), ...Object.values(theme.chrome)]).filter(v => v !== undefined && v !== '▎'))
    for (const width of [49, 116]) {
      for (const view of TABS) {
        const ui = await mount($, 'terminal', width, view)
        const root = await ui.drawn()
        const leaked = propStrings(root).filter(value => sceneColours.has(value))
        expect({ width, view, leaked }).toEqual({ width, view, leaked: [] })
        expect({ width, view, scene: all(root).some(el => String(el.props?.key ?? '').startsWith('sa-') || el.type === 'Client') }).toEqual({ width, view, scene: false })
        const title = runsOf(root, 'Swarm Autopsy')[0]
        expect({ width, view, coloured: Object.hasOwn(title?.props ?? {}, 'color') }).toEqual({ width, view, coloured: false })
        const tab = all(root).find(el => el.type === 'Button' && el.props?.key === `tab-${view}`)
        expect({ width, view, variant: tab?.props?.variant }).toEqual({ width, view, variant: 'primary' })
        await ui.unmount()
      }
    }
  })
})
