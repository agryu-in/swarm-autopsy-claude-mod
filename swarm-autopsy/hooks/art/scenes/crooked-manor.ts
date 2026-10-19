// Crooked Manor: midnight over a leaning Victorian house on its hill. A twisted turret, steep
// gables and crooked chimneys in charcoal; every window dark but one, which burns a dim ember
// red (and one more, barely). A winding path runs down to a wrought-iron gate between bare,
// crooked trees; faint stars, thin clouds sliding past, a rare far-off flash.
// The context gauge is the moon: it waxes from a faint outline to full as the context window
// fills, its halo growing with it. Each active subagent is a bat flitting about the turret
// and the moon.

import type { Area } from '../kit.ts'
import type { Painted, PaintArgs } from '../scene.ts'
import {
  BLEED,
  SCENE_W,
  bareTree,
  bat,
  between,
  blur,
  cloud,
  distantFlash,
  flicker,
  fog,
  fogDefs,
  gaugeCaption,
  hills,
  linearY,
  loop,
  n,
  radialBox,
  stars,
  swarmSpots,
} from '../kit.ts'

const L = -BLEED
const R = SCENE_W + BLEED

type Pt = readonly [number, number]

// The moon: upper left, below the title zone; its caption sits to its left.
const MX = 92
const MY = 128
const MR = 22

/** Charcoal layers, far to near. */
const TONE = {
  ridge: '#2b2d36',
  farHill: '#23252c',
  midHill: '#1d1e24',
  manorHill: '#15161a',
  near: '#0f1013',
  roof: '#0f1014',
  trim: '#0c0d10',
  rim: '#30323c',
  glass: '#0a0b0e',
  iron: '#09090c',
  bat: '#0b0b0e',
}

/**
 * The lit part of the moon for an illuminated fraction `f` (0 new, 1 full), waxing on the
 * right: the right limb, then the terminator back up as a half-ellipse |1 − 2f|·R wide.
 * The lit area is exactly f of the disc.
 */
function moonPhase(f: number): string {
  const k = 1 - 2 * f
  return `M${MX} ${MY - MR}A${MR} ${MR} 0 0 1 ${MX} ${MY + MR}A${n(Math.abs(k) * MR)} ${MR} 0 0 ${k > 0 ? 0 : 1} ${MX} ${MY - MR}Z`
}

/** Stars that hold still (cheaper than twinkling ones) over a few areas. */
function stillStars(r: () => number, areas: readonly Area[], count: number, size: number, opacity: number): string {
  let d = ''
  for (const area of areas)
    for (let i = 0; i < count; i++) {
      const x = between(r, area.x0, area.x1)
      const y = between(r, area.y0, area.y1)
      const s = between(r, 0.3, 0.6) * size
      d += `M${n(x - s)} ${n(y)}a${n(s)} ${n(s)} 0 1 0 ${n(s * 2)} 0a${n(s)} ${n(s)} 0 1 0 ${n(-s * 2)} 0`
    }
  return `<path d="${d}" fill="#d6d4e2" opacity="${n(opacity)}"/>`
}

/** Sky: faint stars (only either side of the title), a rare flash, thin clouds sliding. */
function skyLayer(r: () => number): string {
  const titleLeft: Area = { x0: -90, y0: 6, x1: 24, y1: 80 }
  const titleRight: Area = { x0: 316, y0: 6, x1: 430, y1: 80 }
  const below: Area = { x0: -90, y0: 88, x1: 430, y1: 210 }
  const farSides: Area[] = [
    { x0: L, y0: 6, x1: -92, y1: 210 },
    { x0: 432, y0: 6, x1: R, y1: 210 },
  ]
  return (
    distantFlash({ color: '#a9aec2', opacity: 0.05, dur: 31, begin: 12 }) +
    `<g opacity="0.4">${stars(r, titleLeft, 3, '#d6d4e2', [0.4, 0.9])}${stars(r, titleRight, 3, '#d6d4e2', [0.4, 0.9])}</g>` +
    `<g opacity="0.7">${stars(r, below, 12, '#e2e0ec', [0.4, 1.1])}</g>` +
    stillStars(r, [titleLeft, titleRight], 5, 1, 0.22) +
    stillStars(r, [below], 22, 1.2, 0.32) +
    stillStars(r, farSides, 16, 1.3, 0.3)
  )
}

