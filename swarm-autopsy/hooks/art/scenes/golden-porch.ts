// Golden Hour Porch: the view from a wooden farmhouse porch at golden hour. A large low sun
// sinks behind hazy rose hills, its halo breathing and its long rays turning slowly; soft
// clouds drift by, each lobe lit gold from below. Wheat fields roll out in a patchwork of ripe
// gold, meadow and ploughed earth to a red barn and silo, a lone round tree, a winding dirt path
// and a windmill turning on the far ridge; a wide pane adds hay bales, poplars, a split-rail
// fence and a cottage with one warm window. The near wheat sways in waves and pollen drifts in
// the light. On the porch: the rail between two posts, a rocking chair rocking gently with a
// cushion and a plaid blanket, a potted geranium, a watering can and wind chimes, and the sun
// laying stripes of light between the balusters onto the boards.
// The context gauge is a glass jar of honey on the rail with a dipper standing in it: the
// honey rises from empty to full as the context window fills, glowing where the sun shines
// through it, with a warm glint on the glass; unmeasured, the jar stands empty and dim. Each
// active subagent is a swallow looping over the fields.

import type { Area } from '../kit.ts'
import type { Painted, PaintArgs } from '../scene.ts'
import { BLEED, SCENE_W, between, cloud, drift, gaugeCaption, linearBox, linearY, loop, motes, n, radialBox, spin, sway, swarmSpots } from '../kit.ts'

type Pt = readonly [number, number]

const L = -BLEED
const R = SCENE_W + BLEED
/** Every land layer reaches down to here, well under the fade. */
const BOTTOM = 460

/** The low sun, and the point on the horizon below it where the furrows and the light stripes converge. */
const SX = 146
const SY = 184
const SR = 22
const HORIZON = 198

/** The porch rail, top to bottom: the cap's lit top, its face, the beam under it, the balusters, the bottom rail, the floor. */
const CAP = 252
const CAP_FACE = 255
const BEAM = 259.5
const BAL_TOP = 264
const BAL_BOTTOM = 298
const FLOOR = 303
const BAL_STEP = 9
/** The two posts framing the view. */
const POSTS = [12, 328] as const
const POST_HALF = 7

/** The honey jar on the rail: its axis and the base it stands on. */
const JX = 162
const JB = 254

/** The rocking chair: the point where its rockers meet the boards. */
const CX = 280
const CY = 322

const WOOD = { deep: '#1d130d', dark: '#2b1d16', face: '#3a281d', top: '#6a4630', chair: '#4a3022', far: '#25170f' }
const BIRD = '#2a1d2c'
const POLLEN = '#ffe2a2'

/** Cloud tones, top of each lobe to its lit underside, and the gold rim below. */
const CLOUD_TONES = {
  warm: ['#8f5d78', '#b67682', '#f4ae88', '#ffd59c'],
  low: ['#ad7286', '#cf8b8c', '#ffc293', '#ffe2aa'],
  dusk: ['#4a3350', '#5a3d5a', '#9c6478', '#c48492'],
} as const
type CloudKind = keyof typeof CLOUD_TONES

/** The land's ridgelines, far to near: hazy hills, the windmill's ridge, the golden fields, the near wheat. */
const farY = (x: number): number => 192 + 4.5 * Math.sin(x / 61) + 2.5 * Math.sin(x / 23 + 2)
const ridgeY = (x: number): number => 205 + 3 * Math.sin(x / 43 + 1.3) + 1.6 * Math.sin(x / 17)
const fieldY = (x: number): number => 212 + 2.4 * Math.sin(x / 47 + 0.6) + 1.2 * Math.sin(x / 19)
const nearY = (x: number): number => 233 + 1.8 * Math.sin(x / 31 + 1)

/** Samples of f from x0 to x1 every `step`. */
function sample(f: (x: number) => number, step: number, x0: number = L, x1: number = R): Pt[] {
  const out: Pt[] = []
  for (let x = x0; x < x1; x += step) out.push([x, f(x)])
  out.push([x1, f(x1)])
  return out
}

/** A smooth line through `points`: quadratic curves through their midpoints. */
function smoothLine(points: readonly Pt[]): string {
  const at = (i: number): Pt => points[i] ?? [0, 0]
  const [x0, y0] = at(0)
  let d = `M${n(x0)} ${n(y0)}`
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = at(i)
    const [nx, ny] = at(i + 1)
    d += `Q${n(x)} ${n(y)} ${n((x + nx) / 2)} ${n((y + ny) / 2)}`
  }
  const [xl, yl] = at(points.length - 1)
  return `${d}L${n(xl)} ${n(yl)}`
}

/** A land band: its smooth ridgeline from L to R, filled down to the bottom. */
const band = (f: (x: number) => number, step: number, fill: string): string =>
  `<path d="${smoothLine(sample(f, step))}L${R} ${BOTTOM}L${L} ${BOTTOM}Z" fill="${fill}"/>`

/** A circle as path data, so many can share one path. */
const dot = (x: number, y: number, rad: number): string =>
  `M${n(x - rad)} ${n(y)}a${n(rad)} ${n(rad)} 0 1 0 ${n(rad * 2)} 0a${n(rad)} ${n(rad)} 0 1 0 ${n(-rad * 2)} 0`

/** A point for a round-capped stroke: drawn with stroke-width as its diameter, it is the cheapest dot there is. */
const speck = (x: number, y: number): string => `M${n(x)} ${n(y)}h0`

/** Where a line from the sun's horizon point through (x, y0) reaches at y1: furrows, field edges and light stripes follow it. */
const toward = (x: number, y0: number, y1: number): number => SX + ((x - SX) * (y1 - HORIZON)) / (y0 - HORIZON)

/** Catmull-Rom samples through `points`, `per` samples per segment. */
function smooth(points: readonly Pt[], per: number): Pt[] {
  const out: Pt[] = []
  const at = (i: number): Pt => points[Math.min(points.length - 1, Math.max(0, i))] ?? [0, 0]
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    for (let s = 0; s < per; s++) {
      const t = s / per
      const c = (a: number, b: number, cc: number, d: number): number =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t * t + (-a + 3 * b - 3 * cc + d) * t * t * t)
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(at(points.length - 1))
  return out
}

/** The cloud shapes, one per tone, drawn once and placed with `<use>`: two clusters of the kit's cloud in gold, and over them each lobe shaded rose to peach. */
function cloudDefs(uid: string): string {
  return (Object.keys(CLOUD_TONES) as CloudKind[])
    .map(kind => {
      const [top, mid, low, under] = CLOUD_TONES[kind]
      // the high dusk cloud, seen only in a tall dock, is one cluster; the lit ones get a smaller cluster beside them
      const side = kind === 'dusk' ? '' : cloud({ x: 40, y: 7, scale: 0.6, color: under, opacity: 1 }) + cloud({ x: 40, y: 5, scale: 0.6, color: `url(#${uid}-c${kind})`, opacity: 1 })
      return (
        linearBox(`${uid}-c${kind}`, [
          [0, top],
          [0.5, mid],
          [1, low],
        ]) +
        `<g id="${uid}-cloud-${kind}">` +
        cloud({ x: 0, y: 3, scale: 1, color: under, opacity: 1 }) +
        side +
        cloud({ x: 0, y: 0, scale: 1, color: `url(#${uid}-c${kind})`, opacity: 1 }) +
        '</g>'
      )
    })
    .join('')
}

