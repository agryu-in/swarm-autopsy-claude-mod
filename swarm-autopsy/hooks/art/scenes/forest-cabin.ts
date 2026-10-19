// Rainy Forest Cabin: a small log cabin in a clearing among tall pines on a misty, rainy evening. The
// pines stand in layers, far ones blue-green and soft in the mist, near ones nearly black; fog drifts
// between the layers and a soft rain falls through everything. The cabin has a mossy shingle roof, a
// stone chimney with smoke curling up, a dim loft window, two warm windows whose light spills onto the wet
// ground and shivers in the puddles, a little porch with a lantern swaying by the door, a pair of boots
// and a woodpile; ferns, mushrooms and stepping stones in front. On wide panes the clearing goes on: the
// stepping-stone path leading off into the trees past a fallen log, a creek, and one far light.
// The rain barrel under the gutter's downspout is the main context gauge: its water rises from empty to
// the brim as the context window fills, a drip falling from the spout and rippling the surface. Each
// active subagent is a firefly glowing under the eaves and over the ferns.

import type { Area } from '../kit.ts'
import type { Painted, PaintArgs } from '../scene.ts'
import {
  BLEED, SCENE_W, between, blur, drift, flicker, fog, fogDefs, gaugeCaption, linearBox, linearX, linearY, loop, n, radialBox, rainfall, ripples, sway,
  swarmSpots,
} from '../kit.ts'

type Palette = PaintArgs['palette']
type Rand = () => number
type Pt = readonly [number, number]

const L = -BLEED
const R = SCENE_W + BLEED

/** A number at one decimal: the forest, the ferns and the rain are drawn in many small steps. */
const d1 = (value: number): string => String(Math.round(value * 10) / 10)

/** The cabin's front wall (its long side faces us); its gable end recedes to the right by DEPTH. */
const WALL = { x0: 141, x1: 241, top: 210, foot: 266 }
const DEPTH: Pt = [28, -13]
const SKEW = DEPTH[1] / DEPTH[0]
const RISE = 42
const PEAK: Pt = [WALL.x1 + DEPTH[0] / 2, WALL.top + DEPTH[1] / 2 - RISE]
const EAVE = 217
const RIDGE = 158
/** The roof's front slope runs parallel to the gable's front rake, a little past it. */
const RAKE = (PEAK[0] - WALL.x1) / (WALL.top - PEAK[1])
const roofRight = (y: number): number => WALL.x1 + (WALL.top - y) * RAKE + 5
const roofLeft = (y: number): number => roofRight(y) - 112
const WINDOWS = [{ x: 149, y: 224, w: 19, h: 18 }, { x: 215, y: 224, w: 19, h: 18 }] as const
const DOOR = { x: 183, y: 236, w: 16, h: 30 }
const LANTERN: Pt = [177, 234]
/** The rain barrel at the cabin's left corner, under the downspout's mouth. */
const BARREL = { x: 125.5, top: 238, bottom: 270, half: 11, belly: 13.5 }
const SPOUT: Pt = [125.5, 235]
/** The stone chimney rising through the roof's right side: its face to us from x0 to x1, its side `side` deep. */
const CHIMNEY = { x0: 210, x1: 223, top: 124, foot: 188, side: 5.5 }
/** Puddles in front of the windows (each holds one window's light), and the fireflies' air. */
const PUDDLES = [{ x: 158, y: 295, rx: 16, ry: 3.4, win: 0 }, { x: 226, y: 290, rx: 20, ry: 4, win: 1 }] as const
const SWARM_AREA: Area = { x0: 40, y0: 196, x1: 312, y1: 292 }
/** Rain falls through this band; a mask fades it in under the title and out into the ground. */
const RAIN_TOP = 70
const RAIN_FALL = 250
const SLANT = -0.08

/** The scene's own tones: the forest far to near, the cabin's wood, roof, moss and stone, and the small lights. */
const TONE = {
  far: '#33463f', midFar: '#28372f', mid: '#1c2823', near: '#121a16', fog: '#71857a', rain: '#c3d4c9', fern: '#22342a', fernBack: '#18251e',
  logLit: '#6a4e37', logGap: '#1a120c', logEnd: '#5f4733', ring: '#36281c', gable: '#2a1f17', frame: '#24180f',
  roofEdge: '#1a201c', roofLit: '#56655a', moss: '#4c6a49', mossLit: '#80a171',
  stone: '#4a5049', stoneDark: '#383d37', mortar: '#202520', metal: '#3a413b', metalLit: '#7d887e', firefly: '#fbffd4',
}

function defsFor(uid: string, palette: Palette): string {
  return (
    radialBox(`${uid}-skyglow`, [[0, '#7d9186', 0.55], [0.5, '#6d8176', 0.22], [1, '#6d8176', 0]]) +
    linearY(`${uid}-clearing`, 236, 330, [[0, '#2b382f'], [0.35, '#1d2620'], [1, '#111713']]) +
    linearY(`${uid}-roof`, RIDGE, EAVE, [[0, '#3c4840'], [0.25, '#2f3933'], [1, '#232a25']]) +
    linearY(`${uid}-wall`, WALL.top, WALL.foot, [[0, '#22190f'], [0.2, '#38291e'], [1, '#463326']]) +
    radialBox(`${uid}-pane`, [[0, '#fff4d2'], [0.5, '#ffcb6e'], [1, '#e8913c']]) +
    radialBox(`${uid}-wglow`, [[0, palette.accent, 0.55], [0.45, palette.accent, 0.18], [1, palette.accent, 0]]) +
    radialBox(`${uid}-spill`, [[0, palette.accent, 0.42], [0.5, palette.accent, 0.12], [1, palette.accent, 0]]) +
    radialBox(`${uid}-lamp`, [[0, '#fff0c4', 0.95], [0.18, palette.accent, 0.6], [0.5, palette.accent, 0.16], [1, palette.accent, 0]]) +
    linearX(`${uid}-wood`, BARREL.x - BARREL.belly, BARREL.x + BARREL.belly, [[0, '#22180f'], [0.45, '#473425'], [0.82, '#5d4431'], [1, '#2c2016']]) +
    linearBox(`${uid}-water`, [[0, '#b4e2cb'], [0.18, '#76b399'], [1, '#2b5446']]) +
    radialBox(`${uid}-firefly`, [[0, '#f6ffb8', 0.95], [0.2, '#dcf27c', 0.62], [0.5, '#c4e46a', 0.2], [1, '#c4e46a', 0]]) +
    linearY(`${uid}-creek`, 244, 340, [[0, '#62776c'], [0.35, '#3a4a43'], [1, '#1a2420']]) +
    linearY(`${uid}-rainfade`, RAIN_TOP, RAIN_TOP + RAIN_FALL, [[0, '#ffffff', 0], [0.14, '#ffffff', 1], [0.8, '#ffffff', 1], [1, '#ffffff', 0]]) +
    `<mask id="${uid}-rainmask" maskUnits="userSpaceOnUse" x="${L}" y="0" width="${R - L}" height="400">` +
    `<rect x="${L}" y="0" width="${R - L}" height="400" fill="url(#${uid}-rainfade)"/></mask>` +
    PUDDLES.map((p, i) => `<clipPath id="${uid}-pud${i}"><ellipse cx="${p.x}" cy="${p.y}" rx="${p.rx}" ry="${p.ry}"/></clipPath>`).join('') +
    radialBox(`${uid}-litfade`, [[0, '#ffffff', 1], [0.55, '#ffffff', 0.55], [1, '#ffffff', 0]]) +
    `<mask id="${uid}-litmask" maskUnits="userSpaceOnUse" x="120" y="200" width="150" height="110"><ellipse cx="192" cy="258" rx="66" ry="40" fill="url(#${uid}-litfade)"/></mask>` +
    blur(`${uid}-smoke`, 2.6) +
    blur(`${uid}-soft`, 1.3) +
    fogDefs(uid)
  )
}

