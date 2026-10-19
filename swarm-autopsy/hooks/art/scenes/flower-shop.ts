// Twilight Flower Shop: a small corner flower shop at blue hour, seen from across the pavement.
// Under a scalloped rose-and-cream awning hung with twinkling string lights, a deep green shopfront
// opens on a big honey-lit window: shelves of potted plants, two hanging planters swaying under a
// pendant lamp, the shop cat flicking its tail. A little sign swings on the door's glass, a climbing
// rose scales the trellis beside it and up the corner; a powder-blue bicycle with a basket of tulips
// leans on the window, zinc buckets of tulips, sunflowers and roses wait by the door, and an old
// street lamp glows at the corner. Blue-violet townhouses line the street (a café on one side, a
// bakery on the other, benches and potted trees for a wide pane), a crescent moon hangs over the
// side street, petals drift down.
// The context gauge is the tall glass vase on the window ledge: its water rises as the context window
// fills, and the bouquet in it grows and opens from closed buds to full bloom (an empty vase of buds
// while unmeasured); its caption is lettered on the riser below. Each active subagent is a pastel
// butterfly fluttering about the flowers and the lamp.
//
// Past the 800-line soft ceiling on purpose: one painting, kept whole, so the drawing reads top to bottom like the
// scene (no other module needs any of its pieces).

import type { Palette } from '../../lib/scenes.ts'
import type { Area } from '../kit.ts'
import type { Painted, PaintArgs } from '../scene.ts'
import { BLEED, SCENE_W, between, drift, gaugeCaption, linearBox, linearY, loop, n, radialBox, stars, swarmSpots, sway } from '../kit.ts'

const L = -BLEED
const R = SCENE_W + BLEED

type Pt = readonly [number, number]

/** Where every wall meets the pavement, and the kerb. */
const GROUND = 294
const KERB = 330

// The shop: its facade, cornice, fascia, awning, big window, door and trellis.
const SX0 = 46
const SX1 = 294
const CORNICE = 90
const FASCIA = 144
const AWN_TOP = 156
const AWN_BOT = 182
const WX0 = 58
const WX1 = 200
const WY0 = 200
const WY1 = 266
const DX0 = 212
const DX1 = 244
const TX0 = 252
const TX1 = 284
const TRELLIS_TOP = 204

// The vase gauge stands on the window ledge in the right-hand pane; its caption is lettered on the riser below.
const VX = 177
const VB = 267
const VT = 223

// The street lamp at the shop's corner, and the moon over the side street.
const LX = 34
const MX = 309
const MY = 112
const MR = 7

/** Blue-hour tones: cool walls and street, warm lights. */
const TONE = {
  far: '#38345a',
  farLit: '#f0c08a',
  rim: '#4a4569',
  roof: '#1f1c2f',
  glassDark: '#1b1929',
  wood: '#22332e',
  woodLit: '#2f453d',
  woodDeep: '#16211d',
  gold: '#c9a86a',
  ledge: '#cdbfa8',
  iron: '#16131d',
  lamp: '#ffe2a8',
  stem: '#527d48',
  crate: '#6b4a36',
  crateDark: '#45301f',
  crateLit: '#8c654b',
  ink: '#2b2236',
} as const

/** The lights in the street's windows. */
const LIGHTS = ['#ffcb85', '#f7b47c', '#ffdca6', '#f4b0ab'] as const
/** Pots and greens inside the shop window, in its warm light. */
const POTS = ['#a85d43', '#d8c09f', '#6e8f87', '#b9734f'] as const
const INSIDE_GREENS = ['#5d6c33', '#74833d', '#4c5b2c'] as const
/** A tulip head, its base at (0, 0), pointing up (drawn once, used everywhere). */
const TULIP = 'M-2.2 0C-2.7-2.6-2.1-5-1.2-5.6L-.4-3.8L0-6L.4-3.8L1.2-5.6C2.1-5 2.7-2.6 2.2 0C1.2 1.1-1.2 1.1-2.2 0Z'

const pick = <T,>(list: readonly T[], i: number): T => list[((i % list.length) + list.length) % list.length] as T

/** One decimal: small shapes are many, and short numbers keep the drawing small. */
const d1 = (v: number): string => String(Math.round(v * 10) / 10)

/** Gentle easing on every step of a loop with `segments` steps. */
const ease = (segments: number): string => ` calcMode="spline" keySplines="${Array.from({ length: segments }, () => '.4 0 .6 1').join(';')}"`

/** A slow, soft breathing of a light: never off, never jittery. */
function glimmer(r: () => number, lo: number, hi: number): string {
  const dur = between(r, 6, 10)
  return loop('opacity', `${n(hi)};${n(between(r, lo, (lo + hi) / 2))};${n(between(r, (lo + hi) / 2, hi))};${n(hi)}`, dur, between(r, 0, dur), ease(3))
}

/** A soft light: an ellipse filled with one of the radial glows. */
const glow = (uid: string, kind: string, cx: number, cy: number, rx: number, ry: number, opacity: number, anim = ''): string =>
  `<ellipse cx="${d1(cx)}" cy="${d1(cy)}" rx="${d1(rx)}" ry="${d1(ry)}" fill="url(#${uid}-${kind})"${opacity < 1 ? ` opacity="${n(opacity)}"` : ''}${anim ? `>${anim}</ellipse>` : '/>'}`

/** A circle as a path segment, so many can share one path. */
const dot = (x: number, y: number, rad: number): string => `M${d1(x - rad)} ${d1(y)}a${d1(rad)} ${d1(rad)} 0 1 0 ${d1(rad * 2)} 0a${d1(rad)} ${d1(rad)} 0 1 0 ${d1(-rad * 2)} 0`

/** A leaf (or a petal) as a path segment: from its base (x, y) along `angle` degrees, `len` long, `w` wide. */
function leaf(x: number, y: number, angle: number, len: number, w: number): string {
  const a = (angle * Math.PI) / 180
  const tx = Math.cos(a) * len
  const ty = Math.sin(a) * len
  const px = -Math.sin(a) * w
  const py = Math.cos(a) * w
  return `M${d1(x)} ${d1(y)}q${d1(tx / 2 + px)} ${d1(ty / 2 + py)} ${d1(tx)} ${d1(ty)}q${d1(-tx / 2 - px)} ${d1(-ty / 2 - py)} ${d1(-tx)} ${d1(-ty)}Z`
}

/** Path segments gathered by colour, so a crowd of small shapes is a few elements. */
const add = (groups: Map<string, string>, key: string, d: string): void => {
  groups.set(key, (groups.get(key) ?? '') + d)
}
const filled = (groups: Map<string, string>): string => [...groups].map(([colour, d]) => `<path d="${d}" fill="${colour}"/>`).join('')

/** Round spots gathered by colour and size: a zero-length round-capped stroke is the shortest circle there is. */
const spot = (spots: Map<string, string>, colour: string, x: number, y: number, rad: number): void =>
  add(spots, `${colour}|${Math.max(0.5, Math.round(rad * 4) / 2)}`, `M${d1(x)} ${d1(y)}h0`)
const spotted = (spots: Map<string, string>, extra = ''): string =>
  `<g stroke-linecap="round"${extra}>${[...spots]
    .map(([key, d]) => {
      const [colour, width] = key.split('|')
      return `<path d="${d}" stroke="${colour}" stroke-width="${width}"/>`
    })
    .join('')}</g>`
/** A few spots of one colour and size, inline. */
const spots = (points: readonly Pt[], rad: number, colour: string, extra = ''): string =>
  `<path d="${points.map(([x, y]) => `M${d1(x)} ${d1(y)}h0`).join('')}" stroke="${colour}" stroke-width="${d1(rad * 2)}" stroke-linecap="round"${extra}/>`

/** A shape drawn once in the defs, placed again. */
const use = (uid: string, id: string, transform: string, fill: string): string => `<use href="#${uid}-${id}" transform="${transform}" fill="${fill}"/>`

// ── The sky and the far town ────────────────────────────────────────────────────────────

/** Stars that hold still (cheaper than twinkling ones). */
function stillStars(r: () => number, areas: readonly Area[], count: number, size: number, opacity: number): string {
  const found = new Map<string, string>()
  for (const area of areas)
    for (let i = 0; i < count; i++) spot(found, '#efe6f2', between(r, area.x0, area.x1), between(r, area.y0, area.y1), between(r, 0.3, 0.6) * size)
  return spotted(found, ` opacity="${n(opacity)}"`)
}

/** A few stars either side of the title, a faint scatter over the roofs, and the crescent moon. */
function skyLayer(r: () => number, uid: string): string {
  const sides: Area[] = [
    { x0: L, y0: 8, x1: 34, y1: 150 },
    { x0: 304, y0: 8, x1: R, y1: 150 },
  ]
  return (
    stillStars(r, sides, 16, 1.2, 0.42) +
    stillStars(r, [{ x0: 40, y0: 68, x1: 300, y1: 84 }], 3, 0.9, 0.3) +
    `<g opacity="0.9">${stars(r, { x0: 316, y0: 14, x1: 380, y1: 76 }, 1, '#f6eef6', [0.6, 1.2])}</g>` +
    glow(uid, 'moonglow', MX, MY, 26, 26, 0.6, loop('opacity', '0.45;0.7;0.45', 12, 3, ease(2))) +
    `<circle cx="${MX}" cy="${MY}" r="${MR}" fill="#fbecd9" mask="url(#${uid}-moonmask)"/>`
  )
}

