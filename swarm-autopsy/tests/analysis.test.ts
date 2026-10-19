// Fixture tests of the contribution trail and the collision analysis.
// SIMULATED observations only; every expectation is a deterministic rule.

import { describe, expect, test } from 'claude-code/testing'

import { analyzeCollisions } from '../hooks/lib/collisions'
import { reduceAll } from '../hooks/lib/reduce'
import { UNLINKED_TEXT, UNVERIFIED_STALE_TEXT, UNVERIFIED_TEXT, buildTrail } from '../hooks/lib/trail'
import { trailSvg } from '../hooks/ui/trailmap'
import { build, spawn, threeAgentSession, tool, toolEnd, toolStart, turnEnd } from './fixtures'

const edgesBetween = (trail: ReturnType<typeof buildTrail>, from: string, to: string) =>
  trail.edges.filter(e => e.from === from && e.to === to)

describe('contribution trail', () => {
  test('explore → implement → test is linked by identifiers and inferred by shared paths', () => {
    const trail = buildTrail(build(...threeAgentSession()))
    const forwarded = edgesBetween(trail, 'n:explorer:finding', 'n:implementer:delegation')
    expect(forwarded[0]?.evidence).toBe('LINKED')
    expect(forwarded[0]?.basis).toContain('verbatim')
    const findingToChange = edgesBetween(trail, 'n:explorer:finding', 'n:implementer:change:/repo/src/auth/token.ts')
    expect(findingToChange[0]?.evidence).toBe('INFERRED')
    const taskToChange = edgesBetween(trail, 'n:implementer:delegation', 'n:implementer:change:/repo/src/auth/token.ts')
    expect(taskToChange[0]?.evidence).toBe('LINKED')
    const changeToTest = trail.edges.find(e => e.from === 'n:implementer:change:/repo/src/auth/token.ts' && e.to.startsWith('n:tester:verify:'))
    expect(changeToTest?.evidence).toBe('INFERRED')
    expect(trail.flags.filter(f => f.kind === 'unlinked')).toEqual([])
    expect(trail.flags.filter(f => f.kind === 'unverified')).toEqual([])
    expect(trail.outcome.verifications[0]?.latest).toBe('passed')
  })

  test('a report whose paths nobody touched afterwards is an unlinked contribution', () => {
    const trail = buildTrail(
      build(
        spawn('scout', { description: 'audit logging' }),
        turnEnd('scout', 't1', 'The logger in src/log/sink.ts drops lines under load.'),
        spawn('fixer', { prompt: 'Rename the button label in ui/button.tsx' }),
        ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/ui/button.tsx', old_string: 'Ok', new_string: 'OK' }),
      ),
    )
    const flag = trail.flags.find(f => f.kind === 'unlinked' && f.agentId === 'scout')
    expect(flag?.text).toBe(UNLINKED_TEXT)
    expect(flag?.evidence).toBe('UNRESOLVED')
  })

  test('order alone never links a report to a later change', () => {
    const trail = buildTrail(
      build(
        spawn('scout'),
        turnEnd('scout', 't1', 'Things look fine overall.'),
        spawn('fixer'),
        ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/src/a.ts', old_string: '1', new_string: '2' }),
      ),
    )
    expect(trail.edges.filter(e => e.from === 'n:scout:finding' && e.to.startsWith('n:fixer:'))).toEqual([])
    expect(trail.flags.find(f => f.agentId === 'scout')?.kind).toBe('unlinked')
  })

  test('a change with no verification afterwards is flagged unverified', () => {
    const trail = buildTrail(build(spawn('fixer'), ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/src/a.ts', old_string: '1', new_string: '2' })))
    const flag = trail.flags.find(f => f.kind === 'unverified')
    expect(flag?.text).toBe(UNVERIFIED_TEXT)
    expect(flag?.nodeId).toBe('n:fixer:change:/repo/src/a.ts')
  })

  test('a verification that names no file is linked only within the same agent, as inferred', () => {
    const trail = buildTrail(
      build(
        spawn('fixer'),
        ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/src/a.ts', old_string: '1', new_string: '2' }),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test' }),
        spawn('other'),
        ...tool('other', 'b2', 'Bash', { command: 'go test ./...' }),
      ),
    )
    const own = trail.edges.filter(e => e.from === 'n:fixer:change:/repo/src/a.ts')
    expect(own.map(e => e.to)).toEqual(['n:fixer:verify:tool:b1'])
    expect(own[0]?.evidence).toBe('INFERRED')
    expect(own[0]?.basis).toContain('same agent')
  })

  test('an agent that completes without a report is flagged as unavailable, not as ignored', () => {
    const trail = buildTrail(build(spawn('quiet'), turnEnd('quiet', 't1', '')))
    const flag = trail.flags.find(f => f.agentId === 'quiet')
    expect(flag?.kind).toBe('no-report')
    expect(flag?.evidence).toBe('UNAVAILABLE')
    expect(flag?.text).not.toContain('ignored')
  })

  test('agents seen without a spawn have an unavailable delegation', () => {
    const trail = buildTrail(build(...tool('ghost', 'r1', 'Read', { file_path: '/repo/x.ts' })))
    expect(trail.flags.find(f => f.agentId === 'ghost' && f.kind === 'no-delegation')?.evidence).toBe('UNAVAILABLE')
  })

  test('the latest failing run of a command stays unresolved; an inconclusive one is not a failure', () => {
    const trail = buildTrail(
      build(
        spawn('t'),
        ...tool('t', 'b1', 'Bash', { command: 'pytest -q' }, { isError: true, text: 'Exit code 1' }),
        ...tool('t', 'b2', 'Bash', { command: 'npm test' }, { result: { backgroundTaskId: 'bg1' } }),
      ),
    )
    expect(trail.flags.filter(f => f.kind === 'still-failing').map(f => f.text)).toEqual([
      'The latest captured run of `pytest -q` failed; no later passing run was captured.',
    ])
    expect(trail.outcome.verifications.find(v => v.command === 'npm test')?.latest).toBe('inconclusive')
  })

  test('a check that passed before the last edit of a file does not verify that change', () => {
    const trail = buildTrail(
      build(
        spawn('dev'),
        ...tool('dev', 'e1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' }),
        ...tool('dev', 'b1', 'Bash', { command: 'npm test -- a' }, { text: '1 passed' }),
        ...tool('dev', 'e2', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'y', new_string: 'z' }),
      ),
    )
    const change = 'n:dev:change:/repo/src/a.ts'
    const linked = trail.edges.filter(e => e.from === change && e.to.includes(':verify:'))
    expect(linked.map(e => e.basis.includes('ran before the last edit of this file'))).toEqual([true])
    const flag = trail.flags.find(f => f.nodeId === change)
    expect(flag?.kind).toBe('unverified')
    expect(flag?.text).toBe(UNVERIFIED_STALE_TEXT)
    expect(trail.outcome.unresolved).toBe(1)
  })

  test('a check run after the last edit of a file verifies the change', () => {
    const trail = buildTrail(
      build(
        spawn('dev'),
        ...tool('dev', 'e1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' }),
        ...tool('dev', 'b1', 'Bash', { command: 'npm test -- a' }, { isError: true, text: 'Exit code 1' }),
        ...tool('dev', 'e2', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'y', new_string: 'z' }),
        ...tool('dev', 'b2', 'Bash', { command: 'npm test -- a' }, { text: '1 passed' }),
      ),
    )
    const change = 'n:dev:change:/repo/src/a.ts'
    const linked = trail.edges.filter(e => e.from === change && e.to.includes(':verify:'))
    expect(linked).toHaveLength(1)
    expect(trail.flags.filter(f => f.nodeId === change)).toEqual([])
  })

  test('a command whose latest run is inconclusive stays unresolved until a decided run of it is captured', () => {
    const inconclusive = buildTrail(
      build(spawn('t'), ...tool('t', 'b1', 'Bash', { command: 'npm test | tail -5' }, { text: '3 passed' })),
    )
    const flag = inconclusive.flags.find(f => f.kind === 'inconclusive')
    expect(flag?.evidence).toBe('UNRESOLVED')
    expect(flag?.text).toContain('`npm test | tail -5`')
    expect(flag?.text).toContain('inconclusive')
    expect(inconclusive.outcome.unresolved).toBe(1)
    const decided = buildTrail(
      build(
        spawn('t'),
        ...tool('t', 'b1', 'Bash', { command: 'npm test' }, { result: { backgroundTaskId: 'bg1' } }),
        ...tool('t', 'b2', 'Bash', { command: 'npm test' }, { text: '3 passed' }),
      ),
    )
    expect(decided.flags.filter(f => f.kind === 'inconclusive')).toEqual([])
    expect(decided.outcome.verifications[0]?.latest).toBe('passed')
  })
})

