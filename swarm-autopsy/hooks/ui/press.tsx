// Press targets (docs/sunset-glass/DESIGN-CONTRACT.md §9): flattening styled
// Text into runs, and the card line that is one press target. The desktop draws a
// Button's label only, as one plain line (R1 §4.1), so there a line's styled
// pieces (a chip, a pill) sit beside the Button and the Button carries the
// line's plain text; the terminal keeps every run's style inside the Button.
// Lead-owned; the kit re-exports everything here.

import type { RenderChildren } from 'claude-code'

import type { ViewContext } from './common'

/** Text props that style a run; everything else (wrap, key, hover) is the container's business. */
const RUN_STYLE_KEYS = ['color', 'backgroundColor', 'dimColor', 'weight', 'italic', 'underline', 'strikethrough', 'inverse', 'mono', 'tabular', 'size'] as const

export type RunStyle = Partial<Record<(typeof RUN_STYLE_KEYS)[number], unknown>>

/** Walks nested Text elements into flat runs of text, each with the style it inherits from every Text around it. */
export function textRuns(node: unknown, style: RunStyle = {}, out: Array<{ style: RunStyle; text: string }> = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node)
    const last = out.at(-1)
    // Neighbouring runs of the same style join, so the tree stays small.
    if (last && RUN_STYLE_KEYS.every(k => last.style[k] === style[k])) last.text += text
    else if (text) out.push({ style, text })
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) textRuns(child, style, out)
    return out
  }
  if (typeof node === 'object') {
    const element = node as { props?: Record<string, unknown>; children?: unknown }
    const props = element.props ?? {}
    const merged: RunStyle = { ...style }
    for (const key of RUN_STYLE_KEYS) if (props[key] !== undefined) merged[key] = props[key]
    textRuns(element.children ?? props.children, merged, out)
  }
  return out
}

/** U+2007 FIGURE SPACE: as wide as a digit, so padding with it widens a desktop label by about one cell each. */
const FIGURE_SPACE = ' '

/**
 * One line of a pressable card (§9): the whole line is one plain Button calling `onPress`.
 *
 * - Terminal: the Button holds `lead` and `children` as styled runs (chips, meters and `█` bars keep their colours).
 * - Desktop: `lead` (a chip, a state pill: anything styled) is drawn beside the Button, and the Button's label is the
 *   plain text of `children`. `fill` pads that label with figure spaces to about `fill` cells, so the target can span
 *   the line; `dim` draws it dim.
 *
 * Callers pre-fit `children` to the line's width (the terminal wraps a Button's text whatever a Text says) and put
 * any spacing between `lead` and `children` in `lead`.
 */
export function PressRow(
  ctx: ViewContext,
  input: { key: string; onPress: () => void; lead?: RenderChildren; children: RenderChildren; selected?: boolean; dim?: boolean; fill?: number },
) {
  const { Box, Text, Button } = ctx.els
  const base = input.selected ? { weight: 'bold' } : {}
  if (ctx.surface === 'terminal') {
    const runs = textRuns([input.lead ?? null, input.children], input.dim ? { ...base, dimColor: true } : base)
    return (
      <Button key={input.key} plain onPress={input.onPress}>
        {runs.map(run => (
          <Text {...(run.style as Record<string, never>)}>{run.text}</Text>
        ))}
      </Button>
    )
  }
  const text = textRuns(input.children)
    .map(run => run.text)
    .join('')
  const pad = input.fill !== undefined ? Math.max(0, Math.floor(input.fill) - text.length) : 0
  const button = <Button key={input.key} plain dimColor={input.dim === true} label={text + FIGURE_SPACE.repeat(pad)} onPress={input.onPress} />
  if (input.lead === undefined || input.lead === null) return button
  return (
    <Box key={`pr-${input.key}`} flexDirection="row">
      <Text>{input.lead}</Text>
      {button}
    </Box>
  )
}
