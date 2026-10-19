// F3 spend vs outcome: classification over the contribution trail and the
// usage buckets. SIMULATED data only: snapshots come from the observation
// fixtures, ledger views are built by hand to the contract type.

import { describe, expect, test } from 'claude-code/testing'

import { applyUsage, buildLedgerView } from '../hooks/lib/ledger'
import { BUCKET_MEANING, buildSpendOutcome } from '../hooks/lib/outcome'
import { reduceAll } from '../hooks/lib/reduce'
import { addTokens, processedOf, ZERO_TOKENS } from '../hooks/lib/tokens'
import { buildTrail, UNLINKED_TEXT, UNVERIFIED_STALE_TEXT, type Trail } from '../hooks/lib/trail'
import type { ViewContext } from '../hooks/ui/common'
import { layoutFor } from '../hooks/ui/kit'
import { AgentLedgerDetail } from '../hooks/ui/ledger'
import { AgentOutcomeDetail, SpendOutcomePanel } from '../hooks/ui/outcome'
import type { CostEstimate, LedgerRow, LedgerTotals, LedgerView, Snapshot, SpendOutcome, TokenCounts, UsageRecord } from '../types'
import { build, spawn, threeAgentSession, tool, toolStart, turnEnd, turnStart } from './fixtures'
import { tokens, usageRecord } from './usage-fixtures'
import { NOOP_ACTIONS } from './view-helpers'

// ── hand-built ledger views (contract type, SIMULATED numbers) ──

function totals(t: TokenCounts, cost?: CostEstimate): LedgerTotals {
  const requests = processedOf(t) > 0 ? 1 : 0
  return { requests, requestsWithoutUsage: 0, tokens: t, processed: processedOf(t), ...(cost ? { cost } : {}) }
}

function row(agentId: string, t: TokenCounts, cost?: CostEstimate): LedgerRow {
  return {
    agentId,
    label: agentId,
    depth: agentId === 'main' ? 0 : 1,
    ...(agentId === 'main' ? {} : { parentId: 'main' }),
    models: ['claude-opus-5-5'],
    byModel: [
      {
        model: 'claude-opus-5-5',
        tally: { requests: totals(t).requests, tokens: t, largeRequests: 0, largeTokens: ZERO_TOKENS },
        ...(cost ? { cost } : {}),
      },
    ],
    direct: totals(t, cost),
    subtree: { ...totals(t, cost), agents: 1 },
    attribution:
      agentId === 'main'
        ? { evidence: 'OBSERVED', basis: 'turn.step carried no agentId, which the API defines as the main loop' }
        : { evidence: 'OBSERVED', basis: `turn.step carried agentId ${agentId}` },
    reconciliation: { turnsCompared: 0, mismatched: 0, reportedOnly: 0 },
  }
}

/** A ledger view whose session total is the sum of the rows' direct totals, unless `session` overrides it. */
function ledgerOf(rows: LedgerRow[], session?: TokenCounts): LedgerView {
  const sum = session ?? rows.reduce((acc, r) => addTokens(acc, r.direct.tokens), ZERO_TOKENS)
  return {
    rows,
    session: { requests: rows.length, requestsWithoutUsage: 0, tokens: sum, processed: processedOf(sum) },
    priceTable: { date: '2026-10-06', source: 'SIMULATED', assumptions: [], cacheWrites: 'SIMULATED' },
    notes: [],
  }
}

function usd(amount: number, complete = true): CostEstimate {
  return { usd: amount, measure: 'ESTIMATED', priceDate: '2026-10-06', unpricedModels: complete ? [] : ['mystery-model'], complete }
}

function spendOf(snapshot: Snapshot, rows: LedgerRow[] = [], session?: TokenCounts): { trail: Trail; outcome: SpendOutcome } {
  const trail = buildTrail(snapshot)
  return { trail, outcome: buildSpendOutcome(snapshot, trail, ledgerOf(rows, session)) }
}

/** The snapshot with F2's own ledger folded from these turn.step records (SIMULATED). */
function withUsage(snapshot: Snapshot, records: readonly UsageRecord[]): Snapshot {
  return { ...snapshot, ledger: records.reduce((ledger, record) => applyUsage(ledger, record), snapshot.ledger) }
}

/** Trail, F2's real ledger view and the outcome over them, as the pane builds them. */
function spendFromLedger(snapshot: Snapshot, showCost = true): { trail: Trail; view: LedgerView; outcome: SpendOutcome } {
  const trail = buildTrail(snapshot)
  const view = buildLedgerView(snapshot.ledger, snapshot, { showCost })
  return { trail, view, outcome: buildSpendOutcome(snapshot, trail, view) }
}

const agentOf = (outcome: SpendOutcome, id: string) => outcome.agents.find(a => a.agentId === id)
const bucketOf = (outcome: SpendOutcome, bucket: string) => outcome.buckets.find(b => b.bucket === bucket)
const bucketSum = (outcome: SpendOutcome) => outcome.buckets.reduce((n, b) => n + b.processed, 0)
const NEGATIVE_WORDS = /wasted|useless|lost/i

const editAlpha = (agent: string | undefined, id: string) =>
  tool(agent, id, 'Edit', { file_path: '/repo/src/alpha.ts', old_string: 'a', new_string: 'b' })

