// A scene as the whole pane's background: the same painting the scene head drew, recomposed for the
// window's own shape and drawn behind every view, still while the content scrolls over it. No title in the
// picture (the pane's header carries it). Above the painting the sky goes on, with the scene's own atmosphere;
// below it the ground deepens into the pane's base colour, so cards always sit on a calm, dark field. A veil
// darkens the band where the header and the first panels sit, so text stays readable over any scene.

import type { Scene } from '../lib/scenes.ts'
import { BLEED, SCENE_W, between, blur, drift, linearY, motes, n, rng, stars, svgDoc } from './kit.ts'
import { PAINTERS } from './scene.ts'

/** The window the background fills, in CSS pixels. */
export type FramePx = { width: number; height: number }

export type BackgroundInput = {
  scene: Scene
  context: number | undefined
  contextText: string
  swarm: number
  frame: FramePx
}

/** The painting's natural window, in its own units: from just above its sky to just under its ground. */
const NATURAL_TOP = -20
const NATURAL_H = 360
/** Of any height a tall window adds, this share goes to the sky above the painting; the rest to the ground below. */
const SKY_SHARE = 0.45
/** The narrowest stretch of the painting a tall dock shows (it crops a little of each side), and the widest. */
const MIN_VIEW_W = 292
const MAX_VIEW_W = SCENE_W + BLEED * 2 - 40
const MAX_PX = 4096

/**
 * Which part of the painting the window shows, in the scene's units: the view box. A normal window shows the painting at
 * its natural height; a wider one shows more of its sides (the background layers reach BLEED past the canvas); a tall
 * dock crops the sides a little, keeps the painting large, and shows more sky above and ground below.
 */
export function viewFor(frame: FramePx): { x: number; y: number; w: number; h: number } {
  const aspect = Math.max(0.2, frame.width / Math.max(1, frame.height))
  const w = Math.min(MAX_VIEW_W, Math.max(MIN_VIEW_W, NATURAL_H * aspect))
  const h = w / aspect
  // Extra height (a tall dock) is shared between sky and ground; missing height (a very wide, low window) is taken
  // mostly from the sky, whose top is empty.
  const extra = h - NATURAL_H
  const y = extra >= 0 ? NATURAL_TOP - SKY_SHARE * extra : NATURAL_TOP - 0.7 * extra
  return { x: SCENE_W / 2 - w / 2, y, w, h }
}


/** Dust drifting in an interior's lamplight, in front of the painting: a few, never a crowd (each one is a running loop). */
const DUST_MOTES = 12

/** The sky above the painting and the ground below it, so a tall window is a whole scene, not a band. */
function surround(scene: Scene, uid: string, view: ReturnType<typeof viewFor>): { defs: string; back: string; air: string; front: string } {
  const p = scene.palette
  const r = rng(`${scene.id}-surround`)
  const left = view.x - 20
  const right = view.x + view.w + 20
  const top = Math.min(view.y - 20, -40)
  const above = { x0: left, y0: top, x1: right, y1: 70 }
  // The air the window adds above the painting: night stars or a slow high mist, behind it. Indoors the painting covers
  // that air with its own walls and ceiling, so a few warm specks of dust drift in front of it instead, in the lamplight.
  const air =
    scene.air === 'stars'
      ? stars(r, above, Math.round(((above.x1 - above.x0) * (above.y1 - above.y0)) / 2600), '#e8ecf4', [0.4, 1.1])
      : scene.air === 'mist'
        ? [0, 1, 2]
            .map(i => {
              const y = top + (70 - top) * (0.25 + i * 0.25)
              return `<ellipse cx="${n(left + (right - left) * (0.3 + 0.2 * i))}" cy="${n(y)}" rx="${n((right - left) * 0.45)}" ry="18" fill="${p.sky[2]}" opacity="0.07" filter="url(#${uid}-mist)">${drift(`0 0;${n(40 - i * 25)} 0;0 0`, 70 + i * 20, i * 17)}</ellipse>`
            })
            .join('')
        : ''
  const dust = scene.air === 'motes' ? motes(r, { x0: left, y0: top, x1: right, y1: 120 }, DUST_MOTES, p.accent, 26) : ''
  // Ground: the base colour from just under the painting's foreground to the window's foot, with a few drifting
  // low fog banks so the deep field is never dead.
  const bottom = view.y + view.h + 20
  const groundTop = 330
  let fogs = ''
  for (let i = 0; i < 3; i++) {
    const y = groundTop + 30 + ((bottom - groundTop - 30) * (i + 0.5)) / 3
    fogs += `<ellipse cx="${n(between(r, left, right))}" cy="${n(y)}" rx="${n((right - left) * 0.5)}" ry="22" fill="${p.muted}" opacity="0.07" filter="url(#${uid}-mist)">${drift(`0 0;${n(between(r, -40, 40))} 0;0 0`, between(r, 50, 90), between(r, 0, 40))}</ellipse>`
  }
  return {
    defs:
      blur(`${uid}-mist`, 9) +
      linearY(`${uid}-ground`, groundTop, groundTop + 70, [
        [0, p.base, 0],
        [1, p.base, 1],
      ]),
    back: `<rect x="${n(left)}" y="${n(top - 400)}" width="${n(right - left)}" height="${n(470 - top)}" fill="${p.sky[0]}"/>`,
    // Over the sky gradient too, which starts at y 0: under it, the mist and the stars stopped there in a seam.
    air,
    front: `<rect x="${n(left)}" y="${groundTop}" width="${n(right - left)}" height="${n(Math.max(80, bottom - groundTop + 400))}" fill="url(#${uid}-ground)"/>` + fogs + dust,
  }
}

