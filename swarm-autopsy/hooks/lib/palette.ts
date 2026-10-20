// Colour roles and tokens as code. Pure. Text keeps theme keys, which follow
// the person's light, dark and daltonized themes. Hex is used for chrome
// accents, data hues, identity and glass: every 6-digit hex here is a mid-tone
// legible on both the dark and the light dock, and translucent (8-digit) hex is
// for the desktop only (`GLASS`).

import type { AgentRecord, AgentState, SpendBucket, TokenCounts } from '../../types'
import { activeTheme } from './themes'

/** The active scene's meaning colours, or undefined in classic (the terminal), which keeps theme keys. */
const data = () => activeTheme().data

/**
 * Colour roles by meaning: one meaning each. Every role follows the active theme: on the desktop each scene gives
 * each meaning its own tuned colour (themes.ts `dataOfScene`: green still means verified, red a failure); classic, and
 * so the terminal, keeps the surface's theme keys exactly as before.
 */
export const ROLE = {
  /** Chrome: the title mark, section markers, the selected marker. The theme's brand colour. */
  get accent(): string {
    return activeTheme().chrome.accent
  },
  /** Secondary chrome (sub-headings, the Health mark). Never data. */
  get rose(): string {
    return activeTheme().chrome.rose
  },
  /** Secondary chrome. Never data. */
  get violet(): string {
    return activeTheme().chrome.violet
  },
  /** Chrome: section, panel and tile titles. Undefined keeps the surface's own text colour (classic, the terminal). */
  get heading(): string | undefined {
    return activeTheme().chrome.heading
  },
  /** Plain text that still carries a label (OBSERVED): the scene's ink, or the surface's own text colour in classic. */
  get text(): string {
    return data()?.ink ?? 'text'
  },
  /** Context gauges (fill, ring, sparkline), the active state and the live dot: the scene's own light. */
  get context(): string {
    return data()?.context ?? '#38b4d8'
  },
  /** Verified, passed. Never "completed" or LINKED. */
  get ok(): string {
    return data()?.ok ?? 'success'
  },
  /** A confirmed failure. */
  get fail(): string {
    return data()?.fail ?? 'error'
  },
  /** An estimate, an uncertainty, something noteworthy. */
  get caution(): string {
    return data()?.caution ?? 'warning'
  },
  /** An analytical link (LINKED). */
  get link(): string {
    return data()?.link ?? 'suggestion'
  },
  /** Secondary analytical information. */
  get analytic(): string {
    return data()?.analytic ?? 'merged'
  },
  /** The coordinating session (the main loop). */
  get main(): string {
    return data()?.main ?? 'claude'
  },
  /** Secondary text; completed, unknown, not available. */
  get muted(): string {
    return data()?.muted ?? 'inactive'
  },
  /** UI state and housekeeping: held, paused, coverage notes. Never a finding. */
  get neutral(): string {
    return activeTheme().chrome.neutral
  },
  /** The fill of unresolved and no-usage shares: quiet, never the loudest colour. */
  get unknownFill(): string {
    return data()?.unknownFill ?? '#7d7591'
  },
}

/** Agent identity hues in classic: mid-tones away from the status hues, ordered so neighbours differ. */
export const IDENTITY_HEX: readonly string[] = ['#0891b2', '#8b5cf6', '#db2777', '#2563eb', '#c026d3', '#0284c7', '#7c3aed', '#4f46e5']

/** The identity hues the active theme draws with. */
export const identityPalette = (): readonly string[] => data()?.identity ?? IDENTITY_HEX

/** The letter on an identity chip: white on classic's deep chips, the scene's base on its lighter ones. */
export const chipTextHex = (): string => data()?.chipText ?? '#ffffff'

