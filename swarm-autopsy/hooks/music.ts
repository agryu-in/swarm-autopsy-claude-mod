// The scenes' music (ported from the meadow mod): one looping track per scene, played by one chat at a time.
// Play/pause and the volume live in the mod's store, so every chat agrees; the chat named as owner plays and renews a
// heartbeat, and when it closes or goes quiet another chat takes over (lib/music.ts `decide`). On Linux the player is
// `paplay` through PulseAudio (its volume moved live with `pactl`), on macOS the engine's own `$.audio.play`.
// Every helper that takes `$` is a function declaration (the plugin scan reads `$` only through those).

import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

import type { PlayerValue, SoundValue } from '../types'
import { BEAT_MS, cleanOwner, cleanSound, decide, volumeOf } from './lib/music.ts'

type $ = EngineInterface

/** The store keys the music lives under (this mod's own store). */
export const MUSIC_KEYS = { sound: 'sound', owner: 'music-owner' } as const
/** How often a chat checks the store and its player. */
export const MUSIC_TICK_MS = 1500
/** The name the player's stream carries, so a volume change finds it (and never another mod's). */
const MUSIC_CLIENT = 'swarm-autopsy-music'

type Backend = 'paplay' | 'audio' | 'none'
type Playing = { track: string; volume: number; stop: () => void }

let backend: Backend = 'none'
let backendNote: string | undefined
let isDetected = false
let playing: Playing | undefined
let lastBeat = 0

/** Finds this machine's audio player, once: `paplay` with a PulseAudio server, else the engine's own on macOS. */
export async function detectAudio($: $): Promise<void> {
  if (isDetected) return
  isDetected = true
  let platform = ''
  try {
    platform = (await $.process.run(['uname', '-s'], { timeoutMs: 4000 })).stdout.trim()
  } catch {
    platform = ''
  }
  try {
    const info = await $.process.run(['pactl', 'info'], { timeoutMs: 4000 })
    const version = await $.process.run(['paplay', '--version'], { timeoutMs: 4000 })
    if (info.exitCode === 0 && version.exitCode === 0) {
      backend = 'paplay'
      backendNote = undefined
      return
    }
    backendNote = 'no PulseAudio server answered'
  } catch {
    backendNote = 'paplay is not installed'
  }
  if (platform === 'Darwin') {
    backend = 'audio'
    backendNote = undefined
    return
  }
  backend = 'none'
}

function startPaplay($: $, track: string, step: number): Playing {
  const path = `${$.plugin.root}/${track}`
  let stream: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined
  const state = { isStopped: false }
  const handle: Playing = {
    track,
    volume: step,
    stop: () => {
      state.isStopped = true
      void stream?.return(undefined as never)
    },
  }
  void (async () => {
    let failures = 0
    while (!state.isStopped) {
      const startedAt = await $.clock.now()
      // Each pass plays the track once at the volume the handle holds now; the loop repeats it.
      stream = $.process.spawn({
        argv: ['paplay', `--volume=${Math.round(65536 * volumeOf(handle.volume))}`, `--client-name=${MUSIC_CLIENT}`, '--stream-name=swarm-autopsy', path],
      })
      try {
        for await (const _piece of stream) {
          // paplay writes nothing while it plays; the loop is its life.
        }
      } catch (error) {
        backendNote = error instanceof Error ? error.message : String(error)
      }
      if (state.isStopped) break
      failures = (await $.clock.now()) - startedAt < 2000 ? failures + 1 : 0
      if (failures >= 3) {
        backendNote = `paplay could not play ${track}`
        backend = 'none'
        break
      }
    }
  })().catch(() => {
    // the chat or the module ended under the loop: nothing is left to play for
  })
  return handle
}

function startAudio($: $, track: string, step: number): Playing {
  const controller = new AbortController()
  void $.audio.play({ asset: track }, { shouldLoop: true, gain: volumeOf(step) * 1.4, signal: controller.signal }).catch(error => {
    backendNote = error instanceof Error ? error.message : String(error)
  })
  return { track, volume: step, stop: () => controller.abort() }
}

