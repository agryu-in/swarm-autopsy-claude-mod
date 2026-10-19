// Hollow Library: an abandoned library at dusk. A long aisle of towering bookcases recedes to
// a tall arched window whose cold gray light falls across the floor in a dusty shaft; an unlit
// chandelier hangs before it, cobwebs fill the upper corners, a ladder leans on the near shelves.
// On the reading desk in front, a tall candle is the context gauge: it burns down as the context
// window fills (a brass ruler beside it marks the full height in quarters), its drips and pool of
// wax grow and its warm glow widens. Each active subagent is an open book floating in the gloom.

import type { Painted, PaintArgs } from '../scene.ts'
import {
  BLEED,
  SCENE_W,
  between,
  blur,
  drift,
  flicker,
  fog,
  fogDefs,
  gaugeCaption,
  linearBox,
  linearX,
  linearY,
  loop,
  motes,
  n,
  radialBox,
  swarmSpots,
  sway,
} from '../kit.ts'

const L = -BLEED
const R = SCENE_W + BLEED

// ── The aisle in one-point perspective: world X/Y (Y down) at depth w lands at VP + (X, Y)·FOCAL/w.
const VPX = 170
const VPY = 172
const FOCAL = 300
/** Depth of the aisle's mouth (the near bookcases stand in this plane) and of the back wall. */
const NEAR = 126
const FAR = 300
const HALF = 40
const FLOOR = 66
const CORNICE = -76
/** Shelf boards, bottom to top; books stand on each and reach toward the next. */
const BOARDS = [58, 42, 26, 10, -6, -22, -38, -54, -70] as const
const BOARD = 1.6
/** Uprights inside the aisle (their near depth) and their depth. */
const BAYS = [172, 230] as const
const UPRIGHT = 6

const sx = (X: number, w: number): number => VPX + (X * FOCAL) / w
const sy = (Y: number, w: number): number => VPY + (Y * FOCAL) / w
/** The near plane's scale, and a world Y on it. */
const FRONT = FOCAL / NEAR
const fy = (Y: number): number => VPY + Y * FRONT
/** One decimal: spines are many, and short numbers keep the drawing small. */
const d1 = (v: number): string => String(Math.round(v * 10) / 10)

const AISLE_BOOKS = ['#4b403b', '#554840', '#443a36', '#5c4f46', '#4e4341', '#3f3634', '#5f544b'] as const
const NEAR_BOOKS = ['#352c29', '#2c2523', '#3d332d', '#30292a', '#272020', '#43372f'] as const
const SPINE_WIDTHS = [0.5, 0.8, 1.2, 1.7, 2.4, 3.2, 4] as const
const NEAR_WIDTHS = [5, 7, 9, 11] as const

const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length] as T
const nearest = (value: number, list: readonly number[]): number =>
  list.reduce((best, x) => (Math.abs(x - value) < Math.abs(best - value) ? x : best), list[0] ?? value)

/** Strokes grouped by colour and width: one path per group keeps hundreds of spines cheap. */
function strokeGroups(groups: Map<string, string>): string {
  let out = ''
  for (const [key, d] of groups) {
    const [color, width] = key.split('|')
    out += `<path d="${d}" stroke="${color}" stroke-width="${width}"/>`
  }
  return `<g fill="none">${out}</g>`
}

const add = (groups: Map<string, string>, key: string, d: string): void => {
  groups.set(key, (groups.get(key) ?? '') + d)
}

// ── The aisle ───────────────────────────────────────────────────────────────────────────

/** A strip of the wall at X between depths wa..wb and heights ya..yb. */
function wallQuad(X: number, wa: number, wb: number, ya: number, yb: number): string {
  return `M${d1(sx(X, wa))} ${d1(sy(ya, wa))}L${d1(sx(X, wb))} ${d1(sy(ya, wb))}L${d1(sx(X, wb))} ${d1(sy(yb, wb))}L${d1(sx(X, wa))} ${d1(sy(yb, wa))}Z`
}