/** A thin cloud streak: the kit's cloud flattened and stretched, sliding sideways. */
function streak(x: number, y: number, sx: number, sy: number, color: string, opacity: number, distance: number, dur: number, begin: number): string {
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(sx)} ${n(sy)})">${cloud({ x: 0, y: 0, scale: 1, color, opacity, distance, dur, begin })}</g>`
}

function cloudLayer(): string {
  return (
    streak(-170, 104, 2.2, 0.32, '#3d3f4a', 0.4, 90, 64, 10) +
    streak(250, 172, 1.8, 0.3, '#353742', 0.45, -70, 58, 30) +
    streak(470, 118, 2, 0.3, '#3d3f4a', 0.4, -80, 70, 5) +
    streak(-40, 190, 2.4, 0.28, '#30323c', 0.5, 60, 52, 18) +
    // the one that drifts across the moon now and then
    streak(MX - 400, MY + 8, 1.3, 0.34, '#6a6c78', 0.26, 600, 120, 22)
  )
}

/** The moon gauge: halo, dark disc with its faint outline, the lit phase with soft maria. */
function moonLayer(uid: string, accent: string, context: number | undefined): { defs: string; body: string } {
  const f = context ?? 0
  let defs =
    radialBox(`${uid}-moonglow`, [
      [0, accent, 0.55],
      [0.38, accent, 0.2],
      [1, accent, 0],
    ]) +
    `<radialGradient id="${uid}-moon" gradientUnits="userSpaceOnUse" cx="${MX}" cy="${MY}" r="${MR}" fx="${MX - 6}" fy="${MY - 7}">` +
    `<stop offset="0" stop-color="#fbf5de"/><stop offset="0.6" stop-color="${accent}"/><stop offset="1" stop-color="#c9bc8c"/></radialGradient>` +
    blur(`${uid}-mblur`, 2.2)
  const haloA = context === undefined ? 0 : 0.1 + 0.68 * f
  const haloR = MR * (1.7 + 1.7 * f)
  let body =
    (haloA > 0
      ? `<circle cx="${MX}" cy="${MY}" r="${n(haloR)}" fill="url(#${uid}-moonglow)" opacity="${n(haloA)}">${loop('opacity', `${n(haloA * 0.82)};${n(haloA)};${n(haloA * 0.82)}`, 11, 4)}</circle>`
      : '') +
    `<circle cx="${MX}" cy="${MY}" r="${MR}" fill="#1e1f27" stroke="${accent}" stroke-opacity="${context === undefined ? 0.2 : 0.3}" stroke-width="0.7"/>`
  if (context !== undefined && f > 0.005) {
    const d = moonPhase(f)
    defs += `<clipPath id="${uid}-lit"><path d="${d}"/></clipPath>`
    const maria: readonly (readonly [number, number, number, number])[] = [
      [0.3, -0.24, 0.28, 0.2],
      [0.46, 0.26, 0.2, 0.15],
      [-0.2, 0.34, 0.24, 0.17],
      [-0.34, -0.28, 0.16, 0.13],
      [0.04, 0.04, 0.12, 0.09],
    ]
    body +=
      `<path d="${d}" fill="${accent}" opacity="0.55" filter="url(#${uid}-mblur)"/>` +
      `<path d="${d}" fill="url(#${uid}-moon)"/>` +
      `<g clip-path="url(#${uid}-lit)" fill="#a99c6e" opacity="0.32">` +
      maria.map(([dx, dy, rx, ry]) => `<ellipse cx="${n(MX + dx * MR)}" cy="${n(MY + dy * MR)}" rx="${n(rx * MR)}" ry="${n(ry * MR)}"/>`).join('') +
      '</g>'
  }
  return { defs, body }
}

