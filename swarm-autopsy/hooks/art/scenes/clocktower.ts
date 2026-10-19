// Clocktower at Midnight: old-town rooftops in a light drizzle, slate roofs and chimneys in
// layers fading into the haze, a few attic windows still lit, and over them a gothic clock
// tower with a verdigris spire. The clock face is the main context gauge: its glass lights up
// clockwise from twelve as the context window fills, and its glow grows. Each active
// subagent is a raven, perched on a ridge, a chimney or a gargoyle, or circling the spire.

import type { Painted, PaintArgs } from '../scene.ts'
import { BLEED, SCENE_W, between, blur, crow, drift, flicker, flyer, fog, fogDefs, gaugeCaption, linearY, loop, n, radialBox, spin, stars, swarmSpots } from '../kit.ts'

const L = -BLEED
const R = SCENE_W + BLEED
/** Where every roof's walls end, well below the fade. */
const BOTTOM = 420

/** The tower's centre line, and the clock: centre, glass, bezel and stone frame radii. */
const TX = 212
const CY = 178
const GLASS = 22
const BEZEL = 27
const FRAME = 30

/** Rain falls through this band; a mask fades it in under the title and out at the bottom. */
const RAIN_TOP = 84
const RAIN_FALL = 230
const SLANT = -0.12

const RAVEN = '#0c0d0f'
const STONE = '#1f2126'
const STONE_LIT = '#2b2e34'
const STONE_SHADE = '#16171a'
const TRIM = '#2e3137'
const COPPER = '#4b7668'
const COPPER_SHADE = '#2d4741'
const BRASS = '#c8b98d'

/** A number at one decimal: the rain is drawn in many small steps. */
const d1 = (value: number): string => String(Math.round(value * 10) / 10)

type House = { x: number; w: number; eave: number; rise: number; kind: 'gable' | 'ridge'; chimney?: number; lit?: boolean }
type Perch = { x: number; y: number; s: number }

const inset = (h: House): number => Math.min(h.rise * 0.9, h.w * 0.32)

/** The height of a house's roof line at x. */
function roofAt(h: House, x: number): number {
  if (h.kind === 'gable') {
    const half = h.w / 2
    return h.eave - h.rise * (1 - Math.abs(x - (h.x + half)) / half)
  }
  const i = inset(h)
  if (x < h.x + i) return h.eave - (h.rise * (x - h.x)) / i
  if (x > h.x + h.w - i) return h.eave - (h.rise * (h.x + h.w - x)) / i
  return h.eave - h.rise
}

/** Where a house's chimney stands: left edge, top, width. */
function chimneyOf(h: House): { x: number; top: number; w: number } | undefined {
  if (h.chimney === undefined) return undefined
  const w = Math.max(3, Math.round(h.w * 0.09))
  const x = Math.round(h.x + h.w * h.chimney)
  return { x, top: Math.round(roofAt(h, x + w / 2) - Math.max(6, h.rise * 0.35) - 4), w }
}

/** One house as clockwise subpaths (walls and roof, then its chimney and cap). */
function houseOutline(h: House): string {
  const x = Math.round(h.x)
  const x2 = Math.round(h.x + h.w)
  const eave = Math.round(h.eave)
  const top = Math.round(h.eave - h.rise)
  let d =
    h.kind === 'gable'
      ? `M${x} ${BOTTOM}V${eave}L${Math.round(h.x + h.w / 2)} ${top}L${x2} ${eave}V${BOTTOM}Z`
      : `M${x} ${BOTTOM}V${eave}L${Math.round(h.x + inset(h))} ${top}H${Math.round(h.x + h.w - inset(h))}L${x2} ${eave}V${BOTTOM}Z`
  const c = chimneyOf(h)
  if (c) d += `M${c.x} ${eave}V${c.top}H${c.x + c.w}V${eave}ZM${c.x - 1} ${c.top + 1}V${c.top - 1}H${c.x + c.w + 1}V${c.top + 1}Z`
  return d
}

