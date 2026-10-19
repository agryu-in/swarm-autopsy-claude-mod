// The desktop pane over a still scene (every tab). The pane is drawn exactly the visible rows tall, so it never
// scrolls; in it, two Clients: the scene's background (scene-client.ts) as an absolute layer behind, and the header
// and the selected tab (content-client.ts) in front, scrolling inside their own region. The content is drawn by the
// same views as ever (PaneContent), then handed to its Client as plain data with each Button's handler kept here: a
// press inside the Client posts the Button's key, and `ui.message` runs that handler, so the UI state changes exactly
// as before.
//
// The safety net: when the content would not fit one Client (the page's 100,000 characters and 2,000 nodes), holds an
// element a Client cannot draw, or a Client of this pane faulted on the desktop (`ui.fault`), the pane draws the engine
// tree with the scene as a frame behind it and a dim note saying why. That frame follows scrolling (it lags, then snaps
// back), so after a fault it is only for a moment: a short wait, then a fresh pair of Clients (still-retry.ts).
// The terminal never comes here.

import type { EngineInterface, On, RenderElement } from 'claude-code'

import { clarityShare } from '../../lib/clarity.ts'
import { cleanMood, currentScene } from '../../lib/scenes.ts'
import { GLASS } from '../../lib/palette'
import { activeTheme } from '../../lib/themes'
import type { ViewContext } from '../common'
import { SceneToolbar, backgroundAlt, paintsGlass, sceneFigures, toolbarRows } from '../glass'
import { contentClientTree, type ContentClientProps, type Dress, type PressMessage } from './content-client'
import { PX_PER_COLUMN, PX_PER_ROW, type SceneClientProps } from './scene-client'
import { costOf, splitIntoParts, withPager } from './parts.ts'
import { flatten, PAGE_LIMITS, pageCount, type ClientElement, type ClientNode } from './shape.ts'
import { afterCooling, afterFault, afterOpen, clientKey, fallbackNote, FRESH, isClientKey, type RetryState } from './still-retry.ts'

export const CONTENT_CLIENT_KEY = 'sa-content'
export const SCENE_CLIENT_KEY = 'sa-scene'

/** The element types a Client's tree may hold on the page (its client-tree schema, 2.1.299). */
const DRAWABLE = new Set(['Box', 'Text', 'Button', 'Svg'])
/** Button props the engine knows; the page keeps key, label and plain, the test host all of them. */
const BUTTON_PROPS = ['key', 'label', 'hotkey', 'action', 'plain', 'dimColor', 'variant', 'role', 'autoFocus'] as const
const NOTE_REASON_CHARS = 140
/** Room the runtime takes on its way out of the module: each Button's closure becomes a numbered handle. */
const HANDLE_ROOM = 2_000
/** Characters one handle takes (`,"held":1234567`). */
const HANDLE_CHARS = 18
/** The display face for titles: the app's own serif, then the usual book faces. */
const DISPLAY_FONT = "var(--font-anthropic-serif), Georgia, 'Iowan Old Style', 'DejaVu Serif', serif"

// ── the state this module keeps for the session ──

/** Each drawn Button's handler by key, in document order: the last still drawing's, replaced on every one. */
let presses = new Map<string, Array<() => void>>()
/** After a Client of this pane failed on the desktop: the tries, the wait, and which pair of Clients draws now. */
let retry: RetryState = FRESH

/** Why the pane draws the engine tree now, after a fault; undefined while the Clients draw. */
export function stillFault(): string | undefined {
  return fallbackNote(retry)
}

/** A fault heard: the engine tree now, then (while this opening has tries left) a fresh pair of Clients after a wait. */
export function recordStillFault($: EngineInterface, input: { phase: string; reason: string }): void {
  const said = `${input.phase}: ${input.reason}`.replace(/\s+/g, ' ').trim()
  const heard = afterFault(retry, said.length > NOTE_REASON_CHARS ? `${said.slice(0, NOTE_REASON_CHARS - 1)}…` : said)
  retry = heard.state
  $.ui.invalidate('ui.render')
  if (heard.retryInMs === undefined) return
  $.clock.after(heard.retryInMs, () => {
    retry = afterCooling(retry)
    $.ui.invalidate('ui.render')
  })
}

/** The pane opened again (its command): a pane that had given up on its Clients tries them afresh. Whether it changed. */
export function reopenStillPane(): boolean {
  const before = retry
  retry = afterOpen(retry)
  return retry !== before
}

