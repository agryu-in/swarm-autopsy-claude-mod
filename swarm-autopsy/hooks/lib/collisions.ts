// Collaboration collisions: which agents touched which files, and the
// patterns worth investigating. A signal is a prompt to look, never a verdict:
// each carries the events it rests on and how strongly they support it.

import type { Evidence, ForensicEvent, Snapshot } from '../../types'
import { baseName, cap, dirName, normalizeCommand, textNamesPath } from './classify'
import { leadingDirectory, resolveDir } from './command'

const OVERLAP_MIN = 12
const MAX_FILES = 40

export type FileTouch = {
  agentId: string
  reads: number
  writes: number
  failedWrites: number
  firstSeq: number
  lastSeq: number
}

export type FileRow = {
  path: string
  root: string | null
  rel: string
  touches: FileTouch[]
  writers: number
  lastSeq: number
}

export type SignalKind =
  | 'shared-write'
  | 'overwrite'
  | 'stale-write'
  | 'worktree-divergence'
  | 'test-during-change'
  | 'repeated-failure'
  | 'contradictory-results'

export type Signal = {
  id: string
  kind: SignalKind
  severity: 'investigate' | 'notice'
  evidence: Extract<Evidence, 'OBSERVED' | 'LINKED' | 'INFERRED'>
  title: string
  detail: string[]
  agents: string[]
  paths: string[]
  eventIds: string[]
}

export type Collisions = { files: FileRow[]; totalFiles: number; agents: string[]; signals: Signal[] }

const ok = (e: ForensicEvent) => e.outcome?.status === 'ok'
const refusedOrFailed = (e: ForensicEvent) => e.outcome?.status === 'error' || e.outcome?.status === 'denied'
const isWriteAttempt = (e: ForensicEvent) => e.kind === 'tool' && e.tool?.access === 'write'
/** A write whose result came back without error: the file was changed. */
const isWrite = (e: ForensicEvent) => isWriteAttempt(e) && ok(e)
const isRead = (e: ForensicEvent) => e.kind === 'tool' && (e.tool?.access === 'read' || e.tool?.access === 'search') && ok(e)
/** A command that ran and failed (a refusal is a command that never ran). */
const ranAndFailed = (e: ForensicEvent) => e.outcome?.status === 'error'

function rootOf(snapshot: Snapshot, path: string): string | null {
  const root = snapshot.roots[dirName(path)]
  return root === undefined ? null : root
}

function relOf(path: string, root: string | null): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function fileRows(snapshot: Snapshot): FileRow[] {
  const rows = new Map<string, Map<string, FileTouch>>()
  for (const event of snapshot.events) {
    if (!isWriteAttempt(event) && !isRead(event)) continue
    for (const path of event.tool?.paths ?? []) {
      const touches = rows.get(path) ?? new Map<string, FileTouch>()
      const prior = touches.get(event.agentId) ?? { agentId: event.agentId, reads: 0, writes: 0, failedWrites: 0, firstSeq: event.seq, lastSeq: event.seq }
      touches.set(event.agentId, {
        ...prior,
        reads: prior.reads + (isRead(event) ? 1 : 0),
        writes: prior.writes + (isWrite(event) ? 1 : 0),
        failedWrites: prior.failedWrites + (isWriteAttempt(event) && refusedOrFailed(event) ? 1 : 0),
        lastSeq: event.seq,
      })
      rows.set(path, touches)
    }
  }
  return [...rows.entries()]
    .map(([path, touches]) => {
      const list = [...touches.values()].sort((a, b) => a.firstSeq - b.firstSeq)
      const root = rootOf(snapshot, path)
      return {
        path,
        root,
        rel: relOf(path, root),
        touches: list,
        writers: list.filter(t => t.writes > 0).length,
        lastSeq: Math.max(...list.map(t => t.lastSeq)),
      }
    })
    .filter(row => row.writers > 0 || row.touches.some(t => t.failedWrites > 0))
    .sort((a, b) => b.writers - a.writers || b.lastSeq - a.lastSeq)
}

