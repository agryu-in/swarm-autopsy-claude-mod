// The art kit every scene of Swarm Autopsy is made with (ported from the meadow mod):
// seeded randomness, unique ids, gradients, the looping effects (stars, rain, fog, clouds,
// motes, flicker) and the spooky pieces (bats, crows, bare trees, headstones, wisps).
// Pure: strings in, strings out; no script and no external reference in any output.
//
// Animation rules shared by every drawing:
//   - every loop starts at once: `begin` is negative, so a scene is mid-motion on load;
//   - randomness is seeded by the drawing's name, so a scene looks the same every time;
//   - every gradient, filter and clip id carries the drawing's `uid` prefix.

import type { Palette } from '../lib/scenes.ts'

/** Escapes text for use inside SVG markup. */
export const esc = (text: string): string =>
  text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** A number written short: at most two decimals, no trailing zeros. */
export const n = (value: number): string => String(Math.round(value * 100) / 100)

export const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))

/** A seeded random source in [0, 1): mulberry32 over a string hash. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A value in [lo, hi) from `r`. */
export const between = (r: () => number, lo: number, hi: number): number => lo + r() * (hi - lo)

/** A whole SVG document; `width`/`height` are its size, `viewBox` its user space. */
export function svgDoc(args: {
  width: number
  height: number
  viewBox?: string
  preserve?: string
  defs?: string
  body: string
}): string {
  const viewBox = args.viewBox ?? `0 0 ${n(args.width)} ${n(args.height)}`
  const preserve = args.preserve ? ` preserveAspectRatio="${args.preserve}"` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(args.width)}" height="${n(args.height)}" viewBox="${viewBox}"${preserve}>` +
    (args.defs ? `<defs>${args.defs}</defs>` : '') +
    args.body +
    '</svg>'
  )
}

export type Stop = readonly [offset: number, color: string, opacity?: number]

const stopsOf = (stops: readonly Stop[]): string =>
  stops
    .map(([offset, color, opacity]) => `<stop offset="${n(offset)}" stop-color="${color}"${opacity === undefined ? '' : ` stop-opacity="${n(opacity)}"`}/>`)
    .join('')

/** A vertical gradient in user space from y1 to y2 (padded beyond both ends). */
export const linearY = (id: string, y1: number, y2: number, stops: readonly Stop[]): string =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(y1)}" x2="0" y2="${n(y2)}">${stopsOf(stops)}</linearGradient>`

/** A horizontal gradient in user space from x1 to x2. */
export const linearX = (id: string, x1: number, x2: number, stops: readonly Stop[]): string =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="0" x2="${n(x2)}" y2="0">${stopsOf(stops)}</linearGradient>`

/** A gradient along the object's own box (0..1), top to bottom. */
export const linearBox = (id: string, stops: readonly Stop[]): string =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stopsOf(stops)}</linearGradient>`

/** A radial glow in the object's own box. */
export const radialBox = (id: string, stops: readonly Stop[]): string =>
  `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stopsOf(stops)}</radialGradient>`

/** A gaussian blur filter. */
export const blur = (id: string, std: number): string =>
  `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(std)}"/></filter>`

/** A looping `<animate>`; `begin` is made negative so the loop is already running. */
export const loop = (attr: string, values: string, dur: number, begin = 0, extra = ''): string =>
  `<animate attributeName="${attr}" values="${values}" dur="${n(dur)}s" begin="${n(-Math.abs(begin))}s" repeatCount="indefinite"${extra}/>`

/** A looping translate; `values` like `"0 0;12 -3;0 0"`. */
export const drift = (values: string, dur: number, begin = 0, extra = ''): string =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${n(dur)}s" begin="${n(-Math.abs(begin))}s" repeatCount="indefinite"${extra}/>`

/** A looping rotation about (cx, cy); `from`/`to` in degrees. */
export const spin = (cx: number, cy: number, from: number, to: number, dur: number, begin = 0): string =>
  `<animateTransform attributeName="transform" type="rotate" values="${n(from)} ${n(cx)} ${n(cy)};${n(to)} ${n(cx)} ${n(cy)}" dur="${n(dur)}s" begin="${n(-Math.abs(begin))}s" repeatCount="indefinite"/>`

