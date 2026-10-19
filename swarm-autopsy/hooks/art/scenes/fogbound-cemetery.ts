// Fogbound Cemetery: an overcast dusk, a chapel with one faint window on the far rise, a
// crooked bare tree, leaning headstones half lost in drifting fog, and an iron fence. The
// lantern on the gate post is the main context gauge: its glass fills with lit oil as the
// context window fills, and the glow around it grows. Each active subagent is a crow on the
// fence rail.

import type { Painted, PaintArgs } from '../scene.ts'
import {
  BLEED,
  SCENE_W,
  bareTree,
  between,
  blur,
  crow,
  distantFlash,
  flicker,
  fog,
  fogDefs,
  gaugeCaption,
  headstone,
  hills,
  linearBox,
  loop,
  n,
  radialBox,
  swarmSpots,
} from '../kit.ts'

const L = -BLEED
const R = SCENE_W + BLEED

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const defs =
    radialBox(`${uid}-haze`, [
      [0, '#d9d6cc', 0.55],
      [0.4, '#b9b6ae', 0.25],
      [1, '#b9b6ae', 0],
    ]) +
    radialBox(`${uid}-lamp`, [
      [0, palette.accent, 0.9],
      [0.35, palette.accent, 0.35],
      [1, palette.accent, 0],
    ]) +
    linearBox(`${uid}-oil`, [
      [0, '#fff1c4'],
      [1, palette.accent],
    ]) +
    fogDefs(uid) +
    blur(`${uid}-soft`, 1.4)

  // A sun gone pale behind the overcast, and a far-off flash now and then.
  const haze = `<circle cx="248" cy="128" r="58" fill="url(#${uid}-haze)">${loop('r', '56;61;56', 14, 3)}</circle>`
  const flash = distantFlash({ color: '#cfd6e0', opacity: 0.08, dur: 23, begin: 9 })

  // The far rise with its chapel: nave, spire, one window that never quite goes out.
  const farRise = hills(r, { x0: L, x1: R, y: 214, amp: 14, bottom: 420, fill: '#3b3e44', bumps: 7 })
  const chapel =
    '<g fill="#2f3237">' +
    '<rect x="58" y="176" width="44" height="34"/>' +
    '<path d="M54 178 L80 160 L106 178 Z"/>' +
    '<rect x="94" y="140" width="14" height="44"/>' +
    '<path d="M92 142 L101 112 L110 142 Z"/>' +
    '<rect x="100" y="104" width="1.6" height="10"/><rect x="97" y="107" width="7.6" height="1.6"/>' +
    '</g>' +
    `<path d="M76 192 a4 4 0 0 1 8 0 v8 h-8 Z" fill="${palette.accent}" opacity="0.55">${flicker(r, 0.35, 0.75)}</path>` +
    `<path d="M98 152 a3 3 0 0 1 6 0 v6 h-6 Z" fill="#1f2125"/>`

  // Mid ground and the crooked tree on the right.
  const midGround = `<path d="M${L} 252 Q40 238 130 244 Q220 252 300 238 Q340 232 ${R} 240 L${R} 440 L${L} 440 Z" fill="#2a2c31"/>`
  const tree = bareTree(r, { x: 286, y: 258, h: 150, color: '#1b1c20', lean: -0.12, width: 6 })
  const smallTree = bareTree(r, { x: 22, y: 236, h: 70, color: '#2a2c31', lean: 0.15, width: 2.6 })

  // Headstones: a far row in the haze, a nearer row darker and leaning.
  const far = [
    [40, 248, 9, 14, 'round'],
    [70, 246, 7, 15, 'cross'],
    [134, 250, 10, 12, 'slab'],
    [168, 249, 8, 14, 'round'],
    [214, 247, 7, 16, 'cross'],
    [248, 246, 9, 12, 'round'],
  ] as const
  const near = [
    [26, 284, 15, 24, 'round', -6],
    [118, 280, 13, 22, 'slab', 4],
    [156, 286, 12, 30, 'cross', -3],
    [204, 282, 16, 22, 'round', 7],
    [252, 288, 14, 26, 'round', -4],
    [318, 284, 12, 28, 'cross', 5],
  ] as const
  const farStones = far.map(([x, y, w, h, kind]) => headstone({ x, y, w, h, kind, fill: '#4b4e54', shade: '#3a3c41', lean: between(r, -5, 5) })).join('')
  const nearStones = near.map(([x, y, w, h, kind, lean]) => headstone({ x, y, w, h, kind, fill: '#5b5e64', shade: '#34363b', lean })).join('')
  const nearGround = `<path d="M${L} 290 Q70 280 170 288 Q260 294 ${R} 282 L${R} 460 L${L} 460 Z" fill="#1d1e22"/>`

  // Fog, far to near, drifting at different speeds.
  const farFog = fog({ uid, y: 236, width: 420, color: '#a3a7ac', opacity: 0.32, dur: 52, begin: 8 })
  const nearFog =
    fog({ uid, y: 266, width: 460, color: '#b3b6ba', opacity: 0.26, dur: 38, begin: 21, x0: -80 }) +
    fog({ uid, y: 296, width: 480, color: '#c0c2c4', opacity: 0.22, dur: 30, begin: 4 })

  // The iron fence along the front, a gate in it, and its rail for the crows.
  const railY = 296
  let fence = `<g stroke="#121316" stroke-linecap="round"><path d="M${L} ${railY} L${R} ${railY}" stroke-width="1.6"/><path d="M${L} ${railY + 12} L${R} ${railY + 12}" stroke-width="1.6"/>`
  for (let x = -40; x <= SCENE_W + 40; x += 9) {
    if (x > 78 && x < 110) continue // the gate opening
    fence += `<path d="M${x} ${railY + 22} L${x} ${railY - 7}" stroke-width="1.3"/><path d="M${x - 1.6} ${railY - 5} L${x} ${railY - 9} L${x + 1.6} ${railY - 5}" stroke-width="1" fill="#121316"/>`
  }
  fence += '</g>'
  const gate = '<g fill="#121316"><rect x="74" y="262" width="7" height="58"/><rect x="108" y="262" width="7" height="58"/><path d="M73 262 L77.5 254 L82 262 Z"/><path d="M107 262 L111.5 254 L116 262 Z"/></g>'

  // The lantern on the left gate post: the context gauge.
  const lx = 77.5
  const top = 232
  const h = 20
  const w = 13
  const fill = context === undefined ? 0 : h * context
  const glow = context === undefined ? 0.12 : 0.3 + context * 0.6
  const lantern =
    '<g>' +
    `<circle cx="${lx}" cy="${top + h / 2}" r="${n(18 + (context ?? 0) * 16)}" fill="url(#${uid}-lamp)" opacity="${n(glow)}">${loop('opacity', `${n(glow * 0.75)};${n(glow)};${n(glow * 0.8)}`, 3.4, 1)}</circle>` +
    `<path d="M${lx} 254 L${lx} ${top + h + 3}" stroke="#121316" stroke-width="1.4"/>` +
    `<path d="M${lx - 3} ${top - 6} q3 -5 6 0" stroke="#121316" stroke-width="1.2" fill="none"/>` +
    `<path d="M${lx - w / 2 - 1.5} ${top} L${lx} ${top - 5} L${lx + w / 2 + 1.5} ${top} Z" fill="#141518"/>` +
    `<clipPath id="${uid}-glass"><rect x="${lx - w / 2}" y="${top}" width="${w}" height="${h}" rx="1.5"/></clipPath>` +
    `<rect x="${lx - w / 2}" y="${top}" width="${w}" height="${h}" rx="1.5" fill="#2a2b2f"/>` +
    `<rect x="${lx - w / 2}" y="${n(top + h - fill)}" width="${w}" height="${n(fill)}" fill="url(#${uid}-oil)" clip-path="url(#${uid}-glass)">${flicker(r, 0.8, 1)}</rect>` +
    (context === undefined
      ? ''
      : `<path d="M${lx} ${n(top + h - fill - 4)} q-2 3 0 5 q2 -2 0 -5 Z" fill="#fff6d8">${flicker(r, 0.6, 1)}</path>`) +
    `<rect x="${lx - w / 2}" y="${top}" width="${w}" height="${h}" rx="1.5" fill="none" stroke="#141518" stroke-width="1.6"/>` +
    `<path d="M${lx} ${top} L${lx} ${top + h}" stroke="#141518" stroke-width="0.9"/>` +
    `<rect x="${lx - w / 2 - 1}" y="${top + h}" width="${w + 2}" height="2.6" fill="#141518"/>` +
    '</g>'
  const caption = gaugeCaption({ x: lx + 14, y: top + 4, name: scene.gauge, value: contextText, palette, anchor: 'start' })

  // One crow on the rail per active subagent.
  const crows = swarmSpots(scene.id, { x0: 122, y0: railY - 1, x1: 330, y1: railY + 1 }, swarm)
    .map((spot, i) => crow({ x: spot.x, y: spot.y - 5, s: 0.85, color: '#0d0e10', flip: i % 3 === 1, begin: spot.k * 5 }))
    .join('')

  // Dead grass along the bottom edge.
  let grass = ''
  for (let i = 0; i < 40; i++) {
    const x = between(r, -10, SCENE_W + 10)
    const base = between(r, 318, 336)
    const tall = between(r, 6, 14)
    grass += `<path d="M${n(x)} ${n(base)} l${n(between(r, -3, 3))} ${n(-tall)}" stroke="#2e3034" stroke-width="1"/>`
  }

  return {
    defs,
    body: haze + flash + farRise + chapel + smallTree + midGround + farStones + tree + farFog + nearGround + nearStones + nearFog + gate + fence + lantern + caption + crows + grass,
  }
}