// ── The forest ──────────────────────────────────────────────────────────────────────────────

/**
 * A pine, 100 tall, standing at (0, 0): tiers of drooping branches, each flaring out from a notch to its
 * tip and tucking back under, then a short trunk. Unfilled, so each row of copies takes its own colour.
 */
function pineShape(r: Rand, tiers: number, half: number, droop: number): string {
  const top = -100
  const step = (top + 6) / -tiers
  const side = (dir: number): { tips: Pt[]; notches: Pt[]; ctrls: Pt[] } => {
    const tips: Pt[] = []
    const notches: Pt[] = [[0, top]]
    const ctrls: Pt[] = []
    for (let k = 1; k <= tiers; k++) {
      const y = top + step * k
      const w = half * (0.14 + (0.86 * k) / tiers) * between(r, 0.84, 1.14)
      const tip: Pt = [dir * w, y + step * droop * between(r, 0.6, 1.2)]
      const prev = notches[k - 1] ?? [0, top]
      ctrls.push([prev[0] + (tip[0] - prev[0]) * 0.5, prev[1] + (tip[1] - prev[1]) * 0.12])
      tips.push(tip)
      notches.push([dir * w * between(r, 0.3, 0.46), y + step * 0.08])
    }
    return { tips, notches, ctrls }
  }
  const right = side(1)
  const left = side(-1)
  const pt = (p: Pt | undefined): string => (p ? `${d1(p[0])} ${d1(p[1])}` : '0 0')
  let d = `M0 ${top}`
  for (let i = 0; i < tiers; i++) {
    d += `Q${pt(right.ctrls[i])} ${pt(right.tips[i])}`
    if (i < tiers - 1) d += `L${pt(right.notches[i + 1])}`
  }
  const trunk = d1(half * 0.07 + 0.7)
  const under = d1((right.tips[tiers - 1]?.[1] ?? 0) - step * 0.2)
  d += `L${trunk} ${under}V0H-${trunk}V${under}L${pt(left.tips[tiers - 1])}`
  for (let i = tiers - 1; i >= 0; i--) {
    d += `Q${pt(left.ctrls[i])} ${pt(left.notches[i])}`
    if (i > 0) d += `L${pt(left.tips[i - 1])}`
  }
  return `${d}Z`
}

const PINE_KINDS = 5

function pineTemplates(r: Rand, uid: string): string {
  const kinds: readonly (readonly [number, number, number])[] = [[7, 20, 0.28], [7, 17, 0.36], [6, 23, 0.22], [8, 16, 0.3], [6, 19, 0.42]]
  return (
    kinds.map(([tiers, half, droop], i) => `<path id="${uid}-p${i}" d="${pineShape(r, tiers, half, droop)}"/>`).join('') +
    `<path id="${uid}-pb" d="${pineShape(r, 10, 24, 0.5)}"/>`
  )
}

/** A row of pines from x0 to x1 standing near `base`, copies of the templates, sized by `height(x)`. */
function pineRow(
  r: Rand,
  uid: string,
  args: { x0: number; x1: number; gap: Pt; base: number; height: (x: number) => number; fill: string; skip?: readonly Pt[] },
): string {
  let out = ''
  for (let x = args.x0; x < args.x1; x += between(r, args.gap[0], args.gap[1])) {
    const kind = Math.floor(between(r, 0, PINE_KINDS))
    const h = args.height(x) * between(r, 0.8, 1.15)
    const wide = between(r, 0.85, 1.2)
    const flip = r() < 0.5 ? -1 : 1
    const base = args.base + between(r, -3, 3)
    if (args.skip?.some(([a, b]) => x > a && x < b)) continue
    out += `<use href="#${uid}-p${kind}" transform="matrix(${n((flip * h * wide) / 100)} 0 0 ${n(h / 100)} ${d1(x)} ${d1(base)})"/>`
  }
  return `<g fill="${args.fill}">${out}</g>`
}

/** The farthest pines: a misty band of simple spires, as one path in whole units. */
function farSpires(r: Rand, base: number): string {
  const i = Math.round
  let d = `M${L} ${base + 40}V${base - 3}H${R}V${base + 40}Z`
  for (let x = L; x < R; x += between(r, 10, 16)) {
    const h = between(r, 20, 48) * (Math.abs(x - 200) < 110 ? 0.82 : 1)
    const w = h * between(r, 0.2, 0.27)
    const b = base + between(r, -2, 3)
    const wing = r() < 0.6 ? `l${i(w * 0.6)} ${i(-h * 0.5)}h${i(-w * 0.2)}l${i(w * 0.6)} ${i(-h * 0.5)}l${i(w * 0.6)} ${i(h * 0.5)}h${i(-w * 0.2)}` : `l${i(w)} ${i(-h)}`
    d += `M${i(x - w)} ${i(b)}${wing}L${i(x + w)} ${i(b)}Z`
  }
  return `<path d="${d}" fill="${TONE.far}"/>`
}

/** Big near pines framing the clearing, standing in front of everything. */
function nearPines(uid: string): string {
  const spots: readonly (readonly [number, number, number])[] = [[-236, 378, 440], [588, 380, 450], [-30, 392, 300], [376, 392, 290]]
  return (
    `<g fill="${TONE.near}">` +
    spots.map(([x, y, h], i) => `<use href="#${uid}-pb" transform="matrix(${n(((i % 2 ? -1 : 1) * h * 0.56) / 100)} 0 0 ${n(h / 100)} ${x} ${y})"/>`).join('') +
    '</g>'
  )
}

// ── The rain ────────────────────────────────────────────────────────────────────────────────

/** A sheet of rain one canvas wide, each streak drawn twice one fall apart, so it slides down and loops on one animation. */
function rainSheet(r: Rand, id: string, args: { count: number; len: Pt; width: number; opacity: number; dur: number }): string {
  let d = ''
  for (let i = 0; i < args.count; i++) {
    const x = between(r, -12, SCENE_W + 12)
    const y = between(r, RAIN_TOP, RAIN_TOP + RAIN_FALL)
    const len = Math.round(between(r, args.len[0], args.len[1]))
    const dx = d1(SLANT * len)
    d += `M${d1(x)} ${d1(y)}l${dx} ${len}m${d1(-SLANT * (RAIN_FALL + len))} ${-RAIN_FALL - len}l${dx} ${len}`
  }
  return (
    `<path id="${id}" d="${d}" stroke="${TONE.rain}" stroke-width="${n(args.width)}" stroke-linecap="round" opacity="${n(args.opacity)}">` +
    drift(`0 0;${d1(SLANT * RAIN_FALL)} ${RAIN_FALL}`, args.dur, between(r, 0, args.dur)) +
    '</path>'
  )
}

/** Rain catching the windows' light: warm streaks falling through the light in front of the cabin, faded at the edges by a mask. */
function litRain(r: Rand, uid: string): string {
  const top = 214
  const fall = 76
  let d = ''
  for (let i = 0; i < 14; i++) {
    const len = Math.round(between(r, 5, 9))
    d += `M${d1(between(r, 138, 248))} ${d1(between(r, top, top + fall))}l${d1(SLANT * len)} ${len}m${d1(-SLANT * (fall + len))} ${-fall - len}l${d1(SLANT * len)} ${len}`
  }
  return (
    `<g mask="url(#${uid}-litmask)"><path d="${d}" stroke="#ffd793" stroke-width="0.7" stroke-linecap="round" opacity="0.7">` +
    drift(`0 0;${d1(SLANT * fall)} ${fall}`, 1.25, between(r, 0, 1.25)) +
    '</path></g>'
  )
}

/** Rain sheets laid across the whole width (the drawn one and a copy either side), faded in and out by the mask. */
function rain(uid: string, sheets: readonly string[], ids: readonly string[]): string {
  const copies = ids.map(id => `<use href="#${id}" x="${-SCENE_W}"/><use href="#${id}" x="${SCENE_W}"/>`).join('')
  return `<g mask="url(#${uid}-rainmask)">${sheets.join('')}${copies}</g>`
}