describe('spend vs outcome: changes', () => {
  test('a change with a linked passing check after the edit is verified, naming the file', () => {
    const { outcome } = spendOf(
      build(
        spawn('fixer', { prompt: 'Fix src/alpha.ts' }),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }, { text: '3 passed' }),
      ),
    )
    const change = agentOf(outcome, 'fixer')?.contributions.find(c => c.nodeIds.includes('n:fixer:change:/repo/src/alpha.ts'))
    expect(change?.category).toBe('verified')
    expect(change?.evidence).toBe('INFERRED')
    expect(change?.title).toContain('/repo/src/alpha.ts')
    expect(change?.basis).toContain('`npm test -- alpha` passed')
    expect(change?.basis).toContain('the command names the edited file')
    expect(change?.edgeIds).toEqual(['e:n:fixer:change:/repo/src/alpha.ts>n:fixer:verify:tool:b1'])
    expect(agentOf(outcome, 'fixer')?.bucket).toBe('verified')
  })

  test('a change edited again after the passing check is changed-unverified, citing that check and the stale flag', () => {
    const { outcome, trail } = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }),
        ...editAlpha('fixer', 'e2'),
      ),
    )
    const change = agentOf(outcome, 'fixer')?.contributions.find(c => c.nodeIds.includes('n:fixer:change:/repo/src/alpha.ts'))
    expect(change?.category).toBe('changed-unverified')
    expect(change?.evidence).toBe('UNRESOLVED')
    expect(change?.basis).toMatch(/edited again at #\d+ after the passing check at #\d+/i)
    expect(change?.edgeIds).toEqual(['e:n:fixer:change:/repo/src/alpha.ts>n:fixer:verify:tool:b1'])
    const stale = trail.flags.find(f => f.id === 'f:n:fixer:change:/repo/src/alpha.ts:unverified')
    expect(stale?.text).toBe(UNVERIFIED_STALE_TEXT)
    expect(change?.flagIds).toContain(stale?.id ?? 'missing')
  })

  test('a failing check followed by another edit is stale: changed-unverified, not failed', () => {
    const { outcome } = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }, { isError: true, text: 'Exit code 1' }),
        ...editAlpha('fixer', 'e2'),
      ),
    )
    const change = agentOf(outcome, 'fixer')?.contributions.find(c => c.title.includes('alpha.ts'))
    expect(change?.category).toBe('changed-unverified')
    expect(change?.evidence).toBe('UNRESOLVED')
    expect(change?.basis).toContain('before the last edit')
    expect(change?.basis).toContain('`npm test -- alpha` failed')
  })

  test('a change whose linked check failed after the last edit is failed-or-inconclusive, INFERRED, citing the still-failing flag', () => {
    const { outcome, trail } = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }, { isError: true, text: 'Exit code 1' }),
      ),
    )
    const fixer = agentOf(outcome, 'fixer')
    const change = fixer?.contributions.find(c => c.title.includes('alpha.ts'))
    expect(change?.category).toBe('failed-or-inconclusive')
    expect(change?.evidence).toBe('INFERRED')
    expect(change?.basis).toContain('`npm test -- alpha` failed')
    expect(change?.basis).toContain('the command names the edited file')
    const flag = trail.flags.find(f => f.kind === 'still-failing')
    expect(change?.flagIds).toContain(flag?.id ?? 'missing')
    expect(fixer?.bucket).toBe('failed-or-inconclusive')
  })

  test('a change whose check later failed, or later ran inconclusive, is failed-or-inconclusive, never verified', () => {
    const failedLater = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }),
        ...tool('fixer', 'b2', 'Bash', { command: 'npm test -- alpha' }, { isError: true, text: 'Exit code 1' }),
      ),
    ).outcome
    const failedChange = agentOf(failedLater, 'fixer')?.contributions.find(c => c.title.includes('alpha.ts'))
    expect(failedChange?.category).toBe('failed-or-inconclusive')
    expect(failedChange?.evidence).toBe('INFERRED')
    expect(failedChange?.basis).toContain('failed')

    const unclearLater = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }),
        ...tool('fixer', 'b2', 'Bash', { command: 'npm test -- alpha' }, { result: { backgroundTaskId: 'bg1' } }),
      ),
    )
    const unclearChange = agentOf(unclearLater.outcome, 'fixer')?.contributions.find(c => c.title.includes('alpha.ts'))
    expect(unclearChange?.category).toBe('failed-or-inconclusive')
    expect(unclearChange?.evidence).toBe('INFERRED')
    expect(unclearChange?.basis).toContain('inconclusive')
    const inconclusiveFlag = unclearLater.trail.flags.find(f => f.kind === 'inconclusive')
    expect(unclearChange?.flagIds).toContain(inconclusiveFlag?.id ?? 'missing')
  })

  test('a passing and a failing linked check after the last edit conflict: failed-or-inconclusive, naming both', () => {
    const { outcome, trail } = spendOf(
      build(
        spawn('fixer'),
        ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' }),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- a' }),
        ...tool('fixer', 'b2', 'Bash', { command: 'npm run lint' }, { isError: true, text: 'Exit code 1' }),
      ),
    )
    const change = agentOf(outcome, 'fixer')?.contributions.find(c => c.nodeIds.includes('n:fixer:change:/repo/src/a.ts'))
    expect(change?.category).toBe('failed-or-inconclusive')
    expect(change?.evidence).toBe('INFERRED')
    expect(change?.basis).toContain('`npm test -- a` passed')
    expect(change?.basis).toContain('`npm run lint` failed')
    expect(change?.edgeIds?.length).toBe(2)
    const lintFlag = trail.flags.find(f => f.kind === 'still-failing' && f.command === 'npm run lint')
    expect(change?.flagIds).toContain(lintFlag?.id ?? 'missing')
  })

  test('edit, failing check, edit, passing rerun: the change is verified and the check is one contribution', () => {
    const { outcome } = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }, { isError: true, text: 'Exit code 1' }),
        ...editAlpha('fixer', 'e2'),
        ...tool('fixer', 'b2', 'Bash', { command: 'npm test -- alpha' }),
      ),
    )
    const fixer = agentOf(outcome, 'fixer')
    expect(fixer?.contributions.find(c => c.title.includes('alpha.ts'))?.category).toBe('verified')
    const checks = fixer?.contributions.filter(c => c.nodeIds.some(id => id.includes(':verify:'))) ?? []
    expect(checks).toHaveLength(1)
    expect(checks[0]?.nodeIds).toHaveLength(2)
    expect(checks[0]?.category).toBe('verified')
    expect(checks[0]?.basis).toContain('failed, then passed')
    expect(fixer?.bucket).toBe('verified')
  })

  test('a newer run of the passing command that is still running keeps verified and says so', () => {
    const { outcome } = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }),
        toolStart('fixer', 'b2', 'Bash', { command: 'npm test -- alpha' }),
      ),
    )
    const change = agentOf(outcome, 'fixer')?.contributions.find(c => c.title.includes('alpha.ts'))
    expect(change?.category).toBe('verified')
    expect(change?.basis).toContain('still running')
  })

  test('inconclusive and failed checks never count as passed', () => {
    const { outcome } = spendOf(
      build(
        spawn('piped'),
        ...editAlpha('piped', 'e1'),
        ...tool('piped', 'b1', 'Bash', { command: 'npm test | tail -5' }, { text: '3 passed' }),
        spawn('red'),
        ...tool('red', 'b2', 'Bash', { command: 'pytest -q' }, { isError: true, text: 'Exit code 1' }),
      ),
    )
    const piped = agentOf(outcome, 'piped')
    expect(piped?.contributions.map(c => c.category)).toEqual(['failed-or-inconclusive'])
    const red = agentOf(outcome, 'red')
    expect(red?.contributions.map(c => [c.category, c.evidence])).toEqual([['failed-or-inconclusive', 'OBSERVED']])
    expect(red?.contributions[0]?.basis).toContain('exit code 1')
    expect(outcome.agents.flatMap(a => a.contributions).filter(c => c.category === 'verified')).toEqual([])
  })

  test("a change followed only by the same agent's inconclusive run is failed-or-inconclusive, INFERRED, with the run folded in", () => {
    const snapshot = build(spawn('piped'), ...editAlpha('piped', 'e1'), ...tool('piped', 'b1', 'Bash', { command: 'npm test | tail -5' }, { text: '3 passed' }))
    const { outcome, trail } = spendOf(snapshot)
    const piped = agentOf(outcome, 'piped')
    expect(piped?.contributions).toHaveLength(1)
    const change = piped?.contributions[0]
    expect(change?.category).toBe('failed-or-inconclusive')
    expect(change?.evidence).toBe('INFERRED')
    expect(change?.basis).toContain('`npm test | tail -5`')
    const verdictBasis = snapshot.events.find(e => e.id === 'tool:b1')?.outcome?.verdictBasis ?? 'missing'
    expect(change?.basis).toContain(verdictBasis)
    expect(change?.basis).toMatch(/only the same agent/i)
    expect(change?.nodeIds).toContain('n:piped:verify:tool:b1')
    expect(change?.eventIds).toContain('tool:b1')
    const flag = trail.flags.find(f => f.kind === 'inconclusive')
    expect(change?.flagIds).toContain(flag?.id ?? 'missing')
    expect(piped?.bucket).toBe('failed-or-inconclusive')
  })

  test('an inconclusive run before the last edit, or by another agent, is not folded into the change', () => {
    const before = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test | tail -5' }, { text: '3 passed' }),
        ...editAlpha('fixer', 'e2'),
      ),
    ).outcome
    expect(agentOf(before, 'fixer')?.contributions.find(c => c.title.includes('alpha.ts'))?.category).toBe('changed-unverified')
    const other = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        spawn('tester'),
        ...tool('tester', 'b1', 'Bash', { command: 'npm test -- alpha | tail -5' }, { text: '3 passed' }),
      ),
    ).outcome
    expect(agentOf(other, 'fixer')?.contributions[0]?.category).toBe('changed-unverified')
    expect(agentOf(other, 'tester')?.contributions[0]?.category).toBe('failed-or-inconclusive')
  })

  test('a decided linked check covering the final version takes precedence over an inconclusive run', () => {
    const { outcome } = spendOf(
      build(
        spawn('fixer'),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }),
        ...tool('fixer', 'b2', 'Bash', { command: 'npm run lint | tail -5' }, { text: 'ok' }),
      ),
    )
    expect(agentOf(outcome, 'fixer')?.contributions.find(c => c.title.includes('alpha.ts'))?.category).toBe('verified')
  })

  // Shape from the live run live-test/runs/20261017T155333Z (SIMULATED here): B's own piped check is
  // inconclusive, F's later whole-suite run passes and the trail links it to B's change.
  test("an agent's own inconclusive check is folded into its change that a later passing whole-suite run verifies", () => {
    const base = build(
      spawn('B', { prompt: 'Fix the date format in src/format.js' }),
      ...tool('B', 'e1', 'Edit', { file_path: '/repo/src/format.js', old_string: 'a', new_string: 'b' }),
      ...tool('B', 'b1', 'Bash', { command: 'node --test test/format.test.js 2>&1 | tail -20' }, { text: '# pass 4' }),
      spawn('F'),
      ...tool('F', 'b2', 'Bash', { command: 'npm test 2>&1' }, { text: '12 passed' }),
    )
    const snapshot = reduceAll({ ...base, cwd: '/repo' }, [{ kind: 'root', dir: '/repo/src', root: '/repo', commonDir: '/repo/.git' }])
    const { outcome } = spendOf(snapshot, [row('B', tokens(10, 1900, 0, 90)), row('F', tokens(5, 400, 0, 20))])
    const b = agentOf(outcome, 'B')
    expect(b?.contributions).toHaveLength(1)
    const change = b?.contributions[0]
    expect(change?.category).toBe('verified')
    expect(change?.evidence).toBe('INFERRED')
    expect(change?.basis).toContain('`node --test test/format.test.js 2>&1 | tail -20`')
    expect(change?.basis).toContain('`npm test 2>&1`')
    expect(change?.basis).toContain('inconclusive')
    expect(change?.nodeIds).toContain('n:B:verify:tool:b1')
    expect(change?.eventIds).toContain('tool:b1')
    expect(b?.bucket).toBe('verified')
    expect(bucketOf(outcome, 'verified')?.agents).toContain('B')
    expect(bucketOf(outcome, 'mixed')).toBeUndefined()
  })

  test('a failing own run after the last edit still wins over a passing whole-suite run', () => {
    const base = build(
      spawn('B'),
      ...tool('B', 'e1', 'Edit', { file_path: '/repo/src/format.js', old_string: 'a', new_string: 'b' }),
      ...tool('B', 'b1', 'Bash', { command: 'node --test test/format.test.js' }, { isError: true, text: 'Exit code 1' }),
      spawn('F'),
      ...tool('F', 'b2', 'Bash', { command: 'npm test 2>&1' }, { text: '12 passed' }),
    )
    const snapshot = reduceAll({ ...base, cwd: '/repo' }, [{ kind: 'root', dir: '/repo/src', root: '/repo', commonDir: '/repo/.git' }])
    const { outcome } = spendOf(snapshot)
    expect(agentOf(outcome, 'B')?.contributions.find(c => c.title.includes('format.js'))?.category).toBe('failed-or-inconclusive')
  })

  test('a red run of the same command before the edit does not make the agent mixed', () => {
    const { outcome } = spendOf(
      build(
        spawn('fixer'),
        ...tool('fixer', 'b0', 'Bash', { command: 'npm test -- alpha' }, { isError: true, text: 'Exit code 1' }),
        ...editAlpha('fixer', 'e1'),
        ...tool('fixer', 'b1', 'Bash', { command: 'npm test -- alpha' }),
      ),
    )
    const fixer = agentOf(outcome, 'fixer')
    expect(fixer?.contributions.map(c => c.category)).toEqual(['verified', 'verified'])
    expect(fixer?.bucket).toBe('verified')
  })
})

