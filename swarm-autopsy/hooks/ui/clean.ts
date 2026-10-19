// The last step before a drawing leaves the render hook: every string it draws
// cleaned of what the engine refuses. A Text's string, a Button's label, an
// alt or an option may hold no control character but tab and newline (labels:
// none at all), and one such character anywhere makes the engine refuse the
// whole tree, so the pane draws nothing and its buttons stop answering
// (reproduced 2026-10-18 in the test host with a command carrying terminal
// colour escapes). Numbers and colours out of the engine's bounds refuse the
// tree the same way, so they are bounded here too. Captured commands, outputs,
// reports and prompts are the person's own text, so the cleaning is here, once,
// rather than in every view. Pure; the tree is copied, never changed in place;
// Svg markup, keys and handlers pass untouched.

/** ANSI escape sequences: CSI (`ESC [ … final`), OSC (`ESC ] … BEL|ST`) and two-byte `ESC x`. */
const ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
/** Control characters a Text may not hold (tab and newline are kept), and the engine's own placeholder U+10EEEE. */
const TEXT_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]|\u{10eeee}/gu
/** Control characters a one-line label may not hold (tab and newline too), and U+10EEEE. */
const LINE_CONTROL = /[\u0000-\u001f\u007f-\u009f]|\u{10eeee}/gu
/** Half of a surrogate pair with no other half: a `.slice()` through an emoji. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/**
 * A string the engine draws: terminal escapes removed, every other control character a space (a carriage return
 * between words stays a gap), split emoji halves the replacement character. `oneLine` for a label: tab and newline
 * become spaces too.
 */
export function cleanText(text: string, opts: { oneLine?: boolean } = {}): string {
  return text
    .replace(ESCAPES, '')
    .replace(opts.oneLine ? LINE_CONTROL : TEXT_CONTROL, ' ')
    .replace(LONE_SURROGATE, '�')
}

/** Props that carry one-line text the engine checks. Keys and Svg source are left as they are. */
const LINE_PROPS = ['label', 'alt', 'title', 'placeholder'] as const

// The engine's bounds on a Box or Text's numbers and colours (2.1.299). One value outside them, a NaN width from a
// 0/0 share say, refuses the whole drawing just as a control character does, so they are held to here too.
/** Every number the engine reads is within this many cells. */
const MAX_CELLS = 10_000
/** Sizes: never negative. */
const SIZE_PROPS = new Set(['width', 'height', 'minWidth', 'minHeight'])
/** Position offsets: whole cells. */
const OFFSET_PROPS = new Set(['top', 'left', 'right', 'bottom'])
const COLOUR_PROPS = new Set(['color', 'backgroundColor', 'borderColor'])
/** A colour as the engine takes one: a theme key, a name, or hex. */
const COLOUR = /^[#a-zA-Z0-9_().,% -]{1,40}$/
/** An Svg is at most this many pixels wide and high. */
const MAX_SVG_PX = 4096

/** A number prop held to the engine's bounds, or undefined (left out) when it is no finite number. */
function boundedNumber(key: string, value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  const bounded = Math.min(MAX_CELLS, Math.max(SIZE_PROPS.has(key) ? 0 : -MAX_CELLS, value))
  return OFFSET_PROPS.has(key) ? Math.round(bounded) : bounded
}

/** A Box or Text's props with every number and colour the engine would refuse bounded or left out. */
function boundStyle(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    const kept = typeof value === 'number' ? boundedNumber(key, value) : COLOUR_PROPS.has(key) && (typeof value !== 'string' || !COLOUR.test(value)) ? undefined : value
    if (kept !== undefined) out[key] = kept
  }
  return out
}

/** An Svg's width and height held to 1–4,096 pixels; one that is no positive finite number is left out. */
function boundSvg(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props }
  for (const key of ['width', 'height'] as const) {
    const value = out[key]
    if (value === undefined) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = Math.min(MAX_SVG_PX, value)
    else delete out[key]
  }
  return out
}

type Element = { type: string; props?: Record<string, unknown>; children?: unknown }

const isElement = (node: unknown): node is Element =>
  node !== null && typeof node === 'object' && !Array.isArray(node) && typeof (node as Element).type === 'string'

function cleanProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = type === 'Box' || type === 'Text' ? boundStyle(props) : type === 'Svg' ? boundSvg(props) : { ...props }
  for (const key of LINE_PROPS) {
    const value = out[key]
    if (typeof value === 'string') out[key] = cleanText(value, { oneLine: true })
  }
  if ('children' in out) out.children = cleanTree(out.children)
  if (Array.isArray(out.options)) {
    out.options = out.options.map(option =>
      option !== null && typeof option === 'object' && typeof (option as { label?: unknown }).label === 'string'
        ? { ...(option as object), label: cleanText((option as { label: string }).label, { oneLine: true }) }
        : option,
    )
  }
  return out
}

/** A drawing with every drawn string cleaned (see `cleanText`); the same shape, a new tree. */
export function cleanTree<T>(node: T): T {
  if (typeof node === 'string') return cleanText(node) as T
  if (Array.isArray(node)) return node.map(child => cleanTree(child)) as T
  if (!isElement(node)) return node
  const copy: Element = { ...node }
  if (node.props) copy.props = cleanProps(node.type, node.props)
  if ('children' in node) copy.children = cleanTree(node.children)
  return copy as T
}
