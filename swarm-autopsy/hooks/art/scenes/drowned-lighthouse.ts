// Drowned Lighthouse: a gray, misty sea at dusk, a moon lost in the haze, a wreck's bow and
// broken mast half sunk in the swell, and a weathered lighthouse on black rocks offshore with
// its keeper's house and one warm window. The lamp room is the context gauge: its glass fills
// with pale light from the bottom as the context window fills, the glow around it grows, and
// the slow beam sweeping the sea brightens with it. Each active subagent is a gull circling
// near the tower.

import type { Painted, PaintArgs } from '../scene.ts'
import {
  BLEED,
  SCENE_W,
  between,
  blur,
  distantFlash,
  drift,
  flicker,
  flyer,
  fog,
  fogDefs,
  gaugeCaption,
  linearBox,
  linearX,
  linearY,
  loop,
  n,
  radialBox,
  sway,
  swarmSpots,
} from '../kit.ts'

const L = -BLEED
const R = SCENE_W + BLEED
/** Where the sea meets the sky. */
const HORIZON = 214
/** Everything below reaches down to here, well under the fade. */
const BOTTOM = 440

/** The lighthouse: its axis, the tower's top and base, and the lamp room's glass (the gauge). */
const LX = 226
const TOWER_TOP = 168
const TOWER_BASE = 253
const HALF_TOP = 10.5
const HALF_BASE = 16
const GLASS_TOP = 138
const GLASS_BOTTOM = 157
const GLASS_HALF = 8
const LAMP_Y = (GLASS_TOP + GLASS_BOTTOM) / 2

/** The beam: how far it reaches, how long one sweep (there and back) takes, where it starts. */
const BEAM_LEN = 440
const BEAM_DUR = 12
const BEAM_BEGIN = 1

type Palette = PaintArgs['palette']

/** The tower's half-width at height y. */
const halfAt = (y: number): number => HALF_TOP + ((HALF_BASE - HALF_TOP) * (y - TOWER_TOP)) / (TOWER_BASE - TOWER_TOP)

/** A band of sea whose wavy top swells around y, sliding sideways one wavelength per `dur`. */
function swell(y: number, amp: number, wl: number, fill: string, crest: string, crestOpacity: number, dur: number, dir: 1 | -1, begin: number): string {
  const x0 = L - 2 * wl
  const segments = Math.ceil((R + 2 * wl - x0) / (wl / 2))
  const top = `M${n(x0)} ${n(y)} q${n(wl / 4)} ${n(-2 * amp)} ${n(wl / 2)} 0` + ` t${n(wl / 2)} 0`.repeat(segments - 1)
  return (
    `<g><path d="${top} V${BOTTOM} H${n(x0)} Z" fill="${fill}"/>` +
    `<path d="${top}" fill="none" stroke="${crest}" stroke-width="0.7" opacity="${n(crestOpacity)}"/>` +
    drift(`0 0;${n((dir * wl) / 2)} -0.6;${n(dir * wl)} 0`, dur, begin) +
    '</g>'
  )
}

/** Short shimmering dashes on the water under a light, in a column around x. */
function shimmer(r: () => number, x: number, y0: number, y1: number, rows: number, spread: number, color: string): string {
  let out = ''
  for (let i = 0; i < rows; i++) {
    const y = y0 + ((y1 - y0) * i) / Math.max(1, rows - 1)
    const len = between(r, 2, 5) + (spread * i) / rows
    const dx = between(r, -spread / 3, spread / 3)
    const dur = between(r, 2.6, 5.2)
    out += `<path d="M${n(x + dx - len)} ${n(y)} h${n(len * 2)}" stroke="${color}" stroke-width="0.9" stroke-linecap="round" opacity="0">${loop('opacity', '0;0.9;0.2;0', dur, between(r, 0, dur))}</path>`
  }
  return out
}

/**
 * Whitecaps: small pale crests across the swell between y0 and y1, longer nearer. They come in
 * groups, each group one path fading in and out on its own beat (cheap, and the sea still glitters).
 */