/** A gentle sway about (cx, cy) between -deg and +deg. */
export const sway = (cx: number, cy: number, deg: number, dur: number, begin = 0): string =>
  `<animateTransform attributeName="transform" type="rotate" values="${n(-deg)} ${n(cx)} ${n(cy)};${n(deg)} ${n(cx)} ${n(cy)};${n(-deg)} ${n(cx)} ${n(cy)}" dur="${n(dur)}s" begin="${n(-Math.abs(begin))}s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>`

/** An opacity flicker for windows, candles and lanterns: soft, irregular, never off. */
export function flicker(r: () => number, lo = 0.75, hi = 1): string {
  const steps = Array.from({ length: 7 }, () => n(between(r, lo, hi))).join(';')
  return loop('opacity', `${steps};${steps.split(';')[0]}`, between(r, 2.5, 5), between(r, 0, 5))
}

export type Area = { x0: number; y0: number; x1: number; y1: number }

/** Twinkling stars over `area`. */
export function stars(r: () => number, area: Area, count: number, color: string, size: [number, number] = [0.5, 1.4]): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = between(r, area.x0, area.x1)
    const y = between(r, area.y0, area.y1)
    const radius = between(r, size[0], size[1])
    const lo = between(r, 0.15, 0.45)
    const hi = between(r, 0.7, 1)
    const dur = between(r, 2.4, 6)
    out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="${color}" opacity="${n(hi)}">${loop('opacity', `${n(hi)};${n(lo)};${n(hi)}`, dur, between(r, 0, dur))}</circle>`
  }
  return out
}

/** Snow falling through `area` (flakes wrap from the top again). */
export function snowfall(r: () => number, area: Area, count: number, color: string, size: [number, number] = [0.8, 2.2]): string {
  let out = ''
  const fall = area.y1 - area.y0
  for (let i = 0; i < count; i++) {
    const x = between(r, area.x0, area.x1)
    const radius = between(r, size[0], size[1])
    const dur = between(r, 9, 18) * (1.6 - radius / size[1] / 2)
    const sideways = between(r, -14, 14)
    const opacity = between(r, 0.55, 0.95)
    out +=
      `<circle cx="${n(x)}" cy="${n(area.y0)}" r="${n(radius)}" fill="${color}" opacity="${n(opacity)}">` +
      drift(`0 0;${n(sideways / 2)} ${n(fall / 2)};${n(sideways)} ${n(fall)}`, dur, between(r, 0, dur)) +
      '</circle>'
  }
  return out
}

/** Rain streaks falling through `area`, slanted by `slant` px per fall. */
export function rainfall(r: () => number, area: Area, count: number, color: string, slant = -6): string {
  let out = ''
  const fall = area.y1 - area.y0
  for (let i = 0; i < count; i++) {
    const x = between(r, area.x0, area.x1)
    const len = between(r, 6, 13)
    const dur = between(r, 0.7, 1.3)
    const opacity = between(r, 0.25, 0.6)
    out +=
      `<line x1="${n(x)}" y1="${n(area.y0 - len)}" x2="${n(x + slant * (len / 12))}" y2="${n(area.y0)}" stroke="${color}" stroke-width="0.9" stroke-linecap="round" opacity="${n(opacity)}">` +
      drift(`0 0;${n(slant * (fall / 12) * 0.15)} ${n(fall + len)}`, dur, between(r, 0, dur)) +
      '</line>'
  }
  return out
}

/** Expanding ripple rings on water or a puddle at the given points. */
export function ripples(r: () => number, points: readonly (readonly [number, number])[], color: string, maxR = 7): string {
  return points
    .map(([x, y]) => {
      const dur = between(r, 1.4, 2.6)
      const begin = between(r, 0, dur)
      return (
        `<ellipse cx="${n(x)}" cy="${n(y)}" rx="0" ry="0" fill="none" stroke="${color}" stroke-width="0.7">` +
        loop('rx', `0;${n(maxR)}`, dur, begin) +
        loop('ry', `0;${n(maxR * 0.3)}`, dur, begin) +
        loop('opacity', '0.8;0', dur, begin) +
        '</ellipse>'
      )
    })
    .join('')
}

/** One soft cloud: overlapping ellipses, drifting by `distance` over `dur` seconds. */
export function cloud(args: {
  x: number
  y: number
  scale: number
  color: string
  shade?: string
  opacity?: number
  distance?: number
  dur?: number
  begin?: number
}): string {
  const s = args.scale
  const puffs: [number, number, number, number][] = [
    [0, 0, 30, 13],
    [-24, 4, 20, 10],
    [24, 4, 22, 10],
    [-8, -9, 18, 12],
    [12, -7, 16, 11],
  ]
  const shade = args.shade
    ? `<ellipse cx="${n(args.x)}" cy="${n(args.y + 9 * s)}" rx="${n(44 * s)}" ry="${n(6 * s)}" fill="${args.shade}" opacity="0.5"/>`
    : ''
  const body = puffs
    .map(([dx, dy, rx, ry]) => `<ellipse cx="${n(args.x + dx * s)}" cy="${n(args.y + dy * s)}" rx="${n(rx * s)}" ry="${n(ry * s)}" fill="${args.color}"/>`)
    .join('')
  const motion = args.distance ? drift(`0 0;${n(args.distance)} 0;0 0`, args.dur ?? 90, args.begin ?? 0) : ''
  return `<g opacity="${n(args.opacity ?? 0.95)}">${shade}${body}${motion}</g>`
}

/** A drifting fog band: a few wide blurred ellipses sliding sideways. */
export function fog(args: { uid: string; y: number; width: number; color: string; opacity: number; dur?: number; begin?: number; x0?: number }): string {
  const x0 = args.x0 ?? -40
  const ellipses = [0, 0.33, 0.66]
    .map((at, i) => `<ellipse cx="${n(x0 + at * args.width)}" cy="${n(args.y + (i % 2) * 6)}" rx="${n(args.width * 0.32)}" ry="12" fill="${args.color}"/>`)
    .join('')
  return (
    `<g filter="url(#${args.uid}-fogblur)" opacity="${n(args.opacity)}">${ellipses}` +
    drift(`0 0;${n(args.width * 0.18)} 0;0 0`, args.dur ?? 40, args.begin ?? 0) +
    '</g>'
  )
}

/** The blur filter `fog` needs, once per drawing. */
export const fogDefs = (uid: string): string => blur(`${uid}-fogblur`, 7)

/** Floating motes, fireflies or embers rising slowly and pulsing. */
export function motes(r: () => number, area: Area, count: number, color: string, rise = 30, glowId?: string): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = between(r, area.x0, area.x1)
    const y = between(r, area.y0, area.y1)
    const radius = between(r, 0.7, 1.8)
    const dur = between(r, 6, 12)
    const dx = between(r, -10, 10)
    const begin = between(r, 0, dur)
    const filter = glowId ? ` filter="url(#${glowId})"` : ''
    out +=
      `<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="${color}"${filter}>` +
      drift(`0 0;${n(dx)} ${n(-rise / 2)};${n(-dx / 2)} ${n(-rise)}`, dur, begin) +
      loop('opacity', '0;0.95;0.6;0', dur, begin) +
      '</circle>'
  }
  return out
}

/** A rolling hill band from x0 to x1 whose ridge waves around `y`; filled down to `bottom`. */
export function hills(r: () => number, args: { x0: number; x1: number; y: number; amp: number; bottom: number; fill: string; bumps?: number }): string {
  const bumps = args.bumps ?? 5
  const step = (args.x1 - args.x0) / bumps
  let d = `M${n(args.x0)} ${n(args.bottom)} L${n(args.x0)} ${n(args.y)}`
  for (let i = 0; i < bumps; i++) {
    const xa = args.x0 + step * i
    const peak = args.y - between(r, args.amp * 0.4, args.amp)
    const end = args.y + between(r, -args.amp * 0.25, args.amp * 0.25)
    d += ` Q${n(xa + step / 2)} ${n(peak)} ${n(xa + step)} ${n(end)}`
  }
  d += ` L${n(args.x1)} ${n(args.bottom)} Z`
  return `<path d="${d}" fill="${args.fill}"/>`
}

// ── The scene canvas ─────────────────────────────────────────────────────────────────────

/** The scene canvas, in user units: art is drawn for this box. */
export const SCENE_W = 340
export const SCENE_H = 380
/** Below this the drawing fades into the pane's base colour. */
export const FADE_FROM = 300
/** Above this only sky: the title and motto sit here. */
export const TITLE_ZONE = 84
/** How far background layers reach past the canvas, so a wide pane shows more scenery. */
export const BLEED = 320

/** The sky behind everything, padded far past the canvas in every direction. */
export function skyBackdrop(uid: string, palette: Palette): { defs: string; body: string } {
  const [top, middle, horizon] = palette.sky
  return {
    defs: linearY(`${uid}-sky`, 0, 300, [
      [0, top],
      [0.55, middle],
      [1, horizon],
    ]),
    body: `<rect x="${-BLEED}" y="${-BLEED * 2}" width="${SCENE_W + BLEED * 2}" height="${SCENE_H + BLEED * 4}" fill="url(#${uid}-sky)"/>`,
  }
}

/** The fade into the panel's base colour at the bottom, padded below and to the sides. */
export function fadeToBase(uid: string, palette: Palette): { defs: string; body: string } {
  return {
    defs: linearY(`${uid}-fade`, FADE_FROM, SCENE_H, [
      [0, palette.base, 0],
      [0.55, palette.base, 0.7],
      [1, palette.base, 1],
    ]),
    body: `<rect x="${-BLEED}" y="${FADE_FROM}" width="${SCENE_W + BLEED * 2}" height="${SCENE_H - FADE_FROM + BLEED * 3}" fill="url(#${uid}-fade)"/>`,
  }
}

const SERIF = "Georgia, 'DejaVu Serif', 'Nimbus Roman', serif"
const SANS = "'DejaVu Sans', 'Liberation Sans', system-ui, sans-serif"

export const FONTS = { serif: SERIF, sans: SANS }

/** Title and motto at the top of a scene, with a soft shadow so any sky reads. */
export function titleBlock(args: { uid: string; title: string; motto: string; palette: Palette; dark?: boolean }): { defs: string; body: string } {
  const ink = args.dark ? args.palette.base : args.palette.ink
  const halo = args.dark ? '#ffffff' : '#000000'
  return {
    defs: blur(`${args.uid}-halo`, 2.2),
    body:
      `<g font-family="${SERIF}" text-anchor="middle">` +
      `<text x="${SCENE_W / 2}" y="36" font-size="21" font-weight="bold" fill="${halo}" opacity="0.35" filter="url(#${args.uid}-halo)">${esc(args.title)}</text>` +
      `<text x="${SCENE_W / 2}" y="36" font-size="21" font-weight="bold" fill="${ink}">${esc(args.title)}</text>` +
      `<text x="${SCENE_W / 2}" y="58" font-size="12" font-style="italic" fill="${halo}" opacity="0.3" filter="url(#${args.uid}-halo)">${esc(args.motto)}</text>` +
      `<text x="${SCENE_W / 2}" y="58" font-size="12" font-style="italic" fill="${ink}" opacity="0.92">${esc(args.motto)}</text>` +
      '</g>',
  }
}

/** A small caption for the in-scene context gauge: its name above, the value below. */
export function gaugeCaption(args: { x: number; y: number; name: string; value: string; palette: Palette; anchor?: 'start' | 'middle' | 'end'; dark?: boolean }): string {
  // No value, no caption: the background draws the gauge alone (the pane's header carries the figure).
  if (args.value === '') return ''
  const anchor = args.anchor ?? 'middle'
  const ink = args.dark ? args.palette.base : args.palette.ink
  const plate = args.dark ? '#ffffff' : args.palette.base
  return (
    `<g font-family="${SANS}" text-anchor="${anchor}">` +
    `<text x="${n(args.x)}" y="${n(args.y)}" font-size="8.5" letter-spacing="1.2" font-weight="bold" fill="${plate}" opacity="0.55" stroke="${plate}" stroke-width="2.4" stroke-linejoin="round">${esc(args.name)}</text>` +
    `<text x="${n(args.x)}" y="${n(args.y)}" font-size="8.5" letter-spacing="1.2" font-weight="bold" fill="${ink}">${esc(args.name)}</text>` +
    `<text x="${n(args.x)}" y="${n(args.y + 13)}" font-size="11" font-weight="bold" fill="${plate}" opacity="0.55" stroke="${plate}" stroke-width="2.4" stroke-linejoin="round">${esc(args.value)}</text>` +
    `<text x="${n(args.x)}" y="${n(args.y + 13)}" font-size="11" font-weight="bold" fill="${args.palette.accent}">${esc(args.value)}</text>` +
    '</g>'
  )
}

/** A rectangle-ish window that glows and flickers. */
export function glowWindow(r: () => number, x: number, y: number, w: number, h: number, color: string, frame?: string): string {
  const edge = frame ? ` stroke="${frame}" stroke-width="0.8"` : ''
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="0.8" fill="${color}"${edge}>${flicker(r)}</rect>`
}

