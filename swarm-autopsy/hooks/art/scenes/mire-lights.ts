// Mire Lights: a marsh at the witching hour. Black still water under a thin low crescent, a
// hazy far treeline, gnarled half-drowned trees standing on their roots in the water, dead
// reeds and cattails, low fog banks, and a broken boardwalk running out into the fog. The
// glass jar on the post at the boardwalk's near end is the main context gauge: it fills from
// the bottom with gathered wisp light as the context window fills, and its halo grows. Each
// active subagent is a will-o'-wisp drifting over the water, its light caught below it.

import type { Painted, PaintArgs } from '../scene.ts'
import {
  BLEED,
  SCENE_W,
  bareTree,
  between,
  blur,
  drift,
  flicker,
  fog,
  fogDefs,
  gaugeCaption,
  hills,
  linearBox,
  linearY,
  loop,
  motes,
  n,
  radialBox,
  stars,
  sway,
  swarmSpots,
  wisp,
} from '../kit.ts'

type Palette = PaintArgs['palette']
type Point = readonly [number, number]

const L = -BLEED
const R = SCENE_W + BLEED
/** The far waterline: the treeline stands on it and mirrors about it. */
const SHORE = 196
/** The boardwalk runs from its near end (depth 1) to a vanishing point in the fog at the far shore. */
const VANISH = { x: 210, y: SHORE }
const NEAR = { x: 60, y: SHORE + 140 }
const HALF_WIDTH = 42
/** Planks: one every PITCH of depth, each PLANK deep; the ones that rotted out. */
const PITCH = 0.17
const PLANK = 0.135
const MISSING = new Set([7, 12, 13, 14, 15, 22, 23, 31, 38])
/** The farthest plank drawn; beyond it the fog has the boardwalk. */
const LAST_PLANK = 40
/** A thin crescent low in the sky, below the title. */
const MOON = { x: 212, y: 114, r: 10 }
/** The jar on the near-left post of the boardwalk. */
const JAR = { x: 65, top: 226, bottom: 262, half: 13, neck: 8.5, post: 306 }
/** Where the wisps drift: over the water, right of the jar and its caption. */
const WISP_AREA = { x0: 98, y0: 112, x1: 326, y1: 206 }
const WISP_CORE = '#e6f6c6'
const FOG = '#4a5850'
const STAR = '#cbd8cd'

/** The boardwalk's centre line and half width at depth `z` (1 = near end). */
const walk = (z: number): { x: number; y: number; half: number } => ({
  x: VANISH.x + (NEAR.x - VANISH.x) / z,
  y: VANISH.y + (NEAR.y - VANISH.y) / z,
  half: HALF_WIDTH / z,
})

/** Mirrors drawing about a waterline at `y`. */
const mirror = (inner: string, y: number, opacity: number): string =>
  `<g transform="matrix(1 0 0 -1 0 ${n(2 * y)})" opacity="${n(opacity)}">${inner}</g>`

function defsFor(uid: string, palette: Palette): string {
  return (
    linearY(`${uid}-water`, SHORE, 320, [
      [0, '#28322c'],
      [0.18, '#18201b'],
      [1, '#0a0d0b'],
    ]) +
    linearY(`${uid}-moonpath`, SHORE, 292, [
      [0, palette.accent2, 0.6],
      [1, palette.accent2, 0],
    ]) +
    radialBox(`${uid}-moonglow`, [
      [0, palette.accent2, 0.22],
      [0.4, palette.accent2, 0.07],
      [1, palette.accent2, 0],
    ]) +
    radialBox(`${uid}-jarglow`, [
      [0, palette.accent, 0.75],
      [0.35, palette.accent, 0.28],
      [1, palette.accent, 0],
    ]) +
    radialBox(`${uid}-wisphalo`, [
      [0, palette.accent, 0.34],
      [0.45, palette.accent, 0.1],
      [1, palette.accent, 0],
    ]) +
    linearBox(`${uid}-jarfill`, [
      [0, '#f3fcdc'],
      [0.35, palette.accent],
      [1, '#6f9a4e'],
    ]) +
    blur(`${uid}-wisp`, 2.4) +
    blur(`${uid}-soft`, 1.2) +
    blur(`${uid}-mist`, 9) +
    fogDefs(uid)
  )
}