function whitecaps(r: () => number, x0: number, x1: number, y0: number, y1: number, groups: number, each: number, skip?: (x: number, y: number) => boolean): string {
  let out = ''
  for (let g = 0; g < groups; g++) {
    let d = ''
    for (let i = 0; i < each; i++) {
      const x = between(r, x0, x1)
      const y = between(r, y0, y1)
      if (skip?.(x, y)) continue
      const len = 3 + ((y - HORIZON) / 80) * 9
      d += `M${n(x)} ${n(y)}q${n(len / 2)} ${n(-len / 9)} ${n(len)} 0`
    }
    const dur = between(r, 5, 9)
    if (d) out += `<path d="${d}" stroke="#b3bec3" stroke-width="0.8" fill="none" opacity="0">${loop('opacity', '0;0.6;0.25;0', dur, between(r, 0, dur))}</path>`
  }
  return out
}

/** The pale moon behind the haze, and long stratus streaks drifting across it. */
function skyLayer(uid: string): string {
  const moon =
    `<circle cx="84" cy="134" r="58" fill="url(#${uid}-moonhaze)">${loop('r', '56;61;56', 16, 5)}</circle>` +
    `<circle cx="84" cy="134" r="12.5" fill="#cfd8dc" opacity="0.5"/>` +
    `<circle cx="80" cy="131" r="4" fill="#b8c3c8" opacity="0.25"/>`
  const streaks: [number, number, number, string, number, number, number][] = [
    [40, 128, 70, '#1f262c', 0.55, 30, 70],
    [150, 112, 90, '#262e35', 0.4, -26, 80],
    [-140, 150, 110, '#2a333a', 0.45, 34, 64],
    [420, 120, 100, '#262e35', 0.4, -30, 76],
    [250, 176, 120, '#56626a', 0.22, 24, 58],
    [-40, 190, 140, '#5b676f', 0.2, -22, 66],
  ]
  const clouds = streaks
    .map(
      ([x, y, rx, color, opacity, dx, dur], i) =>
        `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${n(4 + (i % 3) * 1.5)}" fill="${color}" opacity="${opacity}" filter="url(#${uid}-streak)">${drift(`0 0;${dx} 0;0 0`, dur, i * 9)}</ellipse>`,
    )
    .join('')
  return moon + clouds
}

/** Far headlands and sea stacks on the horizon, pale with haze. */
function farCoast(): string {
  return (
    `<path d="M${L} ${HORIZON} L${L} 178 Q-200 170 -120 182 Q-60 176 -10 192 Q24 202 46 ${HORIZON} Z" fill="#48545c"/>` +
    `<path d="M${L} ${HORIZON} L${L} 196 Q-150 190 -60 200 Q-10 204 10 ${HORIZON} Z" fill="#44505a"/>` +
    `<path d="M300 ${HORIZON} Q326 204 364 202 Q420 192 470 198 Q560 190 ${R} 196 L${R} ${HORIZON} Z" fill="#4a565e"/>` +
    `<path d="M398 ${HORIZON} L402 196 L408 192 L414 197 L416 ${HORIZON} Z M300 ${HORIZON} L303 204 L307 202 L309 ${HORIZON} Z" fill="#434f57"/>`
  )
}

/** The wreck: a bow and a broken mast jutting from the swell, a rag of sail stirring on its yard. */
function wreck(): string {
  const hull = '#222a30'
  return (
    '<g>' +
    `<path d="M40 260 L47 251 Q68 246 87 236 L98 227 L101.5 232 Q101 246 108 260 Z" fill="${hull}"/>` +
    '<path d="M58 250 L60 258 M70 246 L72 256 M82 240 L85 252" stroke="#2f383e" stroke-width="0.8"/>' +
    '<path d="M47 251 Q68 246 87 236 L98 227 L101.5 232" stroke="#55616a" stroke-width="0.7" fill="none" opacity="0.8"/>' +
    '<circle cx="78" cy="245" r="1.1" fill="#12171a"/><circle cx="90" cy="238.5" r="1" fill="#12171a"/>' +
    `<path d="M70 248 L56 186 M85 238 L83 222 M99 229 L122 217" stroke="${hull}" stroke-width="2" stroke-linecap="round" fill="none"/>` +
    `<path d="M54 184 L57 186 L55 189 Z" fill="${hull}"/>` +
    `<path d="M45 202 L71 191" stroke="${hull}" stroke-width="1.3" stroke-linecap="round"/>` +
    '<path d="M57 188 Q90 206 122 217 M57 190 Q42 226 30 260 M84 224 Q100 222 110 222" stroke="#2c353b" stroke-width="0.5" fill="none"/>' +
    `<g><path d="M48 201 L69 192.5 L67 205 L63.5 201 L61 211 L57.5 204 L52 209 Z" fill="#4c575e" opacity="0.7"/>${sway(58, 197, 3, 9, 2)}</g>` +
    '</g>'
  )
}

