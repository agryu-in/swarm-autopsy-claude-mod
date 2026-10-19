// Fireside Tea: a cottage reading nook on a snowy night. A stone chimney breast stands centre-left
// under a low beamed ceiling, an oak mantel across it and shelves of books in the alcove beside it;
// on the right a curtained window holds deep night and falling snow behind a wingback armchair with
// a knitted throw, a reading lamp glowing at its shoulder. A teapot and a sage cup steam on a little
// round table, and a dog sleeps on the rug before the hearth. On a wide pane the room runs on: more
// bookcases, a long-case clock, a sideboard with its lamp, framed pictures and hanging plants.
// The context gauge is the fire in the hearth (HEARTH): unmeasured it is a bed of glowing embers; as
// the context window fills the flames climb until they roar against the arch, the sparks thicken and
// the firelight reaches further across the room, warming the stone, the chair's edge and the dog's
// back. Each active subagent is a lit candle on the mantelpiece.
//
// Past the 800-line soft ceiling on purpose: one painting, kept whole, so the drawing reads top to bottom like the
// scene (no other module needs any of its pieces).

import type { Palette } from '../../lib/scenes.ts'
import type { Painted, PaintArgs } from '../scene.ts'
import type { Stop } from '../kit.ts'
import {
  BLEED,
  SCENE_W,
  between,
  blur,
  drift,
  flicker,
  gaugeCaption,
  linearX,
  linearY,
  loop,
  n,
  radialBox,
  rng,
  snowfall,
  swarmSpots,
  sway,
} from '../kit.ts'

const L = -BLEED
const R = SCENE_W + BLEED
/** The room reaches far above and below the canvas, so a tall dock shows ceiling and floor, not sky. */
const TOP = -400
const FOOT = 460

// ── The room's lines ─────────────────────────────────────────────────────────────────────
/** Where the wall meets the ceiling beam, the chair rail, the skirting and the floor. */
const CEIL = 80
const RAIL = 206
const SKIRT = 254
const FLOOR = 262

// ── The fireplace ────────────────────────────────────────────────────────────────────────
/** The chimney breast's centre and sides; the mantel's top; the fire's base inside the firebox. */
const FX = 128
const BREAST_X0 = 60
const BREAST_X1 = 196
const MANTEL = 136
const FIRE_BASE = 251
/** The firebox opening under its segmental arch. */
const OPENING = `M92 258V192Q${FX} 160 164 192V258Z`

/** The window on the far wall, behind the armchair. */
const WIN = { x0: 240, x1: 300, y0: 100, y1: 184 }

const TONE = {
  ceiling: '#1b1317',
  joist: '#241612',
  mortar: '#211617',
  soot: '#120a0a',
  iron: '#1a1110',
  shelf: '#38231a',
  shelfBack: '#170e10',
  velvetDark: '#2c1217',
  frame: '#5e432a',
  case: '#2e1c15',
}

const BOOKS = ['#5a2a2c', '#6b4630', '#3c4a3e', '#3a3150', '#6a5643', '#4b2838', '#78573a', '#33393f', '#5b3a2a'] as const
const BOOK_WIDTHS = [3, 4, 5, 6, 7] as const

/** One decimal: bulk geometry (spines, stones, leaves, flames) stays short. */
const d1 = (v: number): string => String(Math.round(v * 10) / 10)
const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length] as T
const box = (x: number, y: number, w: number, h: number): string => `M${d1(x)} ${d1(y)}h${d1(w)}v${d1(h)}h${d1(-w)}Z`

/** A gradient across the object's own box (0..1), left to right. */
const across = (id: string, stops: readonly Stop[]): string =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
  stops.map(([o, c, a]) => `<stop offset="${n(o)}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${n(a)}"`}/>`).join('') +
  '</linearGradient>'

/** A gentle spline for a looping `<animate>` of `steps` values. */
const ease = (steps: number): string => {
  const times = Array.from({ length: steps }, (_, i) => n(i / (steps - 1))).join(';')
  const splines = Array.from({ length: steps - 1 }, () => '.45 0 .55 1').join(';')
  return ` calcMode="spline" keyTimes="${times}" keySplines="${splines}"`
}

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

// ── Ceiling, walls, floor ────────────────────────────────────────────────────────────────

/** The low ceiling: dark plaster crossed by joists that grow heavier as they near the eye. */
function ceiling(uid: string): string {
  const joists: ReadonlyArray<readonly [number, number]> = [
    [9, 4],
    [40, 5],
    [-26, 8],
    [-76, 11],
    [-144, 15],
    [-240, 20],
    [-372, 27],
  ]
  let beams = ''
  let lips = ''
  for (const [y, h] of joists) {
    beams += `M${L} ${y}H${R}v${h}H${L}Z`
    lips += `M${L} ${y + h}H${R}`
  }
  return (
    `<rect x="${L}" y="${TOP}" width="${R - L}" height="${CEIL - TOP}" fill="url(#${uid}-ceil)"/>` +
    `<path d="${beams}" fill="${TONE.joist}"/>` +
    `<path d="${lips}" stroke="#3e2820" stroke-width="0.8" opacity="0.55"/>` +
    // The great beam along the wall's head.
    `<rect x="${L}" y="64" width="${R - L}" height="${CEIL - 62}" fill="url(#${uid}-beam)"/>` +
    `<path d="M${L} 69.5Q-100 68 60 70T380 69.5T${R} 70M${L} 75Q0 76.5 200 75T${R} 75.5" stroke="#1d110d" stroke-width="0.6" fill="none" opacity="0.8"/>`
  )
}

/** Bundles of dried lavender, rosemary and roses hanging from a joist above the room. */
function herbs(): string {
  const bundles: ReadonlyArray<readonly [number, string]> = [
    [44, '#8a7aa6'],
    [112, '#6f8a6e'],
    [214, '#9a5a4a'],
    [292, '#8a7aa6'],
  ]
  const cords = bundles.map(([x]) => `M${x} -65V-52`).join('')
  const ties = bundles.map(([x]) => `M${x - 2} -50h4`).join('')
  const sprigs = bundles
    .map(
      ([x, color]) =>
        `<path d="M${x - 2} -50L${x - 7} -26Q${x} -20 ${x + 7} -26L${x + 2} -50Z" fill="${color}" opacity="0.7"/>` +
        `<path d="M${x} -50L${x - 4} -24M${x} -50V-22M${x} -50L${x + 4} -24" stroke="#4a3a2a" stroke-width="0.6"/>`,
    )
    .join('')
  return sprigs + `<path d="${cords}" stroke="#7a6248" stroke-width="0.6"/><path d="${ties}" stroke="#a0804c" stroke-width="2"/>`
}

/** The walls: plum paper with a fine stripe above the rail, oak panelling and skirting below. */
function walls(uid: string): string {
  return (
    `<rect x="${L}" y="${CEIL}" width="${R - L}" height="${FLOOR - CEIL}" fill="url(#${uid}-wall)"/>` +
    `<rect x="${L}" y="${CEIL}" width="${R - L}" height="${RAIL - CEIL}" fill="url(#${uid}-paper)" opacity="0.8"/>` +
    `<rect x="${L}" y="${RAIL + 3}" width="${R - L}" height="${SKIRT - RAIL - 3}" fill="url(#${uid}-panel)"/>` +
    `<rect x="${L}" y="${RAIL - 2}" width="${R - L}" height="5" fill="#3a2419"/>` +
    `<path d="M${L} ${RAIL - 1.5}H${R}" stroke="#5e3d2a" stroke-width="0.8" opacity="0.7"/>` +
    `<rect x="${L}" y="${SKIRT}" width="${R - L}" height="${FLOOR - SKIRT}" fill="#26160f"/>` +
    `<path d="M${L} ${SKIRT + 0.5}H${R}" stroke="#4a2f22" stroke-width="0.8" opacity="0.7"/>` +
    // The beam's shadow along the top of the wall.
    `<rect x="${L}" y="${CEIL}" width="${R - L}" height="34" fill="url(#${uid}-under)"/>`
  )
}

/** The floorboards, running away toward the hearth. */
function floor(uid: string): string {
  const vx = 170
  const vy = 150
  const k = (FOOT - vy) / (FLOOR - vy)
  let seams = ''
  for (let x = L; x <= R; x += 13) seams += `M${x} ${FLOOR}L${Math.round(vx + (x - vx) * k)} ${FOOT}`
  // Board ends, staggered.
  let ends = ''
  for (let i = 0; i < 24; i++) {
    const y = FLOOR + 8 + ((i * 37) % 160)
    const t = (y - vy) / (FLOOR - vy)
    const x = vx + (L + ((i * 97) % (R - L)) - vx) * t
    ends += `M${Math.round(x)} ${y}h${Math.round(13 * t)}`
  }
  return (
    `<rect x="${L}" y="${FLOOR}" width="${R - L}" height="${FOOT - FLOOR}" fill="url(#${uid}-floor)"/>` +
    `<path d="${seams}${ends}" stroke="#140c0b" stroke-width="0.9" opacity="0.75"/>`
  )
}

// ── Bookcases and things on the walls ────────────────────────────────────────────────────

/** One row of books standing on a board: spines, now and then a lean or a flat stack. */
function bookRow(r: () => number, x0: number, x1: number, board: number, room: number, groups: Map<string, string>): string {
  let bands = ''
  let x = x0 + between(r, 1, 3)
  while (x < x1 - 3) {
    if (r() < 0.08 && x1 - x > 22) {
      const len = Math.round(between(r, 14, 19))
      for (let j = 0; j < 3 && r() > 0.25; j++) add(groups, `${pick(r, BOOKS)}|3.4`, `M${d1(x + j)} ${d1(board - 1.7 - 3.4 * j)}h${len - 2 * j}`)
      x += len + 2
      continue
    }
    const t = Math.min(pick(r, BOOK_WIDTHS), Math.floor(x1 - x))
    const h = Math.round(room * between(r, 0.62, 0.92))
    const lean = r() < 0.06 ? Math.round(between(r, 2, 4)) : 0
    add(groups, `${pick(r, BOOKS)}|${t}`, lean ? `M${d1(x + t / 2)} ${board}l${lean} ${-h}` : `M${d1(x + t / 2)} ${board}v${-h}`)
    if (r() < 0.3) bands += `M${d1(x + 0.4)} ${Math.round(board - h * 0.82)}h${d1(t - 0.8)}`
    x += t + 0.6 + lean
  }
  return bands
}

/** A bookcase from x0 to x1: backing, rows of books on `boards`, a cupboard below the last, sides and cornice. */
function bookcase(r: () => number, x0: number, x1: number, top: number, boards: readonly number[]): string {
  const groups = new Map<string, string>()
  let bands = ''
  let shelves = ''
  let prev = top + 4
  for (const board of boards) {
    bands += bookRow(r, x0 + 4, x1 - 4, board, board - prev - 3, groups)
    shelves += box(x0, board, x1 - x0, 3)
    prev = board + 3
  }
  // The cupboard under the shelves: doors with a pair of brass knobs.
  const low = prev
  const mid = (x0 + x1) / 2
  const doors = `M${x0 + 5} ${low + 4}h${d1(mid - x0 - 7)}v${FLOOR - low - 10}h${d1(-(mid - x0 - 7))}ZM${d1(mid + 2)} ${low + 4}h${d1(x1 - mid - 7)}v${FLOOR - low - 10}h${d1(-(x1 - mid - 7))}Z`
  return (
    `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${FLOOR - top}" fill="${TONE.shelfBack}"/>` +
    strokeGroups(groups) +
    `<path d="${bands}" stroke="#a07a48" stroke-width="0.7" opacity="0.45"/>` +
    `<path d="${shelves}" fill="${TONE.shelf}"/>` +
    `<path d="${box(x0, low, x1 - x0, FLOOR - low)}${box(x0 - 2, top - 4, x1 - x0 + 4, 6)}${box(x0, top, 4, FLOOR - top)}${box(x1 - 4, top, 4, FLOOR - top)}" fill="${TONE.case}"/>` +
    `<path d="${doors}" stroke="#1e110c" stroke-width="1" fill="none"/>` +
    `<path d="M${d1(mid - 4)} ${d1((low + FLOOR) / 2)}h0.1M${d1(mid + 4)} ${d1((low + FLOOR) / 2)}h0.1" stroke="#a0804c" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M${x0 - 2} ${top - 3.6}h${x1 - x0 + 4}" stroke="#5a3a28" stroke-width="0.7" opacity="0.7"/>`
  )
}