/** One cloud placed and stretched (a negative `sx` mirrors it), drifting by `distance` when given. */
function cloudAt(uid: string, kind: CloudKind, c: { x: number; y: number; sx: number; sy: number; opacity: number; distance?: number; dur?: number; begin?: number }): string {
  const motion = c.distance ? drift(`0 0;${n(c.distance)} 0;0 0`, c.dur ?? 80, c.begin ?? 0) : ''
  return `<g transform="translate(${n(c.x)} ${n(c.y)}) scale(${n(c.sx)} ${n(c.sy)})" opacity="${n(c.opacity)}"><use href="#${uid}-cloud-${kind}">${motion}</use></g>`
}

/** The sky a tall dock shows above the painting: dusk coming on, a few first stars and high thin cloud. */
function upperSky(uid: string, r: () => number): string {
  let d = ''
  for (let i = 0; i < 16; i++) d += speck(between(r, L, R), between(r, -330, -70))
  return (
    `<path d="${d}" stroke="#f7ead8" stroke-width="1.4" stroke-linecap="round" opacity="0.4"/>` +
    cloudAt(uid, 'dusk', { x: 60, y: -38, sx: 1.9, sy: 0.3, opacity: 0.6 }) +
    cloudAt(uid, 'dusk', { x: 300, y: -104, sx: -1.6, sy: 0.26, opacity: 0.5 }) +
    cloudAt(uid, 'dusk', { x: -200, y: -66, sx: -1.8, sy: 0.28, opacity: 0.5 }) +
    cloudAt(uid, 'dusk', { x: 530, y: -34, sx: 1.8, sy: 0.28, opacity: 0.5 })
  )
}

/** The sun: a wide glow over the horizon, slow rays turning and breathing, the corona, the disc. */
function sunLayer(uid: string, r: () => number): string {
  let rays = ''
  const count = 11
  for (let i = 0; i < count; i++) {
    const a = ((-174 + (168 * (i + 0.5)) / count + between(r, -5, 5)) * Math.PI) / 180
    const w = (between(r, 1.3, 2.8) * Math.PI) / 180
    const len = between(r, 96, 132)
    rays += `M${SX} ${SY}L${n(SX + len * Math.cos(a - w))} ${n(SY + len * Math.sin(a - w))}L${n(SX + len * Math.cos(a + w))} ${n(SY + len * Math.sin(a + w))}Z`
  }
  return (
    `<ellipse cx="${SX}" cy="${SY + 16}" rx="440" ry="140" fill="url(#${uid}-skyglow)"/>` +
    `<g><path d="${rays}" fill="url(#${uid}-rays)"/>${sway(SX, SY, 2.5, 46, 12)}${loop('opacity', '0.55;1;0.55', 13, 4)}</g>` +
    `<circle cx="${SX}" cy="${SY}" r="64" fill="url(#${uid}-corona)">${loop('opacity', '0.72;1;0.72', 8, 2)}</circle>` +
    `<circle cx="${SX}" cy="${SY}" r="${SR}" fill="url(#${uid}-sun)"/>`
  )
}

/** Clouds lit from below, drifting slowly; the ones nearer the horizon are pinker and brighter. */
function cloudLayer(uid: string): string {
  return (
    cloudAt(uid, 'warm', { x: 34, y: 134, sx: 0.95, sy: 0.5, opacity: 0.92, distance: 22, dur: 70, begin: 10 }) +
    cloudAt(uid, 'warm', { x: 268, y: 116, sx: -1.15, sy: 0.56, opacity: 0.9, distance: 16, dur: 84, begin: 30 }) +
    cloudAt(uid, 'warm', { x: 190, y: 97, sx: 0.55, sy: 0.38, opacity: 0.62, distance: 20, dur: 64, begin: 5 }) +
    // further out, for a wide pane
    cloudAt(uid, 'warm', { x: -180, y: 112, sx: -1.4, sy: 0.52, opacity: 0.88, distance: -16, dur: 90, begin: 40 }) +
    cloudAt(uid, 'warm', { x: 500, y: 104, sx: 1.3, sy: 0.5, opacity: 0.88 }) +
    cloudAt(uid, 'low', { x: -70, y: 166, sx: 0.9, sy: 0.36, opacity: 0.75 }) +
    cloudAt(uid, 'low', { x: 420, y: 160, sx: -0.95, sy: 0.36, opacity: 0.75 })
  )
}

/** A windmill on the far ridge, hazy with distance, its four slim lattice sails turning slowly. */
function windmill(x: number, base: number, accent: string): string {
  const top = base - 19
  const rot = (px: number, py: number, k: number): string => {
    const [a, b] = k === 0 ? [px, py] : k === 1 ? [-py, px] : k === 2 ? [-px, -py] : [py, -px]
    return `${n(a)} ${n(b)}`
  }
  let sails = ''
  let frame = ''
  for (let k = 0; k < 4; k++) {
    sails += `M${rot(0.6, -3.5, k)}L${rot(3.4, -4, k)}L${rot(3.4, -16, k)}L${rot(0.6, -16.5, k)}Z`
    frame += `M${rot(0, 0, k)}L${rot(0, -17, k)}M${rot(0, -8, k)}L${rot(3.4, -8, k)}M${rot(0, -12, k)}L${rot(3.4, -12, k)}`
  }
  return (
    `<path d="M${n(x - 4.6)} ${n(base)}L${n(x - 2.7)} ${n(top)}H${n(x + 2.7)}L${n(x + 4.6)} ${n(base)}Z" fill="#8e5d68"/>` +
    `<path d="M${n(x - 2.7)} ${n(top)}L${n(x - 4.6)} ${n(base)}" stroke="${accent}" stroke-width="0.6" opacity="0.5"/>` +
    `<path d="M${n(x - 3.8)} ${n(top + 0.6)}Q${n(x)} ${n(top - 5)} ${n(x + 3.8)} ${n(top + 0.6)}Z" fill="#714658"/>` +
    `<rect x="${n(x - 1)}" y="${n(base - 4.4)}" width="2" height="4.4" fill="#5e3a4a"/>` +
    `<g transform="translate(${n(x)} ${n(top - 1.5)})"><g>` +
    `<path d="${sails}" fill="#f8d6b0" opacity="0.5"/><path d="${frame}" stroke="#74485a" stroke-width="0.5"/>` +
    spin(0, 0, 0, 360, 56) +
    `</g><circle r="1.2" fill="#5a3848"/></g>`
  )
}

/** The far hills, hazy and rosy with a glowing mist at their feet, the light spilling over them below the sun, the windmill. */
function farLand(uid: string, r: () => number, accent: string): string {
  let trees = ''
  for (const x of [-272, -262, -251, -241, -231, 588, 598, 607]) {
    const h = between(r, 13, 21)
    trees += `<ellipse cx="${n(x)}" cy="${n(ridgeY(x) + 1 - h / 2)}" rx="${n(between(r, 2.2, 3))}" ry="${n(h / 2)}"/>`
  }
  // a copse sitting on the ridge: crowns of different sizes, sunk into the land so none floats
  let copse = ''
  for (const [x, rad] of [
    [-124, 3.2],
    [-116, 4.6],
    [-108, 5.6],
    [-99, 4.2],
    [-92, 3],
  ] as const)
    copse += dot(x + between(r, -1.5, 1.5), ridgeY(x) - rad * 0.55, rad)
  return (
    band(farY, 28, `url(#${uid}-far)`) +
    band(ridgeY, 22, `url(#${uid}-ridge)`) +
    `<g fill="#8a5866">${trees}<path d="${copse}"/></g>` +
    `<ellipse cx="${SX}" cy="${HORIZON}" rx="96" ry="16" fill="url(#${uid}-bleed)"/>` +
    windmill(270, ridgeY(270) + 1, accent)
  )
}

