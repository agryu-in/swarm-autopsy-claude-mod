// Rainy Cat Café: dusk, from inside a small café, looking out through its wide arched window at a
// rainy street. Beyond the steamed-up glass the shops and flats across the way are soft with rain:
// their lit windows, shop fronts and a street lamp melt into slow-pulsing bokeh over a wet road,
// rain slants past and now and then a drop slides down a pane. Inside, a copper pendant lamp hangs
// before the window and pools honey light on the window counter, where a cat sleeps curled between
// a trailing plant, a stack of books and a sprig of lavender, its tail hanging over the edge and
// swishing; fairy lights droop along the arch. A wide pane shows the rest of the café: a chalkboard,
// a cake under its dome and open shelves to the left; cups, a second window, coat pegs and a picture
// to the right; a shelf of jars above the window and a plank ceiling over it all.
// The context gauge is a glass latte on the counter: it fills from empty to the brim as the context
// window fills, its foam rising and its steam curling up (an empty, dim glass while unmeasured).
// Each active subagent is a passer-by under an umbrella, strolling the far pavement behind the rain.
//
// Past the 800-line soft ceiling on purpose: one painting, kept whole, so the drawing reads top to bottom like the
// scene (no other module needs any of its pieces).

import type { Painted, PaintArgs } from '../scene.ts'
import { BLEED, SCENE_W, between, clamp, drift, gaugeCaption, linearBox, linearX, linearY, loop, n, radialBox, rainfall, swarmSpots, sway } from '../kit.ts'

const L = -BLEED
const R = SCENE_W + BLEED
const TOP = -400
const FOOT = 460
/** The wall meets the plank ceiling here. */
const CROWN = -62
/** The window counter: its back edge against the glass, its lit front lip, the foot of its front face. */
const SILL = 248
const EDGE = 257
const FRONT = 264

type Win = { x0: number; x1: number; spring: number; apex: number; transom: number; mullions: readonly number[] }
const MAIN: Win = { x0: 48, x1: 292, spring: 120, apex: 98, transom: 146, mullions: [129.33, 210.67] }
const SIDE: Win = { x0: 404, x1: 476, spring: 136, apex: 118, transom: 158, mullions: [440] }
const WINDOWS = [MAIN, SIDE] as const

/** The main pendant lamp: its centre line, where its cord meets the ceiling, the rim of its shade, its size. */
const LAMP_X = 236
const LAMP_TOP = -150
const LAMP_RIM = 118
const LAMP_S = 1.3

const CAT = '#2a1d1b'
const WOOD = '#4b3326'
const WOOD_LIT = '#7a5236'
const FACADES = ['#453d59', '#4a415f', '#413954', '#4e4461'] as const
const AWNINGS = ['#6a4a56', '#4d5c68', '#715c48', '#5b4b68'] as const
const CERAMIC = ['#d9c8b0', '#8f9f80', '#b07250', '#6f8794', '#c99aa5', '#d6b98a'] as const
const SPINES = ['#8c5a5c', '#a8823f', '#4f6b66', '#b9a68c', '#6b4f6a', '#5f7258', '#9a6a4a'] as const
const JAR_FILL = ['#3b2418', '#b98a52', '#e3dacd', '#6b5a3a', '#9c4f3f'] as const
/** Muted pastel canopies that sit in the violet dusk: rose, sage, butter, lilac, rain blue, peach, mauve, teal, oat. */
const CANOPIES = ['#c99aa5', '#9fb5a0', '#d6bf8e', '#a99cc4', '#8fb8c9', '#d4a08a', '#b591ab', '#86aaa6', '#cdbfa8'] as const

const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length] as T
const add = (groups: Map<string, string>, key: string, d: string): void => {
  groups.set(key, (groups.get(key) ?? '') + d)
}
const fills = (groups: Map<string, string>): string => [...groups].map(([color, d]) => `<path d="${d}" fill="${color}"/>`).join('')

/** One decimal: for the many small shapes (leaves, jars, windows, beads), where short numbers keep the drawing small. */
const d1 = (v: number): string => String(Math.round(v * 10) / 10)

// ── Geometry ────────────────────────────────────────────────────────────────────────────

/** The top of a window's arch at x. */
function archY(w: Win, x: number): number {
  const rx = (w.x1 - w.x0) / 2
  const u = clamp((x - (w.x0 + w.x1) / 2) / rx, -1, 1)
  return w.spring - (w.spring - w.apex) * Math.sqrt(1 - u * u)
}

/** A window's opening (or, grown, its casing's outer edge). */
function opening(w: Win, grow = 0): string {
  const rx = (w.x1 - w.x0) / 2 + grow
  const ry = w.spring - w.apex + grow
  return `M${n(w.x0 - grow)} ${SILL}V${w.spring}A${n(rx)} ${n(ry)} 0 0 1 ${n(w.x1 + grow)} ${w.spring}V${SILL}Z`
}

/** A leaf from its base (x, y) toward `deg` (0 up, clockwise), `len` long and `wid` wide, as an absolute path. */
function leaf(x: number, y: number, deg: number, len: number, wid: number): string {
  const a = (deg * Math.PI) / 180
  const ux = Math.sin(a)
  const uy = -Math.cos(a)
  const mx = x + ux * len * 0.42
  const my = y + uy * len * 0.42
  return `M${d1(x)} ${d1(y)}Q${d1(mx + uy * wid)} ${d1(my - ux * wid)} ${d1(x + ux * len)} ${d1(y + uy * len)}Q${d1(mx - uy * wid)} ${d1(my + ux * wid)} ${d1(x)} ${d1(y)}Z`
}

const LEAF_DARK = '#46553a'
const LEAF_MID = '#5d6d45'
const LEAF_LIT = '#7d8d5c'

/** Leaves as [x, y, deg, len, wid], shaded by which way they face (the lamp is to the right). */
function foliage(list: readonly (readonly number[])[]): string {
  const groups = new Map<string, string>()
  for (const [x = 0, y = 0, deg = 0, len = 0, wid = 0] of list) {
    const tone = deg > 20 && deg < 160 ? LEAF_LIT : deg < -25 || deg > 200 ? LEAF_DARK : LEAF_MID
    add(groups, tone, leaf(x, y, deg, len, wid))
  }
  return fills(groups)
}

// ── The room: plank ceiling, plaster wall with its windows cut out, wainscot ─────────────

function room(uid: string): string {
  let planks = ''
  for (let y = CROWN - 7, gap = 7; y > TOP; gap *= 1.3, y -= gap) planks += `M${L} ${n(y)}H${R}`
  let boards = ''
  for (let x = L + 8; x < R; x += 15) boards += `M${x} ${FRONT + 4}V${FOOT}`
  const holes = WINDOWS.map(w => opening(w)).join('')
  return (
    `<rect x="${L}" y="${TOP}" width="${R - L}" height="${CROWN - TOP}" fill="#1f1718"/>` +
    `<path d="${planks}" stroke="#2c211e" stroke-width="1.4"/>` +
    `<path d="M${L} ${CROWN}H${R}V${FOOT}H${L}Z${holes}" fill="url(#${uid}-wall)" fill-rule="evenodd"/>` +
    `<path d="M${L} ${CROWN}H${R}V${SILL}H${L}Z${holes}" fill="url(#${uid}-paper)" fill-rule="evenodd"/>` +
    `<rect x="${L}" y="${CROWN - 2}" width="${R - L}" height="7" fill="#3a2a22"/>` +
    `<path d="M${L} ${CROWN + 5.5}H${R}" stroke="#14100f" stroke-width="1.5" opacity="0.6"/>` +
    `<rect x="${L}" y="${FRONT}" width="${R - L}" height="${FOOT - FRONT}" fill="#221815"/>` +
    `<path d="${boards}" stroke="#1a1210" stroke-width="1"/>`
  )
}

// ── Outside: the street across the way, soft with rain ───────────────────────────────────

type Light = { x: number; y: number; s: number; c: number }

