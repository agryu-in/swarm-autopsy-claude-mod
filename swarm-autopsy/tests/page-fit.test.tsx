// A Client's tree made to the desktop page's schema before it leaves (shape.ts `fitPage`): the page refuses a whole tree
// for one element it cannot draw, and the person's pane logged exactly that for the content Client
// ("returned a tree the page cannot draw"), then fell back to the scene frame that follows scrolling. Each element the
// page would refuse is mended in place; the rest of the tree, and every Button's handler, are kept as they are.

import { describe, expect, test } from 'claude-code/testing'

import { contentClientTree, type ContentClientProps } from '../hooks/ui/client/content-client'
import { fitPage, type ClientElement, type ClientNode } from '../hooks/ui/client/shape'
import { all, pageProblems } from './page-rules'

const DRESS: ContentClientProps['dress'] = {
  glass: { raised: '#1f2125f0', fill: '#1f2125d9', sunken: '#0f1012cc' },
  edge: '#9b9a956b',
  edgeStrong: '#9b9a9580',
  accent: '#dcb46a',
  accent2: '#86ad92',
  ink: '#e7e4dc',
  muted: '#9b9a95',
  base: '#151619',
  display: 'Georgia, serif',
  clarity: 0.5,
}

const LONG_PATH = `/home/dev/projects/${'deep/'.repeat(60)}file.ts`

/** A tree holding one of every element the page refuses, as data from a long session could produce them. */
function refusedTree(pressed: string[]): ClientElement {
  const button = (key: unknown, label: unknown) =>
    ({ type: 'Button', props: { key, label }, onPress: () => pressed.push(String(key)) }) as unknown as ClientElement
  return {
    type: 'Box',
    props: { flexDirection: 'column', width: Number.NaN, gap: Number.POSITIVE_INFINITY },
    children: [
      button(`hd-s:shared:${LONG_PATH}`, 'a file two agents wrote'),
      button('', 'no key'),
      button('count', 3),
      { type: 'Svg', props: { source: '<svg xmlns="http://www.w3.org/2000/svg"/>', alt: '', width: 0, height: Number.NaN } },
      { type: 'Svg', props: { source: '<svg xmlns="http://www.w3.org/2000/svg"/>', alt: 'wide map', width: 8192, height: 2048 } },
      { type: 'Svg', props: { source: `<svg xmlns="http://www.w3.org/2000/svg">${'<g/>'.repeat(40_000)}</svg>`, alt: 'a map too long to send', width: 300, height: 200 } },
      { type: 'Marquee', children: ['gone'] },
      { type: 'Text', props: { color: null as unknown as string }, children: ['kept'] },
    ],
  }
}

describe('a Client tree made to the page', () => {
  test('every element the page would refuse is mended, and the tree then passes every rule', () => {
    const tree = refusedTree([])
    expect(pageProblems(tree, 'before').length).toBeGreaterThan(6)
    const fitted = fitPage(tree)
    expect(pageProblems(fitted, 'after')).toEqual([])
  })

  test('mending keeps what it can: keys stay unique and stable, sizes keep their ratio, a picture too long to send says its alt', () => {
    const fitted = all(fitPage(refusedTree([])))
    const keys = fitted.filter(el => el.type === 'Button').map(el => String(el.props?.key))
    expect(new Set(keys).size).toBe(keys.length)
    expect(all(fitPage(refusedTree([]))).filter(el => el.type === 'Button').map(el => el.props?.key)).toEqual(keys)
    expect(fitted.find(el => el.type === 'Button' && el.props?.label === '3')).toBeDefined()
    const wide = fitted.find(el => el.type === 'Svg' && el.props?.alt === 'wide map')
    expect({ width: wide?.props?.width, height: wide?.props?.height }).toEqual({ width: 4096, height: 1024 })
    expect(fitted.some(el => el.type === 'Svg' && el.props?.alt === 'a map too long to send')).toBe(false)
    expect(JSON.stringify(fitPage(refusedTree([])))).toContain('a map too long to send')
    expect(fitted.some(el => el.type === 'Marquee')).toBe(false)
    expect(JSON.stringify(fitPage(refusedTree([])))).toContain('kept')
  })

  test('a mended Button still runs its own handler, under the key the view gave it', () => {
    const pressed: string[] = []
    const long = all(fitPage(refusedTree(pressed))).find(el => el.type === 'Button' && el.props?.label === 'a file two agents wrote') as
      | (ClientElement & { onPress?: () => void })
      | undefined
    expect(String(long?.props?.key).length).toBeLessThanOrEqual(256)
    long?.onPress?.()
    expect(pressed).toEqual([`hd-s:shared:${LONG_PATH}`])
  })

  test('the content Client draws its page tree mended: a view keyed by a long path still reaches the page whole', () => {
    const tree: ClientNode = { type: 'Box', children: [{ type: 'Button', props: { key: `hd-s:shared:${LONG_PATH}`, label: 'shared file' } }] }
    const props: ContentClientProps = { tree: [{ t: 'Box', k: [1] }, { t: 'Button', p: { key: `hd-s:shared:${LONG_PATH}`, label: 'shared file' } }], rows: 20, dress: DRESS }
    expect(pageProblems(tree, 'view').length).toBe(1)
    const posted: Array<[string, number]> = []
    const page = contentClientTree(props, { page: true, press: (key, nth) => posted.push([key, nth]) })
    expect(pageProblems(page, 'page')).toEqual([])
    const button = all(page).find(el => el.type === 'Button') as (ClientElement & { onPress?: () => void }) | undefined
    button?.onPress?.()
    expect(posted).toEqual([[`hd-s:shared:${LONG_PATH}`, 0]])
  })
})
