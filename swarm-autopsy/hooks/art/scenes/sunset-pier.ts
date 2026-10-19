// Sunset Pier: a calm sea at the last of the sunset. The sky runs from indigo through rose to a
// coral-gold horizon where the sun sits half set in a soft halo; long thin clouds lit pink from
// below drift across it, and the first faint stars twinkle at the very top. A weathered wooden
// pier runs from the bottom left out toward the sun, to a little fishing shack with one warm
// window and a rod leaning on it; an orange cat sleeps on the planks beside a bucket. The sea
// goes from coral-lit at the horizon to deep teal in front, with the sun's glinting road, slow
// wave lines and a red buoy bobbing. A headland with a tiny lighthouse closes the left; wide
// panes find a lit fishing village on the hills there, and hazy islands and sea stacks on the
// right. The lanterns on posts along the pier's rail are the context gauge: they light one by
// one from the nearest outward as the context window fills, each glowing and flickering softly
// with its light on the planks and on the water; unlit ones are dark glass. Each active subagent
// is a small sailboat with cream sails on the horizon, bobbing and rocking gently.

import type { Painted, PaintArgs } from '../scene.ts'
import { BLEED, SCENE_W, between, drift, flicker, flyer, gaugeCaption, linearBox, linearX, linearY, loop, n, radialBox, stars, sway, swarmSpots } from '../kit.ts'

type Palette = PaintArgs['palette']

const L = -BLEED
const R = SCENE_W + BLEED
/** The sea and the land reach down to here, well under the fade. */
const BOTTOM = 470
/** Where the sea meets the sky; the sun sits half set on it. */
const HORIZON = 182
const SUN = { x: 242, r: 19 }

/**
 * The pier in one-point perspective: at depth z (1 = the near end, larger = farther) its centre
 * line runs from NEAR toward the vanishing point VP on the horizon, and its sizes shrink as 1/z.
 */
const VP = { x: 250, y: HORIZON }
const NEAR = { x: 20, y: 340 }
const HALF = 56
const Z_FRONT = 0.7
const Z_END = 5.3
/** The shack at the pier's end: its front and back depths, wall and ridge heights (units at depth 1). */
const SHACK = { front: 4.6, back: 5.22, wall: 128, peak: 172 }
const RAIL = 22
const FASCIA = 7
/** How far below the deck the water is, in units at depth 1. */
const WATER = 30
/** The lantern posts on the right rail, nearest first: the gauge. */
const LANTERNS = [1.3, 1.74, 2.18, 2.62, 3.06, 3.5, 3.94, 4.38] as const
const POST = 64
const LANTERN_K = 1.85

/** The swarm's band on the sea just under the horizon; boats skip the stretch behind the shack. */
const FLEET = { x0: 36, y0: HORIZON + 5, x1: 264, y1: HORIZON + 18 }
const FLEET_GAP = { from: 180, width: 46 }
/** The least room between two boats' masts. */
const FLEET_SPACING = 17

const WOOD = '#2a1d23'
const WOOD_DARK = '#1c1418'
const RIM = '#f0a284'
const LAMP = '#ffd08a'

const depthY = (z: number): number => VP.y + (NEAR.y - VP.y) / z
const leftX = (z: number): number => VP.x + (NEAR.x - VP.x - HALF) / z
const rightX = (z: number): number => VP.x + (NEAR.x - VP.x + HALF) / z
/** The depth at which the deck is at screen height y. */
const depthAt = (y: number): number => (NEAR.y - VP.y) / Math.max(0.5, y - VP.y)
const pt = (x: number, y: number): string => `${n(x)} ${n(y)}`
/** Smooth ease on every segment of a looping `values` list. */
const ease = (segments: number): string => ` calcMode="spline" keySplines="${Array.from({ length: segments }, () => '0.45 0 0.55 1').join(';')}"`
/** Half the width of the sun's road on the water at height y. */
const roadHalf = (y: number): number => 9 + (y - HORIZON) * 0.25

/** A band along the pier at `edge(z)` from depth z0 to z1, between `top` and `bottom` units above the deck. */
function band(edge: (z: number) => number, z0: number, z1: number, top: number, bottom: number): string {
  return (
    `M${pt(edge(z0), depthY(z0) - top / z0)}L${pt(edge(z1), depthY(z1) - top / z1)}` +
    `L${pt(edge(z1), depthY(z1) - bottom / z1)}L${pt(edge(z0), depthY(z0) - bottom / z0)}Z`
  )
}

/** The line along the pier at `edge(z)`, `up` units above the deck, from z0 to z1. */
const along = (edge: (z: number) => number, z0: number, z1: number, up: number): string =>
  `M${pt(edge(z0), depthY(z0) - up / z0)}L${pt(edge(z1), depthY(z1) - up / z1)}`

/** A post standing on the deck at x (depth z), `h` units tall and `w` wide. */
const post = (x: number, z: number, h: number, w: number): string =>
  `M${pt(x - w / 2 / z, depthY(z))}V${n(depthY(z) - h / z)}h${n(w / z)}V${n(depthY(z))}Z`