/** The far side of the street between x0 and x1: facades, windows, shop fronts, a lamp post, the wet road, and the lights. */
function street(uid: string, r: () => number, x0: number, x1: number, pulses: number, post?: number): { far: string; lights: string } {
  const facades = new Map<string, string>()
  const awnings = new Map<string, string>()
  let warm = ''
  let cool = ''
  let ledges = ''
  let shopW = ''
  let shopC = ''
  let bars = ''
  const lights: Light[] = []
  const smears: Array<[number, number, number]> = []
  let x = x0 - between(r, 6, 22)
  while (x < x1) {
    const w = between(r, 34, 56)
    const roof = between(r, 112, 134)
    const shape = r()
    let d = `M${d1(x)} 226V${d1(roof)}`
    if (shape < 0.3) d += `L${d1(x + w / 2)} ${d1(roof - between(r, 7, 12))}`
    else if (shape < 0.55) d += `L${d1(x + 4)} ${d1(roof - 7)}H${d1(x + w - 4)}`
    d += `L${d1(x + w)} ${d1(roof)}V226Z`
    if (r() < 0.45) d += `M${d1(x + between(r, 5, w - 10))} ${d1(roof + 1)}v-11h4.5v11Z`
    add(facades, pick(r, FACADES), d)
    ledges += `M${d1(x)} ${d1(roof + 3)}h${d1(w)}M${d1(x)} 188h${d1(w)}`
    const cols = Math.max(2, Math.floor((w - 8) / 10))
    const step = (w - 8) / cols
    for (let y = roof + 9; y < 180; y += 12.5)
      for (let c = 0; c < cols; c++) {
        const wx = x + 4 + c * step + (step - 4.4) / 2
        const rect = `M${d1(wx)} ${d1(y)}h4.4v6.6h-4.4Z`
        const roll = r()
        if (roll < 0.2) {
          warm += rect
          if (r() < 0.3) lights.push({ x: wx + 2.2, y: y + 3.3, s: between(r, 4.5, 7.5), c: pick(r, [0, 0, 1]) })
        } else if (roll < 0.26) cool += rect
      }
    const a = x + 3.5
    const b = x + w - 3.5
    const isCool = r() < 0.28
    const shop = `M${d1(a)} 199H${d1(b)}V222H${d1(a)}Z`
    if (isCool) shopC += shop
    else shopW += shop
    bars += `M${d1((a + b) / 2)} 199V222M${d1(a)} 206H${d1(b)}`
    add(awnings, pick(r, AWNINGS), `M${d1(a - 1.5)} 191H${d1(b + 1.5)}L${d1(b + 3)} 198H${d1(a - 3)}Z`)
    lights.push({ x: (a + b) / 2 + between(r, -6, 6), y: between(r, 204, 216), s: between(r, 7.5, 12), c: isCool ? 2 : pick(r, [0, 0, 1]) })
    smears.push([(a + b) / 2, (b - a) * 0.45, isCool ? 1 : 0])
    x += w + between(r, 0, 2)
  }
  let lamp = ''
  if (post !== undefined) {
    lamp =
      `<path d="M${n(post)} 226V160q0 -6 6 -6h3" fill="none" stroke="#28233a" stroke-width="2"/>` +
      `<path d="M${n(post + 7)} 152h6l-1.5 4h-3Z" fill="#28233a"/>`
    lights.push({ x: post + 10, y: 157, s: 17, c: 0 })
    smears.push([post + 10, 7, 0])
  }
  // A few unattached lights: a far sign, a car's tail lights, a lit attic.
  for (let i = 0; i < Math.round((x1 - x0) / 80); i++)
    lights.push({ x: between(r, x0, x1), y: between(r, 140, 222), s: between(r, 4, 9), c: pick(r, [1, 2, 3, 3]) })

  const far =
    fills(facades) +
    `<path d="${ledges}" stroke="#2e2840" stroke-width="1.6" opacity="0.6"/>` +
    `<path d="${warm}" fill="#f2c48a" opacity="0.5"/>` +
    `<path d="${cool}" fill="#a9c7d8" opacity="0.3"/>` +
    `<path d="${shopW}" fill="url(#${uid}-shopw)"/>` +
    (shopC ? `<path d="${shopC}" fill="url(#${uid}-shopc)"/>` : '') +
    `<path d="${bars}" stroke="#3a3048" stroke-width="1" opacity="0.6"/>` +
    fills(awnings) +
    lamp +
    `<rect x="${n(x0 - 10)}" y="224" width="${n(x1 - x0 + 20)}" height="6" fill="#463d55"/>` +
    `<rect x="${n(x0 - 10)}" y="230" width="${n(x1 - x0 + 20)}" height="${SILL - 230 + 2}" fill="url(#${uid}-road)"/>`

  // The wet road mirrors each lit shop in a long soft smear.
  const mirror = smears
    .map(([cx, half, c]) => `<rect x="${d1(cx - half / 2)}" y="231" width="${d1(half)}" height="${SILL - 231}" fill="url(#${uid}-rf${c})"/>`)
    .join('')
  // The lights, out of focus: soft discs, a few of them breathing slowly (at most `pulses`).
  let bokeh = ''
  let pulsing = 0
  lights.forEach((light, i) => {
    const o = between(r, 0.55, 0.9)
    const dur = between(r, 4.5, 8)
    const breathe = i % 3 === 1 && pulsing < pulses
    if (breathe) pulsing++
    const pulse = breathe ? loop('opacity', `${n(o)};${n(o * 0.4)};${n(o)}`, dur, between(r, 0, dur)) : ''
    bokeh += `<circle cx="${d1(light.x)}" cy="${d1(light.y)}" r="${d1(light.s)}" fill="url(#${uid}-bk${light.c})" opacity="${n(o)}">${pulse}</circle>`
  })
  return { far, lights: mirror + bokeh }
}

/** The passer-by and their umbrella, drawn once and placed per subagent; the canopy takes each placement's colour. */
function walkerDefs(uid: string): string {
  return (
    `<g id="${uid}-walker">` +
    '<path d="M-2.4 -7L-2.8 0M2.2 -7L2.8 0" stroke="#2b2637" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M-3.8 -20.5Q-5.2 -12 -5.4 -6.5L5.4 -6.5Q5.2 -12 3.8 -20.5Q0 -22.4 -3.8 -20.5Z" fill="#2e2839"/>' +
    '<circle cy="-23.6" r="2.9" fill="#2e2839"/><path d="M3.4 -19.6L1 -16.4" stroke="#2e2839" stroke-width="1.6" stroke-linecap="round"/>' +
    '</g>' +
    `<g id="${uid}-brolly">` +
    '<path d="M0.6 -16.6V-31" stroke="#241f2e" stroke-width="0.8"/>' +
    '<path d="M-12 -31Q-11.4 -41.6 0 -42.4Q11.4 -41.6 12 -31Q9 -33.2 6 -31Q3 -33.2 0 -31Q-3 -33.2 -6 -31Q-9 -33.2 -12 -31Z"/>' +
    '<path d="M0 -42.4L-6 -31.4M0 -42.4L6 -31.4M0 -42.4V-31" stroke="#3a3346" stroke-width="0.5" opacity="0.4" fill="none"/>' +
    '<path d="M-9.6 -35.6Q-7.6 -40.4 -1.6 -41.6" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" opacity="0.3" fill="none"/>' +
    '<path d="M0 -42.4V-44.8" stroke="#3a3346" stroke-width="0.9"/>' +
    '</g>'
  )
}