function writesTo(snapshot: Snapshot, path: string): ForensicEvent[] {
  return snapshot.events.filter(e => isWrite(e) && e.tool?.paths.includes(path))
}

function sharedWriteSignals(snapshot: Snapshot, rows: readonly FileRow[]): Signal[] {
  return rows
    .filter(row => row.writers >= 2)
    .map(row => {
      const writes = writesTo(snapshot, row.path)
      const order = writes.map(e => e.agentId).filter((id, i, all) => i === 0 || all[i - 1] !== id)
      const interleaved = order.length > new Set(order).size
      const agents = [...new Set(writes.map(e => e.agentId))]
      const labels = agents.map(id => snapshot.agents[id]?.label ?? id)
      return {
        id: `s:shared:${row.path}`,
        kind: 'shared-write' as const,
        severity: interleaved ? ('investigate' as const) : ('notice' as const),
        evidence: 'OBSERVED' as const,
        title: `${interleaved ? 'Interleaved' : 'Sequential'} edits to ${baseName(row.path)} by ${labels.join(', ')}`,
        detail: [
          `${row.path}: one physical file in ${row.root ? `the worktree at ${row.root}` : 'an unresolved working tree'}`,
          `write order: ${writes.map(e => `${snapshot.agents[e.agentId]?.label ?? e.agentId}#${e.seq}`).join(' → ')}`,
        ],
        agents,
        paths: [row.path],
        eventIds: writes.map(e => e.id),
      }
    })
}

function overlapOf(earlier: string, later: string): boolean {
  const added = earlier.trim()
  const replaced = later.trim()
  if (added.length >= OVERLAP_MIN && replaced.includes(added)) return true
  return replaced.length >= OVERLAP_MIN && added.includes(replaced)
}

function overwriteSignals(snapshot: Snapshot, rows: readonly FileRow[]): Signal[] {
  const signals: Signal[] = []
  for (const row of rows.filter(r => r.writers >= 2)) {
    const writes = writesTo(snapshot, row.path)
    writes.forEach((later, i) => {
      const earlier = writes.slice(0, i).reverse().find(e => e.agentId !== later.agentId)
      if (!earlier?.tool?.edit || !later.tool?.edit) return
      const rewrote = later.tool.tool === 'Write'
      if (!rewrote && !overlapOf(earlier.tool.edit.new, later.tool.edit.old)) return
      const who = snapshot.agents[later.agentId]?.label ?? later.agentId
      const whom = snapshot.agents[earlier.agentId]?.label ?? earlier.agentId
      signals.push({
        id: `s:overwrite:${later.id}`,
        kind: 'overwrite',
        severity: 'investigate',
        evidence: rewrote ? 'OBSERVED' : 'LINKED',
        title: rewrote
          ? `${who} rewrote all of ${baseName(row.path)} after ${whom} edited it`
          : `${who} replaced text in ${baseName(row.path)} that ${whom} had written`,
        detail: rewrote
          ? [`#${earlier.seq} ${whom} edited; #${later.seq} ${who} wrote the whole file`]
          : [`#${earlier.seq} ${whom} added: ${earlier.tool.edit.new.trim()}`, `#${later.seq} ${who} replaced: ${later.tool.edit.old.trim()}`],
        agents: [later.agentId, earlier.agentId],
        paths: [row.path],
        eventIds: [earlier.id, later.id],
      })
    })
  }
  return signals
}