/** A framed picture: a soft little painting in a dull gilt frame. */
function picture(x: number, y: number, w: number, h: number, kind: 'hills' | 'moon' | 'flower'): string {
  let art = ''
  if (kind === 'hills') {
    art = `<path d="M${x + 3} ${d1(y + h * 0.7)}Q${d1(x + w * 0.35)} ${d1(y + h * 0.48)} ${d1(x + w * 0.6)} ${d1(y + h * 0.64)}T${x + w - 3} ${d1(y + h * 0.58)}V${y + h - 3}H${x + 3}Z" fill="#4a5a48" opacity="0.8"/>`
  } else if (kind === 'moon') {
    art = `<circle cx="${d1(x + w * 0.62)}" cy="${d1(y + h * 0.36)}" r="${d1(Math.min(w, h) * 0.13)}" fill="#d9c6a0" opacity="0.7"/><path d="${box(x + 3, y + h * 0.78, w - 6, h * 0.22 - 3)}" fill="#2f3346" opacity="0.8"/>`
  } else {
    const cx = x + w / 2
    art =
      `<path d="M${d1(cx)} ${y + h - 5}V${d1(y + h * 0.4)}M${d1(cx)} ${d1(y + h * 0.62)}q${d1(-w * 0.2)} ${d1(-h * 0.06)} ${d1(-w * 0.24)} ${d1(-h * 0.2)}M${d1(cx)} ${d1(y + h * 0.55)}q${d1(w * 0.2)} ${d1(-h * 0.04)} ${d1(w * 0.22)} ${d1(-h * 0.18)}" stroke="#6f8a72" stroke-width="1.2" fill="none"/>` +
      `<circle cx="${d1(cx)}" cy="${d1(y + h * 0.36)}" r="${d1(w * 0.11)}" fill="#a8604a" opacity="0.85"/>`
  }
  return (
    `<path d="${box(x, y, w, h)}" fill="${TONE.frame}"/>` +
    `<path d="${box(x + 3, y + 3, w - 6, h - 6)}" fill="#7a6a6a"/>` +
    art +
    `<path d="${box(x + 0.6, y + 0.6, w - 1.2, h - 1.2)}" fill="none" stroke="#8a6a40" stroke-width="0.6" opacity="0.6"/>`
  )
}

/** A plant hanging from the beam on three cords, its trailing stems swaying slowly. */
function hangingPlant(r: () => number, x: number, potY: number): string {
  const hook = CEIL - 2
  let leaves = ''
  let stems = ''
  for (let i = 0; i < 4; i++) {
    const sx = x + (i - 1.5) * 4.6
    const len = between(r, 24, 50)
    const bend = between(r, -6, 6)
    stems += `M${d1(sx)} ${potY + 8}q${d1(bend)} ${d1(len * 0.5)} ${d1(bend * 0.4)} ${d1(len)}`
    for (let j = 0; j < 3; j++) {
      const t = (j + 1) / 4
      const ly = potY + 8 + len * t
      const lx = sx + bend * Math.sin(t * Math.PI) * 0.8
      const side = j % 2 === 0 ? 1 : -1
      leaves += `M${d1(lx)} ${d1(ly)}q${side * 3.2} -2.6 ${side * 4.6} 0.6q${side * -2.2} 1.8 ${side * -4.6} -0.6Z`
    }
  }
  return (
    '<g>' +
    `<path d="M${x} ${hook}L${x - 7} ${potY}M${x} ${hook}V${potY}M${x} ${hook}L${x + 7} ${potY}" stroke="#7a6248" stroke-width="0.6" fill="none"/>` +
    `<path d="M${x - 9} ${potY}h18l-2.4 10h-13.2Z" fill="#7a3f2a"/><path d="M${x - 9} ${potY}h18" stroke="#9a5638" stroke-width="1.2"/>` +
    `<path d="${stems}" stroke="#3b5240" stroke-width="0.8" fill="none"/>` +
    `<path d="${leaves}" fill="#557a5e"/>` +
    `<path d="M${x - 7} ${potY - 1}q3 -6 7 -2q4 -5 7 1" fill="#6f9a7a"/>` +
    sway(x, hook, 1.4, between(r, 9, 12), between(r, 0, 9)) +
    '</g>'
  )
}