/** A bell buoy offshore, a dark cage on a float, rocking in the swell. */
function bellBuoy(x: number, y: number): string {
  const ink = '#1d2428'
  return (
    `<g><g><ellipse cx="${x}" cy="${y}" rx="4.6" ry="1.8" fill="${ink}"/>` +
    `<path d="M${x - 3.6} ${y - 0.6} L${x} ${y - 13} L${x + 3.6} ${y - 0.6} M${x - 1.8} ${y - 6.5} H${x + 1.8}" stroke="${ink}" stroke-width="0.9" fill="none"/>` +
    `<path d="M${x - 1.4} ${y - 5} q1.4 -3.6 2.8 0 Z" fill="${ink}"/>` +
    sway(x, y, 5, 6.2, 1.5) +
    `</g>${drift('0 0;0 1.2;0 0', 4.8, 2)}</g>` +
    `<path d="M${x - 7} ${y + 1} q3.5 -1 7 0 t7 0" stroke="#9aa6ad" stroke-width="0.6" fill="none" opacity="0.4"/>`
  )
}

/** The black rocks the lighthouse stands on, a smaller stack either side, and the keeper's house. */
function rocksAndHouse(r: () => number, palette: Palette, uid: string): string {
  const top = 'M150 276 L156 266 L166 262 L174 256 L184 255 L188 252 L196 254 L206 251 L214 252 L238 251 L246 250 L254 253 L262 252 L272 257 L280 256 L290 262 L298 268 L306 276'
  const rocks =
    `<path d="M112 274 Q118 262 126 263 Q132 264 136 274 Z M312 274 Q318 264 326 266 Q332 268 334 274 Z" fill="#191e22"/>` +
    `<path d="${top} V290 H150 Z" fill="#14191d"/>` +
    `<path d="${top}" fill="none" stroke="#2d363c" stroke-width="1" opacity="0.85"/>` +
    '<path d="M174 258 L180 270 M206 253 L202 268 M262 254 L266 268 M288 262 L284 272" stroke="#0d1013" stroke-width="1"/>'
  const smoke = [0, 2.2, 4.4]
    .map(begin => `<circle cx="192.5" cy="231" r="2">${drift('0 0;-4 -10;-10 -20', 6.6, begin)}${loop('opacity', '0.5;0.3;0', 6.6, begin)}${loop('r', '1.8;3.4;5.2', 6.6, begin)}</circle>`)
    .join('')
  const house =
    `<g fill="#7d8990" opacity="0.5" filter="url(#${uid}-soft)">${smoke}</g>` +
    '<rect x="190.5" y="231" width="4" height="8" fill="#1a2024"/>' +
    '<rect x="188" y="241" width="22" height="13" fill="#2a3237"/>' +
    '<rect x="188" y="241" width="22" height="2" fill="#1a2024" opacity="0.7"/>' +
    '<path d="M185.5 241.6 L198.5 232 L211.5 241.6 Z" fill="#1b2125"/>' +
    `<rect x="192.5" y="245" width="4.2" height="4.4" rx="0.5" fill="${palette.accent2}">${flicker(r, 0.6, 1)}</rect>` +
    `<rect x="191.5" y="244" width="6.2" height="6.4" fill="${palette.accent2}" opacity="0.18" filter="url(#${uid}-soft)"/>` +
    '<rect x="201.5" y="246" width="4" height="8" fill="#161b1f"/>'
  return rocks + house
}