/** A row of houses from x0 to x1, eaves within `eave`, sized by `scale`; none inside `skip`. */
function street(r: () => number, x0: number, x1: number, eave: readonly [number, number], scale: number, skip?: readonly [number, number]): House[] {
  const out: House[] = []
  for (let x = x0; x < x1; ) {
    const w = between(r, 22, 46) * scale
    const gable = r() < 0.5
    const rise = gable ? w * between(r, 0.55, 0.95) : between(r, 9, 17) * scale
    const house: House = { x, w, eave: between(r, eave[0], eave[1]), rise, kind: gable ? 'gable' : 'ridge', chimney: r() < 0.45 ? between(r, 0.2, 0.75) : undefined, lit: r() < 0.3 }
    if (!skip || x + w < skip[0] || x > skip[1]) out.push(house)
    x += w + between(r, -6, 1) * scale
  }
  return out
}

/** Attic windows in the lit gables that stand inside the canvas, each with a soft halo. */
function atticWindows(r: () => number, houses: readonly House[], size: number, glowId: string, color: string): string {
  let out = ''
  for (const h of houses) {
    if (!h.lit || h.kind !== 'gable' || h.x < -10 || h.x + h.w > SCENE_W + 10) continue
    const x = h.x + h.w / 2 - size * 0.4
    const y = h.eave - h.rise * 0.42 - size * 0.5
    out +=
      `<circle cx="${n(x + size * 0.4)}" cy="${n(y + size * 0.5)}" r="${n(size * 1.8)}" fill="url(#${glowId})" opacity="0.6">${flicker(r, 0.4, 0.75)}</circle>` +
      `<rect x="${n(x)}" y="${n(y)}" width="${n(size * 0.8)}" height="${n(size)}" fill="${color}">${flicker(r, 0.7, 1)}</rect>`
  }
  return out
}

/** Smoke curling up from a chimney top: three soft puffs, staggered, drifting with the wind. */
function smoke(r: () => number, x: number, y: number, blurId: string): string {
  let out = ''
  const dur = between(r, 9, 13)
  for (let i = 0; i < 3; i++) {
    const begin = (dur * i) / 3 + between(r, 0, 1)
    out +=
      `<circle cx="${n(x)}" cy="${n(y)}" r="2" fill="#8a8f97" opacity="0">` +
      drift(`0 0;${n(between(r, 5, 9))} -16;${n(between(r, 14, 22))} -36`, dur, begin) +
      loop('opacity', '0;0.5;0.24;0', dur, begin) +
      loop('r', '2;5;8', dur, begin) +
      '</circle>'
  }
  return `<g filter="url(#${blurId})">${out}</g>`
}

/** A sheet of drizzle drawn twice, one fall apart, so it slides down and loops on one animation. */
function drizzle(r: () => number, args: { count: number; len: readonly [number, number]; width: number; opacity: number; dur: number }): string {
  let d = ''
  for (let i = 0; i < args.count; i++) {
    const x = between(r, L, R + 40)
    const y = between(r, RAIN_TOP, RAIN_TOP + RAIN_FALL)
    const len = Math.round(between(r, args.len[0], args.len[1]))
    const dx = Math.round(SLANT * len * 10) / 10
    d += `M${d1(x)} ${d1(y)}l${dx} ${len}m${d1(-SLANT * RAIN_FALL - dx)} ${-RAIN_FALL - len}l${dx} ${len}`
  }
  return (
    `<path d="${d}" stroke="#b4bcc6" stroke-width="${n(args.width)}" stroke-linecap="round" opacity="${n(args.opacity)}">` +
    drift(`0 0;${d1(SLANT * RAIN_FALL)} ${RAIN_FALL}`, args.dur, between(r, 0, args.dur)) +
    '</path>'
  )
}

