// Pane themes: the chrome a theme may change, as data. Every scene of lib/scenes.ts is
// a theme: its palette recolours the pane's own surfaces (its solid background, the glass of
// every panel and pill, edges, hover, bar tracks) and its chrome (the brand and section marks,
// secondary marks, housekeeping text, headings). A theme never touches a colour that carries
// meaning: status (verified, failure, estimate), token categories, agent identity, buckets
// and context stay in palette.ts and read the same in every theme.
//
// The active theme is set by the render hook for one drawing (`applyTheme`) and read through
// palette.ts's GLASS and ROLE, so a view needs no theme argument. The terminal always draws the
// classic theme: it paints no translucency and no scene.

import { fromLch, harmonize, toLch, type Harmony } from './color.ts'
import { DEFAULT_MOOD, SCENES, currentScene, type Palette, type Scene, type SceneId } from './scenes.ts'

/** A theme's id: a scene's, or `classic` (the terminal's). */
export type ThemeId = 'classic' | SceneId

export type ThemeTokens = {
  id: ThemeId
  /** The name the picker shows. */
  name: string
  /** The pane's own background (desktop): solid, the colour the scene fades into. */
  tint: string
  /** Glass: panel fills by tone, edges, the hover lift, bar tracks. Translucent 8-digit hex (desktop only). */
  glass: {
    fill: string
    raised: string
    sunken: string
    edge: string
    edgeStrong: string
    hoverFill: string
    hoverEdge: string
    track: string
    /**
     * The edge of the capsule a selected tab or chip sits in (desktop). Undefined keeps the app's primary Button for the
     * selection (classic, and so the terminal).
     */
    selected?: string
  }
  /** Chrome: never data. */
  chrome: {
    /** The brand mark, section markers, the selected marker. */
    accent: string
    /** The accent as 6-digit hex, for Svg (which takes no theme keys): the Trail map's selection and accent stages. */
    accentHex: string
    /** Secondary marks (sub-headings, the Health mark). */
    rose: string
    /** Secondary marks. */
    violet: string
    /** Housekeeping text: held, paused, coverage notes. */
    neutral: string
    /** Section and panel headings; undefined keeps the theme's own text colour. */
    heading?: string
    /** The sub-heading mark (a glyph, drawn in `rose`). */
    subMark: string
  }
  /**
   * Every colour that carries meaning, in this scene's own harmony (6-digit hex, for text and Svg alike). Absent in
   * classic, which keeps the surface's theme keys (the terminal's colours, its light and daltonized themes).
   */
  data?: DataPalette
}

/** The meaning colours of one theme: each meaning keeps its recognisable hue family, tuned to the scene. */
export type DataPalette = {
  /** The context gauges: the scene's own light (the lantern, the moon, the clock face). */
  context: string
  contextDeep: string
  ok: string
  fail: string
  caution: string
  link: string
  analytic: string
  /** Plain text that still carries a label (OBSERVED): the scene's ink. */
  ink: string
  /** The coordinating session: the scene's ink, faintly tinted. */
  main: string
  muted: string
  unknownFill: string
  track: string
  /** Token categories in drawing order: input, cache read, cache write, output. */
  tokens: { input: string; cacheRead: string; cacheWrite: string; output: string }
  /** Agent identity hues, evenly spaced around the scene's hue at one lightness band. */
  identity: readonly string[]
  /** The letter on an identity chip: the scene's base, dark on the light chips. */
  chipText: string
}

export const CLASSIC: ThemeTokens = {
  id: 'classic',
  name: 'Classic',
  tint: '#0b0c10b3',
  glass: {
    fill: '#ffffff0d',
    raised: '#ffffff14',
    sunken: '#0000001f',
    edge: '#9ba1b04d',
    edgeStrong: '#c5cad680',
    hoverFill: '#ffffff1c',
    hoverEdge: '#f0a07a99',
    track: '#8e94a333',
  },
  chrome: { accent: 'claude', accentHex: '#d77757', rose: '#e2729a', violet: '#a48bea', neutral: '#a79fc0', subMark: '·' },
}

const channels = (hex: string): [number, number, number] => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]

/** `a` moved `t` (0–1) of the way to `b`, both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  const at = (x: number, y: number): string =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${at(ar, br)}${at(ag, bg)}${at(ab, bb)}`
}

/**
 * How each scene bends its meaning colours (color.ts `harmonize`): its key hue and how far colours lean to it, how
 * saturated its world is, and the OKLCH hues it gives the status meanings so none sits on its own light.
 */