/** The spines of one receding wall, row by row, bay by bay. */
function aisleSpines(r: () => number, X: number, groups: Map<string, string>): void {
  const bays: Array<[number, number]> = [
    [NEAR + 0.5, BAYS[0]],
    [BAYS[0] + UPRIGHT, BAYS[1]],
    [BAYS[1] + UPRIGHT, FAR],
  ]
  for (let row = 0; row < BOARDS.length - 1; row++) {
    const lo = BOARDS[row] ?? 0
    const room = lo - (BOARDS[row + 1] ?? 0) - BOARD
    for (const [from, to] of bays) {
      let w = from + between(r, 0, 1.5)
      while (w < to - 2) {
        const dw = Math.min(between(r, 4.4, 8), to - w)
        const mid = w + dw / 2
        if (r() > 0.06) {
          const h = room * between(r, 0.6, 0.95)
          const width = nearest(Math.abs(X) * FOCAL * (1 / w - 1 / (w + dw)) * 0.9, SPINE_WIDTHS)
          add(groups, `${pick(r, AISLE_BOOKS)}|${width}`, `M${d1(sx(X, mid))} ${d1(sy(lo, mid))}V${d1(sy(lo - h, mid))}`)
        }
        w += dw
      }
    }
  }
}

/** One wall of the aisle: backing, spines, boards, uprights, and a haze that thickens with depth. */
function aisleWall(r: () => number, side: -1 | 1): string {
  const X = side * HALF
  const groups = new Map<string, string>()
  aisleSpines(r, X, groups)
  const boards = BOARDS.map(Y => wallQuad(X, NEAR, FAR, Y, Y + BOARD)).join('')
  const uprights = BAYS.map(w => wallQuad(X, w, w + UPRIGHT, CORNICE, FLOOR)).join('')
  return (
    `<path d="${wallQuad(X, NEAR, FAR, CORNICE, FLOOR)}" fill="#1c1819"/>` +
    strokeGroups(groups) +
    `<path d="${boards}" fill="#3b2f2a"/>` +
    `<path d="${wallQuad(X, NEAR, FAR, BOARDS[0] + BOARD, FLOOR)}" fill="#231c1a"/>` +
    `<path d="${wallQuad(X, NEAR, FAR, CORNICE, -70)}" fill="#2f2623"/>` +
    `<path d="${uprights}" fill="#2c2320"/>` +
    // Tonal steps: each bay further back sits deeper in the haze.
    `<path d="${wallQuad(X, BAYS[0], BAYS[1], CORNICE - 2, FLOOR)}" fill="#77706d" opacity="0.1"/>` +
    `<path d="${wallQuad(X, BAYS[1], FAR, CORNICE - 2, FLOOR)}" fill="#837c78" opacity="0.2"/>`
  )
}

/** The back wall with its tall arched window, a bare tree and a far rise beyond the glass. */
function backWall(uid: string, r: () => number): string {
  const glass = 'M153 226V136Q153 118 170 110Q187 118 187 136V226Z'
  let stones = ''
  for (let y = 112, i = 0; y < 238; y += 9, i++) {
    stones += `M130 ${y}H210`
    for (let x = 130 + (i % 2) * 9; x < 210; x += 18) stones += `M${x} ${y}v9`
  }
  return (
    `<rect x="128" y="20" width="84" height="220" fill="url(#${uid}-wall)"/>` +
    `<path d="${stones}" stroke="#2a2526" stroke-width="0.6" opacity="0.7"/>` +
    `<ellipse cx="170" cy="168" rx="52" ry="78" fill="url(#${uid}-bloom)"/>` +
    `<path d="${glass}" fill="none" stroke="#262122" stroke-width="6"/>` +
    `<path d="${glass}" fill="url(#${uid}-glass)"/>` +
    `<clipPath id="${uid}-win"><path d="${glass}"/></clipPath>` +
    `<g clip-path="url(#${uid}-win)">` +
    '<path d="M150 216Q160 207 171 211T190 207V230H150Z" fill="#55585c"/>' +
    `<g stroke="#44474b" fill="none" opacity="0.75">` +
    '<path d="M182 232Q179 206 183 186Q185 172 179 158Q177 150 171 145" stroke-width="2.4"/>' +
    '<path d="M183 186Q190 177 198 172Q201 166 205 165M181 202Q172 194 164 191Q159 186 154 186M179 158Q184 148 186 138Q188 132 193 128M171 145Q168 139 162 137M186 150Q192 148 196 143" stroke-width="1.1"/>' +
    sway(182, 232, 0.8, 9, between(r, 0, 9)) +
    '</g>' +
    '</g>' +
    '<g stroke="#1f1b1c" fill="none"><path d="M170 110V226M153 166H187M153 198H187" stroke-width="1.5"/>' +
    '<circle cx="170" cy="127" r="4.5" stroke-width="1.2"/><path d="M153 136Q161 128 170 132Q179 128 187 136" stroke-width="1"/></g>' +
    '<rect x="148" y="226" width="44" height="4" fill="#4a4344"/>'
  )
}