/** The wedge of lit glass from twelve o'clock, clockwise, for a fill of 0–1. */
function wedge(fill: number): string {
  if (fill <= 0.002) return ''
  if (fill >= 0.998) return `M${TX} ${CY - GLASS}A${GLASS} ${GLASS} 0 1 1 ${TX} ${CY + GLASS}A${GLASS} ${GLASS} 0 1 1 ${TX} ${CY - GLASS}Z`
  const angle = fill * Math.PI * 2
  const ex = TX + GLASS * Math.sin(angle)
  const ey = CY - GLASS * Math.cos(angle)
  return `M${TX} ${CY}L${TX} ${CY - GLASS}A${GLASS} ${GLASS} 0 ${fill > 0.5 ? 1 : 0} 1 ${n(ex)} ${n(ey)}Z`
}

/** The clock: stone frame, bezel with hour ticks, glass lit by the context fill, two hands. */
function clockFace(uid: string, r: () => number, context: number | undefined, accent2: string): string {
  const fill = context ?? 0
  const lit = context !== undefined
  const glowR = 32 + fill * 52
  const glow = lit ? 0.18 + fill * 0.72 : 0
  let ticks = ''
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6
    const inner = i % 3 === 0 ? GLASS + 0.6 : GLASS + 1.8
    const s = Math.sin(a)
    const c = Math.cos(a)
    ticks += `<path d="M${n(TX + inner * s)} ${n(CY - inner * c)}L${n(TX + (BEZEL - 0.8) * s)} ${n(CY - (BEZEL - 0.8) * c)}" stroke-width="${i % 3 === 0 ? 1.8 : 1}"/>`
  }
  const angle = fill * Math.PI * 2
  const edge = lit && fill > 0.002 && fill < 0.998 ? `<path d="M${TX} ${CY}L${n(TX + GLASS * Math.sin(angle))} ${n(CY - GLASS * Math.cos(angle))}" stroke="#fff1c8" stroke-width="0.8" opacity="0.75"/>` : ''
  const hand = (len: number, width: number): string =>
    `<path d="M${n(TX - width)} ${CY + 3.5}L${n(TX - width * 0.5)} ${CY - len + 3}L${TX} ${CY - len}L${n(TX + width * 0.5)} ${CY - len + 3}L${n(TX + width)} ${CY + 3.5}Z" fill="#111215" stroke="#d6ccae" stroke-width="0.5" stroke-opacity="0.75"/>`
  return (
    (lit ? `<circle cx="${TX}" cy="${CY}" r="${n(glowR)}" fill="url(#${uid}-clockglow)" opacity="${n(glow)}">${loop('opacity', `${n(glow)};${n(glow * 0.78)};${n(glow)}`, 6, 2)}</circle>` : '') +
    `<circle cx="${TX}" cy="${CY}" r="${FRAME}" fill="${TRIM}" stroke="#3b3e45" stroke-width="0.8"/>` +
    `<circle cx="${TX}" cy="${CY}" r="${BEZEL}" fill="#0e0f11"/>` +
    `<g stroke="${BRASS}" opacity="0.8">${ticks}</g>` +
    `<circle cx="${TX}" cy="${CY}" r="${GLASS}" fill="url(#${uid}-glass)"/>` +
    (lit ? `<path d="${wedge(fill)}" fill="url(#${uid}-gold)">${flicker(r, 0.86, 1)}</path>${edge}` : '') +
    `<circle cx="${TX}" cy="${CY}" r="${GLASS}" fill="none" stroke="${accent2}" stroke-width="0.7" opacity="${lit ? n(0.25 + fill * 0.5) : '0.16'}"/>` +
    `<g transform="rotate(-9 ${TX} ${CY})">${hand(13, 1.5)}</g>` +
    `<g>${hand(19, 1.1)}${spin(TX, CY, 0, 360, 60, 50)}</g>` +
    `<circle cx="${TX}" cy="${CY}" r="1.8" fill="${BRASS}"/>`
  )
}