// ── Spooky pieces ────────────────────────────────────────────────────────────────────────

/** A bat at (x, y), `s` its scale, wings flapping; drifting along `path` (`"0 0;30 -6;60 0"`) when given. */
export function bat(args: { x: number; y: number; s: number; color: string; flap?: number; begin?: number; path?: string; dur?: number }): string {
  const { x, y, s, color } = args
  const flap = args.flap ?? 0.32
  const begin = args.begin ?? 0
  const wings =
    `<path d="M0 0 C-3 -3 -7 -4 -11 -2 C-9 -1 -8 1 -8 2 C-6 0 -4 1 -3 2 C-2 1 -1 1 0 2 C1 1 2 1 3 2 C4 1 6 0 8 2 C8 1 9 -1 11 -2 C7 -4 3 -3 0 0 Z" fill="${color}">` +
    `<animateTransform attributeName="transform" type="scale" values="1 1;1 0.25;1 1" dur="${n(flap)}s" begin="${n(-Math.abs(begin))}s" repeatCount="indefinite"/>` +
    '</path>'
  const body = `<ellipse cx="0" cy="0.6" rx="1.5" ry="2" fill="${color}"/>`
  const motion = args.path ? drift(args.path, args.dur ?? 14, begin) : ''
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})"><g>${wings}${body}${motion}</g></g>`
}

