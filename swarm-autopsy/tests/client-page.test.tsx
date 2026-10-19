// What the desktop page receives from the still pane, checked against the page's own rules (2.1.299, read from its
// bundle, tests/page-rules.ts): the element types it draws, every raw style through its blocklist (a style that trips it is
// dropped whole: an early probe's `overscroll-behavior:` lost its scroll area that way), Button keys and labels, Svg alt
// and size, and each Client tree's bounds.
// The Clients' page trees are rebuilt here from the props the pane hands them, exactly as their modules build them.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { contentClientTree, styleIsSafe, type ContentClientProps } from '../hooks/ui/client/content-client'
import { frameOf, sceneClientTree, type SceneClientProps } from '../hooks/ui/client/scene-client'
import type { Snapshot } from '../types'
import { build, threeAgentSession } from './fixtures'
import { all, pageProblems } from './page-rules'

const PLUGIN = 'swarm-autopsy'
const NOW = 1_100_000
const SLOW = { timeoutMs: 180_000 }
const TABS = ['live', 'trail', 'collisions', 'forensics', 'spend', 'health'] as const

const PANE = (bodyColumns: number, rows: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: rows }, view: {} },
})

function seeded(on: On, seed: Snapshot) {
  mock.clock(on, { now: NOW })
  on('session.id', () => ({ value: 'client-page' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', (_$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

describe('the still pane on the desktop page', () => {
  test('every tab, at every width, hands the page trees it draws: known elements, styles it keeps, Svgs it accepts, within its bounds', SLOW, async ($: Engine, on: On) => {
    seeded(on, { ...build(...threeAgentSession()), sessionId: 'client-page' })
    const problems: string[] = []
    for (const [width, rows] of [[40, 50], [56, 40], [116, 60]] as const) {
      const ui = await $.ui.mount({ ...PANE(width, rows), surface: 'desktop' })
      for (const view of TABS) {
        await ui.press({ key: `tab-${view}` })
        const root = await ui.drawn()
        const clients = all(root).filter(el => el.type === 'Client')
        const where = `${view}@${width}`
        expect({ where, clients: clients.map(c => c.props?.key) }).toEqual({ where, clients: ['sa-scene', 'sa-content'] })
        const content = clients.find(c => c.props?.key === 'sa-content')?.props?.props as ContentClientProps
        const scene = clients.find(c => c.props?.key === 'sa-scene')?.props?.props as SceneClientProps
        const contentTree = contentClientTree(content, { page: true, press: () => undefined })
        problems.push(...pageProblems(contentTree, `${where} content`))
        // The page makes a Client's region only as tall as what it draws (at least a line): each layer states the pane's
        // rows itself, in flow, or the scene shrinks to one line (as it did in an early test in the person's pane).
        // The content scrolls in the rows the toolbar (fixed above it) leaves, and states them.
        expect({ where, content: String(contentTree.props?.style) }).toMatchObject({ where, content: expect.stringContaining(`height:${content.rows}lh`) })
        expect({ where, fits: content.rows < rows && content.rows >= rows - 11 }).toEqual({ where, fits: true })
        for (const cells of [{ columns: 0, rows: 0 }, { columns: width, rows: 1 }, { columns: width, rows }]) {
          const sceneTree = sceneClientTree(scene, frameOf(scene, cells), { page: true })
          problems.push(...pageProblems(sceneTree, `${where} scene`))
          const style = String(sceneTree.props?.style)
          expect({ where, inFlow: !/position:absolute/.test(style.split(';')[0] ?? ''), tall: style.includes(`height:${rows}lh`) }).toEqual({ where, inFlow: true, tall: true })
          // The picture is drawn for the pane's rows, never the region's one line before layout.
          const picture = all(sceneTree).find(el => el.type === 'Svg')
          expect({ where, cells, height: Number(picture?.props?.height) >= rows * 20 }).toEqual({ where, cells, height: true })
        }
      }
      await ui.unmount()
    }
    expect(problems).toEqual([])
  })

  test('the scroll area keeps its style: it fills the region, scrolls, and holds the keeper that keeps it across redraws', () => {
    const props: ContentClientProps = {
      tree: [{ t: 'Box', k: ['hello'] }],
      rows: 30,
      dress: { glass: { raised: '#1f2125f0', fill: '#1f2125d9', sunken: '#0f1012cc' }, edge: '#9b9a956b', edgeStrong: '#9b9a9580', accent: '#dcb46a', accent2: '#86ad92', ink: '#e7e4dc', muted: '#9b9a95', base: '#151619', display: 'Georgia, serif', clarity: 0.5 },
    }
    const tree = contentClientTree(props, { page: true, press: () => undefined })
    const style = String(tree.props?.style)
    expect(styleIsSafe(style)).toBe(true)
    expect(style).toContain('overflow-y:auto')
    expect(style).not.toMatch(/(^|;)overscroll-behavior:/)
    expect(all(tree).some(el => el.type === 'Svg' && el.props?.isInteractive === true)).toBe(true)
    // The page's rule, as the probe met it: `overscroll-behavior:` trips `behavior:` and the whole style is lost.
    expect(styleIsSafe('height:30lh;overflow-y:auto;overscroll-behavior:contain')).toBe(false)
    expect(styleIsSafe('background:url(x.png)')).toBe(false)
    expect(styleIsSafe('background:linear-gradient(#000,#fff);backdrop-filter:blur(9px)')).toBe(true)
  })
})
