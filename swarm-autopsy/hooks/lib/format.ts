// Small display helpers shared by the views and the export. Pure.

import type { AgentRecord, AgentState, Evidence, Measure, Snapshot, SpendBucket, VerificationVerdict } from '../../types'
import { ROLE, STATE_ROLE } from './palette'

/** Elapsed time since the collector's start, as +m:ss or +h:mm:ss. */
export function offset(startedAt: number, at: number): string {
  const total = Math.max(0, Math.round((at - startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h > 0 ? `+${h}:${String(m).padStart(2, '0')}:${sec}` : `+${m}:${sec}`
}

export function ago(now: number, at: number): string {
  const secs = Math.max(0, Math.round((now - at) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`
}

/** A path shown relative to the session's directory when it lies beneath it. */
export function displayPath(path: string, cwd: string | undefined): string {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1)
  return path
}

export function truncate(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (width <= 1) return flat.slice(0, Math.max(0, width))
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`
}

export function agentName(agent: AgentRecord | undefined, fallbackId?: string): string {
  if (!agent) return fallbackId ? `agent ${shortId(fallbackId)}` : 'unknown agent'
  if (agent.isMain) return 'main'
  return agent.type ? `${agent.label} · ${agent.type}` : `${agent.label} · type unknown`
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

/** Agent state glyphs (DESIGN-CONTRACT §3.2): `●` is left to OBSERVED, so completed is `◉`. */
export const STATE_GLYPH: Record<AgentState, string> = {
  active: '◐',
  completed: '◉',
  failed: '✕',
  stopped: '■',
  unknown: '◌',
}

export const STATE_COLOR: Record<AgentState, string> = STATE_ROLE

export const EVIDENCE_GLYPH: Record<Evidence, string> = {
  OBSERVED: '●',
  LINKED: '◆',
  INFERRED: '◇',
  UNRESOLVED: '?',
  UNAVAILABLE: '∅',
}

/** Evidence colours (§3.1): LINKED is an analytical link, never the green of a passed check. */
export const EVIDENCE_COLOR: Record<Evidence, string> = {
  get OBSERVED() {
    return ROLE.text
  },
  get LINKED() {
    return ROLE.link
  },
  get INFERRED() {
    return ROLE.caution
  },
  get UNRESOLVED() {
    return ROLE.caution
  },
  get UNAVAILABLE() {
    return ROLE.muted
  },
}

export const MEASURE_GLYPH: Record<Measure, string> = {
  OBSERVED: '●',
  ESTIMATED: '≈',
  UNAVAILABLE: '∅',
}

export const MEASURE_COLOR: Record<Measure, string> = {
  get OBSERVED() {
    return ROLE.text
  },
  get ESTIMATED() {
    return ROLE.caution
  },
  get UNAVAILABLE() {
    return ROLE.muted
  },
}

export const VERDICT_GLYPH: Record<VerificationVerdict, string> = {
  passed: '✓',
  failed: '✕',
  inconclusive: '~',
  running: '…',
}

export const VERDICT_COLOR: Record<VerificationVerdict, string> = {
  get passed() {
    return ROLE.ok
  },
  get failed() {
    return ROLE.fail
  },
  get inconclusive() {
    return ROLE.caution
  },
  get running() {
    return ROLE.context
  },
}

/**
 * A share as text, with one rounding rule everywhere (DESIGN-CONTRACT §6; Sunset Glass §12): rounded to one decimal
 * first, then whole numbers as they are, one decimal below 10%, whole numbers above, so 9.96 reads `10%`, never `10.0%`.
 * `<0.1%` for a positive share too small to show, `n/a` for none.
 */
export function pct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a'
  if (value > 0 && value < 0.1) return '<0.1%'
  const tenth = Math.round(value * 10) / 10
  if (Number.isInteger(tenth)) return `${tenth}%`
  return tenth < 10 ? `${tenth.toFixed(1)}%` : `${Math.round(value)}%`
}

/** One wording for each F3 bucket, used by every view (Sunset Glass §4.3). */
export const BUCKET_WORDS: Record<SpendBucket['bucket'], string> = {
  coordinator: 'coordinator',
  verified: 'verified',
  'changed-unverified': 'changed, unverified',
  'failed-or-inconclusive': 'failed or inconclusive',
  'report-only': 'report only',
  mixed: 'mixed',
  unresolved: 'unresolved',
  'no-usage-recorded': 'no usage recorded',
}

/** Thousands separated, independent of locale. */
export function exact(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function stateLabel(agent: AgentRecord): string {
  if (agent.isMain && agent.state === 'completed') return 'idle'
  return agent.state
}

export function subagents(snapshot: Snapshot): AgentRecord[] {
  return snapshot.agentOrder
    .map(id => snapshot.agents[id])
    .filter((a): a is AgentRecord => a !== undefined && !a.isMain)
}