/** Far hills (hazy), mid hills, a mist band, then the manor's own hill. */
function landLayer(r: () => number, uid: string): string {
  const ridge = hills(r, { x0: L, x1: R, y: 222, amp: 22, bottom: 420, fill: TONE.ridge, bumps: 7 })
  const far = hills(r, { x0: L, x1: R, y: 236, amp: 14, bottom: 420, fill: TONE.farHill, bumps: 10 })
  const farTrees =
    bareTree(r, { x: -46, y: 228, h: 34, color: '#1d1f25', lean: 0.1, width: 1.6 }) +
    bareTree(r, { x: 132, y: 236, h: 26, color: '#1d1f25', lean: -0.15, width: 1.3 }) +
    bareTree(r, { x: 392, y: 230, h: 30, color: '#1d1f25', lean: 0.2, width: 1.5 })
  const mid = hills(r, { x0: L, x1: R, y: 256, amp: 12, bottom: 420, fill: TONE.midHill, bumps: 8 })
  const mist = fog({ uid, y: 250, width: 520, color: '#5a5d6a', opacity: 0.16, dur: 56, begin: 14, x0: -120 })
  const manorHill = `<path d="M${L} 300 L${L} 274 Q-60 272 40 266 Q120 256 170 242 Q200 236 236 237 Q290 238 330 248 Q400 262 ${R} 256 L${R} 420 L${L} 420 Z" fill="${TONE.manorHill}"/>`
  const crest = `<path d="M${L} 274 Q-60 272 40 266 Q120 256 170 242" fill="none" stroke="#2a2c35" stroke-width="1" opacity="0.7"/>`
  return ridge + far + farTrees + mid + mist + manorHill + crest
}

/** A dark sash window with a pediment cap and a faint moonlit glint on its top edge. */
function darkWindow(x: number, y: number, w: number, h: number, arch = false): string {
  const shape = arch
    ? `<path d="M${n(x)} ${n(y + h)}V${n(y + w / 2)}a${n(w / 2)} ${n(w / 2)} 0 0 1 ${n(w)} 0V${n(y + h)}Z" fill="${TONE.glass}" stroke="${TONE.trim}" stroke-width="1"/>`
    : `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${TONE.glass}" stroke="${TONE.trim}" stroke-width="1"/>` +
      `<path d="M${n(x - 2)} ${n(y - 1)}L${n(x + w / 2)} ${n(y - 5)}L${n(x + w + 2)} ${n(y - 1)}Z" fill="${TONE.trim}"/>`
  return shape + `<path d="M${n(x + w / 2)} ${n(y + (arch ? w / 2 : 0))}V${n(y + h)}M${n(x)} ${n(y + h * 0.55)}h${n(w)}" stroke="#16171c" stroke-width="0.8"/>`
}

/** The lit window: an ember glow behind, a flickering pane, a half-drawn curtain, mullions. */
function litWindow(r: () => number, uid: string, x: number, y: number, w: number, h: number, color: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  return (
    `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w * 1.9)}" ry="${n(h * 1.25)}" fill="url(#${uid}-ember)">${flicker(r, 0.5, 0.95)}</ellipse>` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#${uid}-pane)">${flicker(r, 0.72, 1)}</rect>` +
    `<path d="M${n(x)} ${n(y)}h${n(w * 0.42)}q${n(-w * 0.18)} ${n(h * 0.5)} ${n(-w * 0.08)} ${n(h)}H${n(x)}Z" fill="#3a1a18" opacity="0.85"/>` +
    `<path d="M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}ZM${n(cx)} ${n(y)}V${n(y + h)}M${n(x)} ${n(y + h * 0.55)}h${n(w)}" fill="none" stroke="${TONE.trim}" stroke-width="1"/>` +
    `<path d="M${n(x - 2)} ${n(y - 1)}L${n(cx)} ${n(y - 5)}L${n(x + w + 2)} ${n(y - 1)}Z" fill="${TONE.trim}"/>` +
    `<rect x="${n(x - 1.5)}" y="${n(y + h)}" width="${n(w + 3)}" height="1.6" fill="${color}" opacity="0.35"/>`
  )
}