/** A passer-by under an umbrella on the far pavement, (x, y) at their feet, strolling one way and fading into the rain. */
function passerBy(uid: string, x: number, y: number, k: number, i: number): string {
  const s = 0.74 + k * 0.26
  const dir = k < 0.5 ? -1 : 1
  const dist = 14 + k * 16
  const dur = 30 + k * 18
  // Start every stroll partway in, so all are in view when the drawing appears.
  const begin = (0.2 + 0.6 * ((k * 7.31) % 1)) * dur
  const canopy = CANOPIES[i % CANOPIES.length] ?? CANOPIES[0]
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})"><g>` +
    drift(`${n((-dir * dist) / 2)} 0;${n((dir * dist) / 2)} 0`, dur, begin) +
    loop('opacity', '0;0.95;0.95;0', dur, begin, ' keyTimes="0;0.14;0.86;1"') +
    `<use href="#${uid}-walker"/><use href="#${uid}-brolly" fill="${canopy}" transform="rotate(${dir * 6} 0 -18)"/>` +
    '</g></g>'
  )
}

// ── The glass: mist low on the panes, beads of rain, drops sliding down ───────────────────

function glass(uid: string, r: () => number): string {
  let beads = ''
  let small = ''
  for (const w of WINDOWS) {
    const count = Math.round((w.x1 - w.x0) / 10)
    for (let i = 0; i < count; i++) {
      const x = between(r, w.x0 + 2, w.x1 - 2)
      const y = SILL - (SILL - w.apex - 10) * Math.pow(r(), 1.6)
      const rad = between(r, 0.45, 1.25)
      const dot = `M${d1(x - rad)} ${d1(y)}a${d1(rad)} ${d1(rad)} 0 1 0 ${d1(rad * 2)} 0a${d1(rad)} ${d1(rad)} 0 1 0 ${d1(-rad * 2)} 0`
      if (rad > 0.9) beads += dot
      else small += dot
    }
  }
  // Drops that let go below the transom, run, stall, run again, and vanish behind the counter.
  let trails = ''
  let drops = ''
  const lanes = [70, 104, 174, 266, 452]
  for (const lane of lanes) {
    const w = lane > 300 ? SIDE : MAIN
    const x = lane + between(r, -4, 4)
    const y0 = w.transom + 3
    const fall = SILL + 8 - y0
    const a = between(r, 0.12, 0.25) * fall
    const b = between(r, 0.45, 0.6) * fall
    const dur = between(r, 9, 15)
    trails += `M${n(x)} ${n(y0)}V${n(y0 + b + 4)}`
    drops +=
      `<g><ellipse cx="${d1(x)}" cy="${d1(y0)}" rx="1.15" ry="1.5" fill="#e4eef3" opacity="0.65"/>` +
      drift(`0 0;0 ${n(a)};0 ${n(a + 2)};0 ${n(b)};0 ${n(b + 3)};0 ${n(fall)}`, dur, between(r, 0, dur), ' keyTimes="0;0.25;0.42;0.6;0.74;1"') +
      '</g>'
  }
  const sheen = 'M78 248L136 96H152L94 248ZM196 248L246 96H254L204 248Z'
  return (
    `<g clip-path="url(#${uid}-glass)">` +
    WINDOWS.map(w => `<rect x="${w.x0}" y="${w.apex}" width="${w.x1 - w.x0}" height="${SILL - w.apex}" fill="url(#${uid}-damp)"/>`).join('') +
    `<path d="${sheen}" fill="#ffffff" opacity="0.035"/>` +
    `<path d="${trails}" stroke="#d6e3ea" stroke-width="0.7" opacity="0.14"/>` +
    `<path d="${beads}" fill="#dce8ee" opacity="0.38"/>` +
    `<path d="${small}" fill="#dce8ee" opacity="0.2"/>` +
    drops +
    '</g>'
  )
}

/** A window's wooden casing, mullions and transom. */
function casing(w: Win): string {
  let bars = `M${w.x0} ${w.transom}H${w.x1}V${w.transom + 4}H${w.x0}Z`
  let edges = `M${w.x0} ${w.transom + 4.4}H${w.x1}`
  for (const mx of w.mullions) {
    const top = archY(w, mx) - 3
    bars += `M${n(mx - 2)} ${n(top)}H${n(mx + 2)}V${SILL}H${n(mx - 2)}Z`
    edges += `M${n(mx - 1.6)} ${n(top + 3)}V${SILL}`
  }
  return (
    `<path d="${opening(w, 9)}${opening(w)}" fill="${WOOD}" fill-rule="evenodd"/>` +
    `<path d="${opening(w, 9)}" fill="none" stroke="#24180f" stroke-width="1.2" opacity="0.8"/>` +
    `<path d="${opening(w, 1)}" fill="none" stroke="${WOOD_LIT}" stroke-width="1.3"/>` +
    `<path d="${opening(w, 5)}" fill="none" stroke="#3a271c" stroke-width="0.8"/>` +
    `<path d="${bars}" fill="#45301f"/>` +
    `<path d="${edges}" stroke="${WOOD_LIT}" stroke-width="0.7" opacity="0.8"/>`
  )
}

// ── Lights inside: the pendant lamps and the fairy lights on the arch ─────────────────────

/** A copper pendant lamp: its cord from the ceiling, the shade, its lit underside and bulb; `s` scales it. */
function pendant(uid: string, cx: number, rim: number, s: number): string {
  const t = (x: number, y: number): string => `${n(cx + x * s)} ${n(rim + y * s)}`
  return (
    `<path d="M${n(cx - 6)} ${LAMP_TOP + 3}h12l-2.5 -5h-7Z" fill="#2a1d17"/>` +
    `<path d="M${n(cx)} ${LAMP_TOP}V${n(rim - 22 * s)}" stroke="#140e0f" stroke-width="${n(1.1 * s)}"/>` +
    `<rect x="${n(cx - 3 * s)}" y="${n(rim - 25 * s)}" width="${n(6 * s)}" height="${n(5 * s)}" fill="#2a1d17"/>` +
    `<path d="M${t(-4, -20)}C${t(-10, -18.5)} ${t(-16, -10)} ${t(-18.5, 0)}L${t(18.5, 0)}C${t(16, -10)} ${t(10, -18.5)} ${t(4, -20)}Z" fill="url(#${uid}-shade)"/>` +
    `<path d="M${t(5, -18.6)}C${t(10, -16)} ${t(14.6, -9)} ${t(16.6, -1.4)}" fill="none" stroke="#d89a62" stroke-width="${n(0.9 * s)}" opacity="0.55"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(rim)}" rx="${n(18.5 * s)}" ry="${n(3.2 * s)}" fill="#f6c785"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(rim + 0.4 * s)}" rx="${n(13.5 * s)}" ry="${n(2.2 * s)}" fill="#fff0cf"/>` +
    `<circle cx="${n(cx)}" cy="${n(rim + 1.8 * s)}" r="${n(3.4 * s)}" fill="#fffaf0"/>`
  )
}

/** The warm light a pendant throws: a wide glow on wall and glass, a halo round the bulb, a faint cone down. */
function lampLight(uid: string, cx: number, rim: number, s: number): string {
  return (
    `<path d="M${n(cx - 17 * s)} ${n(rim + 1)}L${n(cx + 17 * s)} ${n(rim + 1)}L${n(cx + 70 * s)} ${SILL}L${n(cx - 70 * s)} ${SILL}Z" fill="url(#${uid}-cone)"/>` +
    `<circle cx="${n(cx)}" cy="${n(rim + 8)}" r="${n(175 * s)}" fill="url(#${uid}-glow)"/>` +
    `<circle cx="${n(cx)}" cy="${n(rim + 1)}" r="${n(34 * s)}" fill="url(#${uid}-bulb)"/>`
  )
}