/** The patchwork: two rows of fields following the land, cut into patches whose sides run toward the sun's point, hedged between. */
function patchwork(r: () => number): string {
  const tones = [
    ['#ffe3a0', 0.26],
    ['#9a8a40', 0.24],
    ['#b0603a', 0.2],
  ] as const
  const byTone = tones.map(() => '')
  let hedges = ''
  for (const a of [0, 7]) {
    const b = a === 0 ? 7 : 15.5
    let x = L - between(r, 0, 60)
    while (x < R) {
      const x2 = Math.min(R + 40, x + between(r, 50, 130))
      const xm = (x + x2) / 2
      const t = Math.floor(between(r, 0, tones.length + 1.4))
      const yb = fieldY(x) + b
      const yb2 = fieldY(x2) + b
      const right = toward(x2, fieldY(x2) + a, yb2)
      if (t < tones.length)
        byTone[t] += `M${n(x)} ${n(fieldY(x) + a)}L${n(xm)} ${n(fieldY(xm) + a)}L${n(x2)} ${n(fieldY(x2) + a)}L${n(right)} ${n(yb2)}L${n(toward(x, fieldY(x) + a, yb))} ${n(yb)}Z`
      if (between(r, 0, 1) < 0.45) hedges += `M${n(x2)} ${n(fieldY(x2) + a)}L${n(right)} ${n(yb2)}`
      x = x2
    }
  }
  for (const a of [7, 15.5]) hedges += smoothLine(sample(xx => fieldY(xx) + a, 28))
  return (
    tones.map(([fill, opacity], i) => `<path d="${byTone[i] ?? ''}" fill="${fill}" opacity="${opacity}"/>`).join('') +
    `<path d="${hedges}" fill="none" stroke="#704a2a" stroke-width="0.8" opacity="0.5"/>`
  )
}

/** The red barn with its silo: the gable end toward us, the long side going back, lit along its sunward edges. */
function barn(x: number, base: number, accent: string): string {
  const p = (dx: number, dy: number): string => `${n(x + dx)} ${n(base + dy)}`
  return (
    `<ellipse cx="${n(x + 22)}" cy="${n(base + 1)}" rx="20" ry="1.6" fill="#6a3c24" opacity="0.45"/>` +
    `<path d="M${p(18, 0)}L${p(30, -1)}V${n(base - 9.5)}L${p(18, -9)}Z" fill="#8a4036"/>` +
    `<path d="M${p(9, -17)}L${p(15, -14)}L${p(18, -9)}L${p(30, -9.5)}L${p(27, -14.5)}L${p(21, -17.5)}Z" fill="#5a302e"/>` +
    `<path d="M${p(0, 0)}V${n(base - 9)}L${p(3, -14)}L${p(9, -17)}L${p(15, -14)}L${p(18, -9)}V${n(base)}Z" fill="#b0564a"/>` +
    `<rect x="${n(x + 6)}" y="${n(base - 7)}" width="6" height="7" fill="#7a3830"/>` +
    `<path d="M${p(6, -7)}L${p(12, 0)}M${p(12, -7)}L${p(6, 0)}M${p(-0.6, -8.6)}L${p(3, -14)}L${p(9, -17)}L${p(15, -14)}L${p(18.6, -8.6)}" stroke="#f0d2b4" stroke-width="0.5" opacity="0.5" fill="none"/>` +
    `<rect x="${n(x + 7.6)}" y="${n(base - 13.2)}" width="2.8" height="2.6" fill="#5a2a26"/>` +
    `<path d="M${p(9, -17.4)}L${p(21, -17.9)}L${p(27.4, -14.6)}M${p(18, 0)}V${n(base - 9)}" stroke="${accent}" stroke-width="0.6" opacity="0.6" fill="none"/>` +
    // the silo: shaded on the side away from the sun, banded, its dome catching the light
    `<path d="M${p(33, 0)}V${n(base - 19)}Q${p(36, -24.5)} ${p(39, -19)}V${n(base)}Z" fill="#a67470"/>` +
    `<path d="M${p(33, 0)}V${n(base - 19)}Q${p(33.6, -21.4)} ${p(35, -22.6)}V${n(base)}Z" fill="#7e5258"/>` +
    `<path d="M${p(39, 0)}V${n(base - 19)}Q${p(38.6, -22)} ${p(36, -23.6)}M${p(33, -6)}H${n(x + 39)}M${p(33, -12)}H${n(x + 39)}" stroke="${accent}" stroke-width="0.5" opacity="0.55" fill="none"/>`
  )
}

/** The lone round tree on its rise, lit on its sunward side, its crown stirring a little. */
function loneTree(x: number, base: number, accent: string): string {
  const dark = dot(x, base - 17, 10.5) + dot(x - 8, base - 12, 6.5) + dot(x + 8, base - 12, 6.5) + dot(x - 4, base - 24, 7) + dot(x + 5, base - 23, 7)
  const lit = dot(x - 4, base - 21, 6.4) + dot(x - 9, base - 14, 4) + dot(x - 6, base - 27, 3.6)
  return (
    `<ellipse cx="${n(x + 9)}" cy="${n(base + 1.2)}" rx="14" ry="1.8" fill="#5a3420" opacity="0.5"/>` +
    `<path d="M${n(x - 1.6)} ${n(base)}L${n(x - 1)} ${n(base - 10)}L${n(x + 1)} ${n(base - 10)}L${n(x + 1.8)} ${n(base)}Z" fill="#4a2f25"/>` +
    `<g><path d="${dark}" fill="#4a462b"/><path d="${lit}" fill="#6c6636"/>` +
    `<path d="M${n(x - 10.5)} ${n(base - 9)}Q${n(x - 15)} ${n(base - 14)} ${n(x - 12)} ${n(base - 19)}Q${n(x - 12)} ${n(base - 30)} ${n(x - 2)} ${n(base - 31)}Q${n(x + 4)} ${n(base - 31.5)} ${n(x + 7)} ${n(base - 29)}" stroke="${accent}" stroke-width="0.9" opacity="0.6" fill="none"/>` +
    `${sway(x, base, 1.2, 9, 3)}</g>`
  )
}