describe('spend vs outcome: checks', () => {
  test('a passing check linked to no change is not verified', () => {
    const { outcome } = spendOf(build(spawn('tester'), ...tool('tester', 'b1', 'Bash', { command: 'npm test' })))
    const check = agentOf(outcome, 'tester')?.contributions[0]
    expect(check?.category).toBe('unresolved')
    expect(check?.evidence).toBe('UNRESOLVED')
    expect(check?.basis).toContain('linked to no captured change')
    expect(check?.eventIds).toEqual(['tool:b1'])
    expect(outcome.agents.flatMap(a => a.contributions).some(c => c.category === 'verified')).toBe(false)
  })

  test("a verifier's passing check takes the INFERRED evidence of the edge that ties it to a change", () => {
    const { outcome } = spendOf(build(...threeAgentSession()))
    const check = agentOf(outcome, 'tester')?.contributions[0]
    expect(check?.category).toBe('verified')
    expect(check?.evidence).toBe('INFERRED')
    expect(check?.edgeIds).toContain('e:n:implementer:change:/repo/src/auth/token.ts>n:tester:verify:tool:b1')
    expect(check?.basis).toContain('the command names the edited file')
  })

  test('a passing check that ran before the change was edited again verifies nothing', () => {
    const { outcome } = spendOf(
      build(
        spawn('impl'),
        ...editAlpha('impl', 'e1'),
        spawn('tester'),
        ...tool('tester', 'b1', 'Bash', { command: 'npm test -- alpha' }),
        ...editAlpha('impl', 'e2'),
      ),
    )
    const check = agentOf(outcome, 'tester')?.contributions[0]
    expect(check?.category).toBe('unresolved')
    expect(check?.basis).toContain('before the last edit')
    expect(agentOf(outcome, 'impl')?.contributions[0]?.category).toBe('changed-unverified')
  })

  test("a verifier's failing check linked to a change is failed-or-inconclusive with its verdict basis", () => {
    const { outcome } = spendOf(
      build(
        spawn('impl'),
        ...editAlpha('impl', 'e1'),
        spawn('tester'),
        ...tool('tester', 'b1', 'Bash', { command: 'npm test -- alpha' }, { isError: true, text: 'Exit code 1' }),
      ),
    )
    const check = agentOf(outcome, 'tester')?.contributions[0]
    expect(check?.category).toBe('failed-or-inconclusive')
    expect(check?.evidence).toBe('OBSERVED')
    expect(check?.basis).toContain('exit code 1')
    expect(agentOf(outcome, 'impl')?.bucket).toBe('failed-or-inconclusive')
  })
})