function staleWriteSignals(snapshot: Snapshot, rows: readonly FileRow[]): Signal[] {
  const signals: Signal[] = []
  for (const row of rows.filter(r => r.writers >= 2)) {
    const touching = snapshot.events.filter(e => (isRead(e) || isWrite(e)) && e.tool?.paths.includes(row.path))
    touching.forEach((write, i) => {
      if (!isWrite(write)) return
      const before = touching.slice(0, i)
      const lastOwn = [...before].reverse().find(e => e.agentId === write.agentId)
      if (!lastOwn || !isRead(lastOwn)) return
      const between = before.filter(e => e.seq > lastOwn.seq && isWrite(e) && e.agentId !== write.agentId)
      const other = between[between.length - 1]
      if (!other) return
      const who = snapshot.agents[write.agentId]?.label ?? write.agentId
      const whom = snapshot.agents[other.agentId]?.label ?? other.agentId
      signals.push({
        id: `s:stale:${write.id}`,
        kind: 'stale-write',
        severity: 'investigate',
        evidence: 'INFERRED',
        title: `${who} wrote ${baseName(row.path)} after ${whom} changed it since ${who}'s last read`,
        detail: [`#${lastOwn.seq} ${who} read · #${other.seq} ${whom} wrote · #${write.seq} ${who} wrote without reading again`],
        agents: [write.agentId, other.agentId],
        paths: [row.path],
        eventIds: [lastOwn.id, other.id, write.id],
      })
    })
  }
  return signals
}

/** Worktrees of one repository share its common git dir; separate repositories do not. */
function worktreeSignals(snapshot: Snapshot, rows: readonly FileRow[]): Signal[] {
  const byRel = new Map<string, FileRow[]>()
  for (const row of rows.filter(r => r.root !== null && r.writers > 0)) {
    const common = snapshot.repos[row.root ?? '']
    if (!common) continue
    const key = `${common}\u0000${row.rel}`
    byRel.set(key, [...(byRel.get(key) ?? []), row])
  }
  return [...byRel.entries()]
    .filter(([, group]) => new Set(group.map(r => r.root)).size >= 2)
    .map(([key, group]) => {
      const rel = key.slice(key.indexOf('\u0000') + 1)
      const agents = [...new Set(group.flatMap(r => r.touches.filter(t => t.writes > 0).map(t => t.agentId)))]
      return {
        id: `s:worktree:${rel}`,
        kind: 'worktree-divergence' as const,
        severity: 'notice' as const,
        evidence: 'OBSERVED' as const,
        title: `${rel} edited in ${group.length} separate worktrees`,
        detail: [
          `Separate worktrees of one repository (${snapshot.repos[group[0]?.root ?? ''] ?? ''}): not a physical conflict. The copies may diverge when the branches are merged.`,
          ...group.map(r => `${r.root}: ${r.touches.filter(t => t.writes > 0).map(t => snapshot.agents[t.agentId]?.label ?? t.agentId).join(', ')}`),
        ],
        agents,
        paths: group.map(r => r.path),
        eventIds: group.flatMap(r => writesTo(snapshot, r.path).map(e => e.id)),
      }
    })
}

function duringTestSignals(snapshot: Snapshot): Signal[] {
  const signals: Signal[] = []
  const tests = snapshot.events.filter(e => e.tool?.verification && e.endSeq !== undefined)
  for (const test of tests) {
    const writes = snapshot.events.filter(
      e => isWrite(e) && e.agentId !== test.agentId && e.seq > test.seq && e.seq < (test.endSeq ?? test.seq),
    )
    for (const write of writes) {
      const path = write.tool?.paths[0] ?? ''
      const named = textNamesPath(test.tool?.command ?? '', test.tool?.mentions ?? [], path)
      const tester = snapshot.agents[test.agentId]?.label ?? test.agentId
      const editor = snapshot.agents[write.agentId]?.label ?? write.agentId
      signals.push({
        id: `s:during:${test.id}:${write.id}`,
        kind: 'test-during-change',
        severity: 'investigate',
        evidence: 'INFERRED',
        title: `${editor} edited ${baseName(path)} while ${tester}'s \`${normalizeCommand(test.tool?.command ?? '')}\` ran`,
        detail: [
          `the run spans #${test.seq}–#${test.endSeq}; the edit is #${write.seq}`,
          named ? 'the command names the edited file, so its result may not reflect this edit' : 'the command does not name the edited file',
        ],
        agents: [test.agentId, write.agentId],
        paths: [path],
        eventIds: [test.id, write.id],
      })
    }
  }
  return signals
}

