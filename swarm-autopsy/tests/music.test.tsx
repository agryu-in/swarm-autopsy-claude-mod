// The scenes' music: who plays it (ported from the meadow mod), every scene's track and its credit, and the toolbar's
// music row through the engine's own test host: play, pause and the volume, shared through the store, the player run as
// `paplay` with this mod's own stream name. The world beneath (store, processes) is answered from memory: no audio.

import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

import { BEAT_MS, STALE_MS, cleanSound, decide, volumeOf, type MusicFacts } from '../hooks/lib/music.ts'
import { SCENES, SCENE_IDS } from '../hooks/lib/scenes.ts'
import type { Snapshot } from '../types'
import { build, threeAgentSession } from './fixtures'
import { withClients } from './view-helpers'

const PLUGIN = 'swarm-autopsy'
const NOW = 1_100_000
const SLOW = { timeoutMs: 120_000 }

describe('who plays the music', () => {
  const base: MusicFacts = { me: 'a', now: 100_000, sound: { isPlaying: true, volume: 2 }, owner: undefined, hasTrack: true, canPlay: true }

  test('paused: nobody plays, and the owner lets go', () => {
    expect(decide({ ...base, sound: { isPlaying: false, volume: 2 } })).toEqual({ playHere: false, owner: 'none', where: 'paused' })
    expect(decide({ ...base, sound: { isPlaying: false, volume: 2 }, owner: { session: 'a', beatAt: 99_000 } }).owner).toBe('release')
  })

  test('the owner plays and keeps its heartbeat; another fresh owner keeps it silent here', () => {
    expect(decide({ ...base, owner: { session: 'a', beatAt: 99_000 } })).toEqual({ playHere: true, owner: 'beat', where: 'here' })
    expect(decide({ ...base, owner: { session: 'b', beatAt: base.now - BEAT_MS } })).toEqual({ playHere: false, owner: 'none', where: 'elsewhere' })
  })

  test('an owner gone quiet is taken over: claim first, play once the claim stands', () => {
    expect(decide({ ...base, owner: { session: 'b', beatAt: base.now - STALE_MS - 1 } })).toEqual({ playHere: false, owner: 'claim', where: 'elsewhere' })
    expect(decide({ ...base, owner: { session: 'a', beatAt: base.now } }).playHere).toBe(true)
  })

  test('a machine that cannot play never claims the music; volume steps are quiet and rising', () => {
    expect(decide({ ...base, canPlay: false })).toEqual({ playHere: false, owner: 'none', where: 'unavailable' })
    const steps = [1, 2, 3, 4, 5].map(volumeOf)
    expect([...steps].sort((x, y) => x - y)).toEqual(steps)
    expect(Math.max(...steps)).toBeLessThan(1)
    expect(cleanSound({ isPlaying: 'yes', volume: 9 })).toEqual({ isPlaying: false, volume: 2 })
  })

  test('every scene has its own track and the credit the toolbar shows', () => {
    for (const id of SCENE_IDS) {
      expect({ id, music: SCENES[id].music }).toEqual({ id, music: `music/${id}.mp3` })
      expect({ id, title: (SCENES[id].musicTitle ?? '').includes('·') }).toEqual({ id, title: true })
    }
  })
})

// ── the toolbar's music row ──

type El = { type: string; props?: Record<string, unknown>; children?: unknown }
const isEl = (node: unknown): node is El => node !== null && typeof node === 'object' && typeof (node as El).type === 'string'
function all(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const child of node) all(child, out)
    return out
  }
  if (!isEl(node)) return out
  out.push(node)
  const own = node.children ?? node.props?.children
  for (const child of Array.isArray(own) ? own : own === undefined ? [] : [own]) all(child, out)
  return out
}
const label = (root: unknown, key: string) => all(root).find(el => el.type === 'Button' && el.props?.key === key)?.props?.label
const variant = (root: unknown, key: string) => all(root).find(el => el.type === 'Button' && el.props?.key === key)?.props?.variant