/** The tower: tapered, faintly banded, streaked by weather, a door and three slit windows. */
function tower(r: () => number, uid: string): string {
  const body = `M${n(LX - HALF_TOP)} ${TOWER_TOP} L${n(LX + HALF_TOP)} ${TOWER_TOP} L${LX + HALF_BASE} ${TOWER_BASE} L${LX - HALF_BASE} ${TOWER_BASE} Z`
  const bands = [
    [178, 189],
    [203, 214],
    [229, 240],
  ]
    .map(([a = 0, b = 0]) => `M${n(LX - halfAt(a))} ${a} L${n(LX + halfAt(a))} ${a} L${n(LX + halfAt(b))} ${b} L${n(LX - halfAt(b))} ${b} Z`)
    .join(' ')
  let streaks = ''
  for (let i = 0; i < 7; i++) {
    const y0 = between(r, TOWER_TOP + 2, TOWER_BASE - 30)
    const x = LX + between(r, -0.75, 0.75) * halfAt(y0)
    const len = between(r, 10, 32)
    streaks += `<path d="M${n(x)} ${n(y0)} q${n(between(r, -1.2, 1.2))} ${n(len / 2)} ${n(between(r, -0.6, 0.6))} ${n(len)}" stroke="#2b3338" stroke-width="${n(between(r, 0.5, 1.1))}" opacity="${n(between(r, 0.3, 0.55))}" fill="none"/>`
  }
  const windows = [
    [LX - 1.6, 184],
    [LX + 1.4, 210],
    [LX - 2, 234],
  ]
    .map(([x = 0, y = 0]) => `<rect x="${n(x)}" y="${y}" width="3.2" height="5.4" rx="1.4" fill="#171d22"/>`)
    .join('')
  return (
    `<path d="${body}" fill="url(#${uid}-towerlit)"/>` +
    `<path d="${bands}" fill="#262e33" opacity="0.32"/>` +
    streaks +
    windows +
    `<path d="M${LX - 3.2} ${TOWER_BASE} V246.5 a3.2 3.2 0 0 1 6.4 0 V${TOWER_BASE} Z" fill="#161b1f"/>`
  )
}