/** The tower: shaft with lancets, the clock stage, a pierced parapet, pinnacles and the spire. */
function tower(): string {
  const left = TX - 32
  const right = TX + 32
  // The spire: a lit face and a shaded face of weathered copper, seams and drips down it.
  const spire =
    `<path d="M${TX} 94L${TX - 17} 142H${TX}Z" fill="${COPPER}"/>` +
    `<path d="M${TX} 94L${TX + 17} 142H${TX}Z" fill="${COPPER_SHADE}"/>` +
    `<path d="M${TX} 96L${TX - 6} 142M${TX} 96L${TX - 12} 142M${TX} 96L${TX + 6} 142M${TX} 96L${TX + 12} 142" stroke="#7fbca6" stroke-width="0.4" opacity="0.3"/>` +
    `<path d="M${TX - 9} 120v7M${TX - 4} 126v9M${TX + 5} 122v8M${TX + 10} 128v6" stroke="#1f302c" stroke-width="0.8" opacity="0.7"/>` +
    `<path d="M${TX - 4} 124V117L${TX} 112L${TX + 4} 117V124Z" fill="${COPPER_SHADE}"/><rect x="${TX - 1.5}" y="117" width="3" height="5" fill="#0d0e10"/>` +
    `<path d="M${TX} 94V86M${TX - 2.4} 88.6H${TX + 2.4}" stroke="#3a3d43" stroke-width="1"/><circle cx="${TX}" cy="91.6" r="1.3" fill="#3a3d43"/>`
  // Pinnacles at the stage's corners, capped in copper.
  const pinnacle = (x: number): string =>
    `<rect x="${x - 4}" y="124" width="8" height="22" fill="${STONE}"/><rect x="${x + 1}" y="124" width="3" height="22" fill="${STONE_SHADE}"/>` +
    `<path d="M${x - 5} 125L${x} 106L${x + 5} 125Z" fill="${COPPER_SHADE}"/><path d="M${x - 5} 125L${x} 106V125Z" fill="${COPPER}"/>`
  // The parapet, pierced with small pointed openings, and a gablet over the clock.
  let slits = ''
  for (let x = left + 7; x < right - 6; x += 7) if (Math.abs(x + 1.5 - TX) > 12) slits += `M${x} 145V140.5Q${x + 1.5} 138.6 ${x + 3} 140.5V145Z`
  const parapet =
    `<rect x="${left + 2}" y="136" width="${right - left - 4}" height="10" fill="${STONE}"/>` +
    `<path d="M${left + 2} 136H${right - 2}" stroke="${TRIM}" stroke-width="1.6"/>` +
    `<path d="${slits}" fill="#0f1012"/>` +
    `<path d="M${TX - 21} 147L${TX} 125L${TX + 21} 147Z" fill="${STONE}"/>` +
    `<path d="M${TX - 21} 147L${TX} 125L${TX + 21} 147" fill="none" stroke="${TRIM}" stroke-width="1.4"/>` +
    `<circle cx="${TX}" cy="137.5" r="2.6" fill="#0f1012"/>`
  // The clock stage and the shaft below it, buttressed, with two dark lancets.
  const body =
    `<rect x="${TX - 25}" y="206" width="50" height="${BOTTOM - 206}" fill="${STONE}"/>` +
    `<rect x="${TX - 25}" y="206" width="4" height="${BOTTOM - 206}" fill="${STONE_LIT}"/>` +
    `<rect x="${TX + 19}" y="206" width="6" height="${BOTTOM - 206}" fill="${STONE_SHADE}"/>` +
    `<path d="M${TX - 28} ${BOTTOM}V226L${TX - 23} 218V${BOTTOM}ZM${TX + 23} ${BOTTOM}V218L${TX + 28} 226V${BOTTOM}Z" fill="${STONE_SHADE}"/>` +
    `<path d="M${TX - 12} 250V230Q${TX - 9} 222 ${TX - 6} 230V250ZM${TX + 6} 250V230Q${TX + 9} 222 ${TX + 12} 230V250Z" fill="#0d0e10"/>` +
    `<path d="M${TX - 12} 230Q${TX - 9} 222 ${TX - 6} 230M${TX + 6} 230Q${TX + 9} 222 ${TX + 12} 230" fill="none" stroke="${TRIM}" stroke-width="1"/>` +
    `<path d="M${TX - 21} 216H${TX + 19}M${TX - 21} 236H${TX - 14}M${TX - 4} 236H${TX + 4}M${TX + 14} 236H${TX + 19}M${TX - 21} 256H${TX + 19}" stroke="${STONE_SHADE}" stroke-width="0.6" opacity="0.8"/>` +
    `<rect x="${left}" y="146" width="${right - left}" height="62" fill="${STONE}"/>` +
    `<rect x="${left}" y="146" width="4" height="62" fill="${STONE_LIT}"/>` +
    `<rect x="${right - 6}" y="146" width="6" height="62" fill="${STONE_SHADE}"/>` +
    `<rect x="${left - 3}" y="206" width="${right - left + 6}" height="5" fill="${TRIM}"/>`
  // Gargoyles at the stage's lower corners: a raven's favourite ledge.
  const gargoyles =
    `<path d="M${left} 203L${left - 8} 199.5L${left - 13} 200.5L${left - 11} 203L${left - 8} 204.5L${left} 209Z" fill="${STONE_SHADE}"/>` +
    `<path d="M${right} 203L${right + 8} 199.5L${right + 13} 200.5L${right + 11} 203L${right + 8} 204.5L${right} 209Z" fill="${STONE_SHADE}"/>`
  return spire + body + parapet + pinnacle(left + 3) + pinnacle(right - 3) + gargoyles
}