/** A letter label (A … Z, AA …) as its ordinal: A = 1. Anything else is 0. */
export function labelOrdinal(label: string): number {
  if (!/^[A-Z]+$/.test(label)) return 0
  let n = 0
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/** An agent's identity hue in the active theme; the main loop has none (it is drawn with ROLE.main). */
export function identityHex(agent: Pick<AgentRecord, 'label' | 'isMain'> | undefined): string | undefined {
  if (!agent || agent.isMain) return undefined
  const ordinal = labelOrdinal(agent.label)
  if (ordinal === 0) return undefined
  const hues = identityPalette()
  return hues[(ordinal - 1) % hues.length]
}

export type TokenCategory = keyof TokenCounts

const TOKEN_HEX = { input: '#6f9cf0', cacheRead: '#3f6fd1', cacheWrite: '#a17ee8', output: '#e879a6' } as const

/** A token category's hex in the active theme. */
const tokenHex = (key: TokenCategory): string => data()?.tokens[key] ?? TOKEN_HEX[key]

const category = (key: TokenCategory, short: string, name: string) => ({
  key,
  short,
  name,
  get role(): string {
    return tokenHex(key)
  },
  get hex(): string {
    return tokenHex(key)
  },
})

/**
 * The four token categories in drawing order, each with its short and long name and its hex in the active theme.
 * The colour is hex on every surface, so the categories stay apart on desktop, where several theme keys share one.
 */
export const TOKEN_CATEGORIES: ReadonlyArray<{ readonly key: TokenCategory; readonly short: string; readonly name: string; readonly role: string; readonly hex: string }> = [
  category('input', 'in', 'input'),
  category('cacheRead', 'cache read', 'cache read'),
  category('cacheWrite', 'cache write', 'cache write'),
  category('output', 'out', 'output'),
]

/** Outcome bucket colours by role, in the active theme. */
export const BUCKET_ROLE: Readonly<Record<SpendBucket['bucket'], string>> = {
  get coordinator() {
    return ROLE.main
  },
  get verified() {
    return ROLE.ok
  },
  get 'changed-unverified'() {
    return ROLE.caution
  },
  get 'failed-or-inconclusive'() {
    return ROLE.fail
  },
  get 'report-only'() {
    return ROLE.link
  },
  get mixed() {
    return ROLE.analytic
  },
  get unresolved() {
    return ROLE.unknownFill
  },
  get 'no-usage-recorded'() {
    return ROLE.unknownFill
  },
}

/** Agent state colours by role, in the active theme. */
export const STATE_ROLE: Readonly<Record<AgentState, string>> = {
  get active() {
    return ROLE.context
  },
  get completed() {
    return ROLE.muted
  },
  get failed() {
    return ROLE.fail
  },
  get stopped() {
    return ROLE.caution
  },
  get unknown() {
    return ROLE.muted
  },
}

/**
 * Glass for the desktop: the active theme's translucent fills, edges, hover lift and bar track, and the pane's
 * own tint. Never on the terminal, which paints alpha hex as opaque slabs; `glass()` in the kit is the main reader.
 */
export const GLASS = {
  get fill(): string {
    return activeTheme().glass.fill
  },
  get raised(): string {
    return activeTheme().glass.raised
  },
  get sunken(): string {
    return activeTheme().glass.sunken
  },
  get edge(): string {
    return activeTheme().glass.edge
  },
  get edgeStrong(): string {
    return activeTheme().glass.edgeStrong
  },
  get hoverFill(): string {
    return activeTheme().glass.hoverFill
  },
  get hoverEdge(): string {
    return activeTheme().glass.hoverEdge
  },
  get track(): string {
    return activeTheme().glass.track
  },
  /** The pane's own background under the backdrop. */
  get tint(): string {
    return activeTheme().tint
  },
}

/** A 6-digit hex with an alpha suffix (two hex digits), for desktop edge tints. Anything else is returned as it is. */
export function withAlpha(hex: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) && /^[0-9a-f]{2}$/i.test(alpha) ? `${hex}${alpha}` : hex
}

/**
 * Hex for Svg, which cannot use theme keys: every entry follows the active theme (a scene's own colours on the desktop),
 * and classic keeps the mid-tones legible on dark and light backgrounds.
 */
export const SVG_HEX = {
  get accent(): string {
    return activeTheme().chrome.accentHex
  },
  get context(): string {
    return data()?.context ?? '#38b4d8'
  },
  get contextDeep(): string {
    return data()?.contextDeep ?? '#3f6fd1'
  },
  get rose(): string {
    return data() ? activeTheme().chrome.rose : '#e2729a'
  },
  get violet(): string {
    return data() ? activeTheme().chrome.violet : '#a48bea'
  },
  get neutral(): string {
    return data() ? activeTheme().chrome.neutral : '#a79fc0'
  },
  get unknownFill(): string {
    return data()?.unknownFill ?? '#7d7591'
  },
  get ok(): string {
    return data()?.ok ?? '#3fae5a'
  },
  get fail(): string {
    return data()?.fail ?? '#e5534b'
  },
  get caution(): string {
    return data()?.caution ?? '#d4a72c'
  },
  get link(): string {
    return data()?.link ?? '#8f9cf5'
  },
  get analytic(): string {
    return data()?.analytic ?? '#af87ff'
  },
  get main(): string {
    return data()?.main ?? '#d77757'
  },
  get muted(): string {
    return data()?.muted ?? '#8b949e'
  },
  get track(): string {
    return data()?.track ?? '#8b949e'
  },
}