/** The far town: hazy rooftops and chimneys with a few tiny lights, seen between and beyond the street. */
function farLayer(r: () => number, uid: string): string {
  let blocks = ''
  let lit = ''
  let x = L
  while (x < R) {
    const w = between(r, 24, 54)
    const top = between(r, 128, 168)
    const kind = r()
    blocks +=
      kind < 0.3 ? `M${d1(x)} 300V${d1(top)}l${d1(w / 2)} ${d1(-between(r, 8, 14))}L${d1(x + w)} ${d1(top)}V300Z` : `M${d1(x)} 300V${d1(top)}h${d1(w)}V300Z`
    if (kind > 0.55) blocks += `M${d1(x + between(r, 4, w - 9))} ${d1(top + 1)}v-8h4v8Z`
    if (r() < 0.5) lit += `M${d1(x + between(r, 5, w - 9))} ${d1(top + between(r, 10, 40))}h3.4v4.6h-3.4Z`
    x += w + between(r, -2, 3)
  }
  return (
    `<path d="${blocks}" fill="${TONE.far}"/><path d="${lit}" fill="${TONE.farLit}" opacity="0.55"/>` +
    `<rect x="${L}" y="180" width="${R - L}" height="120" fill="url(#${uid}-haze)"/>`
  )
}

// ── The neighbours ──────────────────────────────────────────────────────────────────────

type House = {
  x0: number
  x1: number
  top: number
  fill: string
  roof?: 'mansard' | 'gable'
  /** Window top-left corners; each window is 12 × 18. */
  wins: readonly Pt[]
  /** The lit windows, by index, and their light. */
  lit?: Readonly<Record<number, string>>
  /** Lit windows whose light breathes. */
  live?: readonly number[]
  /** A street door at this x. */
  door?: number
}

/** A blue-violet townhouse: roof, rim-lit cornice, dark and lit windows, a street door. */
function house(r: () => number, uid: string, h: House): string {
  const { x0, x1, top, fill } = h
  const w = x1 - x0
  const mid = x0 + w / 2
  let roof = ''
  if (h.roof === 'mansard')
    roof =
      `<path d="M${x0 - 1} ${top}l8-15H${x1 - 7}l8 15ZM${mid - 5} ${top - 4}v-8l5-5l5 5v8Z" fill="${TONE.roof}"/>` +
      `<path d="M${x0 + 7} ${top - 15}H${x1 - 7}" stroke="${TONE.rim}"/><rect x="${mid - 2.5}" y="${top - 10}" width="5" height="6" fill="${LIGHTS[2]}" opacity="0.8"/>`
  if (h.roof === 'gable')
    roof = `<path d="M${x0 - 3} ${top + 1}L${mid} ${top - 20}L${x1 + 3} ${top + 1}Z" fill="${TONE.roof}"/><path d="M${x0 - 3} ${top + 1}L${mid} ${top - 20}" stroke="${TONE.rim}" stroke-width="0.9"/>`
  let dark = ''
  let marks = ''
  let lit = ''
  h.wins.forEach(([wx, wy], i) => {
    dark += `M${wx} ${wy}h12v18h-12Z`
    marks += `M${wx + 6} ${wy}v18M${wx} ${wy + 8}h12`
    const light = h.lit?.[i]
    if (light !== undefined)
      lit += h.live?.includes(i)
        ? glow(uid, 'glow', wx + 6, wy + 9, 17, 15, 0.4) + `<rect x="${wx}" y="${wy}" width="12" height="18" fill="${light}">${glimmer(r, 0.7, 1)}</rect>`
        : `<path d="M${wx} ${wy}h12v18h-12Z" fill="${light}"/>`
  })
  const door =
    h.door === undefined
      ? ''
      : `<path d="M${h.door} ${GROUND}v-31h14v31Z" fill="#1a1726" stroke="${TONE.rim}" stroke-width="1.4"/><rect x="${h.door + 2}" y="${GROUND - 29}" width="10" height="4" fill="#f0b47a" opacity="0.6"/>`
  return (
    roof +
    `<rect x="${x0}" y="${top}" width="${w}" height="${GROUND + 2 - top}" fill="${fill}"/><rect x="${x0 - 1.5}" y="${top - 1}" width="${w + 3}" height="3.2" fill="${TONE.rim}"/>` +
    `<path d="${dark}" fill="${TONE.glassDark}"/>` +
    lit +
    `<path d="${marks}" stroke="#1c1929" stroke-width="0.9"/>` +
    door
  )
}

type Awning = { tx0: number; tx1: number; bx0: number; bx1: number; top: number; bot: number; stripes: number; colours: readonly [string, string, string, string] }

/** A striped, scalloped awning: the slope (shaded toward the wall), the valance and its scallops. */
function awning(uid: string, a: Awning): string {
  const tx = (i: number): number => a.tx0 + ((a.tx1 - a.tx0) * i) / a.stripes
  const bx = (i: number): number => a.bx0 + ((a.bx1 - a.bx0) * i) / a.stripes
  const band = a.bot + 5
  let slopeA = ''
  let slopeB = ''
  let valA = ''
  let valB = ''
  for (let i = 0; i < a.stripes; i++) {
    const quad = `M${d1(tx(i))} ${a.top}H${d1(tx(i + 1))}L${d1(bx(i + 1))} ${a.bot}H${d1(bx(i))}Z`
    const val = `M${d1(bx(i))} ${a.bot}V${band}A${d1((bx(i + 1) - bx(i)) / 2)} 4.5 0 0 0 ${d1(bx(i + 1))} ${band}V${a.bot}Z`
    if (i % 2 === 0) {
      slopeA += quad
      valA += val
    } else {
      slopeB += quad
      valB += val
    }
  }
  const [rose, cream, roseV, creamV] = a.colours
  return (
    `<path d="${slopeA}" fill="${rose}"/><path d="${slopeB}" fill="${cream}"/>` +
    `<path d="M${a.tx0} ${a.top}H${a.tx1}L${a.bx1} ${a.bot}H${a.bx0}Z" fill="url(#${uid}-awnshade)"/>` +
    `<path d="${valA}" fill="${roseV}"/><path d="${valB}" fill="${creamV}"/>` +
    `<path d="M${a.bx0} ${a.bot}H${a.bx1}" stroke="#fff6f0" stroke-width="0.8" opacity="0.45"/>` +
    `<rect x="${a.tx0 - 2}" y="${a.top - 2}" width="${a.tx1 - a.tx0 + 4}" height="2.6" rx="1" fill="#1a2622"/>`
  )
}

/** A warm-lit window of a neighbouring shop, its inside drawn by `inside`. */
function warmPane(uid: string, x: number, y: number, w: number, h: number, inside: string, anim: string): string {
  return (
    glow(uid, 'glow', x + w / 2, y + h / 2, w * 0.85, h * 0.95, 0.4, anim) +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${uid}-room)"/>` +
    inside +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${TONE.woodDeep}" stroke-width="2"/>`
  )
}

/** A shop door with warm glass, for the café and the bakery. */
const shopDoorSmall = (x: number): string =>
  `<rect x="${x}" y="214" width="26" height="80" fill="${TONE.woodDeep}"/><rect x="${x + 3}" y="218" width="20" height="34" fill="#f0b27a" opacity="0.75"/>`

/** The café next door on the left: sage awning, a counter with a cake dome under pendant lights, a table outside. */
function cafe(r: () => number, uid: string): string {
  const inside =
    '<path d="M-196 262h76v10h-76Z" fill="#6a3f2c"/><path d="M-196 232h76M-196 244h76" stroke="#8a5638" stroke-width="1.6"/>' +
    '<path d="M-178 262v-7q6-9 12 0v7Z" fill="#fff4e0" opacity="0.35"/><path d="M-176 262v-4h8v4Z" fill="#e8a4b0"/><path d="M-150 262v-9h10v9ZM-138 262v-5h6v5Z" fill="#4a3530"/>' +
    '<path d="M-192 232v-4h4v4ZM-184 232v-5h5v5ZM-174 232v-4h4v4ZM-160 244v-4h4v4ZM-152 244v-5h5v5ZM-142 244v-4h4v4ZM-130 232v-6h5v6Z" fill="#f2e6d6" opacity="0.8"/>' +
    `<path d="M-178 212v5M-158 212v7M-138 212v5" stroke="#4a3328" stroke-width="0.6"/>${spots([[-178, 218.5], [-158, 220.5], [-138, 218.5]], 1.6, '#fff3d0')}`
  return (
    '<path d="M-214 186h152v108h-152Z" fill="#30263a"/><path d="M-214 186h152v9h-152Z" fill="#3c2c40"/>' +
    warmPane(uid, -198, 212, 80, 60, inside, glimmer(r, 0.8, 1)) +
    awning(uid, { tx0: -208, tx1: -68, bx0: -214, bx1: -62, top: 192, bot: 204, stripes: 10, colours: ['#7c9d6b', '#e6dccb', '#6f8f60', '#d6cab8'] }) +
    shopDoorSmall(-108) +
    // the table and two chairs outside, a candle on the table
    '<g fill="#17141e"><ellipse cx="-150" cy="294" rx="10" ry="2.2"/><path d="M-151 294h2v16h-2ZM-155 310h10v1.4h-10Z"/>' +
    '<path d="M-170 310v-14h7v14h-1.2v-12.4h-4.6v12.4ZM-170.6 296l1-12h1.2l-1 12ZM-130 310v-14h-7v14h1.2v-12.4h4.6v12.4ZM-129.4 296l-1-12h-1.2l1 12Z"/></g>' +
    glow(uid, 'glow', -150, 289, 9, 7, 0.8) +
    '<path d="M-151 292h2v-3h-2Z" fill="#efe6da"/><circle cx="-150" cy="288" r="0.8" fill="#fff0c0"/>' +
    // a chalkboard A-frame with a doodled cup (no words)
    '<path d="M-56 312l5-26h10l5 26h-2l-4-21h-8l-4 21Z" fill="#3a2c26"/><path d="M-51.5 290h9l3.5 18h-16Z" fill="#20232a"/>' +
    '<path d="M-50 300h7v3a3.5 3.5 0 0 1-7 0ZM-43 301q2.5 0 1.5 2.5M-48.5 297q1-2 0-3M-45.5 297q1-2 0-3" fill="none" stroke="#dcd6cc" stroke-width="0.6" opacity="0.7"/>'
  )
}

