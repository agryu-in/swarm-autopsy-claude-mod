// The forensic timeline: the snapshot's events, filtered and paged, in the
// order the collector observed them.

import type { ForensicEvent, Snapshot, TimelineFilter } from '../../types'
import { MAIN } from './reduce'

const AGENT_KINDS = new Set(['spawn', 'spawn-denied', 'turn-end', 'agent-start', 'agent-stop', 'roster', 'compaction'])

export function isFailure(event: ForensicEvent): boolean {
  if (event.kind === 'spawn-denied') return true
  if (event.kind === 'turn-end') return !event.source.includes('reason answer')
  const status = event.outcome?.status
  return status === 'error' || status === 'denied' || event.outcome?.verdict === 'failed'
}

export function matchesFilter(event: ForensicEvent, filter: TimelineFilter, flagged: ReadonlySet<string>): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'agents':
      return AGENT_KINDS.has(event.kind) || (event.kind === 'turn-start' && event.agentId !== MAIN)
    case 'files':
      return event.kind === 'tool' && ['read', 'write', 'search'].includes(event.tool?.access ?? '')
    case 'tests':
      return event.tool?.verification !== undefined
    case 'failures':
      return isFailure(event)
    case 'signals':
      return flagged.has(event.id)
  }
}

export type TimelinePage = {
  rows: ForensicEvent[]
  page: number
  pages: number
  total: number
}

/**
 * One page of the filtered timeline, oldest first within the page. Page 0
 * is the newest page, so a live session shows its latest events first.
 */
export function timelinePage(
  snapshot: Snapshot,
  filter: TimelineFilter,
  agentFilter: string | undefined,
  page: number,
  size: number,
  flagged: ReadonlySet<string> = new Set(),
): TimelinePage {
  const events = snapshot.events.filter(
    e => matchesFilter(e, filter, flagged) && (agentFilter === undefined || e.agentId === agentFilter),
  )
  const per = Math.max(1, size)
  const pages = Math.max(1, Math.ceil(events.length / per))
  const current = Math.min(Math.max(0, page), pages - 1)
  const end = events.length - current * per
  return { rows: events.slice(Math.max(0, end - per), end), page: current, pages, total: events.length }
}
