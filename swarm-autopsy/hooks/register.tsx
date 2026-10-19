// Swarm Autopsy: collects what the session's agents observably did and draws
// it as a forensic pane, opened with /swarm-autopsy.
//
// The collector reduces each hook input to an observation (lib/collect) and
// folds it into a snapshot (lib/reduce) held in a module cache. Everything
// slower than that (resolving git roots, asking the agent roster, writing the
// snapshot to `$.state`, the optional export) runs on a background tick, never
// on the path a tool call, a spawn or a turn returns by. The pane reads
// `$.state`, so it redraws as the snapshot moves and survives hot reloads.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, Timer } from 'claude-code'

import type { LiveFilter, Snapshot, TimelineFilter, TrailFilter, UiState, View } from '../types'
import { cleanClarity } from './lib/clarity.ts'
import { dirName } from './lib/classify'
import { analyzeCollisions } from './lib/collisions'
import {
  rosterObservation,
  spawnObservation,
  toolEndObservation,
  toolFacts,
  toolStartObservation,
  turnEndObservation,
} from './lib/collect'
import { compact, plural, subagents } from './lib/format'
import { buildLedgerView, emptyLedger, usageRecordFrom } from './lib/ledger'
import { buildSpendOutcome } from './lib/outcome'
import { parsePriceTable, type PriceTable } from './lib/pricing'
import { emptySnapshot, reduce, type Observation } from './lib/reduce'
import { cleanMood, currentScene, withMode, withScene, type Mood } from './lib/scenes.ts'
import { MUSIC_TICK_MS, detectAudio, musicTick, setMusicVolume, stopMusic, toggleMusic } from './music'
import { clearStillFault, planStillPane, registerStillPane, reopenStillPane, StillPane, wantsStillPane } from './ui/client/still-pane'
import { applyTheme, themeFor } from './lib/themes'
import { gatherSignals, unresolvedOf } from './lib/signals'
import { buildTrail } from './lib/trail'
import type { Actions, ViewContext } from './ui/common'
import { layoutFor } from './ui/kit'
import { cleanTree } from './ui/clean'
import { drawingFailed } from './ui/failed'
import { Pane, PaneContent, type Analyses } from './ui/pane'

const PANE_ID = 'swarm-autopsy'
const TITLE = 'Swarm Autopsy'
const TICK_MS = 250
/** The snapshot reaches `$.state` at most this often while it keeps changing: each write redraws the pane, and on
 * desktop a redraw re-mints every press handle, so a click racing it is lost (DESIGN-CONTRACT §7.6). */
const FLUSH_MS = 1000
/** The terminal dock width asked for when the person wants a wider pane: a request it may not grant. The desktop app
 * sizes its dock itself, so the button is drawn only on the terminal (common.tsx sizesPaneOnRequest). */
const WIDE_COLUMNS = 120
/**
 * How long after a press the pane keeps drawing the data it had. On desktop every redraw re-mints every press handle,
 * so in a busy session a click carrying the last drawing's handle was lost (`ui_press not handled` in the desktop app's
 * log, 2026-10-18); an identical drawing keeps its handles.
 */
const HOLD_MS = 20_000
const DEFAULT_ROWS = 40
const GIT_TIMEOUT_MS = 5000
const VIEW_NAMES: readonly View[] = ['live', 'trail', 'collisions', 'forensics', 'spend', 'health']
const INTERRUPTED = 'The call ended without a result (interrupted or aborted).'

// A tool.call hook that awaits the Agent tool would sit above that subagent's
// whole run, and the engine never runs a hook beneath its own frame: it would
// not hear the subagent's tool calls. Delegation is read from agent.spawn and
// the report from turn.complete instead, so these tools are left out here.
const COLLECTED_TOOLS = /^(?!(Agent|Task|Workflow)$)/

const DEFAULT_UI: UiState = { view: 'live', filter: 'all', page: 0 }

const snapshotAtom = atom({ plugin: 'swarm-autopsy', key: 'snapshot' } as const, emptySnapshot(0))
const uiAtom = atom({ plugin: 'swarm-autopsy', key: 'ui' } as const, DEFAULT_UI)