/** The bakery on the right: butter awning, shelves of loaves, a pretzel sign on a bracket. */
function bakery(r: () => number, uid: string): string {
  let loaves = ''
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 7; i++) loaves += `M${d1(462 + i * 11 + (row % 2) * 4 + between(r, -1, 1))} ${226 + row * 15}q4-${d1(between(r, 4, 6))} 8 0Z`
  const inside =
    `<path d="M460 226h84M460 241h84M460 256h84" stroke="#7d4b33" stroke-width="1.6"/><path d="${loaves}" fill="#c4834a"/>` +
    '<path d="M460 268h84v6h-84Z" fill="#6a3f2c"/><path d="M478 268q6-8 12 0ZM500 268q7-9 14 0Z" fill="#d79a5c"/>'
  return (
    '<path d="M446 188h154v106h-154Z" fill="#2c2738"/>' +
    warmPane(uid, 458, 212, 88, 62, inside, glimmer(r, 0.8, 1)) +
    awning(uid, { tx0: 452, tx1: 594, bx0: 446, bx1: 600, top: 192, bot: 204, stripes: 10, colours: ['#d9b46c', '#efe4cf', '#c9a45e', '#ddd1bb'] }) +
    shopDoorSmall(560) +
    // the pretzel sign on its bracket
    `<path d="M446 166h-24M440 166l-12 8" stroke="${TONE.iron}" stroke-width="1.4" fill="none"/>` +
    `<g>${sway(428, 166, 3, 7, 2)}<path d="M428 166v5" stroke="${TONE.iron}" stroke-width="0.7"/><circle cx="428" cy="180" r="9" fill="#2a2433" stroke="${TONE.gold}" stroke-width="0.9"/>` +
    '<path d="M428 185c-6 0-6.5-8-2-8c3 0 4 6 2 8c-2-2-1-8 2-8c4.5 0 4 8-2 8" fill="none" stroke="#e0b070" stroke-width="1.2"/></g>'
  )
}

/** The whole street either side of the shop: townhouses, the café, the side street, the bakery. */
function streetLayer(r: () => number, uid: string): string {
  const left: House[] = [
    { x0: -334, x1: -212, top: 98, fill: '#262338', roof: 'gable', wins: [[-294, 120], [-262, 120], [-262, 160]], lit: { 0: LIGHTS[0], 2: LIGHTS[3] } },
    { x0: -216, x1: -60, top: 120, fill: '#2b2742', wins: [[-198, 140], [-170, 140], [-130, 140], [-102, 140]], lit: { 0: LIGHTS[2], 3: LIGHTS[0] } },
    { x0: -62, x1: 47, top: 74, fill: '#29253f', wins: [[-42, 96], [-14, 96], [16, 96], [-42, 138], [-14, 138], [16, 138], [-42, 200], [-14, 200]], lit: { 1: LIGHTS[1], 5: LIGHTS[0], 6: LIGHTS[2] }, live: [5], door: 14 },
  ]
  const right: House[] = [
    { x0: 352, x1: 448, top: 86, fill: '#29253f', roof: 'mansard', wins: [[364, 106], [394, 106], [424, 106], [364, 146], [394, 146], [424, 146], [372, 210]], lit: { 0: LIGHTS[0], 4: LIGHTS[3], 6: LIGHTS[1] }, live: [4], door: 412 },
    { x0: 444, x1: 602, top: 112, fill: '#2f2a45', wins: [[462, 132], [492, 132], [522, 132], [552, 132], [580, 132]], lit: { 1: LIGHTS[0], 4: LIGHTS[2] } },
    { x0: 598, x1: 680, top: 92, fill: '#252237', wins: [[612, 116], [626, 216]], lit: { 0: LIGHTS[1] } },
  ]
  return left.map(h => house(r, uid, h)).join('') + cafe(r, uid) + right.map(h => house(r, uid, h)).join('') + bakery(r, uid)
}

// ── The flower shop ─────────────────────────────────────────────────────────────────────

/** The two upper windows, drawn together: shutters, cream frames, lamplight behind curtains, flower boxes spilling over. */
function upperWindows(r: () => number, uid: string, accent: string): string {
  const W = 26
  const H = 32
  const y = 102
  const box = new Map<string, string>()
  let glows = ''
  let glass = ''
  let shutters = ''
  let slats = ''
  let frames = ''
  let curtains = ''
  let pots = ''
  let plants = ''
  let bars = ''
  let boxes = ''
  let trailing = ''
  for (const [x, light] of [
    [86, '#ffd193'],
    [228, '#f7b3ae'],
  ] as const) {
    glows += glow(uid, 'glow', x + W / 2, y + H / 2, 32, 30, 0.45)
    glass += `<rect x="${x}" y="${y}" width="${W}" height="${H}" fill="${light}">${glimmer(r, 0.8, 1)}</rect>`
    shutters += `M${x - 9} ${y}h7v${H}h-7ZM${x + W + 2} ${y}h7v${H}h-7Z`
    slats += `M${x - 5.5} ${y + 2}v${H - 2}M${x + W + 5.5} ${y + 2}v${H - 2}`
    frames += `M${x - 1.6} ${y - 1.6}h${W + 3.2}v${H + 3.2}h${-W - 3.2}Z`
    curtains += `M${x} ${y}h7q-4 ${H / 2} 1 ${H}h-8ZM${x + W} ${y}h-7q4 ${H / 2}-1 ${H}h8Z`
    pots += `M${x + 10} ${y + H}l1-5h5l1 5Z`
    plants += leaf(x + 13, y + H - 5, -120, 7, 2) + leaf(x + 13, y + H - 5, -70, 6, 1.8)
    bars += `M${x + W / 2} ${y}v${H}M${x} ${y + 14}h${W}`
    boxes += `M${x - 3} ${y + H + 1.6}h${W + 6}v6h${-W - 6}Z`
    trailing += leaf(x + 1, y + H + 4, 100, 7, 1.2) + leaf(x + W - 2, y + H + 4, 80, 8, 1.2) + leaf(x + 12, y + H + 5, 95, 5, 1)
    for (let i = 0; i < 7; i++) spot(box, i % 2 ? '#5f8a50' : '#7aa866', x - 0.5 + i * 4.5 + between(r, -0.6, 0.6), y + H + 1, between(r, 1.7, 2.3))
    for (let i = 0; i < 7; i++) spot(box, pick([accent, '#f4efe2', '#ff8fa8'], i), x - 0.5 + i * 4.5 + between(r, -1, 1), y + H - 0.6 - between(r, 0, 1.4), between(r, 1.1, 1.5))
  }
  return (
    glows +
    `<path d="${shutters}" fill="${TONE.wood}"/><path d="${slats}" stroke="${TONE.woodDeep}" stroke-width="5.6" stroke-dasharray=".8 2.2"/>` +
    `<path d="${frames}" fill="#b3a596"/>` +
    glass +
    `<path d="${curtains}" fill="#fff0ea" opacity="0.45"/><path d="${pots}" fill="#8a5038"/><path d="${plants}" fill="#6a6a34"/>` +
    `<path d="${bars}" stroke="#3b3146" stroke-width="1.2"/><path d="${boxes}" fill="#583b33"/><path d="${trailing}" fill="#5f8a50"/>` +
    spotted(box)
  )
}

/** The upper storey: chimneys, the side wall, plaster, cornice, two windows, a painted plaque, the fascia. */
function shopUpper(r: () => number, uid: string, p: Palette): string {
  return (
    `<path d="M66 ${CORNICE}V80h11v10ZM64.5 78h14v2.6h-14ZM68 78v-3h3v3ZM72.5 78v-2.5h3v2.5ZM262 ${CORNICE}V78h12v12ZM260.5 76h15v2.6h-15ZM264 76v-3h3v3ZM269 76v-2.4h3v2.4Z" fill="#2b2740"/>` +
    `<path d="M${SX1} ${CORNICE - 2}l5 3V${GROUND}h-5Z" fill="#221e34"/>` +
    `<rect x="${SX0}" y="${CORNICE}" width="${SX1 - SX0}" height="${FASCIA - CORNICE}" fill="url(#${uid}-plaster)"/>` +
    // the warmth the awning lights throw up the wall
    glow(uid, 'glow', 170, FASCIA, 150, 22, 0.3) +
    `<rect x="${SX0 - 3}" y="${CORNICE - 4}" width="${SX1 - SX0 + 6}" height="6" fill="#544a70"/><rect x="${SX0 - 3}" y="${CORNICE - 4}" width="${SX1 - SX0 + 6}" height="1.2" fill="#7a6f9a"/>` +
    `<rect x="${SX0}" y="${CORNICE + 2}" width="${SX1 - SX0}" height="1.6" fill="#241f37" opacity="0.8"/>` +
    upperWindows(r, uid, p.accent) +
    // a painted oval plaque with a tulip between the windows
    `<ellipse cx="170" cy="121" rx="13" ry="9" fill="${TONE.wood}" stroke="${TONE.gold}" stroke-width="0.8"/>` +
    `<path d="M170 128v-8" stroke="${TONE.stem}" stroke-width="0.9"/><path d="${leaf(170, 127, -150, 6, 1.4)}${leaf(170, 126, -30, 6, 1.4)}" fill="${p.accent2}"/>` +
    use(uid, 'tulip', 'translate(170 120.5) scale(0.9)', p.accent) +
    `<rect x="${SX0 - 2}" y="${FASCIA}" width="${SX1 - SX0 + 4}" height="${AWN_TOP - FASCIA}" fill="${TONE.wood}"/>` +
    `<rect x="${SX0 + 2}" y="${FASCIA + 2}" width="${SX1 - SX0 - 4}" height="${AWN_TOP - FASCIA - 5}" fill="none" stroke="${TONE.gold}" stroke-width="0.6" opacity="0.55"/>` +
    spots([[96, FASCIA + 5], [132, FASCIA + 5], [208, FASCIA + 5], [244, FASCIA + 5]], 1.2, p.accent, ' opacity="0.8"')
  )
}