/** The twisted turret on the manor's left: a leaning round tower under a bent, spiralled cone. */
function turret(r: () => number, uid: string, ember: string): string {
  const cone = 'M153 159Q163 128 177 90Q180 122 193 159Z'
  const bands = 'M156 150Q172 141 191 147M160 137Q171 127 186 129M164 122Q172 113 182 113M168 108Q173 101 179 100'
  return (
    '<g transform="rotate(-4.5 173 240)">' +
    `<path d="M160 240V161Q173 157 186 161V240Z" fill="url(#${uid}-wall)"/>` +
    `<path d="M160 240V161" stroke="${TONE.rim}" stroke-width="1"/>` +
    `<rect x="156" y="156" width="34" height="5" fill="${TONE.roof}"/>` +
    `<path d="${cone}" fill="${TONE.roof}"/>` +
    `<path d="M153 159Q163 128 177 90" fill="none" stroke="${TONE.rim}" stroke-width="0.9"/>` +
    `<path d="${bands}" fill="none" stroke="#23252d" stroke-width="1.1"/>` +
    `<path d="M177 90q-1.5 -3 1 -5" fill="none" stroke="${TONE.roof}" stroke-width="1"/><circle cx="178.2" cy="84.6" r="1.1" fill="${TONE.roof}"/>` +
    // the upper window holds the faintest light; the lower one is dark
    `<path d="M168 190V176a5 5 0 0 1 10 0V190Z" fill="${ember}" opacity="0.2">${flicker(r, 0.1, 0.3)}</path>` +
    `<path d="M168 190V176a5 5 0 0 1 10 0V190ZM173 171V190" fill="none" stroke="${TONE.trim}" stroke-width="1"/>` +
    darkWindow(168, 204, 10, 20, true) +
    '</g>'
  )
}

/** Faint clapboard lines across a wall from x0 to x1, y0 to y1. */
function siding(x0: number, x1: number, y0: number, y1: number): string {
  let d = ''
  for (let y = y0; y <= y1; y += 4.5) d += `M${x0} ${n(y)}H${x1}`
  return `<path d="${d}" stroke="#0c0d10" stroke-width="0.6" opacity="0.4"/>`
}