function defsFor(uid: string, palette: Palette): string {
  return (
    linearY(`${uid}-afterglow`, 64, HORIZON, [
      [0, palette.sky[2], 0],
      [0.45, '#ee8f7a', 0.16],
      [0.8, palette.accent, 0.42],
      [1, '#ffc896', 0.72],
    ]) +
    radialBox(`${uid}-sunhalo`, [
      [0, '#ffd7a0', 0.6],
      [0.35, palette.accent, 0.24],
      [1, palette.accent, 0],
    ]) +
    radialBox(`${uid}-corona`, [
      [0, '#ffd9a4', 0.75],
      [0.32, '#ffbe88', 0.38],
      [1, palette.accent, 0],
    ]) +
    radialBox(`${uid}-sun`, [
      [0, '#fffcef'],
      [0.55, '#fff0c4'],
      [0.85, '#ffd796'],
      [1, '#ffc07e'],
    ]) +
    linearBox(`${uid}-cloud`, [
      [0, '#4a3257', 0.85],
      [0.6, '#94587a'],
      [1, '#ffbb98'],
    ]) +
    linearY(`${uid}-sea`, HORIZON, 340, [
      [0, '#b97c82'],
      [0.08, '#9a6a7a'],
      [0.2, '#6c5570'],
      [0.36, '#424c66'],
      [0.55, '#2a4656'],
      [0.78, '#1b3844'],
      [1, '#132a33'],
    ]) +
    radialBox(`${uid}-glare`, [
      [0, '#ffdcb4', 0.62],
      [0.45, '#ffb08a', 0.2],
      [1, palette.accent, 0],
    ]) +
    radialBox(`${uid}-seaglow`, [
      [0, '#ffb894', 0.3],
      [0.5, '#e98e86', 0.12],
      [1, '#e98e86', 0],
    ]) +
    linearX(`${uid}-glimmer`, L, R, [
      [0, '#ffe2c0', 0],
      [0.32, '#ffe2c0', 0.1],
      [(SUN.x - L) / (R - L) - 0.08, '#ffe8c8', 0.45],
      [(SUN.x - L) / (R - L), '#fff6e0', 1],
      [(SUN.x - L) / (R - L) + 0.08, '#ffe8c8', 0.45],
      [0.82, '#ffe2c0', 0.1],
      [1, '#ffe2c0', 0],
    ]) +
    // The sun's road: a soft glow fanning down from the sun, brightest at the horizon, fading at its sides.
    `<radialGradient id="${uid}-road" gradientUnits="userSpaceOnUse" cx="${SUN.x}" cy="${HORIZON}" r="40" gradientTransform="translate(${SUN.x} ${HORIZON}) scale(1 3.1) translate(${-SUN.x} ${-HORIZON})">` +
    `<stop offset="0" stop-color="#ffe9bc" stop-opacity="0.7"/><stop offset="0.35" stop-color="#ffc08e" stop-opacity="0.32"/>` +
    `<stop offset="0.7" stop-color="${palette.accent}" stop-opacity="0.1"/><stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/></radialGradient>` +
    linearY(`${uid}-glint`, HORIZON, 306, [
      [0, '#fff8e6'],
      [0.45, '#ffcf9e', 0.9],
      [1, palette.accent, 0.35],
    ]) +
    linearY(`${uid}-deck`, depthY(Z_END), 350, [
      [0, '#8c5a50'],
      [0.1, '#6a443f'],
      [0.3, '#45302f'],
      [0.6, '#33242a'],
      [1, '#261b21'],
    ]) +
    radialBox(`${uid}-lglow`, [
      [0, '#ffe6b2', 0.9],
      [0.22, '#ffc27e', 0.48],
      [0.55, '#ffa070', 0.14],
      [1, palette.accent, 0],
    ]) +
    radialBox(`${uid}-lit`, [
      [0, '#fffbe8'],
      [0.55, '#ffd590'],
      [1, '#ff9f66'],
    ]) +
    linearBox(`${uid}-sail`, [
      [0, '#fff5e8'],
      [1, '#f7c7b2'],
    ])
  )
}

/** Star dust and a few twinkling stars at the very top, the afterglow over the horizon, and the sun's breathing halo. */
function skyLayer(r: () => number, uid: string): string {
  let dust = ''
  for (let i = 0; i < 28; i++) dust += `M${pt(between(r, L, R), between(r, 3, 76))}h0.01`
  const twinkle =
    stars(r, { x0: 16, y0: 6, x1: 324, y1: 64 }, 3, '#fff0e4', [0.5, 1.05]) +
    stars(r, { x0: L + 30, y0: 6, x1: R - 30, y1: 84 }, 3, '#fff0e4', [0.5, 1])
  return (
    `<path d="${dust}" stroke="#f2e4ee" stroke-width="0.8" stroke-linecap="round" opacity="0.3"/>` +
    twinkle +
    `<rect x="${L}" y="64" width="${R - L}" height="${HORIZON - 63}" fill="url(#${uid}-afterglow)"/>` +
    `<ellipse cx="${SUN.x}" cy="${HORIZON}" rx="210" ry="104" fill="url(#${uid}-sunhalo)">${loop('opacity', '0.82;1;0.82', 16, 5)}</ellipse>`
  )
}

type Pill = readonly [dx: number, dy: number, w: number, h: number]

/**
 * A bank of long thin stratus lit pink-gold from below: overlapping streaks, each with a flat bright
 * underside, a gently domed top and tapering ends (a longer tail trailing to the right).
 */
function bank(uid: string, x: number, y: number, pills: readonly Pill[]): string {
  let bands = ''
  let rims = ''
  for (const [dx, dy, w, h] of pills) {
    const x0 = x + dx - w / 2
    const top = y + dy - h / 2
    const b = top + h
    const at = (f: number): number => x0 + w * f
    const d =
      `M${pt(x0, b)}C${pt(at(0.05), b - h * 0.25)} ${pt(at(0.08), top + h * 0.15)} ${pt(at(0.18), top + h * 0.12)}` +
      `Q${pt(at(0.45), top - h * 0.14)} ${pt(at(0.72), top + h * 0.12)}C${pt(at(0.86), top + h * 0.22)} ${pt(at(0.95), b - h * 0.4)} ${pt(x0 + w, b)}Z`
    bands += `<path d="${d}" fill="url(#${uid}-cloud)"/>`
    rims += `M${pt(at(0.04), b - 0.35)}H${n(at(0.97))}`
  }
  return bands + `<path d="${rims}" stroke="#ffd9b4" stroke-width="0.7" stroke-linecap="round" opacity="0.6"/>`
}

/** The clouds behind the sun, each drifting at its own pace (the wide-pane ones as one far layer). */
function backClouds(uid: string): string {
  const one = (art: string, opacity: number, dx: number, dur: number, begin: number): string =>
    `<g opacity="${n(opacity)}">${art}${drift(`0 0;${n(dx)} 0;0 0`, dur, begin, ease(2))}</g>`
  const wide =
    bank(uid, -206, 112, [
      [-20, -6, 80, 5],
      [0, 0, 170, 7],
      [40, 5, 70, 4],
    ]) +
    bank(uid, 486, 126, [
      [30, -5, 90, 5],
      [0, 0, 190, 6],
      [-50, 4.5, 60, 3.5],
    ]) +
    bank(uid, 566, 160, [
      [0, 0, 140, 3.5],
      [30, -3, 50, 2.6],
    ]) +
    bank(uid, -120, 150, [
      [0, 0, 120, 3.5],
      [20, -3, 40, 2.6],
    ])
  return (
    one(
      bank(uid, 104, 122, [
        [-26, -5.5, 74, 5],
        [0, 0, 150, 6],
        [38, 4.5, 64, 3.6],
      ]),
      0.92,
      14,
      110,
      20,
    ) +
    one(
      bank(uid, 270, 146, [
        [14, -4.2, 60, 4],
        [0, 0, 128, 4.6],
        [-34, 3.6, 50, 3],
      ]),
      0.85,
      -12,
      96,
      50,
    ) +
    one(
      bank(uid, 26, 157, [
        [0, 0, 110, 4],
        [24, -3.4, 46, 3],
      ]),
      0.72,
      10,
      120,
      70,
    ) +
    one(wide, 0.85, 16, 130, 40)
  )
}