/** Faint stars (a few twinkling, a dust of fainter ones) and the thin crescent with its cold glow. */
function sky(r: () => number, uid: string, palette: Palette): string {
  let dust = ''
  for (let group = 0; group < 3; group++) {
    let d = ''
    for (let i = 0; i < 18; i++) d += `M${n(between(r, L, R))} ${n(between(r, 4, 182))}h0.01`
    const dur = between(r, 5, 9)
    dust += `<path d="${d}" stroke="${STAR}" stroke-width="${n(0.7 + group * 0.2)}" stroke-linecap="round" opacity="0.3">${loop('opacity', '0.3;0.12;0.3', dur, between(r, 0, dur))}</path>`
  }
  const { x, y, r: mr } = MOON
  const crescent =
    `<g transform="rotate(-28 ${x} ${y})">` +
    `<circle cx="${x}" cy="${y}" r="${mr}" fill="${palette.accent2}" opacity="0.06"/>` +
    `<path d="M${x} ${y - mr}A${mr} ${mr} 0 1 0 ${x} ${y + mr}A${n(mr * 0.74)} ${mr} 0 0 1 ${x} ${y - mr}Z" fill="${palette.accent2}"/>` +
    '</g>'
  return (
    dust +
    `<g opacity="0.55">${stars(r, { x0: -60, y0: 8, x1: 400, y1: 176 }, 14, STAR, [0.4, 1])}</g>` +
    `<circle cx="${x}" cy="${y}" r="52" fill="url(#${uid}-moonglow)">${loop('opacity', '0.8;1;0.8', 14, 4)}</circle>` +
    crescent
  )
}

/** A ragged marsh treeline standing on `base`: scrub crowns and a few dead spikes. */
function treeline(r: () => number, base: number, fill: string, lo: number, hi: number, step: number): string {
  let d = `M${L} ${base}`
  for (let x = L; x < R; ) {
    const w = between(r, step * 0.6, step * 1.5)
    const h = between(r, lo, hi)
    if (r() < 0.2) {
      d += `L${n(x + w * 0.42)} ${n(base - h * 0.45)}L${n(x + w * 0.5)} ${n(base - h * 1.7)}L${n(x + w * 0.58)} ${n(base - h * 0.45)}`
    } else {
      d += `Q${n(x + w / 2)} ${n(base - h * 1.5)} ${n(x + w)} ${n(base - h * 0.35)}`
    }
    x += w
  }
  return `<path d="${d}L${R} ${base}Z" fill="${fill}"/>`
}