/** The manor: turret, main block under a steep front gable, a sagging right wing, chimneys, porch. */
function manorLayer(r: () => number, uid: string, ember: string): string {
  const wall = `url(#${uid}-wall)`
  const chimneys =
    `<g fill="${TONE.roof}"><g transform="rotate(4 244 150)"><rect x="240" y="120" width="9" height="40"/><rect x="238" y="116" width="13" height="4"/><rect x="241" y="111" width="3" height="5"/><rect x="245.5" y="112" width="2.6" height="4"/></g>` +
    '</g>'
  const rightWing =
    '<g transform="rotate(2.6 256 240)">' +
    `<g fill="${TONE.roof}" transform="rotate(-9 291 166)"><rect x="288" y="146" width="7" height="20"/><rect x="286.5" y="143" width="10" height="3.5"/><rect x="289.5" y="139" width="3" height="4"/></g>` +
    `<path d="M256 240V186H300V240Z" fill="${wall}"/>` +
    siding(256, 300, 190, 238) +
    `<path d="M251 189Q256 171 262 163Q278 167 294 162Q300 171 305 189Z" fill="${TONE.roof}"/>` +
    `<path d="M251 189Q256 171 262 163" fill="none" stroke="${TONE.rim}" stroke-width="0.9"/>` +
    `<path d="M270 182V171L278 163L286 171V182Z" fill="${wall}"/>` +
    `<path d="M267.5 172.5L278 161.5L288.5 172.5" fill="none" stroke="${TONE.roof}" stroke-width="2.4"/>` +
    `<rect x="274.5" y="171" width="7" height="9" fill="${TONE.glass}" stroke="${TONE.trim}" stroke-width="0.8"/>` +
    darkWindow(263, 197, 10, 24, true) +
    darkWindow(283, 197, 10, 24, true) +
    // a shutter hanging loose by one hinge
    `<rect x="293.5" y="197" width="4" height="22" fill="#14151a" transform="rotate(14 293.5 197)"/>` +
    `<rect x="256" y="234" width="44" height="6" fill="${TONE.trim}"/>` +
    '</g>'
  const gable =
    `<path d="M186 240V170H256V240Z" fill="${wall}"/>` +
    siding(186, 256, 174, 238) +
    `<path d="M186 172Q204 149 223 119Q244 142 256 172Z" fill="${wall}"/>` +
    `<path d="M177.5 176Q201 145 223 111Q248 141 264.5 176" fill="none" stroke="${TONE.roof}" stroke-width="5" stroke-linejoin="miter"/>` +
    `<path d="M176 173.5Q199.5 142.5 221.5 109.5" fill="none" stroke="${TONE.rim}" stroke-width="0.9"/>` +
    `<path d="M223 116V133M216 127H230M218 121L223 133L228 121" fill="none" stroke="${TONE.roof}" stroke-width="1"/>` +
    `<circle cx="221" cy="147" r="6" fill="${TONE.glass}" stroke="${TONE.trim}" stroke-width="1.4"/>` +
    `<path d="M221 141V153M215 147H227" stroke="#16171c" stroke-width="0.8"/>` +
    `<rect x="186" y="200" width="70" height="3" fill="${TONE.trim}"/>`
  const windows = darkWindow(193, 179, 11, 17) + litWindow(r, uid, 237, 179, 11, 17, ember) + darkWindow(191, 209, 11, 19) + darkWindow(242, 209, 11, 19)
  const porch =
    `<path d="M201 207L208 200H234L241 207Z" fill="${TONE.roof}"/>` +
    `<g fill="${TONE.trim}"><rect x="206" y="207" width="2.4" height="31"/><rect x="233.6" y="207" width="2.4" height="31"/></g>` +
    `<path d="M215 238V222a6 6 0 0 1 12 0V238Z" fill="#070709"/>` +
    `<path d="M208 229H215M227 229H234" stroke="${TONE.trim}" stroke-width="1.2"/>` +
    '<rect x="210" y="238" width="22" height="3" fill="#1c1d22"/><rect x="207" y="241" width="28" height="3" fill="#18191d"/>'
  const foundation = `<rect x="156" y="236" width="148" height="7" fill="${TONE.trim}"/>`
  // shrubs grown wild against the foundation
  let shrubs = `M150 248`
  for (let x = 150; x < 312; x += 9) shrubs += `Q${n(x + 4.5)} ${n(between(r, 230, 238))} ${n(x + 9)} ${n(between(r, 240, 244))}`
  shrubs += 'L312 252L150 252Z'
  return (
    '<g transform="rotate(-2.4 222 238)">' +
    chimneys +
    rightWing +
    gable +
    windows +
    porch +
    foundation +
    turret(r, uid, ember) +
    '</g>' +
    `<path d="${shrubs}" fill="${TONE.manorHill}"/>`
  )
}

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