/** The sun, half set on the horizon, with its corona; a thin streak of cloud drifts across its face. */
function sunLayer(uid: string): string {
  return (
    `<circle cx="${SUN.x}" cy="${HORIZON}" r="50" fill="url(#${uid}-corona)"/>` +
    `<circle cx="${SUN.x}" cy="${HORIZON + 1}" r="${SUN.r}" fill="url(#${uid}-sun)"/>` +
    `<g opacity="0.55">${bank(uid, 266, 173, [
      [0, 0, 96, 2.6],
      [-16, 3.2, 44, 1.8],
    ])}${drift('0 0;-10 0;0 0', 84, 30, ease(2))}</g>`
  )
}

type House = readonly [x: number, base: number, w: number, h: number]

/** The fishing village on the hill at the far left (wide panes): two rows of houses and a church. */
const HOUSES: readonly House[] = [
  [-262, 155, 9, 6],
  [-236, 159, 8, 5],
  [-206, 164, 10, 6],
  [-150, 169, 9, 5],
  [-124, 171, 8, 5],
  [-300, 182, 11, 8],
  [-285, 182, 9, 6],
  [-269, 182, 12, 9],
  [-251, 182, 8, 7],
  [-236, 182, 10, 8],
  [-218, 182, 9, 6],
  [-201, 182, 12, 8],
  [-183, 182, 8, 6],
  [-166, 182, 10, 7],
  [-148, 182, 9, 8],
  [-131, 182, 11, 6],
  [-112, 182, 8, 7],
  [-96, 182, 10, 5],
  [-78, 182, 8, 6],
  [-61, 182, 9, 5],
]

/** The far shore: the headland and the village hill on the left, hazy islands on the right; drawn once, mirrored on the water. */
function land(r: () => number, uid: string): { art: string; lights: string; reflections: string } {
  let houses = ''
  const windows = ['', '', '']
  let glimmers = ''
  HOUSES.forEach(([x, base, w, h], i) => {
    const roof = between(r, 2, 4)
    houses += `M${pt(x, base)}V${n(base - h)}L${pt(x + w / 2, base - h - roof)}L${pt(x + w, base - h)}V${n(base)}Z`
    const panes = r() < 0.5 ? 1 : 2
    for (let p = 0; p < panes; p++) {
      const wx = x + 1.5 + between(r, 0, w - 4.5)
      const wy = base - h + between(r, 1.2, Math.max(1.4, h - 3))
      if (r() < 0.12) continue
      windows[i % 3] += `M${pt(wx, wy)}h1.5v1.7h-1.5Z`
      if (base > 178) for (let j = 0; j < 4; j++) glimmers += `M${pt(wx - 0.2 + j * 0.1, HORIZON + 2.4 + j * 2.8)}h${n(1.8 - j * 0.3)}`
    }
  })
  houses += 'M-178 167V158L-176 151L-174 158V167Z'
  const art =
    `<g id="${uid}-land">` +
    `<path d="M396 ${HORIZON}Q418 176 444 175Q466 173 482 ${HORIZON}Z" fill="#9c6478"/>` +
    `<path d="M284 ${HORIZON}Q300 176 318 175Q340 171 362 176Q378 179 392 ${HORIZON}Z" fill="#875570"/>` +
    `<path d="M452 ${HORIZON}Q470 171 492 168Q504 156 520 158Q536 160 548 168Q580 171 612 177Q630 180 646 ${HORIZON}Z" fill="#744864"/>` +
    `<path d="M${L} ${HORIZON}V138Q-262 127 -214 135Q-160 145 -116 139Q-66 133 -28 150Q14 166 58 172Q92 176 120 ${HORIZON}Z" fill="#6c4462"/>` +
    `<path d="M${L} ${HORIZON}V152Q-272 146 -228 155Q-170 165 -118 167Q-62 170 -26 177Q-6 181 6 ${HORIZON}Z" fill="#4b2f4c"/>` +
    `<path d="${houses}" fill="#33203a"/>` +
    `<rect x="-312" y="180.6" width="282" height="1.6" fill="#2c1c2e"/>` +
    '</g>'
  const lights = windows
    .map(d => `<path d="${d}" fill="${LAMP}">${flicker(r, 0.55, 1)}</path>`)
    .join('')
  // The headland's little lighthouse, its lamp slowly breathing.
  const beacon =
    '<path d="M90.8 176.6L91.4 169H93L93.6 176.6Z" fill="#e8cfc4"/><path d="M90.5 169.1H93.9V167.9H90.5ZM90.9 166L92.2 164.4L93.5 166Z" fill="#2a1c28"/>' +
    `<g>${`<circle cx="92.2" cy="167" r="7" fill="url(#${uid}-lglow)"/><circle cx="92.2" cy="167" r="1" fill="#fff1c8"/>`}${loop('opacity', '0.25;1;0.25', 5.5, 2)}</g>`
  const reflections = `<path d="${glimmers}" stroke="${LAMP}" stroke-width="0.8" opacity="0.45">${loop('opacity', '0.5;0.2;0.45;0.5', 4.4, 1)}</path>`
  const haze = `<ellipse cx="-180" cy="174" rx="130" ry="18" fill="url(#${uid}-lglow)" opacity="0.22"/>`
  return { art, lights: haze + lights + beacon, reflections }
}