/** The far left of a wide room: a tall bookcase, a long-case clock, pictures, a sideboard with its lamp. */
function farLeft(r: () => number, uid: string): string {
  // The long-case clock, its pendulum swinging slowly behind the trunk's glass.
  const clock =
    `<path d="${box(-150, 108, 28, 32)}M-152 108q16 -12 32 0Z${box(-152, 244, 32, FLOOR - 244)}" fill="#3a2218"/>` +
    `<circle cx="-136" cy="124" r="9" fill="#d9c9a8" stroke="#8a6a40" stroke-width="1.2"/>` +
    '<path d="M-136 124V118M-136 124l4 2" stroke="#2a1a14" stroke-width="0.9" stroke-linecap="round"/>' +
    `<path d="${box(-146, 140, 20, 104)}" fill="#33201a"/><path d="${box(-141, 150, 10, 64)}" fill="#1a0f0e"/>` +
    `<g><path d="M-136 150V200" stroke="#9a7a48" stroke-width="0.8"/><circle cx="-136" cy="203" r="3.6" fill="#b08a50"/>${sway(-136, 150, 7, 2.6, 0.6)}</g>` +
    '<path d="M-150 140H-122M-152 244H-120" stroke="#5a3a28" stroke-width="0.8"/>'
  // The sideboard: books, a little plant and a lamp whose halo breathes.
  const lampX = -70
  const sideboard =
    `<path d="${box(-112, 224, 84, 30)}" fill="#3a2419"/><path d="${box(-114, 220, 88, 5)}" fill="#4a2f21"/>` +
    '<path d="M-108 228h34v22h-34ZM-66 228h34v22h-34Z" stroke="#24150f" stroke-width="0.9" fill="none"/>' +
    '<path d="M-77 239h0.1M-63 239h0.1" stroke="#a0804c" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M-110 254v8M-30 254v8" stroke="#2a1a12" stroke-width="2.4"/>' +
    '<path d="M-104 220h20v-3.4h-20ZM-102 216.6h17v-3h-17Z" fill="#5a2a2c"/>' +
    '<path d="M-44 220l1.6 -8h8.8l1.6 8Z" fill="#7a3f2a"/><path d="M-39 212q-6 -8 -3 -14M-39 212q2 -9 6 -12M-39 212q-1 -10 1 -16" stroke="#6f9a7a" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    `<circle cx="${lampX}" cy="190" r="40" fill="url(#${uid}-cglow)" opacity="0.4">${loop('opacity', '0.3;0.45;0.3', 9, 2)}</circle>` +
    `<path d="M${lampX - 6} 220q-3 -8 2 -14h8q5 6 2 14Z" fill="#6a4a3a"/><path d="M${lampX} 206V196" stroke="#8a6a40" stroke-width="1"/>` +
    `<path d="M${lampX - 13} 196l4 -15h18l4 15Z" fill="url(#${uid}-shade)"/>` +
    `<ellipse cx="${lampX}" cy="196" rx="13" ry="1.8" fill="#ffe2b0" opacity="0.85"/>`
  // A plank door out of the room, a little wreath on it.
  const door =
    `<path d="${box(-292, 112, 66, FLOOR - 112)}" fill="#2e1c15"/><path d="${box(-286, 118, 54, FLOOR - 118)}" fill="#3a2419"/>` +
    '<path d="M-273 118V262M-259 118V262M-245 118V262M-286 150H-232M-286 228H-232" stroke="#24150f" stroke-width="1"/>' +
    '<path d="M-240 196h6" stroke="#8a6a40" stroke-width="2" stroke-linecap="round"/>' +
    '<circle cx="-259" cy="150" r="9" fill="none" stroke="#4f6e56" stroke-width="3.4"/><path d="M-263 141l4 3l4 -3" stroke="#a0503a" stroke-width="1.4" fill="none"/>'
  return (
    door +
    clock +
    picture(-100, 118, 40, 30, 'hills') +
    picture(-52, 112, 18, 24, 'flower') +
    sideboard +
    hangingPlant(r, -12, 98)
  )
}

/** The far right of a wide room: framed pictures, a hanging plant and another tall bookcase. */
function farRight(r: () => number, uid: string): string {
  return (
    picture(368, 112, 34, 44, 'moon') +
    picture(404, 152, 40, 28, 'hills') +
    hangingPlant(r, 466, 102) +
    bookcase(r, 492, 604, 92, [126, 160, 194])
  )
}

// ── The window ───────────────────────────────────────────────────────────────────────────

/** The window on the far wall: deep night, a thin moon, snowy pines and falling snow; curtains tied back. */
function windowLayer(r: () => number, uid: string): string {
  const { x0, x1, y0, y1 } = WIN
  const w = x1 - x0
  const glass = box(x0, y0, w, y1 - y0)
  let starD = ''
  for (let i = 0; i < 9; i++) starD += `M${d1(between(r, x0 + 3, x1 - 3))} ${d1(between(r, y0 + 3, y0 + 44))}h0.1`
  const trees: ReadonlyArray<readonly [number, number, number]> = [
    [249, 176, 9],
    [258, 172, 12],
    [289, 174, 10],
    [296, 178, 7],
  ]
  const pines = trees.map(([px, py, h]) => `M${d1(px - h * 0.42)} ${py}L${px} ${py - h}L${d1(px + h * 0.42)} ${py}Z`).join('')
  const caps = trees.map(([px, py, h]) => `M${d1(px - h * 0.2)} ${d1(py - h * 0.5)}L${px} ${py - h}L${d1(px + h * 0.2)} ${d1(py - h * 0.5)}Z`).join('')
  const night =
    `<clipPath id="${uid}-win"><path d="${glass}"/></clipPath>` +
    `<path d="${glass}" fill="url(#${uid}-night)"/>` +
    `<g clip-path="url(#${uid}-win)">` +
    `<path d="${starD}" stroke="#dfe6f4" stroke-width="1" stroke-linecap="round" opacity="0.7"/>` +
    '<circle cx="284" cy="116" r="14" fill="#f1e8d2" opacity="0.04"/><circle cx="284" cy="116" r="9.5" fill="#f1e8d2" opacity="0.06"/>' +
    '<path d="M284 110a6 6 0 1 0 4.4 10.1a5 5 0 1 1 -4.4 -10.1Z" fill="#f1e8d2"/>' +
    '<path d="M236 176Q256 164 276 172T306 168V190H236Z" fill="#3a4766"/>' +
    '<path d="M236 176Q256 164 276 172T306 168" stroke="#9fb0cc" stroke-width="1.2" fill="none" opacity="0.6"/>' +
    `<path d="${pines}" fill="#1f2840"/><path d="${caps}" fill="#9fb0cc" opacity="0.6"/>` +
    '<path d="M266 168h6v-4l-3 -2.4l-3 2.4Z" fill="#202943"/><path d="M268 165.8h1.6" stroke="#ffc77a" stroke-width="1.6"/>' +
    '<path d="M236 184Q270 178 306 184V190H236Z" fill="#c8d3e6" opacity="0.85"/>' +
    snowfall(r, { x0: x0 - 4, y0: y0 - 4, x1: x1 + 4, y1: y1 + 2 }, 9, '#eef2fa', [0.5, 1.3]) +
    `<rect x="${x0}" y="${y1 - 22}" width="${w}" height="22" fill="url(#${uid}-frost)"/>` +
    '</g>'
  const frame =
    `<path d="${box(x0 - 4, y0 - 4, w + 8, y1 - y0 + 8)}M${x0} ${y0}v${y1 - y0}h${w}v${y0 - y1}Z" fill="#3a2419" fill-rule="evenodd"/>` +
    `<path d="M${x0 + w / 2} ${y0}V${y1}M${x0} ${y0 + (y1 - y0) / 3}H${x1}M${x0} ${y0 + (2 * (y1 - y0)) / 3}H${x1}" stroke="#3a2419" stroke-width="2"/>` +
    `<path d="${box(x0 - 7, y1 + 3, w + 14, 5)}" fill="#4a2f21"/><path d="M${x0 - 7} ${y1 + 3.4}h${w + 14}" stroke="#7a5236" stroke-width="0.7"/>`
  // Curtains in dusky rose, gathered and tied back high; the rod above them.
  const curtains =
    `<path d="M224 92H246Q245 116 242 132Q238 140 241 148Q232 196 238 244H222Q219 160 224 92ZM316 92H294Q295 116 298 132Q302 140 299 148Q308 196 302 244H318Q321 160 316 92Z" fill="url(#${uid}-curtain)"/>` +
    '<path d="M229 96Q228 150 228 240M235 96Q236 120 235 134M240 152Q234 200 232 240M311 96Q312 150 312 240M305 96Q304 120 305 134" stroke="#2a1018" stroke-width="0.8" fill="none" opacity="0.7"/>' +
    '<path d="M236 138q6 -1 7 4q-6 2 -8 -1ZM304 138q-6 -1 -7 4q6 2 8 -1Z" fill="#a07a48"/>' +
    '<path d="M218 92H322" stroke="#8a6a40" stroke-width="1.6"/><path d="M218 92h0.1M322 92h0.1" stroke="#a0804c" stroke-width="4" stroke-linecap="round"/>'
  return night + frame + curtains
}

// ── The chimney breast ───────────────────────────────────────────────────────────────────