// The near street, drawn by hand across the canvas so its ridges frame the tower and hold the ravens.
const NEAR: readonly House[] = [
  { x: -44, w: 60, eave: 252, rise: 40, kind: 'gable', chimney: 0.76 },
  { x: 12, w: 62, eave: 264, rise: 18, kind: 'ridge', chimney: 0.8 },
  { x: 70, w: 34, eave: 258, rise: 28, kind: 'gable', lit: true },
  { x: 100, w: 52, eave: 272, rise: 16, kind: 'ridge' },
  { x: 148, w: 30, eave: 268, rise: 26, kind: 'gable', lit: true },
  { x: 174, w: 76, eave: 284, rise: 14, kind: 'ridge', chimney: 0.72 },
  { x: 246, w: 38, eave: 262, rise: 30, kind: 'gable', lit: true, chimney: 0.18 },
  { x: 280, w: 52, eave: 260, rise: 18, kind: 'ridge', chimney: 0.3 },
  { x: 326, w: 56, eave: 250, rise: 42, kind: 'gable', chimney: 0.16 },
]

/** Lower windows still lit on the near street, each with a mullion. */
const WALL_WINDOWS: readonly (readonly [number, number])[] = [
  [28, 276],
  [120, 284],
  [298, 272],
]

function wallWindows(r: () => number, glowId: string, color: string): string {
  return WALL_WINDOWS.map(
    ([x, y]) =>
      `<circle cx="${x + 2.5}" cy="${y + 3}" r="9" fill="url(#${glowId})" opacity="0.5">${flicker(r, 0.35, 0.6)}</circle>` +
      `<rect x="${x}" y="${y}" width="5" height="6" fill="${color}" opacity="0.8">${flicker(r, 0.6, 0.9)}</rect>` +
      `<path d="M${x + 2.5} ${y}v6M${x} ${y + 3}h5" stroke="#101114" stroke-width="0.7"/>`,
  ).join('')
}