/**
 * Pots and plants along a shelf at `y`, from x0 to x1, gathered by colour: on a `trailing` shelf mostly pothos spilling
 * over the edge, otherwise a mix of bushes, snake plants and flowering pots, each its own size.
 */
function shelfPlants(r: () => number, y: number, x0: number, x1: number, trailing: boolean, fills: Map<string, string>, blobs: Map<string, string>, trails: Map<string, string>, accent: string): void {
  let x = x0 + between(r, 1, 4)
  let i = 0
  while (x < x1 - 7) {
    const s = between(r, 0.75, 1.35)
    const pw = 6 * s
    const ph = 5 * s
    add(fills, pick(POTS, Math.floor(r() * 4)), `M${d1(x)} ${d1(y - ph)}h${d1(pw)}l-.9 ${d1(ph)}h${d1(1.8 - pw)}Z`)
    const cx = x + pw / 2
    const top = y - ph
    const green = pick(INSIDE_GREENS, i)
    const kind = trailing ? (r() < 0.7 ? 2 : 0) : Math.floor(r() * 4)
    if (kind === 1) {
      add(fills, green, leaf(cx, top, -100, 11 * s, 1.4) + leaf(cx, top, -76, 9 * s, 1.4) + leaf(cx, top, -124, 8 * s, 1.3))
    } else {
      spot(blobs, green, cx - 2 * s, top - 2, 2.5 * s)
      spot(blobs, green, cx + 2 * s, top - 2.5, 2.5 * s)
      spot(blobs, green, cx, top - 4 * s, 2.3 * s)
      if (kind === 2)
        add(trails, green, `M${d1(cx - 2)} ${d1(top)}q-3 6-1.5 ${d1(ph + between(r, 9, 16))}M${d1(cx + 2)} ${d1(top)}q3 5 1.5 ${d1(ph + between(r, 6, 13))}`)
      if (kind === 3) {
        spot(blobs, accent, cx - 1.6, top - 4.4 * s, 1)
        spot(blobs, accent, cx + 1.8, top - 3 * s, 1)
      }
    }
    x += pw + between(r, 5, 11)
    i++
  }
}

/** The florist's cat, sitting in the window, the tip of its tail flicking now and then. */
const CAT =
  '<g transform="translate(78 258)" fill="#2b1d24"><path d="M-4 0C-5-3-4.5-7-2.5-8.5C0-9 2.5-7 4-4C5-2 4.5 0 3 0ZM-5.2-10.2C-5.4-12-4.6-13.2-3.8-13.6L-3.4-15.6L-2.2-14C-1.4-14.1-.7-14-.1-13.7L1-15.4L1.2-13.1C1.8-12.2 1.7-10.6.7-9.5C-.6-8.4-4.3-8.4-5.2-10.2Z"/>' +
  '<path d="M3 0q4.5.5 4.8-3.5" fill="none" stroke="#2b1d24" stroke-width="1.4" stroke-linecap="round">' +
  '<animateTransform attributeName="transform" type="rotate" values="0 3 0;0 3 0;-14 3 0;0 3 0" keyTimes="0;.7;.85;1" dur="7s" begin="-2s" repeatCount="indefinite"/></path></g>'

/** A planter hanging from the window head on a cord, trailing greens, swaying a little. */
function hanger(r: () => number, x: number, len: number): string {
  const y = WY0 + len
  let trail = ''
  for (const dx of [-3.5, -1, 2, 4]) trail += `M${x + dx} ${y}q${d1(dx * 0.8)} ${d1(between(r, 5, 8))} ${d1(dx * 0.3)} ${d1(between(r, 10, 18))}`
  return (
    `<g><path d="M${x} ${WY0}v${len}" stroke="#5a3a2a" stroke-width="0.6"/><path d="M${x - 5} ${y}q5 7 10 0Z" fill="#9a5640"/>` +
    spots([[x - 2.5, y - 1], [x + 2.5, y - 1.2], [x, y - 2.5]], 2.2, '#5d6c33') +
    `<path d="${trail}" fill="none" stroke="#56652f" stroke-width="1.1" stroke-linecap="round"/>` +
    sway(x, WY0, 3, between(r, 7, 10), between(r, 0, 8)) +
    '</g>'
  )
}

/** The big window: warm room, shelves of plants, hanging planters, pendant lamp, glass, frame, ledge, riser. */
function shopWindow(r: () => number, uid: string, accent: string): string {
  const W = WX1 - WX0
  const fills = new Map<string, string>()
  const blobs = new Map<string, string>()
  const trails = new Map<string, string>()
  shelfPlants(r, 229, WX0 + 1, 152, true, fills, blobs, trails, accent)
  shelfPlants(r, 249, WX0 + 1, 152, false, fills, blobs, trails, accent)
  // on the display bench at the bottom: a pot of fern and a big monstera; a tall fig in the far corner of the right pane
  add(fills, '#a85d43', 'M92 258h7l-1-6h-5ZM126 258h10l-1-9h-8Z')
  add(fills, '#4f6a32', leaf(131, 249, -100, 15, 4.2) + leaf(131, 249, -55, 13, 4) + leaf(131, 249, -140, 12, 3.6))
  add(fills, '#6b8a3a', leaf(95.5, 252, -150, 9, 1.3) + leaf(95.5, 252, -115, 10, 1.3) + leaf(95.5, 252, -70, 10, 1.3) + leaf(95.5, 252, -30, 9, 1.3))
  add(fills, '#4c5b2c', `M192.4 249v-27h1.2v27Z${leaf(193, 238, -150, 8, 2.4)}${leaf(193, 232, -35, 8, 2.4)}${leaf(193, 226, -145, 7, 2.2)}${leaf(193, 222, -60, 7, 2.2)}${leaf(193, 244, -30, 7, 2.2)}`)
  const room =
    `<rect x="${WX0}" y="${WY0}" width="${W}" height="${WY1 - WY0}" fill="url(#${uid}-room)"/>` +
    glow(uid, 'glow', 118, 218, 96, 50, 0.85, glimmer(r, 0.75, 1)) +
    `<path d="M${WX0} 229h${W}M${WX0} 249h${W}" stroke="#7d4b33" stroke-width="1.8"/>` +
    `<path d="M${WX0} 258h${W}v8h${-W}Z" fill="#6e412c"/><path d="M${WX0} 258h${W}" stroke="#9a6243" stroke-width="0.8"/>` +
    filled(fills) +
    spotted(blobs) +
    [...trails].map(([c, d]) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.1" stroke-linecap="round"/>`).join('') +
    hanger(r, 80, 14) +
    hanger(r, 142, 11) +
    CAT +
    // the pendant lamp
    `<path d="M118 ${WY0}v7" stroke="#4a3328" stroke-width="0.6"/><path d="M112.5 213q5.5-8 11 0Z" fill="#3a2a24"/>` +
    glow(uid, 'bulb', 118, 214, 7, 5, 1) +
    `<circle cx="118" cy="213.6" r="1.4" fill="#fff6dc"/>` +
    // the glass catching the street
    `<path d="M70 ${WY1}L102 ${WY0}h9L79 ${WY1}ZM150 ${WY1}L176 ${WY0}h4L154 ${WY1}Z" fill="#ffffff" opacity="0.07"/>`
  const third = W / 3
  const frame =
    `<rect x="${WX0}" y="${WY0}" width="${W}" height="${WY1 - WY0}" fill="none" stroke="${TONE.woodDeep}" stroke-width="3"/>` +
    `<path d="M${WX0} ${WY0 + 10}h${W}" stroke="${TONE.woodDeep}" stroke-width="2.2"/>` +
    `<path d="M${d1(WX0 + W / 5)} ${WY0}v10M${d1(WX0 + (2 * W) / 5)} ${WY0}v10M${d1(WX0 + (3 * W) / 5)} ${WY0}v10M${d1(WX0 + (4 * W) / 5)} ${WY0}v10" stroke="${TONE.woodDeep}" stroke-width="1.3"/>` +
    `<path d="M${d1(WX0 + third)} ${WY0 + 10}V${WY1}M${d1(WX0 + 2 * third)} ${WY0 + 10}V${WY1}" stroke="${TONE.woodDeep}" stroke-width="2.4"/>` +
    `<rect x="${WX0 + 2.5}" y="${WY0 + 2.5}" width="${W - 5}" height="${WY1 - WY0 - 5}" fill="none" stroke="${TONE.gold}" stroke-width="0.5" opacity="0.4"/>`
  const ledge =
    `<rect x="${WX0 - 4}" y="${WY1}" width="${W + 8}" height="3.4" fill="${TONE.ledge}"/><rect x="${WX0 - 4}" y="${WY1 + 3.4}" width="${W + 8}" height="1.6" fill="#0e1613" opacity="0.6"/>` +
    `<path d="M62 274h64v15h-64ZM132 274h64v15h-64Z" fill="#1d2b27" stroke="${TONE.woodLit}"/>`
  return `<g clip-path="url(#${uid}-winclip)">${room}</g>` + frame + ledge
}

/** The door: lit transom, glass with a little sign swinging on it, panels, brass knob, a step. */
function shopDoor(r: () => number, uid: string, accent: string): string {
  const w = DX1 - DX0
  const cx = (DX0 + DX1) / 2
  return (
    `<rect x="${DX0 - 2}" y="${WY0 - 2}" width="${w + 4}" height="${GROUND - WY0 + 2}" fill="${TONE.woodDeep}"/>` +
    `<rect x="${DX0}" y="${WY0}" width="${w}" height="9" fill="#f3b678" opacity="0.85"/><path d="M${cx} ${WY0 + 9}l-9-9M${cx} ${WY0 + 9}v-9M${cx} ${WY0 + 9}l9-9" stroke="${TONE.woodDeep}" stroke-width="0.8"/>` +
    `<rect x="${DX0}" y="${WY0 + 11}" width="${w}" height="${GROUND - WY0 - 11}" fill="${TONE.wood}"/>` +
    `<rect x="${DX0 + 4}" y="${WY0 + 15}" width="${w - 8}" height="36" fill="url(#${uid}-room)" opacity="0.9"/>` +
    `<path d="M${DX0 + 7} ${WY0 + 51}v-9h6v9Z" fill="#a85d43" opacity="0.7"/>${spots([[DX0 + 10, WY0 + 39], [DX0 + 7, WY0 + 42]], 3, '#5d6c33', ' opacity="0.8"')}` +
    `<path d="M${cx} ${WY0 + 15}v36M${DX0 + 4} ${WY0 + 33}h${w - 8}" stroke="${TONE.woodDeep}" stroke-width="1.1"/>` +
    `<path d="M${DX0 + 4} ${WY0 + 57}h${w - 8}v13h${8 - w}ZM${DX0 + 4} ${WY0 + 74}h${w - 8}v14h${8 - w}Z" fill="none" stroke="${TONE.woodLit}"/>` +
    `<circle cx="${DX1 - 5}" cy="${WY0 + 54}" r="1.5" fill="${TONE.gold}"/>` +
    // the little sign on its string: no words, a painted rose
    `<g>${sway(cx, WY0 + 20, 3.5, 6, between(r, 0, 6))}<path d="M${cx - 6} ${WY0 + 26}L${cx} ${WY0 + 20}L${cx + 6} ${WY0 + 26}" fill="none" stroke="#3a2a24" stroke-width="0.5"/>` +
    `<rect x="${cx - 8}" y="${WY0 + 25.5}" width="16" height="8.5" rx="1.6" fill="#efe3d1"/><circle cx="${cx - 3.5}" cy="${WY0 + 29.8}" r="1.4" fill="${accent}"/>` +
    `<path d="M${cx} ${WY0 + 29}h5M${cx} ${WY0 + 31}h3.5" stroke="#b8a892" stroke-width="0.7"/></g>` +
    `<rect x="${DX0 - 4}" y="${GROUND - 1}" width="${w + 8}" height="4" fill="#3b3550"/>`
  )
}

/** A wavy climbing stem from `a` to `b`, with leaves and roses along it, gathered into `greens` and `blooms`. */
function vine(r: () => number, a: Pt, b: Pt, amp: number, leaves: number, greens: Map<string, string>, blooms: Map<string, string>, accent: string): string {
  const at = (t: number, wave: number): Pt => [a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI * 3) * amp * wave, a[1] + (b[1] - a[1]) * t]
  const steps = 6
  let d = `M${d1(a[0])} ${d1(a[1])}`
  for (let i = 1; i <= steps; i++) {
    const [cx, cy] = at((i - 0.5) / steps, 1.6)
    const [x, y] = at(i / steps, 1)
    d += `Q${d1(cx)} ${d1(cy)} ${d1(x)} ${d1(y)}`
  }
  for (let i = 0; i < leaves; i++) {
    const [x, y] = at((i + 0.5) / leaves, 1)
    const side = i % 2 === 0 ? -1 : 1
    add(greens, i % 3 === 0 ? '#86b373' : '#5d8a52', leaf(x, y, side < 0 ? between(r, 190, 230) : between(r, -50, -10), between(r, 4.5, 6.5), between(r, 1.6, 2.2)))
    if (i % 3 === 1) {
      const bx = x + side * between(r, 2, 4)
      const by = y - between(r, 1, 3)
      spot(blooms, accent, bx, by, between(r, 1.8, 2.3))
      spot(blooms, '#e0708d', bx + 0.3, by + 0.2, 0.9)
    }
  }
  return d
}