/** The aisle's flagstone floor, and the room floor in front of it. */
function floor(uid: string): string {
  const corners = `M${d1(sx(-HALF, FAR))} ${d1(sy(FLOOR, FAR))}L${d1(sx(HALF, FAR))} ${d1(sy(FLOOR, FAR))}L${d1(sx(HALF, NEAR))} ${d1(sy(FLOOR, NEAR))}L${d1(sx(-HALF, NEAR))} ${d1(sy(FLOOR, NEAR))}Z`
  let joints = ''
  for (const X of [-20, 0, 20]) joints += `M${d1(sx(X, FAR))} ${d1(sy(FLOOR, FAR))}L${d1(sx(X, NEAR))} ${d1(sy(FLOOR, NEAR))}`
  for (const w of [150, 180, 215, 255]) joints += `M${d1(sx(-HALF, w))} ${d1(sy(FLOOR, w))}H${d1(sx(HALF, w))}`
  return (
    `<rect x="${L}" y="326" width="${R - L}" height="120" fill="#1b1718"/>` +
    `<path d="${corners}" fill="#2e2829"/>` +
    `<path d="${joints}" stroke="#211c1d" stroke-width="0.7"/>` +
    `<path d="M153 238L187 238L230 300L136 300Z" fill="url(#${uid}-patch)"/>`
  )
}

/** The cold shaft of light from the window, with dust drifting in it. */
function shaft(uid: string, r: () => number): string {
  const beam = 'M155 128L185 128L236 302L138 302Z'
  return (
    `<clipPath id="${uid}-beamclip"><path d="${beam}"/></clipPath>` +
    `<path d="${beam}" fill="url(#${uid}-beam)" filter="url(#${uid}-soft)">${loop('opacity', '0.85;1;0.85', 17, 4)}</path>` +
    `<g clip-path="url(#${uid}-beamclip)">${motes(r, { x0: 140, y0: 136, x1: 232, y1: 304 }, 10, '#ddd8d0', 14)}</g>`
  )
}

/** The unlit chandelier hanging before the window, swaying a hair on its long chain. */
function chandelier(): string {
  const cx = 170
  const cy = 121
  const arms = [-17, -9, 9, 17]
  let arm = ''
  let stubs = ''
  for (const dx of arms) {
    const lift = Math.abs(dx) > 10 ? 0 : 1.5
    arm += `M${cx} ${cy + 3}Q${cx + dx * 0.55} ${cy + 6} ${cx + dx} ${cy - 1 - lift}`
    stubs += `<rect x="${cx + dx - 1.1}" y="${cy - 6 - lift}" width="2.2" height="${4 + (dx > 0 ? 1 : 0)}" fill="#59524d"/><ellipse cx="${cx + dx}" cy="${cy - 1.4 - lift}" rx="2.4" ry="0.9" fill="#1a1617"/>`
  }
  return (
    '<g>' +
    `<path d="M${cx} -60V${cy - 8}" stroke="#141112" stroke-width="1.1" stroke-dasharray="2.2 0.9"/>` +
    `<path d="${arm}" stroke="#1a1617" stroke-width="1.4" fill="none"/>` +
    `<ellipse cx="${cx}" cy="${cy + 3}" rx="18" ry="3.4" fill="none" stroke="#1a1617" stroke-width="1.5"/>` +
    `<path d="M${cx - 1.4} ${cy - 9}h2.8v8l1.8 3l-1.8 3v4l-1.4 4l-1.4 -4v-4l-1.8 -3l1.8 -3Z" fill="#171314"/>` +
    stubs +
    `<path d="M${cx + 17} ${cy - 1}q3 7 1 15M${cx - 9} ${cy}q-2 5 0 9" stroke="#8d8682" stroke-width="0.35" fill="none" opacity="0.35"/>` +
    `<animateTransform attributeName="transform" type="rotate" values="-0.6 ${cx} -60;0.6 ${cx} -60;-0.6 ${cx} -60" dur="13s" begin="-4s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"/>` +
    '</g>'
  )
}