/** Fairy lights drooping from hooks along the main arch; a few twinkle. */
function fairyLights(uid: string, r: () => number): string {
  const hooks = [54, 112, 170, 228, 286].map(x => [x, archY(MAIN, x) + 4] as const)
  let wire = `M${hooks[0]?.[0]} ${n(hooks[0]?.[1] ?? 0)}`
  let bulbs = ''
  let cores = ''
  let index = 0
  for (let i = 0; i < hooks.length - 1; i++) {
    const [ax, ay] = hooks[i] ?? [0, 0]
    const [bx, by] = hooks[i + 1] ?? [0, 0]
    const cx = (ax + bx) / 2
    const cy = (ay + by) / 2 + 22
    wire += `Q${n(cx)} ${n(cy)} ${n(bx)} ${n(by)}`
    for (const t of [0.17, 0.39, 0.61, 0.83]) {
      const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx
      const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by + 1.6
      const rose = index % 5 === 2
      const twinkle = index % 3 === 1 ? loop('opacity', '1;0.3;0.85;1', between(r, 2.6, 4.6), between(r, 0, 4.6)) : ''
      bulbs += `<circle cx="${d1(x)}" cy="${d1(y)}" r="4.4" fill="url(#${uid}-${rose ? 'fairyr' : 'fairy'})">${twinkle}</circle>`
      cores += `M${d1(x - 1.15)} ${d1(y)}a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0 -2.3 0`
      index++
    }
  }
  return `<path d="${wire}" fill="none" stroke="#2a1e1a" stroke-width="0.6"/>` + bulbs + `<path d="${cores}" fill="#fff1d2"/>`
}

// ── Shelves, and what stands on them ──────────────────────────────────────────────────────

const GLASS = 'fill="#dfe6e8" fill-opacity="0.1" stroke="#e8dccb" stroke-opacity="0.35" stroke-width="0.6"'
const box = (x: number, y: number, w: number, h: number): string => `M${d1(x)} ${d1(y)}h${d1(w)}v${d1(h)}h${d1(-w)}Z`

/** One small thing on a shelf at x (its left edge), standing on `base`, painted into `ink` (style → path); returns its width. */
function shelfThing(r: () => number, x: number, base: number, ink: Map<string, string>): number {
  const kind = r()
  if (kind < 0.3) {
    // A glass jar: beans, biscuits, sugar or tea.
    const w = between(r, 8, 12)
    const h = between(r, 11, 17)
    add(ink, `fill="${pick(r, JAR_FILL)}" opacity="0.85"`, box(x, base - h * 0.62, w, h * 0.62))
    add(ink, GLASS, box(x, base - h, w, h))
    add(ink, 'fill="#7a5a40"', box(x - 0.6, base - h - 2.6, w + 1.2, 2.8))
    return w
  }
  if (kind < 0.55) {
    // A mug, its handle to the right.
    const s = between(r, 0.85, 1.1)
    const c = pick(r, CERAMIC)
    add(ink, `fill="${c}"`, `M${d1(x)} ${d1(base - 8.5 * s)}h${d1(8 * s)}v${d1(6.5 * s)}q0 ${d1(2 * s)} ${d1(-2 * s)} ${d1(2 * s)}h${d1(-4 * s)}q${d1(-2 * s)} 0 ${d1(-2 * s)} ${d1(-2 * s)}Z`)
    add(ink, `fill="none" stroke="${c}" stroke-width="1.1"`, `M${d1(x + 8 * s)} ${d1(base - 7 * s)}q${d1(3 * s)} 0 ${d1(3 * s)} ${d1(2.4 * s)}t${d1(-3 * s)} ${d1(2.4 * s)}`)
    add(ink, 'stroke="#000000" stroke-opacity="0.18" stroke-width="1.6"', `M${d1(x + 0.8)} ${d1(base - 8.5 * s)}v${d1(6 * s)}`)
    return 11 * s
  }
  if (kind < 0.8) {
    // A few books standing, the last one leaning on them.
    const count = 3 + Math.floor(r() * 3)
    let at = x
    for (let i = 0; i < count; i++) {
      const t = between(r, 2.6, 4)
      const h = between(r, 11, 17)
      const c = `fill="${pick(r, SPINES)}"`
      if (i === count - 1) {
        const lean = 0.24
        const dx = Math.sin(lean) * h
        const dy = Math.cos(lean) * h
        add(ink, c, `M${d1(at)} ${d1(base)}l${d1(t * Math.cos(lean))} ${d1(t * Math.sin(lean))}l${d1(dx)} ${d1(-dy)}l${d1(-t * Math.cos(lean))} ${d1(-t * Math.sin(lean))}Z`)
        at += dx + t
      } else {
        add(ink, c, box(at, base - h, t, h))
        add(ink, 'stroke="#e6d2a8" stroke-width="0.6" opacity="0.5"', `M${d1(at)} ${d1(base - h + 2.4)}h${d1(t)}`)
        at += t + 0.3
      }
    }
    return at - x
  }
  // A little potted plant.
  const s = between(r, 0.8, 1.05)
  const cx = x + 5 * s
  for (let i = 0; i < 5; i++) {
    const deg = -60 + i * 30 + between(r, -8, 8)
    add(ink, `fill="${deg > 20 ? LEAF_LIT : deg < -25 ? LEAF_DARK : LEAF_MID}"`, leaf(cx + between(r, -1.5, 1.5), base - 7 * s, deg, between(r, 6, 9) * s, 2.4 * s))
  }
  add(ink, 'fill="#9a5a3c"', `M${d1(x)} ${d1(base - 7 * s)}h${d1(10 * s)}l${d1(-1.2 * s)} ${d1(7 * s)}h${d1(-7.6 * s)}Z`)
  add(ink, 'fill="#ad6a47"', box(x - 0.6, base - 8 * s, 11.2 * s, 2 * s))
  return 10 * s
}

/** Wooden shelves, each [x0, x1, y] with its top at y, filled with small things; all painted in a few paths. */
function shelves(r: () => number, list: ReadonlyArray<readonly [number, number, number]>): string {
  const ink = new Map<string, string>()
  // The styles that must stack in this order are claimed first.
  for (const style of ['fill="#9c4f3f" opacity="0.85"', GLASS, 'fill="#7a5a40"']) ink.set(style, '')
  let boards = ''
  let lips = ''
  let shadows = ''
  let brackets = ''
  for (const [x0, x1, y] of list) {
    let x = x0 + between(r, 4, 10)
    while (x < x1 - 14) {
      const w = shelfThing(r, x, y, ink)
      x += w + between(r, 5, 12)
      if (x > x1 - 16) break
    }
    boards += box(x0, y, x1 - x0, 4.5)
    lips += `M${n(x0)} ${n(y + 0.5)}H${n(x1)}`
    shadows += box(x0, y + 4.5, x1 - x0, 4)
    brackets += `M${n(x0 + 8)} ${n(y + 4.5)}h5v3ZM${n(x1 - 13)} ${n(y + 4.5)}h5l-5 3Z`
  }
  let things = ''
  for (const [style, d] of ink) if (d) things += `<path d="${d}" ${style}/>`
  return (
    `<path d="${shadows}" fill="#000000" opacity="0.2"/>` +
    `<path d="${brackets}" fill="#2c1e17"/>` +
    things +
    `<path d="${boards}" fill="${WOOD}"/>` +
    `<path d="${lips}" stroke="${WOOD_LIT}" stroke-width="0.8"/>`
  )
}

// ── The wide café: the left wall (chalkboard, cake, shelves, a hanging plant), the right wall ──

