// The pane's content as a surface module (desktop only). The hooks module draws the header and the selected tab as
// it always has, turns that tree into plain data (still-pane.tsx) and hands it here as props; this module draws it again
// inside the pane's still region, with every Button posting its key back to the hooks module, which runs the Button's
// own handler there (`ui.message`). So the facts, wording and presses are the engine tree's own.
//
// On the desktop page the content sits in a raw `div` scroll area filling the region: the content scrolls inside the
// Client while the pane (and the scene Client behind it) never moves. Raw `div`/`span` and their `style` are outside
// the published Client contract; the page (2.1.299) draws them, filtering each style against a blocklist (no `url(`,
// no `behavior:` — which also catches `overscroll-behavior:` — no backslash, no `<`, at most 4,000 characters): a style
// that trips it is dropped whole. `styleIsSafe` holds every style here to those rules. The engine's own Client host
// (the test host) draws no `div`, so there the same content sits in a Box.
//
// On the page this module also dresses the content in the scene's design language (`rebuild`): glass panels become
// frosted cards lit from the top left over the still scene, buttons become the scene's pills (the selected one lit in
// the scene's light), titles take the app's serif face. A Client doubles vertical spacing (a unit is a line there, half
// a line in the engine tree), so vertical padding, margins and column gaps are halved to keep the engine tree's rhythm.

import type { ClientModule, RenderElement } from 'claude-code'

import { fitPage, unflatten, type ClientElement, type ClientNode, type FlatTree } from './shape.ts'

/** The scene's design language for the page: everything a raw element needs that the engine tree cannot say. */
export type Dress = {
  /** Panel fills by tone, as the engine tree names them (8-digit hex). */
  glass: { raised: string; fill: string; sunken: string }
  /** Hairline edges, and the lit edge. */
  edge: string
  edgeStrong: string
  /** The scene's light (a lit pill, a selected tab) and its second light (the lit pill's far end). */
  accent: string
  accent2: string
  /** Text: ink, and the muted housekeeping colour. */
  ink: string
  muted: string
  /** The pane's base colour (the text on a lit pill). */
  base: string
  /** The display face for titles. */
  display: string
  /** How clear the liquid glass is: 0 frosted, 1 crystal (the person's step, lib/clarity.ts). */
  clarity: number
}

export type ContentClientProps = {
  /** The header and the selected view, as plain data in a flat table (shape.ts `flatten`). */
  tree: FlatTree
  /** The visible rows: the scroll area's height. */
  rows: number
  dress: Dress
  /**
   * Where the content is: the view, and its part when it is in parts. A new place starts the scroll area at its top (the
   * keeper changes, so the page draws a new scroll area); the same place keeps the scroll position across redraws.
   */
  place?: string
}

/** What a Button posts: its key, and which of the Buttons with that key (document order). */
export type PressMessage = { press: string; nth: number }