/** The lamp room, the gauge: its glass fills with pale light from the bottom, by `context`. */
function lampRoom(r: () => number, uid: string, context: number | undefined): string {
  const h = GLASS_BOTTOM - GLASS_TOP
  const w = GLASS_HALF * 2
  const lit = context === undefined ? 0 : h * context
  const surface = GLASS_BOTTOM - lit
  let railing = ''
  for (let i = 0; i <= 8; i++) railing += `M${n(LX - 17 + i * 4.25)} 157.6 V161 `
  const light =
    context === undefined
      ? ''
      : `<rect x="${LX - GLASS_HALF}" y="${n(surface)}" width="${w}" height="${n(lit)}" fill="url(#${uid}-light)">${flicker(r, 0.85, 1)}</rect>` +
        `<rect x="${LX - GLASS_HALF}" y="${n(surface - 0.4)}" width="${w}" height="1" fill="#ffffff" opacity="0.85">${flicker(r, 0.5, 1)}</rect>`
  return (
    `<path d="M${LX - 14} 163.5 L${LX + 14} 163.5 L${n(LX + HALF_TOP)} 168.5 L${n(LX - HALF_TOP)} 168.5 Z" fill="#283035"/>` +
    `<rect x="${LX - 17.5}" y="161" width="35" height="2.8" fill="#1c2227"/>` +
    `<rect x="${LX - 10}" y="${GLASS_BOTTOM}" width="20" height="4" fill="#1f262b"/>` +
    `<rect x="${LX - GLASS_HALF}" y="${GLASS_TOP}" width="${w}" height="${h}" fill="#151b20"/>` +
    light +
    `<ellipse cx="${LX}" cy="${n(GLASS_TOP + h * 0.55)}" rx="3.2" ry="6" fill="none" stroke="#0f1316" stroke-width="0.6" opacity="0.45"/>` +
    `<path d="M${n(LX - 2.7)} ${GLASS_TOP} V${GLASS_BOTTOM} M${n(LX + 2.7)} ${GLASS_TOP} V${GLASS_BOTTOM}" stroke="#0f1316" stroke-width="1"/>` +
    `<rect x="${LX - GLASS_HALF}" y="${GLASS_TOP}" width="${w}" height="${h}" fill="none" stroke="#0f1316" stroke-width="1.2"/>` +
    `<path d="M${LX - 17} 157.6 H${LX + 17} ${railing}" stroke="#13181c" stroke-width="0.8"/>` +
    `<rect x="${LX - 11}" y="135.4" width="22" height="2.8" fill="#161b1f"/>` +
    `<path d="M${n(LX - 9.5)} 135.6 Q${LX - 9} 124.5 ${LX} 122.5 Q${LX + 9} 124.5 ${n(LX + 9.5)} 135.6 Z" fill="#1c2328"/>` +
    `<path d="M${n(LX - 7.5)} 134 Q${LX - 7} 126.5 ${LX - 1} 124.4" stroke="#3b454c" stroke-width="0.8" fill="none"/>` +
    `<circle cx="${LX}" cy="120.6" r="2.1" fill="#1c2328"/>` +
    `<path d="M${LX} 118.8 V110.5 M${LX - 4} 112.6 H${LX + 3.5} M${LX + 2} 111.2 L${LX + 4} 112.6 L${LX + 2} 114" stroke="#1c2328" stroke-width="0.9" fill="none"/>`
  )
}

/** The glow around the lamp and the flare each time the beam turns toward us; both grow with context. */
function lampGlow(uid: string, context: number | undefined): string {
  if (context === undefined) return ''
  const glow = 0.18 + context * 0.7
  const radius = 12 + context * 36
  const flare = 0.25 + context * 0.6
  return (
    `<circle cx="${LX}" cy="${n(LAMP_Y)}" r="${n(radius)}" fill="url(#${uid}-lampglow)" opacity="${n(glow)}">${loop('opacity', `${n(glow * 0.82)};${n(glow)};${n(glow * 0.88)};${n(glow * 0.82)}`, 4.6, 2)}</circle>` +
    `<circle cx="${LX}" cy="${n(LAMP_Y)}" r="${n(radius * 1.25)}" fill="url(#${uid}-lampglow)" opacity="0">${loop('opacity', `0;0;${n(flare)};0;0;0`, BEAM_DUR, BEAM_BEGIN, ' keyTimes="0;0.17;0.25;0.33;0.5;1"')}</circle>`
  )
}

/** The beam: a soft pale wedge seen side-on as it turns, sweeping left, toward us, right and back. */
function beam(uid: string, context: number | undefined): string {
  if (context === undefined) return ''
  const strength = 0.25 + context * 0.75
  return (
    `<g transform="translate(${LX} ${n(LAMP_Y)})" opacity="${n(strength)}"><g filter="url(#${uid}-beamblur)">` +
    `<path d="M0 -3 L${-BEAM_LEN} -36 L${-BEAM_LEN} 50 L0 3 Z" fill="url(#${uid}-beam)"/>` +
    `<path d="M0 -1.5 L${-BEAM_LEN} -14 L${-BEAM_LEN} 26 L0 1.5 Z" fill="url(#${uid}-beam)"/>` +
    `<animateTransform attributeName="transform" type="scale" values="1 1;-1 1;1 1" keyTimes="0;0.5;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur="${BEAM_DUR}s" begin="${-BEAM_BEGIN}s" repeatCount="indefinite"/>` +
    '</g></g>'
  )
}