/** The dirt track winding from the porch steps past the lone tree and out across the fields to the barn: two worn ruts, grass between. */
function dirtPath(uid: string): string {
  const centre = smooth(
    [
      [94, 219.4],
      [126, 219],
      [160, 219.6],
      [194, 221.4],
      [210, 226],
      [216, 233],
      [206, 243],
      [212, 254],
      [232, 272],
      [244, 302],
    ],
    3,
  )
  const ribbon = (share: number): string => {
    const left: string[] = []
    const right: string[] = []
    centre.forEach((p, i) => {
      const a = centre[Math.max(0, i - 1)] ?? p
      const b = centre[Math.min(centre.length - 1, i + 1)] ?? p
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const w = share * (0.5 + 9 * (i / (centre.length - 1)) ** 2.2)
      const nx = -(b[1] - a[1]) / len
      const ny = (b[0] - a[0]) / len
      left.push(`${n(p[0] + nx * w)} ${n(p[1] + ny * w)}`)
      right.push(`${n(p[0] - nx * w)} ${n(p[1] - ny * w)}`)
    })
    return `M${left.join('L')}L${right.reverse().join('L')}Z`
  }
  const track = ribbon(1)
  return (
    `<path d="${track}" fill="url(#${uid}-path)" stroke="#8a5634" stroke-width="0.5" stroke-opacity="0.6"/>` +
    `<path d="${ribbon(0.28)}" fill="#a07a3c" opacity="0.7"/>`
  )
}

/** Out to the sides, for a wide pane: round hay bales on the left, a split-rail fence and a cottage with a warm window on the right. */
function farmSides(r: () => number, accent: string): string {
  let faces = ''
  let rolls = ''
  let shadows = ''
  for (const x of [-288, -252, -236, -176, -140, -78, 380]) {
    const y = fieldY(x) + between(r, 7, 18)
    const rad = 1.6 + (y - 212) * 0.16
    shadows += `M${n(x)} ${n(y + rad)}h${n(rad * 3)}`
    faces += dot(x, y, rad)
    rolls += `M${n(x + rad * 0.45)} ${n(y)}a${n(rad * 0.45)} ${n(rad * 0.45)} 0 1 0 ${n(-rad * 0.45)} ${n(rad * 0.45)}M${n(x)} ${n(y - rad)}a${n(rad)} ${n(rad)} 0 0 1 ${n(rad)} ${n(rad)}`
  }
  const bales =
    `<path d="${shadows}" stroke="#6a3c22" stroke-width="1.2" opacity="0.5"/>` +
    `<path d="${faces}" fill="#d29a55"/>` +
    `<path d="${rolls}" fill="none" stroke="#9a6632" stroke-width="0.6"/>`
  // the fence along the second row of fields
  let posts = ''
  for (let x = 352; x < R; x += 14) posts += `M${n(x)} ${n(fieldY(x) + 18)}v-6`
  const fence =
    `<path d="${posts}${smoothLine(sample(x => fieldY(x) + 13.5, 28, 352, R))}${smoothLine(sample(x => fieldY(x) + 15.8, 28, 352, R))}" stroke="#5a3a26" stroke-width="0.8" fill="none"/>` +
    `<path d="${smoothLine(sample(x => fieldY(x) + 13, 28, 352, R))}" stroke="${accent}" stroke-width="0.5" opacity="0.4" fill="none"/>`
  // the cottage on its rise, a warm window, a round tree beside it
  const cx = 466
  const cb = fieldY(cx) + 6
  const q = (dx: number, dy: number): string => `${n(cx + dx)} ${n(cb + dy)}`
  const cottage =
    `<path d="M${q(-9, 0)}V${n(cb - 10)}H${n(cx + 9)}V${n(cb)}Z" fill="#b58072"/>` +
    `<rect x="${n(cx + 4)}" y="${n(cb - 21)}" width="2.6" height="7" fill="#5c3a42"/>` +
    `<path d="M${q(-11, -9.5)}L${q(0, -19)}L${q(11, -9.5)}Z" fill="#5c3a42"/>` +
    `<path d="M${q(-11, -9.5)}L${q(0, -19)}" stroke="${accent}" stroke-width="0.6" opacity="0.5"/>` +
    `<rect x="${n(cx - 5.6)}" y="${n(cb - 7.6)}" width="3.6" height="3.4" fill="#ffd27a"/>` +
    `<circle cx="${n(cx - 3.8)}" cy="${n(cb - 6)}" r="5" fill="#ffc46b" opacity="0.18"/>` +
    `<rect x="${n(cx + 1.6)}" y="${n(cb - 7)}" width="3.4" height="7" fill="#6e4448"/>` +
    `<path d="${dot(cx + 19, cb - 9, 6)}${dot(cx + 24, cb - 6, 4.4)}${dot(cx + 15, cb - 6, 4)}" fill="#4f4a2e"/>` +
    `<rect x="${n(cx + 18.4)}" y="${n(cb - 3)}" width="1.4" height="3" fill="#4a2f25"/>`
  return bales + fence + cottage
}

/**
 * The near wheat behind the rail: gold heads catching the light above the cap, swaying in a wave that rolls from left to
 * right. Each group bends from the stalks' feet (a shear, so no end lifts); groups are narrow over the canvas, wide out at
 * the sides, and none grow behind the jar or on the path.
 */
function wheatLayer(r: () => number): string {
  const foot = 262
  const edges = [L, -110, -20, 50, 120, 190, 260, 345, 470, R]
  const skip = (x: number): boolean => (x > 148 && x < 177) || (x > 198 && x < 228)
  const dur = 6.5
  let out = ''
  for (let g = 0; g < edges.length - 1; g++) {
    const x0 = edges[g] ?? 0
    const x1 = edges[g + 1] ?? 0
    const dense = x0 >= -20 && x1 <= 345
    const gap = dense ? 5 : 13
    let stems = ''
    let heads = ''
    let bright = ''
    for (let x = x0 + between(r, 0, gap); x < x1; x += between(r, gap * 0.6, gap * 1.4)) {
      if (skip(x)) continue
      const lean = between(r, -2.4, 2.4)
      const hy = between(r, 241, 253) - foot
      if (dense) stems += `M${n(x)} 0L${n(x + lean)} ${n(hy)}`
      const head = `M${n(x + lean)} ${n(hy)}l${n(lean * 0.12)} -5`
      if (between(r, 0, 1) < 0.35) bright += head
      else heads += head
    }
    const shear = `<animateTransform attributeName="transform" type="skewX" values="-1.8;6;-1.8" dur="${dur}s" begin="${n(-(((R - (x0 + x1) / 2) / 150) % dur))}s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>`
    out +=
      `<g transform="translate(0 ${foot})"><g>${shear}` +
      (stems ? `<path d="${stems}" stroke="#7a5030" stroke-width="0.7"/>` : '') +
      `<path d="${heads}" stroke="#d99a4c" stroke-width="2.3"/><path d="${bright}" stroke="#ffd283" stroke-width="2.3"/></g></g>`
  }
  return `<g fill="none" stroke-linecap="round">${out}</g>`
}

/** The near field below the fields, dark with the backlight, and its gold-tipped edge. */
function nearField(uid: string): string {
  const edge = smoothLine(sample(nearY, 30))
  return `<path d="${edge}L${R} ${BOTTOM}L${L} ${BOTTOM}Z" fill="url(#${uid}-near)"/><path d="${edge}" stroke="#ffcf7e" stroke-width="0.8" fill="none" opacity="0.3"/>`
}