/** The page's style blocklist (2.1.299), as a check: a style that trips it is dropped whole by the page. */
const BLOCKED = [/\\/, /</, /url\s*\(/i, /image-set\s*\(/i, /image\s*\(/i, /src\s*\(/i, /element\s*\(/i, /expression\s*\(/i, /-moz-binding/i, /behavior\s*:/i, /@(?!(?:-webkit-)?(?:keyframes|media|supports|layer|container)\b)/i]
export const STYLE_MAX = 4000

/** Whether the page keeps `style` as written. */
export function styleIsSafe(style: string): boolean {
  return style.length <= STYLE_MAX && !BLOCKED.some(pattern => pattern.test(style))
}

/**
 * A tiny interactive Svg: the page keeps every element on the path from the root to an interactive Svg it finds again
 * unchanged, so this keeps the scroll area itself across redraws, and with it the scroll position.
 */
const keeperSource = (place: string): string => {
  // The place, folded into the picture's own height: a new place is a new picture, so the page draws a new scroll area.
  let hash = 7
  for (let i = 0; i < place.length; i++) hash = (hash * 31 + place.charCodeAt(i)) % 9973
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 ${hash + 1}"></svg>`
}
const KEEPER_STYLE = 'position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none'

const tag = (type: 'div' | 'span', style: string, children: ClientNode[]): ClientElement => ({ type, props: { style }, children })

/** `#rrggbb` (or `#rrggbbaa`) with a new alpha. */
const alpha = (hex: string, aa: string): string => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex) ? `${hex.slice(0, 7)}${aa}` : hex)

/** A Button's look on the page: the scene's pill, lit when selected or primary; a dimmed run when dim and plain. */
function pillStyle(props: ClientElement['props'], dress: Dress, selected: boolean): string {
  // A plain Button is a line of text: one line, as the app draws a Button's label, clipped at its column's edge.
  if (props?.plain === true) {
    return `display:flex;min-width:0;max-width:100%;overflow:hidden;white-space:pre;cursor:pointer;${props.dimColor === true ? 'opacity:.62;' : ''}`
  }
  const lit = selected || props?.variant === 'primary'
  if (lit) {
    return (
      `display:inline-flex;align-items:center;padding:0 1.1ch;border-radius:999px;white-space:nowrap;cursor:pointer;line-height:1.55;` +
      `color:${dress.base};font-weight:600;border:1px solid ${alpha(dress.accent, 'ff')};` +
      `background:linear-gradient(180deg,#ffffff4d 0%,#ffffff00 52%),linear-gradient(135deg,${dress.accent} 0%,${alpha(dress.accent, 'd9')} 55%,${alpha(dress.accent2, 'cc')} 100%);` +
      `box-shadow:inset 0 1px 0 #ffffff73,0 0 0 1px ${alpha(dress.accent, '33')},0 4px 14px ${alpha(dress.accent, '40')}`
    )
  }
  // A liquid glass capsule (its layers are the scroll area's `--g-pill…`, set once for every pill: glassVars).
  return (
    `display:inline-flex;align-items:center;padding:0 1.1ch;border-radius:999px;white-space:nowrap;cursor:pointer;line-height:1.55;` +
    `color:${dress.ink};border:1px solid transparent;background:var(--g-pill);box-shadow:var(--g-pill-shadow);backdrop-filter:var(--g-pill-fx)`
  )
}

/**
 * The liquid glass's layers every card and pill shares, as custom properties on the scroll area, set once: a card's own
 * style then holds only what is its own (its fill and its tinted rim), so a long view stays within a Client's bounds.
 * They follow the person's clarity step: clearer glass, more blur, a soft shadow under text.
 */
function glassVars(dress: Dress): string {
  const t = dress.clarity
  const pill = alpha(dress.glass.fill, byte(lerp(0.82, 0.24, t)))
  return [
    `--g-pill:linear-gradient(180deg,#ffffff${byte(lerp(0.12, 0.2, t))} 0%,#ffffff0a 55%,#ffffff03 100%) padding-box,linear-gradient(${pill},${pill}) padding-box,linear-gradient(160deg,#ffffff8c 0%,#ffffff1f 55%,#ffffff47 100%) border-box`,
    `--g-pill-fx:blur(${Math.round(lerp(6, 12, t))}px) saturate(1.6)`,
    '--g-pill-shadow:inset 0 1px 0 #ffffff40,0 2px 8px #00000040',
    `--g-sheen:linear-gradient(165deg,#ffffff${byte(lerp(0.08, 0.17, t))} 0%,#ffffff${byte(lerp(0.02, 0.05, t))} 26%,#ffffff00 48%) padding-box`,
    `--g-shadow:inset 0 1px 0 #ffffff${byte(lerp(0.22, 0.42, t))},inset 0 -1px 1px #00000040,inset 0 0 22px #ffffff0a,0 12px 30px #00000066,0 2px 6px #00000047`,
    '--g-shadow-sunken:inset 0 2px 10px #00000066,inset 0 -1px 0 #ffffff1a',
    `--g-fx:blur(${Math.round(lerp(10, 22, t))}px) saturate(${Math.round(lerp(1.15, 1.85, t) * 100) / 100}) brightness(1.04)`,
    `--g-fx-sunken:blur(${Math.round(lerp(6, 12, t))}px) saturate(${Math.round(lerp(1.15, 1.6, t) * 100) / 100})`,
    `--g-legible:${t >= 0.5 ? `0 1px 2px #000000${byte(lerp(0, 0.8, (t - 0.5) * 2))}` : 'none'}`,
  ].join(';')
}

/** `a` moved `t` (0–1) of the way to `b`. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t))
/** A share (0–1) as two hex digits, an alpha. */
const byte = (share: number): string =>
  Math.round(Math.min(1, Math.max(0, share)) * 255)
    .toString(16)
    .padStart(2, '0')

/**
 * A glass panel as liquid glass on the page, by the fill the engine tree gave it, its rim tinted by `edge`: a clear fill
 * (as clear as the person's step), a sheen across the top as light on curved glass, light pooling in from the top left,
 * a rim bright there and fading round the card, an inner glow, and the still scene blurred and brightened through it.
 * The clearer the glass, the more it blurs, and the more its text carries a soft shadow, so text over it still reads.
 */
function panelStyle(fill: string, edge: string | undefined, dress: Dress): string | undefined {
  const tone = fill === dress.glass.raised ? 'raised' : fill === dress.glass.fill ? 'fill' : fill === dress.glass.sunken ? 'sunken' : undefined
  if (!tone) return undefined
  const t = dress.clarity
  const rim = edge && /^#[0-9a-f]{6}/i.test(edge) ? edge.slice(0, 7) : dress.edgeStrong.slice(0, 7)
  const share = tone === 'raised' ? lerp(0.9, 0.2, t) : tone === 'fill' ? lerp(0.82, 0.16, t) : lerp(0.74, 0.12, t)
  const glassFill = alpha(fill, byte(share))
  const sunken = tone === 'sunken'
  // The shared layers (the sheen, the shadows, the blur, the text's shadow) are the scroll area's (glassVars); a card
  // holds only its own fill and its rim, tinted by its agent. The page is Chromium's: no prefixed twin is needed.
  const own = sunken ? '-sunken' : ''
  return (
    `border-radius:${sunken ? 12 : 16}px;border:1px solid transparent;background:var(--g-sheen),linear-gradient(${glassFill},${glassFill}) padding-box,` +
    `linear-gradient(140deg,#ffffff${byte(lerp(0.42, 0.66, t))},${rim}80 24%,#ffffff12 56%,#ffffff3d) border-box;` +
    `box-shadow:var(--g-shadow${own});backdrop-filter:var(--g-fx${own});text-shadow:var(--g-legible)`
  )
}

/** A title's or heading's span: the display face at its size, its colour and weight, cut with an ellipsis. */
function headingStyle(props: Record<string, string | number | boolean>, dress: Dress, size: 'title' | 'heading'): string {
  const color = typeof props.color === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(props.color) ? props.color : dress.ink
  const weight = props.weight === 'bold' ? 700 : props.weight === 'normal' ? 400 : 600
  return (
    `font-family:${dress.display};font-size:${size === 'title' ? '21px' : '15.5px'};font-weight:${weight};color:${color};` +
    `letter-spacing:${size === 'title' ? '.015em' : '.01em'};text-shadow:0 1px 10px #000000a6;` +
    'display:inline-block;max-width:100%;white-space:pre;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;line-height:1.3'
  )
}

/** Vertical spacing props a Client doubles (a unit is a line there): halved here. */
const VERTICAL = ['paddingY', 'paddingTop', 'paddingBottom', 'marginY', 'marginTop', 'marginBottom', 'rowGap'] as const

/**
 * The page's one vertical gap between wrapped rows, in lines: the agent cards' list's (rowGap 1 in the engine tree, half
 * a line), so pills, tabs, chips and the summary cards wrap with the same breathing room as the cards below them.
 */
export const WRAP_ROW_GAP = 0.5

/** A wrapping row that sets no vertical gap of its own takes the page's one (WRAP_ROW_GAP): wrapped rows never touch. */
function withRowGap(props: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  if (props.flexWrap !== 'wrap' || props.rowGap !== undefined || props.gap !== undefined) return props
  return { ...props, rowGap: WRAP_ROW_GAP }
}

function halveVertical(props: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out = { ...props }
  for (const name of VERTICAL) if (typeof out[name] === 'number') out[name] = (out[name] as number) / 2
  if (typeof out.gap === 'number' && out.flexDirection === 'column') out.gap = (out.gap as number) / 2
  return out
}

type Build = { page: boolean; dress: Dress; press: (key: string, nth: number) => void; seen: Map<string, number> }

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i
const WEIGHT: Record<string, number> = { regular: 400, medium: 500, semibold: 600, bold: 700 }

/**
 * A run inside a line of text, as a plain span: its colour, background, weight, slant, lines and face. The page draws a
 * nested Text with its own `white-space`, which would break the run out of its line's truncation; a span inherits it.
 */
function runStyle(props: Record<string, string | number | boolean>): string {
  const weight = typeof props.weight === 'string' ? WEIGHT[props.weight] : props.bold === true ? 600 : undefined
  const lines = [props.underline === true ? 'underline' : '', props.strikethrough === true ? 'line-through' : ''].filter(Boolean).join(' ')
  return [
    typeof props.color === 'string' && HEX.test(props.color) ? `color:${props.color}` : '',
    typeof props.backgroundColor === 'string' && HEX.test(props.backgroundColor) ? `background-color:${props.backgroundColor};border-radius:3px;padding:0 .2ch` : '',
    props.dimColor === true ? 'opacity:.6' : '',
    weight ? `font-weight:${weight}` : '',
    props.italic === true ? 'font-style:italic' : '',
    lines ? `text-decoration:${lines}` : '',
    props.mono === true ? 'font-family:var(--cds-font-mono)' : '',
    props.tabular === true ? 'font-variant-numeric:tabular-nums' : '',
  ]
    .filter(Boolean)
    .join(';')
}

function rebuild(node: ClientNode, b: Build, selected = false, inText = false): ClientNode {
  if (typeof node === 'string') return node
  // A selected tab's or chip's capsule (`sel-<key>`): on the page its Button is drawn as the lit pill, no capsule.
  if (b.page && node.type === 'Box' && String(node.props?.key ?? '').startsWith('sel-') && node.children?.length === 1) {
    return rebuild(node.children[0]!, b, true)
  }
  const children = node.children?.map(child => rebuild(child, b, false, b.page && (inText || node.type === 'Text')))
  if (node.type === 'Button') {
    const key = String(node.props?.key ?? '')
    const nth = b.seen.get(key) ?? 0
    b.seen.set(key, nth + 1)
    // A plain object with its handler on `onPress`: what the runtime holds a Button's closure from.
    const button = { type: 'Button', props: node.props, ...(children ? { children } : {}), onPress: () => b.press(key, nth) } as ClientElement
    return b.page ? tag('div', pillStyle(node.props, b.dress, selected), [button]) : button
  }
  if (!b.page) return { type: node.type, ...(node.props ? { props: node.props } : {}), ...(children ? { children } : {}) }
  if (node.type === 'Text') {
    const own = node.props ?? {}
    const size = own.size
    // A heading in the scene's display face: the page sets a heading's face itself, so it becomes a styled span.
    if (size === 'heading') return tag('span', headingStyle(own, b.dress, 'heading'), children ?? [])
    // A run inside a line: a plain span, so the line's wrapping or truncation holds for it.
    if (inText && size === undefined && own.inverse !== true) return tag('span', runStyle(own), children ?? [])
    const text: ClientElement = { type: 'Text', props: own, ...(children ? { children } : {}) }
    // A title takes the display face through the page's own title-face variable (set on the scroll area); the shadow
    // (inherited) lets it read over any light.
    return size === 'title' ? tag('span', 'text-shadow:0 1px 10px #000000a6', [text]) : text
  }
  const props = withRowGap(halveVertical(node.props ?? {}))
  const rebuilt: ClientElement = { type: node.type, props, ...(children ? { children } : {}) }
  // A glass panel: a frosted card around the Box, which keeps its layout and padding; the card carries the edge.
  const fill = node.type === 'Box' ? props.backgroundColor : undefined
  const card = typeof fill === 'string' ? panelStyle(fill, typeof props.borderColor === 'string' ? props.borderColor : undefined, b.dress) : undefined
  if (!card) return rebuilt
  // The card is the flex item now: it takes the Box's size and its place in the row or column (grow, shrink, alignment,
  // margins, in the engine tree's units); the Box inside keeps its layout and padding.
  const { backgroundColor: _fill, borderStyle: _style, borderColor: _edge, width, flexGrow, flexShrink, flexBasis, alignSelf, ...inner } = props
  const own = node.props ?? {}
  const item = [
    typeof width === 'number' ? `width:${width}ch;max-width:100%` : typeof width === 'string' ? `width:${width}` : '',
    typeof flexGrow === 'number' ? `flex-grow:${flexGrow}` : '',
    typeof flexShrink === 'number' ? `flex-shrink:${flexShrink}` : '',
    typeof flexBasis === 'number' ? `flex-basis:${flexBasis}ch` : typeof flexBasis === 'string' ? `flex-basis:${flexBasis}` : '',
    typeof alignSelf === 'string' ? `align-self:${alignSelf}` : '',
    ...marginsOf(own),
  ].filter(Boolean)
  for (const name of MARGINS) delete inner[name]
  return tag('div', [card, ...item, 'min-width:0', 'box-sizing:border-box', 'display:flex', 'flex-direction:column'].join(';'), [
    { ...rebuilt, props: width === undefined ? inner : { ...inner, width: '100%' } },
  ])
}

const MARGINS = ['margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight'] as const

/** A Box's margins as CSS on its card, in the engine tree's units: a column is `ch`, a row half a line. */
function marginsOf(props: Record<string, string | number | boolean>): string[] {
  const n = (name: (typeof MARGINS)[number]): number | undefined => (typeof props[name] === 'number' ? (props[name] as number) : undefined)
  const all = n('margin')
  const top = n('marginTop') ?? n('marginY') ?? all
  const bottom = n('marginBottom') ?? n('marginY') ?? all
  const left = n('marginLeft') ?? n('marginX') ?? all
  const right = n('marginRight') ?? n('marginX') ?? all
  return [
    top !== undefined ? `margin-top:${top * 0.5}lh` : '',
    bottom !== undefined ? `margin-bottom:${bottom * 0.5}lh` : '',
    left !== undefined ? `margin-left:${left}ch` : '',
    right !== undefined ? `margin-right:${right}ch` : '',
  ].filter(Boolean)
}

/** The tree this module draws: the content, in the page's scroll area or (no raw `div` here) a Box. */
export function contentClientTree(props: ContentClientProps, opts: { page: boolean; press: (key: string, nth: number) => void }): ClientElement {
  const content = rebuild(unflatten(props.tree), { page: opts.page, dress: props.dress, press: opts.press, seen: new Map() })
  if (!opts.page) return { type: 'Box', props: { flexDirection: 'column', width: '100%' }, children: [content] }
  const rows = Math.max(1, Math.floor(props.rows))
  const keeper = tag('div', KEEPER_STYLE, [{ type: 'Svg', props: { source: keeperSource(props.place ?? ''), alt: 'scroll keeper', width: 1, height: 1, isInteractive: true } }])
  // Made to the page's schema last (shape.ts `fitPage`): one element it refuses (a key built from a long path, say)
  // would make it refuse the whole tree, and the pane would fall back to a scene that follows scrolling.
  return fitPage(
    tag(
      'div',
      // The pane's rows tall, always: a Client's region is only as tall as what it draws, so the scroll area states its
      // own height and scrolls everywhere over the scene.
      `position:relative;height:${rows}lh;max-height:${rows}lh;width:100%;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;` +
        // No scrollbar of its own: the content is laid out to the pane's full width (a row of cards fills it exactly), and
      // a scrollbar's few pixels would push its last card onto a row of its own. A soft fade at the foot says there is
      // more below; the wheel, the trackpad and touch scroll as ever.
      `scrollbar-width:none;mask-image:linear-gradient(180deg,#000 0,#000 calc(100% - 1.2lh),#0000 100%);` +
      `color:${props.dress.ink};padding-bottom:1.5lh;box-sizing:border-box;` +
        `--engine-title-face:${props.dress.display};${glassVars(props.dress)}`,
      [keeper, content],
    ),
  ) as ClientElement
}

/** Whether this module runs in the desktop page's runtime (a browser frame, with a document) rather than the engine's host. */
const inPage = (): boolean => typeof (globalThis as { document?: unknown }).document === 'object'

const ContentClient: ClientModule<ContentClientProps> = (props, surface) =>
  // Raw `div`, `span` and `Svg` are outside the typed ClientElements (see the header): cast, deliberately.
  contentClientTree(props, { page: inPage(), press: (key, nth) => surface.post({ press: key, nth } satisfies PressMessage) }) as unknown as RenderElement

export default ContentClient