/** The trellis beside the door and the climbing rose on it, which carries on up the corner above the awning. */
function trellis(r: () => number, uid: string, accent: string): string {
  const span = GROUND - TRELLIS_TOP
  const greens = new Map<string, string>()
  const blooms = new Map<string, string>()
  const stems =
    vine(r, [TX0 + 9, GROUND], [TX1 - 8, TRELLIS_TOP + 4], 4, 11, greens, blooms, accent) +
    vine(r, [TX1 - 3, GROUND - 4], [TX0 + 6, TRELLIS_TOP + 14], 3, 7, greens, blooms, accent) +
    vine(r, [SX1 - 6, AWN_TOP + 2], [SX1 - 4, 98], 3, 10, greens, blooms, accent)
  return (
    `<rect x="${TX0}" y="${TRELLIS_TOP}" width="${TX1 - TX0}" height="${span}" fill="url(#${uid}-lattice)" stroke="#8b7862" stroke-width="1.3" opacity="0.6"/>` +
    `<path d="${stems}" fill="none" stroke="#4a6b3e"/>` +
    filled(greens) +
    spotted(blooms)
  )
}

/** The string lights swagged under the awning: a wire, glowing bulbs, every other one twinkling. */
function stringLights(r: () => number, uid: string): string {
  const y = AWN_BOT + 5.5
  const anchors = Array.from({ length: 8 }, (_, k) => SX0 - 6 + ((SX1 - SX0 + 12) * k) / 7)
  let wire = `M${SX0 - 6} ${y}`
  const bulbs: Array<readonly [number, number, boolean]> = []
  anchors.forEach((x, k) => {
    bulbs.push([x, y + 1.6, false])
    const next = anchors[k + 1]
    if (next === undefined) return
    wire += `Q${d1((x + next) / 2)} ${y + 13} ${d1(next)} ${y}`
    bulbs.push([(x + next) / 2, y + 7.6, true])
  })
  const cores = new Map<string, string>()
  let halos = ''
  bulbs.forEach(([x, by, live], i) => {
    if (live && i % 4 !== 3) halos += glow(uid, 'bulb', x, by, 5.5, 5.5, 1, loop('opacity', '0.95;0.4;0.95', between(r, 3, 6), between(r, 0, 6), ease(2)))
    spot(cores, pick(['#fff2cc', '#ffd99e', '#ffe6c4'], i), x, by, 1.2)
  })
  // the warmth of the whole string along the valance
  return glow(uid, 'bulb', (SX0 + SX1) / 2, y + 5, (SX1 - SX0) / 2 + 14, 9, 0.55) + `<path d="${wire}" fill="none" stroke="#1b1622" stroke-width="0.6"/>` + halos + spotted(cores)
}

/** The shop as a whole, back to front. */
function shopLayer(r: () => number, uid: string, p: Palette): string {
  return (
    shopUpper(r, uid, p) +
    `<rect x="${SX0}" y="${AWN_TOP}" width="${SX1 - SX0}" height="${GROUND - AWN_TOP}" fill="${TONE.wood}"/>` +
    `<path d="M${SX0} ${AWN_TOP}h5V${GROUND}h-5ZM${SX1 - 5} ${AWN_TOP}h5V${GROUND}h-5Z" fill="${TONE.woodLit}"/>` +
    `<rect x="${SX0}" y="${AWN_BOT}" width="${SX1 - SX0}" height="18" fill="url(#${uid}-awnshade)"/>` +
    glow(uid, 'glow', (WX0 + WX1) / 2, 236, 108, 64, 0.42, glimmer(r, 0.7, 1)) +
    shopWindow(r, uid, p.accent) +
    shopDoor(r, uid, p.accent) +
    trellis(r, uid, p.accent) +
    awning(uid, { tx0: SX0 + 6, tx1: SX1 - 6, bx0: SX0 - 6, bx1: SX1 + 6, top: AWN_TOP, bot: AWN_BOT, stripes: 14, colours: ['#e98ea3', '#ecdcd0', '#dc8299', '#ddccc0'] }) +
    stringLights(r, uid)
  )
}

// ── The pavement and what stands on it ──────────────────────────────────────────────────

/** Pavement with its joints, the kerb, the road, and the pools of light the windows and lamps throw. */
function pavementLayer(uid: string): string {
  return (
    `<rect x="${L}" y="${GROUND}" width="${R - L}" height="${KERB - GROUND}" fill="url(#${uid}-pave)"/>` +
    `<g stroke="#1b1826" opacity="0.55"><path d="M${L} 306H${R}M${L} 318H${R}" stroke-width="0.6"/><path d="M${L} 300H${R}M${L} 324H${R}" stroke-width="12" stroke-dasharray=".6 25.4"/><path d="M${L + 13} 312H${R}" stroke-width="12" stroke-dasharray=".6 25.4"/></g>` +
    glow(uid, 'glow', (WX0 + WX1) / 2, GROUND + 8, 96, 16, 0.55) +
    glow(uid, 'glow', (DX0 + DX1) / 2, GROUND + 5, 24, 7, 0.5) +
    glow(uid, 'glow', -158, GROUND + 7, 56, 12, 0.5) +
    glow(uid, 'glow', 502, GROUND + 7, 60, 12, 0.5) +
    `<rect x="${L}" y="${KERB}" width="${R - L}" height="2" fill="#4a4462"/><rect x="${L}" y="${KERB + 2}" width="${R - L}" height="5" fill="#1f1c29"/>` +
    `<rect x="${L}" y="${KERB + 7}" width="${R - L}" height="${470 - KERB}" fill="#1a1822"/>` +
    // the lit window again in the damp road, faintly
    glow(uid, 'glow', (WX0 + WX1) / 2, KERB + 18, 64, 10, 0.2)
  )
}