// The module's caches and its background queue. `$.state` holds the truth a
// reload or a drawing reads; these only speed collection up between ticks.
let cache: Snapshot | undefined
let dirty = false
let ready: Promise<void> | undefined
let tickTimer: Timer | undefined
let musicTimer: Timer | undefined
/** This chat's session id: who owns the music. */
let musicMe = ''
let ticking = false
let lastFlushAt = Number.NEGATIVE_INFINITY
/** Until when the pane draws held data after the person's last press, and the data and clock it holds. */
let holdUntil = Number.NEGATIVE_INFINITY
let frozen: { snapshot: Snapshot; now: number } | undefined
/** The data and clock of the last drawing, and the clock when it was drawn: what a press freezes. */
let lastDrawn: { snapshot: Snapshot; now: number } | undefined
let lastClockNow = Number.NEGATIVE_INFINITY
let afterClear = false
let rosterDue = false
let exportDue = false
const pendingDirs = new Set<string>()
let memo: { key: string; analyses: Analyses } | undefined

/** A replacement price table from SWARM_AUTOPSY_PRICES, read once per session start; the built-in one otherwise. */
type Prices = { table?: PriceTable; path?: string; error?: string }
let prices: Prices = {}

/** The version 2 shape: the same snapshot without the usage ledger. */
type SnapshotV2 = Omit<Snapshot, 'version' | 'ledger' | 'compactionMarks' | 'instruments'> & {
  version: 2
  instruments: Omit<Snapshot['instruments'], 'step'>
}

/** A stored value is reused only when it is this contract's shape (or the one before it) and this session's. */
function isCurrent(value: unknown, sessionId: string | undefined): value is Snapshot | SnapshotV2 {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<Snapshot> | Partial<SnapshotV2>
  return (
    (v.version === 3 || v.version === 2) &&
    v.sessionId !== undefined &&
    v.sessionId === sessionId &&
    Array.isArray(v.events) &&
    Array.isArray(v.openTools) &&
    typeof v.agents === 'object' &&
    typeof v.repos === 'object'
  )
}

/** A version 2 snapshot kept across a reload gains an empty ledger, and says usage starts now. */
function upgrade(stored: Snapshot | SnapshotV2, at: number): Snapshot {
  if (stored.version === 3) return stored
  const since = { at, missedEarlier: true, basis: 'the mod was reloaded over a snapshot that predates the usage ledger' }
  return reduce(
    {
      ...stored,
      version: 3,
      ledger: { ...emptyLedger(), since },
      compactionMarks: [],
      instruments: { ...stored.instruments, step: 0 },
    },
    {
      kind: 'note',
      at,
      text: 'Token usage collection started when the mod was reloaded; requests before that were not recorded.',
    },
  )
}

/** Loads the session's snapshot after a (re)load, or starts a fresh one. */
async function hydrate($: EngineInterface): Promise<void> {
  const sessionId = await $.session.id().catch(() => undefined)
  const stored = await $.state.get({ plugin: 'swarm-autopsy', key: 'snapshot' })
  const value = stored.value as unknown
  if (isCurrent(value, sessionId)) {
    cache = upgrade(value, await $.clock.now())
    dirty = cache !== value
    return
  }
  const now = await $.clock.now()
  const cwd = await $.session.cwd().catch(() => undefined)
  const turns = afterClear ? 0 : await $.session.turns().catch(() => 0)
  const base = emptySnapshot(now, sessionId)
  const since = {
    at: now,
    missedEarlier: turns > 0,
    basis:
      turns > 0
        ? `the collector started after ${plural(turns, 'prompt')} in this session`
        : 'the collector started with the session (or after /clear)',
  }
  let fresh: Snapshot = { ...base, cwd, ledger: { ...base.ledger, since } }
  if (turns > 0) {
    fresh = reduce(fresh, {
      kind: 'note',
      at: now,
      text: `The collector started after ${plural(turns, 'prompt')} in this session; activity before that was not captured.`,
    })
  }
  const roster = await $.agent.list().catch(() => [])
  if (roster.length > 0) fresh = reduce(fresh, rosterObservation(roster, now))
  afterClear = false
  cache = fresh
  dirty = true
}

function ensureReady($: EngineInterface): Promise<void> {
  if (!ready) {
    ready = hydrate($).catch(async () => {
      cache = cache ?? emptySnapshot(await $.clock.now().catch(() => 0))
    })
  }
  return ready
}