type DataSpec = {
  harmony: Harmony
  /** The context colour: the light of the scene's gauge. */
  context: (p: Palette) => string
  hues: { ok: number; fail: number; caution: number; link: number; analytic: number }
}

const DATA_SPECS: Readonly<Record<SceneId, DataSpec>> = {
  // Lantern amber in grey fog: rust for caution (away from the lantern), crimson failure, moss for verified.
  'fogbound-cemetery': { harmony: { hue: 82, pull: 0.14, chroma: 0.72, maxChroma: 0.12 }, context: p => p.accent, hues: { ok: 150, fail: 18, caution: 34, link: 252, analytic: 305 } },
  // The beam's pale ice in sea mist: warm amber caution stands apart from the cool world.
  'drowned-lighthouse': { harmony: { hue: 228, pull: 0.16, chroma: 0.68, maxChroma: 0.11 }, context: p => p.accent, hues: { ok: 158, fail: 20, caution: 72, link: 245, analytic: 332 } },
  // Candle orange in old wood: straw-yellow caution, wine failure, olive verified.
  'hollow-library': { harmony: { hue: 64, pull: 0.16, chroma: 0.7, maxChroma: 0.12 }, context: p => p.accent, hues: { ok: 152, fail: 15, caution: 106, link: 250, analytic: 300 } },
  // Moon bone at midnight: amber caution under it, ember failure like the lit window.
  'crooked-manor': { harmony: { hue: 95, pull: 0.12, chroma: 0.7, maxChroma: 0.12 }, context: p => p.accent, hues: { ok: 152, fail: 24, caution: 62, link: 262, analytic: 310 } },
  // The clock face's gold is the gauge; verdigris stays chrome. Rust caution, crimson failure, sage verified.
  clocktower: { harmony: { hue: 85, pull: 0.12, chroma: 0.72, maxChroma: 0.12 }, context: p => p.accent2, hues: { ok: 150, fail: 18, caution: 40, link: 248, analytic: 305 } },
  // Wisp chartreuse over black water: verified turns sea-green, away from the wisps.
  'mire-lights': { harmony: { hue: 126, pull: 0.16, chroma: 0.74, maxChroma: 0.12 }, context: p => p.accent, hues: { ok: 172, fail: 20, caution: 70, link: 255, analytic: 312 } },
  // Cozy scenes are warmer and a little richer (more chroma): their worlds are lamplit, not fogged.
  // Honey lamplight against blue rain: terracotta caution, berry failure, sage verified, the rain's blue for links.
  'cat-cafe': { harmony: { hue: 70, pull: 0.14, chroma: 0.8, maxChroma: 0.13 }, context: p => p.accent, hues: { ok: 150, fail: 16, caution: 36, link: 235, analytic: 315 } },
  // Firelight orange: straw-yellow caution (above the flames), wine failure, the sage of the teacup for verified.
  'fireside-tea': { harmony: { hue: 55, pull: 0.14, chroma: 0.8, maxChroma: 0.13 }, context: p => p.accent, hues: { ok: 148, fail: 12, caution: 100, link: 240, analytic: 310 } },
  // The low sun's gold: rust caution, brick failure, meadow green verified, evening blue links.
  'golden-porch': { harmony: { hue: 78, pull: 0.14, chroma: 0.82, maxChroma: 0.13 }, context: p => p.accent, hues: { ok: 145, fail: 18, caution: 38, link: 245, analytic: 312 } },
  // Coral sunset over teal water: amber caution, crimson failure, sea-green verified.
  'sunset-pier': { harmony: { hue: 40, pull: 0.12, chroma: 0.8, maxChroma: 0.13 }, context: p => p.accent, hues: { ok: 165, fail: 14, caution: 84, link: 232, analytic: 300 } },
  // Rose petals at blue hour: vermilion failure stays apart from the rose by weight and chroma, leaf-green verified.
  'flower-shop': { harmony: { hue: 5, pull: 0.1, chroma: 0.8, maxChroma: 0.13 }, context: p => p.accent, hues: { ok: 140, fail: 30, caution: 78, link: 245, analytic: 290 } },
  // Window amber in a green rain: rust caution, brick failure, a cooler teal-green for verified (away from the moss).
  'forest-cabin': { harmony: { hue: 75, pull: 0.14, chroma: 0.78, maxChroma: 0.13 }, context: p => p.accent, hues: { ok: 162, fail: 18, caution: 38, link: 240, analytic: 310 } },
}

