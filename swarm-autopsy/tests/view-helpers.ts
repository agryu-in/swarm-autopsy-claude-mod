// Shared test helpers for the visual redesign (lead-owned). No `$`, no engine:
// no-op view actions for stub contexts, and a flattening of a drawn tree into
// logical lines (a Text, a Button, or a row Box's children joined), which is
// what the pane-wide acceptance scans read. A logical line is not a painted
// line: a long Text may wrap on screen, but its labels and numbers stay on the
// same logical line, which is the scope of DESIGN-CONTRACT §4.1.

import type { Actions } from '../hooks/ui/common'

const noop = () => undefined

/** Every action as a no-op; spread it and override the ones a test records. */
export const NOOP_ACTIONS: Actions = {
  view: noop,
  select: noop,
  filter: noop,
  agentFilter: noop,
  page: noop,
  openEvent: noop,
  toggleCost: noop,
  focus: noop,
  toggleFocus: noop,
  toggleOpen: noop,
  trailFilter: noop,
  liveFilter: noop,
  requestWidth: noop,
  showNode: noop,
  togglePause: noop,
  mode: noop,
  scene: noop,
  play: noop,
  volume: noop,
  glass: noop,
  part: noop,
}

/** A drawn tree node as `ui.drawn()` returns it. */
export type DrawnNode = string | number | boolean | null | undefined | { type: string; props?: Record<string, unknown>; children?: DrawnNode[] }

function kids(node: Exclude<DrawnNode, string | number | boolean | null | undefined>): DrawnNode[] {
  const fromProps = node.props?.children
  if (Array.isArray(node.children)) return node.children
  if (Array.isArray(fromProps)) return fromProps as DrawnNode[]
  return fromProps === undefined ? [] : [fromProps as DrawnNode]
}

/** The text a node draws on one line, Buttons as `[label]` or their Text children. */
export function inline(node: DrawnNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  // A decorative Svg (empty alt, like an HTML img with alt="") draws no information: the Sunset Glass backdrop.
  if (node.type === 'Svg') return node.props?.alt === '' ? '' : `[svg: ${String(node.props?.alt ?? '')}]`
  if (node.type === 'Button') {
    const body = kids(node).map(inline).join('')
    const label = typeof node.props?.label === 'string' ? node.props.label : ''
    return node.props?.plain ? body || label : `[${label || body}]`
  }
  return kids(node).map(inline).join('')
}

/** The tree as logical lines: each Text and Button one line, a row Box's children joined into one line. */
export function logicalLines(node: DrawnNode): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (node.type === 'Text' || node.type === 'Button' || node.type === 'Svg') {
    const text = inline(node)
    return text.trim() ? [text] : []
  }
  const children = kids(node)
  if (node.props?.flexDirection === 'row') {
    const joined = children
      .map(child => logicalLines(child).join(' '))
      .filter(part => part.trim() !== '')
      .join(' ')
    return joined.trim() ? [joined] : []
  }
  return children.flatMap(logicalLines)
}

// ── drawings with Clients (THEME-PLAN §4B: the desktop Live tab is drawn by two Clients) ──

type Query = { key?: string; type?: string; text?: string | RegExp; in?: string }
/** The part of a mounted drawing these helpers use. */
type Mounted = {
  drawn: (scope?: { in?: string }) => Promise<unknown>
  find: (query: Query) => Promise<unknown>
  findAll?: (query: Query) => Promise<unknown[]>
}

const isNode = (node: unknown): node is { type: string; props?: Record<string, unknown>; children?: unknown[] } =>
  node !== null && typeof node === 'object' && typeof (node as { type?: unknown }).type === 'string'

/** Every Client's key in a drawn tree, in document order. */
export function clientKeys(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) clientKeys(child, out)
    return out
  }
  if (!isNode(node)) return out
  if (node.type === 'Client' && typeof node.props?.key === 'string') out.push(node.props.key)
  for (const child of node.children ?? []) clientKeys(child, out)
  return out
}

/** A drawn tree with each Client replaced by what its module drew: the drawing as the person sees it. */
async function spliced(node: unknown, drawnIn: (key: string) => Promise<unknown>): Promise<unknown> {
  if (Array.isArray(node)) return Promise.all(node.map(child => spliced(child, drawnIn)))
  if (!isNode(node)) return node
  if (node.type === 'Client' && typeof node.props?.key === 'string') return drawnIn(node.props.key)
  if (!Array.isArray(node.children)) return node
  return { ...node, children: await Promise.all(node.children.map(child => spliced(child, drawnIn))) }
}

/**
 * A mounted drawing whose `drawn()` reads every Client's module drawing in its place, and whose `find`/`findAll` search
 * the Clients too: so a test reads the desktop Live tab's facts and buttons as it read them before the Clients.
 * Presses already reach a Client's Buttons by key. Everything else is the handle's own.
 */
export function withClients<T extends Mounted>(ui: T): T {
  const drawn = async (scope?: { in?: string }) => {
    if (scope?.in !== undefined) return ui.drawn(scope)
    return spliced(await ui.drawn(), key => ui.drawn({ in: key }))
  }
  const find = async (query: Query) => {
    const own = await ui.find(query)
    if (own !== undefined || query.in !== undefined) return own
    for (const key of clientKeys(await ui.drawn())) {
      const found = await ui.find({ ...query, in: key })
      if (found !== undefined) return found
    }
    return undefined
  }
  const findAll = async (query: Query) => {
    if (!ui.findAll) return []
    const own = await ui.findAll(query)
    if (query.in !== undefined) return own
    const inClients = await Promise.all(clientKeys(await ui.drawn()).map(key => ui.findAll?.({ ...query, in: key }) ?? []))
    return [...own, ...inClients.flat()]
  }
  // The handle is frozen, so a new object carries its members (bound) and these three in their place.
  const out: Record<string, unknown> = {}
  for (let o: object | null = ui; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name === 'constructor' || name in out) continue
      const value = (ui as Record<string, unknown>)[name]
      out[name] = typeof value === 'function' ? value.bind(ui) : value
    }
  }
  // Each drawing a host validates on its own: the pane's tree (its Clients as elements), then each Client's tree.
  const drawings = async () => {
    const own = await ui.drawn()
    return [own, ...(await Promise.all(clientKeys(own).map(key => ui.drawn({ in: key }))))]
  }
  return Object.assign(out, { drawn, find, findAll, drawings }) as unknown as T
}

/** The drawings a host validates apart (see `withClients`); a handle without Clients has its one tree. */
export async function drawingsOf(ui: { drawn: () => Promise<unknown>; drawings?: () => Promise<unknown[]> }): Promise<unknown[]> {
  return ui.drawings ? ui.drawings() : [await ui.drawn()]
}

/** Every Button key in the tree, in drawing order. */
export function buttonKeys(node: DrawnNode, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (node.type === 'Button' && node.props?.key !== undefined) out.push(String(node.props.key))
  for (const child of kids(node)) buttonKeys(child, out)
  return out
}

/** The deepest nesting and the node count of a drawn tree (the engine refuses depth > 32 or > 20,000 nodes). */
export function treeSize(node: DrawnNode, depth = 1): { depth: number; nodes: number } {
  if (node === null || node === undefined || typeof node !== 'object') return { depth: depth - 1, nodes: 0 }
  let deepest = depth
  let nodes = 1
  for (const child of kids(node)) {
    const sub = treeSize(child, depth + 1)
    deepest = Math.max(deepest, sub.depth)
    nodes += sub.nodes
  }
  return { depth: deepest, nodes }
}
