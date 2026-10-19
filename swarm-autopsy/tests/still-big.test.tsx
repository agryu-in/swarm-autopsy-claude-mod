// A long session on the desktop: every tab stays in the still pane, however long the session, so the background never
// moves (2026-10-19: on the person's 648-event session the Trail passed a Client's bounds five times over, the pane fell
// back to the scene frame that follows scrolling, and the background "also moves and comes to the fixed position").
// A view too long for one Client comes in parts, with a pager at the list's ends; each part keeps every rule of the page.
// The liquid glass's transparency steps are pressed here too: shared through the store, drawn into the glass.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { applyUsage } from '../hooks/lib/ledger'
import { contentClientTree, type ContentClientProps } from '../hooks/ui/client/content-client'
import type { Observation } from '../hooks/lib/reduce'
import type { Snapshot } from '../types'
import { build, spawn, tool, turnEnd, turnStart } from './fixtures'
import { all, pageProblems } from './page-rules'
import { tokens, usageRecord } from './usage-fixtures'

const PLUGIN = 'swarm-autopsy'
const NOW = 1_100_000
const SLOW = { timeoutMs: 300_000 }
const TABS = ['live', 'trail', 'collisions', 'forensics', 'spend', 'health'] as const
const AGENTS = ['explorer', 'implementer', 'tester', 'reviewer', 'docs', 'auditor']
const FILES = ['ui/client/still-pane.tsx', 'ui/client/content-client.ts', 'art/background.ts', 'lib/scenes.ts', 'lib/themes.ts', 'ui/glass.tsx', 'ui/pane.tsx', 'register.tsx']
const BASE = '/home/dev/projects/swarm-autopsy/swarm-autopsy/hooks'

/** SIMULATED: a session the size of the person's (six subagents, about 650 events, about 530 model requests). */
function longSession(): Snapshot {
  const observations: Array<Observation | Observation[]> = []
  let id = 0
  const call = (agent: string | undefined, i: number) => {
    const n = ++id
    const file = `${BASE}/${FILES[(i + n) % FILES.length]}`
    if (i % 5 === 0) return tool(agent, `toolu_${n}`, 'Bash', { command: `npm run check -- --filter case-${n}`, description: 'Run the checks' }, n % 7 === 0 ? { text: 'FAIL 2 tests', isError: true } : { text: 'ok' })
    if (i % 3 === 0) return tool(agent, `toolu_${n}`, 'Edit', { file_path: file, old_string: `a${n}`, new_string: `b${n}` })
    return tool(agent, `toolu_${n}`, 'Read', { file_path: file })
  }
  observations.push(turnStart(undefined, 't-main', 'Make the background still'))
  for (let i = 0; i < 110; i++) observations.push(call(undefined, i))
  AGENTS.forEach((agent, a) => {
    observations.push(spawn(agent, { description: `${agent}: part ${a + 1}`, prompt: `Work on part ${a + 1} of the redesign.` }))
    observations.push(turnStart(agent, `t-${agent}`))
    for (let i = 0; i < 80; i++) observations.push(call(agent, i))
    observations.push(turnEnd(agent, `t-${agent}`, `Done with part ${a + 1}.`))
  })
  for (let i = 110; i < 160; i++) observations.push(call(undefined, i))
  const snapshot = build(...observations)
  let ledger = snapshot.ledger
  let index = 0
  for (const agent of ['main', ...AGENTS]) {
    for (let i = 0; i < (agent === 'main' ? 291 : 40); i++) {
      ledger = applyUsage(ledger, usageRecord({ agentId: agent, turnId: `t-${agent}`, index: i, at: 1_000_000 + index++ * 500, tokens: tokens(20 + i, 60_000 + i * 300, 2_000, 400) }))
    }
  }
  return { ...snapshot, ledger, sessionId: 'still-big' }
}

const PANE = {
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  surface: 'desktop' as const,
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 44 }, view: {} },
}

function seeded(on: On, seed: Snapshot) {
  mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'still-big' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', (_$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
  return store
}

const contentOf = (root: unknown) => all(root).find(el => el.type === 'Client' && String(el.props?.key).startsWith('sa-content'))?.props?.props as ContentClientProps | undefined