/** A crow perched at (x, y) facing left (`flip` faces right), with a slow head bob. */
export function crow(args: { x: number; y: number; s: number; color: string; flip?: boolean; begin?: number }): string {
  const { x, y, s, color } = args
  const dir = args.flip ? -1 : 1
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s * dir)} ${n(s)})" fill="${color}">` +
    '<path d="M-6 0 C-5 -5 -1 -7 3 -6 C6 -5 8 -2 9 2 L12 5 L7 3 C5 5 1 6 -3 5 C-5 4 -6 2 -6 0 Z"/>' +
    `<g><circle cx="-6" cy="-5" r="3"/><path d="M-9 -5.5 L-13 -4.6 L-9 -3.8 Z"/>` +
    `<animateTransform attributeName="transform" type="rotate" values="0 -5 -3;-8 -5 -3;0 -5 -3;0 -5 -3" dur="5s" begin="${n(-Math.abs(args.begin ?? 0))}s" repeatCount="indefinite"/></g>` +
    '<path d="M0 5 L-1 9 M3 5 L3 9" stroke="' + color + '" stroke-width="0.8"/>' +
    '</g>'
  )
}

/** A crow or raven in flight: a gliding M of wings, drifting along `path` over `dur` seconds. */
export function flyer(args: { x: number; y: number; s: number; color: string; path: string; dur: number; begin?: number }): string {
  const { x, y, s, color } = args
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})"><g>` +
    `<path d="M-10 0 Q-5 -5 0 0 Q5 -5 10 0 Q5 -2 0 2 Q-5 -2 -10 0 Z" fill="${color}">` +
    `<animateTransform attributeName="transform" type="scale" values="1 1;1 0.4;1 1" dur="0.9s" begin="${n(-Math.abs(args.begin ?? 0))}s" repeatCount="indefinite"/></path>` +
    drift(args.path, args.dur, args.begin ?? 0) +
    '</g></g>'
  )
}