// Regressions found in the first live run (live-test/runs/20261016T092140Z).
describe('contribution trail: live-run regressions', () => {
  const PROJECT = '/home/dev/projects/demo-run/runs/20261016T092140Z/demo'

  test('a shared absolute path is not a verbatim excerpt of a report', () => {
    const trail = buildTrail(
      build(
        spawn('a', { prompt: `Investigate ${PROJECT}/src/tokens.js` }),
        turnEnd('a', 't1', `Everything in ${PROJECT} looks fine to me.`),
        spawn('b', { prompt: `Run the tests in ${PROJECT} and report.` }),
      ),
    )
    expect(trail.edges.filter(e => e.from === 'n:a:finding' && e.to === 'n:b:delegation')).toEqual([])
  })

  test('a report cannot inform an agent that was delegated before the report existed', () => {
    const trail = buildTrail(
      build(
        spawn('early', { prompt: 'Fix src/tokens.js' }),
        spawn('reporter'),
        turnEnd('reporter', 't1', 'I left src/tokens.js alone.'),
        ...tool('early', 'e1', 'Edit', { file_path: '/repo/src/tokens.js', old_string: 'a', new_string: 'b' }),
      ),
    )
    expect(trail.edges.filter(e => e.from === 'n:reporter:finding')).toEqual(
      trail.edges.filter(e => e.from === 'n:reporter:finding' && e.to.startsWith('agent:')),
    )
  })

  test('a whole-suite run after a change in the same working tree is an inferred verification', () => {
    const base = build(
      spawn('fixer', { prompt: 'Fix src/tokens.js' }),
      ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/src/tokens.js', old_string: 'a', new_string: 'b' }),
      spawn('tester'),
      ...tool('tester', 'b1', 'Bash', { command: 'npm test 2>&1' }),
    )
    const trail = buildTrail(reduceAll({ ...base, cwd: '/repo' }, [{ kind: 'root', dir: '/repo/src', root: '/repo', commonDir: '/repo/.git' }]))
    const edge = trail.edges.find(e => e.from === 'n:fixer:change:/repo/src/tokens.js')
    expect(edge?.to).toBe('n:tester:verify:tool:b1')
    expect(edge?.evidence).toBe('INFERRED')
    expect(edge?.basis).toContain('whole-suite')
    expect(trail.flags.filter(f => f.kind === 'unverified')).toEqual([])
  })

  test('a whole-suite run after cd into the change\'s working tree verifies it, wherever the session started', () => {
    const base = build(
      spawn('fixer'),
      ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/src/tokens.ts', old_string: 'a', new_string: 'b' }),
      spawn('tester'),
      ...tool('tester', 'b1', 'Bash', { command: 'cd /repo && npm test' }),
    )
    const trail = buildTrail(reduceAll({ ...base, cwd: '/elsewhere' }, [{ kind: 'root', dir: '/repo/src', root: '/repo', commonDir: '/repo/.git' }]))
    expect(trail.edges.find(e => e.from === 'n:fixer:change:/repo/src/tokens.ts')?.basis).toContain('whole-suite')
    expect(trail.flags.filter(f => f.kind === 'unverified')).toEqual([])
  })

  test('a whole-suite run in an unknown working tree does not verify a change', () => {
    const trail = buildTrail(
      build(
        spawn('fixer'),
        ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/src/tokens.js', old_string: 'a', new_string: 'b' }),
        spawn('tester'),
        ...tool('tester', 'b1', 'Bash', { command: 'npm test' }),
      ),
    )
    expect(trail.flags.filter(f => f.kind === 'unverified')).toHaveLength(1)
  })

  test('a failed command never re-run is still unresolved, and says that later checks passed', () => {
    const script = "cat >> src/format.js <<'EOF'\nexport const x = 1\nEOF\nnode --test test/format.test.js"
    const trail = buildTrail(
      build(
        spawn('b'),
        ...tool('b', 'b1', 'Bash', { command: script }, { isError: true, text: 'Exit code 1' }),
        ...tool('b', 'b2', 'Bash', { command: 'npm test' }),
      ),
    )
    const flag = trail.flags.find(f => f.kind === 'still-failing')
    expect(flag?.evidence).toBe('UNRESOLVED')
    expect(flag?.text).toContain('was not run again')
    expect(flag?.text).toContain('Later verification runs passed: `npm test`')
    expect(flag?.text.length).toBeLessThan(300)
  })
})