// ── The cabin ───────────────────────────────────────────────────────────────────────────────

/** A skewed group: drawing in it at (x, v) lands at (x, v + SKEW·(x − x0)), on the gable's receding plane. */
const onGable = (x0: number, inner: string): string => `<g transform="matrix(1 ${n(SKEW)} 0 1 0 ${n(-SKEW * x0)})">${inner}</g>`

/** Horizontal log courses from x0 to x1: dark gaps, and a lit top edge on each log. */
function logCourses(x0: number, x1: number, gapColor: string, litColor: string, litOpacity: number): string {
  let gaps = ''
  let lit = ''
  for (let y = WALL.top + 7; y < WALL.foot; y += 7) {
    gaps += `M${x0} ${y}H${x1}`
    lit += `M${x0} ${y + 1.3}H${x1}`
  }
  return `<path d="${gaps}" stroke="${gapColor}" stroke-width="1.3"/><path d="${lit}" stroke="${litColor}" stroke-width="0.7" opacity="${n(litOpacity)}"/>`
}

/** The gable end: logs below the wall top, upright boards in the triangle and a dim loft window, on the receding plane. */
function gableEnd(palette: Palette): string {
  const { x1, top, foot } = WALL
  const [dx] = DEPTH
  let boards = ''
  for (let u = 4; u < dx; u += 4) boards += `M${x1 + u} ${top}V${d1(top + 1 - RISE * (1 - Math.abs(u - dx / 2) / (dx / 2)))}`
  return onGable(
    x1,
    `<path d="M${x1} ${foot}V${top}L${x1 + dx / 2} ${top - RISE}L${x1 + dx} ${top}V${foot}Z" fill="${TONE.gable}"/>` +
      logCourses(x1, x1 + dx, '#130d08', '#4a3727', 0.45) +
      `<path d="${boards}" stroke="#160f0a" stroke-width="0.8"/>` +
      `<rect x="${x1 + 10.5}" y="${top - 19}" width="7" height="8" fill="${palette.accent}" opacity="0.45"/>` +
      `<path d="M${x1 + 10.5} ${top - 19}h7v8h-7ZM${x1 + 14} ${top - 19}v8" stroke="${TONE.frame}" stroke-width="1" fill="none"/>` +
      `<rect x="${x1}" y="${foot}" width="${dx}" height="6" fill="#262b26"/>`,
  )
}

/** A lumpy cushion of moss on the line y from x0, `w` wide: soft bumps on a raised base; and its lit rim. */
function mossCushion(x0: number, y: number, w: number, h: number, bumps: number): { body: string; rim: string } {
  const bw = w / bumps
  let top = ''
  for (let i = 0; i < bumps; i++) top += `q${d1(bw / 2)} ${d1(-h * (i % 3 === 1 ? 1.5 : 2.1))} ${d1(bw)} 0`
  return { body: `M${d1(x0)} ${d1(y)}l1 ${d1(-h * 0.5)}${top}l1 ${d1(h * 0.5)}Z`, rim: `M${d1(x0 + 1)} ${d1(y - h * 0.5 - 0.5)}${top}` }
}

/** The roof: the soffit edge of the back slope, the shingled front slope with moss, ridge cap, fascia and gutter. */
function roof(r: Rand, uid: string): string {
  const ridgeR = roofRight(RIDGE)
  const backEnd: Pt = [ridgeR + 16, RIDGE + 44]
  const soffit =
    `<path d="M${d1(ridgeR)} ${RIDGE}L${d1(backEnd[0])} ${backEnd[1]}L${d1(backEnd[0] - 2.6)} ${backEnd[1] + 2.4}L${WALL.x1 + DEPTH[0]} ${WALL.top + DEPTH[1]}L${d1(PEAK[0])} ${d1(PEAK[1])}Z" fill="#171c18"/>` +
    `<path d="M${d1(ridgeR)} ${RIDGE}L${d1(backEnd[0])} ${backEnd[1]}" stroke="${TONE.roofLit}" stroke-width="0.9" opacity="0.8"/>`
  const plane = `M${d1(roofLeft(EAVE))} ${EAVE}H${d1(roofRight(EAVE))}L${d1(ridgeR)} ${RIDGE}H${d1(roofLeft(RIDGE))}Z`
  // Shingle courses parallel to the eave; staggered joints from a dashed wide stroke; a wet sheen on each course.
  let courses = ''
  let sheen = ''
  let joints = ''
  let row = 0
  for (let y = RIDGE + 6.5; y < EAVE - 1; y += 6.5) {
    const x0 = roofLeft(y)
    const x1 = roofRight(y)
    courses += `M${d1(x0)} ${d1(y)}H${d1(x1)}`
    sheen += `M${d1(x0 + 1)} ${d1(y + 1)}H${d1(x1 - 1)}`
    joints += `M${d1(x0 + (row % 2 ? 4 : 0))} ${d1(y - 3.2)}H${d1(x1)}`
    row++
  }
  const cushions = [
    mossCushion(roofLeft(EAVE) + 5, EAVE - 0.5, 36, 3, 6),
    mossCushion(roofLeft(EAVE) + 17, EAVE - 20, 15, 2.2, 3),
    mossCushion(166, RIDGE - 0.5, 28, 2.6, 5),
    mossCushion(226, EAVE - 0.5, 16, 2.6, 3),
    mossCushion(236, RIDGE - 0.5, 12, 2, 2),
  ]
  const moss =
    `<path d="${cushions.map(c => c.body).join('')}" fill="${TONE.moss}"/>` +
    `<path d="${cushions.map(c => c.rim).join('')}" stroke="${TONE.mossLit}" stroke-width="0.8" fill="none" opacity="0.75"/>` +
    // moss hanging over the eave in soft scallops
    `<path d="M${d1(roofLeft(EAVE) + 6)} ${EAVE + 0.5}q4 4 8 0q4 3 8 0q4 4 9 0q3 2.6 7 0M226 ${EAVE + 0.5}q3 3 6 0q4 4 8 0" stroke="${TONE.moss}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
  const drips = Array.from({ length: 8 }, () => between(r, roofLeft(EAVE) + 4, roofRight(EAVE) - 4))
    .map(x => `M${d1(x)} ${EAVE + 4.4}v${d1(between(r, 0.8, 1.8))}`)
    .join('')
  return (
    soffit +
    `<path d="${plane}" fill="url(#${uid}-roof)"/>` +
    `<path d="${courses}" stroke="${TONE.roofEdge}" stroke-width="0.9"/>` +
    `<path d="${joints}" stroke="${TONE.roofEdge}" stroke-width="5.6" stroke-dasharray="0.8 7.2" opacity="0.55"/>` +
    `<path d="${sheen}" stroke="${TONE.roofLit}" stroke-width="0.6" opacity="0.45"/>` +
    `<path d="M${d1(roofLeft(RIDGE) - 1)} ${RIDGE}H${d1(ridgeR + 1)}" stroke="${TONE.roofEdge}" stroke-width="2.8"/>` +
    `<path d="M${d1(roofLeft(RIDGE))} ${RIDGE - 1.2}H${d1(ridgeR)}" stroke="#6b7a6e" stroke-width="0.7" opacity="0.8"/>` +
    `<path d="M${d1(roofLeft(EAVE))} ${EAVE}L${d1(roofLeft(RIDGE))} ${RIDGE}" stroke="#5c6b60" stroke-width="0.8" opacity="0.6"/>` +
    moss +
    `<rect x="${d1(roofLeft(EAVE) - 1)}" y="${EAVE}" width="${d1(roofRight(EAVE) - roofLeft(EAVE) + 2)}" height="2.6" fill="#1d1712"/>` +
    `<path d="M${d1(roofLeft(EAVE))} ${EAVE + 3.4}H${d1(roofRight(EAVE))}" stroke="${TONE.metal}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M${d1(roofLeft(EAVE))} ${EAVE + 2.7}H${d1(roofRight(EAVE))}" stroke="${TONE.metalLit}" stroke-width="0.5" opacity="0.6"/>` +
    `<path d="${drips}" stroke="${TONE.rain}" stroke-width="0.8" stroke-linecap="round" opacity="0.55"/>`
  )
}

/** The stone chimney rising through the roof: its face to us, its side receding (and meeting the roof higher up as it goes back). */
function chimney(r: Rand): string {
  const { x0, x1, top, foot, side } = CHIMNEY
  const climb = (side / DEPTH[0]) * (2 * RISE - DEPTH[1])
  const lean = side * SKEW
  let face = ''
  let sideRows = ''
  let row = 0
  for (let y = top + 5; y < foot - 1; y += 5) {
    face += `M${x0} ${y}H${x1}m${row % 2 ? -4.5 : -9} 0v-5`
    if (y < foot - climb) sideRows += `M${x1} ${y}l${side} ${d1(lean)}`
    row++
  }
  const foot2 = mossCushion(x0 - 4, foot + 1, 12, 2.2, 3)
  let lit = ''
  for (let i = 0; i < 6; i++) lit += `M${d1(x0 + between(r, 1, 6))} ${d1(between(r, top + 4, foot - 6))}h${d1(between(r, 2.4, 4.6))}`
  return (
    `<path d="M${x1} ${top}l${side} ${d1(lean)}V${d1(foot - climb)}L${x1} ${foot}Z" fill="${TONE.stoneDark}"/>` +
    `<path d="${sideRows}" stroke="${TONE.mortar}" stroke-width="0.7"/>` +
    `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${foot - top}" fill="${TONE.stone}"/>` +
    `<path d="${face}" stroke="${TONE.mortar}" stroke-width="0.8" fill="none"/>` +
    `<path d="${lit}" stroke="#6c7469" stroke-width="1.6" opacity="0.45"/>` +
    `<path d="M${x0 - 1.6} ${top}h${x1 - x0 + 3.2}v-3.4h${-(x1 - x0 + 3.2)}Z" fill="#596057"/>` +
    `<path d="M${x1 + 1.6} ${top}l${side} ${d1(lean)}v-3.4l${-side} ${d1(-lean)}Z" fill="#30352f"/>` +
    `<path d="M${x0 + 2.5} ${top - 3.4}v-3.4h3.4v3.4ZM${x0 + 7.5} ${top - 3.4}v-2.6h3v2.6Z" fill="#232823"/>` +
    `<path d="M${x0 - 1} ${foot}H${x1}l${side} ${d1(-climb)}" stroke="#20251f" stroke-width="1.8" fill="none"/>` +
    `<path d="${foot2.body}" fill="${TONE.moss}"/><path d="${foot2.rim}" stroke="${TONE.mossLit}" stroke-width="0.8" fill="none" opacity="0.75"/>`
  )
}