/** A dead snag or broken stump: a crooked trunk and a few snapped branches, as one cheap stroke. */
function snag(r: () => number, x: number, y: number, h: number, color: string, width: number): string {
  const lean = between(r, -0.2, 0.2) * h
  let d = `M${x} ${y}Q${n(x + lean * 0.2 + between(r, -2, 2))} ${n(y - h * 0.5)} ${n(x + lean)} ${n(y - h)}`
  for (let i = 0; i < 3; i++) {
    const t = between(r, 0.35, 0.85)
    const side = i % 2 === 0 ? -1 : 1
    d += `M${n(x + lean * t)} ${n(y - h * t)}l${n(side * between(r, h * 0.12, h * 0.32))} ${n(-between(r, h * 0.08, h * 0.28))}`
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" fill="none"/>`
}

/** Light dashes laid on the water, spreading wider towards the viewer. */
function dashes(r: () => number, x: number, spread: number, from: number, to: number, width: [number, number]): string {
  let d = ''
  for (let y = from; y < to; y += 2.6 + (y - SHORE) * 0.05) {
    const depth = 1 + (y - SHORE) / 60
    const w = between(r, width[0], width[1]) * depth
    d += `M${n(x + between(r, -spread, spread) * depth - w / 2)} ${n(y)}h${n(w)}`
  }
  return d
}

/** Rings spreading slowly on still water. */
function slowRipples(r: () => number, points: readonly Point[], color: string, maxR: number): string {
  return points
    .map(([x, y]) => {
      const dur = between(r, 6, 10)
      const begin = between(r, 0, dur)
      return (
        `<ellipse cx="${n(x)}" cy="${n(y)}" rx="0" ry="0" fill="none" stroke="${color}" stroke-width="0.6">` +
        loop('rx', `0;${n(maxR)}`, dur, begin) +
        loop('ry', `0;${n(maxR * 0.28)}`, dur, begin) +
        loop('opacity', '0.7;0', dur, begin) +
        '</ellipse>'
      )
    })
    .join('')
}

/** The water: dark and still, holding the far shore (drawn once, as `shoreId`), the moon's path and a few glints. */
function water(r: () => number, uid: string, palette: Palette, shoreId: string): string {
  const moonPath = dashes(r, MOON.x, 2.4, SHORE + 3, 292, [2, 7])
  const sheen = dashes(r, 170, 260, SHORE + 4, 286, [10, 34])
  let glints = ''
  for (let group = 0; group < 2; group++) {
    let d = ''
    for (let i = 0; i < 6; i++) d += `M${n(between(r, -80, 420))} ${n(between(r, SHORE + 6, 290))}h${n(between(r, 2, 5))}`
    const dur = between(r, 4, 9)
    glints += `<path d="${d}" stroke="${palette.accent2}" stroke-width="0.6" opacity="0.3">${loop('opacity', '0.05;0.35;0.05', dur, between(r, 0, dur))}</path>`
  }
  return (
    `<rect x="${L}" y="${SHORE}" width="${R - L}" height="${480 - SHORE}" fill="url(#${uid}-water)"/>` +
    `<use href="#${shoreId}" transform="matrix(1 0 0 -1 0 ${2 * SHORE})" opacity="0.5" filter="url(#${uid}-soft)"/>` +
    `<ellipse cx="${MOON.x}" cy="${SHORE + 34}" rx="70" ry="30" fill="${palette.accent2}" opacity="0.06" filter="url(#${uid}-mist)"/>` +
    `<path d="${sheen}" stroke="#34413a" stroke-width="0.6" opacity="0.45">${drift('0 0;5 0;0 0', 16, 3)}</path>` +
    `<path d="${moonPath}" stroke="url(#${uid}-moonpath)" stroke-width="1" stroke-linecap="round">${loop('opacity', '0.7;1;0.8;0.7', 7, 2)}${drift('0 0;1.5 0;0 0', 5, 1)}</path>` +
    glints
  )
}

/** A low island of tussock at the waterline. */
const hummock = (x: number, y: number, w: number, fill: string): string =>
  `<path d="M${n(x - w / 2)} ${y}Q${n(x - w * 0.3)} ${y - 5} ${x} ${y - 6}Q${n(x + w * 0.3)} ${y - 5} ${n(x + w / 2)} ${y}Z" fill="${fill}"/>`

/** Broken stumps standing in the water, jagged where they snapped, each over its own reflection. */
function stumps(r: () => number, spots: readonly (readonly [number, number, number])[], color: string): string {
  let out = ''
  let line = ''
  for (const [x, y, h] of spots) {
    const w = 3 + h * 0.22
    const top = y - h
    const d =
      `M${n(x - w / 2)} ${y}L${n(x - w * 0.32)} ${n(top + between(r, 0, 3))}L${n(x - w * 0.08)} ${n(top + 3)}L${n(x + w * 0.06)} ${n(top - between(r, 1, 4))}` +
      `L${n(x + w * 0.3)} ${n(top + 2)}L${n(x + w / 2)} ${y}Z` +
      `M${n(x + w * 0.3)} ${n(y - h * 0.55)}l${n(between(r, 3, 6))} ${n(-between(r, 2, 5))}l0.8 0.9Z`
    const art = `<path d="${d}" fill="${color}" stroke="${color}" stroke-width="0.8" stroke-linejoin="round"/>`
    out += mirror(art, y + 0.6, 0.22) + art
    line += `M${n(x - w * 1.6)} ${y + 0.6}h${n(w * 3.2)}`
  }
  return out + `<path d="${line}" stroke="#2c3731" stroke-width="0.6" opacity="0.6"/>`
}

/** Thin reed tufts on a far island, as one stroke. */
function tufts(r: () => number, x0: number, x1: number, base: number, count: number, color: string): string {
  let d = ''
  for (let i = 0; i < count; i++) {
    const x = between(r, x0, x1)
    const h = between(r, 4, 12)
    d += `M${n(x)} ${n(base + between(r, -1, 1))}q${n(between(r, -1, 1))} ${n(-h * 0.6)} ${n(between(r, -2.5, 2.5))} ${n(-h)}`
  }
  return `<path d="${d}" stroke="${color}" stroke-width="0.8" fill="none"/>`
}

/** Arching roots and knees where a drowned tree meets the water at (x, y). */
function roots(r: () => number, x: number, y: number, s: number, color: string): string {
  let d = ''
  for (const dir of [-1, -0.55, -0.2, 0.35, 0.75, 1]) {
    const reach = between(r, 14, 24) * s * dir
    d += `M${n(x + dir * 2 * s)} ${n(y - 6 * s)}Q${n(x + reach * 0.55)} ${n(y - between(r, 6, 11) * s)} ${n(x + reach)} ${n(y + between(r, 1, 3) * s)}`
  }
  let knees = ''
  for (let i = 0; i < 4; i++) {
    const kx = x + between(r, -34, 34) * s
    const kh = between(r, 3, 7) * s
    knees += `M${n(kx - 1.8 * s)} ${n(y + 2)}L${n(kx)} ${n(y + 2 - kh)}L${n(kx + 1.8 * s)} ${n(y + 2)}Z`
  }
  const flare = `M${n(x - 6 * s)} ${n(y)}Q${n(x - 2 * s)} ${n(y - 8 * s)} ${n(x - 2.5 * s)} ${n(y - 22 * s)}L${n(x + 2.5 * s)} ${n(y - 22 * s)}Q${n(x + 2 * s)} ${n(y - 8 * s)} ${n(x + 6 * s)} ${n(y)}Z`
  return (
    `<path d="${d}" stroke="${color}" stroke-width="${n(2.4 * s)}" stroke-linecap="round" fill="none"/>` +
    `<path d="${flare}${knees}" fill="${color}"/>`
  )
}

/** A gnarled tree half drowned at (x, y) on its roots; its reflection reuses the drawing. */
function drownedTree(
  r: () => number,
  uid: string,
  args: { name: string; x: number; y: number; h: number; lean: number; width: number; color: string; reflect: number },
): string {
  const id = `${uid}-tree-${args.name}`
  const tree = bareTree(r, { x: args.x, y: args.y - 4, h: args.h, color: args.color, lean: args.lean, width: args.width })
  const base = roots(r, args.x, args.y, args.width / 7, args.color)
  return (
    `<g id="${uid}-drowned-${args.name}">` +
    `<use href="#${id}" transform="matrix(1 0 0 -1 0 ${n(2 * args.y + 2)})" opacity="${n(args.reflect)}"/>` +
    `<g id="${id}">${tree}${base}</g></g>`
  )
}

/** Another drowned tree for wide panes: a drawn one again (with its reflection), moved, scaled and maybe flipped. */
function treeCopy(uid: string, name: string, from: Point, to: Point, scale: number, flip: boolean): string {
  const sx = flip ? -scale : scale
  return (
    `<use href="#${uid}-drowned-${name}" ` +
    `transform="translate(${n(to[0])} ${n(to[1])}) scale(${n(sx)} ${n(scale)}) translate(${n(-from[0])} ${n(-from[1])})"/>`
  )
}

/** Dead reeds: tapered blades, some snapped and folded over, swaying from their roots. */
function reeds(r: () => number, args: { x0: number; x1: number; base: number; lo: number; hi: number; count: number; color: string }): string {
  let d = ''
  for (let i = 0; i < args.count; i++) {
    const x = between(r, args.x0, args.x1)
    const b = args.base + between(r, -4, 4)
    const h = between(r, args.lo, args.hi)
    const lean = between(r, -5, 5)
    if (r() < 0.28) {
      const kx = x + lean * 0.5
      const ky = b - h * 0.62
      const fall = lean >= 0 ? 7 : -7
      d += `M${n(x - 1)} ${n(b)}L${n(kx)} ${n(ky)}L${n(kx + fall)} ${n(ky + h * 0.28)}L${n(kx + 0.7)} ${n(ky + 1.2)}L${n(x + 1)} ${n(b)}Z`
    } else {
      d += `M${n(x - 1.1)} ${n(b)}Q${n(x + lean)} ${n(b - h * 0.6)} ${n(x + lean * 1.8)} ${n(b - h)}Q${n(x + lean * 0.6)} ${n(b - h * 0.5)} ${n(x + 1.1)} ${n(b)}Z`
    }
  }
  const pivot = (args.x0 + args.x1) / 2
  return `<path d="${d}" fill="${args.color}">${sway(pivot, args.base, 1.3, between(r, 7, 11), between(r, 0, 8))}</path>`
}

/** Cattails: thin stalks with dark velvet heads, nodding together. */
function cattails(r: () => number, args: { x0: number; x1: number; base: number; lo: number; hi: number; count: number; stalk: string; head: string }): string {
  let stalks = ''
  let heads = ''
  for (let i = 0; i < args.count; i++) {
    const x = between(r, args.x0, args.x1)
    const b = args.base + between(r, -3, 3)
    const h = between(r, args.lo, args.hi)
    const tx = x + between(r, -4, 4)
    const ty = b - h
    stalks += `M${n(x)} ${n(b)}Q${n(x)} ${n(b - h * 0.5)} ${n(tx)} ${n(ty - 5)}`
    heads += `<rect x="${n(tx - 1.7)}" y="${n(ty)}" width="3.4" height="${n(between(r, 8, 11))}" rx="1.7"/>`
  }
  const pivot = (args.x0 + args.x1) / 2
  return (
    `<g><path d="${stalks}" stroke="${args.stalk}" stroke-width="0.9" fill="none"/><g fill="${args.head}">${heads}</g>` +
    `${sway(pivot, args.base, 1.6, between(r, 8, 12), between(r, 0, 8))}</g>`
  )
}

/** Plank colours by depth: near ones in shadow, far ones paler in the fog and moonlight. */
const plankTones = (z: number): readonly string[] =>
  z < 1.7 ? ['#191e1a', '#1c211d', '#171c18'] : z < 3.2 ? ['#232924', '#262c27', '#20261f'] : ['#2b322c', '#2f3630', '#283029']

/** The planks, far to near: ragged ends, a few snapped short, gaps where they rotted out. */
function planks(r: () => number): { tops: string; faces: string; edges: string; grain: string } {
  const byTone = new Map<string, string>()
  let faces = ''
  let edges = ''
  let grain = ''
  for (let k = LAST_PLANK; k >= 0; k--) {
    const z = 1 + k * PITCH
    const tones = plankTones(z)
    const tone = tones[Math.floor(between(r, 0, tones.length))] ?? '#232924'
    const jl = between(r, -2.4, 2.4) / z
    const jr = between(r, -2.4, 2.4) / z
    const snapped = r()
    const short = between(r, 0.25, 0.7)
    const seam = between(r, 0.3, 0.7)
    if (MISSING.has(k)) continue
    const a = walk(z)
    const b = walk(z + PLANK)
    const left = (p: { x: number; half: number }): number => p.x - p.half + jl + (snapped < 0.1 ? p.half * 2 * short : 0)
    const right = (p: { x: number; half: number }): number => p.x + p.half + jr - (snapped > 0.9 ? p.half * 2 * short : 0)
    byTone.set(tone, `${byTone.get(tone) ?? ''}M${n(left(a))} ${n(a.y)}L${n(right(a))} ${n(a.y)}L${n(right(b))} ${n(b.y)}L${n(left(b))} ${n(b.y)}Z`)
    faces += `M${n(left(a))} ${n(a.y)}H${n(right(a))}v${n(2.6 / z)}H${n(left(a))}Z`
    if (z > 1.7) edges += `M${n(left(b))} ${n(b.y)}H${n(right(b))}`
    if (z < 2.6) grain += `M${n(left(a) + 3 / z)} ${n(a.y + (b.y - a.y) * seam)}H${n(right(a) - 6 / z)}`
  }
  const tops = [...byTone].map(([tone, d]) => `<path d="${d}" fill="${tone}"/>`).join('')
  return { tops, faces, edges, grain }
}

/** The broken boardwalk: stringers (one snapped), a fallen plank, posts, the planks on top. */
function boardwalk(r: () => number): string {
  const near = walk(1)
  const far = walk(8)
  const under =
    `<path d="M${n(near.x - near.half - 4)} ${n(near.y + 8)}L${n(far.x - far.half)} ${n(far.y + 1)}` +
    `L${n(far.x + far.half)} ${n(far.y + 1)}L${n(near.x + near.half + 4)} ${n(near.y + 8)}Z" fill="#050706" opacity="0.55"/>`
  const stringer = (side: -1 | 1, z0: number, z1: number): string => {
    const a = walk(z0)
    const b = walk(z1)
    const ax = a.x + side * a.half * 0.9
    const bx = b.x + side * b.half * 0.9
    return `M${n(ax)} ${n(a.y + 1.5 / z0)}L${n(bx)} ${n(b.y + 1.5 / z1)}L${n(bx)} ${n(b.y + 4.5 / z1)}L${n(ax)} ${n(a.y + 4.5 / z0)}Z`
  }
  // The right stringer snapped in the rotten stretch: its ends sag to the water.
  const snapA = walk(3.0)
  const snapB = walk(3.6)
  const sag =
    `M${n(snapA.x + snapA.half * 0.9)} ${n(snapA.y + 0.5)}L${n(snapA.x + snapA.half * 1.05)} ${n(snapA.y - 3.5)}L${n(snapA.x + snapA.half * 1.1)} ${n(snapA.y - 2)}L${n(snapA.x + snapA.half * 0.9)} ${n(snapA.y + 2)}Z` +
    `M${n(snapB.x + snapB.half * 0.9)} ${n(snapB.y + 0.5)}L${n(snapB.x + snapB.half * 1.2)} ${n(snapB.y + 6)}L${n(snapB.x + snapB.half * 1.3)} ${n(snapB.y + 5)}L${n(snapB.x + snapB.half * 0.9)} ${n(snapB.y + 2)}Z`
  const stringers = `<path d="${stringer(-1, 1, 8)}${stringer(1, 1, 3.0)}${stringer(1, 3.6, 8)}${sag}" fill="#1e241f"/>`
  // One plank fell into the gap and lies tilted, half under the water.
  const fallen = walk(3.3)
  const drowned = `<path d="M${n(fallen.x - fallen.half * 0.8)} ${n(fallen.y + 3)}L${n(fallen.x + fallen.half * 1.2)} ${n(fallen.y + 7)}L${n(fallen.x + fallen.half * 1.2)} ${n(fallen.y + 8.6)}L${n(fallen.x - fallen.half * 0.8)} ${n(fallen.y + 5)}Z" fill="#232a24"/>`

  let posts = ''
  let postsBelow = ''
  for (const [z, side, up] of [
    [2.2, -1, 8],
    [2.2, 1, 4],
    [3.6, -1, 7],
    [5, 1, 10],
    [6.4, -1, 5],
    [8, 1, 7],
  ] as const) {
    const p = walk(z)
    const x = p.x + side * (p.half + 1.6 / z)
    const w = 4 / z
    const top = p.y - up / z
    const foot = p.y + 9 / z
    posts += `M${n(x - w / 2)} ${n(top)}h${n(w)}V${n(foot)}h${n(-w)}Z`
    postsBelow += `M${n(x - w / 2)} ${n(foot)}h${n(w)}v${n((foot - top) * 0.8)}h${n(-w)}Z`
  }
  const deck = planks(r)
  return (
    under +
    `<path d="${postsBelow}" fill="#1e2520" opacity="0.4"/>` +
    stringers +
    drowned +
    deck.tops +
    `<path d="${deck.faces}" fill="#0f120f"/>` +
    `<path d="${deck.grain}" stroke="#0f130f" stroke-width="0.6" opacity="0.8"/>` +
    `<path d="${deck.edges}" stroke="#56645b" stroke-width="0.5" opacity="0.55"/>` +
    `<path d="${posts}" fill="#1b211c"/>`
  )
}

/** Specks of light inside the jar's fill, rising and falling a little. */
function jarSpecks(seeds: readonly (readonly [number, number, number])[], fillY: number, fillH: number): string {
  const { x, half } = JAR
  return seeds
    .slice(0, fillH < 8 ? 2 : seeds.length)
    .map(([fx, fy, dur], i) => {
      const sy = fillY + 1.5 + fy * Math.max(0, fillH - 3)
      const rise = n(-Math.min(3, fillH / 3))
      return (
        `<circle cx="${n(x - half + 3 + fx * (2 * half - 6))}" cy="${n(sy)}" r="${i % 2 ? 0.7 : 0.95}" fill="#fbffe8">` +
        loop('opacity', '0.15;1;0.15', dur, i) +
        drift(`0 0;${i % 2 ? 1.2 : -1} ${rise};0 0`, dur * 2.2, i * 1.3) +
        '</circle>'
      )
    })
    .join('')
}

/** The context gauge: a glass jar on the near post, filling from the bottom with gathered wisp light. */
function jar(r: () => number, uid: string, palette: Palette, context: number | undefined): string {
  const { x, top, bottom, half, neck, post } = JAR
  // Randomness first and always, so the scene draws the same whatever the fill.
  const seeds = [0.22, 0.48, 0.7, 0.36, 0.84].map(fx => [fx, between(r, 0.15, 0.9), between(r, 2.5, 5)] as const)
  const lightFlicker = flicker(r, 0.82, 1)
  const inner = bottom - 1 - (top + 3)
  const level = context ?? 0
  const fillH = inner * level
  const fillY = bottom - 1 - fillH
  const glow = 0.28 + level * 0.62
  const body =
    `M${n(x - neck)} ${top - 5}V${top - 1}Q${n(x - half)} ${top} ${n(x - half)} ${top + 4}V${bottom - 4}Q${n(x - half)} ${bottom} ${n(x - half + 4)} ${bottom}` +
    `H${n(x + half - 4)}Q${n(x + half)} ${bottom} ${n(x + half)} ${bottom - 4}V${top + 4}Q${n(x + half)} ${top} ${n(x + neck)} ${top - 1}V${top - 5}Z`
  const lit = context !== undefined && fillH > 0
  const light = lit
    ? `<g clip-path="url(#${uid}-jarclip)"><rect x="${x - half}" y="${n(fillY)}" width="${half * 2}" height="${n(fillH + 1)}" fill="url(#${uid}-jarfill)">${lightFlicker}</rect>` +
      `<ellipse cx="${x}" cy="${n(fillY)}" rx="${half - 1}" ry="1.3" fill="#f8ffe4" opacity="0.85">${drift('0 0;0 0.6;0 0', 3.4, 0.8)}</ellipse>` +
      `${fillH >= 2 ? jarSpecks(seeds, fillY, fillH) : ''}</g>`
    : ''
  const halo = lit
    ? `<circle cx="${x}" cy="${n(fillY + fillH / 2 - 2)}" r="${n(20 + level * 34)}" fill="url(#${uid}-jarglow)" opacity="${n(glow)}">${loop('opacity', `${n(glow * 0.78)};${n(glow)};${n(glow * 0.85)};${n(glow * 0.78)}`, 4.6, 1.2)}</circle>` +
      `<ellipse cx="${x + 18}" cy="${post - 4}" rx="${n(16 + level * 22)}" ry="${n(3 + level * 3)}" fill="${palette.accent}" opacity="${n(0.05 + level * 0.14)}" filter="url(#${uid}-soft)"/>`
    : ''
  const lidX = n(x - neck - 1.6)
  const lidW = n(neck * 2 + 3.2)
  return (
    halo +
    `<rect x="${x - 2.6}" y="${bottom}" width="5.2" height="${post - bottom}" fill="#141914"/>` +
    `<path d="M${x + 1.2} ${bottom + 4}V${post - 4}" stroke="#2a3229" stroke-width="0.8"/>` +
    `<rect x="${x - half - 3}" y="${bottom}" width="${half * 2 + 6}" height="3" rx="0.8" fill="#1d231d"/>` +
    `<clipPath id="${uid}-jarclip"><path d="${body}"/></clipPath>` +
    `<path d="${body}" fill="#0e1310" fill-opacity="0.72"/>` +
    light +
    `<path d="${body}" fill="#dfe9d6" fill-opacity="0.06" stroke="#b9c9b5" stroke-opacity="0.6" stroke-width="1.1"/>` +
    `<path d="M${x - half + 3.2} ${top + 6}V${bottom - 6}" stroke="#e1e8de" stroke-opacity="0.35" stroke-width="1.2" stroke-linecap="round"/>` +
    `<path d="M${x + half - 4} ${top + 3}q2.4 1 2.6 4" stroke="${palette.accent2}" stroke-opacity="0.55" stroke-width="0.8" fill="none" stroke-linecap="round"/>` +
    `<rect x="${lidX}" y="${top - 11}" width="${lidW}" height="6.5" rx="1.2" fill="#262c26"/>` +
    `<path d="M${lidX} ${top - 8}h${lidW}M${lidX} ${top - 6.4}h${lidW}" stroke="#3b4239" stroke-width="0.6"/>` +
    `<path d="M${n(x + neck + 1)} ${top - 7}q3 4 1 9" stroke="#3b4239" stroke-width="0.7" fill="none"/>`
  )
}

/** One will-o'-wisp per active subagent, drifting over the water; its light lies on the water below. */
function wisps(uid: string, palette: Palette, spots: ReturnType<typeof swarmSpots>): { figures: string; reflections: string } {
  let figures = ''
  let reflections = ''
  spots.forEach((spot, i) => {
    const low = (spot.y - WISP_AREA.y0) / (WISP_AREA.y1 - WISP_AREA.y0)
    const size = 2 + spot.k * 1.1 + low * 0.5
    const swing = (i % 2 === 0 ? 1 : -1) * (6 + spot.k * 10)
    const dur = 26 + spot.k * 18
    const begin = spot.k * dur
    const reflY = 2 * (SHORE + 10 + spot.k * 44) - spot.y
    figures +=
      '<g>' +
      `<ellipse cx="${n(spot.x)}" cy="${n(spot.y - size)}" rx="${n(size * 4.6)}" ry="${n(size * 7)}" fill="url(#${uid}-wisphalo)"/>` +
      wisp({ x: spot.x, y: spot.y, r: size, color: WISP_CORE, glowId: `${uid}-wisp`, dx: 3, dy: -4, dur: 8 + spot.k * 4, begin: spot.k * 7 }) +
      drift(`0 0;${n(swing)} -3;${n(swing * 0.4)} 3;0 0`, dur, begin) +
      '</g>'
    if (reflY < 294) {
      const shimmer = 0.3 + spot.k * 0.2
      reflections +=
        `<g opacity="${n(shimmer)}"><ellipse cx="${n(spot.x)}" cy="${n(reflY)}" rx="${n(size * 0.8)}" ry="${n(size * 3)}" fill="${palette.accent}" filter="url(#${uid}-wisp)"/>` +
        loop('opacity', `${n(shimmer)};${n(shimmer * 0.5)};${n(shimmer)}`, 3 + spot.k * 2, i) +
        drift(`0 0;${n(swing)} 3;${n(swing * 0.4)} -3;0 0`, dur, begin) +
        '</g>'
    }
  })
  return { figures, reflections }
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const defs = defsFor(uid, palette)

  // Sky, and the far shore: low hills, dead snags, then the ragged treeline along the water.
  const heavens = sky(r, uid, palette)
  const shore =
    `<g id="${uid}-shore">` +
    hills(r, { x0: L, x1: R, y: 186, amp: 10, bottom: SHORE, fill: '#232c27', bumps: 16 }) +
    snag(r, 150, SHORE + 1, 34, '#232c27', 1.6) +
    snag(r, 172, SHORE + 1, 22, '#232c27', 1.2) +
    snag(r, -210, SHORE + 1, 44, '#232c27', 1.8) +
    snag(r, 520, SHORE + 1, 38, '#232c27', 1.6) +
    treeline(r, SHORE, '#1c2420', 4, 13, 11) +
    '</g>'
  const farFog =
    fog({ uid, y: 188, width: 1100, color: FOG, opacity: 0.42, dur: 58, begin: 12, x0: -380 }) +
    fog({ uid, y: 176, width: 900, color: FOG, opacity: 0.18, dur: 70, begin: 30, x0: -300 })

  // The water, and what stands in it.
  const pond = water(r, uid, palette, `${uid}-shore`)
  const islands =
    hummock(104, 214, 58, '#151c18') +
    hummock(-70, 222, 80, '#151c18') +
    hummock(300, 208, 44, '#18201b') +
    hummock(470, 220, 70, '#151c18') +
    tufts(r, 82, 126, 213, 16, '#1a221d') +
    tufts(r, 282, 320, 207, 12, '#1a221d') +
    tufts(r, -100, -40, 221, 12, '#1a221d') +
    tufts(r, 444, 496, 219, 12, '#1a221d')
  const stubs = stumps(
    r,
    [
      [248, 236, 15],
      [174, 280, 10],
      [-44, 242, 20],
      [392, 252, 15],
    ],
    '#131915',
  )
  const ripplePoints: Point[] = [
    [between(r, 120, 150), between(r, 228, 240)],
    [between(r, 236, 270), between(r, 252, 266)],
    [between(r, 20, 40), between(r, 270, 284)],
    [174, 280.6],
    [between(r, -160, -60), between(r, 240, 280)],
    [between(r, 380, 500), between(r, 240, 280)],
  ]
  const rings = slowRipples(r, ripplePoints, '#55655b', 10)

  // The boardwalk running out into the fog, and the fog that swallows its far end.
  const walkway = boardwalk(r)
  const walkFog =
    fog({ uid, y: 204, width: 900, color: FOG, opacity: 0.5, dur: 44, begin: 6, x0: -220 }) +
    `<ellipse cx="206" cy="202" rx="64" ry="9" fill="${FOG}" opacity="0.45" filter="url(#${uid}-mist)">${drift('0 0;10 1;0 0', 26, 9)}</ellipse>`

  // The drowned trees: a small one on the left, the great one on the right; on wide panes, the
  // same two again, moved, scaled and flipped.
  const leftTree = drownedTree(r, uid, { name: 'left', x: 16, y: 244, h: 104, lean: 0.22, width: 3.8, color: '#161d19', reflect: 0.22 })
  const bigTree = drownedTree(r, uid, { name: 'big', x: 304, y: 270, h: 150, lean: -0.2, width: 8.5, color: '#0f1411', reflect: 0.2 })
  const wideTrees =
    treeCopy(uid, 'left', [16, 244], [-150, 258], 1.45, false) +
    treeCopy(uid, 'left', [16, 244], [436, 234], 0.85, true) +
    treeCopy(uid, 'big', [304, 270], [580, 264], 0.92, true)

  const lowFog =
    fog({ uid, y: 238, width: 1000, color: FOG, opacity: 0.22, dur: 36, begin: 20, x0: -420 }) +
    fog({ uid, y: 284, width: 1100, color: '#3c4a42', opacity: 0.2, dur: 30, begin: 4, x0: -300 })

  // Dead reeds and cattails, darkest at the front.
  const nearReeds =
    reeds(r, { x0: -40, x1: 46, base: 306, lo: 26, hi: 62, count: 16, color: '#0a0d0b' }) +
    cattails(r, { x0: -10, x1: 40, base: 306, lo: 46, hi: 74, count: 5, stalk: '#0d110e', head: '#1e1b15' }) +
    reeds(r, { x0: 252, x1: 360, base: 304, lo: 24, hi: 56, count: 16, color: '#0a0d0b' }) +
    cattails(r, { x0: 270, x1: 334, base: 304, lo: 40, hi: 66, count: 6, stalk: '#0d110e', head: '#1e1b15' }) +
    reeds(r, { x0: -300, x1: -60, base: 302, lo: 20, hi: 54, count: 12, color: '#0b0e0c' }) +
    reeds(r, { x0: 380, x1: 640, base: 302, lo: 20, hi: 54, count: 12, color: '#0b0e0c' })
  const fireflies = `<g opacity="0.42">${motes(r, { x0: -80, y0: 238, x1: 420, y1: 300 }, 8, '#d8d9a0', 14)}</g>`

  // The gauge, then the swarm: drawn from `r` last so the scenery never shifts as they change.
  const gauge = jar(r, uid, palette, context)
  const caption = gaugeCaption({ x: JAR.x + JAR.half + 9, y: JAR.top + 10, name: scene.gauge, value: contextText, palette, anchor: 'start' })
  const swarmArt = wisps(uid, palette, swarmSpots(scene.id, WISP_AREA, swarm))

  return {
    defs,
    body:
      heavens +
      shore +
      farFog +
      pond +
      swarmArt.reflections +
      islands +
      stubs +
      rings +
      leftTree +
      walkway +
      walkFog +
      bigTree +
      wideTrees +
      lowFog +
      swarmArt.figures +
      nearReeds +
      gauge +
      fireflies +
      caption,
  }
}