/** Coursed stone: rows of rounded blocks in three tones over dark mortar, and the shadow it throws on the wall. */
function chimneyBreast(r: () => number, uid: string): string {
  const tones = ['', '', '']
  let y = CEIL
  let row = 0
  while (y < FLOOR - 2) {
    const h = Math.min(between(r, 9.5, 14), FLOOR - y)
    let x = BREAST_X0 - (row % 2 === 0 ? 0 : between(r, 6, 12))
    while (x < BREAST_X1 - 0.5) {
      const w = between(r, 15, 30)
      const a = Math.max(x, BREAST_X0)
      const b = Math.min(x + w, BREAST_X1)
      if (b - a > 3) tones[Math.floor(r() * 3) % 3] += box(a + 1.4, y + 1.4, b - a - 2.8, h - 2.8)
      x += w
    }
    y += h
    row++
  }
  const stone = (d: string, c: string): string => `<path d="${d}" fill="${c}" stroke="${c}"/>`
  return (
    `<path d="M${BREAST_X0 - 8} ${CEIL}h8v${FLOOR - CEIL}h-8ZM${BREAST_X1} ${CEIL}h8v${FLOOR - CEIL}h-8Z" fill="#0c0709" opacity="0.3"/>` +
    `<path d="M${BREAST_X0 - 3} ${CEIL}h3v${FLOOR - CEIL}h-3ZM${BREAST_X1} ${CEIL}h3v${FLOOR - CEIL}h-3Z" fill="#0c0709" opacity="0.3"/>` +
    `<rect x="${BREAST_X0}" y="${CEIL}" width="${BREAST_X1 - BREAST_X0}" height="${FLOOR - CEIL}" fill="${TONE.mortar}"/>` +
    `<g stroke-linejoin="round" stroke-width="2">${stone(tones[0] ?? '', '#4a3631')}${stone(tones[1] ?? '', '#41302c')}${stone(tones[2] ?? '', '#56413a')}</g>` +
    `<rect x="${BREAST_X0}" y="${CEIL}" width="${BREAST_X1 - BREAST_X0}" height="60" fill="url(#${uid}-under)"/>`
  )
}

// ── The fire: the HEARTH gauge ───────────────────────────────────────────────────────────

/** One flame tongue rising from (x, b): `w` half-wide at its root, `h` tall, its tip leaning by `lean`. */
function tongue(x: number, b: number, w: number, h: number, lean: number): string {
  return (
    `M${d1(x - w)} ${b}C${d1(x - w * 1.1)} ${d1(b - h * 0.45)} ${d1(x + lean * 0.2 - w * 0.5)} ${d1(b - h * 0.68)} ${d1(x + lean)} ${d1(b - h)}` +
    `C${d1(x + lean * 0.5 + w * 0.3)} ${d1(b - h * 0.7)} ${d1(x + w * 1.2)} ${d1(b - h * 0.42)} ${d1(x + w)} ${b}Z`
  )
}

type Tongue = { u: number; w: number; f: number; lean: number; dur: number; begin: number }

/** A layer of flame tongues: each one sways between three shapes, slowly, on its own clock. */
function flames(list: readonly Tongue[], spread: number, root: number, height: number, fill: string): string {
  return list
    .map(t => {
      const x = FX + t.u * spread
      const w = root * t.w
      const h = height * t.f * (1 - 0.3 * Math.abs(t.u))
      const lean = t.lean * height * 0.26
      const a = tongue(x, FIRE_BASE, w, h, lean)
      const b = tongue(x, FIRE_BASE, w * 0.9, h * 0.84, -lean * 0.7)
      const c = tongue(x, FIRE_BASE, w * 1.06, h * 1.08, lean * 0.2)
      return `<path d="${a}" fill="${fill}">${loop('d', `${a};${b};${c};${a}`, t.dur, t.begin, ease(4))}</path>`
    })
    .join('')
}

/** The split logs stacked in an iron cradle on the hearth's left. */
function woodpile(heat: number, palette: Palette): string {
  const logs: ReadonlyArray<readonly [number, number, number]> = [
    [60, 252.6, 4.6],
    [69.6, 253, 4.4],
    [79, 252.6, 4.6],
    [64.8, 244.6, 4.4],
    [74.2, 244.8, 4.4],
    [69.6, 236.8, 4.2],
  ]
  const ends = logs.map(([x, y, s]) => `M${d1(x - s)} ${y}a${s} ${s} 0 1 0 ${d1(2 * s)} 0a${s} ${s} 0 1 0 ${d1(-2 * s)} 0`).join('')
  const rings = logs.map(([x, y, s]) => `M${d1(x - s * 0.5)} ${y}a${d1(s * 0.5)} ${d1(s * 0.5)} 0 1 0 ${s} 0M${x} ${y}l${d1(s * 0.6)} ${d1(-s * 0.5)}`).join('')
  const lit = logs.map(([x, y, s]) => `M${x} ${d1(y - s)}a${s} ${s} 0 0 1 ${s} ${s}`).join('')
  return (
    `<path d="M54 258Q51 244 56 236M85 258Q88 244 83 236M54 258H85" stroke="${TONE.iron}" stroke-width="1.4" fill="none"/>` +
    `<path d="${ends}" fill="#8a5a38" stroke="#2e1a10" stroke-width="1.5"/>` +
    `<path d="${rings}" stroke="#5e3a22" stroke-width="0.5" fill="none"/>` +
    `<path d="${lit}" stroke="${palette.accent}" stroke-width="0.9" fill="none" opacity="${n(0.15 + 0.55 * heat)}"/>`
  )
}

