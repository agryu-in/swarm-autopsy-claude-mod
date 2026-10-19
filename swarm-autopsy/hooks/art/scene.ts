// Composes the scene at the top of the pane: the sky backdrop, the scene's own painting
// (which draws the main context gauge and one figure per active subagent), the fade into the
// pane's base colour, then the title and motto on top.

import type { Palette, Scene, SceneId } from '../lib/scenes.ts'
import { FADE_FROM, SCENE_H, SCENE_W, TITLE_ZONE, fadeToBase, rng, skyBackdrop, svgDoc, titleBlock } from './kit.ts'
import { paint as clocktower } from './scenes/clocktower.ts'
import { paint as manor } from './scenes/crooked-manor.ts'
import { paint as lighthouse } from './scenes/drowned-lighthouse.ts'
import { paint as cemetery } from './scenes/fogbound-cemetery.ts'
import { paint as library } from './scenes/hollow-library.ts'
import { paint as mire } from './scenes/mire-lights.ts'
import { paint as catCafe } from './scenes/cat-cafe.ts'
import { paint as firesideTea } from './scenes/fireside-tea.ts'
import { paint as goldenPorch } from './scenes/golden-porch.ts'
import { paint as sunsetPier } from './scenes/sunset-pier.ts'
import { paint as flowerShop } from './scenes/flower-shop.ts'
import { paint as forestCabin } from './scenes/forest-cabin.ts'

/** What a scene's painter is handed. */
export type PaintArgs = {
  /** Prefix for every id the painter defines (gradients, filters, clips). */
  uid: string
  scene: Scene
  palette: Palette
  /** Seeded by the scene's id: the same scene draws the same every time. */
  r: () => number
  /** The main session's context window fill, 0–1; undefined while unmeasured. */
  context: number | undefined
  /** The fill as text for the gauge caption (`42%`), or `—`. */
  contextText: string
  /** Active subagents right now: the painter draws one of its swarm figures for each, at most nine. */
  swarm: number
}

/** A painter returns its gradient/filter definitions and its shapes. */
export type Painted = { defs: string; body: string }

export type Painter = (args: PaintArgs) => Painted

export const PAINTERS: Readonly<Record<SceneId, Painter>> = {
  'fogbound-cemetery': cemetery,
  'drowned-lighthouse': lighthouse,
  'hollow-library': library,
  'crooked-manor': manor,
  clocktower,
  'mire-lights': mire,
  'cat-cafe': catCafe,
  'fireside-tea': firesideTea,
  'golden-porch': goldenPorch,
  'sunset-pier': sunsetPier,
  'flower-shop': flowerShop,
  'forest-cabin': forestCabin,
}

export type SceneInput = {
  scene: Scene
  context: number | undefined
  contextText: string
  swarm: number
  /** The width the drawing is shown at, in CSS pixels; its height follows. */
  width: number
}

/** The size a scene is shown at for a given width: never squashed, at most its own height. */
export function sceneSize(width: number): { width: number; height: number } {
  const w = Math.round(Math.max(200, width))
  return { width: w, height: w < SCENE_W ? Math.round((SCENE_H * w) / SCENE_W) : SCENE_H }
}

/** The finished scene as an SVG document. */
export function sceneSvg(input: SceneInput): string {
  const { scene } = input
  const uid = `sa-${scene.id}-scene`
  const palette = scene.palette
  const sky = skyBackdrop(uid, palette)
  const painted = PAINTERS[scene.id]({
    uid,
    scene,
    palette,
    r: rng(scene.id),
    context: input.context === undefined ? undefined : Math.min(1, Math.max(0, input.context)),
    contextText: input.contextText,
    swarm: Math.max(0, Math.floor(input.swarm)),
  })
  const fade = fadeToBase(uid, palette)
  const title = titleBlock({ uid, title: scene.title, motto: scene.motto, palette })
  const size = sceneSize(input.width)
  return svgDoc({
    width: size.width,
    height: size.height,
    viewBox: `0 0 ${SCENE_W} ${SCENE_H}`,
    preserve: 'xMidYMid meet',
    defs: sky.defs + painted.defs + fade.defs + title.defs,
    body: sky.body + painted.body + fade.body + title.body,
  })
}

/** The words the picture is shown with (a blank alt makes the desktop drop it). */
export function sceneAlt(scene: Scene, contextText: string, swarm: number): string {
  const figures = swarm === 0 ? `no ${scene.swarmThing}s: no subagent is active` : `${Math.min(9, swarm)} ${scene.swarmThing}${swarm === 1 ? '' : 's'}, one per active subagent`
  return `${scene.title}: ${scene.motto} Main context ${contextText}, shown as ${scene.gaugeThing}; ${figures}.`
}

export { FADE_FROM, SCENE_H, SCENE_W, TITLE_ZONE }