// ── The near bookcases, flanking the aisle's mouth and running out to both sides ─────────

type Span = readonly [number, number]
const LEFT_UPRIGHTS: readonly Span[] = [[-296, -286], [-206, -196], [-116, -106], [-26, -16], [66, 77]]
const RIGHT_UPRIGHTS: readonly Span[] = [[263, 274], [356, 366], [446, 456], [536, 546], [626, 636]]
const NEAR_BOARD = 3.4

/** The open bays between uprights, from x0 to x1. */
function compartments(uprights: readonly Span[], x0: number, x1: number): Span[] {
  const out: Span[] = []
  let from = x0
  for (const [a, b] of uprights) {
    if (a > from + 6) out.push([from, a])
    from = b
  }
  if (x1 > from + 6) out.push([from, x1])
  return out
}

/** The books of one compartment row: standing spines, now and then a gap with a flat stack. */
function nearRow(r: () => number, x0: number, x1: number, floorY: number, room: number, groups: Map<string, string>): string {
  let bands = ''
  let x = Math.round(x0 + between(r, 0.5, 2))
  while (x < x1 - 4) {
    if (r() < 0.07 && x1 - x > 26) {
      const len = Math.round(between(r, 16, 22))
      for (let j = 0; j < 3 && r() > 0.2; j++) add(groups, `${pick(r, NEAR_BOOKS)}|4`, `M${x + 1 + j} ${floorY - 2 - 4 * j}h${len - 2 * j}`)
      x += len + 3
      continue
    }
    const t = Math.min(pick(r, NEAR_WIDTHS), Math.floor(x1 - x - 0.5))
    const h = Math.round(room * between(r, 0.62, 0.93))
    add(groups, `${pick(r, NEAR_BOOKS)}|${t}`, `M${x + t / 2} ${floorY}v${-h}`)
    if (r() < 0.3) bands += `M${x + 0.5} ${floorY - h + 3}h${t - 1}`
    x += t + 1
  }
  return bands
}

/** One side's bookcases: backing, books, boards, uprights, plinth. */
function nearShelves(r: () => number, uprights: readonly Span[], x0: number, x1: number): string {
  const groups = new Map<string, string>()
  let bands = ''
  for (const [a, b] of compartments(uprights, x0, x1))
    // The top row is lost in the gloom, and the desk hides the bottom row on the left.
    for (let row = 0; row < BOARDS.length - 3; row++) {
      if (row === 0 && a >= -44 && b <= 166) continue
      const floorY = Math.round(fy(BOARDS[row] ?? 0))
      const room = floorY - fy(BOARDS[row + 1] ?? 0) - NEAR_BOARD
      bands += nearRow(r, a, b, floorY, room, groups)
    }
  const boards = BOARDS.map(Y => `M${x0} ${d1(fy(Y))}H${x1}V${d1(fy(Y) + NEAR_BOARD)}H${x0}Z`).join('')
  const posts = uprights.map(([a, b]) => `M${a} -20H${b}V340H${a}Z`).join('')
  return (
    `<rect x="${x0}" y="-20" width="${x1 - x0}" height="360" fill="#151112"/>` +
    strokeGroups(groups) +
    `<path d="${bands}" stroke="#6a5842" stroke-width="1" opacity="0.6"/>` +
    `<path d="${boards}" fill="#2b221f"/>` +
    `<path d="${posts}" fill="#1f1918"/>` +
    `<rect x="${x0}" y="${d1(fy(BOARDS[0]) + NEAR_BOARD)}" width="${x1 - x0}" height="40" fill="#1a1415"/>`
  )
}

/** A cobweb strung in a corner at (x, y), fanning out sideways (`dir`) and down. */
function cobweb(x: number, y: number, size: number, dir: 1 | -1, opacity: number): string {
  const spokes = 5
  const at = (i: number, f: number): [number, number] => {
    const a = (i / (spokes - 1)) * (Math.PI / 2)
    return [x + dir * Math.cos(a) * size * f, y + Math.sin(a) * size * f]
  }
  let d = ''
  for (let i = 0; i < spokes; i++) {
    const [ex, ey] = at(i, 1)
    d += `M${x} ${y}L${d1(ex)} ${d1(ey)}`
  }
  for (const f of size < 20 ? [0.4, 0.7, 0.95] : [0.28, 0.5, 0.72, 0.94])
    for (let i = 0; i < spokes - 1; i++) {
      const [ax, ay] = at(i, f)
      const [bx, by] = at(i + 1, f)
      const [cx, cy] = at(i + 0.5, f * 0.8)
      d += `M${d1(ax)} ${d1(ay)}Q${d1(cx)} ${d1(cy)} ${d1(bx)} ${d1(by)}`
    }
  return `<path d="${d}" fill="none" stroke="#a49c95" stroke-width="0.45" opacity="${n(opacity)}"/>`
}

