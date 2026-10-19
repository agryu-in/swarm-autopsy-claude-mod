// The four summary cards (tokens processed, main context, subagents, signals) on the desktop at every pane width. The
// person found them missing in the default side pane (2026-10-19: "the cards are not showing on the default pane"),
// where the compact layout drew one dim line instead, and stacked in one column on an expanded pane. On the desktop the
// cards are drawn at every width now: one per row on the narrowest panes, two per row from 40 columns, four on wide
// ones, each row filling the pane. The terminal keeps its compact line, and its tiles from medium up.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { contentClientTree, type ContentClientProps } from '../hooks/ui/client/content-client'
import type { Snapshot } from '../types'
import { build, threeAgentSession } from './fixtures'
import { all } from './page-rules'
import { withClients } from './view-helpers'

const PLUGIN = 'swarm-autopsy'
const SLOW = { timeoutMs: 180_000 }
const KPIS = ['kpi-tokens', 'kpi-context', 'kpi-agents', 'kpi-signals']

const PANE = (surface: 'desktop' | 'terminal', bodyColumns: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  surface,
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 50 }, view: {} },
})

function seeded(on: On, seed: Snapshot) {
  mock.clock(on, { now: 1_100_000 })
  on('session.id', () => ({ value: 'header-cards' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', (_$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
}

describe('the summary cards', () => {
  test('desktop: all four cards at every width, as many per row as fit, each row filling the pane', SLOW, async ($: Engine, on: On) => {
    seeded(on, { ...build(...threeAgentSession()), sessionId: 'header-cards' })
    for (const [width, perRow] of [[34, 1], [44, 2], [52, 2], [70, 2], [106, 4]] as const) {
      const ui = withClients(await $.ui.mount(PANE('desktop', width)))
      const tiles = all(await ui.drawn()).filter(el => KPIS.includes(String(el.props?.key)))
      expect({ width, cards: tiles.map(el => el.props?.key) }).toEqual({ width, cards: KPIS })
      const widths = tiles.map(el => Number(el.props?.width))
      // A row of cards and its gaps fill the pane's width, never more.
      expect({ width, perRow, fills: widths[0]! * perRow + (perRow - 1) <= width && widths[0]! * perRow + (perRow - 1) >= width - perRow }).toEqual({ width, perRow, fills: true })
      await ui.unmount()
    }
  })

  test('desktop: the status figures are pills at every width, never a cut-off line', SLOW, async ($: Engine, on: On) => {
    seeded(on, { ...build(...threeAgentSession()), sessionId: 'header-cards' })
    const ui = withClients(await $.ui.mount(PANE('desktop', 44)))
    const keys = all(await ui.drawn()).map(el => String(el.props?.key ?? ''))
    for (const key of ['st-ctx', 'st-agents', 'st-signals', 'st-unresolved']) expect({ key, drawn: keys.includes(key) }).toEqual({ key, drawn: true })
    await ui.unmount()
  })

  test('terminal: the compact pane keeps its one status line and draws no tiles', SLOW, async ($: Engine, on: On) => {
    seeded(on, { ...build(...threeAgentSession()), sessionId: 'header-cards' })
    const ui = await $.ui.mount(PANE('terminal', 49))
    const drawn = all(await ui.drawn())
    expect(drawn.filter(el => KPIS.includes(String(el.props?.key)))).toHaveLength(0)
    expect(drawn.some(el => String(el.props?.key ?? '').startsWith('st-'))).toBe(false)
    await ui.unmount()
  })

  test('desktop page: the scroll area draws no scrollbar of its own, so rows sized to the pane never wrap', () => {
    const props: ContentClientProps = {
      tree: [{ t: 'Box', k: ['hello'] }],
      rows: 20,
      dress: { glass: { raised: '#1f2125f0', fill: '#1f2125d9', sunken: '#0f1012cc' }, edge: '#9b9a956b', edgeStrong: '#9b9a9580', accent: '#dcb46a', accent2: '#86ad92', ink: '#e7e4dc', muted: '#9b9a95', base: '#151619', display: 'Georgia, serif', clarity: 0.5 },
    }
    const style = String(contentClientTree(props, { page: true, press: () => undefined }).props?.style)
    expect(style).toContain('scrollbar-width:none')
    expect(style).toContain('overflow-y:auto')
    expect(style).toContain('mask-image:')
  })

  // ── spacing: one rhythm, the card list's (2026-10-19: the person found the header's lines and the cards' rows
  // touching, while the agent cards below had even gaps) ──

  test('desktop: the header keeps one rhythm, its title and scene line together and every other block a gap apart', SLOW, async ($: Engine, on: On) => {
    seeded(on, { ...build(...threeAgentSession()), sessionId: 'header-cards' })
    for (const width of [44, 106]) {
      const ui = withClients(await $.ui.mount(PANE('desktop', width)))
      const root = await ui.drawn()
      const header = all(root).find(el => el.props?.key === 'pane-header')
      // The same gap as the agent cards' list (rowGap 1, half a line in the engine tree).
      expect({ width, gap: header?.props?.rowGap }).toEqual({ width, gap: 1 })
      const identity = all(header).find(el => el.props?.key === 'pane-identity')
      expect({ width, title: JSON.stringify(identity).includes('Swarm Autopsy'), scene: JSON.stringify(identity).includes('Every agent leaves a stone.'), tight: identity?.props?.rowGap ?? 0 }).toEqual({
        width,
        title: true,
        scene: true,
        tight: 0,
      })
      await ui.unmount()
    }
  })

  test('desktop page: a wrapping row (pills, tabs, chips, the summary cards) keeps the card list’s gap between its rows', () => {
    const dress: ContentClientProps['dress'] = { glass: { raised: '#1f2125f0', fill: '#1f2125d9', sunken: '#0f1012cc' }, edge: '#9b9a956b', edgeStrong: '#9b9a9580', accent: '#dcb46a', accent2: '#86ad92', ink: '#e7e4dc', muted: '#9b9a95', base: '#151619', display: 'Georgia, serif', clarity: 0.5 }
    const rowOf = (props: Record<string, string | number | boolean>): ContentClientProps => ({ tree: [{ t: 'Box', p: props, k: ['a', 'b'] }], rows: 20, dress })
    const drawnRow = (props: Record<string, string | number | boolean>) => all(contentClientTree(rowOf(props), { page: true, press: () => undefined })).find(el => el.type === 'Box' && el.props?.flexWrap === 'wrap')
    // The card list's own gap (rowGap 1 in the engine tree) is half a line on the page.
    expect(drawnRow({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1, rowGap: 1 })?.props?.rowGap).toBe(0.5)
    expect(drawnRow({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 1 })?.props?.rowGap).toBe(0.5)
    // A row that never wraps keeps none.
    const plain = all(contentClientTree(rowOf({ flexDirection: 'row', columnGap: 1 }), { page: true, press: () => undefined })).find(el => el.type === 'Box' && el.props?.flexDirection === 'row')
    expect(plain?.props?.rowGap).toBeUndefined()
  })

  test('the summary cards: every line of a card stays inside its padding, cut with an ellipsis, on the narrowest pane too', SLOW, async ($: Engine, on: On) => {
    seeded(on, { ...build(), sessionId: 'header-cards' })
    const ui = withClients(await $.ui.mount(PANE('desktop', 44)))
    const tile = all(await ui.drawn()).find(el => el.props?.key === 'kpi-context')
    // The detail sits in a column that may shrink below its text (minWidth 0), so its truncation applies inside the card.
    const shrinking = all(tile).filter(el => el.type === 'Box' && el.props?.flexDirection === 'column' && el.props?.flexShrink === 1)
    expect(shrinking.length).toBeGreaterThan(0)
    for (const box of shrinking) expect(box.props?.minWidth).toBe(0)
    await ui.unmount()
  })
})