/** Foam breaking around the rocks, surging and fading. */
function foam(r: () => number, points: readonly (readonly [number, number, number])[]): string {
  return points
    .map(([x, y, rx]) => {
      const dur = between(r, 4, 7)
      return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="1.3" fill="#c3ccd1" opacity="0">${loop('opacity', '0;0.55;0.15;0', dur, between(r, 0, dur))}</ellipse>`
    })
    .join('')
}

/** The gulls, one per active subagent, each circling or weaving its own slow loop. */
function gulls(scene: PaintArgs['scene'], swarm: number): { behind: string; front: string } {
  // loops rise at most 2 × ry (18) above a spot, so the highest gull stays below the title
  const area = { x0: 36, y0: 114, x1: 318, y1: 210 }
  let behind = ''
  let front = ''
  swarmSpots(scene.id, area, swarm).forEach((spot, i) => {
    const dir = i % 2 === 0 ? 1 : -1
    const rx = 14 + spot.k * 22
    const ry = 4 + (1 - spot.k) * 5
    const weave = i % 3 === 2
    const points: string[] = []
    for (let j = 0; j <= 12; j++) {
      const a = (j / 12) * Math.PI * 2
      const x = dir * rx * Math.sin(a)
      const y = weave ? (ry * Math.sin(2 * a)) / 1.4 : ry * (Math.cos(a) - 1)
      points.push(`${n(x)} ${n(y)}`)
    }
    const depth = (spot.y - area.y0) / (area.y1 - area.y0)
    const dur = 18 + spot.k * 16
    const bird = flyer({ x: spot.x, y: spot.y, s: 0.55 + depth * 0.3, color: '#d2d9dc', path: points.join(';'), dur, begin: spot.k * dur })
    if (Math.abs(spot.x - LX) < 46) behind += bird
    else front += bird
  })
  return { behind, front }
}

export function paint({ uid, palette, r, context, contextText, scene, swarm }: PaintArgs): Painted {
  const defs =
    radialBox(`${uid}-moonhaze`, [
      [0, '#c9d2d7', 0.5],
      [0.4, '#9ca8af', 0.2],
      [1, '#9ca8af', 0],
    ]) +
    radialBox(`${uid}-lampglow`, [
      [0, '#eef8fc', 0.95],
      [0.3, palette.accent, 0.45],
      [1, palette.accent, 0],
    ]) +
    linearBox(`${uid}-light`, [
      [0, '#f4fbfe'],
      [1, palette.accent],
    ]) +
    linearX(`${uid}-beam`, 0, -BEAM_LEN, [
      [0, '#dcebf2', 0.4],
      [0.3, palette.accent, 0.18],
      [1, palette.accent, 0],
    ]) +
    linearX(`${uid}-towerlit`, LX - HALF_BASE, LX + HALF_BASE, [
      [0, '#58626a'],
      [0.32, '#6b757c'],
      [0.62, '#525c63'],
      [1, '#363e44'],
    ]) +
    linearY(`${uid}-sea`, HORIZON, 300, [
      [0, '#55616a'],
      [0.12, '#47535c'],
      [0.6, '#2d363d'],
      [1, '#1b2126'],
    ]) +
    fogDefs(uid) +
    blur(`${uid}-streak`, 4) +
    blur(`${uid}-soft`, 1.4) +
    blur(`${uid}-beamblur`, 2.6)

  const flash = distantFlash({ color: '#c8d2da', opacity: 0.07, dur: 29, begin: 11 })

  // The open sea: a hazy horizon line, the moon's faint path, then swells nearer and darker.
  const sea =
    `<rect x="${L}" y="${HORIZON}" width="${R - L}" height="${BOTTOM - HORIZON}" fill="url(#${uid}-sea)"/>` +
    `<rect x="${L}" y="${HORIZON - 1.5}" width="${R - L}" height="3" fill="#7d8a92" opacity="0.35" filter="url(#${uid}-soft)"/>` +
    shimmer(r, 84, HORIZON + 4, 244, 7, 8, '#aeb9bf')
  const farSwells =
    swell(226, 0.7, 22, '#46525a', '#8a979e', 0.22, 26, 1, 4) +
    swell(240, 1.1, 30, '#3d4850', '#86939a', 0.2, 22, -1, 9)
  const midSwell = swell(257, 1.7, 40, '#343e45', '#7d8a91', 0.2, 19, 1, 13)
  const nearSwells = swell(272, 2.3, 54, '#2a3239', '#76838a', 0.18, 16, -1, 6)
  const frontSwell = swell(291, 3, 70, '#20272d', '#6c787f', 0.16, 14, 1, 2)
  const deepSwell = swell(312, 3.4, 86, '#1a2025', '#5f6b72', 0.16, 13, -1, 7)
  // no crests painted onto the rocks or the wreck
  const onRocks = (x: number, y: number): boolean => (x > 140 && x < 316 && y > 246) || (x > 36 && x < 112 && y > 238)
  const onNearRocks = (x: number, y: number): boolean => x < 70 || x > 288
  const farCaps = whitecaps(r, -260, 600, HORIZON + 6, 266, 8, 7, onRocks)
  const nearCaps = whitecaps(r, -260, 600, 276, 306, 5, 5, onNearRocks)

  // Mist banks, far to near, at different speeds; one thin veil across the tower's middle.
  const horizonMist = fog({ uid, y: 210, width: 1040, color: '#7f8b93', opacity: 0.4, dur: 60, begin: 14, x0: L })
  const towerVeil = fog({ uid, y: 196, width: 1040, color: '#6f7b83', opacity: 0.16, dur: 72, begin: 30, x0: L + 120 })
  const lowMist = fog({ uid, y: 250, width: 1040, color: '#8f9aa1', opacity: 0.3, dur: 46, begin: 22, x0: L + 60 })
  const nearMist = fog({ uid, y: 284, width: 1040, color: '#9aa4aa', opacity: 0.22, dur: 36, begin: 5, x0: L })

  // Near rocks framing the bottom corners, jagged, their wet tops catching a little light.
  const leftTop = `M${L} 290 Q-160 286 -90 290 L-60 286 L-36 288 L-14 280 L2 279 L12 274 L22 276 L34 283 L46 285 L58 292 L66 302`
  const rightTop = 'M288 302 L296 292 L304 288 L314 281 L324 280 L336 284 L352 283 L366 288 Q440 284 ' + `${R} 292`
  const nearRocks =
    `<path d="${leftTop} L${L} 302 Z" fill="#0f1316"/>` +
    `<path d="${rightTop} L${R} 302 Z" fill="#0f1316"/>` +
    '<path d="M-36 288 L-14 280 L2 279 L12 274 L22 276 L34 283 M296 292 L304 288 L314 281 L324 280 L336 284 L352 283" stroke="#283037" stroke-width="0.9" fill="none"/>' +
    '<path d="M12 274 L8 288 M314 281 L318 294" stroke="#090c0e" stroke-width="0.9"/>'

  const reflection =
    context === undefined
      ? ''
      : `<g opacity="${n(0.2 + context * 0.7)}">${shimmer(r, LX, 278, 298, 6, 10, palette.accent)}</g>`

  const birds = gulls(scene, swarm)
  const caption = gaugeCaption({ x: LX + 20, y: 142, name: scene.gauge, value: contextText, palette, anchor: 'start' })

  return {
    defs,
    body:
      skyLayer(uid) +
      flash +
      farCoast() +
      sea +
      farSwells +
      horizonMist +
      wreck() +
      bellBuoy(300, 247) +
      midSwell +
      farCaps +
      beam(uid, context) +
      birds.behind +
      lampGlow(uid, context) +
      rocksAndHouse(r, palette, uid) +
      tower(r, uid) +
      lampRoom(r, uid, context) +
      foam(r, [
        [152, 273, 8],
        [176, 272, 10],
        [214, 273, 9],
        [258, 272, 11],
        [300, 273, 8],
        [124, 273, 6],
        [328, 273, 5],
      ]) +
      towerVeil +
      nearSwells +
      reflection +
      lowMist +
      nearRocks +
      frontSwell +
      nearCaps +
      deepSwell +
      foam(r, [
        [56, 293, 9],
        [306, 291, 10],
      ]) +
      nearMist +
      birds.front +
      caption,
  }
}
