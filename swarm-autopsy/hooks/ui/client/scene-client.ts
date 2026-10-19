// The still background's surface module (desktop only). The pane is drawn exactly the visible rows tall and never
// scrolls; this Client fills it as an absolute layer behind the content Client, so the scene never moves while the
// content scrolls in its own region.
//
// A Client cannot read its own pixel size (its module runs in a hidden frame; the region reports cells), so the scene is
// built to forgive an estimate: on the page a full-size CSS wash in the scene's sky and base colours fills the region
// exactly, and the painting (art/background.ts, composed for the estimated size and a little larger) sits centred on it,
// its edges fading into that wash. In the engine's host (no raw `div`) the painting alone.

import type { ClientModule, RenderElement } from 'claude-code'

import { backgroundSvg } from '../../art/background.ts'
import { SCENES, type SceneId } from '../../lib/scenes.ts'
import { fitPage, type ClientElement } from './shape.ts'

export type SceneClientProps = {
  scene: string
  /** The main context's fill, 0–1, or -1 while unmeasured (props are plain JSON: no undefined). */
  context: number
  contextText: string
  /** Active subagents: one figure each in the scene. */
  swarm: number
  /** The pane's size as the hooks module estimated it, in pixels. */
  width: number
  height: number
  /** The pane's visible rows and its columns: the scene's own height (a Client's region is as tall as its content). */
  rows: number
  columns: number
  /** Words for the picture: the desktop drops an Svg whose alt is blank. */
  alt: string
}

/** A column's and a row's size in pixels, estimated (the region reports cells; the page measures pixels). */
export const PX_PER_COLUMN = 8.5
export const PX_PER_ROW = 20
/** The painting is drawn this much larger than the estimate, so a short estimate never leaves an edge. */
const OVERSIZE = 1.08

/**
 * The frame the picture is drawn for: the pane's rows (the region's own rows report only what the scene has drawn so far,
 * a line before the first layout) and the region's columns once laid out, else the pane's.
 */
export function frameOf(props: SceneClientProps, cells: { columns: number; rows: number }): { width: number; height: number } {
  const columns = cells.columns > 0 ? cells.columns : props.columns
  const width = columns > 0 ? columns * PX_PER_COLUMN : props.width
  const height = props.rows > 0 ? props.rows * PX_PER_ROW : props.height
  return { width: Math.min(4096, Math.round(width * OVERSIZE)), height: Math.min(4096, Math.round(height * OVERSIZE)) }
}

const tag = (style: string, children: ClientElement[]): ClientElement => ({ type: 'div', props: { style }, children })

/** The background as the region's tree. */
export function sceneClientTree(props: SceneClientProps, frame: { width: number; height: number }, opts: { page: boolean }): ClientElement {
  const scene = SCENES[props.scene as SceneId] ?? SCENES['fogbound-cemetery']
  const p = scene.palette
  const source = backgroundSvg({
    scene,
    context: props.context < 0 ? undefined : props.context,
    contextText: props.contextText,
    swarm: props.swarm,
    frame,
  })
  const picture: ClientElement = { type: 'Svg', props: { source, alt: props.alt, width: frame.width, height: frame.height } }
  const rows = Math.max(1, Math.floor(props.rows))
  if (!opts.page) return { type: 'Box', props: { width: '100%', height: rows, overflow: 'hidden' }, children: [picture] }
  // In flow and the pane's rows tall: a Client's region is only as tall as what it draws (absolute layers add nothing),
  // so the scene states its own height; the wash and the painting fill it.
  // Made to the page's schema last (shape.ts `fitPage`): one element it refuses would stop the whole scene.
  return fitPage(
    tag(
      `position:relative;width:100%;height:${rows}lh;min-height:${rows}lh;overflow:hidden;` +
        `background:linear-gradient(180deg,${p.sky[0]} 0%,${p.sky[1]} 34%,${p.base} 72%,${p.base} 100%)`,
      [tag('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none', [picture])],
    ),
  ) as ClientElement
}

/** Whether this module runs in the desktop page's runtime (a browser frame, with a document) rather than the engine's host. */
const inPage = (): boolean => typeof (globalThis as { document?: unknown }).document === 'object'

const SceneClient: ClientModule<SceneClientProps> = (props, surface) =>
  // Raw `div` and `Svg` are outside the typed ClientElements: cast, deliberately.
  sceneClientTree(props, frameOf(props, surface), { page: inPage() }) as unknown as RenderElement

export default SceneClient