/** One warm window: a glow on the logs, the flickering pane, curtains or a plant against the light, mullions, a sill. */
function litWindow(r: Rand, uid: string, palette: Palette, w: (typeof WINDOWS)[number], plant: boolean): string {
  const cx = w.x + w.w / 2
  const cy = w.y + w.h / 2
  const inside = plant
    ? `<path d="M${d1(cx + 2)} ${w.y + w.h}l0.8 -4h4.4l0.8 4Z" fill="#6a3b1c" opacity="0.85"/>` +
      `<path d="M${d1(cx + 4.2)} ${w.y + w.h - 4}q-3.6 -2 -4.4 -6.4q3 1.6 4.4 6.4q0.6 -5 4 -7q-0.4 4.8 -4 7q-1.6 -3.6 -0.2 -8" stroke="#5a3417" stroke-width="1.1" fill="none" opacity="0.8"/>`
    : `<path d="M${w.x} ${w.y}h5q-2.4 ${d1(w.h * 0.5)} -0.6 ${w.h}H${w.x}ZM${w.x + w.w} ${w.y}h-5q2.4 ${d1(w.h * 0.5)} 0.6 ${w.h}H${w.x + w.w}Z" fill="#b8642f" opacity="0.7"/>`
  return (
    `<ellipse cx="${d1(cx)}" cy="${d1(cy)}" rx="${d1(w.w * 1.45)}" ry="${d1(w.h * 1.3)}" fill="url(#${uid}-wglow)">${flicker(r, 0.6, 0.95)}</ellipse>` +
    `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="url(#${uid}-pane)">${flicker(r, 0.86, 1)}</rect>` +
    inside +
    `<path d="M${d1(cx)} ${w.y}V${w.y + w.h}M${w.x} ${d1(cy)}H${w.x + w.w}" stroke="${TONE.frame}" stroke-width="1.2"/>` +
    `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" fill="none" stroke="${TONE.frame}" stroke-width="1.8"/>` +
    `<rect x="${w.x - 2}" y="${w.y + w.h + 0.6}" width="${w.w + 4}" height="2.4" fill="#4d392a"/>` +
    `<path d="M${w.x - 2} ${w.y + w.h + 0.9}h${w.w + 4}" stroke="${palette.accent}" stroke-width="0.6" opacity="0.6"/>`
  )
}

/** The door under its little porch: plank door with a lit pane, posts, the gabled porch roof, a deck and a step. */
function porch(uid: string, palette: Palette): string {
  const { x, y, w, h } = DOOR
  const cx = x + w / 2
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#2b1e15" stroke="${TONE.frame}" stroke-width="1.4"/>` +
    `<path d="M${x + 4} ${y + 12}V${y + h}M${x + 8} ${y + 12}V${y + h}M${x + 12} ${y + 12}V${y + h}" stroke="#1c130d" stroke-width="0.6"/>` +
    `<rect x="${x + 3.5}" y="${y + 4}" width="${w - 7}" height="6" rx="1" fill="url(#${uid}-pane)" opacity="0.9"/>` +
    `<path d="M${cx} ${y + 4}v6M${x + 3.5} ${y + 7}h${w - 7}" stroke="${TONE.frame}" stroke-width="0.8"/>` +
    `<circle cx="${x + w - 3}" cy="${y + 17}" r="0.9" fill="${palette.accent}" opacity="0.85"/>` +
    // deck and step
    `<rect x="166" y="${WALL.foot - 1}" width="50" height="5" fill="#3b2c20"/>` +
    `<path d="M166 ${WALL.foot - 0.6}h50" stroke="${palette.accent}" stroke-width="0.6" opacity="0.35"/>` +
    `<rect x="166" y="${WALL.foot + 4}" width="50" height="2.6" fill="#21180f"/>` +
    `<rect x="180" y="${WALL.foot + 6.6}" width="22" height="3.6" fill="#33261b"/>` +
    // posts, the porch's gable infill and its roof
    `<path d="M170.4 231h2.6v34h-2.6ZM209 231h2.6v34h-2.6Z" fill="#2f2219"/>` +
    `<path d="M170.6 232v32" stroke="${palette.accent}" stroke-width="0.5" opacity="0.4"/>` +
    `<path d="M171 232L${cx} 217.4L211 232Z" fill="#2c2018"/>` +
    `<path d="M177 228V232M181 224.6V232M185 221.6V232M197 221.6V232M201 224.6V232M205 228V232" stroke="#1a120c" stroke-width="0.7"/>` +
    `<path d="M168 233.5L${cx} 213L214 233.5L211.5 235L${cx} 216.8L170.5 235Z" fill="#28302b"/>` +
    `<path d="M168 233.5L${cx} 213L214 233.5" stroke="${TONE.roofLit}" stroke-width="0.7" fill="none"/>` +
    `<ellipse cx="${cx - 7}" cy="219.6" rx="6" ry="1.6" fill="${TONE.moss}" transform="rotate(-42 ${cx - 7} 219.6)"/>`
  )
}