describe('spend vs outcome: reports and agents without evidence', () => {
  test('an unlinked report is report-only with the exact unlinked text, never called wasted', () => {
    const { outcome } = spendOf(
      build(
        spawn('scout', { description: 'audit logging' }),
        turnEnd('scout', 't1', 'The logger in src/log/sink.ts drops lines under load.'),
        spawn('fixer', { prompt: 'Rename the button label in ui/button.tsx' }),
        ...tool('fixer', 'e1', 'Edit', { file_path: '/repo/ui/button.tsx', old_string: 'Ok', new_string: 'OK' }),
      ),
      [row('scout', tokens(10, 500, 0, 40))],
    )
    const scout = agentOf(outcome, 'scout')
    expect(scout?.bucket).toBe('report-only')
    expect(scout?.contributions[0]?.evidence).toBe('UNRESOLVED')
    expect(scout?.contributions[0]?.basis).toBe(UNLINKED_TEXT)
    expect(scout?.contributions[0]?.eventIds).toEqual(['turn:t1:end'])
    expect(JSON.stringify(outcome)).not.toMatch(NEGATIVE_WORDS)
  })

  test('a report linked to later work carries that edge, and a worker\'s own hand-back is not a contribution', () => {
    const { outcome } = spendOf(build(...threeAgentSession()))
    const explorer = agentOf(outcome, 'explorer')?.contributions[0]
    expect(explorer?.category).toBe('report-only')
    expect(explorer?.evidence).toBe('LINKED')
    expect(explorer?.basis.startsWith('report linked to later work: ')).toBe(true)
    expect(explorer?.edgeIds).toContain('e:n:explorer:finding>n:implementer:delegation')
    const implementer = agentOf(outcome, 'implementer')
    expect(implementer?.bucket).toBe('verified')
    expect(implementer?.contributions.some(c => c.category === 'report-only')).toBe(false)
    expect(agentOf(outcome, 'tester')?.bucket).toBe('verified')
  })

  test('a linked report from an agent that changed files is listed as also reported back, never a contribution, never mixed', () => {
    const finding = 'the alpha parser drops the trailing newline when the input ends with a comment block, so every later line shifts by one'
    const snapshot = build(
      spawn('worker', { prompt: 'Fix src/alpha.ts' }),
      ...editAlpha('worker', 'e1'),
      ...tool('worker', 'b1', 'Bash', { command: 'npm test -- alpha' }),
      turnEnd('worker', 't1', `Fixed it. Also: ${finding}.`),
      spawn('next', { prompt: `Follow up on this: ${finding}.` }),
    )
    const { outcome, trail } = spendOf(snapshot)
    const link = trail.edges.find(e => e.from === 'n:worker:finding' && e.to === 'n:next:delegation')
    expect(link?.evidence).toBe('LINKED')
    const worker = agentOf(outcome, 'worker')
    expect(worker?.bucket).toBe('verified')
    expect(worker?.contributions.some(c => c.category === 'report-only' || c.nodeIds.includes('n:worker:finding'))).toBe(false)
    const { text } = draw(AgentOutcomeDetail(stubContext(snapshot, 40).ctx, worker, trail))
    expect(text).toContain('also reported back')
    expect(text).toContain(link?.basis.slice(0, 40) ?? 'missing')
  })

  test('an agent without a change, check or report is unresolved, with the reason', () => {
    const { outcome } = spendOf(build(spawn('busy'), turnStart('busy', 't1'), spawn('quiet'), turnEnd('quiet', 't2', '')))
    const busy = agentOf(outcome, 'busy')
    expect(busy?.bucket).toBe('unresolved')
    expect(busy?.contributions[0]?.evidence).toBe('UNRESOLVED')
    expect(busy?.contributions[0]?.basis).toContain('still active')
    const quiet = agentOf(outcome, 'quiet')
    expect(quiet?.contributions[0]?.category).toBe('unresolved')
    expect(quiet?.contributions[0]?.evidence).toBe('UNAVAILABLE')
    expect(quiet?.contributions[0]?.basis).toContain('without a captured report')
    expect(quiet?.contributions[0]?.flagIds).toContain('f:quiet:no-report')
  })

  test('the main loop is the coordinator, and its own changes are still listed', () => {
    const { outcome } = spendOf(build(...editAlpha(undefined, 'm1')), [row('main', tokens(100, 9000, 300, 200))])
    const main = agentOf(outcome, 'main')
    expect(main?.bucket).toBe('coordinator')
    expect(main?.contributions.map(c => c.category)).toEqual(['changed-unverified'])
    expect(bucketOf(outcome, 'coordinator')?.agents).toEqual(['main'])
  })

  test('every contribution carries evidence, a basis and references', () => {
    const { outcome } = spendOf(build(...threeAgentSession()))
    const all = outcome.agents.flatMap(a => a.contributions)
    expect(all.length).toBeGreaterThan(0)
    for (const c of all) {
      expect(c.basis.length).toBeGreaterThan(0)
      expect(c.nodeIds.length + c.eventIds.length).toBeGreaterThan(0)
    }
  })
})