function chalkboard(): string {
  const x0 = -178
  const y0 = 112
  const lines =
    // A wavy heading, menu lines with dotted leaders and prices, a doodled cup with steam, a cat face, hearts.
    `M${x0 + 26} 128q5 -4 10 0t10 0t10 0t10 0t10 0` +
    `M${x0 + 14} 143h30M${x0 + 14} 153h24M${x0 + 14} 163h34M${x0 + 14} 173h20` +
    `M${x0 + 80} 143h8M${x0 + 82} 153h6M${x0 + 80} 163h8M${x0 + 82} 173h6` +
    `M${x0 + 64} 184h18v8q0 6 -6 6h-6q-6 0 -6 -6ZM${x0 + 82} 187q5 0 5 3.5t-5 3.5` +
    `M${x0 + 69} 181q-2 -3 0 -5t0 -5M${x0 + 75} 181q-2 -3 0 -5t0 -5` +
    `M${x0 + 16} 194a7 6 0 1 0 14 0a7 6 0 1 0 -14 0M${x0 + 17} 190l1 -6l4 3M${x0 + 29} 190l-1 -6l-4 3`
  const dots = `M${x0 + 48} 143h28M${x0 + 42} 153h36M${x0 + 52} 163h24M${x0 + 38} 173h40`
  return (
    `<rect x="${x0 - 5}" y="${y0 - 5}" width="114" height="104" rx="2" fill="#4a3125"/>` +
    `<rect x="${x0}" y="${y0}" width="104" height="94" fill="#26282a"/>` +
    `<ellipse cx="${x0 + 40}" cy="${y0 + 40}" rx="40" ry="26" fill="#3a3c3d" opacity="0.35"/>` +
    `<path d="${lines}" fill="none" stroke="#e9e2d6" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>` +
    `<path d="${dots}" fill="none" stroke="#e9e2d6" stroke-width="0.8" stroke-dasharray="0.8 2.4" opacity="0.45"/>` +
    `<path d="M${x0 + 97} 128l1.5 -1.5q1.5 -1.5 3 0l-4.5 4.5l-4.5 -4.5q1.5 -1.5 3 0Z" fill="#e8a39a" opacity="0.7"/>` +
    `<rect x="${x0 + 30}" y="${y0 + 94}" width="40" height="3" fill="#5a3b2b"/>` +
    `<rect x="${x0 + 40}" y="${y0 + 92}" width="7" height="2" rx="0.6" fill="#ece6dc"/>`
  )
}

/** A cake on its stand under a glass dome, and a jar of biscuits, on the counter by the chalkboard. */
function cakeStand(): string {
  const cx = -150
  return (
    `<ellipse cx="${cx}" cy="253" rx="13" ry="2.4" fill="#000000" opacity="0.25"/>` +
    `<path d="M${cx - 4} 252h8l-2 -8h-4Z" fill="#cdbfae"/>` +
    `<ellipse cx="${cx}" cy="243.5" rx="17" ry="2.6" fill="#e2d6c4"/>` +
    `<path d="M${cx - 12} 242v-10q6 -2.4 12 0v10ZM${cx + 1} 242v-10l11 1.6v8.4Z" fill="#f0e2cc"/>` +
    `<path d="M${cx - 12} 238h24M${cx - 12} 235.2h24" stroke="#c98d8a" stroke-width="1.4"/>` +
    `<path d="M${cx - 12} 232q6 -2.4 12 0l11 1.6" fill="none" stroke="#f7eee2" stroke-width="1.6"/>` +
    `<circle cx="${cx - 5}" cy="230.2" r="1.5" fill="#b8434a"/>` +
    `<path d="M${cx - 18} 243.4V228q0 -16 18 -16t18 16v15.4" fill="#ffffff" fill-opacity="0.05" stroke="#e6eef0" stroke-opacity="0.38" stroke-width="0.8"/>` +
    `<path d="M${cx - 13} 236V229q0 -10 9 -12" fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="1.2" stroke-linecap="round"/>` +
    `<circle cx="${cx}" cy="210.6" r="2" fill="#cdbfae"/>` +
    // The biscuit jar.
    `<rect x="-106" y="230" width="20" height="23" rx="3" fill="#dfe6e8" fill-opacity="0.1" stroke="#e8dccb" stroke-opacity="0.38" stroke-width="0.7"/>` +
    `<path d="M-104 252a4 4 0 0 1 8 0ZM-96 252a4 4 0 0 1 8 0ZM-101 246.5a4 4 0 0 1 8 0ZM-103.5 241a4 4 0 0 1 8 0Z" fill="#b98a52"/>` +
    `<rect x="-107.5" y="226.4" width="23" height="4" rx="1.2" fill="#7a5a40"/><circle cx="-96" cy="225" r="1.8" fill="#7a5a40"/>`
  )
}

/** A plant in a macramé hanger from the ceiling, its strands trailing; it turns a little on its cord. */
function hangingPlant(r: () => number, cx: number, potY: number): string {
  const trail: number[][] = []
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const y = potY + 12 + i * 9
      trail.push([cx + side * (11 + Math.sin(i * 1.3) * 2.5), y, side * (130 + between(r, 0, 50)), between(r, 6, 9), 2.6])
    }
  }
  const top: number[][] = [-55, -25, 5, 30, 55].map(deg => [cx + deg / 9, potY, deg, between(r, 9, 12), 3.4])
  return (
    '<g>' +
    `<path d="M${cx} ${CROWN}L${cx - 12} ${potY}M${cx} ${CROWN}L${cx + 12} ${potY}M${cx} ${CROWN}V${potY}" stroke="#8a7660" stroke-width="0.6" opacity="0.8"/>` +
    `<path d="M${cx - 11} ${potY + 1}Q${cx - 14} ${potY + 40} ${cx - 10} ${potY + 62}M${cx + 11} ${potY + 1}Q${cx + 13} ${potY + 40} ${cx + 11} ${potY + 60}" stroke="#4a5a3a" stroke-width="0.7" fill="none"/>` +
    foliage(trail) +
    foliage(top) +
    `<path d="M${cx - 13} ${potY}h26l-3 14h-20Z" fill="#cdb79a"/><path d="M${cx - 13} ${potY + 4}h26" stroke="#a8927a" stroke-width="1"/>` +
    sway(cx, CROWN, 1.4, 11, 3) +
    '</g>'
  )
}

/** Coat pegs with a coat, a furled umbrella and a scarf; a small framed picture. */
function pegsAndPicture(): string {
  return (
    '<rect x="494" y="128" width="80" height="5" fill="#4b3326"/><path d="M494 128.5h80" stroke="#7a5236" stroke-width="0.8"/>' +
    '<circle cx="508" cy="135" r="1.8" fill="#2c1e17"/><circle cx="534" cy="135" r="1.8" fill="#2c1e17"/><circle cx="560" cy="135" r="1.8" fill="#2c1e17"/>' +
    '<path d="M501 137Q508 133 515 137L519.5 205Q508 209 496.5 205Z" fill="#5a4a3e"/><path d="M503 137l5 14l5 -14" fill="none" stroke="#3a2f27" stroke-width="1"/>' +
    '<path d="M531 141a3 3 0 1 1 6 0V146" fill="none" stroke="#2a1d17" stroke-width="1.4"/>' +
    '<path d="M537 146L541 152L538.6 214L536.6 220L534.6 214L532.6 152Z" fill="#6f8f8c"/><path d="M533.6 170l6.4 2" stroke="#4d6664" stroke-width="1.2"/>' +
    '<path d="M556 136h8v42l-2 3l-2 -3l-2 3l-2 -3ZM561 136h6v30l-2 2l-2 -2l-2 2Z" fill="#a5636a"/>' +
    '<rect x="588" y="108" width="46" height="54" fill="#5a3b2a"/><rect x="592" y="112" width="38" height="46" fill="#d9cab3"/>' +
    '<rect x="597" y="117" width="28" height="36" fill="#e8c9a0"/><circle cx="615" cy="130" r="5" fill="#e39a62"/>' +
    '<path d="M597 145Q605 136 613 142T625 139V153H597Z" fill="#7d8d64"/><path d="M597 149Q608 143 625 148V153H597Z" fill="#5d6d48"/>'
  )
}

// ── The counter, and what sits on it ──────────────────────────────────────────────────────

function counter(uid: string): string {
  return (
    `<rect x="${L}" y="${SILL}" width="${R - L}" height="${EDGE - SILL}" fill="url(#${uid}-top)"/>` +
    `<path d="M${L} ${SILL + 0.4}H${R}" stroke="#20150f" stroke-width="1" opacity="0.7"/>` +
    `<path d="M${L} 251.5H${R}M${L} 254.2H${R}" stroke="#3e2a1e" stroke-width="0.5" opacity="0.5" stroke-dasharray="40 9 70 6"/>` +
    `<rect x="${L}" y="${EDGE}" width="${R - L}" height="${FRONT - EDGE}" fill="#3a271d"/>` +
    `<path d="M${L} ${EDGE}H${R}" stroke="#9a6a45" stroke-width="0.8" opacity="0.75"/>` +
    `<rect x="${L}" y="${FRONT}" width="${R - L}" height="12" fill="url(#${uid}-under)"/>`
  )
}