/** The rail, the balusters (patterned, lit on their sunward edges), the floor and its stripes of sun, the two posts. */
function porch(uid: string, accent: string): string {
  const h = BAL_BOTTOM - BAL_TOP
  const rails =
    `<rect x="${L}" y="${BAL_TOP}" width="${SX - L}" height="${h}" fill="url(#${uid}-balL)"/>` +
    `<rect x="${SX}" y="${BAL_TOP}" width="${R - SX}" height="${h}" fill="url(#${uid}-balR)"/>` +
    `<rect x="${L}" y="${CAP}" width="${R - L}" height="${CAP_FACE - CAP}" fill="${WOOD.top}"/>` +
    `<rect x="${L}" y="${CAP_FACE}" width="${R - L}" height="${n(BEAM - CAP_FACE)}" fill="${WOOD.face}"/>` +
    `<rect x="${L}" y="${BEAM}" width="${R - L}" height="${n(BAL_TOP - BEAM)}" fill="${WOOD.dark}"/>` +
    `<path d="M${L} ${CAP}H${R}" stroke="${accent}" stroke-width="0.9" opacity="0.8"/>` +
    `<path d="M${L} ${n(BEAM + 0.5)}H${R}" stroke="${WOOD.deep}" stroke-width="1"/>` +
    `<rect x="${L}" y="${BAL_BOTTOM}" width="${R - L}" height="${FLOOR - BAL_BOTTOM}" fill="${WOOD.dark}"/>` +
    `<path d="M${L} ${BAL_BOTTOM}H${R}" stroke="${accent}" stroke-width="0.6" opacity="0.22"/>`
  let seams = ''
  for (let x = -180; x <= 520; x += 20) seams += `M${x} ${FLOOR}L${n(toward(x, FLOOR, BOTTOM))} ${BOTTOM}`
  let stripes = ''
  const far = 356
  for (let g = -18; g < 360; g += BAL_STEP) {
    const a = g + 6.6
    const b = g + 11.4
    stripes += `M${n(a)} ${FLOOR + 2}H${n(b)}L${n(toward(b, FLOOR, far))} ${far}H${n(toward(a, FLOOR, far))}Z`
  }
  const floor =
    `<rect x="${L}" y="${FLOOR}" width="${R - L}" height="${BOTTOM - FLOOR}" fill="url(#${uid}-floor)"/>` +
    `<path d="${stripes}" fill="url(#${uid}-stripe)"/>` +
    `<path d="${seams}" stroke="#120b07" stroke-width="0.8" opacity="0.7"/>`
  const posts = POSTS.map(x => {
    const sunward = x < SX ? 1 : -1
    const shade = x < SX ? x - POST_HALF : x + POST_HALF - 4
    return (
      `<rect x="${x - POST_HALF}" y="-900" width="${POST_HALF * 2}" height="${FLOOR + 908}" fill="${WOOD.face}"/>` +
      `<rect x="${shade}" y="-900" width="4" height="${FLOOR + 908}" fill="${WOOD.dark}"/>` +
      `<path d="M${n(x + sunward * (POST_HALF - 0.4))} -900V${FLOOR + 8}" stroke="${accent}" stroke-width="0.8" opacity="0.6"/>` +
      `<path d="M${x - 2} -900V${FLOOR}M${n(x + 2.6)} -900V${FLOOR}" stroke="${WOOD.deep}" stroke-width="0.4" opacity="0.5"/>` +
      `<rect x="${n(x - POST_HALF - 1.5)}" y="${CAP - 2}" width="${POST_HALF * 2 + 3}" height="4" fill="${WOOD.dark}"/>` +
      `<rect x="${n(x - POST_HALF - 1.5)}" y="${FLOOR - 7}" width="${POST_HALF * 2 + 3}" height="15" fill="${WOOD.deep}"/>`
    )
  }).join('')
  return rails + floor + posts
}

/** The porch's patterns and gradients: balusters lit on the side facing the sun, the boards, the stripes of light. */
function porchDefs(uid: string, accent: string): string {
  const h = BAL_BOTTOM - BAL_TOP
  const balusters = (id: string, rimX: number): string =>
    `<pattern id="${id}" patternUnits="userSpaceOnUse" x="0" y="${BAL_TOP}" width="${BAL_STEP}" height="${h}">` +
    `<rect x="2.8" width="3.4" height="${h}" fill="${WOOD.dark}"/><rect x="${rimX}" width="0.6" height="${h}" fill="${accent}" opacity="0.3"/></pattern>`
  return (
    balusters(`${uid}-balL`, 5.6) +
    balusters(`${uid}-balR`, 2.8) +
    linearY(`${uid}-floor`, FLOOR, 372, [
      [0, '#2c1e15'],
      [1, '#1b1412'],
    ]) +
    linearY(`${uid}-stripe`, FLOOR, 356, [
      [0, accent, 0.2],
      [1, accent, 0],
    ])
  )
}

