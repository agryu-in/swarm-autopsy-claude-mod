// Hook-level tests: the plugin loaded by the engine's own test host, events
// raised through `$` as a session raises them, and only the engine beneath the
// plugin mocked (agent ids, tool results, clock). SIMULATED: no real agents run.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { themeFor } from '../hooks/lib/themes'
import { drawingFailed } from '../hooks/ui/failed'
import type { Snapshot } from '../types'
import { withClients } from './view-helpers'

const PLUGIN = 'swarm-autopsy'
/** Mounting the redesigned pane takes longer than the default 5 s on a loaded machine; the assertions are unchanged. */
const LOAD = { timeoutMs: 90_000 }
const SURFACES = ['terminal', 'desktop'] as const

function engineBeneath(on: On) {
  const latest = watchSnapshot(on)
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  /** The snapshot as the background tick last wrote it, after letting one tick run. */
  const snapshot = async (): Promise<Snapshot> => {
    await clock.advance(1100)
    return latest()
  }
  let spawned = 0
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 'session-under-test' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.turns', () => ({ value: 0 }))
  on('agent.list', () => ({ value: [] }))
  const registered: Array<{ name: string; description: string; argumentHint?: string }> = []
  on('command.register', (_$, e) => {
    registered.push({ name: e.name, description: e.description, argumentHint: e.argumentHint })
    return { value: { command: e.name } }
  })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++spawned}` }))
  on('tool.call', (_$, e) => {
    if (String((e as { command?: unknown }).command).includes('hang')) throw new Error('aborted by the person')
    return String(e.tool) === 'Bash' && String((e as { command?: unknown }).command).includes('fail')
      ? { isError: true, result: 'Exit code 1', text: 'Exit code 1\nFAILED' }
      : { result: {}, text: 'ok' }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text' as const, index: 0, text: 'working' }
    if (e.agentId === 'ag-err') throw new Error('overloaded: the request failed mid-stream')
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'working',
      toolUses: [],
      stopReason: e.agentId === 'ag-cut' ? null : ('tool_use' as const),
      usage:
        e.agentId === 'ag-cut'
          ? null
          : { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, model: 'claude-opus-5-5' },
    }
  })
  on('turn.complete', () => ({ text: '' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/repo\n/repo/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return { clock, snapshot, registered }
}

function spawnInput(description: string, prompt: string) {
  return {
    tool_use_id: `toolu_${description.replace(/\W+/g, '_')}`,
    prompt,
    description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' as const },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  }
}

/** The last snapshot the plugin wrote to `$.state`, read off the write itself. */
function watchSnapshot(on: On): () => Snapshot {
  let latest: Snapshot | undefined
  on('state.set', (_$, e, next) => {
    if (e.plugin === 'swarm-autopsy' && e.key === 'snapshot') latest = e.value as Snapshot
    return next(e)
  })
  return () => {
    if (!latest) throw new Error('no snapshot written')
    return latest
  }
}

async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

const PANE = (bodyColumns: number) => ({
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: {
    title: 'Swarm Autopsy',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
})

async function runTwoAgents($: Engine): Promise<void> {
  await $.turn.start({ text: 'fan out', turnId: 'main-1' })
  await $.agent.spawn(spawnInput('investigate cache', 'Look at src/cache.ts and report.'))
  await $.agent.spawn(spawnInput('fix cache', 'Edit src/cache.ts to fix eviction.'))
  await $.turn.start({ text: 'Look at src/cache.ts and report.', turnId: 'ag1-1', agentId: 'ag1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/cache.ts', agentId: 'ag1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/cache.ts', old_string: 'a', new_string: 'b', agentId: 'ag2' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test -- cache fail', agentId: 'ag2' } as never)
  await $.turn.complete({
    answer: 'Eviction in src/cache.ts never runs.',
    durationMs: 900,
    isAborted: false,
    turnId: 'ag1-1',
    agentId: 'ag1',
    reason: 'answer',
  })
}

/** Raises one `turn.step` as the engine would and reads it to its end, as the caller does. */
async function step($: Engine, turnId: string, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 3, ...(agentId ? { agentId } : {}) })
  const chunks: unknown[] = []
  let read = await stream.next()
  while (!read.done) {
    chunks.push(read.value)
    read = await stream.next()
  }
  return { chunks, result: read.value }
}

describe('collector', () => {
  test('a model request streams through untouched and is counted once it is whole', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await $.agent.spawn(spawnInput('investigate cache', 'Look at src/cache.ts and report.'))
    const main = await step($, 'main-1', 0)
    expect(main.chunks).toEqual([{ kind: 'text', index: 0, text: 'working' }])
    expect(main.result.usage?.cache_read_input_tokens).toBe(1000)
    await step($, 'ag1-1', 0, 'ag1')
    await step($, 'fork-1', 0, 'ag-cut')
    const snapshot = await engine.snapshot()
    expect(snapshot.instruments.step).toBe(3)
    expect(snapshot.agentOrder).toEqual(['main', 'ag1'])
  })

  test('a session with no subagents draws its empty state on every surface', LOAD, async ($, on) => {
    engineBeneath(on)
    await startSession($)
    for (const surface of SURFACES) {
      const ui = withClients(await $.ui.mount({ ...PANE(64), surface }))
      expect(await ui.find({ text: /No subagents observed/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('agents, their tool calls and reports are attributed by agentId', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await runTwoAgents($)
    const snapshot = await engine.snapshot()
    expect(snapshot.agentOrder).toEqual(['main', 'ag1', 'ag2'])
    expect(snapshot.agents.ag1?.parentId).toBe('main')
    expect(snapshot.agents.ag1?.parentEvidence).toBe('LINKED')
    expect(snapshot.agents.ag1?.state).toBe('completed')
    expect(snapshot.agents.ag1?.report?.mentions).toEqual(['src/cache.ts'])
    expect(snapshot.agents.ag2?.counts).toMatchObject({ writes: 1, execs: 1, errors: 1 })
    const test = snapshot.events.find(e => e.tool?.verification === 'test')
    expect(test?.agentId).toBe('ag2')
    expect(test?.outcome?.verdict).toBe('failed')
    expect(snapshot.roots['/repo/src']).toBe('/repo')
  })

  test('an interrupted tool call is recorded as inconclusive and still fails for the caller', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await $.agent.spawn(spawnInput('long run', 'Run the slow suite.'))
    await expect($.tool.call({ tool: 'Bash', command: 'npm test -- hang', agentId: 'ag1' } as never)).rejects.toThrow()
    const snapshot = await engine.snapshot()
    const event = snapshot.events.find(e => e.tool?.command === 'npm test -- hang')
    expect(event?.outcome?.verdict).toBe('inconclusive')
    expect(event?.outcome?.text).toContain('interrupted')
    expect(snapshot.agents.ag1?.currentTool).toBeUndefined()
  })

  test('the Agent tool itself is not collected, so a subagent stays audible', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'y' } as never)
    const snapshot = await engine.snapshot()
    expect(snapshot.events.filter(e => e.tool?.tool === 'Agent')).toEqual([])
  })

  test('/clear resets the collected session', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await runTwoAgents($)
    await $.session.end({ reason: 'clear', sessionId: 'session-under-test', resume: { id: 'session-under-test' } } as never)
    const snapshot = await engine.snapshot()
    expect(snapshot.events).toEqual([])
    expect(snapshot.agentOrder).toEqual(['main'])
  })

  test('cards, tabs and the timeline draw at narrow and wide widths', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await runTwoAgents($)
    await engine.clock.advance(1100)
    for (const surface of SURFACES) {
      for (const width of [40, 64, 120]) {
        const ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
        expect(await ui.find({ text: /Swarm Autopsy/ })).toBeDefined()
        // Below 56 columns a compact line cuts the task to the cells it has left; focusing the agent shows it whole.
        if (width < 56) await ui.press({ key: 'card-ag1' })
        expect(await ui.find({ text: /investigate cache/ })).toBeDefined()
        if (width < 56) await ui.press({ key: 'card-ag1' })
        await ui.press({ key: 'card-ag1' })
        expect(await ui.find({ text: /Eviction in src\/cache\.ts never runs/ })).toBeDefined()
        await ui.press({ key: 'card-ag1' })
        await ui.press({ key: 'tab-forensics' })
        expect(await ui.find({ text: /npm test/ })).toBeDefined()
        expect(await ui.find({ text: /Read cache\.ts/ })).toBeDefined()
        await ui.press({ key: 'filter-failures' })
        expect(await ui.find({ text: /npm test/ })).toBeDefined()
        expect(await ui.find({ text: /Read cache\.ts/ })).toBeUndefined()
        expect(await ui.find({ text: width < 60 ? /✕/ : /failed \(exit 1\)/ })).toBeDefined()
        await ui.press({ key: 'filter-all' })
        await ui.press({ key: 'tab-live' })
        await ui.unmount()
      }
    }
  })

  test('trail, collisions and evidence navigation draw on every surface', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await runTwoAgents($)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/cache.ts', old_string: 'b', new_string: 'c', agentId: 'ag1' } as never)
    await engine.clock.advance(1100)
    for (const surface of SURFACES) {
      for (const width of [40, 120]) {
        const ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
        await ui.press({ key: 'tab-trail' })
        expect(await ui.find({ text: /Outcome so far/ })).toBeDefined()
        // The Trail's own picture (map or overview), told apart from the decorative backdrop by its alt. Sunset Glass draws
        // it on desktop from the medium layout up; compact draws no miniature chart (DESIGN-CONTRACT §10, V-9).
        const map = /"alt":"Contribution trail/.test(JSON.stringify(await ui.drawn()))
        expect(map).toBe(surface === 'desktop' && width >= 56)
        await ui.press({ key: 'node-1-1' })
        expect(await ui.find({ text: /names the edited file/ })).toBeDefined()
        await ui.press({ key: 'tab-collisions' })
        expect(await ui.find({ text: /Sequential edits to cache\.ts/ })).toBeDefined()
        await ui.press({ key: 'sig-0' })
        expect(await ui.find({ text: /not a defect by itself/ })).toBeDefined()
        await ui.press({ key: 'sig-src-0' })
        expect(await ui.find({ text: /evidence · event #/ })).toBeDefined()
        await ui.press({ key: 'tab-live' })
        await ui.unmount()
      }
    }
  })

  test('tab labels carry the hotkey number only where the surface does not show it', LOAD, async ($, on) => {
    engineBeneath(on)
    await startSession($)
    const desktop = withClients(await $.ui.mount({ ...PANE(64), surface: 'desktop' }))
    expect((await desktop.find({ key: 'tab-live' }))?.props.label).toBe('Live')
    await desktop.unmount()
    const terminal = withClients(await $.ui.mount({ ...PANE(64), surface: 'terminal' }))
    expect((await terminal.find({ key: 'tab-live' }))?.props.label).toBe('1 Live')
    await terminal.unmount()
  })

  test('/swarm-autopsy opens the pane and reports what it holds', LOAD, async ($, on) => {
    engineBeneath(on)
    await startSession($)
    await runTwoAgents($)
    const answer = await $.command.run({ command: 'swarm-autopsy', args: '', origin: { kind: 'composer' } } as never)
    expect(answer.text).toContain('2 subagents observed')
  })

  test('the command menu shows the views /swarm-autopsy takes as its argument hint', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    const spec = engine.registered.find(r => r.name === 'swarm-autopsy')
    expect(spec?.argumentHint).toBe('[live|trail|collisions|forensics|spend|health|export|close]')
    expect(spec?.description).toContain('tokens')
  })

  test('/swarm-autopsy export writes the collected session to a file under the session root and says where', LOAD, async ($, on) => {
    engineBeneath(on)
    const writes: Array<{ path: string; text: string }> = []
    on('fs.write', (_$, e) => {
      writes.push({ path: String(e.path), text: String(e.text) })
      return { value: undefined }
    })
    on('session.root', () => ({ value: '/repo' }))
    await startSession($)
    await runTwoAgents($)
    const answer = await $.command.run({ command: 'swarm-autopsy', args: 'export', origin: { kind: 'composer' } } as never)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toMatch(/^\/repo\/swarm-autopsy-export-\d+\.json$/)
    const body = JSON.parse(writes[0]?.text ?? '{}') as { kind?: string; snapshot?: { agentOrder?: string[] } }
    expect(body.kind).toBe('swarm-autopsy-export')
    expect(body.snapshot?.agentOrder?.length).toBeGreaterThan(1)
    expect(answer.text).toContain(writes[0]?.path ?? 'missing')
  })
})

// vNext integration: F2 ledger, F1 context and F3 spend vs outcome through the real hooks. SIMULATED.
describe('usage, context and spend integration', () => {
  async function usageSession($: Engine): Promise<void> {
    await runTwoAgents($)
    await step($, 'main-1', 0)
    await step($, 'ag1-1', 0, 'ag1')
    await step($, 'ag1-1', 1, 'ag1')
    await step($, 'ag2-1', 0, 'ag2')
    await step($, 'fork-1', 0, 'ag-cut')
  }

  test('a request that fails mid-stream is counted without usage and its error still reaches the caller', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    const failed = await step($, 'err-1', 0, 'ag-err').then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    // The kit reports a mock that throws as its own error; either way the caller is not handed a result.
    expect(failed).not.toBe('resolved')
    const { ledger, instruments } = await engine.snapshot()
    expect(instruments.step).toBe(1)
    expect(ledger.agents['ag-err']?.requests).toBe(0)
    expect(ledger.agents['ag-err']?.requestsWithoutUsage).toBe(1)
    expect(ledger.agents['ag-err']?.latest?.stopReason).toBeNull()
  })

  test('each request lands once in its own agent ledger; turn.complete only reconciles', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await usageSession($)
    await $.turn.complete({
      answer: '',
      durationMs: 10,
      isAborted: false,
      turnId: 'ag2-1',
      agentId: 'ag2',
      reason: 'answer',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, model: 'claude-opus-5-5' },
    })
    const { ledger, instruments } = await engine.snapshot()
    expect(instruments.step).toBe(5)
    expect(ledger.agents.ag1?.requests).toBe(2)
    expect(ledger.agents.ag1?.tokens).toEqual({ input: 20, cacheRead: 2000, cacheWrite: 400, output: 10 })
    expect(ledger.agents.main?.attribution).toBe('main-loop')
    expect(ledger.agents.ag2?.tokens).toEqual({ input: 10, cacheRead: 1000, cacheWrite: 200, output: 5 })
    expect(ledger.turns['ag2-1']?.reported).toEqual({ input: 10, cacheRead: 1000, cacheWrite: 200, output: 5 })
    expect(ledger.agents['ag-cut']?.requestsWithoutUsage).toBe(1)
    expect(ledger.since?.missedEarlier).toBe(false)
  })

  test('the Spend tab draws the ledger and spend vs outcome, with ≈$ only after the person turns cost on', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await usageSession($)
    await engine.clock.advance(1100)
    for (const surface of SURFACES) {
      for (const width of [40, 64, 120]) {
        const ui = withClients(await $.ui.mount({ ...PANE(width), surface }))
        await ui.press({ key: 'tab-spend' })
        expect(await ui.find({ text: /spend vs outcome/ })).toBeDefined()
        expect(await ui.find({ text: /≈<?\$\d/ })).toBeUndefined()
        await ui.press({ key: 'toggle-cost' })
        expect(await ui.find({ text: /≈<?\$\d/ })).toBeDefined()
        await ui.press({ key: 'toggle-cost' })
        expect(await ui.find({ text: /≈<?\$\d/ })).toBeUndefined()
        await ui.press({ key: 'tab-live' })
        await ui.unmount()
      }
    }
  })

  test('cards carry usage and a context gauge; the inspector opens the ledger, context and outcome details', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await usageSession($)
    await engine.clock.advance(1100)
    for (const surface of SURFACES) {
      const ui = withClients(await $.ui.mount({ ...PANE(120), surface }))
      const seen: string[] = []
      const mark = async (label: string, re: RegExp) => seen.push(`${label}:${(await ui.find({ text: re })) !== undefined}`)
      await mark('gauge', /ctx /)
      await ui.press({ key: 'card-ag1' })
      await mark('report', /Eviction in src\/cache\.ts never runs/)
      await ui.press({ key: 'card-ag1' })
      await ui.press({ key: 'tab-trail' })
      await mark('trail', /tokens processed/)
      await ui.press({ key: 'open-spend' })
      await mark('spend', /spend vs outcome/)
      expect(seen.join(' ')).toBe('gauge:true report:true trail:true spend:true')
      await ui.press({ key: 'tab-live' })
      await ui.unmount()
    }
  })

  test('an agent and the coordinating session both open their context, ledger and outcome details', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await usageSession($)
    await engine.clock.advance(1100)
    for (const surface of SURFACES) {
      const ui = withClients(await $.ui.mount({ ...PANE(120), surface }))
      // Sub-headings carry the surface's theme mark (classic `·` on the terminal, Abyssal's on desktop).
      const sub = themeFor(surface).chrome.subMark
      const sections = async () =>
        [/▌ context/, new RegExp(`${sub} ledger ·`), new RegExp(`${sub} outcome ·`)].map(async re => (await ui.find({ text: re })) !== undefined)
      await ui.press({ key: 'card-ag1' })
      expect(await Promise.all(await sections())).toEqual([true, true, true])
      await ui.press({ key: 'card-ag1' })
      await ui.press({ key: 'card-main' })
      expect(await Promise.all(await sections())).toEqual([true, true, true])
      await ui.press({ key: 'card-main' })
      await ui.unmount()
    }
  })

  test('with cost on, a card tags its ≈$ figure ESTIMATED apart from the observed token counts', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await usageSession($)
    await engine.clock.advance(1100)
    const ui = withClients(await $.ui.mount({ ...PANE(120), surface: 'terminal' }))
    expect(await ui.find({ text: /≈\$/ })).toBeUndefined()
    await ui.press({ key: 'tab-spend' })
    await ui.press({ key: 'toggle-cost' })
    await ui.press({ key: 'tab-live' })
    expect(await ui.find({ text: /● 2\.4k processed █+ · ≈<?\$\d/ })).toBeDefined()
    await ui.unmount()
  })

  test('a price table file that does not parse is reported and the built-in table is used', LOAD, async ($, on) => {
    engineBeneath(on)
    on('env.get', (_$, e) => ({ value: e.name === 'SWARM_AUTOPSY_PRICES' ? '/tmp/prices.json' : undefined }))
    on('fs.read', () => ({ value: '{"date": 3}' }))
    await startSession($)
    const ui = withClients(await $.ui.mount({ ...PANE(80), surface: 'desktop' }))
    await ui.press({ key: 'tab-spend' })
    expect(await ui.find({ text: /SWARM_AUTOPSY_PRICES \(\/tmp\/prices\.json\) was not used/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('browsing a live pane (desktop press handles)', () => {
  // On desktop every redraw re-mints every press handle, so a click carrying the last drawing's handle is lost while
  // the session keeps changing (seen in the desktop app's log: `ui_press not handled` for every tab press). An identical
  // drawing keeps its handles, so while the person browses the pane draws a frozen copy of the data and the clock.
  const readEvent = (n: number) => ({ tool: 'Read', file_path: `/repo/src/extra-${n}.ts`, agentId: 'ag1' }) as never
  // The drawing without its press handles: the test host mints new ones on every render, while the real engine reuses
  // its cached answer for an identical drawing (Report 01 §6, verified over stream-json). The drawing is what must hold.
  const drawing = async (ui: { drawn: () => Promise<unknown> }) => JSON.stringify(await ui.drawn(), (key, value) => (key === 'press' ? undefined : value))

  test('after a press, new observations leave the drawing unchanged until the person stops browsing', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await runTwoAgents($)
    await engine.clock.advance(1100)
    const ui = withClients(await $.ui.mount({ ...PANE(120), surface: 'desktop' }))
    await ui.press({ key: 'tab-forensics' })
    const before = await drawing(ui)
    await $.tool.call(readEvent(1))
    await engine.clock.advance(1100)
    expect(await drawing(ui)).toBe(before)
    expect(await ui.find({ text: /held while you browse/ })).toBeDefined()
    await engine.clock.advance(21_000)
    await $.tool.call(readEvent(2))
    await engine.clock.advance(1100)
    expect(await ui.find({ text: /extra-2\.ts/ })).toBeDefined()
    expect(await ui.find({ text: /held while you browse/ })).toBeUndefined()
    await ui.unmount()
  })

  test('the pause button freezes the pane until it is pressed again', LOAD, async ($, on) => {
    const engine = engineBeneath(on)
    await startSession($)
    await runTwoAgents($)
    await engine.clock.advance(1100)
    const ui = withClients(await $.ui.mount({ ...PANE(120), surface: 'terminal' }))
    await ui.press({ key: 'toggle-pause' })
    await ui.press({ key: 'tab-forensics' })
    await engine.clock.advance(30_000)
    await $.tool.call(readEvent(3))
    await engine.clock.advance(1100)
    expect(await ui.find({ text: /extra-3\.ts/ })).toBeUndefined()
    expect(await ui.find({ text: /⏸ paused/ })).toBeDefined()
    await ui.press({ key: 'toggle-pause' })
    await engine.clock.advance(30_000)
    await $.tool.call(readEvent(4))
    await engine.clock.advance(1100)
    expect(await ui.find({ text: /extra-3\.ts/ })).toBeDefined()
    await ui.unmount()
  })

  test('a view that throws on the data draws a fallback naming the error, never a blank pane', LOAD, async ($, on) => {
    engineBeneath(on)
    // A stored value of the right version and session but a broken shape: the views throw on it.
    const broken = { version: 3, sessionId: 'session-under-test', events: [], openTools: [], agents: {}, repos: {}, ledger: null }
    on('state.get', ($$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: broken, version: 1 } } : next(e)))
    const ui = withClients(await $.ui.mount({ ...PANE(80), surface: 'desktop' }))
    expect(await ui.find({ text: /could not draw/ })).toBeDefined()
    await ui.unmount()
  })

  test('a drawing whose reads fail before any view draws still names the reason, never a blank pane', LOAD, async ($, on) => {
    on('session.id', () => ({ value: 'session-under-test' }))
    on('agent.list', () => ({ value: [] }))
    // No clock beneath (the test host has none unless one is mocked), so the drawing's clock read rejects, a step before
    // any view draws: the engine would draw its own placeholder, "Nothing to show yet", the reason only in a debug log.
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = withClients(await $.ui.mount({ ...PANE(80), surface }))
      expect(await ui.find({ text: /could not draw/ })).toBeDefined()
      expect(await ui.find({ text: /clock\.now/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('the drawing fallback for a failed or overrun render names why, in a tree the engine accepts', () => {
    const els = { Box: 'Box', Text: 'Text' } as never
    const timeout = JSON.stringify(drawingFailed(els, 80, { kind: 'timeout', budget: 1000 }))
    expect(timeout).toMatch(/could not draw/)
    expect(timeout).toMatch(/10 s/)
    const thrown = JSON.stringify(drawingFailed(els, 80, { kind: 'throw', message: 'boom\u001b[31m', budget: 1000 }))
    expect(thrown).toMatch(/boom/)
    expect(thrown).not.toMatch(/\\u001b/)
  })
})