/** The library ladder leaning on the right-hand bookcase, hooked over a board. */
function ladder(): string {
  const railA = (y: number): number => 290 + ((336 - y) / 220) * 10
  const railB = (y: number): number => 308 + ((336 - y) / 220) * 9
  let rungs = ''
  for (let y = 322; y > 124; y -= 15) rungs += `M${d1(railA(y))} ${y}H${d1(railB(y))}`
  return (
    '<g fill="none" stroke-linecap="round">' +
    `<path d="${rungs}" stroke="#2a211d" stroke-width="1.8"/>` +
    '<path d="M290 336L300 116M308 336L317 116" stroke="#2c2320" stroke-width="3"/>' +
    '<path d="M288.7 336L298.7 116M306.7 336L315.7 116" stroke="#5e4f45" stroke-width="0.7"/>' +
    '<path d="M300 116q1 -4 4 -1M317 116q1 -4 4 -1" stroke="#2c2320" stroke-width="1.6"/>' +
    '</g>'
  )
}

// ── The reading desk and the candle gauge ───────────────────────────────────────────────

/** The candle's centre line, the top of its socket, its full height and the stub it keeps. */
const CX = 92
const BASE = 244
const TALL = 90
const STUB = 7
const RULER_X = 105.5

function desk(): string {
  return (
    '<path d="M-44 253L160 253L166 259L-44 259Z" fill="#3a2d27"/>' +
    '<path d="M-44 259H166" stroke="#56443a" stroke-width="0.8"/>' +
    '<rect x="-44" y="259.4" width="210" height="70" fill="#211916"/>' +
    '<path d="M-4 266h60v14h-60ZM84 266h60v14h-60Z" fill="none" stroke="#2f241f" stroke-width="1"/>' +
    '<circle cx="26" cy="273" r="1.4" fill="#7d6139"/><circle cx="114" cy="273" r="1.4" fill="#7d6139"/>' +
    '<rect x="-44" y="259.4" width="7" height="70" fill="#1a1311"/>' +
    // A stack of books, an open ledger, an inkwell with its quill.
    '<rect x="4" y="247" width="48" height="7" fill="#3c302e"/><rect x="5" y="249" width="46" height="1" fill="#6a5842" opacity="0.6"/>' +
    '<rect x="9" y="241.5" width="40" height="5.5" fill="#8f8576"/><rect x="9" y="241.5" width="2" height="5.5" fill="#4a3934"/>' +
    '<rect x="2" y="237" width="44" height="4.5" fill="#33292a"/>' +
    '<path d="M108 255L127 256.5L128 251.5L111 250.5ZM128 256.5L148 255L145 250.5L128 251.5Z" fill="#2c2321"/>' +
    '<path d="M110 254.6L127.6 255.8L128 251L112.6 250ZM128.4 255.8L146 254.6L143.4 250L128 251Z" fill="#b3a895"/>' +
    '<path d="M114 251.6l11 0.8M114 253l11 0.8M131 252.4l11 -0.7M131 253.8l11 -0.7" stroke="#7b7265" stroke-width="0.4"/>' +
    '<path d="M150 256h10v-5.5q0 -2 -2 -2h-6q-2 0 -2 2Z" fill="#161213"/><rect x="153" y="246.5" width="4" height="2.2" fill="#161213"/>' +
    '<path d="M156 247Q160 238 166 229Q168 233 164.5 237.5Q161 242 156.8 247.4Z" fill="#69625f"/><path d="M155.6 248Q161 237 167 228" stroke="#3a3333" stroke-width="0.5" fill="none"/>'
  )
}