/** An old street lamp: its glow, the light pool at its foot, pole, collar and lantern. */
function streetLamp(uid: string, x: number, base: number, top: number, anim: string): string {
  return (
    glow(uid, 'glow', x, top + 11, 60, 60, 1, anim) +
    glow(uid, 'bulb', x, top + 11, 16, 16, 0.85) +
    glow(uid, 'glow', x, base + 1, 44, 8, 0.6) +
    `<path d="M${x - 1.6} ${base - 9}V${top + 20}h3.2V${base - 9}ZM${x - 6} ${base}l1.5-9h9l1.5 9ZM${x - 3} ${(base + top) / 2}h6v3h-6ZM${x - 5.5} ${top + 19}h11l-2-2h-7ZM${x - 8.5} ${top + 4.5}L${x} ${top - 3}L${x + 8.5} ${top + 4.5}Z${dot(x, top - 4.5, 1.4)}" fill="${TONE.iron}"/>` +
    `<path d="M${x - 6.5} ${top + 5}h13l-1.8 12h-9.4Z" fill="${TONE.lamp}"/>` +
    `<path d="M${x - 2.2} ${top + 5}l-.6 12M${x + 2.2} ${top + 5}l.6 12M${x - 1.6} ${top + 21}q-6 1-7 6M${x + 1.6} ${top + 21}q6 1 7 6" fill="none" stroke="${TONE.iron}"/>`
  )
}

/** A powder-blue step-through bicycle leaning on the shop window, a basket of tulips on the front. */
function bicycle(uid: string, x: number, y: number, p: Palette): string {
  const wheel = (cx: number): string =>
    `<circle cx="${cx}" cy="${y}" r="12" fill="none" stroke="#121018" stroke-width="2.4"/><circle cx="${cx}" cy="${y}" r="10.4" fill="none" stroke="#b8c2d4" stroke-width="0.6" opacity="0.65"/>` +
    `<circle cx="${cx}" cy="${y}" r="1.2" fill="#c9cfdb"/>`
  const fx = x + 42
  return (
    `<ellipse cx="${x + 21}" cy="${y + 12.5}" rx="34" ry="2.6" fill="#0d0b12" opacity="0.45"/>` +
    wheel(x) +
    wheel(fx) +
    `<path d="M${x - 12.5} ${y - 1}A13 13 0 0 1 ${x + 9} ${y - 9.5}M${x + 31} ${y - 8}A13 13 0 0 1 ${x + 53} ${y - 2}" fill="none" stroke="#e5d9c8" stroke-width="1.4"/>` +
    `<path d="M${x} ${y}L${x + 17} ${y + 2}L${x + 12} ${y - 21}L${x} ${y}M${x + 17} ${y + 2}Q${x + 25} ${y + 1} ${x + 33} ${y - 15}L${x + 31} ${y - 22}M${x + 33} ${y - 15}L${fx} ${y}M${x + 31} ${y - 22}l-1-4q-5-1-8 2" fill="none" stroke="#9fb6d8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M${x + 7} ${y - 23.5}q4-2 10 0l-1 1.6h-8Z" fill="#3a2c2a"/><path d="M${x + 12} ${y - 1}q5 4 10 0" fill="none" stroke="#7f95b8" stroke-width="1.6"/>` +
    // the basket of tulips and baby's breath
    `<path d="M${fx - 2} ${y - 31}l-2-8M${fx + 2} ${y - 31}l1-10M${fx + 5} ${y - 31}l3-7" stroke="${TONE.stem}" stroke-width="0.8"/>` +
    use(uid, 'tulip', `translate(${fx - 4} ${y - 38}) rotate(-12)`, '#f47c97') +
    use(uid, 'tulip', `translate(${fx + 3} ${y - 40})`, '#ffb3c3') +
    use(uid, 'tulip', `translate(${fx + 8} ${y - 37}) rotate(16)`, p.accent) +
    spots([[fx - 6, y - 32], [fx - 3.5, y - 34], [fx + 9, y - 33], [fx + 6.5, y - 35]], 0.95, '#f6efe6') +
    `<path d="${leaf(fx - 3, y - 31, 200, 7, 1.6)}${leaf(fx + 5, y - 31, -25, 7, 1.6)}" fill="#6f9a5f"/>` +
    `<path d="M${fx - 8} ${y - 31}h16l-2 11h-12Z" fill="#b08654"/><path d="M${fx - 8} ${y - 27.5}h15.4M${fx - 7.4} ${y - 24}h14.2M${fx - 4} ${y - 31}l1 11M${fx} ${y - 31}v11M${fx + 4} ${y - 31}l-1 11" stroke="#7e5a35" stroke-width="0.6"/>` +
    `<path d="M${fx - 8.5} ${y - 31}h17" stroke="#d1a872"/>`
  )
}

/** A zinc bucket standing at (cx, base). */
function bucket(uid: string, cx: number, base: number, w: number, h: number): string {
  const t = w / 2
  const b = w * 0.38
  return (
    `<ellipse cx="${cx}" cy="${base + 0.6}" rx="${d1(t + 3)}" ry="2" fill="#0d0b12" opacity="0.45"/>` +
    `<path d="M${d1(cx - t)} ${base - h}H${d1(cx + t)}L${d1(cx + b)} ${base}H${d1(cx - b)}Z" fill="url(#${uid}-zinc)"/>` +
    `<path d="M${d1(cx - t * 0.93)} ${d1(base - h * 0.62)}H${d1(cx + t * 0.93)}M${d1(cx - t * 0.84)} ${d1(base - h * 0.25)}H${d1(cx + t * 0.84)}" stroke="#3f4756" stroke-width="0.7"/>` +
    `<ellipse cx="${cx}" cy="${base - h}" rx="${d1(t)}" ry="1.6" fill="#24212d" stroke="#b6bfcd" stroke-width="0.7"/>`
  )
}

type BunchKind = 'tulip' | 'rose' | 'sunflower' | 'lavender'

/** A bunch of one kind of flower standing in a bucket or crate whose mouth is at (cx, mouth), swaying when `live`. */
function bunch(r: () => number, uid: string, kind: BunchKind, cx: number, mouth: number, spread: number, height: number, count: number, colours: readonly string[], live: boolean): string {
  const greens = new Map<string, string>()
  const blobs = new Map<string, string>()
  const spikes = new Map<string, string>()
  let stems = ''
  let swirls = ''
  let uses = ''
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const hx = cx + (t - 0.5) * spread * 2 + between(r, -1.5, 1.5)
    const hy = mouth - height * between(r, 0.7, 1)
    const tilt = (t - 0.5) * 30
    stems += `M${d1(cx + (t - 0.5) * 4)} ${mouth + 1}Q${d1((cx + hx) / 2)} ${d1((mouth + hy) / 2)} ${d1(hx)} ${d1(hy)}`
    const colour = pick(colours, i)
    if (kind === 'tulip') {
      uses += use(uid, 'tulip', `translate(${d1(hx)} ${d1(hy + 1)}) rotate(${d1(tilt)}) scale(1.15)`, colour)
      if (i % 2 === 0) add(greens, '#6f9a5f', leaf(cx + (t - 0.5) * 6, mouth, -90 + (t - 0.5) * 70, height * 0.6, 1.6))
    } else if (kind === 'rose') {
      spot(blobs, colour, hx, hy, 2.9)
      swirls += `M${d1(hx - 1.3)} ${d1(hy)}a1.3 1.3 0 1 1 1.3 1.3`
      add(greens, '#4f7a46', leaf(hx, hy + 3, t < 0.5 ? 200 : -20, 4, 1.4))
    } else if (kind === 'sunflower') {
      uses += use(uid, 'sun', `translate(${d1(hx)} ${d1(hy)}) rotate(${d1(tilt)})`, colour)
      spot(blobs, '#5b3a25', hx, hy, 2.4)
      add(greens, '#5d8a52', leaf(hx + (t < 0.5 ? -1 : 1), hy + 10, t < 0.5 ? 205 : -25, 8, 3))
    } else {
      add(spikes, colour, `M${d1(hx)} ${d1(hy)}l${d1(tilt / 10)}-9`)
    }
  }
  const lavender = [...spikes].map(([c, d]) => `<path d="${d}" stroke="${c}" stroke-width="2.2" stroke-dasharray="1.3 .7" stroke-linecap="round"/>`).join('')
  const motion = live ? sway(cx, mouth, 1.6, between(r, 6, 9), between(r, 0, 6)) : ''
  return `<g><path d="${stems}" fill="none" stroke="${TONE.stem}" stroke-width="${kind === 'sunflower' ? 1.2 : 0.8}"/>${filled(greens)}${uses}${spotted(blobs)}${swirls ? `<path d="${swirls}" fill="none" stroke="#b8405f" stroke-width="0.7"/>` : ''}${lavender}${motion}</g>`
}

/** A slatted wooden crate standing at (x, base). */
function crate(x: number, base: number, w: number, h: number): string {
  return (
    `<ellipse cx="${x + w / 2}" cy="${base + 0.6}" rx="${w / 2 + 3}" ry="2" fill="#0d0b12" opacity="0.45"/>` +
    `<rect x="${x}" y="${base - h}" width="${w}" height="${h}" fill="${TONE.crate}"/>` +
    `<path d="M${x} ${d1(base - h * 0.66)}h${w}M${x} ${d1(base - h * 0.33)}h${w}M${x + 1.2} ${base - h}v${h}M${x + w - 1.2} ${base - h}v${h}" stroke="${TONE.crateDark}" stroke-width="1.4"/>` +
    `<path d="M${x} ${base - h}h${w}" stroke="${TONE.crateLit}" stroke-width="1.2"/>`
  )
}

/** The flowers for sale on the pavement: buckets by the door, crates by the lamp and on the corner. */
function flowerStall(r: () => number, uid: string, p: Palette): string {
  return (
    // by the door: sunflowers tall at the back, tulips and roses in front
    bucket(uid, 274, 300, 17, 15) +
    bunch(r, uid, 'sunflower', 274, 285, 7, 34, 3, ['#f6c04e', '#f2b33f'], true) +
    bucket(uid, 255, 306, 16, 14) +
    bunch(r, uid, 'tulip', 255, 292, 6, 16, 4, [p.accent, '#f47c97', '#ffc2cf'], false) +
    bucket(uid, 294, 308, 16, 14) +
    bunch(r, uid, 'rose', 294, 294, 5, 13, 4, ['#e8678a', '#f28aa2', '#d9587a'], true) +
    // the corner: a crate of lavender
    crate(300, 312, 30, 13) +
    bunch(r, uid, 'lavender', 315, 299, 11, 7, 6, ['#a68ad8', '#b9a2e6', '#9b80cf'], false) +
    // by the lamp, in front of the house next door: butter tulips and lavender
    crate(-2, 310, 28, 14) +
    bunch(r, uid, 'tulip', 6, 296, 5, 11, 3, ['#ffe3a0', '#f6efe6', '#ffd27a'], false) +
    bunch(r, uid, 'lavender', 19, 296, 4, 7, 3, ['#a68ad8', '#b9a2e6'], false)
  )
}