/** The honey jar, the gauge: the honey's level is the context window's fill. */
function honeyJar(uid: string, context: number | undefined, accent: string): { defs: string; body: string } {
  const measured = context !== undefined
  const f = context ?? 0
  const p = (dx: number, dy: number): string => `${n(JX + dx)} ${n(JB + dy)}`
  const outer = `M${p(-10, 0)}Q${p(-13, 0)} ${p(-13, -3)}L${p(-13, -21)}Q${p(-13, -25.5)} ${p(-9, -26.5)}L${p(-9, -29)}L${p(9, -29)}L${p(9, -26.5)}Q${p(13, -25.5)} ${p(13, -21)}L${p(13, -3)}Q${p(13, 0)} ${p(10, 0)}Z`
  const inner = `M${p(-9.4, -1.4)}Q${p(-11.6, -1.4)} ${p(-11.6, -3.6)}L${p(-11.6, -21)}Q${p(-11.6, -24.6)} ${p(-7.8, -25.4)}L${p(-7.8, -30)}L${p(7.8, -30)}L${p(7.8, -25.4)}Q${p(11.6, -24.6)} ${p(11.6, -21)}L${p(11.6, -3.6)}Q${p(11.6, -1.4)} ${p(9.4, -1.4)}Z`
  const level = JB - 1.4 - f * 26.8
  const depth = JB - 1.4 - level
  const defs =
    `<clipPath id="${uid}-jar"><path d="${inner}"/></clipPath>` +
    `<clipPath id="${uid}-honey"><rect x="${JX - 14}" y="${n(level)}" width="28" height="${n(depth + 2)}"/></clipPath>` +
    linearY(`${uid}-honeyfill`, JB - 28, JB, [
      [0, '#ffd47c'],
      [0.4, '#f2a43e'],
      [1, '#a8581a'],
    ]) +
    radialBox(`${uid}-honeyglow`, [
      [0, '#fff6d4', 0.95],
      [0.45, '#ffd27a', 0.5],
      [1, '#ffc46b', 0],
    ]) +
    radialBox(`${uid}-jarhalo`, [
      [0, accent, 0.55],
      [0.5, accent, 0.16],
      [1, accent, 0],
    ])
  const halo = measured
    ? `<ellipse cx="${JX}" cy="${JB - 15}" rx="${n(20 + 14 * f)}" ry="${n(19 + 10 * f)}" fill="url(#${uid}-jarhalo)" opacity="${n(0.2 + 0.55 * f)}"/>`
    : ''
  const dipper =
    `<ellipse cx="${n(JX + 1.2)}" cy="${JB - 6}" rx="3.2" ry="4.4" fill="#9a6a3c"/>` +
    `<path d="M${p(-2, -8)}h6.4M${p(-2.2, -6)}h6.8M${p(-2, -4)}h6.4" stroke="#6a4426" stroke-width="0.6"/>` +
    `<path d="M${p(1.4, -9)}L${p(11.5, -44)}" stroke="#8a5a34" stroke-width="1.8" stroke-linecap="round"/>` +
    `<circle cx="${n(JX + 11.8)}" cy="${JB - 45}" r="1.8" fill="#8a5a34"/>` +
    `<path d="M${p(0.6, -10)}L${p(10.6, -44.4)}" stroke="${accent}" stroke-width="0.5" opacity="0.7"/>`
  let honey = ''
  if (measured && f > 0.004) {
    let bubbles = ''
    // a few bubbles caught in the honey, only those under its surface
    const spots = [-5, -6, 4.5, -11, -2, -17, 6, -21]
    for (let i = 0; i < spots.length; i += 2) {
      const y = JB + (spots[i + 1] ?? 0)
      if (y > level + 2) bubbles += speck(JX + (spots[i] ?? 0), y)
    }
    honey =
      `<g clip-path="url(#${uid}-jar)">` +
      `<rect x="${JX - 14}" y="${n(level)}" width="28" height="${n(depth + 2)}" fill="url(#${uid}-honeyfill)" opacity="0.94"/>` +
      `<g clip-path="url(#${uid}-honey)"><ellipse cx="${JX - 2.5}" cy="${n(level + depth * 0.42)}" rx="9.5" ry="${n(Math.max(3, depth * 0.5))}" fill="url(#${uid}-honeyglow)">${loop('opacity', '0.65;1;0.65', 7, 2)}</ellipse></g>` +
      (bubbles ? `<path d="${bubbles}" stroke="#fff3cc" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/>` : '') +
      `<ellipse cx="${JX}" cy="${n(level)}" rx="${level < JB - 25 ? 7.8 : 11.6}" ry="1.3" fill="#ffe6a8" opacity="0.85"/>` +
      '</g>'
  }
  const glass =
    `<path d="${outer}" fill="none" stroke="#f7ead8" stroke-width="0.7" opacity="0.45"/>` +
    `<path d="M${p(-10.4, -20)}L${p(-10.4, -5)}" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>` +
    `<path d="M${p(-13, -4)}L${p(-13, -21)}Q${p(-13, -25.5)} ${p(-9, -26.5)}" stroke="${accent}" stroke-width="0.9" fill="none" opacity="0.75"/>` +
    `<path d="M${p(10.6, -19)}L${p(10.6, -8)}" stroke="#ffffff" stroke-width="0.6" opacity="0.25"/>` +
    `<rect x="${JX - 10.5}" y="${n(JB - 31.6)}" width="21" height="3" rx="1.4" fill="#f2e2c8" opacity="0.3" stroke="#f7ead8" stroke-width="0.5"/>` +
    `<path d="M${p(-9, -27.4)}Q${p(0, -26.2)} ${p(9, -27.4)}M${p(-5, -27)}q-3.4 -2.6 -3.6 0.2q1.8 1.2 3.6 -0.2q-0.6 2.8 -1.6 4.2" stroke="#b07a46" stroke-width="0.8" fill="none"/>`
  const glint = measured
    ? `<path d="M${p(-7.5, -26.6)}l0.7 2.9l2.9 0.7l-2.9 0.7l-0.7 2.9l-0.7 -2.9l-2.9 -0.7l2.9 -0.7Z" fill="#fffbe8">${loop('opacity', '0.3;1;0.3', 4.6, 1)}</path>`
    : ''
  const caustic = measured && f > 0.004 ? `<ellipse cx="${JX + 1}" cy="${CAP_FACE}" rx="${n(10 + 6 * f)}" ry="1.5" fill="${accent}" opacity="${n(0.2 + 0.5 * f)}"/>` : ''
  const back = `<path d="${outer}" fill="#fff0d6" opacity="0.12"/>`
  const jar = halo + back + dipper + honey + glass + glint + caustic
  return { defs, body: measured ? jar : `<g opacity="0.55">${jar}</g>` }
}

/** A geranium in its terracotta pot on the rail, swaying a little. */
function geranium(r: () => number, x: number, base: number, accent: string): string {
  const p = (dx: number, dy: number): string => `${n(x + dx)} ${n(base + dy)}`
  const pot =
    `<path d="M${p(-8, -13)}L${p(8, -13)}L${p(6.2, 0)}L${p(-6.2, 0)}Z" fill="#a8583f"/>` +
    `<rect x="${n(x - 9)}" y="${n(base - 15.5)}" width="18" height="3.6" rx="0.8" fill="#c26c50"/>` +
    `<path d="M${p(8, -12)}L${p(6.2, 0)}M${p(9, -15.3)}L${p(9, -12.2)}M${p(-9, -15.5)}L${p(9, -15.5)}" stroke="${accent}" stroke-width="0.7" opacity="0.65" fill="none"/>`
  let darkLeaves = ''
  let leaves = ''
  for (const [dx, dy, rad] of [
    [-6, -18, 4.6],
    [5, -19, 5],
    [0, -22, 5],
    [-9.5, -22, 3.6],
    [9.5, -24, 3.6],
    [-3, -26, 3.4],
    [4, -27.5, 3],
  ] as const) {
    darkLeaves += dot(x + dx, base + dy, rad)
    leaves += dot(x + dx + 0.8, base + dy - 0.8, rad * 0.62)
  }
  const stems = `M${p(-3, -24)}Q${p(-5, -29)} ${p(-5, -33)}M${p(2, -25)}Q${p(3, -31)} ${p(4, -36)}M${p(7, -24)}Q${p(10, -27)} ${p(11, -30)}M${p(-7, -22)}Q${p(-10, -25)} ${p(-11, -29)}`
  let blooms = ''
  let lit = ''
  // four flower heads (x, y pairs), each a ring of petals round a centre, a lit petal on the sun's side
  const heads = [-5, -33, 4, -36, 11, -30, -11, -29]
  for (let i = 0; i < heads.length; i += 2) {
    const dx = heads[i] ?? 0
    const dy = heads[i + 1] ?? 0
    blooms += speck(x + dx, base + dy)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + between(r, -0.3, 0.3)
      blooms += speck(x + dx + 2.4 * Math.cos(a), base + dy + 2 * Math.sin(a))
    }
    lit += speck(x + dx + 1.6, base + dy - 1.4)
  }
  return (
    pot +
    `<g><path d="${stems}" stroke="#4a5a2a" stroke-width="0.8" fill="none"/>` +
    `<path d="${darkLeaves}" fill="#3a4824"/><path d="${leaves}" fill="#5c6c32"/>` +
    `<g stroke-linecap="round"><path d="${blooms}" stroke="#de5446" stroke-width="3.3"/><path d="${lit}" stroke="#ffa07e" stroke-width="2.2"/></g>` +
    `${sway(x, base - 15, 2, 7, 3)}</g>`
  )
}