describe('spend vs outcome: buckets', () => {
  const mixedSession = () =>
    build(
      spawn('fixer'),
      ...editAlpha('fixer', 'e1'),
      ...tool('fixer', 'b1', 'Bash', { command: 'npm test' }),
      ...tool('fixer', 'e2', 'Edit', { file_path: '/repo/src/beta.ts', old_string: 'a', new_string: 'b' }),
      spawn('idle'),
    )

  test('an agent with contributions in different categories is mixed, and its usage is not split', () => {
    const fixerRow = row('fixer', tokens(30, 4000, 500, 120))
    const { outcome } = spendOf(mixedSession(), [row('main', tokens(5, 100, 0, 5)), fixerRow])
    const fixer = agentOf(outcome, 'fixer')
    expect(fixer?.contributions.map(c => c.category).sort()).toEqual(['changed-unverified', 'verified', 'verified'])
    expect(fixer?.bucket).toBe('mixed')
    expect(fixer?.usage).toEqual(fixerRow.direct)
    expect(outcome.buckets.filter(b => b.agents.includes('fixer')).map(b => b.bucket)).toEqual(['mixed'])
    expect(bucketOf(outcome, 'mixed')?.processed).toBe(fixerRow.direct.processed)
    expect(outcome.notes.some(n => n.includes('mixed'))).toBe(true)
  })

  test('agents with no recorded usage land in no-usage-recorded; every bucket sum equals the denominator', () => {
    const { outcome } = spendOf(mixedSession(), [row('main', tokens(5, 100, 0, 5)), row('fixer', tokens(30, 4000, 500, 120)), row('idle', ZERO_TOKENS)])
    expect(bucketOf(outcome, 'no-usage-recorded')?.agents).toEqual(['idle'])
    expect(bucketOf(outcome, 'no-usage-recorded')?.processed).toBe(0)
    expect(outcome.denominator).toBe(5 + 100 + 5 + 30 + 4000 + 500 + 120)
    expect(bucketSum(outcome)).toBe(outcome.denominator)
    expect(outcome.denominatorBasis).toContain('cache read')
    expect(outcome.denominatorBasis).toContain('not of cost')
    const mixed = bucketOf(outcome, 'mixed')
    expect(mixed?.percent).toBe(((30 + 4000 + 500 + 120) / outcome.denominator) * 100)
    for (const bucket of outcome.buckets) expect(bucket.meaning.length).toBeGreaterThan(0)
  })

  test('an agent with no ledger row at all has zero usage and no-usage-recorded', () => {
    const { outcome } = spendOf(mixedSession(), [row('fixer', tokens(1, 2, 3, 4))])
    expect(agentOf(outcome, 'idle')?.usage.processed).toBe(0)
    expect(bucketOf(outcome, 'no-usage-recorded')?.agents).toEqual(['main', 'idle'])
  })

  test('a ledger row whose agent was never seen is its own unresolved outcome', () => {
    const { outcome } = spendOf(mixedSession(), [row('fixer', tokens(1, 2, 3, 4)), row('fork-7', tokens(10, 20, 0, 5))])
    const fork = agentOf(outcome, 'fork-7')
    expect(fork?.bucket).toBe('unresolved')
    expect(fork?.contributions[0]?.evidence).toBe('UNAVAILABLE')
    expect(fork?.contributions[0]?.basis).toContain('usage from a loop never seen as an agent')
    expect(bucketOf(outcome, 'unresolved')?.agents).toEqual(['fork-7'])
    expect(bucketOf(outcome, 'unresolved')?.processed).toBe(35)
    expect(bucketSum(outcome)).toBe(outcome.denominator)
    expect(outcome.notes.some(n => n.includes('fork-7'))).toBe(true)
  })

  test('ledger rows whose ids name Object.prototype members are their own unresolved outcomes (AT-24)', () => {
    for (const id of ['constructor', '__proto__', 'toString']) {
      const snapshot = withUsage(build(spawn('a')), [
        usageRecord({ agentId: 'main', turnId: 'm', tokens: tokens(10, 0, 0, 0) }),
        usageRecord({ agentId: 'a', turnId: 'a', tokens: tokens(20, 0, 0, 0) }),
        usageRecord({ agentId: id, turnId: 'x', tokens: tokens(70, 0, 0, 0) }),
      ])
      const { outcome } = spendFromLedger(snapshot, false)
      expect(outcome.denominator).toBe(100)
      expect(bucketSum(outcome)).toBe(100)
      expect(agentOf(outcome, id)?.bucket).toBe('unresolved')
      expect(outcome.notes.some(n => n.includes(id))).toBe(true)
    }
  })

  test('session usage in no row goes to unresolved with no agent; rows above the total only get a note', () => {
    const rows = [row('fixer', tokens(10, 0, 0, 0))]
    const above = spendOf(mixedSession(), rows, tokens(25, 0, 0, 0)).outcome
    expect(bucketOf(above, 'unresolved')).toMatchObject({ agents: [], processed: 15 })
    expect(bucketSum(above)).toBe(25)
    expect(above.notes.some(n => n.includes('15'))).toBe(true)
    const below = spendOf(mixedSession(), rows, tokens(4, 0, 0, 0)).outcome
    expect(below.notes.some(n => n.includes('6 more'))).toBe(true)
  })

  test('with a zero denominator every percent is undefined', () => {
    const { outcome } = spendOf(mixedSession())
    expect(outcome.denominator).toBe(0)
    expect(outcome.buckets.length).toBeGreaterThan(0)
    expect(outcome.buckets.every(b => b.percent === undefined)).toBe(true)
    expect(bucketSum(outcome)).toBe(0)
  })

  test('bucket cost is the sum of the rows\' direct estimates, absent when none is present', () => {
    const snapshot = build(spawn('a'), ...editAlpha('a', 'e1'), spawn('b'), ...tool('b', 'e2', 'Edit', { file_path: '/repo/src/beta.ts', old_string: 'x', new_string: 'y' }))
    const priced = spendOf(snapshot, [row('a', tokens(1, 0, 0, 0), usd(0.25)), row('b', tokens(1, 0, 0, 0), usd(0.5, false))]).outcome
    const cost = bucketOf(priced, 'changed-unverified')?.cost
    expect(cost?.usd).toBe(0.75)
    expect(cost?.complete).toBe(false)
    expect(cost?.measure).toBe('ESTIMATED')
    const unpriced = spendOf(snapshot, [row('a', tokens(1, 0, 0, 0)), row('b', tokens(1, 0, 0, 0))]).outcome
    expect(bucketOf(unpriced, 'changed-unverified')?.cost).toBe(undefined)
  })

  test('a bucket cost is partial when some of its tokens carry no estimate', () => {
    const snapshot = build(spawn('a'), ...editAlpha('a', 'e1'), spawn('b'), ...tool('b', 'e2', 'Edit', { file_path: '/repo/src/beta.ts', old_string: 'x', new_string: 'y' }))
    const oneUnpriced = spendOf(snapshot, [row('a', tokens(1, 0, 0, 0), usd(0.25)), row('b', tokens(1, 0, 0, 0))]).outcome
    expect(bucketOf(oneUnpriced, 'changed-unverified')?.cost).toMatchObject({ usd: 0.25, complete: false })
    const gap = spendOf(snapshot, [row('fork-1', tokens(5, 0, 0, 0), usd(0.2))], tokens(20, 0, 0, 0)).outcome
    expect(bucketOf(gap, 'unresolved')?.cost).toMatchObject({ usd: 0.2, complete: false })
  })

  test('usage comes from the row\'s direct totals, never its subtree', () => {
    const snapshot = build(spawn('lead'), ...editAlpha('lead', 'e1'), spawn('child', { parent: 'lead' }), turnEnd('child', 't1', 'Nothing to change.'))
    const lead = { ...row('lead', tokens(10, 0, 0, 0)), subtree: { ...totals(tokens(110, 0, 0, 0)), agents: 2 } }
    const { outcome } = spendOf(snapshot, [lead, row('child', tokens(100, 0, 0, 0))])
    expect(agentOf(outcome, 'lead')?.usage.processed).toBe(10)
    expect(bucketOf(outcome, 'changed-unverified')?.processed).toBe(10)
    expect(bucketSum(outcome)).toBe(110)
  })

  test('an agent record missing from agentOrder still has its usage in a bucket', () => {
    const base = build(spawn('fixer'), ...editAlpha('fixer', 'e1'))
    const snapshot = { ...base, agentOrder: base.agentOrder.filter(id => id !== 'fixer') }
    const { outcome } = spendOf(snapshot, [row('main', tokens(1, 0, 0, 0)), row('fixer', tokens(5, 0, 0, 0))])
    expect(agentOf(outcome, 'fixer')?.usage.processed).toBe(5)
    expect(bucketSum(outcome)).toBe(outcome.denominator)
  })

  test("bucket totals equal F2's session total for a ledger built from turn.step records", () => {
    const base = build(...threeAgentSession(), spawn('idle'))
    const snapshot = withUsage(base, [
      usageRecord({ agentId: 'main', index: 0 }),
      usageRecord({ agentId: 'main', index: 1, tokens: tokens(4, 3000, 0, 80) }),
      usageRecord({ agentId: 'explorer', turnId: 't-explorer' }),
      usageRecord({ agentId: 'implementer', turnId: 't-impl', tokens: tokens(3, 400, 20, 9) }),
      usageRecord({ agentId: 'tester', turnId: 't-test', tokens: null }),
      usageRecord({ agentId: 'fork-9', turnId: 't-fork', tokens: tokens(7, 70, 7, 7), model: 'mystery-model' }),
    ])
    for (const showCost of [true, false]) {
      const { view, outcome } = spendFromLedger(snapshot, showCost)
      expect(outcome.denominator).toBe(view.session.processed)
      expect(bucketSum(outcome)).toBe(view.session.processed)
      for (const r of view.rows) expect(agentOf(outcome, r.agentId)?.usage).toEqual(r.direct)
      const noUsage = bucketOf(outcome, 'no-usage-recorded')?.agents ?? []
      expect(noUsage.includes('tester') && noUsage.includes('idle')).toBe(true)
      expect(agentOf(outcome, 'fork-9')?.bucket).toBe('unresolved')
      const costed = outcome.buckets.reduce((n, b) => n + (b.cost?.usd ?? 0), 0)
      if (showCost) expect(Math.abs(costed - (view.session.cost?.usd ?? -1))).toBeLessThan(1e-9)
      else expect(outcome.buckets.every(b => b.cost === undefined)).toBe(true)
    }
  })

  test('bucket meanings say what each category means and never judge the work', () => {
    expect(BUCKET_MEANING['report-only']).toContain('not evidence')
    expect(BUCKET_MEANING['no-usage-recorded']).toContain('unknown, not zero')
    expect(BUCKET_MEANING.verified.match(/INFERRED/g) ?? []).toHaveLength(1)
    expect(BUCKET_MEANING['failed-or-inconclusive']).toContain('inconclusive')
    for (const meaning of Object.values(BUCKET_MEANING)) expect(meaning).not.toMatch(NEGATIVE_WORDS)
  })
})