/** Folds one observation into the cache. Never throws: collection must not disturb the session. */
async function observe($: EngineInterface, make: (at: number) => Observation): Promise<void> {
  try {
    await ensureReady($)
    const at = await $.clock.now()
    const next = reduce(cache ?? emptySnapshot(at), make(at))
    dirty = dirty || next !== cache
    cache = next
  } catch {
    // A failed observation is dropped; the session goes on untouched.
  }
}

/** An agent id the snapshot has never seen: ask the roster for its type, task and parent on the next tick. */
function noteAgent(agentId: string | undefined): void {
  if (agentId !== undefined && cache !== undefined && !cache.agents[agentId]) rosterDue = true
}

async function flush($: EngineInterface): Promise<void> {
  if (!dirty || !cache) return
  dirty = false
  try {
    await $.state.set({ plugin: 'swarm-autopsy', key: 'snapshot' }, cache)
    lastFlushAt = await $.clock.now().catch(() => lastFlushAt)
  } catch {
    dirty = true
  }
}

/** The tick's flush: at most once per FLUSH_MS while changes keep coming. Commands and session events flush at once. */
async function flushIfDue($: EngineInterface): Promise<void> {
  if (!dirty) return
  const now = await $.clock.now().catch(() => Number.POSITIVE_INFINITY)
  if (now - lastFlushAt >= FLUSH_MS) await flush($)
}

/** Reads the price table file a person named, if any. A bad file is reported, never silently replaced. */
async function loadPrices($: EngineInterface): Promise<Prices> {
  const path = await $.env.get('SWARM_AUTOPSY_PRICES').catch(() => undefined)
  if (!path) return {}
  try {
    const parsed = parsePriceTable(JSON.parse(await $.fs.read(path)))
    return 'table' in parsed ? { table: parsed.table, path } : { path, error: parsed.error }
  } catch (error) {
    return { path, error: error instanceof Error ? error.message : 'the file could not be read as JSON' }
  }
}

/** Every analysis the views draw, computed once per snapshot revision and cost setting. */
function analysesOf(snapshot: Snapshot, showCost = false): Analyses {
  const key = `${snapshot.sessionId ?? ''}:${snapshot.rev}:${showCost}`
  if (memo?.key !== key) {
    const trail = buildTrail(snapshot)
    const ledger = buildLedgerView(snapshot.ledger, snapshot, {
      showCost,
      engineCostUsd: snapshot.engineCost?.usd,
      prices: prices.table,
    })
    const collisions = analyzeCollisions(snapshot)
    const spend = buildSpendOutcome(snapshot, trail, ledger)
    memo = {
      key,
      analyses: {
        trail,
        collisions,
        ledger,
        spend,
        health: gatherSignals({ snapshot, trail, collisions, ledger, spend }),
        prices: { path: prices.path, error: prices.error },
      },
    }
  }
  return memo.analyses
}

/** Writes the collected session and its analysis to `path` (the export's format: the render pipeline's seed). */
async function writeExport($: EngineInterface, path: string): Promise<void> {
  if (!cache) return
  const at = await $.clock.now()
  const body = {
    kind: 'swarm-autopsy-export',
    exportedAt: at,
    note: 'Observed session data and its deterministic analysis; see README for the evidence labels.',
    snapshot: cache,
    // The export carries the ≈$ estimates (labelled ESTIMATED, dated) whatever the pane shows.
    analysis: analysesOf(cache, true),
  }
  await $.fs.write(path, JSON.stringify(body, null, 2))
}

async function exportSnapshot($: EngineInterface): Promise<void> {
  try {
    const path = await $.env.get('SWARM_AUTOPSY_EXPORT')
    if (path) await writeExport($, path)
  } catch {
    // Export is a debugging aid; its failure changes nothing else.
  }
}

/**
 * `/swarm-autopsy export`: the collected session written now, beside the session's root, so a pane problem can be
 * reproduced from the person's own data (the render pipeline takes the file as its seed). Says where, or why not.
 */
