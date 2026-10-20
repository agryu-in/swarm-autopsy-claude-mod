// The plain data a Client's tree is made of, and the desktop page's bounds on it. Shared by the hooks
// module (which builds and measures the Live view's tree) and the surface modules (which draw it). Pure.

/** One node of a Client's tree as plain data: a string, or an element with primitive props and children. */
export type ClientNode = string | ClientElement

export type ClientElement = {
  type: string
  props?: Record<string, string | number | boolean>
  children?: ClientNode[]
}

/**
 * What the desktop page (2.1.299) parses from a Client's module: a tree serialized to at most 100,000 characters (the
 * in-frame runtime's own bound), at most 2,000 nodes counting string children, at most 32 elements deep.
 */
export const PAGE_LIMITS = { chars: 100_000, nodes: 2_000, depth: 32 } as const

/**
 * A tree as a flat table, the root first: each element's children are indices into the table, or strings. The engine
 * refuses a Client's props nested deeper than 32 levels, and a tree as nested data takes two levels per element (the
 * element, its children list), so a 16-deep view is past it; the table is five levels deep however deep the tree.
 */
export type FlatTree = FlatNode[]
export type FlatNode = { t: string; p?: Record<string, string | number | boolean>; k?: Array<number | string> }

export function flatten(root: ClientNode): FlatTree {
  const table: FlatTree = []
  const add = (node: ClientElement): number => {
    const index = table.length
    const entry: FlatNode = { t: node.type, ...(node.props ? { p: node.props } : {}) }
    table.push(entry)
    if (node.children && node.children.length > 0) entry.k = node.children.map(child => (typeof child === 'string' ? child : add(child)))
    return index
  }
  add(typeof root === 'string' ? { type: 'Box', children: [root] } : root)
  return table
}

/** The tree a flat table holds; an index out of the table, or one already used, is left out (never a loop). */
export function unflatten(table: FlatTree): ClientElement {
  const used = new Set<number>()
  const build = (index: number): ClientElement | undefined => {
    const entry = table[index]
    if (entry === undefined || used.has(index)) return undefined
    used.add(index)
    const children = (entry.k ?? []).flatMap((child): ClientNode[] => {
      if (typeof child === 'string') return [child]
      const built = build(child)
      return built ? [built] : []
    })
    return { type: entry.t, ...(entry.p ? { props: entry.p } : {}), ...(children.length > 0 ? { children } : {}) }
  }
  return build(0) ?? { type: 'Box' }
}

/**
 * What the page's schema (2.1.299) holds each element to. It refuses the WHOLE tree for one element that breaks a rule
 * ("returned a tree the page cannot draw"), and the Client then draws only a fault line.
 */
export const PAGE_SCHEMA = {
  types: ['Box', 'Text', 'div', 'span', 'b', 'Svg', 'Button', 'Input', 'Select'],
  /** A Button's (Input's, Select's) key: 1 to 256 characters. */
  keyChars: 256,
  /** An Svg's width and height: above 0, at most 4,096. */
  svgSide: 4096,
  /** An Svg's source: 1 to 131,072 characters. */
  svgSource: 131_072,
} as const

const DRAWN = new Set<string>(PAGE_SCHEMA.types)
const KEYED = new Set(['Button', 'Input', 'Select'])
/** How much of a long key a stand-in keeps (it reads in the page's DOM), before its hash. */
const KEY_KEPT = 200

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

/** A key the page takes: the key itself when it can, else a stable stand-in (the same key always gets the same one). */
function pageKey(key: string): string {
  if (key.length >= 1 && key.length <= PAGE_SCHEMA.keyChars) return key
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0
  return key.length === 0 ? `k-${hash.toString(36)}` : `${key.slice(0, KEY_KEPT)}~${hash.toString(36)}`
}

/** An Svg the page takes: an alt, a size inside its bounds at the picture's own ratio; a source too long says its alt. */
function pageSvg(props: Record<string, string | number | boolean>): ClientNode {
  const alt = typeof props.alt === 'string' && props.alt.trim() !== '' ? props.alt : 'picture'
  const source = typeof props.source === 'string' ? props.source : ''
  if (source.length < 1 || source.length > PAGE_SCHEMA.svgSource) return { type: 'span', children: [alt] }
  const given = (side: unknown): number | undefined => (typeof side === 'number' && side > 0 ? side : undefined)
  const width = given(props.width) ?? given(props.height) ?? 1
  const height = given(props.height) ?? width
  const scale = Math.min(1, PAGE_SCHEMA.svgSide / Math.max(width, height))
  const size = scale < 1 ? { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) } : { width, height }
  return { type: 'Svg', props: { ...props, alt, ...size } }
}

/**
 * A Client's tree made to the page's schema before it leaves, so one element from unusual data (a key built from a long
 * path, a picture past the page's size, a value that is not a plain one) can never make the page refuse the whole tree
 * and stop the still pane. Each such element is mended in place; everything else, and each Button's own fields (its
 * handler), is kept as it is. An element of a type the page does not draw is left out.
 */
export function fitPage(node: ClientNode): ClientNode {
  return fitNode(node) ?? ''
}

function fitNode(node: ClientNode): ClientNode | undefined {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (node === null || typeof node !== 'object' || !DRAWN.has(node.type)) return undefined
  const props: Record<string, string | number | boolean> = {}
  for (const [name, value] of Object.entries(node.props ?? {})) if (isPrimitive(value)) props[name] = value
  if (node.type === 'Svg') return pageSvg(props)
  if (KEYED.has(node.type)) props.key = pageKey(typeof props.key === 'string' ? props.key : props.key === undefined ? '' : String(props.key))
  if (node.type === 'Button') props.label = typeof props.label === 'string' ? props.label : props.label === undefined ? '' : String(props.label)
  const children = node.children?.flatMap(child => {
    const fitted = fitNode(child)
    return fitted === undefined ? [] : [fitted]
  })
  return { ...node, props, ...(children ? { children } : {}) }
}

/** A tree's node count and element depth, counted as the page counts them: every element and every string child. */
export function pageCount(node: ClientNode): { nodes: number; depth: number } {
  let nodes = 0
  let depth = 0
  const walk = (n: ClientNode, level: number) => {
    nodes += 1
    if (typeof n === 'string') return
    depth = Math.max(depth, level)
    for (const child of n.children ?? []) walk(child, level + 1)
  }
  walk(node, 1)
  return { nodes, depth }
}