/** The lantern hanging inside the porch by the door, swaying a little, and the wellies on the deck under it. */
function lantern(r: Rand, uid: string, palette: Palette): string {
  const [x, y] = LANTERN
  return (
    '<g>' +
    `<circle cx="${x}" cy="${y + 8}" r="20" fill="url(#${uid}-lamp)">${flicker(r, 0.65, 0.95)}</circle>` +
    `<path d="M${x} 229.2V${y + 3}" stroke="#1a1410" stroke-width="0.6"/>` +
    `<path d="M${x - 3.2} ${y + 5.5}L${x} ${y + 3}L${x + 3.2} ${y + 5.5}Z" fill="#1d1712"/>` +
    `<rect x="${x - 2.5}" y="${y + 5.5}" width="5" height="6.5" fill="#ffe2a0">${flicker(r, 0.75, 1)}</rect>` +
    `<path d="M${x - 2.5} ${y + 5.5}h5v6.5h-5ZM${x} ${y + 5.5}v6.5" stroke="#1d1712" stroke-width="0.6" fill="none"/>` +
    `<rect x="${x - 3}" y="${y + 12}" width="6" height="1.4" fill="#1d1712"/>` +
    sway(x, 229.2, 3, 6.5, 1.5) +
    '</g>' +
    // a pair of green wellies, caught by the lantern light
    `<path d="M174 258.4h2.8v5.4h1.8v1.4H174ZM178.8 259h2.8v4.8h1.8v1.4h-4.6Z" fill="#2e3d32"/>` +
    `<path d="M174.4 259v5.6M179.2 259.6v5" stroke="${palette.accent}" stroke-width="0.5" opacity="0.55"/>`
  )
}

/** The front wall: logs, the windows' glow, the windows, round log ends at both corners, the foundation. */
function frontWall(r: Rand, uid: string, palette: Palette): string {
  const { x0, x1, top, foot } = WALL
  let ends = ''
  for (let y = top + 3.5; y < foot; y += 7) for (const x of [x0 - 1.6, x1 + 1.6]) ends += `<circle cx="${d1(x)}" cy="${y}" r="3.4"/>`
  return (
    `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${foot - top}" fill="url(#${uid}-wall)"/>` +
    logCourses(x0, x1, TONE.logGap, TONE.logLit, 0.55) +
    litWindow(r, uid, palette, WINDOWS[0], false) +
    litWindow(r, uid, palette, WINDOWS[1], true) +
    `<g fill="${TONE.logEnd}">${ends}</g><g fill="none" stroke="${TONE.ring}" stroke-width="0.6" transform="translate(0 0.2)">${ends.replace(/r="3.4"/g, 'r="1.6"')}</g>` +
    `<rect x="${x0 - 5}" y="${foot}" width="${x1 - x0 + 10}" height="6" fill="#2c312c"/>` +
    `<path d="M${x0 + 4} ${foot}v6M${x0 + 19} ${foot}v6M${x0 + 33} ${foot}v6M${x0 + 52} ${foot}v6M${x1 - 30} ${foot}v6M${x1 - 12} ${foot}v6M${x0 - 5} ${foot + 3}H${x1 + 5}" stroke="#1b1f1b" stroke-width="0.7"/>`
  )
}

/** The woodpile beside the gable: split log ends stacked four, three, two, one. */
function woodpile(): string {
  let ends = ''
  ;[4, 3, 2, 1].forEach((count, row) => {
    for (let i = 0; i < count; i++) ends += `<circle cx="${d1(277.5 + row * 3.4 + i * 6.8)}" cy="${d1(264.6 - row * 5.9)}" r="3.4"/>`
  })
  return (
    `<ellipse cx="289" cy="268.4" rx="17" ry="2.4" fill="#0c110e" opacity="0.6"/>` +
    `<g fill="#5a4330">${ends}</g><g fill="none" stroke="#3a2b1e" stroke-width="0.6">${ends.replace(/r="3.4"/g, 'r="1.5"')}</g>` +
    `<path d="M273 245.6l31 -1.8l0.4 2.6l-31 1.8Z" fill="#2c2f2a"/><path d="M276 245.2q6 -2.4 12 -0.8" stroke="${TONE.moss}" stroke-width="1.4" fill="none"/>`
  )
}

// ── The gauge ───────────────────────────────────────────────────────────────────────────────

/** The barrel's profile: straight top and bottom, bulging staves. */
const barrelBody = (): string => {
  const { x, top, bottom, half } = BARREL
  const mid = (top + bottom) / 2
  return `M${x - half} ${top}Q${x - half - 5} ${mid} ${x - half} ${bottom}H${x + half}Q${x + half + 5} ${mid} ${x + half} ${top}Z`
}

/** The barrel's half width at height y (its staves bulge to `belly` at the middle). */
const barrelHalf = (y: number): number => {
  const { top, bottom, half, belly } = BARREL
  const t = (y - top) / (bottom - top)
  return half + (belly - half) * 4 * t * (1 - t)
}

/**
 * The context gauge: the rain barrel under the downspout. Its water rises from the bottom to the brim with the
 * context, shown through the barrel's side as through glass; a drip forms at the spout, falls, and rings the surface.
 */
function rainBarrel(uid: string, palette: Palette, context: number | undefined): { drip: string; barrel: string } {
  const { x, top, bottom, half } = BARREL
  const level = context ?? 0
  const floor = bottom - 2
  const surface = floor - (floor - (top + 1.5)) * level
  const lit = context !== undefined && level > 0.01
  const body = barrelBody()
  const mid = (top + bottom) / 2

  // The drip: hangs and swells at the spout, falls, lands (behind the barrel's front, or into the brim).
  const dur = 2.8
  const begin = 0.9
  const fall = d1((lit ? surface : floor) - SPOUT[1] - 1)
  const drip =
    `<path d="M${SPOUT[0]} ${SPOUT[1]}q-1.2 1.8 0 2.6q1.2 -0.8 0 -2.6Z" fill="#d6ecdf" opacity="0.9">` +
    drift(`0 0;0 0;0 ${fall};0 ${fall}`, dur, begin, ' keyTimes="0;0.66;0.84;1" calcMode="spline" keySplines="0 0 1 1;0.55 0 1 1;0 0 1 1"') +
    '</path>'
  // The ring where the drop lands, timed to start as it lands.
  const ringBegin = begin + dur * 0.16
  const ripple = lit
    ? `<ellipse cx="${x}" cy="${d1(surface)}" rx="1" ry="0.5" fill="none" stroke="#f1fff6" stroke-width="0.7" opacity="0">` +
      loop('rx', `1;${d1(barrelHalf(surface) - 2)};${d1(barrelHalf(surface) - 2)}`, dur, ringBegin, ' keyTimes="0;0.55;1"') +
      loop('opacity', '0.9;0;0', dur, ringBegin, ' keyTimes="0;0.55;1"') +
      '</ellipse>'
    : ''

  const hw = barrelHalf(surface)
  const water = lit
    ? `<g clip-path="url(#${uid}-barrelclip)" opacity="0.92">` +
      `<rect x="${x - BARREL.belly - 1}" y="${d1(surface)}" width="${(BARREL.belly + 1) * 2}" height="${d1(bottom - surface)}" fill="url(#${uid}-water)"/>` +
      `<rect x="${x - BARREL.belly - 1}" y="${d1(surface)}" width="${(BARREL.belly + 1) * 2}" height="${d1(bottom - surface)}" fill="url(#${uid}-wood)" opacity="0.45"/>` +
      `<path d="M${d1(x + hw - 4)} ${d1(surface + 3)}V${d1(Math.max(surface + 4, floor - 3))}" stroke="${palette.accent}" stroke-width="1.6" opacity="0.35" stroke-linecap="round"/>` +
      '</g>' +
      `<ellipse cx="${x}" cy="${d1(surface)}" rx="${d1(hw - 0.4)}" ry="1.3" fill="#effff4" opacity="0.8"/>` +
      ripple
    : ''

  let staves = ''
  for (const f of [-0.64, -0.3, 0.04, 0.38, 0.7]) staves += `M${d1(x + f * half)} ${top}Q${d1(x + f * (half + 5))} ${mid} ${d1(x + f * half)} ${bottom}`
  const hoop = (y: number, sag: number): string => `M${d1(x - barrelHalf(y))} ${d1(y)}Q${x} ${d1(y + sag)} ${d1(x + barrelHalf(y))} ${d1(y)}`
  const hoops = hoop(top + 4, 1.6) + hoop(mid, 2) + hoop(bottom - 4, 2.2)
  const brim = level >= 0.97 && lit
  return {
    drip,
    barrel:
      `<clipPath id="${uid}-barrelclip"><path d="${body}"/></clipPath>` +
      `<ellipse cx="${x}" cy="${bottom + 0.6}" rx="${BARREL.belly + 3}" ry="2.6" fill="#0a0e0c" opacity="0.6"/>` +
      `<path d="${body}" fill="url(#${uid}-wood)"/>` +
      water +
      `<path d="${staves}" stroke="#1d140d" stroke-width="0.7" fill="none" opacity="${lit ? 0.55 : 0.85}"/>` +
      `<path d="${hoops}" stroke="#161816" stroke-width="2" fill="none"/>` +
      `<path d="${hoops}" stroke="#646b64" stroke-width="0.5" fill="none" opacity="0.6" transform="translate(0 -0.9)"/>` +
      `<path d="M${x + half} ${top}Q${x + half + 5} ${mid} ${x + half} ${bottom}" stroke="${palette.accent}" stroke-width="1.1" fill="none" opacity="0.4"/>` +
      `<ellipse cx="${x}" cy="${top}" rx="${half}" ry="2.4" fill="${brim ? '#a9dcc2' : '#120d09'}" stroke="#5c4431" stroke-width="1.2"/>` +
      (brim ? `<ellipse cx="${x - 2}" cy="${top - 0.4}" rx="5" ry="0.8" fill="#f2fff7" opacity="0.8"/>` : ''),
  }
}

