// A view too long for one Client, split into parts that each fit (client/parts.ts), so the still pane never falls back to
// the scene frame that follows scrolling (it lags, then snaps back: what the person saw on a 648-event session's Trail,
// 2026-10-19). Every part keeps what surrounds the long list (the header, the tabs, the summary), and only the list is
// divided, in order, nothing lost or repeated; a single item too long by itself is split inside.

import { describe, expect, test } from 'claude-code/testing'

import { costOf, splitIntoParts, withPager } from '../hooks/ui/client/parts'
import type { ClientElement, ClientNode } from '../hooks/ui/client/shape'

const text = (words: string): ClientElement => ({ type: 'Text', children: [words] })
const item = (i: number, lines = 3): ClientElement => ({
  type: 'Box',
  props: { key: `item-${i}`, flexDirection: 'column' },
  children: Array.from({ length: lines }, (_, line) => text(`item ${i} line ${line}: ${'x'.repeat(120)}`)),
})
const view = (items: ClientNode[]): ClientElement => ({
  type: 'Box',
  props: { flexDirection: 'column' },
  children: [
    text('Swarm Autopsy · the header'),
    { type: 'Box', props: { flexDirection: 'row' }, children: ['tab-live', 'tab-trail'].map(key => ({ type: 'Button', props: { key, label: key } })) },
    { type: 'Box', props: { key: 'list', flexDirection: 'column' }, children: items },
  ],
})
const keysIn = (node: ClientNode, prefix: string, out: string[] = []): string[] => {
  if (typeof node === 'string') return out
  const key = node.props?.key
  if (typeof key === 'string' && key.startsWith(prefix)) out.push(key)
  for (const child of node.children ?? []) keysIn(child, prefix, out)
  return out
}
const BUDGET = { chars: 12_000, nodes: 200 }
const fits = (node: ClientNode) => costOf(node).chars <= BUDGET.chars && costOf(node).nodes <= BUDGET.nodes

describe('a view too long for one Client, in parts', () => {
  test('a view that fits is one part, untouched', () => {
    const small = view([item(0), item(1)])
    expect(splitIntoParts(small, BUDGET)).toEqual({ parts: [small] })
  })

  test('a long list is divided in order across parts that each fit; every part keeps the header and the tabs', () => {
    const items = Array.from({ length: 120 }, (_, i) => item(i))
    const { parts, at } = splitIntoParts(view(items), BUDGET)
    expect(parts.length).toBeGreaterThan(3)
    expect(at).toEqual([2])
    for (const part of parts) {
      expect(fits(part)).toBe(true)
      expect(JSON.stringify(part)).toContain('Swarm Autopsy · the header')
      expect(keysIn(part, 'tab-')).toEqual(['tab-live', 'tab-trail'])
    }
    expect(parts.flatMap(part => keysIn(part, 'item-'))).toEqual(items.map((_, i) => `item-${i}`))
  })

  test('an item too long by itself is divided inside, its neighbours kept whole', () => {
    const huge: ClientElement = { type: 'Box', props: { key: 'item-big', flexDirection: 'column' }, children: Array.from({ length: 90 }, (_, i) => item(1000 + i, 1)) }
    const { parts } = splitIntoParts(view([item(0), huge, item(1)]), BUDGET)
    expect(parts.length).toBeGreaterThan(2)
    for (const part of parts) expect(fits(part)).toBe(true)
    const seen = parts.flatMap(part => keysIn(part, 'item-').filter(key => key !== 'item-big'))
    expect(seen).toEqual(['item-0', ...Array.from({ length: 90 }, (_, i) => `item-${1000 + i}`), 'item-1'])
  })

  test('nothing to divide (one long line): one part, for the caller to refuse', () => {
    const line = view([text('y'.repeat(40_000))])
    expect(splitIntoParts(line, BUDGET).parts).toHaveLength(1)
  })

  test('the pager goes around the divided list, before and after it', () => {
    const { parts, at } = splitIntoParts(view(Array.from({ length: 60 }, (_, i) => item(i))), BUDGET)
    const paged = withPager(parts[1]!, at ?? [], { before: text('▴ before'), after: text('after ▾') })
    const list = paged.children?.[2] as ClientElement
    expect(JSON.stringify(list.children?.[0])).toContain('▴ before')
    expect(JSON.stringify(list.children?.at(-1))).toContain('after ▾')
    expect(keysIn(paged, 'item-')).toEqual(keysIn(parts[1]!, 'item-'))
  })
})