/** A bare, crooked tree rooted at (x, y), `h` tall, seeded by `r`; its crown sways a little. */
export function bareTree(r: () => number, args: { x: number; y: number; h: number; color: string; lean?: number; width?: number }): string {
  const lean = args.lean ?? 0
  let d = ''
  const branch = (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
    const x2 = x + Math.sin(angle) * length
    const y2 = y - Math.cos(angle) * length
    const bend = between(r, -0.25, 0.25) * length
    d += `<path d="M${n(x)} ${n(y)} Q${n((x + x2) / 2 + bend)} ${n((y + y2) / 2)} ${n(x2)} ${n(y2)}" stroke-width="${n(width)}"/>`
    if (depth === 0) return
    const kids = depth > 2 ? 2 : between(r, 0, 1) < 0.5 ? 2 : 3
    for (let i = 0; i < kids; i++) {
      const spread = between(r, 0.35, 0.8) * (i % 2 === 0 ? -1 : 1)
      branch(x2, y2, angle + spread + between(r, -0.15, 0.15), length * between(r, 0.58, 0.78), width * 0.62, depth - 1)
    }
  }
  branch(args.x, args.y, lean, args.h * 0.42, args.width ?? 4, 4)
  return (
    `<g stroke="${args.color}" stroke-linecap="round" fill="none">${d}` +
    sway(args.x, args.y, 0.6, between(r, 7, 11), between(r, 0, 6)) +
    '</g>'
  )
}