// ── the panel, drawn with plain-data stand-ins for the surface's elements ──

type Drawn = { type?: string; key?: unknown; props?: Record<string, unknown> }

function stubContext(snapshot: Snapshot, width: number, selected?: string, focus?: string) {
  const calls = { select: [] as Array<string | undefined>, open: [] as string[], focus: [] as string[] }
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  const ctx: ViewContext = {
    els: { Box: element('Box'), Text: element('Text'), Button: element('Button') } as unknown as ViewContext['els'],
    surface: 'terminal',
    width,
    rows: 40,
    now: 0,
    snapshot,
    ui: { view: 'spend', filter: 'all', page: 0, ...(selected ? { selected } : {}), ...(focus ? { focus } : {}) },
    layout: layoutFor(width),
    act: {
      ...NOOP_ACTIONS,
      select: id => calls.select.push(id),
      openEvent: id => calls.open.push(id),
      toggleFocus: id => calls.focus.push(id),
    },
  }
  return { ctx, calls }
}

function collect(node: unknown, texts: string[], buttons: Drawn[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    texts.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, texts, buttons)
    return
  }
  if (typeof node !== 'object') return
  const drawn = node as Drawn & { children?: unknown }
  if (drawn.type === 'Button') {
    buttons.push(drawn)
    if (typeof drawn.props?.label === 'string') texts.push(drawn.props.label)
  }
  collect(drawn.children, texts, buttons)
  collect(drawn.props?.children, texts, buttons)
}