/** The winding path from the porch steps down to the gate, widening as it nears. */
function pathLayer(uid: string): string {
  const centre = smooth(
    [
      [221, 243],
      [207, 251],
      [227, 261],
      [190, 272],
      [172, 287],
      [168, 318],
      [158, 392],
    ],
    5,
  )
  const left: string[] = []
  const right: string[] = []
  const inner: string[] = []
  centre.forEach((p, i) => {
    const a = centre[Math.max(0, i - 1)] ?? p
    const b = centre[Math.min(centre.length - 1, i + 1)] ?? p
    const tx = b[0] - a[0]
    const ty = b[1] - a[1]
    const len = Math.hypot(tx, ty) || 1
    const t = i / (centre.length - 1)
    const w = 2.4 + 15 * t ** 1.5
    const nx = -ty / len
    const ny = tx / len
    left.push(`${n(p[0] + nx * w)} ${n(p[1] + ny * w)}`)
    right.push(`${n(p[0] - nx * w)} ${n(p[1] - ny * w)}`)
    inner.push(`${n(p[0] + nx * w * 0.25)} ${n(p[1] + ny * w * 0.25)}`)
  })
  return (
    `<path d="M${left.join('L')}L${right.reverse().join('L')}Z" fill="url(#${uid}-path)"/>` +
    `<path d="M${inner.join('L')}" fill="none" stroke="#2b2c34" stroke-width="1.6" opacity="0.6"/>`
  )
}

/** The near ground the fence stands on. */
const nearGround = `<path d="M${L} 290 Q40 282 150 288 Q260 294 ${R} 284 L${R} 440 L${L} 440 Z" fill="${TONE.near}"/>`

/** The crooked iron fence, the gate the path runs through, dead grass along the bottom. */
function frontLayer(r: () => number): string {
  let bars = ''
  let tips = ''
  for (let x = -96; x <= 436; x += 7) {
    if (x > 140 && x < 202) continue // the gate and its pillars
    const lean = between(r, -1.4, 1.4)
    const top = 276 + between(r, -1, 1.5)
    bars += `M${x} 304L${n(x + lean)} ${n(top)}`
    tips += `M${n(x + lean - 1.7)} ${n(top + 1)}L${n(x + lean)} ${n(top - 5)}L${n(x + lean + 1.7)} ${n(top + 1)}Z`
  }
  const fence =
    `<g stroke="${TONE.iron}" stroke-linecap="round" fill="none"><path d="M${L} 283.5L146 282M196 282L${R} 284.5M${L} 298L146 298M196 298L${R} 298.5" stroke-width="1.6"/><path d="${bars}" stroke-width="1.2"/></g>` +
    `<path d="${tips}" fill="${TONE.iron}"/>`
  // the gate: two stone pillars and a pair of arched iron leaves
  let gateBars = ''
  let gateTips = ''
  for (let x = 157; x <= 185; x += 4) {
    const top = 273 - 10 * (1 - ((x - 171) / 15) ** 2)
    gateBars += `M${x} 304V${n(top)}`
    gateTips += `M${n(x - 1.5)} ${n(top + 1)}L${x} ${n(top - 4.5)}L${n(x + 1.5)} ${n(top + 1)}Z`
  }
  const gate =
    `<g stroke="${TONE.iron}" fill="none" stroke-linecap="round"><path d="${gateBars}" stroke-width="1.2"/>` +
    '<path d="M155 274Q171 258 187 274M155 280H187M155 297H187M171 264V304" stroke-width="1.5"/>' +
    '<path d="M166 274a3 3 0 1 1 0.1 0M176 274a3 3 0 1 0 -0.1 0" stroke-width="0.9"/></g>' +
    `<path d="${gateTips}" fill="${TONE.iron}"/>` +
    '<g fill="#17181c"><rect x="145.5" y="266" width="9" height="42"/><rect x="187.5" y="266" width="9" height="42"/></g>' +
    '<g fill="#0f1013"><rect x="143.5" y="262" width="13" height="4.5"/><rect x="185.5" y="262" width="13" height="4.5"/><rect x="144.5" y="276" width="11" height="2"/><rect x="186.5" y="276" width="11" height="2"/>' +
    '<path d="M145 262L150 256.5L155 262ZM187 262L192 256.5L197 262Z"/><circle cx="150" cy="255" r="2.2"/><circle cx="192" cy="255" r="2.2"/></g>' +
    `<path d="M145.5 266V308M187.5 266V308" stroke="${TONE.rim}" stroke-width="0.8" opacity="0.6"/>`
  // dead grass along the bottom
  let grass = ''
  for (let i = 0; i < 44; i++) {
    const x = between(r, -90, 430)
    const base = between(r, 306, 330)
    grass += `M${n(x)} ${n(base)}l${n(between(r, -3, 3))} ${n(-between(r, 6, 14))}`
  }
  return fence + gate + `<path d="${grass}" stroke="#1b1c21" stroke-width="1"/>`
}

