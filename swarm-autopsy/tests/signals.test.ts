// Swarm Health's gathering function (DESIGN-CONTRACT §8.7, Report 03 §7): every
// entry maps an existing export's own finding, with its own words and scale.
// SIMULATED fixtures only; no score, no threshold, no new detection is tested
// for, because none may exist.

import { describe, expect, test } from 'claude-code/testing'

import { analyzeCollisions, type Collisions } from '../hooks/lib/collisions'
import { applyTurnReport, applyUsage, buildLedgerView } from '../hooks/lib/ledger'
import { buildSpendOutcome } from '../hooks/lib/outcome'
import { gatherSignals, isValueOnly, leadOf, type HealthInputs } from '../hooks/lib/signals'
import { buildTrail } from '../hooks/lib/trail'
import type { HealthSignal, Snapshot, UsageRecord } from '../types'
import { build, spawn, tool, turnEnd, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'

const NOW = 1_000_000

function inputsOf(snapshot: Snapshot, collisions?: Collisions): HealthInputs {
  const trail = buildTrail(snapshot)
  const ledger = buildLedgerView(snapshot.ledger, snapshot, { showCost: false })
  return {
    snapshot,
    trail,
    collisions: collisions ?? analyzeCollisions(snapshot),
    ledger,
    spend: buildSpendOutcome(snapshot, trail, ledger),
  }
}

function withRecords(snapshot: Snapshot, records: readonly UsageRecord[]): Snapshot {
  return { ...snapshot, ledger: records.reduce((ledger, record) => applyUsage(ledger, record), snapshot.ledger) }
}

/** Two agents editing one file interleaved, a failing check, and every F1/F2/coverage source raised once. */
function richSnapshot(): Snapshot {
  const base = build(
    spawn('a', { type: 'Explore', description: 'tune the cache' }),
    spawn('b', { description: 'fix the cache' }),
    turnStart('a', 't-a'),
    ...tool('a', 'r1', 'Read', { file_path: '/repo/src/cache.ts' }),
    ...tool('a', 'e1', 'Edit', { file_path: '/repo/src/cache.ts', old_string: 'size = 10', new_string: 'size = limit * 2 // tuned' }),
    ...tool('b', 'e2', 'Edit', { file_path: '/repo/src/cache.ts', old_string: 'size = limit * 2 // tuned', new_string: 'size = 64' }),
    ...tool('a', 'e3', 'Edit', { file_path: '/repo/src/cache.ts', old_string: 'evict()', new_string: 'evictOldest()' }),
    ...tool('b', 'b1', 'Bash', { command: 'npm test -- cache' }, { isError: true, text: 'Exit code 1\nFAILED' }),
    ...tool('b', 'e4', 'Edit', { file_path: '/repo/src/util.ts', old_string: 'x', new_string: 'y' }),
    turnEnd('a', 't-a', 'Tuned the cache size in src/cache.ts.'),
  )
  const records = [
    usageRecord({ agentId: 'main', turnId: 'm', index: 0, at: NOW, tokens: tokens(10, 5_000, 100, 50) }),
    usageRecord({ agentId: 'a', turnId: 'x', index: 0, at: NOW + 1, tokens: tokens(10, 9_000, 100, 50), stopReason: 'max_tokens' }),
    usageRecord({ agentId: 'b', turnId: 'y', index: 0, at: NOW + 2, tokens: tokens(10, 4_000, 100, 50), stopReason: 'refusal' }),
    usageRecord({ agentId: 'b', turnId: 'y', index: 1, at: NOW + 3, tokens: null }),
    usageRecord({ agentId: 'fork-9', turnId: 'f', index: 0, at: NOW + 4, tokens: tokens(7, 70, 7, 7) }),
  ]
  // The same request heard twice: set aside as a duplicate.
  const counted = withRecords(base, [...records, records[0] as UsageRecord])
  // turn.complete reports another total for a's turn than its steps add up to: a reconciliation mismatch.
  const reconciled = applyTurnReport(counted.ledger, { turnId: 'x', agentId: 'a', at: NOW + 5, tokens: tokens(99, 9_000, 100, 50) })
  return {
    ...counted,
    ledger: { ...reconciled, since: { at: NOW, missedEarlier: true, basis: 'the collector started after 2 prompts in this session' } },
    context: { window: 1_000_000, tokens: 90_000, percent: 9, at: NOW + 6 },
    compactionMarks: [{ agentId: 'a', at: NOW + 7, seq: 999, trigger: 'auto', tokensBefore: 41_000 }],
    droppedEvents: 3,
  }
}

const bySource = (signals: readonly HealthSignal[], source: HealthSignal['source']) => signals.filter(s => s.source === source)

describe('swarm health: gathering', () => {
  test('an empty session raises nothing', () => {
    expect(gatherSignals(inputsOf(build()))).toEqual([])
  })

  test('every source is mapped, in source order', () => {
    const signals = gatherSignals(inputsOf(richSnapshot()))
    const order = ['trail', 'collisions', 'context', 'ledger', 'outcome', 'coverage']
    const sources = signals.map(s => s.source)
    expect([...new Set(sources)]).toEqual(order)
    // Sources come in blocks, never interleaved.
    expect(sources).toEqual([...sources].sort((x, y) => order.indexOf(x) - order.indexOf(y)))
  })

  test('trail flags keep their own text verbatim: the title is its lead, why the whole text', () => {
    const input = inputsOf(richSnapshot())
    const signals = bySource(gatherSignals(input), 'trail')
    expect(signals).toHaveLength(input.trail.flags.length)
    input.trail.flags.forEach((flag, i) => {
      const signal = signals[i]
      expect(signal?.id).toBe(`trail:${flag.id}`)
      expect(signal?.why).toBe(flag.text)
      expect(flag.text.startsWith(signal?.title ?? '∅')).toBe(true)
      expect(signal?.evidence).toBe(flag.evidence)
      expect(signal?.level).toBe(flag.evidence === 'UNRESOLVED' ? 'unresolved' : 'unavailable')
      expect(signal?.agentIds).toEqual([flag.agentId])
    })
    const unverified = signals.find(s => s.id.endsWith(':unverified'))
    expect(unverified?.title).toBe('Unverified change')
    expect(unverified?.nodeId).toBeDefined()
    expect(unverified?.eventIds.length).toBeGreaterThan(0)
    // A command flag names no node; it is shown on the latest run of that exact command.
    const failing = signals.find(s => s.id.startsWith('trail:f:still-failing'))
    expect(failing?.nodeId).toMatch(/verify/)
    expect(failing?.eventIds).toEqual(['tool:b1'])
  })

  test('collision signals keep their title, first detail line, severity and evidence', () => {
    const input = inputsOf(richSnapshot())
    const signals = bySource(gatherSignals(input), 'collisions')
    expect(signals).toHaveLength(input.collisions.signals.length)
    input.collisions.signals.forEach((source, i) => {
      const signal = signals[i]
      expect(signal?.id).toBe(`col:${source.id}`)
      expect(signal?.title).toBe(source.title)
      expect(signal?.why).toBe(source.detail[0] ?? source.title)
      expect(signal?.level).toBe(source.severity)
      expect(signal?.evidence).toBe(source.evidence)
      expect(signal?.agentIds).toEqual(source.agents)
      expect(signal?.eventIds).toEqual(source.eventIds)
    })
    // The trail node that holds the signal's first source event, when one does.
    expect(signals.find(s => s.title.startsWith('Interleaved'))?.nodeId).toMatch(/^n:a:change/)
  })

  test('context: the main % as a value only, captured context stop reasons and compactions, refusal left out', () => {
    const signals = bySource(gatherSignals(inputsOf(richSnapshot())), 'context')
    expect(signals.map(s => s.id)).toEqual(['ctx:main:percent', 'ctx:a:stop:max_tokens', 'ctx:a:compaction:999'])
    expect(signals.every(s => s.level === 'observed' && s.evidence === 'OBSERVED')).toBe(true)
    const [percent, stop, compaction] = signals
    expect(percent?.title).toBe('main context 9%')
    expect(percent?.why).toMatch(/^session\.measure used percentage/)
    expect(isValueOnly(percent as HealthSignal)).toBe(true)
    expect(isValueOnly(stop as HealthSignal)).toBe(false)
    expect(stop?.title).toBe('stop reason max_tokens ×1')
    expect(compaction?.title).toBe('compacted (auto) · 41k tokens before, after not captured')
    expect(signals.some(s => s.title.includes('refusal'))).toBe(false)
  })

  test('without a fill reading, no main % is gathered', () => {
    const snapshot = { ...richSnapshot(), context: { window: 1_000_000, at: NOW } }
    expect(gatherSignals(inputsOf(snapshot)).some(s => s.id === 'ctx:main:percent')).toBe(false)
  })

  test('ledger: unknown ids, reconciliation mismatches, duplicates set aside and requests without usage, in the ledger’s words', () => {
    const input = inputsOf(richSnapshot())
    const signals = bySource(gatherSignals(input), 'ledger')
    expect(signals.map(s => s.id)).toEqual(['ledger:unknown:fork-9', 'ledger:reconcile:a', 'ledger:duplicates', 'ledger:without-usage'])
    const unknown = input.ledger.rows.find(r => r.agentId === 'fork-9')
    expect(signals[0]?.why).toBe(unknown?.attribution.basis)
    expect(signals[0]?.level).toBe('unresolved')
    expect(signals[0]?.evidence).toBe('UNRESOLVED')
    expect(signals[1]?.why).toBe(input.ledger.rows.find(r => r.agentId === 'a')?.reconciliation.note)
    expect(input.ledger.notes).toContain(signals[2]?.why)
    expect(input.ledger.notes).toContain(signals[3]?.why)
    expect(signals[3]?.agentIds).toEqual(['b'])
    for (const signal of signals) expect(signal.why.startsWith(signal.title)).toBe(true)
  })

  test('outcome: agents in changed-unverified, failed-or-inconclusive, mixed or unresolved, with their contribution basis', () => {
    const input = inputsOf(richSnapshot())
    const signals = bySource(gatherSignals(input), 'outcome')
    const flagged = input.spend.agents.filter(a => ['changed-unverified', 'failed-or-inconclusive', 'mixed', 'unresolved'].includes(a.bucket))
    expect(signals.map(s => s.id)).toEqual(flagged.map(a => `outcome:${a.agentId}`))
    for (const signal of signals) {
      const agent = input.spend.agents.find(a => `outcome:${a.agentId}` === signal.id)
      expect(signal.title.startsWith(String(agent?.bucket))).toBe(true)
      expect(agent?.contributions.some(c => c.basis === signal.why && c.evidence === signal.evidence)).toBe(true)
    }
    expect(signals.some(s => s.id === 'outcome:main')).toBe(false)
  })

  test('coverage gaps: counting started late, dropped events, agents without a spawn event', () => {
    const late = bySource(gatherSignals(inputsOf(richSnapshot())), 'coverage')
    expect(late.map(s => s.id)).toEqual(['coverage:since', 'coverage:dropped'])
    expect(late.every(s => s.level === 'unavailable' && s.evidence === 'UNAVAILABLE')).toBe(true)
    expect(late[1]?.title).toBe('3 older events dropped from the timeline to bound memory')
    const unseen = build(turnStart('ghost', 't-g'), ...tool('ghost', 'r9', 'Read', { file_path: '/repo/a.ts' }))
    const noSpawn = bySource(gatherSignals(inputsOf(unseen)), 'coverage')
    expect(noSpawn.map(s => s.id)).toEqual(['coverage:no-spawn'])
    expect(noSpawn[0]?.agentIds).toEqual(['ghost'])
  })

  test('ids are unique and stable, even when a source repeats an id', () => {
    const input = inputsOf(richSnapshot())
    const first = gatherSignals(input).map(s => s.id)
    expect(new Set(first).size).toBe(first.length)
    expect(gatherSignals(input).map(s => s.id)).toEqual(first)
    const twice = input.collisions.signals.slice(0, 1)
    const repeated = gatherSignals({ ...input, collisions: { ...input.collisions, signals: [...twice, ...twice] } })
    const ids = repeated.filter(s => s.source === 'collisions').map(s => s.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids[1]).toBe(`${ids[0]}#2`)
  })

  test('no signal without a source, and none named for a detector that does not exist', () => {
    const input = inputsOf(richSnapshot())
    const flagIds = new Set(input.trail.flags.map(f => `trail:${f.id}`))
    const collisionIds = new Set(input.collisions.signals.map(s => `col:${s.id}`))
    for (const signal of gatherSignals(input)) {
      if (signal.source === 'trail') expect(flagIds.has(signal.id)).toBe(true)
      if (signal.source === 'collisions') expect(collisionIds.has(signal.id)).toBe(true)
      expect(signal.id.split(':')[0]).toBe({ trail: 'trail', collisions: 'col', context: 'ctx', ledger: 'ledger', outcome: 'outcome', coverage: 'coverage' }[signal.source])
      expect(`${signal.title} ${signal.why}`).not.toMatch(/retry loop|duplicate investigation|near (the )?limit|score|health(y)?\b|critical/i)
      expect(signal.title).not.toMatch(/\b(wasted?|useless|lost|ignored|unused|inefficien\w*)\b/i)
    }
  })

  test('a lead stops at the first separator outside backticks and parentheses', () => {
    expect(leadOf('Unverified change — no check after the edit.')).toBe('Unverified change')
    expect(leadOf('The latest captured run of `a; b: c` failed; no later passing run was captured.')).toBe('The latest captured run of `a; b: c` failed')
    expect(leadOf('2 requests resolved with no usage (no response: none); counted apart')).toBe('2 requests resolved with no usage (no response: none)')
    expect(leadOf('no separator here')).toBe('no separator here')
  })
})