/** The brass candlestick, its ruler and the candle burning down: the context gauge. */
function candleGauge(uid: string, r: () => number, context: number | undefined): string {
  const lit = context !== undefined
  const c = context ?? 0
  const wax = STUB + (TALL - STUB) * (1 - c)
  const top = BASE - wax
  // Every random draw is made whatever the fill, so the rest of the scene never shifts with it.
  const drips = Array.from({ length: 7 }, () => ({ u: between(r, -1, 1), w: between(r, 1.3, 2.2), f: between(r, 0.4, 1) }))
  const haloFlicker = between(r, 2.6, 3.6)
  const flameFlicker = flicker(r, 0.8, 1)
  const coreFlicker = flicker(r, 0.65, 1)

  let wet = ''
  const shown = lit ? Math.round(1 + c * 6) : 0
  for (const drip of drips.slice(0, shown)) {
    const x = CX + drip.u * 3.8
    const len = Math.min(wax - 2, (3 + 18 * c) * drip.f)
    wet += `M${n(x - drip.w / 2)} ${n(top)}h${n(drip.w)}v${n(len)}a${n(drip.w / 2)} ${n(drip.w / 2)} 0 0 1 ${n(-drip.w)} 0Z`
  }
  if (lit && c > 0.55) {
    const len = (c - 0.55) * 16
    wet += `M${CX + 9} 249h1.8v${n(len)}a0.9 0.9 0 0 1 -1.8 0ZM${CX - 6} 250h1.6v${n(len * 0.6)}a0.8 0.8 0 0 1 -1.6 0Z`
  }

  let ticks = ''
  for (const q of [0, 0.25, 0.5, 0.75, 1]) {
    const y = BASE - STUB - (TALL - STUB) * (1 - q)
    ticks += `M${RULER_X} ${n(y)}h${q === 0.5 ? -5 : -3.6}`
  }

  const flameY = top - 8
  const radius = 26 + 54 * c
  const glow = 0.5 + 0.45 * c
  const halo = lit
    ? `<ellipse cx="${CX}" cy="256" rx="${n(34 + 60 * c)}" ry="${n(5 + 4 * c)}" fill="url(#${uid}-warmth)" opacity="${n(0.45 + 0.45 * c)}"/>` +
      `<circle cx="${CX}" cy="${n(flameY)}" r="${n(radius)}" fill="url(#${uid}-warmth)" opacity="${n(glow)}">` +
      loop('opacity', `${n(glow * 0.8)};${n(glow)};${n(glow * 0.86)};${n(glow * 0.97)};${n(glow * 0.8)}`, haloFlicker, 1.3) +
      '</circle>'
    : ''

  const flame = lit
    ? `<g transform="translate(${CX} ${n(top - 2.6)})"><g>` +
      `<circle cy="-5" r="5.5" fill="#ffd9a0" opacity="0.3">${coreFlicker}</circle>` +
      '<ellipse cy="-0.6" rx="1.3" ry="1.6" fill="#7584b8" opacity="0.55"/>' +
      `<path d="M0 -12.5C1.2 -8 3 -5.4 2.6 -3C2.2 -0.6 -2.2 -0.6 -2.6 -3C-3 -5.4 -1.2 -8 0 -12.5Z" fill="url(#${uid}-flame)">${flameFlicker}</path>` +
      '<path d="M0 -7.5C0.7 -5 1.3 -3.6 1.1 -2.4C0.9 -1.3 -0.9 -1.3 -1.1 -2.4C-1.3 -3.6 -0.7 -5 0 -7.5Z" fill="#fff4d8"/>' +
      '<animateTransform attributeName="transform" type="scale" values="1 1;0.9 1.1;1.06 0.94;0.96 1.05;1 1" dur="2.3s" begin="-0.7s" repeatCount="indefinite"/>' +
      '</g></g>'
    : ''

  return (
    halo +
    // The brass candlestick: foot, stem, dish, socket.
    `<ellipse cx="${CX}" cy="257" rx="9" ry="2.2" fill="#5a4427"/><ellipse cx="${CX}" cy="256.4" rx="7" ry="1.4" fill="#8a6a3e"/>` +
    `<rect x="${CX - 1.2}" y="249" width="2.4" height="7.5" fill="#76592f"/><ellipse cx="${CX}" cy="252.6" rx="2.6" ry="1.3" fill="#94723f"/>` +
    `<ellipse cx="${CX}" cy="248.6" rx="13" ry="3.2" fill="#6b5230"/><ellipse cx="${CX}" cy="247.9" rx="11.6" ry="2.3" fill="#4e3b22"/>` +
    // The ruler on the dish rim: its top is the full candle, its ticks the quarters.
    `<path d="M${RULER_X} 248V${BASE - TALL - 3}" stroke="#1a1415" stroke-width="3"/>` +
    `<path d="M${RULER_X} 248V${BASE - TALL - 3}" stroke="#9b7843" stroke-width="1.6"/>` +
    `<circle cx="${RULER_X}" cy="${BASE - TALL - 4.6}" r="1.9" fill="#b48d52"/>` +
    `<path d="${ticks}" stroke="#1a1415" stroke-width="2.2"/>` +
    `<path d="${ticks}" stroke="#ddb377" stroke-width="1"/>` +
    (lit ? `<ellipse cx="${CX}" cy="248" rx="${n(5.5 + 5.5 * c)}" ry="${n(1.4 + 0.8 * c)}" fill="#ddd2bf"/>` : '') +
    `<rect x="${CX - 5.5}" y="${BASE}" width="11" height="4" fill="#85673b"/><ellipse cx="${CX}" cy="${BASE}" rx="5.5" ry="1.3" fill="#a07e49"/>` +
    // The candle: wax, its rim, the drips, the wick and (when lit) the flame.
    `<rect x="${CX - 4.5}" y="${n(top)}" width="9" height="${n(wax)}" fill="url(#${uid}-wax)"/>` +
    `<ellipse cx="${CX}" cy="${n(top)}" rx="4.5" ry="1.3" fill="${lit ? '#f1d9b0' : '#d9cfbe'}"/>` +
    (wet ? `<path d="${wet}" fill="#ddd1bc"/>` : '') +
    `<path d="M${CX} ${n(top)}q0.6 -1.6 -0.2 -3.4" stroke="#1d1718" stroke-width="0.8" fill="none"/>` +
    flame
  )
}