/** One bat per active subagent, flitting about the turret and the moon. */
function batLayer(sceneId: string, swarm: number): string {
  const area: Area = { x0: 62, y0: 98, x1: 300, y1: 140 }
  const flock = swarmSpots(sceneId, area, swarm)
    .map((spot, i) => {
      const k = spot.k
      const s = 0.6 + 0.4 * k
      const ax = (14 + 16 * ((k * 7.3) % 1)) * (i % 2 === 0 ? 1 : -1)
      const ay = 6 + 8 * ((k * 3.7) % 1)
      const path = `0 0;${n(ax)} ${n(-ay)};${n(ax * 1.4)} ${n(ay * 0.5)};${n(ax * 0.5)} ${n(ay)};${n(-ax * 0.3)} ${n(ay * 0.2)};0 0`
      const dur = 9 + 7 * ((k * 5.1) % 1)
      return bat({ x: spot.x, y: spot.y, s, color: TONE.bat, flap: 0.24 + 0.14 * k, begin: k * dur, path, dur })
    })
    .join('')
  return flock ? `<g stroke="#6c6e7a" stroke-opacity="0.55" stroke-width="0.6">${flock}</g>` : ''
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const ember = palette.accent2
  const moon = moonLayer(uid, palette.accent, context)
  const defs =
    moon.defs +
    linearY(`${uid}-wall`, 110, 244, [
      [0, '#1c1d23'],
      [1, '#121317'],
    ]) +
    radialBox(`${uid}-ember`, [
      [0, ember, 0.55],
      [0.45, ember, 0.18],
      [1, ember, 0],
    ]) +
    linearY(`${uid}-pane`, 179, 196, [
      [0, '#d97a62'],
      [0.6, ember],
      [1, '#9a3f36'],
    ]) +
    linearY(`${uid}-path`, 240, 350, [
      [0, '#26272e'],
      [0.45, '#202128'],
      [1, '#141519'],
    ]) +
    fogDefs(uid)

  // The framing trees take their randomness first, so their shapes hold when other layers change.
  const trees =
    bareTree(r, { x: 26, y: 288, h: 116, color: '#111216', lean: 0.14, width: 4 }) +
    bareTree(r, { x: 322, y: 298, h: 176, color: TONE.trim, lean: 0.3, width: 6.5 })
  const sky = skyLayer(r)
  const clouds = cloudLayer()
  const land = landLayer(r, uid)
  const manor = manorLayer(r, uid, ember)
  const path = pathLayer(uid)
  const frontMist = fog({ uid, y: 292, width: 560, color: '#4c4f5b', opacity: 0.14, dur: 44, begin: 7, x0: -140 })
  const front = frontLayer(r)
  const bats = batLayer(scene.id, swarm)
  const caption = gaugeCaption({ x: MX - MR - 10, y: MY - 3, name: scene.gauge, value: contextText, palette, anchor: 'end' })

  return {
    defs,
    body: sky + moon.body + clouds + land + manor + nearGround + path + trees + frontMist + front + bats + caption,
  }
}