/** A clipped little tree in a planter. */
const pottedTree = (x: number, base: number): string =>
  `<ellipse cx="${x}" cy="${base + 0.6}" rx="10" ry="2" fill="#0d0b12" opacity="0.45"/><path d="M${x - 7} ${base - 12}h14l-2 12h-10Z" fill="#3b3043"/>` +
  `<rect x="${x - 0.9}" y="${base - 32}" width="1.8" height="20" fill="#3b2c2a"/><circle cx="${x}" cy="${base - 38}" r="11" fill="#2c4636"/><circle cx="${x - 3.5}" cy="${base - 41}" r="6.5" fill="#37563f"/>`

/** A park bench of iron and slats. */
const bench = (x: number, base: number): string =>
  `<path d="M${x + 3} ${base}v-12M${x + 45} ${base}v-12M${x + 4} ${base - 12}l-1-14M${x + 44} ${base - 12}l1-14" stroke="${TONE.iron}" stroke-width="1.6"/>` +
  `<path d="M${x} ${base - 13}h48v2.4h-48ZM${x + 2} ${base - 21}h44v2.2h-44ZM${x + 2} ${base - 26}h44v2.2h-44Z" fill="#4d3a33"/>`

/** Everything standing on the pavement, left to right. */
function pavementThings(r: () => number, uid: string, p: Palette): string {
  return (
    streetLamp(uid, -236, 312, 136, '') +
    bench(-300, 312) +
    pottedTree(-66, 312) +
    pottedTree(362, 312) +
    bench(376, 312) +
    pottedTree(438, 312) +
    streetLamp(uid, 512, 312, 136, '') +
    streetLamp(uid, LX, 314, 130, glimmer(r, 0.65, 0.9)) +
    bicycle(uid, 74, 294, p) +
    flowerStall(r, uid, p)
  )
}

// ── The vase gauge ──────────────────────────────────────────────────────────────────────

/** A tulip in the vase: closed, its petals hug; open, they fan out. It grows as it opens. */
function vaseTulip(x: number, y: number, o: number, tilt: number, outer: string, inner: string): string {
  const spread = d1(4 + 30 * o)
  const shift = d1(0.4 + 1.4 * o)
  return (
    `<g transform="translate(${d1(x)} ${d1(y)}) rotate(${tilt}) scale(${n(0.8 + 0.45 * o)})" fill="${outer}">` +
    `<ellipse cx="-${shift}" cy="-3.3" rx="1.8" ry="3.5" transform="rotate(-${spread})"/><ellipse cx="${shift}" cy="-3.3" rx="1.8" ry="3.5" transform="rotate(${spread})"/>` +
    `<ellipse cy="${d1(-3.4 - 0.5 * o)}" rx="${d1(1.7 + 0.5 * o)}" ry="3.8" fill="${inner}"/></g>`
  )
}

/** A rose in the vase: a tight bud in green sepals, opening into layered petals. */
function vaseRose(x: number, y: number, o: number, outer: string, deep: string): string {
  const rad = 1.7 + 2.7 * o
  const cy = y - rad * 0.8
  const sepals = o < 0.6 ? `<path d="${leaf(x, y, -140, 3.6 * (1 - o), 1)}${leaf(x, y, -40, 3.6 * (1 - o), 1)}" fill="#6f9a5f"/>` : ''
  return (
    `<path d="${dot(x, cy, rad)}" fill="${outer}"/><path d="${dot(x + rad * 0.08, cy + rad * 0.06, rad * 0.6)}" fill="${deep}"/>` +
    `<path d="M${d1(x - rad * 0.3)} ${d1(cy)}a${d1(rad * 0.3)} ${d1(rad * 0.3)} 0 1 1 ${d1(rad * 0.3)} ${d1(rad * 0.3)}M${d1(x - rad * 0.75)} ${d1(cy - rad * 0.3)}q${d1(rad * 0.5)} ${d1(-rad * 0.6)} ${d1(rad * 1.2)} ${d1(-rad * 0.2)}" fill="none" stroke="#ffc7d2" stroke-width="0.55" opacity="0.8"/>` +
    sepals
  )
}

/** A cream cosmos in the vase: a green bud whose petals lengthen as it opens. */
function vaseCosmos(x: number, y: number, o: number): string {
  let petals = ''
  for (let k = 0; k < 6; k++) petals += leaf(x, y, k * 60 + 10, 0.9 + 3.6 * o, 0.8 + 0.7 * o)
  return `<path d="${petals}" fill="${o < 0.2 ? '#dfe8c8' : '#fbf0e8'}"/><path d="${dot(x, y, 0.9 + 0.7 * o)}" fill="#f2c14e"/>`
}

/** The heads of the bouquet: kind, offset from the vase mouth, tilt. */
const BOUQUET: ReadonlyArray<{ kind: 'tulip' | 'rose' | 'cosmos'; dx: number; dy: number; tilt: number }> = [
  { kind: 'tulip', dx: -12, dy: -14, tilt: -30 },
  { kind: 'cosmos', dx: -6, dy: -24, tilt: 0 },
  { kind: 'rose', dx: 1, dy: -29, tilt: 0 },
  { kind: 'tulip', dx: 9, dy: -22, tilt: 16 },
  { kind: 'rose', dx: 13, dy: -11, tilt: 0 },
  { kind: 'cosmos', dx: -1, dy: -14, tilt: 0 },
]
/** Sprigs of baby's breath: more of them the further the bouquet has opened. */
const SPRIGS: readonly Pt[] = [[-15, -20], [-9, -31], [6, -30], [15, -18], [-3, -34], [11, -27], [-14, -8], [17, -6]]

/**
 * The tall glass vase on the window ledge: water rising with the context (none while unmeasured), the bouquet
 * growing and opening with it, a bubble or two rising, the glass catching the light.
 */
function vaseGauge(uid: string, context: number | undefined, p: Palette): { defs: string; body: string } {
  const o = context ?? 0
  const g = 0.78 + 0.22 * o
  const wide = 0.8 + 0.2 * o
  const floor = VB - 3.5
  const brim = VT + 3.5
  const level = floor - o * (floor - brim)
  const heads = BOUQUET.map(b => ({ ...b, x: VX + b.dx * wide, y: VT + b.dy * g }))
  let stems = ''
  for (const h of heads) stems += `M${d1(VX + h.dx * 0.18)} ${floor - 1}Q${d1(VX + h.dx * 0.3)} ${VT + 6} ${d1(h.x)} ${d1(h.y)}`
  const pace = sway(VX, floor, 1.3, 9, 3)
  const foliage =
    `<path d="${leaf(VX - 4, VT, 200, 10 * g, 2.3)}${leaf(VX + 4, VT, -18, 10 * g, 2.3)}${leaf(VX - 2, VT - 3, 236, 10 * g, 1.9)}" fill="#6f9e5f"/>` +
    `<path d="${leaf(VX + 2, VT - 2, -62, 9 * g, 1.9)}${leaf(VX - 6, VT - 1, 172, 7 * g, 1.7)}" fill="#8fbf78"/>`
  let blooms = ''
  heads.forEach((h, i) => {
    if (h.kind === 'tulip') blooms += vaseTulip(h.x, h.y, o, h.tilt, i === 0 ? '#f47c97' : '#ff9fb4', i === 0 ? p.accent : '#ffd0da')
    else if (h.kind === 'rose') blooms += vaseRose(h.x, h.y, o, i === 2 ? '#f28aa2' : '#ffb3c3', i === 2 ? '#d9587a' : '#f47c97')
    else blooms += vaseCosmos(h.x, h.y, o)
  })
  const shown = SPRIGS.slice(0, Math.round(o * SPRIGS.length))
  const breath = shown.length > 0 ? spots(shown.map(([dx, dy]) => [VX + dx * wide, VT + dy * g] as const), 0.9, '#f8f1ea') : ''
  let water = ''
  if (context !== undefined && o > 0.01) {
    const rise = floor - level - 3
    const bubbles =
      o > 0.15
        ? [VX - 3, VX + 4].map((bx, i) => `<circle cx="${bx}" cy="${floor - 2}" r="0.7" fill="#ffffff" opacity="0.7">${drift(`0 0;${i ? -1 : 1} ${d1(-rise)}`, 4.5 + i * 1.7, i * 2.1)}</circle>`).join('')
        : ''
    water =
      `<g clip-path="url(#${uid}-vclip)"><rect x="${VX - 10}" y="${d1(level)}" width="20" height="${d1(floor - level + 1)}" fill="url(#${uid}-water)"/>${bubbles}</g>` +
      `<ellipse cx="${VX}" cy="${d1(level)}" rx="${d1(7.8 + (floor - level) / (floor - brim))}" ry="1.1" fill="#effffb" opacity="0.7"/>`
  }
  const glass =
    `M${VX - 7.5} ${VB}Q${VX - 9} ${VB} ${VX - 9} ${VB - 2.5}L${VX - 10} ${VT + 3}Q${VX - 10.2} ${VT + 0.6} ${VX - 11.4} ${VT}` +
    `H${VX + 11.4}Q${VX + 10.2} ${VT + 0.6} ${VX + 10} ${VT + 3}L${VX + 9} ${VB - 2.5}Q${VX + 9} ${VB} ${VX + 7.5} ${VB}Z`
  return {
    defs:
      `<clipPath id="${uid}-vclip"><path d="M${VX - 7.8} ${floor}L${VX - 8.8} ${brim - 1.5}H${VX + 8.8}L${VX + 7.8} ${floor}Z"/></clipPath>` +
      linearY(`${uid}-water`, VT, VB, [
        [0, '#d8fbf3', 0.6],
        [1, '#73bdb4', 0.82],
      ]),
    body:
      `<ellipse cx="${VX}" cy="${VB + 0.6}" rx="12" ry="1.6" fill="#3d2a20" opacity="0.5"/>` +
      `<g><path d="${stems}" fill="none" stroke="${TONE.stem}" stroke-width="0.9"/>${pace}</g>` +
      water +
      `<path d="${glass}" fill="#e6efff" fill-opacity="0.12" stroke="#fbf7ff" stroke-opacity="0.6" stroke-width="0.8"/>` +
      `<path d="M${VX - 7} ${VB - 2.4}h14" stroke="#ffffff" stroke-width="2" opacity="0.18"/>` +
      `<path d="M${VX - 6.6} ${VT + 5}L${VX - 6} ${VB - 6}M${VX + 6.8} ${VT + 8}L${VX + 6.3} ${VT + 20}" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" opacity="0.45"/>` +
      `<ellipse cx="${VX}" cy="${VT}" rx="11.4" ry="1.4" fill="none" stroke="#fbf7ff" stroke-opacity="0.55" stroke-width="0.7"/>` +
      `<g>${foliage}${blooms}${breath}${pace}</g>`,
  }
}