/** The trailing plant in its clay pot at the left of the counter. */
function counterPlant(uid: string, r: () => number): string {
  const up: number[][] = [
    [64, 228, -48, 14, 5],
    [69, 222, -20, 16, 5.6],
    [75, 220, 10, 17, 6],
    [80, 226, 36, 15, 5.4],
    [60, 234, -72, 12, 4.6],
    [84, 232, 66, 13, 4.8],
    [72, 214, -4, 14, 5.2],
    [66, 217, -36, 12, 4.6],
    [78, 213, 24, 13, 5],
  ]
  let stems = ''
  for (const [x = 0, y = 0] of up) stems += `M72 238Q${n((72 + x) / 2)} ${n(y + 6)} ${x} ${y}`
  const right: number[][] = [
    [88, 241, 70, 7, 2.8],
    [93, 249, 140, 8, 3],
    [95.5, 261, 210, 8, 3],
    [96, 271, 150, 8, 3],
    [94, 282, 215, 7.5, 2.8],
    [93.6, 291, 145, 7.5, 2.8],
    [96, 300, 185, 7, 2.6],
  ]
  const left: number[][] = [
    [57, 241, 290, 7, 2.8],
    [52.6, 250, 230, 7.5, 2.8],
    [51.6, 261, 160, 7.5, 2.8],
    [52.6, 270, 215, 7, 2.6],
    [54, 277, 170, 6.5, 2.4],
  ]
  return (
    `<ellipse cx="72" cy="255" rx="14" ry="2" fill="#120c0b" opacity="0.45"/>` +
    `<path d="${stems}" fill="none" stroke="#4a5a3a" stroke-width="0.8"/>` +
    foliage(up) +
    '<g>' +
    '<path d="M83 239Q93 242 95 257Q97 270 94 282Q92 292 96 302M61 239Q53 243 52 257Q51 266 54 277" fill="none" stroke="#4a5a3a" stroke-width="0.8"/>' +
    foliage(right) +
    foliage(left) +
    sway(73, 257, 1.6, 9, between(r, 0, 9)) +
    '</g>' +
    `<path d="M61 240L83 240L80.5 255L63.5 255Z" fill="url(#${uid}-pot)"/>` +
    '<rect x="59" y="236" width="26" height="4.6" rx="0.8" fill="#b4704a"/><path d="M59.4 240.4h25.2" stroke="#5a3022" stroke-width="0.8" opacity="0.6"/>'
  )
}

/** The stack of books by the latte. */
function bookStack(): string {
  const books: Array<[number, number, number, number, string]> = [
    [95, 249.5, 32, 5.5, '#4f6b66'],
    [98.5, 244.5, 27, 5, '#8c5a5c'],
    [96.5, 240, 29, 4.5, '#a8823f'],
    [100.5, 236.5, 21, 3.5, '#b9a68c'],
  ]
  let svg = '<ellipse cx="111" cy="255.4" rx="18" ry="1.8" fill="#120c0b" opacity="0.45"/>'
  for (const [x, y, w, h, c] of books)
    svg +=
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.9" fill="${c}"/>` +
      `<path d="M${n(x + 3)} ${y}v${h}M${n(x + w - 3)} ${y}v${h}" stroke="#e8cf9a" stroke-width="0.6" opacity="0.55"/>` +
      `<path d="M${n(x + 0.5)} ${n(y + 0.4)}h${n(w - 1)}" stroke="#ffffff" stroke-width="0.5" opacity="0.18"/>`
  return svg
}

/** A bud vase of lavender at the right end of the counter. */
function lavender(): string {
  return (
    '<ellipse cx="281" cy="255.2" rx="6" ry="1.2" fill="#120c0b" opacity="0.45"/>' +
    '<path d="M281 238L278 222M281 238L282 219M281 238L285.5 224" stroke="#6f7a5a" stroke-width="0.6" fill="none"/>' +
    '<path d="M278 222l-.3 -1.6M277.6 219.8l-.3 -1.6M277.2 217.6l-.2 -1.4M282 219l.1 -1.6M282.1 216.8l.1 -1.6M282.2 214.6l.1 -1.4M285.5 224l.5 -1.5M286.1 221.9l.5 -1.5M286.6 219.8l.4 -1.3" stroke="#a596c4" stroke-width="1.7" stroke-linecap="round"/>' +
    '<path d="M277.6 255Q275.6 247 279.6 243.4V239.6h2.8V243.4Q286.4 247 284.4 255Z" fill="#cdb9a2"/>' +
    '<path d="M282.8 244.6Q285.2 248 283.6 254" stroke="#f2d6a8" stroke-width="0.8" fill="none" opacity="0.7"/>'
  )
}

/** The cat, asleep on the counter: curled, head on its paws, breathing slowly; an ear twitches now and then. */
function cat(uid: string): string {
  const tail =
    '<g>' +
    `<path d="M252 250C262 251 265.4 255 264.6 260C263.6 268 262.4 278 266.4 287C268.2 291.6 266.4 295.6 262.4 295.4" fill="none" stroke="${CAT}" stroke-width="4.4" stroke-linecap="round"/>` +
    '<path d="M266.6 262C265.8 270 265 278 268.6 286" fill="none" stroke="#f2b36b" stroke-width="0.7" opacity="0.3"/>' +
    sway(264.6, 258, 7, 6.5, 1.5) +
    '</g>'
  const nearEar =
    '<g>' +
    `<path d="M-25 -18.2L-20.4 -27.2L-16.4 -15.4Z" fill="url(#${uid}-cat)"/>` +
    '<path d="M-23.4 -17.8L-20.6 -23.8L-18.4 -16.4Z" fill="#4c312b"/>' +
    '<path d="M-20.4 -27.2L-16.4 -15.4" stroke="#f2b36b" stroke-width="0.8" opacity="0.55"/>' +
    '<animateTransform attributeName="transform" type="rotate" values="0 -20.6 -16.6;0 -20.6 -16.6;-16 -20.6 -16.6;2 -20.6 -16.6;0 -20.6 -16.6" keyTimes="0;0.86;0.9;0.94;1" dur="11s" begin="-3s" repeatCount="indefinite"/>' +
    '</g>'
  const body =
    `<path d="M-22 0C-27 -3 -27 -15 -17 -22C-8 -28.5 10 -29 21 -22C29 -16 32 -5 27 0Z" fill="url(#${uid}-cat)"/>` +
    '<path d="M-6 -27.2q2 5 0 9M2 -28.4q2 5.5 0 10M10 -27.6q2 5 0 9M17 -24.6q1.6 4 -.6 7.6" stroke="#3f2c26" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.8"/>' +
    '<path d="M6 -2.6C13 -3.6 19 -8.6 18.6 -15" stroke="#3d2a25" stroke-width="1" fill="none"/>' +
    '<path d="M-16 -22.6C-7 -28.9 10 -29.4 21 -22.4C25 -19.6 27.6 -16.4 29 -12.4" stroke="#f2b36b" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.55"/>' +
    `<path d="M-35.6 -12.4L-37.2 -24.4L-28.6 -17.6Z" fill="url(#${uid}-cat)"/>` +
    '<path d="M-35 -14.4L-36 -21.6L-30.6 -17.4Z" fill="#4c312b"/>' +
    `<ellipse cx="-27" cy="-9.4" rx="10.6" ry="8.8" fill="url(#${uid}-cat)"/>` +
    nearEar +
    '<path d="M-22 -16.6Q-18.2 -14 -16.8 -9.6" stroke="#f2b36b" stroke-width="0.9" fill="none" opacity="0.5"/>' +
    '<ellipse cx="-30" cy="-1.4" rx="6.4" ry="2.1" fill="#3a2823"/><ellipse cx="-20.6" cy="-1" rx="5" ry="1.8" fill="#35251f"/>' +
    '<path d="M-33.4 -9.2q1.6 1.4 3.4 0.1M-25.4 -9.6q1.6 1.4 3.4 0.1" stroke="#a07a5e" stroke-width="0.7" fill="none" stroke-linecap="round"/>' +
    '<path d="M-29.4 -6.4l.9 .8.9 -.8Z" fill="#8a5a4c"/>' +
    '<path d="M-33.6 -5.6l-7 -.9M-33.4 -4.6l-6.6 1M-24.4 -5.8l6.4 -1.2M-24.6 -4.8l6.4 .4" stroke="#d6b799" stroke-width="0.35" opacity="0.5"/>'
  return (
    tail +
    '<ellipse cx="236" cy="255.6" rx="36" ry="2.6" fill="#120c0b" opacity="0.5"/>' +
    '<g transform="translate(234 255)"><g>' +
    body +
    '<animateTransform attributeName="transform" type="scale" values="1 1;1.012 1.032;1 1" dur="4.6s" begin="-1.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>' +
    '</g></g>'
  )
}