function failureSignals(snapshot: Snapshot): Signal[] {
  const signals: Signal[] = []
  const byCommand = new Map<string, ForensicEvent[]>()
  for (const event of snapshot.events.filter(e => e.tool?.command && e.endSeq !== undefined)) {
    const base = snapshot.agents[event.agentId]?.cwd ?? snapshot.cwd
    const cwd = resolveDir(leadingDirectory(event.tool?.command ?? ''), base) ?? ''
    const key = `${cwd}\u0000${normalizeCommand(event.tool?.command ?? '')}`
    byCommand.set(key, [...(byCommand.get(key) ?? []), event])
  }
  for (const [key, runs] of byCommand) {
    const command = cap(key.slice(key.indexOf('\u0000') + 1), 80)
    const failures = runs.filter(ranAndFailed)
    if (failures.length >= 2) {
      signals.push({
        id: `s:repeat:${key}`,
        kind: 'repeated-failure',
        severity: 'investigate',
        evidence: 'OBSERVED',
        title: `\`${command}\` failed ${failures.length} times`,
        detail: failures.map(e => `#${e.seq} ${snapshot.agents[e.agentId]?.label ?? e.agentId}: ${e.outcome?.text.split('\n')[0] ?? ''}`),
        agents: [...new Set(failures.map(e => e.agentId))],
        paths: [],
        eventIds: failures.map(e => e.id),
      })
    }
    const verdicts = runs.map(e => e.outcome?.verdict).filter(v => v === 'passed' || v === 'failed')
    if (verdicts.includes('passed') && verdicts.includes('failed')) {
      const last = verdicts[verdicts.length - 1]
      signals.push({
        id: `s:contradict:${key}`,
        kind: 'contradictory-results',
        severity: last === 'failed' ? 'investigate' : 'notice',
        evidence: 'OBSERVED',
        title: last === 'failed' ? `\`${command}\` passed, then failed later` : `\`${command}\` failed, then passed later`,
        detail: runs.map(e => `#${e.seq} ${snapshot.agents[e.agentId]?.label ?? e.agentId}: ${e.outcome?.verdict ?? 'running'}`),
        agents: [...new Set(runs.map(e => e.agentId))],
        paths: [],
        eventIds: runs.map(e => e.id),
      })
    }
  }
  const failedEdits = new Map<string, ForensicEvent[]>()
  for (const event of snapshot.events.filter(e => isWriteAttempt(e) && ranAndFailed(e))) {
    for (const path of event.tool?.paths ?? []) failedEdits.set(path, [...(failedEdits.get(path) ?? []), event])
  }
  for (const [path, events] of failedEdits) {
    if (events.length < 2) continue
    signals.push({
      id: `s:repeat-edit:${path}`,
      kind: 'repeated-failure',
      severity: 'investigate',
      evidence: 'OBSERVED',
      title: `${events.length} failed edits of ${baseName(path)}`,
      detail: events.map(e => `#${e.seq} ${snapshot.agents[e.agentId]?.label ?? e.agentId}: ${e.outcome?.text.split('\n')[0] ?? ''}`),
      agents: [...new Set(events.map(e => e.agentId))],
      paths: [path],
      eventIds: events.map(e => e.id),
    })
  }
  return signals
}

export function analyzeCollisions(snapshot: Snapshot): Collisions {
  const all = fileRows(snapshot)
  const files = all.slice(0, MAX_FILES)
  const agents = [...new Set(files.flatMap(f => f.touches.map(t => t.agentId)))].sort(
    (a, b) => snapshot.agentOrder.indexOf(a) - snapshot.agentOrder.indexOf(b),
  )
  const signals = [
    ...sharedWriteSignals(snapshot, all),
    ...overwriteSignals(snapshot, all),
    ...staleWriteSignals(snapshot, all),
    ...worktreeSignals(snapshot, all),
    ...duringTestSignals(snapshot),
    ...failureSignals(snapshot),
  ]
  const rank = (s: Signal) => (s.severity === 'investigate' ? 0 : 1)
  return { files, totalFiles: all.length, agents, signals: signals.sort((a, b) => rank(a) - rank(b)) }
}