/**
 * The veil over the painting: a gentle darkening at the top (the header) and from the horizon down (the cards), and a
 * vignette at the sides. Never over the painting's middle, where its gauge and figures live.
 */
function veil(scene: Scene, uid: string, view: ReturnType<typeof viewFor>): { defs: string; body: string } {
  const p = scene.palette
  const y0 = view.y
  const y1 = view.y + view.h
  return {
    defs:
      linearY(`${uid}-veil`, y0, y1, [
        [0, p.base, 0.45],
        [0.14, p.base, 0.12],
        [0.3, p.base, 0],
        [0.62, p.base, 0],
        [0.8, p.base, 0.3],
        [1, p.base, 0.6],
      ]) +
      `<radialGradient id="${uid}-vignette" gradientUnits="userSpaceOnUse" cx="${n(view.x + view.w / 2)}" cy="${n(y0 + view.h * 0.4)}" r="${n(Math.max(view.w, view.h) * 0.75)}">` +
      `<stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.35"/></radialGradient>`,
    body:
      `<rect x="${n(view.x - 20)}" y="${n(y0 - 20)}" width="${n(view.w + 40)}" height="${n(view.h + 40)}" fill="url(#${uid}-veil)"/>` +
      `<rect x="${n(view.x - 20)}" y="${n(y0 - 20)}" width="${n(view.w + 40)}" height="${n(view.h + 40)}" fill="url(#${uid}-vignette)"/>`,
  }
}

/** The background as an SVG document exactly the window's size, the painting fitted to it. */
export function backgroundSvg(input: BackgroundInput): string {
  const { scene } = input
  const uid = `sa-${scene.id}-bg`
  const view = viewFor(input.frame)
  const width = Math.min(MAX_PX, Math.max(1, Math.round(input.frame.width)))
  const height = Math.min(MAX_PX, Math.max(1, Math.round(input.frame.height)))
  const painted = PAINTERS[scene.id]({
    uid,
    scene,
    palette: scene.palette,
    r: rng(scene.id),
    context: input.context === undefined ? undefined : Math.min(1, Math.max(0, input.context)),
    // The gauge without its caption: behind the content a figure in the picture would compete with the text over it.
    contextText: '',
    swarm: Math.max(0, Math.floor(input.swarm)),
  })
  const sky = linearY(`${uid}-sky`, 0, 300, [
    [0, scene.palette.sky[0]],
    [0.55, scene.palette.sky[1]],
    [1, scene.palette.sky[2]],
  ])
  const around = surround(scene, uid, view)
  const cover = veil(scene, uid, view)
  // The painting's own sky gradient fills behind it, and the surround's flat top colour above y 0 continues it.
  const skyRect = `<rect x="${n(view.x - 20)}" y="0" width="${n(view.w + 40)}" height="${n(Math.max(400, view.y + view.h))}" fill="url(#${uid}-sky)"/>`
  return svgDoc({
    width,
    height,
    viewBox: `${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}`,
    preserve: 'xMidYMid slice',
    defs: sky + around.defs + painted.defs + cover.defs,
    body: around.back + skyRect + around.air + painted.body + around.front + cover.body,
  })
}