async function exportNow($: EngineInterface): Promise<string> {
  try {
    const root = await $.session.root()
    const path = `${root.replace(/\/+$/, '')}/swarm-autopsy-export-${Math.round(await $.clock.now())}.json`
    await writeExport($, path)
    return `Swarm Autopsy: exported the collected session to ${path}.`
  } catch (error) {
    return `Swarm Autopsy: the export failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** The git worktree root and the repository's common dir for one directory, or nulls. */
async function gitRoot($: EngineInterface, dir: string): Promise<{ root: string | null; commonDir: string | null }> {
  const both = await $.process.run(['git', '-C', dir, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], {
    timeoutMs: GIT_TIMEOUT_MS,
  })
  if (both.exitCode === 0) {
    const [root, commonDir] = both.stdout.trim().split('\n')
    return { root: root || null, commonDir: commonDir || null }
  }
  const rootOnly = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'], { timeoutMs: GIT_TIMEOUT_MS })
  return { root: rootOnly.exitCode === 0 ? rootOnly.stdout.trim() || null : null, commonDir: null }
}

async function drainRoots($: EngineInterface): Promise<void> {
  for (const dir of [...pendingDirs]) {
    pendingDirs.delete(dir)
    if (cache && dir in cache.roots) continue
    const found = await gitRoot($, dir).catch(() => ({ root: null, commonDir: null }))
    await observe($, () => ({ kind: 'root', dir, root: found.root, commonDir: found.commonDir }))
  }
}

async function refreshRoster($: EngineInterface): Promise<void> {
  if (!rosterDue) return
  rosterDue = false
  const roster = await $.agent.list().catch(() => [])
  if (roster.length > 0) await observe($, at => rosterObservation(roster, at))
}

/** The background tick: slow lookups, the `$.state` write, the export. One at a time. */
async function tick($: EngineInterface): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await drainRoots($)
    await refreshRoster($)
    await flushIfDue($)
    if (exportDue) {
      exportDue = false
      await exportSnapshot($)
    }
  } finally {
    ticking = false
  }
}

/** A press: the pane holds its data for HOLD_MS from now, so the next press finds the same handles. */
function noteInteraction($: EngineInterface): void {
  // At once, from the last drawing's clock, so the press's own redraw is already held; then from the clock itself.
  holdUntil = Math.max(holdUntil, lastClockNow + HOLD_MS)
  if (!frozen && lastDrawn) frozen = lastDrawn
  void $.clock
    .now()
    .then(at => {
      holdUntil = Math.max(holdUntil, at + HOLD_MS)
    })
    .catch(() => undefined)
}

function actionsFor($: EngineInterface): Actions {
  const set = (fn: (ui: UiState) => UiState) => {
    noteInteraction($)
    void update($, uiAtom, fn)
  }
  return {
    view: (view: View) => set(ui => ({ ...ui, view })),
    select: (id: string | undefined) => set(ui => ({ ...ui, selected: id })),
    filter: (filter: TimelineFilter) => set(ui => ({ ...ui, filter, page: 0 })),
    agentFilter: (agentId: string | undefined) => set(ui => ({ ...ui, agentFilter: agentId, page: 0 })),
    page: (page: number) => set(ui => ({ ...ui, page: Math.max(0, page) })),
    openEvent: (eventId: string) =>
      set(ui => ({ ...ui, view: 'forensics', selected: `ev:${eventId}`, filter: 'all', agentFilter: undefined, page: 0 })),
    toggleCost: () => set(ui => ({ ...ui, showCost: ui.showCost !== true })),
    focus: (agentId: string | undefined) => set(ui => ({ ...ui, focus: agentId })),
    toggleFocus: (agentId: string) => set(ui => ({ ...ui, focus: ui.focus === agentId ? undefined : agentId })),
    toggleOpen: (id: string) =>
      set(ui => {
        const open = ui.open ?? []
        return { ...ui, open: open.includes(id) ? open.filter(x => x !== id) : [...open, id] }
      }),
    trailFilter: (trailFilter: TrailFilter) => set(ui => ({ ...ui, trailFilter })),
    liveFilter: (liveFilter: LiveFilter) => set(ui => ({ ...ui, liveFilter })),
    requestWidth: (wide: boolean) => {
      set(ui => ({ ...ui, wide }))
      void $.ui.open({ id: PANE_ID, title: TITLE, ...(wide ? { columns: WIDE_COLUMNS } : {}) }).catch(() => undefined)
    },
    showNode: (nodeId: string) => set(ui => ({ ...ui, view: 'trail', selected: `node:${nodeId}` })),
    togglePause: () => set(ui => ({ ...ui, paused: ui.paused !== true })),
    mode: (mode: string) => void changeMood($, mood => withMode(mood, mode)),
    scene: (scene: string) => void changeMood($, mood => withScene(mood, scene)),
    play: () => void toggleMusic($, musicMe).then(() => syncMusic($)).catch(() => undefined),
    volume: (step: number) => void setMusicVolume($, step).then(() => syncMusic($)).catch(() => undefined),
    glass: (step: number) => void changeGlass($, step),
    part: (index: number) => set(ui => ({ ...ui, parts: { ...(ui.parts ?? {}), [ui.view]: Math.max(0, Math.floor(index)) } })),
  }
}

/**
 * The music for this chat, every MUSIC_TICK_MS and after a press: plays or stops the scene's track as the store and the
 * owner say, and mirrors the shared sound and this chat's standing into the UI state (only when they change, so the
 * pane redraws for nothing else).
 */
async function syncMusic($: EngineInterface): Promise<void> {
  try {
    const ui = await read($, uiAtom)
    const track = currentScene(cleanMood(ui.mood)).music
    const { sound, player } = await musicTick($, musicMe, track)
    if (JSON.stringify(ui.sound) !== JSON.stringify(sound) || JSON.stringify(ui.player) !== JSON.stringify(player)) {
      await update($, uiAtom, now => ({ ...now, sound, player }))
    }
  } catch {
    // the music never gets in the collector's way
  }
}

/** The store key every chat reads the chosen mode and scenes from. */
const MOOD_KEY = 'mood'

/** The mood the store holds, into this chat's UI state, so the pane opens on the scene the person chose last. */
async function loadMood($: EngineInterface): Promise<void> {
  const stored = cleanMood(await $.store.get(MOOD_KEY).catch(() => undefined))
  await update($, uiAtom, ui => ({ ...ui, mood: stored }))
}

/** The store key every chat reads the liquid glass's clarity from. */
const GLASS_KEY = 'glass'

/** The glass clarity the store holds, into this chat's UI state. */
async function loadGlass($: EngineInterface): Promise<void> {
  const stored = cleanClarity(await $.store.get(GLASS_KEY).catch(() => undefined))
  await update($, uiAtom, ui => ({ ...ui, glass: stored }))
}

/** A clarity step from the toolbar: drawn at once, and kept in the store for every chat. */
async function changeGlass($: EngineInterface, step: number): Promise<void> {
  noteInteraction($)
  const next = cleanClarity(step)
  await update($, uiAtom, ui => ({ ...ui, glass: next }))
  await $.store.set(GLASS_KEY, next).catch(() => undefined)
}

/** A new mood from the pickers: drawn at once, and kept in the store for every chat. */
async function changeMood($: EngineInterface, change: (mood: Mood) => Mood): Promise<void> {
  noteInteraction($)
  let next: Mood | undefined
  await update($, uiAtom, ui => {
    next = change(cleanMood(ui.mood))
    return { ...ui, mood: next }
  })
  if (next) await $.store.set(MOOD_KEY, next).catch(() => undefined)
}

function summaryOf(snapshot: Snapshot | undefined): string {
  if (!snapshot) return 'Nothing collected yet.'
  const agents = subagents(snapshot)
  const active = agents.filter(a => a.state === 'active').length
  const { collisions, ledger, health } = analysesOf(snapshot)
  const requests = ledger.session.requests + ledger.session.requestsWithoutUsage
  return `${plural(agents.length, 'subagent')} observed (${active} active), ${plural(snapshot.events.length, 'event')} recorded, ${plural(requests, 'model request')} (${compact(ledger.session.processed)} tokens processed), ${plural(collisions.signals.length, 'collision signal')}, ${unresolvedOf(health).length} unresolved.`
}

/** What the pane draws when a view throws: the error, and a way back to the Live view. */
function DrawFailed(ctx: ViewContext, error: unknown) {
  const { Box, Text, Button } = ctx.els
  const message = error instanceof Error ? error.message : String(error)
  return (
    <Box flexDirection="column" width={ctx.width}>
      <Text weight="bold">Swarm Autopsy could not draw the {ctx.ui.view} view</Text>
      <Text wrap="wrap">{message}</Text>
      <Text dimColor wrap="wrap">
        The collector keeps running. Another tab may still draw; after a fix, /reload-plugins.
      </Text>
      <Box flexDirection="row" columnGap={1}>
        <Button key="tab-live" label="Live" onPress={() => ctx.act.view('live')} />
        <Button key="tab-health" label="Health" onPress={() => ctx.act.view('health')} />
      </Box>
    </Box>
  )
}

function resetSession(at: number): void {
  cache = emptySnapshot(at)
  ready = undefined
  dirty = true
  afterClear = true
  rosterDue = false
  exportDue = false
  lastFlushAt = Number.NEGATIVE_INFINITY
  holdUntil = Number.NEGATIVE_INFINITY
  frozen = undefined
  lastDrawn = undefined
  pendingDirs.clear()
  clearStillFault()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command
      .register({
        name: 'swarm-autopsy',
        description: 'Swarm Autopsy: what each subagent did, its tokens and context, and what stays unresolved, over a still Spooky or Cozy scene',
        argumentHint: `[${VIEW_NAMES.join('|')}|export|close]`,
      })
      .catch(() => undefined)
    prices = await loadPrices($)
    await loadMood($)
    await loadGlass($)
    memo = undefined
    tickTimer?.cancel()
    tickTimer = $.clock.every(TICK_MS, () => void tick($))
    musicMe = (await $.session.id().catch(() => undefined)) ?? 'chat'
    await detectAudio($).catch(() => undefined)
    musicTimer?.cancel()
    musicTimer = $.clock.every(MUSIC_TICK_MS, () => void syncMusic($))
    await ensureReady($)
    await flush($)
    return started
  })

  on('session.end', async ($, e, next) => {
    musicTimer?.cancel()
    await stopMusic($, musicMe).catch(() => undefined)
    await exportSnapshot($)
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      resetSession(await $.clock.now().catch(() => 0))
      await flush($)
    }
    return ended
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    await observe($, at => spawnObservation(e, started, at))
    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    noteAgent(e.agentId)
    await observe($, at => ({ kind: 'turn-start', at, turnId: e.turnId, agentId: e.agentId, text: e.text }))
    return next(e)
  })

  // One model request, main's or a subagent's. The response streams through
  // untouched; its usage is recorded once it is whole. turn.step is the only
  // source of ledger totals (turn.complete's usage is the turn's sum of these).
  // A request that never came back whole (an API error, an abort that stopped
  // the stream) is still a request: it is recorded without usage, and the error
  // or the stop goes on to the caller untouched.
  on('turn.step', async function* ($, e, next) {
    let whole = false
    try {
      const result = yield* next(e)
      whole = true
      noteAgent(e.agentId)
      await observe($, at => ({ kind: 'step', record: usageRecordFrom(e, result, at) }))
      return result
    } finally {
      if (!whole) {
        noteAgent(e.agentId)
        await observe($, at => ({ kind: 'step', record: usageRecordFrom(e, { stopReason: null, usage: null }, at) }))
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    await observe($, at => turnEndObservation(e, at))
    if (e.agentId === undefined) exportDue = true
    return next(e)
  })

  on('tool.call', { tool: COLLECTED_TOOLS }, async ($, e, next) => {
    if (next.origin.plugin !== 'engine') return next(e)
    const facts = toolFacts(e)
    noteAgent(e.agentId)
    await observe($, at => toolStartObservation(e, facts, at))
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      await observe($, at => toolEndObservation(e, facts, { isError: true, text: INTERRUPTED }, at))
      throw error
    }
    await observe($, at => toolEndObservation(e, facts, ran, at))
    if (facts.access === 'write' && ran.deny === undefined && ran.isError !== true) {
      for (const path of facts.paths) pendingDirs.add(dirName(path))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStart', async ($, e, next) => {
    await observe($, at => ({ kind: 'agent-start', at, agentId: e.agent_id, agentType: e.agent_type }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    await observe($, at => ({
      kind: 'agent-stop',
      at,
      agentId: e.agent_id,
      agentType: e.agent_type,
      transcriptPath: e.agent_transcript_path,
      lastMessage: e.last_assistant_message,
    }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (compacted.skip === undefined) {
      const usage = compacted.usage
      await observe($, at => ({
        kind: 'compaction',
        at,
        agentId: e.agentId,
        trigger: e.trigger,
        tokensBefore: compacted.tokensBefore,
        tokensAfter: compacted.tokensAfter,
        summarizerTokens: usage
          ? {
              input: usage.input_tokens,
              cacheRead: usage.cache_read_input_tokens,
              cacheWrite: usage.cache_creation_input_tokens,
              output: usage.output_tokens,
            }
          : undefined,
      }))
    }
    return compacted
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await observe($, at => ({ kind: 'context', at, tokens: e.context.tokens, window: e.context.window, percent: e.context.percent }))
    const usd = e.cost?.usd
    if (usd !== undefined) await observe($, at => ({ kind: 'cost', at, usd }))
    return next(e)
  })

  on('command.run', { command: 'swarm-autopsy' }, async ($, e) => {
    await ensureReady($)
    await flush($)
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: PANE_ID })
      return { text: 'Swarm Autopsy closed.' }
    }
    if (arg === 'export') return { text: await exportNow($) }
    const view = VIEW_NAMES.find(name => name === arg)
    if (view) await update($, uiAtom, ui => ({ ...ui, view }))
    // Opening the pane gives a still scene that had given up after faults its tries back.
    if (reopenStillPane()) $.ui.invalidate('ui.render')
    const opened = await $.ui.open({ id: PANE_ID, title: TITLE, focus: true })
    const summary = summaryOf(cache)
    return {
      text: opened.isPlaced
        ? `Swarm Autopsy opened. ${summary}`
        : `Swarm Autopsy: no surface placed the pane here (a narrow terminal or a headless run). ${summary}`,
    }
  })

  // A render hook that fails before any view draws (a read rejects) or runs past its budget would leave the engine's
  // own "Nothing to show yet", with the reason only in a debug log: both draw the reason instead.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    try {
      return await drawPane($, e)
    } catch (error) {
      return cleanTree(drawingFailed($.ui.resolve(e), paneWidth(e), { kind: 'throw', message: messageOf(error), budget: 0 }))
    }
  }).catch(($, e, next) => cleanTree(drawingFailed($.ui.resolve(e), paneWidth(e), next.error)))

  registerStillPane(on, PANE_ID)

}

/** The pane's width in cells, never under the narrowest layout. */
const paneWidth = (e: RenderInput<'Pane'>): number => Math.max(30, e.props.bodyColumns)

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The pane's drawing: the held or live data, through the views, every string cleaned. */
async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const live = await read($, snapshotAtom)
  const ui = await read($, uiAtom)
  const clockNow = await $.clock.now()
  // Paused, or browsing (a press in the last HOLD_MS): draw the data and clock held at the hold's first drawing, so
  // the drawing stays identical while the session moves on and its press handles keep working.
  const held = ui.paused === true ? 'paused' : clockNow < holdUntil ? 'browsing' : undefined
  if (!held) frozen = undefined
  else if (!frozen) frozen = { snapshot: live, now: clockNow }
  const snapshot = held && frozen ? frozen.snapshot : live
  const now = held && frozen ? frozen.now : clockNow
  lastClockNow = clockNow
  lastDrawn = { snapshot, now }
  // The theme this drawing reads through GLASS and ROLE: the chosen scene's palette, the terminal always classic.
  applyTheme(themeFor(e.surface, currentScene(cleanMood(ui.mood)).id))
  const els = $.ui.resolve(e)
  const width = paneWidth(e)
  const ctx: ViewContext = {
    els,
    surface: e.surface,
    width,
    layout: layoutFor(width),
    ...(held ? { held } : {}),
    rows: e.props.scroll?.bodyRows ?? e.viewport?.rows ?? DEFAULT_ROWS,
    scrollOffset: e.props.scroll?.offset ?? 0,
    now,
    snapshot,
    ui,
    act: actionsFor($),
  }
  // Every drawn string is cleaned last: one control character in captured text (a command's colour escapes) makes
  // the engine refuse the whole tree, and the pane then draws nothing and its buttons stop answering.
  try {
    const analyses = analysesOf(snapshot, ui.showCost === true)
    // The desktop draws the content over a still scene (two Clients); past a Client's bounds or after a fault, the engine
    // tree with the scene as a frame behind it, and a dim line saying why.
    if (wantsStillPane(ctx)) {
      // At the pane's own width: on the page every card and panel holds to its column (max-width), so the thin scrollbar
      // never pushes a fact out of a narrow card.
      const plan = planStillPane(ctx, cleanTree(PaneContent({ ...ctx, noSelect: true }, analyses)))
      if (plan.ok) return StillPane(ctx, plan)
      return cleanTree(Pane(ctx, analyses, plan.reason))
    }
    return cleanTree(Pane(ctx, analyses))
  } catch (error) {
    // A view that throws on the data would leave the pane blank, with the reason only in a debug log.
    return cleanTree(DrawFailed(ctx, error))
  }
}