/** Two bar stools pulled up to the window counter, nearest of all, mostly lost in the dark below. */
function stools(): string {
  let svg = ''
  for (const cx of [146, 214]) {
    svg +=
      `<path d="M${cx - 11} 294L${cx - 16} 380M${cx + 11} 294L${cx + 16} 380M${cx - 5} 294L${cx - 7} 370M${cx + 5} 294L${cx + 7} 370" stroke="#1d1412" stroke-width="2.4"/>` +
      `<ellipse cx="${cx}" cy="336" rx="14.5" ry="2.6" fill="none" stroke="#1d1412" stroke-width="1.8"/>` +
      `<path d="M${cx - 15} 289v3.6a15 3.6 0 0 0 30 0v-3.6Z" fill="#2c1e17"/>` +
      `<ellipse cx="${cx}" cy="289" rx="15" ry="3.6" fill="#4e3425"/>` +
      `<path d="M${cx - 13} 290.6a15 3.6 0 0 0 26 0" fill="none" stroke="#c08a58" stroke-width="0.7" opacity="0.45"/>`
  }
  return svg
}

// ── The gauge: a glass latte on its saucer ────────────────────────────────────────────────

const MUG_X = 154
const RIM = 211
const INNER_FLOOR = 251
const INNER_TOP = 212.6

/** The glass's inner half-width at height y (it tapers toward the foot). */
const innerHalf = (y: number): number => 12 - (2.5 * (y - RIM)) / 43 - 1.3

function latteDefs(uid: string, context: number | undefined): string {
  const c = context ?? 0
  const level = INNER_FLOOR - (INNER_FLOOR - INNER_TOP) * c
  const h = Math.max(1, INNER_FLOOR - level)
  const foam = Math.min(0.42, 4.6 / h)
  return linearY(`${uid}-latte`, level, INNER_FLOOR, [
    [0, '#fbf2e6'],
    [foam, '#f0dfc7'],
    [Math.min(0.99, foam + 0.08), '#d9b28a'],
    [Math.max(Math.min(0.995, foam + 0.1), 0.7), '#b8835a'],
    [1, '#7c4d31'],
  ])
}

function latte(uid: string, context: number | undefined): string {
  const measured = context !== undefined
  const c = context ?? 0
  const level = INNER_FLOOR - (INNER_FLOOR - INNER_TOP) * c
  const filled = measured && INNER_FLOOR - level > 0.6
  const hw = innerHalf(level)
  const fw = innerHalf(INNER_FLOOR)
  const liquid = filled
    ? `<path d="M${n(MUG_X - hw)} ${n(level)}L${n(MUG_X + hw)} ${n(level)}L${n(MUG_X + fw)} ${INNER_FLOOR - 1}Q${n(MUG_X + fw)} ${INNER_FLOOR} ${n(MUG_X + fw - 1.4)} ${INNER_FLOOR}H${n(MUG_X - fw + 1.4)}Q${n(MUG_X - fw)} ${INNER_FLOOR} ${n(MUG_X - fw)} ${INNER_FLOOR - 1}Z" fill="url(#${uid}-latte)"/>` +
      `<ellipse cx="${MUG_X}" cy="${n(level)}" rx="${n(hw)}" ry="${n(Math.min(1.6, hw * 0.14))}" fill="#fdf6ec"/>` +
      (INNER_FLOOR - level > 6 ? `<path d="M${n(MUG_X - 3.4)} ${n(level - 0.1)}q1.7 -1 3.4 0q1.7 -1 3.4 0q-1.7 1.3 -3.4 1.3q-1.7 0 -3.4 -1.3Z" fill="#c8956a" opacity="0.8"/>` : '')
    : ''
  // Steam only once the fill is known: three curls rising, drifting and fading, stronger the fuller the glass.
  const peak = 0.16 + 0.6 * c
  const steam = measured
    ? [0, 1, 2]
        .map(i => {
          const dur = 5.4 + i * 0.9
          const begin = i * 1.9
          const x = MUG_X - 4.5 + i * 4.5
          return (
            `<path d="M${n(x)} 208c-2.6 -3.4 2.6 -6 0 -9.4c-2.6 -3.4 2.6 -6 0 -9.4" fill="none" stroke="#fff5e8" stroke-width="1.6" stroke-linecap="round" opacity="0">` +
            drift(`0 2;${n(i === 1 ? -1.5 : 1.5)} -7;0 -14`, dur, begin) +
            loop('opacity', `0;${n(peak)};0`, dur, begin) +
            '</path>'
          )
        })
        .join('')
    : ''
  const glassBody = `M142 ${RIM}L144.5 252.4Q144.8 254 146.4 254H161.6Q163.2 254 163.5 252.4L166 ${RIM}`
  return (
    '<ellipse cx="156" cy="256" rx="19" ry="2" fill="#120c0b" opacity="0.45"/>' +
    `<g opacity="${measured ? 1 : 0.5}">` +
    '<ellipse cx="154" cy="255.4" rx="16" ry="3.2" fill="#b8a690"/><ellipse cx="154" cy="254.6" rx="16" ry="3" fill="#e8dccb"/>' +
    '<ellipse cx="154" cy="254.4" rx="10.4" ry="1.8" fill="#d4c5b0"/>' +
    '<path d="M165.6 254.6L175 252.4" stroke="#b9b1a6" stroke-width="1.1" stroke-linecap="round"/><ellipse cx="175.6" cy="252.2" rx="2" ry="1" fill="#cfc8bd"/>' +
    `<path d="${glassBody}" fill="#ffffff" fill-opacity="0.06"/>` +
    liquid +
    `<path d="M165.4 219C174.6 219 175.6 242 163.8 243.4" fill="none" stroke="#f3e7da" stroke-opacity="0.45" stroke-width="2.4"/>` +
    `<path d="${glassBody}" fill="none" stroke="#f3e7da" stroke-opacity="0.6" stroke-width="0.9"/>` +
    `<ellipse cx="${MUG_X}" cy="${RIM}" rx="12" ry="1.8" fill="none" stroke="#f8efe4" stroke-opacity="0.7" stroke-width="0.8"/>` +
    '<path d="M144.6 214L146.4 250" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" opacity="0.38"/>' +
    '<path d="M163.6 214.4L162 249" stroke="#ffd9a0" stroke-width="0.8" stroke-linecap="round" opacity="0.5"/>' +
    '<ellipse cx="154" cy="252.6" rx="8.4" ry="1.1" fill="#ffffff" opacity="0.14"/>' +
    '</g>' +
    steam
  )
}