/** Forgets every fault: a cleared or resumed session tries the still scene again. */
export function clearStillFault(): void {
  retry = { ...FRESH, generation: retry.generation }
}

// ── the engine tree as plain data ──

type HookNode = { type?: unknown; props?: Record<string, unknown>; children?: unknown; onPress?: unknown }

/** Each converted Button's own handler, by the very element it became (a part keeps some of them, a pager adds its own). */
export type Handlers = Map<ClientElement, () => void>

type Converted = { tree: ClientNode; handlers: Handlers; refused?: string }

const primitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'

function childrenOf(node: HookNode): unknown[] {
  const own = node.children ?? node.props?.children
  if (own === undefined || own === null) return []
  return Array.isArray(own) ? own.flat(Infinity) : [own]
}

/** A drawn tree as a Client can carry it: primitive props only, no hover, each Button's handler kept aside. */
export function toClientTree(root: unknown): Converted {
  const handlers: Handlers = new Map()
  let refused: string | undefined
  const convert = (node: unknown): ClientNode | undefined => {
    if (typeof node === 'string') return node
    if (typeof node === 'number' && Number.isFinite(node)) return String(node)
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
    const el = node as HookNode
    const type = typeof el.type === 'string' ? el.type : 'unknown'
    if (!DRAWABLE.has(type)) {
      refused ??= type
      return undefined
    }
    const names = type === 'Button' ? BUTTON_PROPS : Object.keys(el.props ?? {})
    const props: Record<string, string | number | boolean> = {}
    for (const name of names) {
      const value = el.props?.[name]
      if (name !== 'children' && primitive(value)) props[name] = value
    }
    const children = childrenOf(el).flatMap(child => {
      const converted = convert(child)
      return converted === undefined ? [] : [converted]
    })
    const element = { type, ...(Object.keys(props).length > 0 ? { props } : {}), ...(children.length > 0 ? { children } : {}) } as ClientElement
    if (type === 'Button' && typeof el.onPress === 'function') handlers.set(element, el.onPress as () => void)
    return element
  }
  const tree = convert(root) ?? ''
  return { tree, handlers, ...(refused !== undefined ? { refused } : {}) }
}

/**
 * The handlers a drawn tree's Buttons run, by key, in document order: what a press inside the content Client names (its
 * key, and which of the Buttons with that key).
 */
