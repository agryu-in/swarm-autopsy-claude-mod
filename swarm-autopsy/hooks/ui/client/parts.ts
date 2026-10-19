// A view too long for one Client, split into parts that each fit. A Client's drawing has hard bounds on the desktop
// page (2,000 elements, 100,000 characters), and a long session's view passes them: a 648-event session's Trail is five
// times past. Without parts the still pane falls back to the engine tree, whose scene frame follows scrolling (it lags,
// then snaps back). With parts, every part is drawn in the still pane, scrolls natively and smoothly, and the scene
// never moves; a pager at the list's ends moves between parts.
//
// Where a view's length lives is found from its shape, so no view needs to know about parts. Going down from the root,
// it is in a child that holds most of the tree, until a node whose children share it: that node's children are the list.
// Each part keeps everything else (the header, the tabs, the summary) and a run of the list's items, in order. An item
// too long by itself is split the same way inside. Pure: plain trees in, plain trees out.

import { pageCount, type ClientElement, type ClientNode } from './shape.ts'

export type Cost = { chars: number; nodes: number }

/** A tree's size as the page counts it: its serialized characters, and its elements and strings. */
export function costOf(node: ClientNode): Cost {
  return { chars: JSON.stringify(node).length, nodes: pageCount(node).nodes }
}

const add = (a: Cost, b: Cost): Cost => ({ chars: a.chars + b.chars, nodes: a.nodes + b.nodes })
const fitsIn = (cost: Cost, budget: Cost): boolean => cost.chars <= budget.chars && cost.nodes <= budget.nodes
const ZERO: Cost = { chars: 0, nodes: 0 }

/** A child holding at least this share of its parent is where the length goes on; below it the children share it. */
const DOMINANT = 0.6
/** How many lists deep an item too long by itself is split inside, at most. */
const MAX_DEPTH = 5

/** The node at `path` (child indices from the root). */
function nodeAt(root: ClientElement, path: readonly number[]): ClientElement {
  let node = root
  for (const index of path) node = node.children?.[index] as ClientElement
  return node
}

/** The tree with the node at `path` holding `children` instead of its own: a copy along the path, the rest shared. */
function withChildrenAt(root: ClientElement, path: readonly number[], children: ClientNode[]): ClientElement {
  if (path.length === 0) return { ...root, children }
  const [head, ...rest] = path as [number, ...number[]]
  const own = root.children ?? []
  return { ...root, children: own.map((child, i) => (i === head ? withChildrenAt(child as ClientElement, rest, children) : child)) }
}

/** The path to the node whose children are the view's list: down through any child holding most of the tree. */
function listPath(root: ClientElement): number[] {
  const path: number[] = []
  let node = root
  for (;;) {
    const kids = node.children ?? []
    let biggest = -1
    let biggestChars = 0
    kids.forEach((kid, i) => {
      if (typeof kid === 'string') return
      const chars = JSON.stringify(kid).length
      if (chars > biggestChars) {
        biggest = i
        biggestChars = chars
      }
    })
    const big = kids[biggest]
    if (biggest < 0 || typeof big !== 'object' || (big.children?.length ?? 0) === 0) return path
    if (biggestChars < DOMINANT * JSON.stringify(node).length) return path
    // One long item among others like it (the same kind, keyed alike: `lane-…`, `card-…`) is an item of this list, not
    // where the list is: going into it would repeat its neighbours in every part.
    const kind = stem(big)
    if (kind !== '' && kids.some((kid, i) => i !== biggest && typeof kid === 'object' && kid.type === big.type && stem(kid) === kind)) return path
    path.push(biggest)
    node = big
  }
}

/** A keyed element's kind: its key up to the first separator (`lane-explorer` → `lane`); '' unkeyed. */
function stem(node: ClientElement): string {
  const key = node.props?.key
  return typeof key === 'string' ? key.replace(/[-:].*$/, '') : ''
}

export type Parts = {
  /** The parts in order, each the whole tree with a run of the list; one part when the tree fits or cannot be divided. */
  parts: ClientElement[]
  /** The path to the divided list, where a pager goes; absent when the tree was not divided. */
  at?: number[]
}

/** The tree in parts that each fit `budget`; one part, the tree itself, when it fits or has no list to divide. */
export function splitIntoParts(root: ClientElement, budget: Cost, depth = 0): Parts {
  if (fitsIn(costOf(root), budget)) return { parts: [root] }
  const path = listPath(root)
  const kids = nodeAt(root, path).children ?? []
  if (kids.length < 2 || depth > MAX_DEPTH) return { parts: [root] }
  const costs = kids.map(costOf)
  const listed = costs.reduce(add, ZERO)
  const whole = costOf(root)
  // Room for the list's items in a part: the budget less everything a part keeps besides them.
  const room = { chars: budget.chars - (whole.chars - listed.chars), nodes: budget.nodes - (whole.nodes - listed.nodes) }
  if (room.chars <= 0 || room.nodes <= 0) return { parts: [root] }
  const parts: ClientElement[] = []
  let run: ClientNode[] = []
  let used = ZERO
  const close = () => {
    if (run.length > 0) parts.push(withChildrenAt(root, path, run))
    run = []
    used = ZERO
  }
  kids.forEach((kid, i) => {
    const cost = costs[i] ?? ZERO
    if (!fitsIn(cost, room)) {
      // Too long by itself: divided inside, as the only item of its own parts.
      close()
      parts.push(...splitIntoParts(withChildrenAt(root, path, [kid]), budget, depth + 1).parts)
      return
    }
    if (!fitsIn(add(used, cost), room)) close()
    run.push(kid)
    used = add(used, cost)
  })
  close()
  return parts.length > 1 ? { parts, at: path } : { parts: [root] }
}

/** A part with its pager around the divided list: `before` first in it, `after` last. */
export function withPager(part: ClientElement, at: readonly number[], pager: { before?: ClientNode; after?: ClientNode }): ClientElement {
  const list = nodeAt(part, at).children ?? []
  return withChildrenAt(part, at, [...(pager.before ? [pager.before] : []), ...list, ...(pager.after ? [pager.after] : [])])
}