/** Rows of short wave lines between y0 and y1, longer and further apart nearer, drifting slowly sideways. */
function waveBand(r: () => number, y0: number, y1: number, color: string, opacity: number, width: number, dx: number, dur: number, begin: number): string {
  let d = ''
  for (let y = y0; y < y1; y += 2.6 + (y - HORIZON) * 0.14) {
    const len = 4 + (y - HORIZON) * 0.19
    const under = rightX(depthAt(y)) + 4
    for (let x = L + between(r, 0, len * 6); x < R; x += len * between(r, 3.5, 7.5)) {
      const wy = y + between(r, -0.3, 0.3)
      if (Math.abs(x + len / 2 - SUN.x) < roadHalf(wy) + len / 2) continue
      if (x + len < under) continue
      d += `M${pt(x, wy)}q${n(len / 2)} ${n(-Math.min(1.6, len * 0.08))} ${n(len)} 0`
    }
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" fill="none" opacity="${n(opacity)}">${drift(`0 0;${n(dx)} 0;0 0`, dur, begin, ease(2))}</path>`
}

/** The sun's road on the water: a soft glow fanning down, and glints in five groups fading in and out on their own beats. */
function sunRoad(r: () => number, uid: string): string {
  const groups = ['', '', '', '', '']
  for (let y = HORIZON + 1.6; y < 302; y += 2 + (y - HORIZON) * 0.08) {
    const half = roadHalf(y)
    const count = y < 200 ? 2 : 2 + (r() < 0.5 ? 1 : 0)
    for (let i = 0; i < count; i++) {
      const len = between(r, 1.5, 3) + (y - HORIZON) * 0.08
      // most glints near the middle of the road, a few out at its edges
      const spread = (r() + r() + r() - 1.5) / 1.5
      const x = SUN.x + spread * half - len / 2
      groups[Math.floor(r() * groups.length)] += `M${pt(x, y)}h${n(len)}`
    }
  }
  return (
    `<rect x="${SUN.x - 44}" y="${HORIZON}" width="88" height="128" fill="url(#${uid}-road)"/>` +
    groups
      .map((d, i) => {
        if (i === 0) return `<path d="${d}" stroke="url(#${uid}-glint)" stroke-width="0.9" stroke-linecap="round" opacity="0.4"/>`
        const dur = between(r, 2.8, 5.2)
        return `<path d="${d}" stroke="url(#${uid}-glint)" stroke-width="1" stroke-linecap="round" opacity="0.6">${loop('opacity', '0.1;0.95;0.35;0.1', dur, between(r, 0, dur))}</path>`
      })
      .join('')
  )
}

/** The open sea: the coral-to-teal water, the land's reflection, the glare and road under the sun, far wave lines. */
function seaLayer(r: () => number, uid: string): string {
  return (
    `<rect x="${L}" y="${HORIZON}" width="${R - L}" height="${BOTTOM - HORIZON}" fill="url(#${uid}-sea)"/>` +
    `<use href="#${uid}-land" transform="matrix(1 0 0 -0.5 0 ${n(HORIZON * 1.5)})" opacity="0.3"/>` +
    `<ellipse cx="${SUN.x - 20}" cy="${HORIZON + 14}" rx="330" ry="64" fill="url(#${uid}-seaglow)"/>` +
    `<ellipse cx="${SUN.x}" cy="${HORIZON + 4}" rx="150" ry="18" fill="url(#${uid}-glare)"/>` +
    sunRoad(r, uid) +
    waveBand(r, HORIZON + 3, 206, '#ffd2b8', 0.42, 0.7, 5, 16, 3) +
    waveBand(r, 206, 236, '#e7a7ac', 0.3, 0.8, -6, 19, 8) +
    `<rect x="${L}" y="${HORIZON - 0.6}" width="${R - L}" height="1.2" fill="url(#${uid}-glimmer)"/>` +
    // two sea stacks off the islands (wide panes)
    '<path d="M470 214L474 201L479 197L484 202L487 214ZM497 210L500 203L503 202L506 210Z" fill="#3b2840"/>' +
    '<path d="M466 214.4h24M494 210.4h14" stroke="#e6b0a8" stroke-width="0.6" opacity="0.5"/>'
  )
}

/** A red can buoy rocking in the swell, its little lamp blinking. */
function buoy(x: number, y: number): string {
  return (
    `<path d="M${pt(x - 6, y + 2.4)}h12M${pt(x - 4, y + 4.4)}h8M${pt(x - 2.2, y + 6.4)}h4.4" stroke="#e98a7c" stroke-width="0.7" opacity="0.45"/>` +
    '<g><g>' +
    `<ellipse cx="${x}" cy="${y}" rx="5" ry="1.5" fill="#22161d"/>` +
    `<path d="M${pt(x - 3.6, y)}L${pt(x - 2.5, y - 8)}H${n(x + 2.5)}L${pt(x + 3.6, y)}Z" fill="#c4535a"/>` +
    `<path d="M${pt(x - 3.1, y - 3.2)}H${n(x + 3.1)}L${pt(x + 2.85, y - 5)}H${n(x - 2.85)}Z" fill="#f2dccb"/>` +
    `<path d="M${pt(x + 0.8, y - 8)}H${n(x + 2.5)}L${pt(x + 3.6, y)}H${n(x + 1.9)}Z" fill="#000000" opacity="0.22"/>` +
    `<path d="M${pt(x - 2.4, y - 7.6)}L${pt(x - 3.3, y - 0.4)}" stroke="#ffc2a0" stroke-width="0.5" opacity="0.7"/>` +
    `<path d="M${pt(x, y - 8)}V${n(y - 11.6)}" stroke="#22161d" stroke-width="0.8"/>` +
    `<circle cx="${x}" cy="${n(y - 12.4)}" r="1.1" fill="#ffe2a8">${loop('opacity', '0.25;1;0.25', 3.8, 1)}</circle>` +
    sway(x, y, 4, 6.4, 2) +
    `</g>${drift('0 0;0 1.1;0 0', 4.6, 1, ease(2))}</g>`
  )
}

/** The fleet's spots, eased apart so no two boats hide each other, then moved clear of the shack. */
function fleetSpots(seed: string, swarm: number): Array<{ x: number; y: number; k: number }> {
  const spots = swarmSpots(seed, FLEET, swarm).sort((a, b) => a.x - b.x)
  const xs: number[] = []
  spots.forEach((spot, i) => {
    const prev = xs[i - 1]
    xs.push(prev === undefined ? spot.x : Math.max(spot.x, prev + FLEET_SPACING))
  })
  const last = xs[xs.length - 1] ?? FLEET.x1
  const squeeze = last > FLEET.x1 ? (FLEET.x1 - FLEET.x0) / (last - FLEET.x0) : 1
  return spots.map((spot, i) => {
    const x = FLEET.x0 + ((xs[i] ?? spot.x) - FLEET.x0) * squeeze
    return { ...spot, x: x < FLEET_GAP.from ? x : x + FLEET_GAP.width }
  })
}

/** One sailboat per active subagent on the horizon: cream sails tinted by the sunset, bobbing and rocking. */
function sailboats(uid: string, scene: PaintArgs['scene'], swarm: number): string {
  return fleetSpots(scene.id, swarm)
    .map((spot, i) => {
      const x = spot.x
      const depth = (spot.y - FLEET.y0) / (FLEET.y1 - FLEET.y0)
      const s = 0.6 + depth * 0.32 + spot.k * 0.08
      const flip = i % 3 === 1 ? -1 : 1
      const a = (i % 2 === 0 ? 1 : -1) * 1.4
      const bob = `0 0;${n(a)} 1.1;${n(2 * a)} 0;${n(3 * a)} 1.1;${n(4 * a)} 0;${n(3 * a)} 1.1;${n(2 * a)} 0;${n(a)} 1.1;0 0`
      const dur = 22 + spot.k * 10
      const hull =
        '<path d="M-7.5 -1.8H7.8Q6.6 1.4 4 1.9H-4.6Q-6.8 1.2 -7.5 -1.8Z" fill="#2b1d2b"/>' +
        '<path d="M-7.5 -1.8H7.8" stroke="#e0a08e" stroke-width="0.5" opacity="0.7"/>' +
        '<path d="M0 -1.8V-19" stroke="#3b2a36" stroke-width="0.7"/>' +
        `<path d="M-0.6 -18.4Q-3.4 -10 -7.4 -3H-0.6Z" fill="url(#${uid}-sail)"/>` +
        '<path d="M0.8 -17L6.6 -3H0.8Z" fill="#f2c2b2"/>' +
        `<path d="M0 -19L2.6 -18.2L0 -17.4Z" fill="#ff9e7a"/>`
      return (
        `<g transform="translate(${pt(x, spot.y)}) scale(${n(s * flip)} ${n(s)})"><g>` +
        '<path d="M-5 3h9M-3.6 4.8h7M-2.2 6.6h4" stroke="#ffe6d2" stroke-width="0.7" opacity="0.35"/>' +
        `<g>${hull}${sway(0, 0, 2.2, 5 + spot.k * 3, spot.k * 4)}</g>` +
        drift(bob, dur, spot.k * dur, ease(8)) +
        '</g></g>'
      )
    })
    .join('')
}

/** Planks of the deck, far end warm with the low sun; seams, a few odd planks, the rim light on its edges. */
function deck(r: () => number, uid: string): string {
  const outline = `M${pt(leftX(Z_FRONT), depthY(Z_FRONT))}L${pt(rightX(Z_FRONT), depthY(Z_FRONT))}L${pt(rightX(Z_END), depthY(Z_END))}L${pt(leftX(Z_END), depthY(Z_END))}Z`
  let near = ''
  let mid = ''
  let dark = ''
  let light = ''
  const PITCH = 0.06
  for (let z = Z_FRONT; z < 2.7; z += PITCH) {
    const seam = `M${pt(leftX(z), depthY(z))}H${n(rightX(z))}`
    if (z < 1.6) near += seam
    else mid += seam
    const tone = r()
    const plank = `M${pt(leftX(z), depthY(z))}H${n(rightX(z))}L${pt(rightX(z + PITCH), depthY(z + PITCH))}H${n(leftX(z + PITCH))}Z`
    if (tone < 0.22) dark += plank
    else if (tone > 0.84) light += plank
  }
  return (
    `<path d="${outline}" fill="url(#${uid}-deck)"/>` +
    `<path d="${dark}" fill="#000000" opacity="0.16"/>` +
    `<path d="${light}" fill="#ffd8c0" opacity="0.05"/>` +
    `<path d="${near}" stroke="#140d11" stroke-width="0.9" opacity="0.7"/>` +
    `<path d="${mid}" stroke="#140d11" stroke-width="0.55" opacity="0.45"/>` +
    `<path d="${along(leftX, Z_FRONT, Z_END, 0)}" stroke="#b07062" stroke-width="0.7" opacity="0.35"/>` +
    `<path d="${along(rightX, Z_FRONT, Z_END, 0)}" stroke="${RIM}" stroke-width="0.8" opacity="0.55"/>`
  )
}

/** Under the right edge: the shadow under the pier, the pilings and their braces, the fascia board. */
function underside(): string {
  let piles = ''
  let below = ''
  let rings = ''
  let nearBraces = ''
  let farBraces = ''
  const zs: number[] = []
  for (let z = Z_FRONT + 0.1; z <= Z_END; z += 0.42) zs.push(z)
  zs.forEach((z, i) => {
    const x = rightX(z) - 2.4 / z
    const w = 4.8 / z
    const top = depthY(z)
    const foot = top + (WATER + 1) / z
    piles += `M${pt(x - w / 2, top)}h${n(w)}V${n(foot)}h${n(-w)}Z`
    below += `M${pt(x - w / 2, foot)}h${n(w)}v${n(14 / z)}h${n(-w)}Z`
    rings += `M${pt(x - 5 / z, foot + 0.4 / z)}h${n(10 / z)}`
    const next = zs[i + 1]
    if (next === undefined) return
    const nx = rightX(next) - 2.4 / next
    const brace =
      `M${pt(x, top + FASCIA / z)}L${pt(nx, depthY(next) + (WATER - 4) / next)}` +
      `M${pt(x, foot - 4 / z)}L${pt(nx, depthY(next) + FASCIA / next)}`
    if (z < 1.8) nearBraces += brace
    else farBraces += brace
  })
  return (
    `<path d="${band(rightX, Z_FRONT, Z_END, 0, -WATER - 2)}" fill="#0b1318" opacity="0.8"/>` +
    `<path d="${below}" fill="#0b1418" opacity="0.4"/>` +
    `<path d="${nearBraces}" stroke="${WOOD_DARK}" stroke-width="1.6"/>` +
    `<path d="${farBraces}" stroke="${WOOD_DARK}" stroke-width="0.8"/>` +
    `<path d="${piles}" fill="#1a1216"/>` +
    `<path d="${rings}" stroke="#7cc4c0" stroke-width="0.6" opacity="0.35"/>` +
    `<path d="${band(rightX, Z_FRONT, Z_END, 0, -FASCIA)}" fill="#22171c"/>`
  )
}

/** A railing along one edge: posts, a top rail catching the sunset and a middle rail. */
function railing(edge: (z: number) => number, zs: readonly number[]): string {
  const posts = zs.map(z => post(edge(z), z, RAIL + 1, 3.6)).join('')
  return (
    `<path d="${posts}${band(edge, Z_FRONT, SHACK.front, RAIL + 1, RAIL - 2.2)}${band(edge, Z_FRONT, SHACK.front, RAIL * 0.5 + 0.8, RAIL * 0.5 - 0.6)}" fill="${WOOD}"/>` +
    `<path d="${along(edge, Z_FRONT, SHACK.front, RAIL + 1)}" stroke="${RIM}" stroke-width="0.6" opacity="0.5"/>`
  )
}

/** The fishing shack at the pier's end: one warm window, a life ring, a stovepipe and a rod leaning on it. */
function shack(r: () => number, uid: string): string {
  const zf = SHACK.front
  const zb = SHACK.back
  const xl = (z: number): number => leftX(z) + 2.5 / z
  const xr = (z: number): number => rightX(z) - 2.5 / z
  const yf = depthY(zf)
  const yb = depthY(zb)
  const wf = yf - SHACK.wall / zf
  const wb = yb - SHACK.wall / zb
  const pf = yf - SHACK.peak / zf
  const pb = yb - SHACK.peak / zb
  const cf = (xl(zf) + xr(zf)) / 2
  const cb = (xl(zb) + xr(zb)) / 2
  const eave = 3 / zf
  const left = xl(zf)
  const right = xr(zf)
  let boards = ''
  for (let x = left + 2.6; x < right - 1; x += 2.6) boards += `M${pt(x, wf + 0.6)}V${n(yf)}`
  const slope = (x: number): number => pf + ((x - cf) / (right + eave - cf)) * (wf - pf)
  const pipeX = cf + 5
  return (
    // the rod leaning on the shack, its tip over the sun, the line dropping to the water
    `<path d="M${pt(right + 1.2, yf - 2)}L${pt(right + 26, yf - 52)}" stroke="#2a1b22" stroke-width="0.7" stroke-linecap="round"/>` +
    `<path d="M${pt(right + 26, yf - 52)}Q${pt(right + 30, yf - 20)} ${pt(right + 31, yf + 7)}" stroke="#3a2630" stroke-width="0.35" fill="none" opacity="0.8"/>` +
    `<path d="M${pt(right + 28, yf + 7.4)}h6" stroke="#ffe2c4" stroke-width="0.5" opacity="0.6"/>` +
    `<path d="M${pt(right, yf)}L${pt(xr(zb), yb)}V${n(wb)}L${pt(right, wf)}Z" fill="#4d3236"/>` +
    `<path d="M${pt(left, yf)}V${n(wf)}H${n(right)}V${n(yf)}Z" fill="#33232b"/>` +
    `<path d="${boards}" stroke="#20151b" stroke-width="0.4" opacity="0.6"/>` +
    `<path d="M${pt(pipeX, slope(pipeX) + 0.6)}V${n(slope(pipeX) - 5)}h1.6V${n(slope(pipeX + 1.6) + 0.6)}Z" fill="${WOOD_DARK}"/>` +
    `<path d="M${pt(cf, pf)}L${pt(cb, pb)}L${pt(xr(zb) + eave, wb + 0.4)}L${pt(right + eave, wf + 0.4)}Z" fill="#3a262c"/>` +
    `<path d="M${pt(left - eave, wf + 0.4)}L${pt(cf, pf)}L${pt(right + eave, wf + 0.4)}Z" fill="#241820"/>` +
    `<path d="M${pt(left - eave, wf + 0.4)}L${pt(cf, pf)}L${pt(right + eave, wf + 0.4)}L${pt(xr(zb) + eave, wb + 0.4)}" stroke="${RIM}" stroke-width="0.6" fill="none" opacity="0.6"/>` +
    `<path d="M${pt(right, wf)}V${n(yf)}" stroke="${RIM}" stroke-width="0.5" opacity="0.45"/>` +
    `<rect x="${n(left + 2.4)}" y="${n(yf - 15)}" width="6" height="15" fill="#1a1015"/>` +
    `<circle cx="${n(left + 12.6)}" cy="${n(yf - 19)}" r="2.2" fill="none" stroke="#f0dccc" stroke-width="1.1"/>` +
    `<circle cx="${n(left + 12.6)}" cy="${n(yf - 19)}" r="2.2" fill="none" stroke="#e0685e" stroke-width="1.1" stroke-dasharray="1.73 1.73"/>` +
    `<g><circle cx="${n(right - 5.6)}" cy="${n(yf - 13.4)}" r="12" fill="url(#${uid}-lglow)" opacity="0.6"/>` +
    `<rect x="${n(right - 8.4)}" y="${n(yf - 16.4)}" width="5.6" height="5.8" fill="${LAMP}"/>${flicker(r, 0.7, 1)}</g>` +
    `<path d="M${pt(right - 5.6, yf - 16.4)}v5.8M${pt(right - 8.4, yf - 13.5)}h5.6" stroke="#2a1b22" stroke-width="0.6"/>` +
    `<rect x="${n(right - 9)}" y="${n(yf - 10.6)}" width="6.8" height="1" fill="#20151b"/>`
  )
}

/** An orange cat asleep on the planks, curled nose to tail, breathing slowly. */
function cat(x: number, y: number, k: number): string {
  return (
    `<g transform="translate(${pt(x, y)}) scale(${n(k)})">` +
    '<ellipse cx="0.8" cy="0.3" rx="9" ry="1.6" fill="#000000" opacity="0.3"/>' +
    '<g>' +
    '<ellipse cx="0.8" cy="-3.4" rx="7.4" ry="3.6" fill="#9a5638"/>' +
    '<path d="M-4.6 -5.6C-1 -7.6 4.6 -7.4 7.6 -4.4C6 -6.2 1 -6.4 -4.6 -5.6Z" fill="#d48a5c"/>' +
    '<path d="M-1 -6.8l0.6 2.4M2 -6.9l0.4 2.5M5 -6l0.2 2.2" stroke="#7a3f2a" stroke-width="0.7" stroke-linecap="round"/>' +
    '<path d="M-3.8 -6.6C0 -7.8 5 -7.4 7.6 -4.8" stroke="#ffbf94" stroke-width="0.6" fill="none" opacity="0.7"/>' +
    '<animateTransform attributeName="transform" type="scale" values="1 1;1 1.06;1 1" dur="4.2s" begin="-1s" repeatCount="indefinite"/>' +
    '</g>' +
    '<path d="M7.6 -1.6C9.8 0.4 6 1.6 0 1.2C-3 1 -5 0.7 -6.6 0.1" stroke="#8a4a30" stroke-width="1.7" stroke-linecap="round" fill="none"/>' +
    '<circle cx="-6" cy="-2.8" r="3" fill="#a65d3c"/>' +
    '<path d="M-8.7 -4.2L-8.4 -7.4L-6.6 -5.4ZM-5.6 -5.6L-4.3 -7.9L-3.5 -5.1Z" fill="#a65d3c"/>' +
    '<path d="M-8.4 -7.2L-8.7 -4.4M-4.3 -7.7L-5.5 -5.6" stroke="#ffbf94" stroke-width="0.4" opacity="0.6"/>' +
    '<path d="M-7.6 -2.6q0.7 0.5 1.4 0M-5.2 -2.7q0.7 0.5 1.4 0" stroke="#3a1c14" stroke-width="0.4" fill="none"/>' +
    '</g>'
  )
}

/** A tin bucket on the planks. */
function bucket(x: number, y: number, k: number): string {
  return (
    `<g transform="translate(${pt(x, y)}) scale(${n(k)})">` +
    '<path d="M-3 -6.4L3 -6.4L2.4 0L-2.4 0Z" fill="#45555f"/>' +
    '<path d="M0.8 -6.4H3L2.4 0H0.6Z" fill="#000000" opacity="0.25"/>' +
    '<path d="M-2.7 -4.4H2.8" stroke="#2c373e" stroke-width="0.5"/>' +
    '<ellipse cx="0" cy="-6.4" rx="3" ry="0.8" fill="#26313a" stroke="#a6b9bd" stroke-width="0.45"/>' +
    '<path d="M-3 -6.2Q0 -10.4 3 -6.2" stroke="#76878e" stroke-width="0.45" fill="none"/>' +
    '<path d="M-2.4 -6Q-1.6 -6.8 -0.6 -6.4" stroke="#ffb48a" stroke-width="0.5" fill="none" opacity="0.8"/>' +
    '</g>'
  )
}

type Lantern = { z: number; x: number; top: number; hx: number; hy: number; k: number; cx: number; cy: number }

const lanternAt = (z: number): Lantern => {
  const x = rightX(z) - 1.8 / z
  const top = depthY(z) - POST / z
  const hx = x + 8 / z
  const hy = top + 1.2 / z
  const k = LANTERN_K / z
  return { z, x, top, hx, hy, k, cx: hx, cy: hy + 8.1 * k }
}

/** One lantern hanging from its hook: lit (warm glass) or dark glass catching the sky. */
function lanternBody(uid: string, l: Lantern, lit: boolean): string {
  const glass = lit
    ? `<rect x="-3" y="4.4" width="6" height="7.4" rx="1.2" fill="url(#${uid}-lit)"/>`
    : '<rect x="-3" y="4.4" width="6" height="7.4" rx="1.2" fill="#2c2535"/><path d="M-1.8 5.6V10.4" stroke="#d8a8a0" stroke-width="0.6" opacity="0.4"/>'
  return (
    `<g transform="translate(${pt(l.hx, l.hy)}) scale(${n(l.k)})">` +
    `<path d="M0 0V2.2" stroke="${WOOD_DARK}" stroke-width="0.6"/>` +
    glass +
    `<path d="M0 4.4V11.8" stroke="${WOOD_DARK}" stroke-width="0.55" opacity="0.75"/>` +
    `<path d="M-3.6 4.6L-2.2 2H2.2L3.6 4.6ZM-3.5 11.8H3.5V13.2H-3.5Z" fill="${WOOD_DARK}"/>` +
    `<path d="M-2.2 2H2.2L3.6 4.6" stroke="${RIM}" stroke-width="0.4" fill="none" opacity="0.6"/>` +
    '</g>'
  )
}

/**
 * The gauge: lantern posts along the right rail with a draped wire between them. The nearest
 * round(context × 8) lanterns are lit, each with a flickering halo and a pool of light on the
 * planks; their light also shimmers on the water. Unmeasured, none is lit.
 */
function lanterns(r: () => number, uid: string, context: number | undefined): { water: string; posts: string; lights: string } {
  // Randomness first and always, so the scene draws the same whatever the fill.
  const beats = LANTERNS.map(() => flicker(r, 0.72, 1))
  const lit = context === undefined ? 0 : Math.round(context * LANTERNS.length)
  const all = LANTERNS.map(lanternAt)
  let posts = ''
  let hooks = ''
  let wire = ''
  let reflections = ''
  all.forEach((l, i) => {
    posts += post(l.x, l.z, POST, 3.2)
    hooks += `M${pt(l.x, l.top + 0.8 / l.z)}H${n(l.hx + 0.6 / l.z)}`
    const next = all[i + 1]
    if (next) {
      const sag = 5 / ((l.z + next.z) / 2)
      wire += `M${pt(l.x, l.top + 1.6 / l.z)}Q${pt((l.x + next.x) / 2, (l.top + next.top) / 2 + sag * 2)} ${pt(next.x, next.top + 1.6 / next.z)}`
    }
    if (i < lit) {
      const water = depthY(l.z) + WATER / l.z
      const mirror = 2 * water - l.cy
      const rows = 5
      for (let j = 0; j < rows; j++) {
        const y = water + 3 / l.z + ((mirror - water) * j) / rows
        if (y > 336) break
        const w = (7 - j) / l.z
        reflections += `M${pt(l.cx - w / 2, y)}h${n(w)}`
      }
    }
  })
  // The wire runs on from the last post to the shack's eave.
  const last = all[all.length - 1]
  if (last) {
    const ex = rightX(SHACK.front) - 2.5 / SHACK.front
    const ey = depthY(SHACK.front) - SHACK.wall / SHACK.front + 1
    wire += `M${pt(last.x, last.top + 1.6 / last.z)}Q${pt((last.x + ex) / 2, (last.top + ey) / 2 + 1.6)} ${pt(ex, ey)}`
  }
  // Far to near, so nearer halos and lanterns lie over farther ones.
  let lights = ''
  for (let i = all.length - 1; i >= 0; i--) {
    const l = all[i]
    if (!l) continue
    const on = i < lit
    if (on) {
      const glow = 38 / l.z
      lights +=
        `<g>` +
        `<ellipse cx="${n(l.x - 12 / l.z)}" cy="${n(depthY(l.z) - 2 / l.z)}" rx="${n(34 / l.z)}" ry="${n(7 / l.z)}" fill="url(#${uid}-lglow)" opacity="0.7"/>` +
        `<circle cx="${n(l.cx)}" cy="${n(l.cy)}" r="${n(glow)}" fill="url(#${uid}-lglow)"/>` +
        `${beats[i]}</g>`
    }
    lights += lanternBody(uid, l, on)
  }
  const water = reflections
    ? `<path d="${reflections}" stroke="#ffb878" stroke-width="1.2" stroke-linecap="round" opacity="0.6">${loop('opacity', '0.7;0.35;0.6;0.7', 3.6, 1.2)}</path>`
    : ''
  return {
    water,
    posts: `<path d="${posts}" fill="${WOOD}"/><path d="${hooks}" stroke="${WOOD}" stroke-width="0.9" fill="none"/><path d="${wire}" stroke="${WOOD_DARK}" stroke-width="0.55" fill="none" opacity="0.85"/>`,
    lights,
  }
}

/** Dark rocks framing the bottom right, their tops catching the glow, foam breathing at their feet. */
function nearRocks(r: () => number): string {
  const top = `M298 338L306 331L316 327L326 321L336 318L344 312L352 314L362 313L372 319L398 316L414 311L428 314L446 318L488 313L506 307L520 309L534 315L580 312L612 308L630 313L${R} 316`
  const foam = [
    [318, 329, 10],
    [366, 318, 9],
  ]
    .map(([x, y, rx]) => {
      const dur = between(r, 5, 8)
      return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="1.3" fill="#d9c2c6" opacity="0">${loop('opacity', '0;0.4;0.12;0', dur, between(r, 0, dur))}</ellipse>`
    })
    .join('')
  return (
    foam +
    `<path d="${top}V${BOTTOM}H298Z" fill="#17121b"/>` +
    '<path d="M344 312L341 324L346 336M414 311L418 324M506 307L503 321L509 334" stroke="#0e0b11" stroke-width="0.9" fill="none"/>' +
    '<path d="M326 321L336 318L344 312L352 314M406 313L414 311L428 314M488 313L506 307L520 309" stroke="#e08c74" stroke-width="0.8" fill="none" opacity="0.4"/>' +
    // a pair of low rocks off the village (wide panes)
    '<path d="M-150 238L-146 230L-140 228L-134 231L-131 238ZM-124 240L-121 235L-116 235L-113 240ZM-74 268L-69 258L-62 255L-55 259L-51 268Z" fill="#241b29"/>' +
    '<path d="M-146 230L-140 228L-134 231M-69 258L-62 255L-55 259" stroke="#e08c74" stroke-width="0.6" fill="none" opacity="0.4"/>' +
    '<path d="M-154 238.6h28M-78 268.6h31" stroke="#f0c4b4" stroke-width="0.6" opacity="0.4"/>'
  )
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const defs = defsFor(uid, palette)

  // The sky: stars, the afterglow, the halo; clouds behind the sun, then the sun.
  const heavens = skyLayer(r, uid) + backClouds(uid) + sunLayer(uid)
  const gulls =
    flyer({ x: 150, y: 110, s: 0.42, color: '#2e2036', path: '0 0;10 -3;20 0;10 3;0 0', dur: 24, begin: 4 }) +
    flyer({ x: 470, y: 98, s: 0.38, color: '#2e2036', path: '0 0;-12 -3;-24 0;-12 3;0 0', dur: 28, begin: 11 })

  // The far shore and the sea.
  const shore = land(r, uid)
  const sea = seaLayer(r, uid)
  const nearWaves =
    waveBand(r, 236, 280, '#9cc8c8', 0.24, 0.9, 7, 21, 5) +
    waveBand(r, 280, 340, '#7cc4c0', 0.2, 1, -8, 24, 12)

  // The pier: the shadow and pilings under it, the deck and what lies on it, the shack, the rails.
  const cz = 1.98
  const props = cat(133, depthY(cz) - 0.6, 1.85 / cz) + bucket(148, depthY(cz) - 1.6, 1.8 / cz)
  const leftRail = railing(z => leftX(z) + 1.8 / z, [0.78, 1.2, 1.62, 2.04, 2.46, 2.88, 3.3, 3.72, 4.14, 4.5])
  const rightRail = railing(z => rightX(z) - 1.8 / z, [0.86, 1.52, 1.96, 2.4, 2.84, 3.28, 3.72, 4.16])

  // The gauge, then the swarm: drawn from `r` last so the scenery never shifts as they change.
  const gauge = lanterns(r, uid, context)
  const caption = gaugeCaption({ x: 104, y: 226, name: scene.gauge, value: contextText, palette, anchor: 'end' })
  const boats = sailboats(uid, scene, swarm)

  return {
    defs,
    body:
      heavens +
      gulls +
      shore.art +
      shore.lights +
      sea +
      shore.reflections +
      boats +
      buoy(290, 234) +
      nearWaves +
      gauge.water +
      underside() +
      deck(r, uid) +
      props +
      shack(r, uid) +
      leftRail +
      rightRail +
      gauge.posts +
      gauge.lights +
      nearRocks(r) +
      caption,
  }
}