export function pressesOf(tree: ClientNode, handlers: Handlers): Map<string, Array<() => void>> {
  const presses = new Map<string, Array<() => void>>()
  const walk = (node: ClientNode) => {
    if (typeof node === 'string') return
    if (node.type === 'Button') {
      const key = String(node.props?.key ?? '')
      const run = handlers.get(node)
      presses.set(key, [...(presses.get(key) ?? []), run ?? (() => undefined)])
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return presses
}

/** Keys of the pager a view in parts draws at its list's ends. */
export const PART_KEYS = { previous: 'sa-part-prev', next: 'sa-part-next' } as const

/**
 * The pager around a part's list: back to the previous part at its top, on to the next at its bottom, and where this
 * part sits. Plain elements, each Button's handler kept with the others.
 */
function pagerOf(ctx: ViewContext, index: number, count: number, handlers: Handlers): { before?: ClientNode; after?: ClientNode } {
  const button = (key: string, label: string, to: number, primary: boolean): ClientElement => {
    const element: ClientElement = { type: 'Button', props: { key, label, ...(primary ? { variant: 'primary' } : {}) } }
    handlers.set(element, () => ctx.act.part(to))
    return element
  }
  const where = (extra = ''): ClientElement => ({ type: 'Text', props: { dimColor: true, wrap: 'truncate-end' }, children: [`Part ${index + 1} of ${count}${extra}`] })
  // Rows that never wrap: a wrapping row must not mix buttons and text.
  const row = (key: string, gap: 'marginBottom' | 'marginTop', children: ClientNode[]): ClientElement => ({
    type: 'Box',
    props: { key, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', columnGap: 2, [gap]: 1 },
    children,
  })
  return {
    ...(index > 0 ? { before: row('sa-part-top', 'marginBottom', [button(PART_KEYS.previous, '▴ Previous part', index - 1, false), where()]) } : {}),
    after: row('sa-part-bottom', 'marginTop', index < count - 1 ? [where(), button(PART_KEYS.next, 'Next part ▾', index + 1, true)] : [where(' · the end')]),
  }
}

// ── the plan for one drawing ──

export type StillPlan =
  | { ok: true; content: ContentClientProps; scene: SceneClientProps; presses: Map<string, Array<() => void>> }
  | { ok: false; reason: string }

const count = (n: number) => n.toLocaleString('en-US')

/** The scene's design language for the page, in the active theme. */
export function dressOf(ctx: ViewContext): Dress {
  const theme = activeTheme()
  return {
    clarity: clarityShare(ctx.ui.glass),
    glass: { raised: GLASS.raised, fill: GLASS.fill, sunken: GLASS.sunken },
    edge: GLASS.edge,
    edgeStrong: GLASS.edgeStrong,
    accent: theme.chrome.accentHex,
    accent2: /^#[0-9a-f]{6}$/i.test(theme.chrome.rose) ? theme.chrome.rose : theme.chrome.accentHex,
    ink: theme.chrome.heading ?? '#e6edf3',
    muted: theme.chrome.neutral,
    base: theme.tint,
    display: DISPLAY_FONT,
  }
}

/** Whether this drawing is the desktop's, on a surface that draws Clients, with no fault this session. */
export function wantsStillPane(ctx: ViewContext): boolean {
  return ctx.surface === 'desktop' && paintsGlass(ctx) && 'Client' in ctx.els
}

/**
 * The still pane's Clients' props for the drawn content, or why it cannot be drawn: a fault this session, an element a
 * Client cannot draw, or a tree past the page's bounds (measured on the very tree the module will draw there).
 */
export function planStillPane(ctx: ViewContext, content: unknown): StillPlan {
  const fault = stillFault()
  if (fault !== undefined) return { ok: false, reason: fault }
  const converted = toClientTree(content)
  if (converted.refused !== undefined) return { ok: false, reason: `this view holds a ${converted.refused}, which a Client cannot draw` }
  const root: ClientElement = typeof converted.tree === 'string' ? { type: 'Box', children: [converted.tree] } : converted.tree
  // The content scrolls in the rows the toolbar leaves.
  const rows = Math.max(4, ctx.rows - toolbarRows(ctx))
  const dress = dressOf(ctx)
  const whole = measured(root, { rows, dress, place: ctx.ui.view })
  const chosen = whole.fits ? { tree: root, ...whole } : inParts(ctx, root, whole, { rows, dress }, converted.handlers)
  if (!chosen.fits) {
    return { ok: false, reason: `this view is too large for it (${count(whole.chars)} characters, ${count(whole.nodes)} elements)` }
  }
  const props = chosen.props
  const figures = sceneFigures(ctx)
  const scene: SceneClientProps = {
    scene: currentScene(cleanMood(ctx.ui.mood)).id,
    context: figures.context ?? -1,
    contextText: figures.contextText,
    swarm: figures.swarm,
    width: Math.round(ctx.width * PX_PER_COLUMN),
    height: Math.round(ctx.rows * PX_PER_ROW),
    rows: ctx.rows,
    columns: ctx.width,
    alt: backgroundAlt(ctx),
  }
  return { ok: true, content: props, scene, presses: pressesOf(chosen.tree, converted.handlers) }
}

type Measured = { props: ContentClientProps; chars: number; nodes: number; fits: boolean }

/** A content tree as the content Client would carry and draw it, measured against the page's bounds. */
function measured(tree: ClientElement, rest: Omit<ContentClientProps, 'tree'>): Measured {
  const props: ContentClientProps = { tree: flatten(tree), ...rest }
  const page = contentClientTree(props, { page: true, press: () => undefined })
  const chars = Math.max(JSON.stringify(page).length, JSON.stringify(props).length)
  const size = pageCount(page)
  // Each Button's closure becomes a numbered handle on the way out of the module: room for those too.
  const handles = HANDLE_ROOM + HANDLE_CHARS * JSON.stringify(page).split('"type":"Button"').length
  return { props, chars, nodes: size.nodes, fits: chars + handles <= PAGE_LIMITS.chars && size.nodes <= PAGE_LIMITS.nodes && size.depth <= PAGE_LIMITS.depth }
}

/** Budgets tried for a view in parts, as shares of the page's bounds: tighter when a part measured past them. */
const PART_SHARES = [0.92, 0.78, 0.64, 0.5] as const
/** What a part's pager takes, in the content's own characters and elements. */
const PAGER_COST = { chars: 900, nodes: 14 } as const

/**
 * A view too long for one Client, as the part the person is on (client/parts.ts): the whole view's ratio of page tree to
 * plain tree turns the page's bounds into a budget for the plain tree; the chosen part, pager added, is measured again
 * on the very tree the module will draw, and a tighter budget is tried while it does not fit.
 */
function inParts(ctx: ViewContext, root: ClientElement, whole: Measured, rest: Omit<ContentClientProps, 'tree' | 'place'>, handlers: Handlers): Measured & { tree: ClientElement } {
  const plain = costOf(root)
  const ratio = { chars: Math.max(1, whole.chars / plain.chars), nodes: Math.max(1, whole.nodes / plain.nodes) }
  for (const share of PART_SHARES) {
    const budget = {
      chars: Math.floor((PAGE_LIMITS.chars * share) / ratio.chars) - PAGER_COST.chars,
      nodes: Math.floor((PAGE_LIMITS.nodes * share) / ratio.nodes) - PAGER_COST.nodes,
    }
    const { parts, at } = splitIntoParts(root, budget)
    if (parts.length < 2 || at === undefined) break
    const index = Math.min(parts.length - 1, Math.max(0, Math.floor(ctx.ui.parts?.[ctx.ui.view] ?? 0)))
    const part = parts[index]!
    const tree = withPager(part, at, pagerOf(ctx, index, parts.length, handlers))
    // A new part (or tab) is a new place: the scroll area starts at its top there (content-client.ts's keeper).
    const drawn = measured(tree, { ...rest, place: `${ctx.ui.view}:${index}` })
    if (drawn.fits) return { tree, ...drawn }
  }
  return { tree: root, ...whole, fits: false }
}

/**
 * The still pane: exactly the visible rows tall and clipping (so it never scrolls), the scene's base colour, the scene
 * Client as an absolute layer, then in a positioned Box (its zero-size anchor, so it paints above the scene) the toolbar
 * (the app's own controls, fixed at the top) and under it the content Client, scrolling in the rows that are left.
 */
export function StillPane(ctx: ViewContext, plan: Extract<StillPlan, { ok: true }>): RenderElement {
  // wantsStillPane asked for a Client before any plan was made.
  if (!('Client' in ctx.els)) throw new Error('this surface draws no Client')
  const { Box, Client } = ctx.els
  presses = plan.presses
  return (
    <Box flexDirection="column" width={ctx.width} height={ctx.rows} overflow="hidden" backgroundColor={GLASS.tint}>
      <Box key="still-scene" position="absolute" top={0} left={0} width="100%" height={ctx.rows}>
        <Client key={clientKey(SCENE_CLIENT_KEY, retry)} module="./scene-client.ts" props={plan.scene} width="100%" height={ctx.rows} />
      </Box>
      <Box flexDirection="column" width="100%" height={ctx.rows}>
        <Box key="still-anchor" position="absolute" top={0} left={0} width={0} height={0} />
        {SceneToolbar(ctx)}
        <Client key={clientKey(CONTENT_CLIENT_KEY, retry)} module="./content-client.ts" props={plan.content} width="100%" height={plan.content.rows} />
      </Box>
    </Box>
  )
}

/** A press the content Client posted: its key and which Button with that key. Anything else is not one. */
function pressOf(data: unknown): PressMessage | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const { press, nth } = data as Partial<PressMessage>
  return typeof press === 'string' && typeof nth === 'number' && Number.isInteger(nth) && nth >= 0 ? { press, nth } : undefined
}

/** The pane's `ui.message` (a press inside the content Client) and `ui.fault` (either Client failed) hooks, for every pair. */
export function registerStillPane(on: On, paneId: string): void {
  on('ui.message', { requestId: paneId }, async (_$, e, next) => {
    if (!isClientKey(e.element, CONTENT_CLIENT_KEY)) return next(e)
    const press = pressOf(e.data)
    if (press) presses.get(press.press)?.[press.nth]?.()
    return {}
  })
  on('ui.fault', { requestId: paneId }, async ($, e, next) => {
    if (isClientKey(e.element, CONTENT_CLIENT_KEY) || isClientKey(e.element, SCENE_CLIENT_KEY)) recordStillFault($, e)
    return next(e)
  })
}