/** A watering can on the boards by the left post, lit along its sunward edges. */
function wateringCan(x: number, base: number, accent: string): string {
  const p = (dx: number, dy: number): string => `${n(x + dx)} ${n(base + dy)}`
  return (
    `<ellipse cx="${n(x + 3)}" cy="${n(base + 1)}" rx="17" ry="2.2" fill="#0e0906" opacity="0.5"/>` +
    `<path d="M${p(-9, -6)}L${p(-25, -21)}L${p(-23.4, -22.6)}L${p(-8, -11)}Z" fill="#46504a"/>` +
    `<path d="M${p(-27.6, -19.6)}L${p(-22, -25.4)}L${p(-20.6, -23.4)}L${p(-26, -18)}Z" fill="#59645b"/>` +
    `<path d="M${p(-10, 0)}L${p(-10, -17)}Q${p(0, -19.5)} ${p(10, -17)}L${p(10, 0)}Z" fill="#4c5750"/>` +
    `<path d="M${p(-10, -13)}H${n(x + 10)}M${p(-10, -3)}H${n(x + 10)}" stroke="#343d37" stroke-width="0.9"/>` +
    `<path d="M${p(-6, -18)}Q${p(2, -29)} ${p(10, -16)}" stroke="#39433d" stroke-width="1.8" fill="none"/>` +
    `<path d="M${p(10, -17)}L${p(10, -1)}M${p(-6, -18.8)}Q${p(2, -29.8)} ${p(10.6, -16.8)}M${p(-23.4, -22.6)}L${p(-8, -11)}" stroke="${accent}" stroke-width="0.6" opacity="0.6" fill="none"/>`
  )
}

/**
 * The rocking chair in profile, facing the sun, its far side a step behind: curved rockers, a reclined spindle back, a
 * sage cushion on the seat and a plaid blanket folded over the back. It rocks gently about where its rockers meet the boards.
 */
function rockingChair(uid: string, accent: string): { defs: string; body: string } {
  const rocker = 'M-44 -9Q-4 8 40 -9'
  const back = 'M12 -40L24 -118'
  const arm = 'M17 -66Q-8 -68.5 -33 -64.5q-3 0.6 -2.4 3.4'
  let spindles = ''
  for (const t of [0.33, 0.66]) spindles += `M${n(12 - 8 * t)} ${n(-40 - 3 * t)}L${n(24 - 8 * t)} ${n(-118 - 3 * t)}`
  const drape = 'M18 -118Q25 -127 31.5 -118Q34.5 -100 32.5 -80Q32 -68 33 -56Q29 -60 25.5 -58Q22 -62 18.5 -61Q16.6 -70 14.6 -76Q12 -82 12.4 -90Q12.6 -104 18 -118Z'
  const defs = `<clipPath id="${uid}-blanket"><path d="${drape}"/></clipPath>`
  const blanket =
    `<path d="${drape}" fill="#b8644e"/>` +
    `<g clip-path="url(#${uid}-blanket)">` +
    `<path d="M8 -107L38 -104M8 -96L38 -93M8 -85L38 -82M8 -74L38 -71M8 -64L38 -61" stroke="#efd6ae" stroke-width="1.5" opacity="0.55"/>` +
    `<path d="M18 -126L15 -52M26 -126L23 -52" stroke="#7c3a30" stroke-width="2.2" opacity="0.45"/>` +
    `<path d="M26 -118Q30 -100 28 -84Q28 -70 29 -54L40 -54L40 -128Z" fill="#1e1410" opacity="0.28"/>` +
    `<path d="M18.6 -112Q24 -117 29.6 -112M21 -104Q24 -86 22 -64" stroke="#6a3028" stroke-width="0.9" fill="none" opacity="0.6"/></g>` +
    `<path d="M14.6 -76Q12 -82 12.4 -90Q12.6 -104 18 -118Q25 -127 31.5 -118" stroke="#ffbe90" stroke-width="0.8" fill="none" opacity="0.85"/>` +
    `<path d="M32.6 -57.4l0.6 2.6M29 -59.6l0.2 2.8M25.5 -58.6l0 2.8M22 -61.4l-0.2 2.6M18.6 -61.6l-0.4 2.6" stroke="#dcb88e" stroke-width="0.6"/>`
  const body =
    `<ellipse cx="${CX + 2}" cy="${CY + 1}" rx="46" ry="3.6" fill="#0e0906" opacity="0.5"/>` +
    `<g transform="translate(${CX} ${CY})"><g>` +
    `<g transform="translate(-8 -3)" stroke="${WOOD.far}" fill="none" stroke-linecap="round"><path d="${rocker}" stroke-width="3"/><path d="${back}M14 -1L12 -40" stroke-width="3"/><path d="${arm}" stroke-width="2.6"/></g>` +
    `<path d="${spindles}" stroke="#33221a" stroke-width="1.4"/>` +
    `<g stroke="${WOOD.chair}" fill="none" stroke-linecap="round"><path d="${rocker}" stroke-width="3.4"/><path d="M-25 -2L-24 -40M14 -1L12 -40" stroke-width="2.8"/>` +
    `<path d="M-25 -40Q-29 -52 -28 -64" stroke-width="2.4"/><path d="${back}" stroke-width="3.4"/><path d="${arm}" stroke-width="3"/></g>` +
    `<path d="M-31 -42L17 -40L17 -36L-31 -38Z" fill="${WOOD.chair}"/>` +
    `<path d="M-29 -42Q-29 -48 -22 -48L10 -46.4Q15.6 -46 15.6 -41.6Z" fill="#6e7656"/>` +
    `<path d="M-29 -42.6Q-29 -48 -22 -48L10 -46.4M-44 -10.8Q-4 6.2 40 -10.8M-33 -66.2Q-8 -70.2 17 -67.8M10.4 -40.4L18 -88" stroke="${accent}" stroke-width="0.6" opacity="0.7" fill="none"/>` +
    blanket +
    `${sway(0, 0, 2.2, 5.6, 1)}</g></g>`
  return { defs, body }
}

/** Wind chimes hung from a bracket on the right post: a wooden disc, five brass tubes, a sail; they sway and the tubes stir. */
function chimes(accent: string): string {
  const hx = 303
  const hy = 92
  const post = 328 - POST_HALF
  let metal = ''
  let shine = ''
  let cords = ''
  // five tubes, 3 apart, longest in the middle
  for (const [i, len] of [21, 26, 30, 25, 19].entries()) {
    const dx = (i - 2) * 3
    metal += `M${n(hx + dx - 0.8)} ${hy + 11}h1.6v${len}h-1.6Z`
    shine += `M${n(hx + dx - 0.4)} ${n(hy + 11.6)}v${n(len - 1.2)}`
    cords += `M${n(hx + dx * 0.7)} ${hy + 7}L${n(hx + dx)} ${hy + 11}`
  }
  return (
    `<path d="M${post} ${hy - 4}H${hx - 1}M${post} ${hy + 4}L${post - 8} ${hy - 4}M${hx + 2} ${hy - 4}q-3 0 -3 3" stroke="${WOOD.deep}" stroke-width="1.3" fill="none"/>` +
    `<g><path d="M${hx} ${hy - 1}V${hy + 6}${cords}M${hx} ${hy + 7}V${hy + 40}" stroke="#d9c4a0" stroke-width="0.35" opacity="0.7" fill="none"/>` +
    `<ellipse cx="${hx}" cy="${hy + 7}" rx="7.4" ry="1.9" fill="#4a3222"/>` +
    `<path d="M${hx - 7} ${n(hy + 6.4)}Q${hx} ${hy + 4} ${hx + 7} ${n(hy + 6.4)}" stroke="${accent}" stroke-width="0.6" opacity="0.7" fill="none"/>` +
    `<g><path d="${metal}" fill="#c8964e"/><path d="${shine}" stroke="#ffe6a8" stroke-width="0.5" opacity="0.85"/>${sway(hx, hy + 7, 2.2, 3.4, 1)}</g>` +
    `<circle cx="${hx}" cy="${hy + 25}" r="2.2" fill="#5a3d2a"/>` +
    `<path d="M${hx} ${hy + 39}q-3.6 3.4 -1.2 9.4q0.6 1 1.2 2.4q0.6 -1.4 1.2 -2.4q2.4 -6 -1.2 -9.4Z" fill="#a85a44"/>` +
    `<path d="M${hx} ${hy + 39}q-3.6 3.4 -1.2 9.4" stroke="${accent}" stroke-width="0.5" opacity="0.6" fill="none"/>` +
    `${sway(hx, hy - 1, 3.5, 6.8, 2)}</g>`
  )
}