type World = { store: Map<string, unknown>; spawned: string[][]; clock: ReturnType<typeof mock.clock> }

/** A desktop chat with a PulseAudio player that keeps playing until the mod stops it. */
function world(on: On, seed: Snapshot, canPlay = true): World {
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  const spawned: string[][] = []
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'chat-a' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.turns', () => ({ value: 0 }))
  on('agent.list', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', (_$, e, next) => (e.plugin === PLUGIN && e.key === 'snapshot' ? { value: { value: seed, version: 1 } } : next(e)))
  on('process.run', (_$, e) => {
    const [cmd] = e.argv
    const answer = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'uname') return answer('Linux\n')
    if (cmd === 'pactl' || cmd === 'paplay') return answer('[]', canPlay ? 0 : 1)
    return answer('')
  })
  on('process.spawn', async function* (_$, e, next) {
    spawned.push([...e.argv])
    await new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))
    return { value: { code: null, signal: 'SIGTERM' } }
  })
  return { store, spawned, clock }
}

const PANE = {
  plugin: PLUGIN,
  component: 'Pane' as const,
  requestId: 'swarm-autopsy',
  props: { title: 'Swarm Autopsy', isFocused: true, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 60 }, view: {} },
}

async function open($: Engine, w: World) {
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  await w.clock.advance(1600)
  return withClients(await $.ui.mount({ ...PANE, surface: 'desktop' }))
}

describe('the music row', () => {
  test('play starts the scene’s track here with this mod’s own stream; pause stops it for every chat', SLOW, async ($: Engine, on: On) => {
    const w = world(on, { ...build(...threeAgentSession()), sessionId: 'music' })
    const ui = await open($, w)
    let root = await ui.drawn()
    expect(label(root, 'sa-play')).toBe('▶ Play')
    expect(JSON.stringify(root)).toContain('paused')
    await ui.press({ key: 'sa-play' })
    await w.clock.advance(1600)
    expect(w.store.get('sound')).toEqual({ isPlaying: true, volume: 2 })
    expect((w.store.get('music-owner') as { session: string }).session).toBe('chat-a')
    const player = w.spawned.at(-1) ?? []
    expect(player[0]).toBe('paplay')
    expect(player).toContain('--client-name=swarm-autopsy-music')
    expect(player.at(-1)).toMatch(/\/music\/fogbound-cemetery\.mp3$/)
    root = await ui.drawn()
    expect(label(root, 'sa-play')).toBe('⏸ Pause')
    expect(JSON.stringify(root)).toContain('playing · The Past · TAD')
    await ui.press({ key: 'sa-play' })
    await w.clock.advance(1600)
    expect(w.store.get('sound')).toEqual({ isPlaying: false, volume: 2 })
    expect(w.store.has('music-owner')).toBe(false)
    await ui.unmount()
  })

  test('a volume step is shared and drawn as the filled steps', SLOW, async ($: Engine, on: On) => {
    const w = world(on, { ...build(...threeAgentSession()), sessionId: 'music' })
    const ui = await open($, w)
    await ui.press({ key: 'sa-vol-4' })
    await w.clock.advance(1600)
    expect(w.store.get('sound')).toEqual({ isPlaying: false, volume: 4 })
    const root = await ui.drawn()
    expect([1, 2, 3, 4, 5].map(step => variant(root, `sa-vol-${step}`))).toEqual(['primary', 'primary', 'primary', 'primary', 'secondary'])
    await ui.unmount()
  })

  test('a machine with no audio player says so, and never claims the music', SLOW, async ($: Engine, on: On) => {
    const w = world(on, { ...build(...threeAgentSession()), sessionId: 'music' }, false)
    const ui = await open($, w)
    await ui.press({ key: 'sa-play' })
    await w.clock.advance(1600)
    expect(w.spawned).toEqual([])
    expect(JSON.stringify(await ui.drawn())).toContain('no audio')
    await ui.unmount()
  })
})
