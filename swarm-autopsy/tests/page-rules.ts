// The rules the desktop page (2.1.299, read from its bundle) holds a Client's tree to: one element that breaks one makes
// it refuse the whole tree ("returned a tree the page cannot draw"), the Client then draws only a fault line, and the
// still pane falls back. Shared by the page guard (client-page) and the mending (page-fit) tests.

import { styleIsSafe } from '../hooks/ui/client/content-client'
import { PAGE_LIMITS, pageCount, type ClientNode } from '../hooks/ui/client/shape'

/** What the page's client-tree schema draws; anything else makes it refuse the whole tree. */
export const PAGE_TYPES = new Set(['Box', 'Text', 'div', 'span', 'b', 'Svg', 'Button', 'Input', 'Select'])

export type El = { type: string; props?: Record<string, unknown>; children?: unknown }

const isEl = (node: unknown): node is El => node !== null && typeof node === 'object' && typeof (node as El).type === 'string'

/** Every element of a tree, outermost first. */
export function all(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) all(child, out)
    return out
  }
  if (!isEl(node)) return out
  out.push(node)
  const own = node.children ?? node.props?.children
  for (const child of Array.isArray(own) ? own : own === undefined ? [] : [own]) all(child, out)
  return out
}

const primitive = (value: unknown): boolean => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

/** Every rule the page holds a Client's tree to; a list of what breaks them (empty when the page draws it). */
export function pageProblems(tree: ClientNode, where: string): string[] {
  const problems: string[] = []
  const chars = JSON.stringify(tree).length
  const size = pageCount(tree)
  if (chars > PAGE_LIMITS.chars) problems.push(`${where}: ${chars} characters`)
  if (size.nodes > PAGE_LIMITS.nodes) problems.push(`${where}: ${size.nodes} nodes`)
  if (size.depth > PAGE_LIMITS.depth) problems.push(`${where}: ${size.depth} deep`)
  for (const el of all(tree)) {
    if (!PAGE_TYPES.has(el.type)) problems.push(`${where}: a ${el.type}`)
    const style = el.props?.style
    if (style !== undefined && (typeof style !== 'string' || !styleIsSafe(style))) problems.push(`${where}: a style the page drops: ${String(style).slice(0, 120)}`)
    for (const [name, value] of Object.entries(el.props ?? {})) {
      if (!primitive(value)) problems.push(`${where}: a ${el.type}'s ${name} that is not a string, finite number or boolean`)
    }
    if (el.type === 'Button') {
      const key = el.props?.key
      if (typeof key !== 'string' || key.length < 1 || key.length > 256) problems.push(`${where}: a Button key of ${String(key).length} characters`)
      if (typeof el.props?.label !== 'string') problems.push(`${where}: a Button label that is not a string`)
    }
    if (el.type === 'Svg') {
      if (String(el.props?.alt ?? '').trim() === '') problems.push(`${where}: an Svg without alt`)
      for (const side of ['width', 'height']) {
        const n = el.props?.[side]
        if (!(typeof n === 'number' && n > 0 && n <= 4096)) problems.push(`${where}: an Svg ${side} of ${String(n)}`)
      }
      const source = el.props?.source
      if (typeof source !== 'string' || source.length < 1 || source.length > 131_072) problems.push(`${where}: an Svg source of ${String(source).length} characters`)
    }
  }
  return problems
}