/** The gutter's downspout, bending out over the barrel. */
function downspout(): string {
  const d = `M${WALL.x0 - 7} ${EAVE + 3}V228q0 3.2 -3.6 3.6L${SPOUT[0] + 1.2} 232.6q-1.2 0.3 -1.2 1.6V${SPOUT[1]}`
  return (
    `<path d="${d}" stroke="${TONE.metal}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" stroke="${TONE.metalLit}" stroke-width="0.5" fill="none" opacity="0.5" transform="translate(-0.7 0)"/>`
  )
}

// ── The ground ──────────────────────────────────────────────────────────────────────────────

/** The clearing: wet ground, the windows' light spilling on it, puddles holding that light, stepping stones. */
function clearing(r: Rand, uid: string, palette: Palette): string {
  const ground = `<path d="M${L} 246Q-200 238 -60 242Q60 236 190 240Q330 236 470 242Q570 238 ${R} 244V470H${L}Z" fill="url(#${uid}-clearing)"/>`
  let wet = ''
  for (let i = 0; i < 9; i++) wet += `M${d1(between(r, L + 20, R - 20))} ${d1(between(r, 250, 300))}h${d1(between(r, 6, 18))}`
  const shadows =
    `<path d="M${WALL.x0 - 8} ${WALL.foot + 6}h${WALL.x1 - WALL.x0 + 16}l28 -10v6l-24 9h-${WALL.x1 - WALL.x0 + 20}Z" fill="#0b0f0c" opacity="0.55"/>`
  const spills =
    WINDOWS.map(w => `<ellipse cx="${w.x + w.w / 2}" cy="281" rx="34" ry="8.5" fill="url(#${uid}-spill)"/>`).join('') +
    `<ellipse cx="185" cy="279" rx="24" ry="6" fill="url(#${uid}-spill)" opacity="0.8"/>`
  const stones: readonly (readonly [number, number, number, number])[] = [
    [182, 281, 7, 2.2], [161, 284.4, 7.6, 2.4], [138, 287, 8, 2.5], [113, 288, 8, 2.5], [89, 287.2, 7.8, 2.4], [65, 285.2, 7.5, 2.3],
    [42, 282.2, 7.2, 2.2], [20, 278.6, 6.8, 2.1], [-2, 274.6, 6.4, 2], [-23, 270.6, 6, 1.8], [-43, 266.6, 5.5, 1.7], [-62, 263, 5, 1.5],
    [-80, 259.6, 4.6, 1.4], [-97, 256.6, 4.2, 1.3], [-113, 253.6, 3.8, 1.2], [-128, 251, 3.4, 1.1],
  ]
  let stoneBody = ''
  let stoneLit = ''
  let stoneWarm = ''
  for (const [x, y, rx, ry] of stones) {
    const a = between(r, 0.8, 1.2)
    stoneBody += `M${d1(x - rx)} ${d1(y + ry * 0.3)}q${d1(rx * 0.1)} ${d1(-ry * 1.4)} ${d1(rx * a)} ${d1(-ry * 1.3)}q${d1(rx * (2 - a))} ${d1(ry * 0.1)} ${d1(rx * (2 - a))} ${d1(ry * 1.2)}q${d1(-rx * 0.2)} ${d1(ry * 0.8)} ${d1(-rx)} ${d1(ry * 0.8)}T${d1(x - rx)} ${d1(y + ry * 0.3)}Z`
    const rim = `M${d1(x - rx * 0.7)} ${d1(y - ry * 0.55)}q${d1(rx * 0.6)} ${d1(-ry * 0.6)} ${d1(rx * 1.3)} 0`
    if (x > 136 && x < 250) stoneWarm += rim
    else stoneLit += rim
  }
  const puddles = PUDDLES.map((p, i) => {
    const w = WINDOWS[p.win]
    const shimmer = between(r, 3.5, 6)
    return (
      `<ellipse cx="${p.x}" cy="${p.y}" rx="${p.rx}" ry="${p.ry}" fill="#121a16"/>` +
      `<g clip-path="url(#${uid}-pud${i})">` +
      `<ellipse cx="${p.x}" cy="${p.y - p.ry}" rx="${p.rx}" ry="${p.ry}" fill="#4d5f55" opacity="0.5"/>` +
      `<g opacity="0.75">${loop('opacity', '0.75;0.45;0.8;0.75', shimmer, between(r, 0, shimmer))}` +
      `<rect x="${w.x + 2}" y="${p.y - p.ry}" width="${w.w - 4}" height="${p.ry * 2}" fill="${palette.accent}" filter="url(#${uid}-soft)"/>` +
      `<path d="M${w.x + 1} ${d1(p.y + p.ry * 0.3)}h${w.w - 2}" stroke="#fff0c8" stroke-width="0.6"/></g>` +
      '</g>' +
      `<path d="M${p.x - p.rx} ${p.y}a${p.rx} ${p.ry} 0 0 1 ${p.rx * 2} 0" stroke="#5c6e64" stroke-width="0.6" fill="none" opacity="0.6"/>`
    )
  }).join('')
  return (
    ground +
    `<path d="${wet}" stroke="#5c6f65" stroke-width="0.6" opacity="0.3"/>` +
    shadows +
    spills +
    `<path d="${stoneBody}" fill="#2a312b"/><path d="${stoneLit}" stroke="#5f6c63" stroke-width="0.8" fill="none" stroke-linecap="round" opacity="0.7"/>` +
    `<path d="${stoneWarm}" stroke="${palette.accent}" stroke-width="0.8" fill="none" stroke-linecap="round" opacity="0.55"/>` +
    puddles +
    ripples(r, [[PUDDLES[0].x - 5, PUDDLES[0].y], [PUDDLES[1].x + 6, PUDDLES[1].y + 0.6]], '#a9c2b4', 5)
  )
}

