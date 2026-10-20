// Who plays the music. Play/pause and volume live in the shared store so every chat agrees; only the chat named as
// owner plays, and only a chat whose pane is open takes part. The owner keeps a heartbeat; when it stops (the chat
// closed, its pane closed or it went quiet) another chat with its pane open claims the music and, once its claim
// stands on the next tick, starts playing. Pure: the caller does what the decision says.

import type { PlayerValue, SoundValue } from '../../types'

export type Owner = { session: string; beatAt: number }

/** How often the owner renews its claim. */
export const BEAT_MS = 3000
/** An owner silent this long has gone quiet; another chat may take over. */
export const STALE_MS = 10_000

export const DEFAULT_SOUND: SoundValue = { isPlaying: false, volume: 2 }

/** Linear PulseAudio volume (100% = 1) for each volume step 1–5: quiet by design. */
export const VOLUME_STEPS = [0.14, 0.24, 0.36, 0.52, 0.72] as const

export const volumeOf = (step: number): number => VOLUME_STEPS[Math.min(4, Math.max(0, Math.round(step) - 1))] ?? 0.24

export function cleanSound(value: unknown): SoundValue {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<SoundValue>
  const volume = typeof raw.volume === 'number' && raw.volume >= 1 && raw.volume <= 5 ? Math.round(raw.volume) : DEFAULT_SOUND.volume
  return { isPlaying: raw.isPlaying === true, volume }
}

export function cleanOwner(value: unknown): Owner | undefined {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<Owner>
  return typeof raw.session === 'string' && typeof raw.beatAt === 'number' ? { session: raw.session, beatAt: raw.beatAt } : undefined
}

export type MusicFacts = {
  me: string
  now: number
  sound: SoundValue
  owner: Owner | undefined
  /** The current scene has a track. */
  hasTrack: boolean
  /** This machine can play audio at all. */
  canPlay: boolean
  /** This chat's pane is open: a chat without it (a `-p` run, a chat that never opened it) never plays. */
  isListening: boolean
}

export type MusicDecision = {
  /** Whether this chat's player should be running. */
  playHere: boolean
  /** What to do with the owner record. */
  owner: 'beat' | 'claim' | 'release' | 'none'
  where: PlayerValue['where']
}

export function decide(f: MusicFacts): MusicDecision {
  const isMine = f.owner?.session === f.me
  const isFresh = f.owner !== undefined && f.now - f.owner.beatAt < STALE_MS
  if (!f.sound.isPlaying || !f.isListening) return { playHere: false, owner: isMine ? 'release' : 'none', where: 'paused' }
  if (!f.canPlay) return { playHere: false, owner: isMine ? 'release' : 'none', where: isFresh && !isMine ? 'elsewhere' : 'unavailable' }
  if (isMine) return { playHere: f.hasTrack, owner: 'beat', where: f.hasTrack ? 'here' : 'silent' }
  if (isFresh) return { playHere: false, owner: 'none', where: f.hasTrack ? 'elsewhere' : 'silent' }
  // Nobody holds the music: claim it now, play once the claim still stands next tick.
  return { playHere: false, owner: 'claim', where: f.hasTrack ? 'elsewhere' : 'silent' }
}