describe('a long session on the desktop', () => {
  test('every tab stays in the still pane: a view too long for one Client comes in parts, each within the page’s rules', SLOW, async ($: Engine, on: On) => {
    seeded(on, longSession())
    const ui = await $.ui.mount(PANE)
    const problems: string[] = []
    let inParts = 0
    for (const view of TABS) {
      await ui.press({ key: `tab-${view}` })
      const root = await ui.drawn()
      const content = contentOf(root)
      expect({ view, still: content !== undefined, fallback: JSON.stringify(root).includes('still scene unavailable') }).toEqual({ view, still: true, fallback: false })
      if (!content) continue
      problems.push(...pageProblems(contentClientTree(content, { page: true, press: () => undefined }), view))
      if (JSON.stringify(content.tree).includes('Part 1 of ')) inParts++
    }
    expect(problems).toEqual([])
    expect(inParts).toBeGreaterThan(0)
    await ui.unmount()
  })

  test('the pager moves through the parts: the next part, back again, and the part held per tab', SLOW, async ($: Engine, on: On) => {
    seeded(on, longSession())
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'tab-trail' })
    let content = contentOf(await ui.drawn())
    const count = Number(/Part 1 of (\d+)/.exec(JSON.stringify(content?.tree))?.[1])
    expect(count).toBeGreaterThan(1)
    expect(JSON.stringify(content?.tree)).toContain('"sa-part-next"')
    expect(JSON.stringify(content?.tree)).not.toContain('"sa-part-prev"')
    // A press inside the content Client posts the pager Button's key, as the page does.
    await ui.post({ press: 'sa-part-next', nth: 0 }, { in: 'sa-content' })
    content = contentOf(await ui.drawn())
    expect(JSON.stringify(content?.tree)).toContain(`Part 2 of ${count}`)
    expect(JSON.stringify(content?.tree)).toContain('"sa-part-prev"')
    expect(content?.place).toBe('trail:1')
    // Another tab starts at its own beginning; coming back finds the Trail on part 2.
    await ui.press({ key: 'tab-live' })
    await ui.press({ key: 'tab-trail' })
    expect(JSON.stringify(contentOf(await ui.drawn())?.tree)).toContain(`Part 2 of ${count}`)
    await ui.post({ press: 'sa-part-prev', nth: 0 }, { in: 'sa-content' })
    expect(JSON.stringify(contentOf(await ui.drawn())?.tree)).toContain(`Part 1 of ${count}`)
    await ui.unmount()
  })

  test('the transparency steps set how clear the liquid glass is, for every chat, and every step keeps the page’s rules', SLOW, async ($: Engine, on: On) => {
    const store = seeded(on, longSession())
    const ui = await $.ui.mount(PANE)
    const root = await ui.drawn()
    const steps = all(root).filter(el => el.type === 'Button' && String(el.props?.key).startsWith('sa-glass-'))
    expect(steps.map(el => el.props?.key)).toEqual([1, 2, 3, 4, 5].map(step => `sa-glass-${step}`))
    expect(contentOf(root)?.dress.clarity).toBe(0.5)
    const looks: string[] = []
    for (const step of [1, 5]) {
      await ui.press({ key: `sa-glass-${step}` })
      const drawn = await ui.drawn()
      const content = contentOf(drawn)
      expect({ step, clarity: content?.dress.clarity, stored: store.get('glass') }).toEqual({ step, clarity: (step - 1) / 4, stored: step })
      expect(all(drawn).filter(el => el.type === 'Button' && String(el.props?.key).startsWith('sa-glass-')).map(el => el.props?.variant)).toEqual(
        [1, 2, 3, 4, 5].map(i => (i <= step ? 'primary' : 'secondary')),
      )
      const page = content ? contentClientTree(content, { page: true, press: () => undefined }) : ''
      expect(pageProblems(page, `glass ${step}`)).toEqual([])
      // The glass's shared layers live on the scroll area (custom properties every card and pill reads).
      looks.push(String(typeof page === 'string' ? '' : page.props?.style ?? ''))
    }
    // Frosted and crystal are different glass.
    expect(looks[0]).not.toBe(looks[1])
    await ui.unmount()
  })
})