/** Wide panes: the creek running out of the trees on the right, the far light, the fallen log on the left. */
function widerForest(r: Rand, uid: string, palette: Palette): { back: string; ground: string } {
  // A far cabin's lit window, deep in the trees above the creek's source.
  const farLight =
    `<circle cx="478" cy="216" r="16" fill="url(#${uid}-wglow)">${flicker(r, 0.45, 0.8)}</circle>` +
    `<path d="M468 224l9 -8l9 8Z" fill="#202c26"/><rect x="470" y="223.6" width="14" height="6" fill="#202c26"/>` +
    `<rect x="475.6" y="225" width="2.8" height="2.6" fill="${palette.accent}"/>`
  // The creek, widening as it comes towards us, with a slow sheen sliding down it.
  const centre: readonly Pt[] = [[470, 245], [463, 256], [469, 270], [449, 290], [419, 312], [382, 340]]
  const halfAt = (i: number): number => 2 + i * i * 1.3
  const leftBank = centre.map(([x, y], i) => `${d1(x - halfAt(i))} ${y}`).join('L')
  const rightBank = [...centre]
    .reverse()
    .map(([x, y], j) => `${d1(x + halfAt(centre.length - 1 - j))} ${y}`)
    .join('L')
  let sheen = ''
  for (let i = 0; i < 9; i++) {
    const t = between(r, 0.5, centre.length - 1.2)
    const a = centre[Math.floor(t)] ?? [500, 300]
    const b = centre[Math.ceil(t)] ?? a
    const f = t - Math.floor(t)
    sheen += `M${d1(a[0] + (b[0] - a[0]) * f + between(r, -4, 4))} ${d1(a[1] + (b[1] - a[1]) * f)}h${d1(between(r, 3, 8))}`
  }
  const creek =
    `<path d="M${leftBank}L${rightBank}Z" fill="url(#${uid}-creek)"/>` +
    `<path d="M${leftBank}" stroke="#0f1512" stroke-width="1.6" fill="none" opacity="0.6"/>` +
    `<path d="${sheen}" stroke="#93aa9d" stroke-width="0.7" opacity="0.4">${drift('0 0;-3 4;0 0', 7, 2)}</path>` +
    `<path d="M422 302a5 2.4 0 1 0 10 0a5 2.4 0 1 0 -10 0M396 322a6 2.8 0 1 0 12 0a6 2.8 0 1 0 -12 0M458 282a3.4 1.6 0 1 0 6.8 0a3.4 1.6 0 1 0 -6.8 0" fill="#3a423b"/>`
  // A fallen, mossy log beside the path, a cluster of mushrooms on it.
  const log =
    '<g transform="rotate(-5 -100 290)">' +
    '<rect x="-150" y="284" width="96" height="12" rx="6" fill="#2b221a"/>' +
    `<path d="M-146 285q20 -3 44 -1q22 -2 44 0" stroke="${TONE.moss}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
    '<ellipse cx="-150" cy="290" rx="4.2" ry="6" fill="#6b5240"/><ellipse cx="-150" cy="290" rx="2" ry="3" fill="none" stroke="#3e2f22" stroke-width="0.6"/>' +
    '</g>'
  return { back: farLight, ground: creek + log }
}

/** A clump of ferns at (x, base): fronds fanning out and drooping, leaflets tapering to each tip. */
function fernClump(r: Rand, x: number, base: number, size: number, fronds: number): { back: string; front: string } {
  let back = ''
  let front = ''
  for (let i = 0; i < fronds; i++) {
    const a = -1.2 + (2.4 * (i + between(r, 0.2, 0.8))) / fronds
    const len = size * between(r, 0.72, 1)
    const p0: Pt = [x + a * 2, base]
    const p2: Pt = [x + Math.sin(a) * len, base - Math.cos(a) * len * 0.72 + Math.abs(Math.sin(a)) * len * 0.3]
    const p1: Pt = [x + Math.sin(a) * len * 0.4, base - len * 0.78]
    let d = `M${d1(p0[0])} ${d1(p0[1])}Q${d1(p1[0])} ${d1(p1[1])} ${d1(p2[0])} ${d1(p2[1])}`
    for (let k = 1; k <= 6; k++) {
      const t = 0.1 + k * 0.135
      const bx = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
      const by = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
      const tx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
      const ty = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
      const tl = Math.hypot(tx, ty) || 1
      const leaf = size * 0.24 * Math.pow(1 - t, 0.7) + 0.8
      // one stroke per pair: from the left leaflet's tip in to the rachis and out to the right one's
      const lx = (ty / tl + (tx / tl) * 0.5) * leaf
      const ly = (-tx / tl + (ty / tl) * 0.5) * leaf + leaf * 0.25
      const rx = (-ty / tl + (tx / tl) * 0.5) * leaf
      const ry = (tx / tl + (ty / tl) * 0.5) * leaf + leaf * 0.25
      d += `M${d1(bx + lx)} ${d1(by + ly)}l${d1(-lx)} ${d1(-ly)}l${d1(rx)} ${d1(ry)}`
    }
    if (i % 2 === 0) back += d
    else front += d
  }
  return { back, front }
}

/** Ferns, mushrooms and stones along the front; each clump sways from its root. */
function foreground(r: Rand, uid: string): string {
  const clumps: readonly (readonly [number, number, number, number, string])[] = [[50, 303, 40, 6, 'a'], [308, 305, 36, 6, 'b'], [94, 280, 17, 4, 'c']]
  let out = ''
  for (const [x, base, size, fronds, name] of clumps) {
    const fern = fernClump(r, x, base, size, fronds)
    out +=
      `<g id="${uid}-fern-${name}" stroke-linecap="round" fill="none">` +
      `<path d="${fern.back}" stroke="${TONE.fernBack}" stroke-width="1.7"/><path d="${fern.front}" stroke="${TONE.fern}" stroke-width="1.8"/>` +
      sway(x, base, 1.4, between(r, 7, 10), between(r, 0, 6)) +
      '</g>'
  }
  // The same clumps again, out in the wider forest.
  const copies: readonly (readonly [string, number, number, number, number, number])[] = [
    ['a', 50, 303, -70, 300, 0.9], ['b', 308, 305, -250, 296, 1.1], ['a', 50, 303, 352, 302, -0.95], ['b', 308, 305, 520, 300, 1],
    ['c', 94, 280, -40, 284, -1],
  ]
  out += copies
    .map(([name, fx, fy, x, y, s]) => `<use href="#${uid}-fern-${name}" transform="matrix(${s} 0 0 ${Math.abs(s)} ${n(x - fx * s)} ${n(y - fy * Math.abs(s))})"/>`)
    .join('')
  // Mushrooms: by the barrel, by the woodpile, on the fallen log.
  const shrooms: readonly (readonly [number, number, number])[] = [
    [86, 279, 1], [91.5, 280.6, 0.75], [81, 281, 0.6], [306, 271, 0.9], [311, 272.4, 0.65], [-118, 282.4, 0.8], [-112, 281.8, 0.6],
  ]
  let stems = ''
  let caps = ''
  let lit = ''
  for (const [x, y, s] of shrooms) {
    stems += `M${d1(x - 0.8 * s)} ${d1(y)}q0.2 ${d1(-2 * s)} 0 ${d1(-3.6 * s)}h${d1(1.6 * s)}q-0.2 ${d1(1.6 * s)} 0 ${d1(3.6 * s)}Z`
    caps += `M${d1(x - 3 * s)} ${d1(y - 3.2 * s)}q${d1(3 * s)} ${d1(-4.4 * s)} ${d1(6 * s)} 0Z`
    lit += `M${d1(x - 1.6 * s)} ${d1(y - 4.6 * s)}q${d1(1.2 * s)} ${d1(-1.2 * s)} ${d1(2.4 * s)} -0.2`
  }
  const rocks =
    `<path d="M18 300q4 -8 13 -7q8 1 9 7ZM256 303q3 -6 10 -6q7 0 8 6ZM-92 296q4 -7 12 -6q7 1 8 6ZM448 296q4 -7 11 -6q7 1 8 6Z" fill="#262d28"/>` +
    `<path d="M22 296q4 -2.6 9 -2.4M260 300q3 -2 7 -2M-88 292q4 -2.4 8 -2" stroke="${TONE.moss}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
  return (
    rocks +
    `<path d="${stems}" fill="#bfb39a" opacity="0.85"/><path d="${caps}" fill="#94523a"/>` +
    `<path d="${lit}" stroke="#c98a5e" stroke-width="0.7" fill="none" opacity="0.8"/>` +
    out
  )
}