/** A scene's meaning colours (DataPalette), derived from its spec. */
export function dataOfScene(scene: Scene): DataPalette {
  const p = scene.palette
  const spec = DATA_SPECS[scene.id]
  const { harmony, hues } = spec
  const text = (hue: number) => harmonize(hue, harmony, 0.8, 0.14)
  const context = spec.context(p)
  const ctx = toLch(context)
  const ink = toLch(p.ink)
  const identity = Array.from({ length: 8 }, (_, i) => {
    const hue = (harmony.hue + 25 + i * 135) % 360 // 135° steps: neighbours in spawn order sit far apart on the wheel
    return harmonize(hue, { ...harmony, pull: 0 }, i % 2 === 0 ? 0.76 : 0.68, 0.15)
  })
  return {
    context,
    contextDeep: fromLch({ l: Math.max(0.42, ctx.l - 0.24), c: ctx.c * 0.9, h: ctx.h }),
    ok: text(hues.ok),
    fail: harmonize(hues.fail, harmony, 0.7, 0.17),
    caution: harmonize(hues.caution, harmony, 0.78, 0.16),
    link: text(hues.link),
    analytic: text(hues.analytic),
    // The coordinator: near the scene's ink, faintly tinted with the complement of its light, so it never reads as the
    // context gauge (a cool scene's coordinator is faintly warm, a warm scene's faintly cool).
    main: fromLch({ l: 0.86, c: Math.min(0.04, ink.c + 0.025), h: (harmony.hue + 180) % 360 }),
    ink: p.ink,
    muted: p.muted,
    unknownFill: fromLch({ l: 0.52, c: 0.02, h: harmony.hue }),
    // Chart tracks (a ring's circle, a sparkline's floor) are drawn faint over glass: the muted tone, not the base.
    track: p.muted,
    tokens: {
      input: harmonize(245, harmony, 0.74, 0.13),
      cacheRead: harmonize(255, harmony, 0.56, 0.12),
      cacheWrite: harmonize(305, harmony, 0.7, 0.13),
      output: harmonize(15, harmony, 0.74, 0.13),
    },
    identity,
    chipText: p.base,
  }
}

/** A scene's palette as a whole pane theme. */
export function themeOfScene(scene: Scene): ThemeTokens {
  const p: Palette = scene.palette
  return {
    id: scene.id,
    name: scene.title,
    tint: p.base,
    glass: {
      fill: `${p.surface}d9`,
      raised: `${mix(p.surface, p.ink, 0.05)}f0`,
      sunken: `${mix(p.base, '#000000', 0.3)}cc`,
      edge: `${p.muted}6b`,
      edgeStrong: `${p.muted}80`,
      hoverFill: `${p.accent}1a`,
      hoverEdge: `${p.accent}b3`,
      track: `${p.track}`,
      selected: `${p.accent}cc`,
    },
    chrome: {
      accent: p.accent,
      accentHex: p.accent,
      rose: p.accent2,
      violet: mix(p.accent2, p.muted, 0.4),
      neutral: p.muted,
      heading: p.ink,
      subMark: '▎',
    },
    data: dataOfScene(scene),
  }
}

export const THEMES: Readonly<Record<SceneId, ThemeTokens>> = Object.fromEntries(
  Object.values(SCENES).map(scene => [scene.id, themeOfScene(scene)]),
) as Record<SceneId, ThemeTokens>

/** The theme the desktop draws until the person picks a scene. */
export const DEFAULT_THEME: SceneId = currentScene(DEFAULT_MOOD).id

/** The theme a drawing on `surface` uses: the terminal is always classic; anything unknown falls back to the default. */
export function themeFor(surface: string, chosen?: string): ThemeTokens {
  if (surface === 'terminal') return CLASSIC
  return THEMES[(chosen ?? DEFAULT_THEME) as SceneId] ?? THEMES[DEFAULT_THEME]
}

let active: ThemeTokens = THEMES[DEFAULT_THEME]

/** Sets the theme the next drawing reads; the render hook calls it once, before the views draw. */
export function applyTheme(theme: ThemeTokens): void {
  active = theme
}

/** The theme the drawing in progress uses. */
export function activeTheme(): ThemeTokens {
  return active
}
