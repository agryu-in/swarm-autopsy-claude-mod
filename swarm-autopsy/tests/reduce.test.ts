// Fixture tests of the collector's reducer: SIMULATED observations in,
// snapshot out. Nothing here touches a live session.

import { describe, expect, test } from 'claude-code/testing'

import { MAIN, MAX_EVENTS, emptySnapshot, reduce, reduceAll } from '../hooks/lib/reduce'
import { build, spawn, threeAgentSession, tool, toolEnd, toolStart, turnEnd, turnStart } from './fixtures'

const subagents = (snapshot: ReturnType<typeof build>) => snapshot.agentOrder.filter(id => id !== MAIN)

describe('reduce', () => {
  test('a session with no subagents keeps only the main loop', () => {
    const snapshot = build(turnStart(undefined, 'm1', 'hi'), ...tool(undefined, 'x1', 'Read', { file_path: '/repo/a.ts' }), turnEnd(undefined, 'm1', 'done'))
    expect(subagents(snapshot)).toEqual([])
    expect(snapshot.agents[MAIN]?.counts.reads).toBe(1)
    expect(snapshot.events.map(e => e.kind)).toEqual(['turn-start', 'tool', 'turn-end'])
  })

  test('one agent starts and completes with an observed report and a linked parent', () => {
    const snapshot = build(
      spawn('a1', { description: 'look around' }),
      turnStart('a1', 't1'),
      ...tool('a1', 'r1', 'Read', { file_path: '/repo/a.ts' }),
      turnEnd('a1', 't1', 'Found it in a.ts'),
    )
    const agent = snapshot.agents.a1
    expect(agent?.state).toBe('completed')
    expect(agent?.description).toBe('look around')
    expect(agent?.parentId).toBe(MAIN)
    expect(agent?.parentEvidence).toBe('LINKED')
    expect(agent?.report?.excerpt).toBe('Found it in a.ts')
    expect(agent?.report?.mentions).toEqual(['a.ts'])
    expect(agent?.currentTool).toBeUndefined()
    expect(agent?.label).toBe('A')
  })

  test('concurrent agents keep their own attribution', () => {
    const snapshot = build(
      spawn('a1'),
      spawn('a2'),
      toolStart('a1', 'x1', 'Read', { file_path: '/repo/one.ts' }),
      toolStart('a2', 'x2', 'Edit', { file_path: '/repo/two.ts', old_string: 'a', new_string: 'b' }),
      toolEnd('a2', 'x2', 'Edit', { file_path: '/repo/two.ts', old_string: 'a', new_string: 'b' }),
      toolEnd('a1', 'x1', 'Read', { file_path: '/repo/one.ts' }),
    )
    expect(snapshot.agents.a1?.counts).toMatchObject({ reads: 1, writes: 0 })
    expect(snapshot.agents.a2?.counts).toMatchObject({ reads: 0, writes: 1 })
    expect(snapshot.events.find(e => e.toolUseId === 'x2')?.agentId).toBe('a2')
    expect(snapshot.agents.a1?.state).toBe('active')
    expect(snapshot.agents.a2?.state).toBe('active')
  })

  test('an agent seen only through its own events has unknown metadata, never invented', () => {
    const snapshot = build(...tool('ghost', 'g1', 'Read', { file_path: '/repo/x.ts' }))
    const ghost = snapshot.agents.ghost
    expect(ghost?.knownFrom).toBe('events')
    expect(ghost?.type).toBeUndefined()
    expect(ghost?.description).toBeUndefined()
    expect(ghost?.parentId).toBeUndefined()
    expect(ghost?.parentEvidence).toBe('UNAVAILABLE')
  })

  test('a spawn that started no local agent is recorded without creating one, and is not a denial', () => {
    const snapshot = build(spawn(undefined, { description: 'remote work' }))
    expect(subagents(snapshot)).toEqual([])
    expect(snapshot.events[0]?.kind).toBe('spawn')
    expect(snapshot.events[0]?.summary).toContain('no local agent')
  })

  test('a refused spawn is recorded as a denial', () => {
    const snapshot = build({ ...spawn(undefined, { description: 'blocked' }), denied: 'policy' })
    expect(snapshot.events[0]?.kind).toBe('spawn-denied')
  })

  test('a call whose start was evicted is not counted twice when it ends', () => {
    const many = Array.from({ length: MAX_EVENTS }, (_, i) => tool(undefined, `f${i}`, 'Read', { file_path: `/r/f${i}.ts` })).flat()
    const snapshot = build(toolStart('a1', 'long', 'Bash', { command: 'sleep 99' }), ...many, toolEnd('a1', 'long', 'Bash', { command: 'sleep 99' }))
    expect(snapshot.agents.a1?.counts.tools).toBe(1)
    expect(snapshot.agents.a1?.currentTool).toBeUndefined()
  })

  test('a turn end clears the agent\'s current tool', () => {
    const snapshot = build(spawn('a1'), toolStart('a1', 'x1', 'Bash', { command: 'sleep 1' }), turnEnd('a1', 't1', '', 'aborted'))
    expect(snapshot.agents.a1?.currentTool).toBeUndefined()
  })

  test('events arriving before the spawn merge into one agent', () => {
    const snapshot = build(
      ...tool('a1', 'x1', 'Read', { file_path: '/repo/a.ts' }),
      spawn('a1', { type: 'Explore', description: 'late spawn' }),
    )
    const agent = snapshot.agents.a1
    expect(subagents(snapshot)).toEqual(['a1'])
    expect(agent?.type).toBe('Explore')
    expect(agent?.description).toBe('late spawn')
    expect(agent?.parentEvidence).toBe('LINKED')
    expect(agent?.counts.reads).toBe(1)
    expect(agent?.knownFrom).toBe('spawn')
  })

  test('a tool end with no start still records the call', () => {
    const snapshot = build(toolEnd('a1', 'x9', 'Bash', { command: 'npm test' }, { isError: true, text: 'Exit code 1' }))
    const event = snapshot.events.find(e => e.toolUseId === 'x9')
    expect(event?.outcome?.verdict).toBe('failed')
    expect(event?.source).toContain('start not observed')
  })

  test('a late tool end does not reopen a completed agent', () => {
    const snapshot = build(
      spawn('a1'),
      toolStart('a1', 'x1', 'Bash', { command: 'sleep 1' }),
      turnEnd('a1', 't1', 'done'),
      toolEnd('a1', 'x1', 'Bash', { command: 'sleep 1' }),
    )
    expect(snapshot.agents.a1?.state).toBe('completed')
    expect(snapshot.agents.a1?.currentTool).toBeUndefined()
  })

  test('a new turn of a completed agent makes it active again', () => {
    const snapshot = build(spawn('a1'), turnEnd('a1', 't1', 'first'), turnStart('a1', 't2', 'more please'))
    expect(snapshot.agents.a1?.state).toBe('active')
    expect(snapshot.agents.a1?.turns).toBe(1)
  })

  test('an agent id that names an Object.prototype member is still a new agent', () => {
    const s = build(spawn('constructor'), ...tool('constructor', 'r1', 'Read', { file_path: '/repo/a.ts' }))
    const id: string = 'constructor'
    expect(s.agentOrder).toEqual([MAIN, id])
    expect(s.agents[id]?.counts.tools).toBe(1)
    expect(s.agents[id]?.parentId).toBe(MAIN)
  })

  test('duplicate observations are dropped', () => {
    const once = [spawn('a1'), ...tool('a1', 'x1', 'Read', { file_path: '/repo/a.ts' }), turnEnd('a1', 't1', 'ok')]
    const snapshot = build(...once, ...once)
    expect(snapshot.events).toHaveLength(3)
    expect(snapshot.agents.a1?.counts.reads).toBe(1)
    expect(snapshot.agents.a1?.turns).toBe(1)
  })

  test('an agent that completes with no answer has no report', () => {
    const snapshot = build(spawn('a1'), turnEnd('a1', 't1', ''))
    expect(snapshot.agents.a1?.state).toBe('completed')
    expect(snapshot.agents.a1?.report).toBeUndefined()
  })

  test('interrupted and failed turns map to stopped and failed', () => {
    const snapshot = build(spawn('a1'), spawn('a2'), turnEnd('a1', 't1', '', 'aborted'), turnEnd('a2', 't2', '', 'error'))
    expect(snapshot.agents.a1?.state).toBe('stopped')
    expect(snapshot.agents.a2?.state).toBe('failed')
  })

  test('a handback tool call supplies the report of a background agent', () => {
    const snapshot = build(
      spawn('bg'),
      toolStart('bg', 'h1', 'SubagentHandback', { message: 'Background finding about cache.ts' }),
      turnEnd('bg', 't1', ''),
    )
    expect(snapshot.agents.bg?.report?.excerpt).toBe('Background finding about cache.ts')
    expect(snapshot.agents.bg?.report?.source).toContain('SubagentHandback')
  })

  test('roster entries fill gaps without overriding observed facts', () => {
    const start = build(spawn('a1', { type: 'Explore' }), ...tool('b9', 'x1', 'Read', { file_path: '/repo/a.ts' }))
    const snapshot = reduce(start, {
      kind: 'roster',
      at: 2_000_000,
      agents: [
        { id: 'a1', type: 'Plan', description: 'other', status: 'running' },
        { id: 'b9', type: 'general-purpose', description: 'found via list', status: 'completed', parentId: 'a1' },
      ],
    })
    expect(snapshot.agents.a1?.type).toBe('Explore')
    expect(snapshot.agents.b9?.type).toBe('general-purpose')
    expect(snapshot.agents.b9?.parentId).toBe('a1')
    expect(snapshot.agents.b9?.parentEvidence).toBe('LINKED')
    expect(snapshot.agents.b9?.state).toBe('completed')
  })

  test('the event list is bounded and counts what it dropped', () => {
    const calls = Array.from({ length: MAX_EVENTS + 25 }, (_, i) => tool(undefined, `t${i}`, 'Read', { file_path: `/repo/f${i}.ts` })).flat()
    const snapshot = build(...calls)
    expect(snapshot.events).toHaveLength(MAX_EVENTS)
    expect(snapshot.droppedEvents).toBe(25)
    expect(snapshot.agents[MAIN]?.counts.reads).toBe(MAX_EVENTS + 25)
  })

  test('a three-agent session yields ordered, attributed events', () => {
    const snapshot = build(...threeAgentSession())
    expect(subagents(snapshot)).toEqual(['explorer', 'implementer', 'tester'])
    expect(snapshot.agents.tester?.label).toBe('C')
    const seqs = snapshot.events.map(e => e.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
  })

  test('reset starts an empty snapshot for a new session', () => {
    const old = build(...threeAgentSession())
    const fresh = reduceAll(emptySnapshot(5, 'next-session'), [])
    expect(old.events.length).toBeGreaterThan(0)
    expect(fresh.events).toEqual([])
    expect(fresh.sessionId).toBe('next-session')
    expect(Object.keys(fresh.agents)).toEqual([MAIN])
  })
})