/** Where a raven can stand: ridges, gable peaks, chimney caps, and the tower's gargoyles. */
function perches(): Perch[] {
  const spots: Perch[] = [
    { x: TX - 32 - 11, y: 200, s: 0.72 },
    { x: TX + 32 + 11, y: 200, s: 0.72 },
  ]
  for (const h of NEAR) {
    const top = h.eave - h.rise
    if (h.kind === 'gable') spots.push({ x: h.x + h.w / 2, y: top + 0.5, s: 0.85 })
    else spots.push({ x: h.x + h.w / 2 + (h.chimney !== undefined && h.chimney > 0.5 ? -6 : 6), y: top, s: 0.85 })
    const c = chimneyOf(h)
    if (c) spots.push({ x: c.x + c.w / 2, y: c.top - 1, s: 0.8 })
  }
  return spots.filter(p => p.x > 10 && p.x < SCENE_W - 10).sort((a, b) => a.x - b.x)
}

/** One raven per spot: each perches on the free ledge nearest its spot, or circles the spire. */
function ravens(id: string, swarm: number): string {
  const free = perches()
  return swarmSpots(id, { x0: 16, y0: 0, x1: SCENE_W - 16, y1: 1 }, swarm)
    .map((spot, i) => {
      if ((i >= 2 && spot.k > 0.8) || free.length === 0) {
        const s = 0.6 + spot.y * 0.15
        // Circling clear of the spire, where a dark wing would be lost on the copper.
        const x = Math.abs(spot.x - TX) < 46 ? TX + (spot.x < TX ? -46 : 46) : spot.x
        const path = `0 0;${n(10 + spot.y * 8)} -5;${n(22 + spot.y * 10)} 1;${n(10 + spot.y * 4)} 7;0 0`
        return flyer({ x, y: 102 + spot.y * 26, s, color: RAVEN, path, dur: 18 + spot.k * 8, begin: spot.k * 20 })
      }
      let best = 0
      for (let j = 1; j < free.length; j++) if (Math.abs((free[j]?.x ?? 0) - spot.x) < Math.abs((free[best]?.x ?? 0) - spot.x)) best = j
      const [perch] = free.splice(best, 1)
      if (!perch) return ''
      const flip = perch.x > TX ? i % 3 !== 0 : i % 3 === 0
      return crow({ x: perch.x, y: perch.y - 9 * perch.s, s: perch.s, color: RAVEN, flip, begin: spot.k * 5 })
    })
    .join('')
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const defs =
    radialBox(`${uid}-moon`, [
      [0, '#c9ced6', 0.22],
      [0.5, '#a9aeb6', 0.08],
      [1, '#a9aeb6', 0],
    ]) +
    radialBox(`${uid}-clockglow`, [
      [0, palette.accent2, 0.9],
      [0.38, palette.accent2, 0.42],
      [1, palette.accent2, 0],
    ]) +
    radialBox(`${uid}-gold`, [
      [0, '#fbe6ae', 0.95],
      [0.65, palette.accent2, 0.88],
      [1, '#c4953c', 0.85],
    ]) +
    radialBox(`${uid}-glass`, [
      [0, '#202328'],
      [1, '#131417'],
    ]) +
    radialBox(`${uid}-warm`, [
      [0, palette.accent2, 0.55],
      [1, palette.accent2, 0],
    ]) +
    linearY(`${uid}-rainfade`, RAIN_TOP, 320, [
      [0, '#ffffff', 0],
      [0.14, '#ffffff', 1],
      [0.85, '#ffffff', 1],
      [1, '#ffffff', 0],
    ]) +
    `<mask id="${uid}-rainmask" maskUnits="userSpaceOnUse" x="${L}" y="0" width="${R - L}" height="${BOTTOM}"><rect x="${L}" y="0" width="${R - L}" height="${BOTTOM}" fill="url(#${uid}-rainfade)"/></mask>` +
    blur(`${uid}-cloud`, 6) +
    blur(`${uid}-smoke`, 2) +
    fogDefs(uid)

  // ── Sky: a moon lost behind the overcast, a few stars in the gaps, low cloud drifting.
  const moon = `<circle cx="64" cy="122" r="54" fill="url(#${uid}-moon)"/>`
  const sky = `<g opacity="0.5">${stars(r, { x0: L, y0: 88, x1: R, y1: 176 }, 26, '#c9ccd2', [0.4, 1])}</g>`
  const bands: readonly (readonly [number, number, number, number, string, number, number, number])[] = [
    [40, 112, 150, 11, '#2d3138', 0.8, 26, 110],
    [300, 104, 170, 10, '#2a2e35', 0.7, -24, 130],
    [150, 150, 190, 9, '#30343b', 0.55, 20, 120],
    [-200, 126, 180, 12, '#2a2e35', 0.7, 22, 125],
    [540, 120, 170, 12, '#2a2e35', 0.7, -20, 115],
  ]
  const clouds =
    `<g filter="url(#${uid}-cloud)">` +
    bands.map(([x, y, rx, ry, color, opacity, distance, dur]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${color}" opacity="${opacity}">${drift(`0 0;${distance} 0;0 0`, dur, dur / 3)}</ellipse>`).join('') +
    '</g>'

  // ── Rooftops in layers, far and hazy to near and dark; a far steeple on the left.
  const far = street(r, L, R, [206, 220], 0.5)
  const steeple = 'M44 420V204L56 194L68 204V420ZM58 420V176H68V420ZM57 177L63 146L69 177Z'
  const farRoofs = `<path d="${far.map(houseOutline).join('')}${steeple}" fill="#292d34"/>` + atticWindows(r, far, 2.4, `${uid}-warm`, palette.accent2)
  const farFog = fog({ uid, y: 216, width: 1000, color: '#7c828a', opacity: 0.3, x0: -340, dur: 70, begin: 12 })
  const midFar = street(r, L, R, [222, 236], 0.7)
  const midFarRoofs = `<path d="${midFar.map(houseOutline).join('')}" fill="#212429"/>` + atticWindows(r, midFar, 3, `${uid}-warm`, palette.accent2)
  const mid = street(r, L, R, [238, 252], 0.92, [TX - 40, TX + 40])
  const midRoofs = `<path d="${mid.map(houseOutline).join('')}" fill="#191a1e"/>` + atticWindows(r, mid, 3.6, `${uid}-warm`, palette.accent2)
  const lowFog = fog({ uid, y: 252, width: 1000, color: '#8a9098', opacity: 0.24, x0: -300, dur: 55, begin: 30 })
  const near = [...street(r, L, -44, [246, 262], 1), ...NEAR, ...street(r, 382, R, [246, 262], 1)]
  const nearRoofs = `<path d="${near.map(houseOutline).join('')}" fill="#101114"/>` + atticWindows(r, near, 4.4, `${uid}-warm`, palette.accent2) + wallWindows(r, `${uid}-warm`, palette.accent2)
  const frontFog = fog({ uid, y: 294, width: 1000, color: '#9aa0a6', opacity: 0.14, x0: -260, dur: 45, begin: 5 })

  // ── Smoke from a few chimneys on the near street.
  const smokes = NEAR.map(chimneyOf)
    .filter((c, i) => c !== undefined && i % 2 === 1)
    .map(c => (c ? smoke(r, c.x + c.w / 2, c.top - 2, `${uid}-smoke`) : ''))
    .join('')

  // ── The drizzle, faded in under the title.
  const rain =
    `<g mask="url(#${uid}-rainmask)">` +
    drizzle(r, { count: 120, len: [5, 9], width: 0.5, opacity: 0.16, dur: 1.6 }) +
    drizzle(r, { count: 70, len: [8, 13], width: 0.7, opacity: 0.2, dur: 1.1 }) +
    '</g>'

  // ── The gauge: the clock face, and its caption to the left of the tower.
  const clock = clockFace(uid, r, context, palette.accent2)
  const caption = gaugeCaption({ x: TX - FRAME - 14, y: CY - 10, name: scene.gauge, value: contextText, palette, anchor: 'end' })

  return {
    defs,
    body: moon + sky + clouds + farRoofs + farFog + midFarRoofs + tower() + clock + midRoofs + lowFog + smokes + nearRoofs + ravens(scene.id, swarm) + rain + frontFog + caption,
  }
}