/** A headstone standing at (x, y) (its base), `w` wide and `h` tall: rounded, cross or slab, leaning a little. */
export function headstone(args: { x: number; y: number; w: number; h: number; kind: 'round' | 'cross' | 'slab'; fill: string; shade: string; lean?: number }): string {
  const { x, y, w, h, fill, shade } = args
  const lean = args.lean ?? 0
  let shape: string
  if (args.kind === 'cross') {
    const t = w * 0.28
    shape =
      `<rect x="${n(x - t / 2)}" y="${n(y - h)}" width="${n(t)}" height="${n(h)}" fill="${fill}"/>` +
      `<rect x="${n(x - w / 2)}" y="${n(y - h * 0.75)}" width="${n(w)}" height="${n(t)}" fill="${fill}"/>`
  } else if (args.kind === 'slab') {
    shape = `<rect x="${n(x - w / 2)}" y="${n(y - h)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`
  } else {
    shape = `<path d="M${n(x - w / 2)} ${n(y)} L${n(x - w / 2)} ${n(y - h + w / 2)} A${n(w / 2)} ${n(w / 2)} 0 0 1 ${n(x + w / 2)} ${n(y - h + w / 2)} L${n(x + w / 2)} ${n(y)} Z" fill="${fill}"/>`
  }
  const edge = `<rect x="${n(x + w / 2 - w * 0.18)}" y="${n(y - h * 0.8)}" width="${n(w * 0.18)}" height="${n(h * 0.8)}" fill="${shade}" opacity="0.5"/>`
  return `<g transform="rotate(${n(lean)} ${n(x)} ${n(y)})">${shape}${args.kind === 'cross' ? '' : edge}</g>`
}

/** A will-o-wisp: a soft glowing orb at (x, y) that bobs and breathes, drifting by (dx, dy). */
export function wisp(args: { x: number; y: number; r: number; color: string; glowId: string; dx?: number; dy?: number; dur?: number; begin?: number }): string {
  const dur = args.dur ?? 7
  const begin = args.begin ?? 0
  const dx = args.dx ?? 8
  const dy = args.dy ?? -6
  return (
    '<g>' +
    `<circle cx="${n(args.x)}" cy="${n(args.y)}" r="${n(args.r * 2.6)}" fill="${args.color}" opacity="0.28" filter="url(#${args.glowId})">${loop('opacity', '0.15;0.4;0.15', dur / 2, begin)}</circle>` +
    `<circle cx="${n(args.x)}" cy="${n(args.y)}" r="${n(args.r)}" fill="${args.color}">${loop('opacity', '0.6;1;0.6', dur / 2, begin)}</circle>` +
    drift(`0 0;${n(dx)} ${n(dy)};${n(-dx / 2)} ${n(dy / 2)};0 0`, dur, begin) +
    '</g>'
  )
}

/** A rare far-off flash over the whole sky: dark most of the time, two quick pulses each `dur` seconds. */
export function distantFlash(args: { color: string; opacity?: number; dur?: number; begin?: number }): string {
  const peak = args.opacity ?? 0.14
  return (
    `<rect x="${-BLEED}" y="${-BLEED}" width="${SCENE_W + BLEED * 2}" height="${FADE_FROM + BLEED}" fill="${args.color}" opacity="0">` +
    loop('opacity', `0;0;0;0;0;0;0;0;${n(peak)};0;${n(peak * 0.6)};0;0`, args.dur ?? 17, args.begin ?? 3) +
    '</rect>'
  )
}

/**
 * Spots for the scene's swarm figures, one per active subagent (at most `max`), spread over `area` without piling up:
 * the same count gives the same spots every time.
 */
export function swarmSpots(seed: string, area: Area, count: number, max = 9): Array<{ x: number; y: number; k: number }> {
  const r = rng(`${seed}-swarm`)
  const shown = Math.max(0, Math.min(max, Math.floor(count)))
  const spots: Array<{ x: number; y: number; k: number }> = []
  for (let i = 0; i < shown; i++) {
    const slot = (i + 0.5) / Math.max(shown, 1)
    spots.push({ x: area.x0 + (area.x1 - area.x0) * (slot * 0.8 + between(r, 0, 0.2)), y: between(r, area.y0, area.y1), k: between(r, 0, 1) })
  }
  return spots
}