// ── The swarm: open books floating in the gloom, one per active subagent ────────────────

function ghostBook(uid: string, x: number, y: number, k: number, ghost: string): string {
  const s = 0.82 + k * 0.3
  const bob = 6 + k * 4
  const tilt = (k - 0.5) * 18
  const rock = 2 + k * 2
  const flap = 1.7 + ((k * 7) % 1) * 1.4
  const turn = (values: string, dur: number, begin: number): string =>
    `<animateTransform attributeName="transform" type="scale" values="${values}" dur="${n(dur)}s" begin="${n(-begin)}s" repeatCount="indefinite"/>`
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})"><g>` +
    drift('0 0;0 -4.5;0 0', bob, k * bob) +
    `<ellipse cy="-3" rx="27" ry="18" fill="url(#${uid}-ghost)">${loop('opacity', '0.6;1;0.6', bob * 0.8, k * 5)}</ellipse>` +
    `<g><animateTransform attributeName="transform" type="rotate" values="${n(tilt - rock)};${n(tilt + rock)};${n(tilt - rock)}" dur="${n(bob * 1.3)}s" begin="${n(-k * 7)}s" repeatCount="indefinite"/>` +
    '<path d="M0 3.4L-13 0.6L-13.4 -8.6L0 -5L13.4 -8.6L13 0.6Z" fill="#3a2e36"/>' +
    `<path d="M0 2C-4 0-8 0-12 0L-12 -8C-8 -9-4 -8 0 -5.6ZM0 2C4 0 8 0 12 0L12 -8C8 -9 4 -8 0 -5.6Z" fill="#c3b9ae" stroke="${ghost}" stroke-width="0.6"/>` +
    '<path d="M-10.5 -6h7.5M-10.5 -4.2h8M-10.5 -2.4h7M3.4 -6h7.2M3 -4.2h8M3.6 -2.4h6.4" stroke="#80776d" stroke-width="0.45"/>' +
    `<path d="M0 -5.6C3 -9.6 7 -11 11 -10.4L10.6 -2.4C7 -3.2 3 -2.4 0 2Z" fill="#ddd3c6" stroke="${ghost}" stroke-width="0.4">${turn('1 1;0.35 1;0.9 1;0.55 1;1 1', flap, k * flap)}</path>` +
    `<path d="M0 -5.6C-3 -9-6.6 -10.2-10.4 -9.6L-10 -2C-6.6 -2.8-3 -2.2 0 2Z" fill="#d2c8bb">${turn('1 1;0.6 1;0.2 1;0.7 1;1 1', flap * 1.7, k * 3)}</path>` +
    '</g></g></g>'
  )
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const defs =
    linearY(`${uid}-wall`, 20, 238, [
      [0, '#1d191a'],
      [0.5, '#2e292a'],
      [1, '#3f393a'],
    ]) +
    linearY(`${uid}-glass`, 110, 226, [
      [0, '#a9adb1'],
      [0.55, '#80848a'],
      [1, '#62656a'],
    ]) +
    radialBox(`${uid}-bloom`, [
      [0, '#c3c6c9', 0.3],
      [1, '#c3c6c9', 0],
    ]) +
    radialBox(`${uid}-haze`, [
      [0, '#9a9592', 0.26],
      [0.5, '#7d7775', 0.1],
      [1, '#7d7775', 0],
    ]) +
    linearY(`${uid}-patch`, 238, 300, [
      [0, '#b9bbbd', 0.24],
      [1, '#b9bbbd', 0],
    ]) +
    linearY(`${uid}-beam`, 128, 302, [
      [0, '#c6c8ca', 0.2],
      [0.6, '#b2b4b6', 0.08],
      [1, '#b2b4b6', 0],
    ]) +
    linearY(`${uid}-gloom`, 0, 128, [
      [0, '#151314', 0.97],
      [0.45, '#161415', 0.88],
      [0.75, '#171516', 0.45],
      [1, '#171516', 0],
    ]) +
    radialBox(`${uid}-warmth`, [
      [0, palette.accent, 0.7],
      [0.3, palette.accent, 0.3],
      [1, palette.accent, 0],
    ]) +
    linearBox(`${uid}-flame`, [
      [0, '#fff0c6'],
      [0.45, '#f6b768'],
      [1, palette.accent],
    ]) +
    linearX(`${uid}-wax`, CX - 4.5, CX + 4.5, [
      [0, '#83796b'],
      [0.4, '#cbbfa9'],
      [0.7, '#d6cab5'],
      [1, '#968a78'],
    ]) +
    radialBox(`${uid}-ghost`, [
      [0, palette.accent2, 0.62],
      [0.45, palette.accent2, 0.24],
      [1, palette.accent2, 0],
    ]) +
    blur(`${uid}-soft`, 2.6) +
    fogDefs(uid)

  // Far to near: the back wall and window, the floor, the receding walls of books, the haze.
  const aisle =
    backWall(uid, r) +
    floor(uid) +
    aisleWall(r, -1) +
    aisleWall(r, 1) +
    `<ellipse cx="170" cy="176" rx="118" ry="128" fill="url(#${uid}-haze)"/>` +
    shaft(uid, r) +
    chandelier()

  // The near bookcases, darkest of all, and what clings to them.
  const near =
    nearShelves(r, LEFT_UPRIGHTS, L, 77) +
    nearShelves(r, RIGHT_UPRIGHTS, 263, R) +
    '<path d="M76.4 -20V330M263.6 -20V330" stroke="#5e5554" stroke-width="0.8" opacity="0.45"/>' +
    ladder()
  // Cobwebs in the upper corners, pale enough to show through the gloom.
  const webs =
    cobweb(66, 85.4, 30, -1, 0.36) +
    cobweb(274, 85.4, 34, 1, 0.36) +
    cobweb(-16, 85.4, 22, 1, 0.26) +
    cobweb(356, 85.4, 22, -1, 0.26) +
    cobweb(130.5, 96, 12, 1, 0.26) +
    cobweb(209.5, 96, 12, -1, 0.26)

  const gloom = `<rect x="${L}" y="-330" width="${R - L}" height="454" fill="url(#${uid}-gloom)"/>`
  const mist = fog({ uid, y: 300, width: 520, color: '#8f8987', opacity: 0.12, dur: 48, begin: 11, x0: -100 })

  const candle = candleGauge(uid, r, context)
  const caption = gaugeCaption({ x: 80, y: 170, name: scene.gauge, value: contextText, palette, anchor: 'end' })

  const books = swarmSpots(scene.id, { x0: 130, y0: 104, x1: 328, y1: 212 }, swarm)
    .map(spot => ghostBook(uid, spot.x, spot.y, spot.k, palette.accent2))
    .join('')

  return { defs, body: aisle + near + gloom + webs + mist + desk() + candle + caption + books }
}