// ── The swarm and the falling petals ────────────────────────────────────────────────────

/** Pastel wings, each pair a light and a deeper tone, in the palette's family. */
const WINGS = [
  ['#ffc8d3', '#f394aa'],
  ['#f8e2a6', '#e9b95e'],
  ['#d3c4f3', '#a58fdd'],
  ['#c6e7cb', '#86c194'],
  ['#ffd9c2', '#f0a882'],
  ['#c4dbf3', '#87acd9'],
] as const

/** The butterfly, drawn once: fore wings take the fill, hind wings (with the spots) the color; three flapping paces. */
function butterflyDefs(uid: string): string {
  const edge = `stroke="${TONE.ink}" stroke-width="0.45" stroke-opacity="0.75"`
  const wings =
    `<g id="${uid}-wings"><path ${edge} d="M0-.5C1.5-6 7.5-8.5 8-4C8.3-1 4 .5 0 .4ZM0-.5C-1.5-6-7.5-8.5-8-4C-8.3-1-4 .5 0 .4Z"/>` +
    `<path ${edge} fill="currentColor" d="M0 .4C3.5.8 6.5 3.5 4.5 6.2C2.6 7.6.6 4 0 .8ZM0 .4C-3.5.8-6.5 3.5-4.5 6.2C-2.6 7.6-.6 4 0 .8Z${dot(4.8, -3.8, 1.3)}${dot(-4.8, -3.8, 1.3)}"/></g>`
  const body = `<g id="${uid}-body"><ellipse cy="1" rx=".75" ry="3.4" fill="${TONE.ink}"/><path d="M-.3-2.4Q-1.2-5.5-2.4-6.3M.3-2.4Q1.2-5.5 2.4-6.3" fill="none" stroke="${TONE.ink}" stroke-width=".4"/></g>`
  return (
    wings +
    body +
    [1.1, 1.35, 1.6]
      .map(
        (flap, i) =>
          `<g id="${uid}-fly${i}"><g><use href="#${uid}-wings"/>` +
          `<animateTransform attributeName="transform" type="scale" values="1 1;.2 1;1 1;.25 1;1 1;1 1" keyTimes="0;.16;.32;.48;.64;1" dur="${flap}s" begin="-${n(i * 0.43)}s" repeatCount="indefinite"/></g><use href="#${uid}-body"/></g>`,
      )
      .join('')
  )
}

/** One butterfly per active subagent about the flowers, the window and the lamp: wings flapping between glides, drifting on a gentle loop. */
function swarmLayer(uid: string, sceneId: string, swarm: number): string {
  const area: Area = { x0: 30, y0: 150, x1: 306, y1: 252 }
  return swarmSpots(sceneId, area, swarm)
    .map((spot, i) => {
      const k = spot.k
      // keep the vase and its water in view
      const y = Math.abs(spot.x - VX) < 20 && spot.y > 186 ? spot.y - 36 : spot.y
      const ax = (10 + 12 * ((k * 7.3) % 1)) * (i % 2 === 0 ? 1 : -1)
      const ay = 6 + 6 * ((k * 3.7) % 1)
      const path = `0 0;${d1(ax * 0.7)} ${d1(-ay)};${d1(ax * 0.4)} ${d1(ay)};${d1(-ax * 0.4)} ${d1(ay * 0.3)};0 0`
      const dur = 11 + 6 * ((k * 5.1) % 1)
      const [light, deep] = WINGS[i % WINGS.length] ?? WINGS[0]
      return (
        `<g transform="translate(${d1(spot.x)} ${d1(y)}) rotate(${d1(-14 + 28 * ((k * 9.7) % 1))}) scale(${n(0.85 + 0.35 * k)})"><g>` +
        `<use href="#${uid}-fly${i % 3}" fill="${light}" color="${deep}"/>` +
        drift(path, dur, k * dur, ease(4)) +
        '</g></g>'
      )
    })
    .join('')
}

/** A few rose petals drifting slowly down past the awning, fading in and out. */
function petalLayer(r: () => number): string {
  const starts: Pt[] = [
    [104, 160],
    [206, 176],
    [262, 194],
    [306, 206],
  ]
  return starts
    .map(([x, y], i) => {
      const dur = between(r, 14, 21)
      const begin = between(r, 0, dur)
      const fall = between(r, 80, 110)
      const sx = between(r, 5, 10) * (i % 2 === 0 ? 1 : -1)
      return (
        `<path d="${leaf(x, y, between(r, 0, 180), 4.4, 1.5)}" fill="${pick(['#ffc2cf', '#ffd6de', '#f7a1b5'], i)}" opacity="0">` +
        drift(`0 0;${d1(sx)} ${d1(fall * 0.33)};${d1(-sx * 0.7)} ${d1(fall * 0.66)};${d1(sx * 0.3)} ${d1(fall)}`, dur, begin, ease(3)) +
        loop('opacity', '0;.9;.9;.7;0', dur, begin) +
        '</path>'
      )
    })
    .join('')
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const vase = vaseGauge(uid, context, palette)
  let sun = ''
  for (let k = 0; k < 24; k++) sun += `${k ? 'L' : 'M'}${d1(Math.cos((k * Math.PI) / 12) * (k % 2 ? 3 : 6))} ${d1(Math.sin((k * Math.PI) / 12) * (k % 2 ? 3 : 6))}`
  const defs =
    `<path id="${uid}-tulip" d="${TULIP}"/><path id="${uid}-sun" d="${sun}Z"/>` +
    butterflyDefs(uid) +
    linearY(`${uid}-plaster`, CORNICE, FASCIA, [
      [0, '#463f62'],
      [1, '#3a3352'],
    ]) +
    linearBox(`${uid}-room`, [
      [0, '#f6c27f'],
      [0.55, '#eba468'],
      [1, '#c97a4e'],
    ]) +
    linearBox(`${uid}-awnshade`, [
      [0, '#1c2140', 0.5],
      [1, '#1c2140', 0],
    ]) +
    radialBox(`${uid}-glow`, [
      [0, '#ffd593', 0.85],
      [0.35, '#ffc47e', 0.38],
      [1, '#ffb070', 0],
    ]) +
    radialBox(`${uid}-bulb`, [
      [0, '#ffeec0', 0.95],
      [0.4, '#ffd08a', 0.35],
      [1, '#ffc070', 0],
    ]) +
    radialBox(`${uid}-moonglow`, [
      [0, '#ffeedd', 0.5],
      [0.4, '#ffeedd', 0.14],
      [1, '#ffeedd', 0],
    ]) +
    linearY(`${uid}-haze`, 180, 300, [
      [0, palette.sky[2], 0],
      [1, palette.sky[2], 0.4],
    ]) +
    linearY(`${uid}-pave`, GROUND, KERB, [
      [0, '#2f2a40'],
      [1, '#221e2d'],
    ]) +
    `<linearGradient id="${uid}-zinc" x2="1"><stop offset="0" stop-color="#4f5868"/><stop offset=".4" stop-color="#9ba5b5"/><stop offset="1" stop-color="#4c5464"/></linearGradient>` +
    `<clipPath id="${uid}-winclip"><rect x="${WX0}" y="${WY0}" width="${WX1 - WX0}" height="${WY1 - WY0}"/></clipPath>` +
    `<pattern id="${uid}-lattice" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M.5 0V7M0 .5H7" stroke="#8b7862"/></pattern>` +
    `<mask id="${uid}-moonmask" maskUnits="userSpaceOnUse" x="${MX - 10}" y="${MY - 10}" width="20" height="20">` +
    `<circle cx="${MX}" cy="${MY}" r="${MR}" fill="#ffffff"/><circle cx="${MX + 3.2}" cy="${MY - 2.4}" r="${n(MR * 0.88)}" fill="#000000"/></mask>` +
    vase.defs

  // The sky and the far town take their randomness first, so their shapes hold when nearer layers change.
  const sky = skyLayer(r, uid)
  const far = farLayer(r, uid)
  const street = streetLayer(r, uid)
  const shop = shopLayer(r, uid, palette)
  const pavement = pavementLayer(uid)
  const things = pavementThings(r, uid, palette)
  const petals = petalLayer(r)
  const butterflies = swarmLayer(uid, scene.id, swarm)
  const caption = gaugeCaption({ x: VX, y: 281, name: scene.gauge, value: contextText, palette, anchor: 'middle' })

  return {
    defs,
    body: sky + far + street + shop + pavement + vase.body + things + petals + butterflies + caption,
  }
}