// ── The painting ──────────────────────────────────────────────────────────────────────────

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const honey = palette.accent
  const rain = palette.accent2
  const defs =
    linearY(`${uid}-wall`, CROWN, FRONT, [
      [0, '#22191e'],
      [0.45, '#2e2127'],
      [1, '#38282b'],
    ]) +
    `<pattern id="${uid}-paper" width="11" height="11" patternUnits="userSpaceOnUse"><rect width="4.5" height="11" fill="#f3e7da" opacity="0.025"/></pattern>` +
    linearY(`${uid}-road`, 230, SILL, [
      [0, '#5a4d66'],
      [1, '#3e3550'],
    ]) +
    linearY(`${uid}-shopw`, 199, 222, [
      [0, '#f6cf96', 0.75],
      [1, '#e39a62', 0.55],
    ]) +
    linearY(`${uid}-shopc`, 199, 222, [
      [0, '#b9d6e2', 0.55],
      [1, '#7fa3b8', 0.4],
    ]) +
    linearY(`${uid}-rf0`, 231, SILL, [
      [0, '#f2b36b', 0.45],
      [1, '#f2b36b', 0],
    ]) +
    linearY(`${uid}-rf1`, 231, SILL, [
      [0, rain, 0.4],
      [1, rain, 0],
    ]) +
    radialBox(`${uid}-bk0`, [
      [0, '#ffd08f', 0.75],
      [0.55, '#f2b36b', 0.42],
      [1, '#f2b36b', 0],
    ]) +
    radialBox(`${uid}-bk1`, [
      [0, '#f6b8aa', 0.65],
      [0.55, '#e8a39a', 0.36],
      [1, '#e8a39a', 0],
    ]) +
    radialBox(`${uid}-bk2`, [
      [0, '#c4e0ec', 0.6],
      [0.55, rain, 0.34],
      [1, rain, 0],
    ]) +
    radialBox(`${uid}-bk3`, [
      [0, '#cdbde8', 0.5],
      [0.55, '#ad9bd0', 0.28],
      [1, '#ad9bd0', 0],
    ]) +
    linearY(`${uid}-haze`, 100, SILL, [
      [0, '#7a6475', 0.05],
      [1, '#8f7a8c', 0.38],
    ]) +
    linearY(`${uid}-damp`, 196, SILL, [
      [0, '#e6dbe6', 0],
      [1, '#e6dbe6', 0.2],
    ]) +
    radialBox(`${uid}-fairy`, [
      [0, '#ffe2a8', 0.9],
      [0.35, honey, 0.4],
      [1, honey, 0],
    ]) +
    radialBox(`${uid}-fairyr`, [
      [0, '#ffd0c4', 0.9],
      [0.35, '#e8a39a', 0.4],
      [1, '#e8a39a', 0],
    ]) +
    `<linearGradient id="${uid}-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a251a"/><stop offset="0.62" stop-color="#6a4630"/><stop offset="1" stop-color="#93603b"/></linearGradient>` +
    radialBox(`${uid}-glow`, [
      [0, honey, 0.46],
      [0.16, honey, 0.27],
      [0.45, honey, 0.09],
      [1, honey, 0],
    ]) +
    radialBox(`${uid}-bulb`, [
      [0, '#fff1d2', 0.85],
      [0.35, '#ffd9a0', 0.32],
      [1, honey, 0],
    ]) +
    linearBox(`${uid}-cone`, [
      [0, '#ffd59a', 0.11],
      [1, '#ffd59a', 0.01],
    ]) +
    radialBox(`${uid}-pool`, [
      [0, '#ffc77f', 0.7],
      [0.45, honey, 0.28],
      [1, honey, 0],
    ]) +
    linearY(`${uid}-top`, SILL, EDGE, [
      [0, '#553827'],
      [1, '#7a5037'],
    ]) +
    linearY(`${uid}-under`, FRONT, FRONT + 12, [
      [0, '#100a09', 0.6],
      [1, '#100a09', 0],
    ]) +
    linearX(`${uid}-pot`, 61, 83, [
      [0, '#7a4430'],
      [0.55, '#ad6a45'],
      [1, '#6a3a29'],
    ]) +
    linearY(`${uid}-cat`, 226, 255, [
      [0, '#3c2a25'],
      [1, '#211715'],
    ]) +
    latteDefs(uid, context) +
    walkerDefs(uid) +
    `<clipPath id="${uid}-glass"><path d="${opening(MAIN)}${opening(SIDE)}"/></clipPath>` +
    `<filter id="${uid}-soft" x="-4%" y="-6%" width="108%" height="112%"><feGaussianBlur stdDeviation="1.1"/></filter>`

  // Far to near. The street (its random draws come first, so it never shifts with the rest).
  const main = street(uid, r, MAIN.x0, MAIN.x1, 5, 98)
  const side = street(uid, r, SIDE.x0, SIDE.x1, 1)
  const walkers = swarmSpots(scene.id, { x0: 62, y0: 226, x1: 282, y1: 232 }, swarm)
    .map((spot, i) => passerBy(uid, spot.x, spot.y, spot.k, i))
    .join('')
  const outside =
    `<g clip-path="url(#${uid}-glass)">` +
    `<g filter="url(#${uid}-soft)">${main.far}</g>` +
    `<g filter="url(#${uid}-soft)">${side.far}</g>` +
    `<rect x="${MAIN.x0}" y="${MAIN.apex}" width="${SIDE.x1 - MAIN.x0}" height="${SILL - MAIN.apex}" fill="url(#${uid}-haze)"/>` +
    main.lights +
    side.lights +
    walkers +
    rainfall(r, { x0: MAIN.x0, y0: MAIN.apex, x1: MAIN.x1 + 14, y1: SILL }, 14, rain, -5) +
    rainfall(r, { x0: SIDE.x0, y0: SIDE.apex, x1: SIDE.x1 + 10, y1: SILL }, 4, rain, -5) +
    '</g>'
  const pane = glass(uid, r)

  // The room around the windows, the walls' furniture, the lamps' light.
  const walls =
    room(uid) +
    shelves(r, [
      [32, 308, -28],
      [-62, 16, 124],
      [-62, 16, 172],
      [-62, 16, 216],
      [318, 388, 132],
      [318, 388, 184],
    ]) +
    chalkboard() +
    pegsAndPicture() +
    hangingPlant(r, -252, 58)
  const frames = casing(MAIN) + casing(SIDE) + `<path d="M${MAIN.x0 - 9} ${SILL - 1}H${MAIN.x1 + 9}M${SIDE.x0 - 9} ${SILL - 1}H${SIDE.x1 + 9}" stroke="#2a1c15" stroke-width="2"/>`
  const lights =
    fairyLights(uid, r) +
    `<g>${lampLight(uid, LAMP_X, LAMP_RIM, LAMP_S)}${pendant(uid, LAMP_X, LAMP_RIM, LAMP_S)}${sway(LAMP_X, LAMP_TOP, 0.45, 9, 2)}</g>` +
    `<g opacity="0.8">${lampLight(uid, -126, 98, 0.78)}${pendant(uid, -126, 98, 0.78)}</g>` +
    `<g opacity="0.8">${lampLight(uid, 440, 104, 0.78)}${pendant(uid, 440, 104, 0.78)}</g>`

  // The counter and what sits on it, nearest of all.
  const pools =
    `<ellipse cx="${LAMP_X}" cy="252.6" rx="100" ry="7.4" fill="url(#${uid}-pool)"/>` +
    `<ellipse cx="${LAMP_X - 6}" cy="${FRONT + 14}" rx="130" ry="30" fill="url(#${uid}-pool)" opacity="0.28"/>` +
    `<ellipse cx="-126" cy="252.6" rx="70" ry="6" fill="url(#${uid}-pool)" opacity="0.7"/>` +
    `<ellipse cx="440" cy="252.6" rx="70" ry="6" fill="url(#${uid}-pool)" opacity="0.7"/>`
  const things =
    cakeStand() +
    counterPlant(uid, r) +
    bookStack() +
    latte(uid, context) +
    gaugeCaption({ x: MUG_X, y: 166, name: scene.gauge, value: contextText, palette, anchor: 'middle' }) +
    cat(uid) +
    lavender() +
    stools()

  return { defs, body: outside + pane + walls + frames + lights + counter(uid) + pools + things }
}