function startTrack($: $, track: string, step: number): Playing {
  return backend === 'paplay' ? startPaplay($, track, step) : startAudio($, track, step)
}

/** Moves the playing stream to `step` without restarting it; restarts it when that fails. */
async function changeVolume($: $, step: number): Promise<void> {
  if (!playing) return
  if (backend === 'paplay') {
    try {
      const listed = await $.process.run(['pactl', '-f', 'json', 'list', 'sink-inputs'], { timeoutMs: 4000 })
      const inputs = JSON.parse(listed.stdout) as { index: number; properties?: Record<string, string> }[]
      const ours = inputs.filter(input => input.properties?.['application.name'] === MUSIC_CLIENT)
      if (ours.length > 0) {
        for (const input of ours) {
          await $.process.run(['pactl', 'set-sink-input-volume', String(input.index), `${Math.round(volumeOf(step) * 100)}%`], { timeoutMs: 4000 })
        }
        playing.volume = step
        return
      }
    } catch {
      // fall through to a restart
    }
  }
  const track = playing.track
  playing.stop()
  playing = startTrack($, track, step)
}

function ensureStopped(): void {
  playing?.stop()
  playing = undefined
}

/**
 * One look at the store and the player: plays the scene's `track` here when this chat owns the music, stops it when
 * not, keeps the heartbeat. Resolves what the toolbar shows: the shared sound and where this chat stands.
 */
export async function musicTick($: $, me: string, track: string | undefined): Promise<{ sound: SoundValue; player: PlayerValue }> {
  const sound = cleanSound(await $.store.get(MUSIC_KEYS.sound))
  const owner = cleanOwner(await $.store.get(MUSIC_KEYS.owner))
  const now = await $.clock.now()
  const decision = decide({ me, now, sound, owner, hasTrack: track !== undefined, canPlay: backend !== 'none' })
  if (decision.owner === 'claim' || (decision.owner === 'beat' && now - lastBeat >= BEAT_MS)) {
    lastBeat = now
    await $.store.set(MUSIC_KEYS.owner, { session: me, beatAt: now })
  } else if (decision.owner === 'release') {
    await $.store.delete(MUSIC_KEYS.owner)
  }
  if (decision.playHere && track) {
    if (playing?.track !== track) {
      playing?.stop()
      playing = startTrack($, track, sound.volume)
    } else if (playing.volume !== sound.volume) {
      await changeVolume($, sound.volume)
    }
  } else {
    ensureStopped()
  }
  const note = decision.where === 'unavailable' ? (backendNote ?? 'no audio player on this machine') : undefined
  return { sound, player: note ? { where: decision.where, note } : { where: decision.where } }
}

/** Play or pause for every chat; the chat that pressed play takes the music. */
export async function toggleMusic($: $, me: string): Promise<void> {
  const sound = cleanSound(await $.store.get(MUSIC_KEYS.sound))
  const next = { ...sound, isPlaying: !sound.isPlaying }
  if (next.isPlaying) {
    lastBeat = await $.clock.now()
    await $.store.set(MUSIC_KEYS.owner, { session: me, beatAt: lastBeat })
  }
  await $.store.set(MUSIC_KEYS.sound, next)
}

/** The shared volume step, 1–5. */
export async function setMusicVolume($: $, step: number): Promise<void> {
  const sound = cleanSound(await $.store.get(MUSIC_KEYS.sound))
  await $.store.set(MUSIC_KEYS.sound, { ...sound, volume: Math.min(5, Math.max(1, Math.round(step))) })
}

/** The chat is closing: stop the music here and hand it on. */
export async function stopMusic($: $, me: string): Promise<void> {
  ensureStopped()
  const owner = cleanOwner(await $.store.get(MUSIC_KEYS.owner))
  if (owner?.session === me) await $.store.delete(MUSIC_KEYS.owner)
}