/** The swallow, drawn once: swept wings (flapped by scaling) and a body with its forked tail. */
const swallowDefs = (uid: string): string =>
  `<path id="${uid}-wings" d="M0 0Q-4 -4.6 -12.5 -2.6Q-6.4 -1.6 -1.1 1.7ZM0 0Q4 -4.6 12.5 -2.6Q6.4 -1.6 1.1 1.7Z" fill="${BIRD}"/>` +
  `<path id="${uid}-bird" d="M0 -2.4Q1.3 -0.8 0.9 2L2.8 7.6L0.3 4.4H-0.3L-2.8 7.6L-0.9 2Q-1.3 -0.8 0 -2.4Z" fill="${BIRD}"/>`

/** The swallows, one per active subagent, each sweeping its own loop or figure of eight; two quick wingbeats, then a glide. */
function swallows(uid: string, sceneId: string, swarm: number): string {
  const area: Area = { x0: 40, y0: 106, x1: 300, y1: 166 }
  return swarmSpots(sceneId, area, swarm)
    .map((spot, i) => {
      const k = spot.k
      const dir = i % 2 === 0 ? 1 : -1
      const rx = 16 + 22 * k
      const ry = 5 + 5 * ((k * 7.1) % 1)
      const eight = i % 3 === 1
      const points: string[] = []
      for (let j = 0; j <= 10; j++) {
        const a = (j / 10) * Math.PI * 2
        const y = eight ? (ry * Math.sin(2 * a)) / 1.6 : -ry * 0.6 * (1 - Math.cos(a))
        points.push(`${n(dir * rx * Math.sin(a))} ${n(y)}`)
      }
      const dur = 14 + 10 * ((k * 3.3) % 1)
      const flap = 2.6 + 1.4 * ((k * 4.3) % 1)
      return (
        `<g transform="translate(${n(spot.x)} ${n(spot.y)}) scale(${n(0.5 + 0.22 * ((k * 5.7) % 1))})"><g>` +
        `<use href="#${uid}-wings"><animateTransform attributeName="transform" type="scale" values="1 1;1 -0.55;1 1;1 -0.55;1 1;1 1" keyTimes="0;0.07;0.14;0.21;0.28;1" dur="${n(flap)}s" begin="${n(-k * flap)}s" repeatCount="indefinite"/></use>` +
        `<use href="#${uid}-bird"/>${drift(points.join(';'), dur, k * dur)}</g></g>`
      )
    })
    .join('')
}

/** The gradients of the sky and the land. */
function landDefs(uid: string, accent: string): string {
  return (
    radialBox(`${uid}-skyglow`, [
      [0, '#ffdca0', 0.8],
      [0.3, '#f7b07a', 0.42],
      [0.65, '#d98a7a', 0.14],
      [1, '#d98a7a', 0],
    ]) +
    `<radialGradient id="${uid}-rays" gradientUnits="userSpaceOnUse" cx="${SX}" cy="${SY}" r="132">` +
    `<stop offset="0" stop-color="#fff3d0" stop-opacity="0.5"/><stop offset="0.3" stop-color="${accent}" stop-opacity="0.24"/>` +
    `<stop offset="0.7" stop-color="${accent}" stop-opacity="0.07"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>` +
    radialBox(`${uid}-corona`, [
      [0, '#fff6dc', 0.95],
      [0.3, '#ffe1a0', 0.6],
      [0.6, accent, 0.18],
      [1, accent, 0],
    ]) +
    radialBox(`${uid}-sun`, [
      [0, '#fffcf2'],
      [0.55, '#ffebb6'],
      [0.9, '#ffd283'],
      [1, accent],
    ]) +
    radialBox(`${uid}-bleed`, [
      [0, '#ffe4a8', 0.85],
      [0.5, '#ffc98a', 0.32],
      [1, '#ffc98a', 0],
    ]) +
    linearY(`${uid}-far`, 184, 214, [
      [0, '#9a6878'],
      [0.6, '#bf8486'],
      [1, '#e2a88c'],
    ]) +
    linearY(`${uid}-ridge`, 198, 220, [
      [0, '#a8707a'],
      [0.5, '#cc9080'],
      [1, '#ebb27a'],
    ]) +
    linearY(`${uid}-field`, 208, 244, [
      [0, '#f3c070'],
      [0.3, '#dc9c50'],
      [0.65, '#ac6c38'],
      [1, '#6a4228'],
    ]) +
    linearY(`${uid}-path`, 216, 262, [
      [0, '#e6b07a'],
      [0.35, '#a8704a'],
      [1, '#4a3020'],
    ]) +
    linearY(`${uid}-near`, 230, 300, [
      [0, '#7d5232'],
      [0.25, '#553620'],
      [0.6, '#33221a'],
      [1, '#22170f'],
    ])
  )
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const accent = palette.accent
  const jar = honeyJar(uid, context, accent)
  const chair = rockingChair(uid, accent)
  const defs = landDefs(uid, accent) + cloudDefs(uid) + swallowDefs(uid) + porchDefs(uid, accent) + jar.defs + chair.defs

  // Each layer takes its randomness in a fixed order, so a change to one leaves the others' shapes alone.
  const sky = upperSky(uid, r) + sunLayer(uid, r) + cloudLayer(uid)
  const far = farLand(uid, r, accent)
  const mid = band(fieldY, 22, `url(#${uid}-field)`) + patchwork(r) + farmSides(r, accent) + barn(66, 219, accent) + loneTree(214, 216, accent) + dirtPath(uid)
  const near = nearField(uid) + wheatLayer(r)
  const pollen =
    motes(r, { x0: 10, y0: 196, x1: 330, y1: 260 }, 6, POLLEN, 22) +
    motes(r, { x0: -280, y0: 200, x1: -40, y1: 250 }, 1, POLLEN, 22) +
    motes(r, { x0: 380, y0: 200, x1: 600, y1: 250 }, 1, POLLEN, 22)
  const birds = swallows(uid, scene.id, swarm)
  const props = geranium(r, 50, CAP + 1.5, accent) + wateringCan(84, 312, accent) + chimes(accent)
  const caption = gaugeCaption({ x: JX - 18, y: JB - 20, name: scene.gauge, value: contextText, palette, anchor: 'end' })

  return {
    defs,
    body: sky + far + mid + near + pollen + birds + porch(uid, accent) + jar.body + props + chair.body + caption,
  }
}