/** The fireplace: firebox, logs, embers, the flames by `context`, sparks, arch, jambs and hearth. */
function hearth(uid: string, sceneId: string, palette: Palette, context: number | undefined): { defs: string; body: string } {
  const fr = rng(`${sceneId}-fire`)
  const lit = context !== undefined
  const c = context ?? 0
  const heat = lit ? 0.25 + 0.75 * c : 0.1
  const H = 14 + 68 * c
  const W = 20 + 15 * c
  // Every random draw is made whatever the fill, so the fire's shape only grows with it.
  const make = (count: number): Tongue[] =>
    Array.from({ length: count }, (_, i) => ({
      u: count === 1 ? 0 : (i / (count - 1)) * 2 - 1 + between(fr, -0.1, 0.1),
      w: between(fr, 0.8, 1.15),
      f: between(fr, 0.62, 1),
      lean: between(fr, -1, 1),
      dur: between(fr, 2.2, 3.6),
      begin: between(fr, 0, 3.6),
    }))
  const outer = make(5)
  const middle = make(3)
  const core = make(2)
  const sparkSeeds = Array.from({ length: 5 }, () => ({
    x: between(fr, -16, 16),
    lift: between(fr, 0.3, 0.7),
    rise: between(fr, 34, 62),
    dx: between(fr, -9, 9),
    size: between(fr, 0.6, 1.1),
    dur: between(fr, 3.4, 6),
    begin: between(fr, 0, 6),
  }))
  const outerFlicker = flicker(fr, 0.8, 1)
  const backFlicker = between(fr, 2.6, 3.6)

  const defs =
    linearY(`${uid}-fo`, FIRE_BASE, FIRE_BASE - H * 1.12, [
      [0, '#ff8a3c', 0.9],
      [0.45, '#f0612a', 0.78],
      [1, '#b3341a', 0],
    ]) +
    linearY(`${uid}-fm`, FIRE_BASE, FIRE_BASE - H * 0.8, [
      [0, '#ffd17a'],
      [0.5, palette.accent, 0.95],
      [1, '#f0612a', 0],
    ]) +
    linearY(`${uid}-fc`, FIRE_BASE, FIRE_BASE - H * 0.5, [
      [0, '#fffaf0'],
      [0.45, '#ffe6a6'],
      [1, '#ffc46a', 0],
    ]) +
    radialBox(`${uid}-ember`, [
      [0, '#ffd07a'],
      [0.4, '#ff7a32', 0.85],
      [1, '#a8301a', 0],
    ]) +
    radialBox(`${uid}-boxlight`, [
      [0, '#ff9a4a', 0.9],
      [0.5, '#e8602a', 0.35],
      [1, '#e8602a', 0],
    ]) +
    `<clipPath id="${uid}-box"><path d="${OPENING}"/></clipPath>` +
    blur(`${uid}-soft`, 1.3)

  // The firebox: soot, a smaller back wall for depth, splayed sides, a few courses of fire brick.
  let bricks = ''
  for (let y = 198, i = 0; y < 250; y += 6, i++) {
    bricks += `M104 ${y}H152`
    for (let x = 104 + (i % 2) * 6; x < 152; x += 12) bricks += `M${x} ${y}v6`
  }
  const firebox =
    `<path d="${OPENING}" fill="${TONE.soot}"/>` +
    `<path d="M104 251V198Q${FX} 180 152 198V251Z" fill="#1e1311"/>` +
    `<path d="${bricks}" stroke="#0e0707" stroke-width="0.6"/>` +
    '<path d="M92 258L104 251V198L92 192ZM164 258L152 251V198L164 192Z" fill="#160d0c"/>' +
    '<path d="M92 258L104 251H152L164 258Z" fill="#221512"/>' +
    `<ellipse cx="${FX}" cy="236" rx="${d1(36 + 16 * heat)}" ry="${d1(34 + 28 * heat)}" fill="url(#${uid}-boxlight)" opacity="${n(0.25 + 0.65 * heat)}">` +
    loop('opacity', `${n(0.21 + 0.55 * heat)};${n(0.25 + 0.65 * heat)};${n(0.22 + 0.6 * heat)};${n(0.25 + 0.65 * heat)}`, backFlicker, 1) +
    '</ellipse>'

  const embers = `<ellipse cx="${FX}" cy="253" rx="32" ry="6" fill="url(#${uid}-ember)">${loop('opacity', lit ? '0.8;1;0.8' : '0.6;1;0.6', 4.2, 1.5)}</ellipse>`

  const backLog =
    `<g transform="rotate(-6 ${FX} 246)"><rect x="101" y="240.5" width="55" height="8" rx="4" fill="#2b1912"/>` +
    `<ellipse cx="154" cy="244.5" rx="2.6" ry="4" fill="#6a3a22"/>` +
    `<path d="M104 241H150" stroke="${palette.accent}" stroke-width="0.8" opacity="${n(0.25 + 0.55 * heat)}"/></g>`

  // The flames, and the hot bed of light they rise from.
  const fire = lit
    ? `<ellipse cx="${FX}" cy="${FIRE_BASE - 1}" rx="${d1(W * 0.9)}" ry="${d1(4 + 3 * c)}" fill="#ffe2a0" opacity="${n(0.35 + 0.4 * c)}"/>` +
      `<g filter="url(#${uid}-soft)">${flames(outer, W * 0.78, W * 0.34, H, `url(#${uid}-fo)`)}${outerFlicker}</g>` +
      flames(middle, W * 0.5, W * 0.3, H * 0.72, `url(#${uid}-fm)`) +
      flames(core, W * 0.26, W * 0.24, H * 0.44, `url(#${uid}-fc)`)
    : ''

  const frontLog =
    `<g transform="rotate(5 ${FX} 252)"><rect x="98" y="248" width="60" height="9" rx="4.5" fill="#33201a"/>` +
    '<ellipse cx="100.5" cy="252.5" rx="3.2" ry="4.6" fill="#7a4428"/><ellipse cx="100.5" cy="252.5" rx="1.6" ry="2.4" fill="none" stroke="#4a2818" stroke-width="0.6"/>' +
    `<path d="M104 248.6H154" stroke="${palette.accent}" stroke-width="0.9" opacity="${n(0.3 + 0.6 * heat)}"/>` +
    `<path d="M110 251.5l6 1.2l5 -1.6M128 252l8 1.4M141 250.8l6 1.2" stroke="#ff9a4a" stroke-width="0.9" fill="none" stroke-linecap="round">${loop('opacity', '0.4;1;0.55;0.4', 3.6, 0.8)}</path></g>`

  // Coals heaped along the front, catching the glow from behind.
  const coals =
    '<path d="M97 258q2 -4 5 -1q2 -3.6 5 -0.6q3 -3 6 0q2 -3 5 0.4q3 -3.4 6 -0.2q2 -3 5 0q3 -3.6 6 -0.4q2 -3 5 0.2q3 -3 5 1.6Z" fill="#2a1410"/>' +
    `<path d="M99 256.5q2 -2 4 0M110 256q2 -2 4 0M121 256.4q2 -2 4 0M133 256q2 -2 4 0M145 256.4q2 -2 4 0" stroke="#ff8a3c" stroke-width="0.9" fill="none" opacity="${n(0.55 + 0.4 * heat)}"/>` +
    (lit ? '' : `<ellipse cx="${FX}" cy="252" rx="30" ry="7" fill="url(#${uid}-ember)" opacity="0.5">${loop('opacity', '0.3;0.6;0.3', 5.5, 2.5)}</ellipse>`)

  const shown = lit ? 2 + Math.round(3 * c) : 1
  const sparks = sparkSeeds
    .slice(0, shown)
    .map(s => {
      const y = FIRE_BASE - (lit ? H * s.lift : 6)
      return (
        `<circle cx="${d1(FX + s.x)}" cy="${d1(y)}" r="${d1(s.size)}" fill="#ffd08a" opacity="0">` +
        drift(`0 0;${d1(s.dx / 2)} ${d1(-s.rise / 2)};${d1(s.dx)} ${d1(-s.rise)}`, s.dur, s.begin) +
        loop('opacity', '0;1;0.7;0', s.dur, s.begin) +
        '</circle>'
      )
    })
    .join('')

  const andirons =
    `<path d="M101 258v-11q0 -2.6 2.4 -2.6t2.4 2.6v11ZM150.2 258v-11q0 -2.6 2.4 -2.6t2.4 2.6v11Z" fill="${TONE.iron}"/>` +
    `<path d="M102.2 246.6q1.2 -1.2 2.4 0M151.4 246.6q1.2 -1.2 2.4 0" stroke="${palette.accent}" stroke-width="0.6" fill="none" opacity="${n(0.3 + 0.6 * heat)}"/>`

  // The arch of dressed stones with its keystone, and the quoined jambs.
  const quad = (t: number, x0: number, cy: number, x2: number): [number, number] => {
    const u = 1 - t
    return [u * u * x0 + 2 * u * t * FX + t * t * x2, u * u * 192 + 2 * u * t * cy + t * t * 192]
  }
  let joints = ''
  for (let i = 1; i < 7; i++) {
    const [ax, ay] = quad(i / 7, 92, 160, 164)
    const [bx, by] = quad(i / 7, 82, 140, 174)
    joints += `M${d1(ax)} ${d1(ay)}L${d1(bx)} ${d1(by)}`
  }
  const quoins = [192, 207, 222, 237].map((y, i) => (i % 2 === 0 ? box(80, y + 0.6, 12, 13.8) + box(164, y + 0.6, 12, 13.8) : box(84, y + 0.6, 8, 13.8) + box(164, y + 0.6, 8, 13.8))).join('')
  const arch =
    `<path d="M82 192Q${FX} 140 174 192H164Q${FX} 160 92 192Z${quoins}" fill="#57433b"/>` +
    `<path d="${joints}" stroke="${TONE.mortar}" stroke-width="1.1"/>` +
    '<path d="M121.5 165.5L123 178H133L134.5 165.5Z" fill="#634c42"/>' +
    `<path d="M92 192Q${FX} 160 164 192M92.5 193V258M163.5 193V258" stroke="${palette.accent}" stroke-width="0.9" fill="none" opacity="${n(0.15 + 0.5 * heat)}"/>`

  const slab =
    '<path d="M48 258H208V261.5H48Z" fill="#5a4640"/><path d="M48 261.5H208V269H48Z" fill="#33251f"/>' +
    `<path d="M90 258.4H166" stroke="${palette.accent}" stroke-width="1.4" opacity="${n(0.2 + 0.65 * heat)}"/>` +
    '<path d="M48 261.6H208" stroke="#7a5e52" stroke-width="0.6" opacity="0.6"/>'

  const body =
    firebox +
    `<g clip-path="url(#${uid}-box)">${embers}${backLog}${fire}${frontLog}${coals}${sparks}${andirons}</g>` +
    arch +
    slab +
    woodpile(heat, palette)
  return { defs, body }
}

// ── The mantel and its candles: the swarm ────────────────────────────────────────────────

/** The oak mantel on its corbels, a stack of books and a bell at one end, trailing ivy at the other. */
function mantel(uid: string, heat: number, palette: Palette): string {
  const m = MANTEL
  return (
    `<path d="M54 150h11v5q0 9 -8 11h-3ZM202 150h-11v5q0 9 8 11h3Z" fill="#2c1a13"/>` +
    `<rect x="46" y="${m - 1}" width="164" height="3" fill="#6a4430"/>` +
    `<rect x="46" y="${m + 2}" width="164" height="12" fill="#4a2e21"/><rect x="46" y="${m + 10}" width="164" height="4" fill="#3a2218"/>` +
    `<path d="M48 ${m + 5.5}Q90 ${m + 4} 130 ${m + 6}T208 ${m + 5}M50 ${m + 10}Q100 ${m + 11.5} 150 ${m + 9.5}T207 ${m + 11}" stroke="#2a180f" stroke-width="0.6" fill="none" opacity="0.7"/>` +
    `<rect x="48" y="${m + 14}" width="160" height="2.2" fill="${palette.accent}" opacity="${n(0.12 + 0.5 * heat)}"/>` +
    // Books lying flat, a small brass bell on top.
    `<path d="${box(51, m - 5, 16, 4)}" fill="#3c4a3e"/><path d="${box(52.5, m - 8.6, 13, 3.6)}" fill="#6b2e2e"/>` +
    `<path d="M52 ${m - 3}h14M53.5 ${m - 6.8}h11" stroke="#b08a50" stroke-width="0.5" opacity="0.6"/>` +
    `<path d="M57 ${m - 8.6}q0 -4.6 3 -4.6t3 4.6ZM59.1 ${m - 14}a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0" fill="#a8844c"/>` +
    // A pot of ivy at the right end, trailing over the edge.
    `<path d="M193 ${m - 1}l-1.4 -9h13.2l-1.4 9Z" fill="#7a3f2a"/><path d="M191.4 ${m - 10}h13.4" stroke="#9a5638" stroke-width="1.4"/>` +
    `<path d="M198 ${m - 11}q-5 -6 -9 -5M198 ${m - 11}q4 -7 9 -6M199 ${m - 11}q-1 -6 2 -9M203 ${m - 2}q4 8 2 18q-1 6 1 11M194 ${m}q-2 8 0 14" stroke="#4f6e56" stroke-width="0.8" fill="none"/>` +
    `<path d="M189 ${m - 16}q-3 -1 -3 2q2 2 3 -2ZM207 ${m - 17}q3 -1 3 2q-2 2 -3 -2ZM201 ${m - 20}q2 -3 4 -1q-2 3 -4 1ZM193 ${m - 14}q-2 -3 1 -4q2 2 -1 4Z` +
    `M206 ${m + 6}q3 1 2 4q-3 0 -2 -4ZM204 ${m + 14}q-3 1 -2 4q3 0 2 -4ZM206 ${m + 22}q3 1 2 4q-3 0 -2 -4ZM194 ${m + 8}q-3 1 -2 4q3 0 2 -4Z" fill="${palette.accent2}" opacity="0.8"/>`
  )
}

/** The shapes every candle shares, drawn once: a taper in its brass stick, a pillar, a flame. */
function candleDefs(uid: string): string {
  return (
    `<g id="${uid}-taper"><path d="M-3.6 -0.6a3.6 1 0 0 0 7.2 0a3.6 1 0 0 0 -7.2 0ZM-0.9 -0.6V-3h1.8v2.4Z" fill="#a8844c"/>` +
    `<rect x="-1.4" y="-14" width="2.8" height="11" fill="url(#${uid}-wax)"/><path d="M-1.4 -14a1.4 0.5 0 0 0 2.8 0a1.4 0.5 0 0 0 -2.8 0M0.4 -14v3" stroke="#fbf1dc" stroke-width="0.8" fill="#fbf1dc"/></g>` +
    `<g id="${uid}-pillar"><rect x="-3" y="-9" width="6" height="9" fill="url(#${uid}-wax)"/><path d="M-3 -9a3 1 0 0 0 6 0a3 1 0 0 0 -6 0M1 -9v4" stroke="#fbf1dc" stroke-width="0.9" fill="#fbf1dc"/></g>` +
    `<g id="${uid}-flame"><path d="M0 -6.6C1 -4.2 2 -2.7 1.7 -1.3C1.4 0.3 -1.4 0.3 -1.7 -1.3C-2 -2.7 -1 -4.2 0 -6.6Z" fill="url(#${uid}-cflame)"/><ellipse cy="-1.6" rx="0.7" ry="1.3" fill="#fff6e0"/></g>`
  )
}

/** One candle on the mantel at x: a taper or a pillar, its flame swaying, its glow flickering. */
function candle(uid: string, r: () => number, x: number, k: number): string {
  const taper = k >= 0.42
  const sy = taper ? 0.85 + k * 0.35 : 0.65 + k * 0.9
  const sx = taper ? 1 : 0.8 + k * 0.6
  const wick = taper ? -(3 + 11 * sy) - 0.6 : -9 * sy - 0.6
  const dur = between(r, 2.4, 3.6)
  return (
    `<g transform="translate(${d1(x)} ${MANTEL})">` +
    `<circle cy="${d1(wick - 3)}" r="${d1(9 + k * 3)}" fill="url(#${uid}-cglow)">${loop('opacity', `1;${d1(between(r, 0.6, 0.8))};${d1(between(r, 0.85, 1))};${d1(between(r, 0.6, 0.75))};1`, between(r, 2.6, 4.6), between(r, 0, 4))}</circle>` +
    `<use href="#${uid}-${taper ? 'taper' : 'pillar'}" transform="scale(${d1(sx)} ${n(sy)})"/>` +
    `<g transform="translate(0 ${d1(wick)})"><use href="#${uid}-flame">` +
    `<animateTransform attributeName="transform" type="scale" values="1 1;.92 1.1;1.05 .94;.97 1.06;1 1" dur="${d1(dur)}s" begin="${d1(-between(r, 0, dur))}s" repeatCount="indefinite"/>` +
    '</use></g></g>'
  )
}

/** One lit candle per active subagent, spread along the mantel between its ornaments. */
function candles(uid: string, sceneId: string, swarm: number): string {
  const cr = rng(`${sceneId}-candles`)
  return swarmSpots(sceneId, { x0: 72, y0: MANTEL, x1: 186, y1: MANTEL }, swarm)
    .map(spot => candle(uid, cr, spot.x, spot.k))
    .join('')
}

// ── The rug, the dog, the chair, the lamp, the tea ───────────────────────────────────────

/** A braided oval rug before the hearth. */
function rug(): string {
  return (
    '<ellipse cx="132" cy="292" rx="118" ry="24" fill="#3a1a1c"/>' +
    '<g fill="none"><ellipse cx="132" cy="292" rx="112" ry="21.5" stroke="#8a5a34" stroke-width="2.2" opacity="0.75"/>' +
    '<ellipse cx="132" cy="292" rx="104" ry="19" stroke="#6a2a2c" stroke-width="3"/>' +
    '<ellipse cx="132" cy="292" rx="94" ry="16.5" stroke="#7a6a4a" stroke-width="1.2" opacity="0.5"/></g>' +
    '<ellipse cx="132" cy="292" rx="82" ry="14" fill="#4a2224"/>' +
    '<path d="M132 282L156 292L132 302L108 292Z" fill="none" stroke="#8a5a34" stroke-width="1.2" opacity="0.6"/>' +
    '<path d="M132 286L144 292L132 298L120 292Z" fill="#5e3a3e" opacity="0.8"/>'
  )
}

/** The pool of firelight on the floor before the hearth. */
function floorGlow(uid: string, heat: number): string {
  return `<ellipse cx="${FX}" cy="274" rx="${d1(56 + 110 * heat)}" ry="${d1(10 + 16 * heat)}" fill="url(#${uid}-pool)" opacity="${n(0.25 + 0.6 * heat)}"/>`
}

/** A golden dog asleep on the rug, head on its paws toward the fire, breathing slowly; the fire rims its back. */
function dog(uid: string, heat: number, palette: Palette): string {
  const rim = n(0.3 + 0.6 * heat)
  const body =
    '<path d="M60 298C55 289 63 280 78 279C95 277 112 279 119 287C123 292 122 298 118 298Z" fill="url(#' +
    `${uid}-dog)"/>` +
    '<path d="M97 297C97 289 104 284 113 285" stroke="#5a341e" stroke-width="0.9" fill="none" opacity="0.7"/>' +
    `<path d="M66 284C77 278.4 99 277.2 115 283" stroke="${palette.accent}" stroke-width="1.3" fill="none" stroke-linecap="round" opacity="${rim}"/>`
  return (
    '<ellipse cx="80" cy="299" rx="47" ry="3.6" fill="#120909" opacity="0.55"/>' +
    '<path d="M120 296C128 295 129 288 124 285" stroke="#9a6238" stroke-width="3.6" fill="none" stroke-linecap="round"/>' +
    `<g transform="translate(88 298)"><g><animateTransform attributeName="transform" type="scale" values="1 1;1.01 1.05;1 1" dur="4.6s" begin="-1.2s" repeatCount="indefinite"${ease(3)}/>` +
    `<g transform="translate(-88 -298)">${body}</g></g></g>` +
    // The head resting on its paws, ear flopped, eyes shut.
    '<path d="M31 298.4h15v-3.4h-12.6q-2.6 0 -2.4 3.4Z" fill="#d4a674"/>' +
    '<path d="M38 296C35 292 38 287 44 286C50 284 58 284 63 287C67 290 66 296 62 298H42Z" fill="#a8703f"/>' +
    '<path d="M38 296C36 293 38 290 42 289.4C45 289 47.4 291 47.4 294C47.4 296.6 44 297.8 41 297.6Z" fill="#cc9c68"/>' +
    '<path d="M36.4 292.4a1.4 1.1 0 1 0 2.8 0a1.4 1.1 0 1 0 -2.8 0" fill="#1c100c"/>' +
    '<path d="M54 286C50 287 49 293 51 297.4C55 297 58 292 57.6 286.4Z" fill="#6a3e22"/>' +
    '<path d="M45.6 289.4q1.6 1.1 3.2 0" stroke="#24140c" stroke-width="0.8" fill="none" stroke-linecap="round"/>' +
    `<path d="M41 287.4C46 284.4 54 283.6 61 285.8" stroke="${palette.accent}" stroke-width="1" fill="none" stroke-linecap="round" opacity="${rim}"/>`
  )
}

/** The reading lamp at the chair's shoulder: pole, pleated shade and a soft breathing halo. */
function readingLamp(uid: string): string {
  const x = 326
  return (
    `<circle cx="${x}" cy="142" r="50" fill="url(#${uid}-cglow)" opacity="0.45">${loop('opacity', '0.35;0.5;0.35', 11, 3)}</circle>` +
    `<path d="M${x} 150V292" stroke="#2a1c16" stroke-width="1.8"/><ellipse cx="${x}" cy="293" rx="9" ry="2.2" fill="#2a1c16"/>` +
    `<path d="M${x - 15} 150L${x - 11} 127H${x + 11}L${x + 15} 150Z" fill="url(#${uid}-shade)"/>` +
    `<path d="M${x - 7} 128L${x - 9} 149M${x} 127V150M${x + 7} 128L${x + 9} 149" stroke="#8a5a32" stroke-width="0.5" opacity="0.5"/>` +
    `<ellipse cx="${x}" cy="150" rx="15" ry="2" fill="#ffe2ac" opacity="0.85"/>`
  )
}

/** The wingback armchair, angled toward the fire, a knitted throw tossed over its back. */
function armchair(uid: string, heat: number, palette: Palette): string {
  const rim = n(0.2 + 0.65 * heat)
  const throwD = 'M262 167Q281 157 303 166L309 174L310 238Q308 246 310 254L306 251.6L303 255.6L300 251.6L297 255.6L294 251.6L291 255L288.6 250Q284 212 262 167Z'
  return (
    '<ellipse cx="268" cy="292" rx="56" ry="5" fill="#0e0708" opacity="0.6"/>' +
    // far wing and back, buttoned
    `<path d="M300 172Q314 174 318 190L319 230L306 232Z" fill="${TONE.velvetDark}"/>` +
    `<path d="M250 236L248 184Q250 166 270 162Q294 158 306 172L309 236Z" fill="#3e1a21"/>` +
    '<path d="M256.6 190h0.1M268.6 186h0.1M256.6 210h0.1M270.6 206h0.1M262.6 228h0.1M276.6 226h0.1" stroke="#1e0b0e" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M256.6 190L268.6 206M268.6 186L256.6 210M256.6 210L262.6 228M270.6 206L262.6 228" stroke="#22100f" stroke-width="0.5" opacity="0.5"/>' +
    // the knitted throw: draped over the crest and falling to the seat, fringed
    `<path d="${throwD}" fill="url(#${uid}-throw)"/><path d="${throwD}" fill="url(#${uid}-knit)"/>` +
    '<path d="M262 167Q281 157 303 166Q298 171 284 170Q271 170 262 167Z" fill="#d2bb98"/>' +
    '<path d="M272 176Q289 200 295 246M285 170Q300 192 303 240" stroke="#6a5642" stroke-width="0.9" fill="none" opacity="0.55"/>' +
    `<path d="M262.6 168Q280 196 288.6 250" stroke="${palette.accent}" stroke-width="0.9" fill="none" opacity="${n(0.15 + 0.4 * heat)}"/>` +
    // far arm, seat, apron
    `<path d="M300 230Q312 226 320 232L321 276L309 278Z" fill="${TONE.velvetDark}"/>` +
    '<path d="M240 240Q272 233 306 235L311 246Q274 245 236 252Z" fill="#5e2830"/>' +
    `<path d="M236 252Q274 245 311 246L313 278Q274 281 233 286Z" fill="${TONE.velvetDark}"/>` +
    '<path d="M236 262Q274 256 312 257" stroke="#1e0b0e" stroke-width="0.8" fill="none" opacity="0.7"/>' +
    // near wing and arm, lit by the fire; the arm's rolled front
    `<path d="M249 182Q238 183 233 196Q230 208 232 224L251 222ZM214 234Q214 223 224 221L250 219Q258 221 257 230L257 284L219 290Q215 262 214 234Z" fill="url(#${uid}-velvet)"/>` +
    '<ellipse cx="221" cy="232" rx="7.4" ry="9.6" fill="#6e3034"/><ellipse cx="221.6" cy="231" rx="3.6" ry="5" fill="#7c3a3a" opacity="0.6"/>' +
    '<path d="M222 222L252 220" stroke="#7a3a3a" stroke-width="0.8" opacity="0.7"/>' +
    // rim light from the fire on everything facing it, lamplight on the far shoulder
    `<path d="M248 182Q238 183 233 196Q230 208 232 222M214.4 236Q213.6 226 222 222.4M214.6 240Q215 266 219 289" stroke="${palette.accent}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="${rim}"/>` +
    '<path d="M306 172Q312 174 316 182" stroke="#ffcf8a" stroke-width="1" fill="none" opacity="0.45"/>' +
    '<path d="M249 184Q250 167 266 163M263 166Q281 156.6 303 165.4" stroke="#a9b8d4" stroke-width="0.9" fill="none" stroke-linecap="round" opacity="0.4"/>' +
    '<path d="M221 289v7M255 284v6M311 278v6" stroke="#24140e" stroke-width="2.6" stroke-linecap="round"/>'
  )
}

/** The little round table: a teapot and a sage cup, steam curling up from both. */
function teaTable(uid: string, r: () => number, heat: number, palette: Palette): string {
  const table =
    '<path d="M203 248V291" stroke="#2c1a12" stroke-width="3"/>' +
    '<path d="M203 290l-11 6M203 290l11 6M203 290v8" stroke="#2c1a12" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M182 244v2.8a21 4.6 0 0 0 42 0V244Z" fill="#2c1a12"/>' +
    '<ellipse cx="203" cy="244" rx="21" ry="4.6" fill="#4a2e20"/>' +
    `<path d="M183 244.6a21 4.6 0 0 0 8 3.4" stroke="${palette.accent}" stroke-width="0.9" fill="none" opacity="${n(0.2 + 0.5 * heat)}"/>` +
    '<ellipse cx="203" cy="244" rx="15" ry="2.8" fill="#e8dcc8" opacity="0.15"/>'
  const pot =
    `<path d="M186 236Q181 234 180 226L178.6 224.6Q181 224 182.6 225.6Q184 231 188 232Z" fill="url(#${uid}-pot)"/>` +
    `<ellipse cx="194" cy="235" rx="9.6" ry="7.4" fill="url(#${uid}-pot)"/>` +
    '<path d="M202.6 230q5 -1 5 4q0 4 -5.6 4.6" stroke="#c4b096" stroke-width="1.6" fill="none"/>' +
    '<path d="M188.6 228.6q5.4 -3.4 10.8 0ZM192.7 225.6a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0" fill="#d8c8ae"/>' +
    '<path d="M185 235.6q9 3.4 18 0" stroke="#a0503a" stroke-width="1.6" fill="none" opacity="0.85"/>' +
    `<path d="M187 231q1 -3 4 -4" stroke="#fff3dc" stroke-width="0.9" fill="none" stroke-linecap="round" opacity="${n(0.35 + 0.5 * heat)}"/>`
  const cup =
    '<ellipse cx="214" cy="243" rx="6.6" ry="1.5" fill="#e6d9c2"/>' +
    `<path d="M209.6 236.4h8.8l-1 5.2q-0.6 1.4 -3.4 1.4t-3.4 -1.4Z" fill="url(#${uid}-cup)"/>` +
    '<path d="M218.2 237.6q2.8 0 2.4 2.2q-0.4 1.6 -2.8 1.4" stroke="#7fa088" stroke-width="0.9" fill="none"/>' +
    '<ellipse cx="214" cy="236.4" rx="4.4" ry="0.9" fill="#6a3a1e"/>' +
    '<path d="M210.2 237.4q0.4 3 1.6 4.4" stroke="#d6eadb" stroke-width="0.6" fill="none" opacity="0.7"/>'
  // Steam: soft wisps rising and thinning away, each on its own slow clock.
  const wisps: ReadonlyArray<readonly [number, number, number]> = [
    [179, 222, 1],
    [214, 234, 0.9],
    [182, 220, 0.7],
  ]
  const steam = wisps
    .map(([x, y, s]) => {
      const dur = between(r, 5.5, 7.5)
      const begin = between(r, 0, dur)
      return (
        `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0c-3 -4 3 -7 0 -11s3 -7 0 -11" stroke="#f5e6d6" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0">` +
        drift('0 2;-1.5 -8;-3 -18', dur, begin) +
        loop('opacity', '0;0.5;0.3;0', dur, begin) +
        '</path></g>'
      )
    })
    .join('')
  return table + pot + cup + `<g filter="url(#${uid}-steamblur)">${steam}</g>`
}

/** A knitting basket by the chair: yarn balls and needles, a strand trailing to the floor. */
function basket(): string {
  return (
    '<path d="M268 293Q280 289 300 293L297 306Q284 309 271 306Z" fill="#5a3a22"/>' +
    '<path d="M269 297Q284 294 299 297M270 301Q284 298 298 301M276 292l-1 15M284 291v17M292 292l1 15" stroke="#3a2416" stroke-width="0.7" fill="none"/>' +
    '<circle cx="277" cy="289" r="5" fill="#a0502e"/><path d="M273 287q4 -2 8 1M273 290q4 -2 8 1" stroke="#7a3a20" stroke-width="0.6" fill="none"/>' +
    '<circle cx="288" cy="288.6" r="4.6" fill="#7d9a84"/><path d="M284.6 287q3.4 -2 7 0.6" stroke="#5e7a64" stroke-width="0.6" fill="none"/>' +
    '<path d="M281 288L295 272M283 289L300 278" stroke="#c9a46a" stroke-width="0.8" stroke-linecap="round"/><path d="M295 272h0.1M300 278h0.1" stroke="#c9a46a" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M272 290Q262 296 266 306T258 318" stroke="#a0502e" stroke-width="0.7" fill="none"/>'
  )
}

// ── Gradients and patterns ───────────────────────────────────────────────────────────────

function defsFor(uid: string, palette: Palette, glowR: number): string {
  const panelH = SKIRT - RAIL - 3
  return (
    linearY(`${uid}-ceil`, TOP, CEIL, [
      [0, '#0f0a0d'],
      [0.7, TONE.ceiling],
      [1, '#22171a'],
    ]) +
    linearY(`${uid}-beam`, 64, CEIL + 2, [
      [0, '#2e1c15'],
      [0.75, '#3a2419'],
      [1, '#4a2f21'],
    ]) +
    linearY(`${uid}-wall`, CEIL, FLOOR, [
      [0, palette.sky[0]],
      [0.45, palette.sky[1]],
      [1, '#33212a'],
    ]) +
    linearY(`${uid}-under`, CEIL, CEIL + 34, [
      [0, '#0c0709', 0.6],
      [1, '#0c0709', 0],
    ]) +
    `<pattern id="${uid}-paper" patternUnits="userSpaceOnUse" y="${CEIL}" width="16" height="24">` +
    '<path d="M0 0h1.2v24H0ZM8 9l2 3l-2 3l-2 -3ZM7.1 0a0.9 0.9 0 0 0 1.8 0ZM7.1 24a0.9 0.9 0 0 1 1.8 0Z" fill="#3e2a37"/></pattern>' +
    `<pattern id="${uid}-panel" patternUnits="userSpaceOnUse" y="${RAIL + 3}" width="44" height="${panelH}">` +
    `<path d="M0 0h44v${panelH}H0Z" fill="#2a1814"/><path d="M0 0h3v${panelH}H0Z" fill="#22130f"/>` +
    `<path d="M8 6h31v${panelH - 12}H8Z" fill="#2e1b16" stroke="#1c0f0c"/>` +
    `<path d="M9 ${panelH - 6.5}H38.5V7" stroke="#3d2519" stroke-width="0.8" fill="none"/></pattern>` +
    `<pattern id="${uid}-knit" patternUnits="userSpaceOnUse" width="4" height="3.4"><path d="M0 0L2 2.6L4 0" fill="none" stroke="#3a2a1c" stroke-opacity="0.35" stroke-width="0.7"/></pattern>` +
    linearY(`${uid}-floor`, FLOOR, 380, [
      [0, '#2e1c16'],
      [1, '#1a1110'],
    ]) +
    `<radialGradient id="${uid}-room" gradientUnits="userSpaceOnUse" cx="${FX}" cy="222" r="${d1(glowR)}">` +
    `<stop stop-color="${palette.accent}" stop-opacity="0.55"/><stop offset="0.3" stop-color="${palette.accent}" stop-opacity="0.24"/>` +
    `<stop offset="0.65" stop-color="#e0602a" stop-opacity="0.07"/><stop offset="1" stop-color="#e0602a" stop-opacity="0"/></radialGradient>` +
    radialBox(`${uid}-pool`, [
      [0, palette.accent, 0.5],
      [0.5, palette.accent, 0.2],
      [1, palette.accent, 0],
    ]) +
    radialBox(`${uid}-cglow`, [
      [0, '#ffc27a', 0.6],
      [0.35, palette.accent, 0.22],
      [1, palette.accent, 0],
    ]) +
    linearY(`${uid}-cflame`, -6.6, 0, [
      [0, '#ffb45a'],
      [0.5, '#ffe2a0'],
      [1, '#fff6e0'],
    ]) +
    across(`${uid}-wax`, [
      [0, '#e8d6b8'],
      [0.45, '#fbf0da'],
      [1, '#b89c7c'],
    ]) +
    candleDefs(uid) +
    across(`${uid}-shade`, [
      [0, '#c98a4c'],
      [0.5, '#e6b06a'],
      [1, '#a0643a'],
    ]) +
    linearY(`${uid}-night`, WIN.y0, WIN.y1, [
      [0, '#0e1326'],
      [0.6, '#1a2340'],
      [1, '#2a3354'],
    ]) +
    linearY(`${uid}-frost`, WIN.y1 - 22, WIN.y1, [
      [0, '#e8eef8', 0],
      [1, '#e8eef8', 0.3],
    ]) +
    linearX(`${uid}-curtain`, 220, 320, [
      [0, '#6a2e38'],
      [0.25, '#4e2430'],
      [0.75, '#3e1c26'],
      [1, '#4a2230'],
    ]) +
    linearX(`${uid}-velvet`, 212, 258, [
      [0, '#7e3a38'],
      [0.5, '#5a252c'],
      [1, '#3e1a20'],
    ]) +
    linearX(`${uid}-throw`, 262, 310, [
      [0, '#c8af8c'],
      [0.6, '#9c8468'],
      [1, '#6e5a46'],
    ]) +
    linearY(`${uid}-dog`, 278, 298, [
      [0, '#c8925a'],
      [0.55, '#9a6238'],
      [1, '#4e2e1a'],
    ]) +
    linearX(`${uid}-pot`, 180, 204, [
      [0, '#f6e8d0'],
      [0.5, '#d8c4a6'],
      [1, '#8e7a64'],
    ]) +
    linearX(`${uid}-cup`, 209, 219, [
      [0, '#c4e0cc'],
      [0.5, palette.accent2],
      [1, '#5e7e68'],
    ]) +
    blur(`${uid}-steamblur`, 0.9)
  )
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const lit = context !== undefined
  const heat = lit ? 0.25 + 0.75 * (context ?? 0) : 0.1
  const glowR = 90 + 230 * heat
  const glowA = 0.25 + 0.6 * heat
  const fire = hearth(uid, scene.id, palette, context)
  const defs = defsFor(uid, palette, glowR) + fire.defs

  // Far to near: the ceiling and walls, what hangs and stands against them, the alcove shelves, the
  // window, the chimney breast, the floor and its rug.
  const back =
    ceiling(uid) +
    herbs() +
    walls(uid) +
    farLeft(r, uid) +
    farRight(r, uid) +
    bookcase(r, 2, 56, 94, [128, 162, 196]) +
    windowLayer(r, uid) +
    chimneyBreast(r, uid) +
    floor(uid) +
    rug()

  // The firelight over everything behind the fire: stronger and wider as the context fills.
  const firelight =
    `<rect x="${d1(FX - glowR)}" y="${d1(222 - glowR)}" width="${d1(glowR * 2)}" height="${d1(glowR * 2)}" fill="url(#${uid}-room)" opacity="${n(glowA)}">` +
    loop('opacity', `${n(glowA * 0.88)};${n(glowA)};${n(glowA * 0.92)};${n(glowA * 0.98)};${n(glowA * 0.88)}`, 5.2, 2) +
    '</rect>'

  const caption = gaugeCaption({ x: FX, y: 98, name: scene.gauge, value: contextText, palette, anchor: 'middle' })

  const body =
    back +
    firelight +
    fire.body +
    floorGlow(uid, heat) +
    mantel(uid, heat, palette) +
    candles(uid, scene.id, swarm) +
    readingLamp(uid) +
    armchair(uid, heat, palette) +
    teaTable(uid, r, heat, palette) +
    dog(uid, heat, palette) +
    basket() +
    caption
  return { defs, body }
}