// ── The air: smoke, fog, fireflies ──────────────────────────────────────────────────────────

/** Smoke curling up from the chimney and drifting off on the damp air. */
function smoke(r: Rand, uid: string): string {
  const x = CHIMNEY.x0 + 5
  const y = CHIMNEY.top - 8
  const dur = 13
  let out = ''
  for (let i = 0; i < 3; i++) {
    const begin = (dur * i) / 3 + between(r, 0, 1)
    out +=
      `<circle cx="${d1(x)}" cy="${y}" r="3" fill="#a2afa7" opacity="0">` +
      drift(`0 0;${d1(between(r, 2, 5))} -12;${d1(between(r, -6, -2))} -26;${d1(between(r, -16, -10))} -38`, dur, begin) +
      loop('opacity', '0.1;0.36;0.2;0', dur, begin) +
      loop('r', '3;6.5;10;14', dur, begin) +
      '</circle>'
  }
  return `<g filter="url(#${uid}-smoke)">${out}</g>`
}

/** One firefly: a warm yellow-green glow around a pale core, drawn once and copied for each. */
const fireflyDefs = (uid: string): string =>
  `<g id="${uid}-fly"><circle r="11" fill="url(#${uid}-firefly)"/><circle r="1.5" fill="${TONE.firefly}"/></g>`

/** One firefly per active subagent, drifting slowly along a soft loop and pulsing. */
function fireflies(uid: string, spots: ReturnType<typeof swarmSpots>): string {
  const ease = ' calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1"'
  return spots
    .map((spot, i) => {
      const dir = i % 2 === 0 ? 1 : -1
      const dx = dir * (6 + spot.k * 9)
      const dy = -(4 + spot.k * 7)
      const dur = 15 + spot.k * 10
      const pulse = 2.6 + spot.k * 2.4
      return (
        `<use href="#${uid}-fly" x="${d1(spot.x)}" y="${d1(spot.y)}">` +
        drift(`0 0;${d1(dx)} ${d1(dy)};${d1(-dx * 0.5)} ${d1(dy * 0.4)};0 0`, dur, spot.k * dur, ease) +
        loop('opacity', '0.3;1;0.55;0.95;0.3', pulse, spot.k * pulse * 3) +
        '</use>'
      )
    })
    .join('')
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const defs = defsFor(uid, palette) + pineTemplates(r, uid) + fireflyDefs(uid)

  // The sky's misty glow low behind the trees, and a slow high mist under the title.
  const sky =
    `<ellipse cx="200" cy="200" rx="460" ry="78" fill="url(#${uid}-skyglow)"/>` +
    fog({ uid, y: 112, width: 1100, color: TONE.fog, opacity: 0.1, dur: 90, begin: 20, x0: -380 })

  // The forest in layers, far and misty to near and dark, fog drifting between them.
  const far = farSpires(r, 214)
  const farFog = fog({ uid, y: 206, width: 1100, color: TONE.fog, opacity: 0.34, dur: 64, begin: 12, x0: -380 })
  const midFar = pineRow(r, uid, { x0: L, x1: R, gap: [16, 24], base: 226, height: x => (Math.abs(x - 200) < 100 ? 62 : 82), fill: TONE.midFar })
  const wide = widerForest(r, uid, palette)
  const behindCabin = `<ellipse cx="205" cy="214" rx="130" ry="34" fill="${TONE.fog}" opacity="0.2" filter="url(#${uid}-smoke)"/>`
  // The nearer row stands back from the cabin, and leaves gaps where the path and the creek come out of the trees.
  const gaps: readonly Pt[] = [[104, 298], [-150, -104], [446, 496]]
  const mid = pineRow(r, uid, { x0: L, x1: R, gap: [16, 28], base: 246, fill: TONE.mid, skip: gaps, height: x => (x > 10 && x < 330 ? 150 : 124) })
  // Two tall spruces at the canvas edges, rising past its top: they frame the title and a tall dock's sky.
  const spires = `<g fill="${TONE.near}"><use href="#${uid}-pb" transform="matrix(0.62 0 0 3.1 30 252)"/><use href="#${uid}-pb" transform="matrix(-0.58 0 0 2.9 312 254)"/></g>`
  const edgeFog = fog({ uid, y: 238, width: 1100, color: TONE.fog, opacity: 0.3, dur: 50, begin: 30, x0: -360 })

  // The rain: a fine far sheet behind the cabin, then two nearer ones and a few big streaks in front of it.
  const rainId = (i: number): string => `${uid}-rain${i}`
  const farRain = rain(uid, [rainSheet(r, rainId(0), { count: 38, len: [4, 7], width: 0.5, opacity: 0.26, dur: 1.9 })], [rainId(0)])
  const nearSheets = [
    rainSheet(r, rainId(1), { count: 36, len: [7, 11], width: 0.6, opacity: 0.27, dur: 1.4 }),
    rainSheet(r, rainId(2), { count: 14, len: [11, 16], width: 0.8, opacity: 0.3, dur: 1.05 }),
  ]
  const nearRain = rain(uid, nearSheets, [rainId(1), rainId(2)])
  const streaks = `<g opacity="0.5">${rainfall(r, { x0: 10, y0: 100, x1: 330, y1: 310 }, 3, TONE.rain, -4)}</g>`

  // The clearing and the cabin.
  const ground = clearing(r, uid, palette)
  const chimneySmoke = smoke(r, uid)
  const haze = `<ellipse cx="192" cy="244" rx="124" ry="54" fill="url(#${uid}-spill)" opacity="0.5"/>`
  const cabin = gableEnd(palette) + roof(r, uid) + chimney(r) + frontWall(r, uid, palette) + porch(uid, palette) + lantern(r, uid, palette)
  const grass = (() => {
    let d = ''
    for (let i = 0; i < 18; i++) {
      const x = between(r, WALL.x0 - 30, WALL.x1 + 70)
      d += `M${d1(x)} ${d1(WALL.foot + 6 + between(r, 0, 4))}l${d1(between(r, -2, 2))} ${d1(-between(r, 3, 7))}`
    }
    return `<path d="${d}" stroke="#223028" stroke-width="0.9" stroke-linecap="round"/>`
  })()
  const lowFog = fog({ uid, y: 302, width: 1100, color: '#5f7268', opacity: 0.16, dur: 42, begin: 8, x0: -340 })
  const front = foreground(r, uid)

  // The gauge, then the swarm: drawn last, so the scenery never shifts as they change.
  const gauge = rainBarrel(uid, palette, context)
  const caption = gaugeCaption({ x: BARREL.x - BARREL.belly - 5, y: BARREL.top + 6, name: scene.gauge, value: contextText, palette, anchor: 'end' })
  const swarmArt = fireflies(uid, swarmSpots(scene.id, SWARM_AREA, swarm))

  return {
    defs,
    body:
      sky + far + farFog + midFar + wide.back + behindCabin + mid + spires + edgeFog + farRain + ground + wide.ground + haze + chimneySmoke + cabin + woodpile() +
      gauge.drip + downspout() + gauge.barrel + grass + litRain(r, uid) + nearRain + streaks + lowFog + nearPines(uid) + front + swarmArt + caption,
  }
}