function draw(tree: unknown): { text: string; buttons: Drawn[] } {
  const texts: string[] = []
  const buttons: Drawn[] = []
  collect(tree, texts, buttons)
  return { text: texts.join(''), buttons }
}

const keyOf = (button: Drawn) => button.props?.key ?? button.key
const press = (button: Drawn | undefined) => (button?.props?.onPress as (() => void) | undefined)?.()

// UI section, revised for the visual redesign (DESIGN-CONTRACT §8.6): one selectable row per bucket (`bk:`), whose agents
// focus pane-wide (`ui.focus`); the outcome detail lists contributions with their evidence; the usage record (attribution
// and requests) is drawn once, by the ledger detail.
describe('spend vs outcome: panel', () => {
  const session = () => build(...threeAgentSession())
  const rows = () => [row('main', tokens(10, 2000, 100, 50)), row('explorer', tokens(5, 800, 0, 30)), row('implementer', tokens(5, 900, 0, 40), usd(0.01))]

  test('draws the denominator, the buckets and one selectable row per bucket at narrow and wide widths', () => {
    const snapshot = session()
    const { trail, outcome } = spendOf(snapshot, rows())
    for (const width of [30, 60]) {
      const { ctx, calls } = stubContext(snapshot, width)
      const { text, buttons } = draw(SpendOutcomePanel(ctx, outcome, trail, true))
      expect(text).toContain('tokens processed')
      expect(text).toContain('report only')
      expect(text).toContain('≈$0.01')
      expect(text).not.toMatch(NEGATIVE_WORDS)
      const bucketButtons = buttons.filter(b => String(keyOf(b)).startsWith('bk-'))
      expect(bucketButtons.map(keyOf)).toEqual(outcome.buckets.map(b => `bk-${b.bucket}`))
      press(bucketButtons[1])
      expect(calls.select).toEqual([`bk:${outcome.buckets[1]?.bucket}`])
    }
  })

  test('hides ≈$ when cost display is off', () => {
    const snapshot = session()
    const { trail, outcome } = spendOf(snapshot, rows())
    const { ctx } = stubContext(snapshot, 60)
    expect(draw(SpendOutcomePanel(ctx, outcome, trail, false)).text).not.toContain('≈$')
  })

  test('a selected bucket lists its agents (each focuses it); the agent shows its evidence and opens source events', () => {
    const snapshot = session()
    const { trail, outcome } = spendOf(snapshot, rows())
    const { ctx, calls } = stubContext(snapshot, 40, 'bk:verified')
    const listed = draw(SpendOutcomePanel(ctx, outcome, trail, false))
    press(listed.buttons.find(b => keyOf(b) === 'so-implementer'))
    expect(calls.focus).toEqual(['implementer'])
    press(listed.buttons.find(b => keyOf(b) === 'bk-verified'))
    expect(calls.select).toEqual([undefined])
    const { text, buttons } = draw(AgentOutcomeDetail(ctx, agentOf(outcome, 'implementer'), trail))
    expect(text).toContain('verified')
    expect(text).toContain('also reported back')
    const source = buttons.find(b => /^od-c:.*-ev-tool:e1$/.test(String(keyOf(b))))
    expect(String(source?.props?.label)).toMatch(/^#\d+$/)
    press(source)
    expect(calls.open).toEqual(['tool:e1'])
  })

  test('a source event no longer in the timeline is shown as dropped', () => {
    const snapshot = session()
    const { trail, outcome } = spendOf(snapshot, rows())
    const pruned = { ...snapshot, events: snapshot.events.filter(e => e.id !== 'tool:e1') }
    const { ctx } = stubContext(pruned, 40)
    const { text } = draw(AgentOutcomeDetail(ctx, agentOf(outcome, 'implementer'), trail))
    expect(text).toContain('(dropped)')
    expect(draw(AgentOutcomeDetail(ctx, undefined, trail)).text.length).toBeGreaterThan(0)
  })

  const usedSession = () =>
    withUsage(session(), [
      usageRecord({ agentId: 'main', index: 0 }),
      usageRecord({ agentId: 'implementer', turnId: 't-impl', index: 0, tokens: tokens(5, 900, 0, 40) }),
      usageRecord({ agentId: 'implementer', turnId: 't-impl', index: 1, tokens: tokens(6, 950, 10, 70), stopReason: 'end_turn' }),
    ])

  test('the usage record (attribution rule and recorded requests) is drawn once, by the ledger detail', () => {
    const snapshot = usedSession()
    const { trail, view, outcome } = spendFromLedger(snapshot, false)
    const ledgerText = (id: string) => draw(AgentLedgerDetail(stubContext(snapshot, 40).ctx, view.rows.find(r => r.agentId === id), false)).text
    const implementer = ledgerText('implementer')
    expect(implementer).toContain('turn.step carried agentId implementer')
    expect(implementer).toContain('t-impl:1')
    expect(implementer).toContain('end_turn')
    expect(ledgerText('main')).toContain('turn.step carried no agentId, which the API defines as the main loop')
    expect(ledgerText('tester')).toContain('no turn.step heard for this agent')
    const detail = draw(AgentOutcomeDetail(stubContext(snapshot, 40).ctx, agentOf(outcome, 'implementer'), trail)).text
    expect(detail).not.toContain('turn.step carried')
    expect(detail).not.toContain('t-impl:1')
  })

  test('the outcome detail shows the verification record behind its classification, with a button to open it', () => {
    const snapshot = usedSession()
    const { trail, outcome } = spendFromLedger(snapshot, false)
    const { ctx, calls } = stubContext(snapshot, 40)
    const { text, buttons } = draw(AgentOutcomeDetail(ctx, agentOf(outcome, 'implementer'), trail))
    expect(text).toContain('verdict: passed')
    expect(text).toContain('npm test -- token')
    expect(text).toContain('12 passed')
    for (const button of buttons.filter(b => String(keyOf(b)).startsWith('od-vr-'))) press(button)
    expect(calls.open).toEqual(['tool:b1'])
  })

  test('the no-usage-recorded bucket reads as unknown usage, not as an observed zero', () => {
    const snapshot = build(spawn('idle'), spawn('quiet'))
    const { trail, outcome } = spendOf(snapshot, [row('main', tokens(10, 0, 0, 0))])
    const { text } = draw(SpendOutcomePanel(stubContext(snapshot, 30).ctx, outcome, trail, true))
    expect(text).toContain('no usage recorded')
    expect(text).toContain('unknown')
    expect(text).not.toMatch(/\b0\.0%/)
  })

  test('no drawn text, for any focused agent or selected bucket, judges the work', () => {
    const snapshot = withUsage(
      build(
        spawn('scout', { description: 'audit logging' }),
        turnEnd('scout', 't1', 'The logger in src/log/sink.ts drops lines under load.'),
        ...threeAgentSession(),
        spawn('idle'),
      ),
      [usageRecord({ agentId: 'scout', turnId: 't1' }), usageRecord({ agentId: 'fork-2', turnId: 't-fork' })],
    )
    const { trail, outcome } = spendFromLedger(snapshot, true)
    for (const agent of outcome.agents) {
      const bucket = outcome.buckets.find(b => b.agents.includes(agent.agentId))?.bucket
      for (const width of [30, 60]) {
        const { ctx } = stubContext(snapshot, width, bucket ? `bk:${bucket}` : undefined, agent.agentId)
        expect(draw(SpendOutcomePanel(ctx, outcome, trail, true)).text).not.toMatch(NEGATIVE_WORDS)
        expect(draw(AgentOutcomeDetail(ctx, agent, trail)).text).not.toMatch(NEGATIVE_WORDS)
      }
    }
  })
})