// Findings of the code review, each pinned by a test.
describe('review findings', () => {
  const refused = { isError: true, text: 'Permission to use Edit has been denied.' }

  test('a refused or unfinished write is not a change and not a collision', () => {
    const snapshot = build(
      spawn('a'),
      spawn('b'),
      ...tool('a', 'e1', 'Edit', { file_path: '/repo/a.ts', old_string: '1', new_string: '2' }),
      ...tool('b', 'e2', 'Edit', { file_path: '/repo/a.ts', old_string: '2', new_string: '3' }, refused),
      toolStart('b', 'w1', 'Write', { file_path: '/repo/b.ts', content: 'x' }),
    )
    const trail = buildTrail(snapshot)
    expect(trail.lanes.find(l => l.agentId === 'b')?.nodes.filter(n => n.stage === 'change')).toEqual([])
    expect(trail.outcome.filesChanged).toEqual([{ path: '/repo/a.ts', agents: ['a'] }])
    const collisions = analyzeCollisions(snapshot)
    expect(collisions.signals.filter(s => s.kind === 'shared-write')).toEqual([])
    expect(collisions.files.find(f => f.path === '/repo/a.ts')?.touches.find(t => t.agentId === 'b')?.failedWrites).toBe(1)
  })

  test('separate repositories with the same relative path are not worktrees of one repository', () => {
    const snapshot = reduceAll(
      build(
        spawn('a'),
        spawn('b'),
        ...tool('a', 'e1', 'Edit', { file_path: '/work/projA/README.md', old_string: 'x', new_string: 'y' }),
        ...tool('b', 'e2', 'Edit', { file_path: '/work/projB/README.md', old_string: 'x', new_string: 'z' }),
      ),
      [
        { kind: 'root', dir: '/work/projA', root: '/work/projA', commonDir: '/work/projA/.git' },
        { kind: 'root', dir: '/work/projB', root: '/work/projB', commonDir: '/work/projB/.git' },
      ],
    )
    expect(analyzeCollisions(snapshot).signals.filter(s => s.kind === 'worktree-divergence')).toEqual([])
  })

  test('an agent known only from the roster gets no invented prompt or turn', () => {
    const snapshot = reduceAll(build(), [
      { kind: 'roster', at: 2_000_000, agents: [{ id: 'r1', type: 'Explore', description: 'found later', status: 'completed' }] },
    ])
    const trail = buildTrail(snapshot)
    const delegation = trail.lanes.find(l => l.agentId === 'r1')?.nodes.find(n => n.stage === 'delegation')
    expect(delegation?.lines.join(' ')).toContain('prompt unavailable')
    expect(trail.flags.filter(f => f.agentId === 'r1' && f.kind === 'no-report')).toEqual([])
  })

  test('a stopped agent without a report is not described as completed', () => {
    const trail = buildTrail(build(spawn('s'), turnEnd('s', 't1', '', 'aborted')))
    expect(trail.flags.find(f => f.agentId === 's' && f.kind === 'no-report')?.text).toContain('stopped')
  })

  test('verification edges need a real verdict, skip generic stems, and are capped per change', () => {
    const checks = Array.from({ length: 6 }, (_, i) => tool('other', `t${i}`, 'Bash', { command: `npm test -- tokens case${i}` })).flat()
    const trail = buildTrail(
      build(
        spawn('fixer'),
        ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/src/tokens.ts', old_string: 'a', new_string: 'b' }),
        ...tool('fixer', 'e2', 'Edit', { file_path: '/repo/src/build.ts', old_string: 'a', new_string: 'b' }),
        ...tool('fixer', 'n1', 'Bash', { command: 'npm test' }, { isError: true, text: 'Permission to use Bash has been denied.' }),
        spawn('other'),
        ...tool('other', 'b0', 'Bash', { command: 'npm run build' }),
        ...checks,
      ),
    )
    const fromTokens = trail.edges.filter(e => e.from === 'n:fixer:change:/repo/src/tokens.ts')
    expect(fromTokens.length).toBe(3)
    expect(fromTokens.some(e => e.to === 'n:fixer:verify:tool:n1')).toBe(false)
    expect(trail.edges.filter(e => e.from === 'n:fixer:change:/repo/src/build.ts')).toEqual([])
  })

  test('the same command in different working trees is tracked separately', () => {
    const trail = buildTrail(
      build(
        spawn('a', { cwd: '/repo/wt-a' }),
        spawn('b', { cwd: '/repo/wt-b' }),
        ...tool('a', 'b1', 'Bash', { command: 'npm test' }, { isError: true, text: 'Exit code 1' }),
        ...tool('b', 'b2', 'Bash', { command: 'npm test' }),
      ),
    )
    expect(trail.flags.filter(f => f.kind === 'still-failing')).toHaveLength(1)
    expect(trail.outcome.verifications).toHaveLength(2)
  })

  test('text the coordinator gave the author too is not evidence the report was forwarded', () => {
    const brief = 'Shared project brief: the service keeps tokens in memory and renews them every five minutes for each client.'
    const trail = buildTrail(
      build(
        spawn('a', { prompt: `${brief} Investigate src/x.ts.` }),
        turnEnd('a', 't1', `${brief} Nothing else to add.`),
        spawn('b', { prompt: `${brief} Fix src/y.ts.` }),
      ),
    )
    expect(trail.edges.filter(e => e.from === 'n:a:finding' && e.to === 'n:b:delegation')).toEqual([])
  })

  test('a short shared phrase is inferred, a long excerpt is linked', () => {
    const phrase = 'the cache never evicts entries older than one hour'
    const long = `${phrase} because the sweep timer is created before the clock is injected, so every sweep reads time zero and keeps everything.`
    const short = buildTrail(build(spawn('a'), turnEnd('a', 't1', `Root cause: ${phrase}.`), spawn('b', { prompt: `Note that ${phrase}; fix it.` })))
    const full = buildTrail(build(spawn('a'), turnEnd('a', 't1', `Root cause: ${long}`), spawn('b', { prompt: `Fix this: ${long}` })))
    expect(short.edges.find(e => e.from === 'n:a:finding' && e.to === 'n:b:delegation')?.evidence).toBe('INFERRED')
    expect(full.edges.find(e => e.from === 'n:a:finding' && e.to === 'n:b:delegation')?.evidence).toBe('LINKED')
  })

  test('the excerpt check stays fast with many agents and long, overlapping texts', () => {
    const base = Array.from({ length: 300 }, (_, i) => `word${i % 40}`).join(' ')
    const observations = Array.from({ length: 80 }, (_, i) => [
      spawn(`ag${i}`, { prompt: `${base} task ${i}` }),
      turnEnd(`ag${i}`, `t${i}`, `${base} report ${i}`),
    ]).flat()
    const snapshot = build(...observations)
    const started = Date.now()
    buildTrail(snapshot)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})

describe('trail map', () => {
  test('draws one box per node, one path per edge, and escapes text', () => {
    const snapshot = build(...threeAgentSession(), spawn('odd', { description: 'check <script> & "quotes"' }))
    const trail = buildTrail(snapshot)
    const { source } = trailSvg(snapshot, trail)
    const nodes = trail.lanes.reduce((n, lane) => n + lane.nodes.length, 0)
    // One stage pill per node (Sunset Glass: nodes are rounded pills).
    expect(source.match(/<rect class="pill" x="\d+" y="\d+"/g)?.length).toBe(nodes)
    // Report hand-backs to the spawner stay in the list and are left out of the map (DESIGN-CONTRACT §8.3).
    expect(source.match(/<path d="M[\d.]+,[\d.]+ C/g)?.length).toBe(trail.edges.filter(e => !e.to.startsWith('agent:')).length)
    expect(source).not.toContain('<script>')
    expect(source).toContain('&lt;script&gt;')
  })
})

describe('collisions', () => {
  test('two agents editing the same file interleaved, one over the other', () => {
    const collisions = analyzeCollisions(
      build(
        spawn('a'),
        spawn('b'),
        ...tool('a', 'e1', 'Edit', { file_path: '/repo/src/cache.ts', old_string: 'size = 10', new_string: 'size = limit * 2 // tuned' }),
        ...tool('b', 'e2', 'Edit', { file_path: '/repo/src/cache.ts', old_string: 'size = limit * 2 // tuned', new_string: 'size = 64' }),
        ...tool('a', 'e3', 'Edit', { file_path: '/repo/src/cache.ts', old_string: 'evict()', new_string: 'evictOldest()' }),
      ),
    )
    const shared = collisions.signals.find(s => s.kind === 'shared-write')
    expect(shared?.severity).toBe('investigate')
    expect(shared?.title).toContain('Interleaved')
    const over = collisions.signals.find(s => s.kind === 'overwrite')
    expect(over?.evidence).toBe('LINKED')
    expect(over?.agents).toEqual(['b', 'a'])
    expect(collisions.files[0]?.touches.map(t => t.agentId)).toEqual(['a', 'b'])
  })

  test('the same relative path in separate worktrees is divergence, not a physical conflict', () => {
    const snapshot = reduceAll(
      build(
        spawn('a', { cwd: '/repo/.claude/worktrees/a' }),
        spawn('b', { cwd: '/repo/.claude/worktrees/b' }),
        ...tool('a', 'e1', 'Edit', { file_path: '/repo/.claude/worktrees/a/src/api.ts', old_string: 'x', new_string: 'y' }),
        ...tool('b', 'e2', 'Edit', { file_path: '/repo/.claude/worktrees/b/src/api.ts', old_string: 'x', new_string: 'z' }),
      ),
      [
        { kind: 'root', dir: '/repo/.claude/worktrees/a/src', root: '/repo/.claude/worktrees/a', commonDir: '/repo/.git' },
        { kind: 'root', dir: '/repo/.claude/worktrees/b/src', root: '/repo/.claude/worktrees/b', commonDir: '/repo/.git' },
      ],
    )
    const collisions = analyzeCollisions(snapshot)
    expect(collisions.signals.filter(s => s.kind === 'shared-write')).toEqual([])
    const divergence = collisions.signals.find(s => s.kind === 'worktree-divergence')
    expect(divergence?.severity).toBe('notice')
    expect(divergence?.detail.join(' ')).toContain('not a physical conflict')
  })

  test('repeated failures of one command are a signal', () => {
    const collisions = analyzeCollisions(
      build(
        spawn('a'),
        ...tool('a', 'b1', 'Bash', { command: 'npm  test' }, { isError: true, text: 'Exit code 1' }),
        ...tool('a', 'b2', 'Bash', { command: 'npm test' }, { isError: true, text: 'Exit code 1' }),
      ),
    )
    const repeated = collisions.signals.find(s => s.kind === 'repeated-failure')
    expect(repeated?.title).toBe('`npm test` failed 2 times')
    expect(repeated?.eventIds).toEqual(['tool:b1', 'tool:b2'])
  })

  test('contradictory results of one command are reported in order', () => {
    const collisions = analyzeCollisions(
      build(
        spawn('a'),
        ...tool('a', 'b1', 'Bash', { command: 'pytest' }, { isError: true, text: 'Exit code 1' }),
        ...tool('a', 'b2', 'Bash', { command: 'pytest' }, { text: 'ok' }),
      ),
    )
    expect(collisions.signals.find(s => s.kind === 'contradictory-results')?.title).toBe('`pytest` failed, then passed later')
  })

  test('a test that ran while another agent edited a file is a signal to investigate', () => {
    const collisions = analyzeCollisions(
      build(
        spawn('tester'),
        spawn('editor'),
        toolStart('tester', 'b1', 'Bash', { command: 'npm test -- cache' }),
        ...tool('editor', 'e1', 'Edit', { file_path: '/repo/src/cache.ts', old_string: 'a', new_string: 'b' }),
        toolEnd('tester', 'b1', 'Bash', { command: 'npm test -- cache' }),
      ),
    )
    const during = collisions.signals.find(s => s.kind === 'test-during-change')
    expect(during?.evidence).toBe('INFERRED')
    expect(during?.agents).toEqual(['tester', 'editor'])
  })

  test('an agent that writes after another agent changed the file it read may have used a stale read', () => {
    const collisions = analyzeCollisions(
      build(
        spawn('a'),
        spawn('b'),
        ...tool('a', 'r1', 'Read', { file_path: '/repo/src/x.ts' }),
        ...tool('b', 'e1', 'Edit', { file_path: '/repo/src/x.ts', old_string: '1', new_string: '2' }),
        ...tool('a', 'e2', 'Write', { file_path: '/repo/src/x.ts', content: 'all new' }),
      ),
    )
    expect(collisions.signals.find(s => s.kind === 'stale-write')?.agents).toEqual(['a', 'b'])
  })

  test('a single agent editing alone produces no collision', () => {
    const collisions = analyzeCollisions(build(spawn('a'), ...tool('a', 'e1', 'Edit', { file_path: '/repo/a.ts', old_string: '1', new_string: '2' })))
    expect(collisions.signals).toEqual([])
    expect(collisions.files).toHaveLength(1)
  })
})

// vNext: the trail facts F3 (spend vs outcome) relies on.
describe('trail facts for outcome classification', () => {
  const edit = (agent: string, id: string, to: string) =>
    tool(agent, id, 'Edit', { file_path: '/repo/src/a.ts', old_string: 'x', new_string: to })

  test('a fail-then-fix sequence links the passing rerun, and the change knows when its last write ended', () => {
    const snapshot = build(
      spawn('i'),
      ...edit('i', 'e1', 'y'),
      ...tool('i', 'b1', 'Bash', { command: 'npm test -- a' }, { isError: true, text: 'Exit code 1' }),
      ...edit('i', 'e2', 'z'),
      ...tool('i', 'b2', 'Bash', { command: 'npm test -- a' }, { text: '1 passed' }),
    )
    const trail = buildTrail(snapshot)
    const nodes = trail.lanes.flatMap(l => l.nodes)
    const change = nodes.find(n => n.stage === 'change')
    const linked = trail.edges.filter(e => e.from === change?.id).map(e => nodes.find(n => n.id === e.to))
    expect(linked.map(n => n?.verdict)).toEqual(['passed'])
    const lastWrite = snapshot.events.find(e => e.id === 'tool:e2')
    expect(change?.lastWriteSeq).toBe(lastWrite?.endSeq)
    expect((linked[0]?.seq ?? 0) > (change?.lastWriteSeq ?? Infinity)).toBe(true)
  })

  test('an edit after the last passing run leaves that run before the last write', () => {
    const trail = buildTrail(
      build(spawn('i'), ...edit('i', 'e1', 'y'), ...tool('i', 'b1', 'Bash', { command: 'npm test -- a' }, { text: '1 passed' }), ...edit('i', 'e2', 'z')),
    )
    const nodes = trail.lanes.flatMap(l => l.nodes)
    const change = nodes.find(n => n.stage === 'change')
    const check = nodes.find(n => n.id === trail.edges.find(e => e.from === change?.id)?.to)
    expect(check?.verdict).toBe('passed')
    expect((check?.seq ?? Infinity) < (change?.lastWriteSeq ?? 0)).toBe(true)
  })

  test('a report node names its source event, and command flags name their command', () => {
    const trail = buildTrail(build(...threeAgentSession()))
    const finding = trail.lanes.flatMap(l => l.nodes).find(n => n.id === 'n:explorer:finding')
    expect(finding?.eventIds).toEqual(['turn:t-explorer:end'])
    const inconclusive = buildTrail(build(spawn('t'), ...tool('t', 'b1', 'Bash', { command: 'npm test | tail -5' }, { text: '3 passed' })))
    const flag = inconclusive.flags.find(f => f.kind === 'inconclusive')
    expect(flag?.command).toBe(inconclusive.outcome.verifications[0]?.command)
  })
})
