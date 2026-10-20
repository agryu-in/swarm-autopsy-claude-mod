// Glass surfaces: the glass panel props, panels and pills in the active theme's
// colours, the pane's solid background and the scene behind it (a scene that
// fades into the background, its pickers above it), and the header's live dot.
// Translucent colours are drawn on the desktop only: the terminal paints alpha
// hex as opaque slabs, so `glass()` gives it a plain round border and no fill.
// The kit re-exports everything here.

import type { RenderChildren } from 'claude-code'

import { backgroundSvg } from '../art/background.ts'
import { sceneAlt } from '../art/scene.ts'
import { CLARITY_WORDS, cleanClarity } from '../lib/clarity.ts'
import { contextViewFor, percentText } from '../lib/context'
import { subagents } from '../lib/format'
import { GLASS, ROLE, withAlpha } from '../lib/palette'
import { MODES, cleanMood, currentScene, scenesOf } from '../lib/scenes.ts'
import { PX_PER_COLUMN, PX_PER_ROW } from './client/scene-client.ts'
import type { ViewContext } from './common'
import { LIVE_DOT } from './svg'

/** `raised`: primary content (cards, the inspector, the session hero); `base`: sections; `sunken`: supporting lists. */
export type GlassTone = 'raised' | 'base' | 'sunken'

/** A tone's fill in the active theme. */
const fillOf = (tone: GlassTone): string => (tone === 'raised' ? GLASS.raised : tone === 'base' ? GLASS.fill : GLASS.sunken)

export type GlassProps = { borderStyle: 'round'; borderColor: string; backgroundColor?: string }

/** Whether this surface paints the glass atmosphere and translucency (the desktop, never the terminal). */
export function paintsGlass(ctx: ViewContext): boolean {
  return ctx.surface !== 'terminal'
}

/**
 * The Box props of a glass surface. Desktop: a translucent fill and edge, `edge` tinting the border (identity hex, or a
 * role). Terminal: a round border in `edge` or the muted role, and no fill.
 */
export function glass(ctx: ViewContext, tone: GlassTone, edge?: string): GlassProps {
  if (!paintsGlass(ctx)) return { borderStyle: 'round', borderColor: edge ?? ROLE.muted }
  const borderColor = edge ? withAlpha(edge, '99') : tone === 'raised' ? GLASS.edgeStrong : GLASS.edge
  return { borderStyle: 'round', borderColor, backgroundColor: fillOf(tone) }
}

/** The desktop hover of a pressable glass surface: the edge warms to coral and the fill lifts. Nothing on the terminal. */
export function glassHover(ctx: ViewContext): { borderColor: string; backgroundColor: string } | undefined {
  return paintsGlass(ctx) ? { borderColor: GLASS.hoverEdge, backgroundColor: GLASS.hoverFill } : undefined
}

/**
 * A glass panel: an optional title line (the accent mark, the title, a dim summary) over its children. `hover` lights
 * the whole panel on desktop (it needs `key`). `width` in cells.
 */
export function GlassPanel(
  ctx: ViewContext,
  input: { key?: string; tone: GlassTone; edge?: string; title?: string; summary?: string; width?: number; hover?: boolean; children?: RenderChildren },
) {
  const { Box, Text } = ctx.els
  const hover = input.hover && input.key ? glassHover(ctx) : undefined
  return (
    <Box
      key={input.key}
      flexDirection="column"
      {...glass(ctx, input.tone, input.edge)}
      paddingX={1}
      width={input.width}
      {...(hover ? { hover } : {})}
    >
      {input.title ? (
        <Text wrap="truncate-end">
          <Text color={ROLE.accent}>▌</Text>
          <Text weight="semibold" size="heading" wrap="truncate-end" {...(ROLE.heading ? { color: ROLE.heading } : {})}>
            {' '}
            {input.title}
          </Text>
          {input.summary ? (
            <Text dimColor wrap="truncate-end">
              {' · '}
              {input.summary}
            </Text>
          ) : (
            ''
          )}
        </Text>
      ) : null}
      {input.children ?? null}
    </Box>
  )
}

/**
 * A pill: a short fact in a small round glass capsule on desktop; plain text on the terminal, where a bordered Box would
 * cost three rows. `edge` tints the capsule (a role or hex).
 */
export function Pill(ctx: ViewContext, input: { key?: string; edge?: string; children: RenderChildren }) {
  const { Box, Text } = ctx.els
  if (!paintsGlass(ctx)) return <Text key={input.key}>{input.children}</Text>
  return (
    <Box key={input.key} {...glass(ctx, 'base', input.edge)} paddingX={1} paddingY={0}>
      <Text wrap="truncate-end">{input.children}</Text>
    </Box>
  )
}

/**
 * The pane's own Box props on the desktop when its content is drawn in the engine tree (no still Client): the scene's
 * base colour, at least the visible rows tall, clipping the background frame so it never lengthens the scroll.
 */
export function paneTint(ctx: ViewContext): { backgroundColor?: string; minHeight?: number; overflow?: 'hidden' } {
  return paintsGlass(ctx) ? { backgroundColor: GLASS.tint, minHeight: ctx.rows, overflow: 'hidden' } : {}
}

/** Keys of the toolbar's controls. */
export const SCENE_KEYS = {
  mode: 'sa-pick-mode',
  scene: 'sa-pick-scene',
  play: 'sa-play',
  volume: (step: number) => `sa-vol-${step}`,
  glass: (step: number) => `sa-glass-${step}`,
} as const

/** From this many columns the music row says "Volume" before its steps. */
const VOLUME_WORD_FROM = 40

/** The volume steps, quiet to loud. */
const VOLUME_GLYPHS = ['▁', '▃', '▅', '▇', '█'] as const

/** Where the music stands, in words. */
const WHERE_TEXT: Record<string, string> = {
  here: 'playing here',
  elsewhere: 'playing in another chat',
  paused: 'paused',
  silent: 'this scene has no track',
  unavailable: 'no audio player',
}

/** From this many columns the toolbar puts Mode and Scene on one row; narrower panes stack them. */
export const TOOLBAR_ONE_ROW = 70

/** The toolbar's rows on the desktop: its controls' rows and its frame (border, padding, the gap under it). */
export function toolbarRows(ctx: ViewContext): number {
  if (!paintsGlass(ctx)) return 0
  const controls = ctx.width >= TOOLBAR_ONE_ROW ? 1 : 2
  const music = currentScene(cleanMood(ctx.ui.mood)).music ? 2 : 0
  // The glass row: its steps and its gap above.
  const glassRow = 2
  return controls * 2 + music + glassRow + 3
}

/** From this many columns the glass row says "Transparency" before its steps; narrower panes say "Glass". */
const TRANSPARENCY_WORD_FROM = 56

/**
 * The glass row: how clear the liquid glass is, as five steps from frosted to crystal (the app's own buttons, lit up to
 * the chosen step), and the step in words. One row that never wraps (a wrapping row must not mix buttons and text).
 */
function GlassRow(ctx: ViewContext) {
  const { Box, Button, Text } = ctx.els
  const step = cleanClarity(ctx.ui.glass)
  return (
    <Box key="sa-glass" flexDirection="row" alignItems="center" columnGap={1} marginTop={1}>
      <Text color={ROLE.neutral}>{ctx.width >= TRANSPARENCY_WORD_FROM ? 'Transparency' : 'Glass'}</Text>
      <Box flexDirection="row" columnGap={0}>
        {CLARITY_WORDS.map((word, i) => (
          // A desktop Button draws its label alone, so a step's state is its variant, not a colour.
          <Button key={SCENE_KEYS.glass(i + 1)} variant={i < step ? 'primary' : 'secondary'} label={i < step ? '◆' : '◇'} onPress={() => ctx.act.glass(i + 1)} />
        ))}
      </Box>
      <Text italic color={ROLE.neutral} wrap="truncate-end">
        {CLARITY_WORDS[step - 1]}
      </Text>
    </Box>
  )
}

/** The music row: play or pause, the five volume steps (the app's own buttons), and where the music stands. */
function MusicRow(ctx: ViewContext) {
  const { Box, Button, Text } = ctx.els
  const scene = currentScene(cleanMood(ctx.ui.mood))
  const sound = ctx.ui.sound ?? { isPlaying: false, volume: 2 }
  const player = ctx.ui.player ?? { where: 'paused' as const }
  const status =
    player.where === 'unavailable' && player.note
      ? `no audio: ${player.note}`
      : player.where === 'here' && scene.musicTitle
        ? `playing · ${scene.musicTitle}`
        : (WHERE_TEXT[player.where] ?? player.where)
  return (
    <Box key="sa-music" flexDirection="column">
      {/* One row that never wraps (a wrapping row must not mix buttons and text); a very narrow pane drops the word. */}
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Button key={SCENE_KEYS.play} variant="primary" label={sound.isPlaying ? '⏸ Pause' : '▶ Play'} onPress={() => ctx.act.play()} />
        {ctx.width >= VOLUME_WORD_FROM ? <Text color={ROLE.neutral}>Volume</Text> : null}
        <Box flexDirection="row" columnGap={0}>
          {VOLUME_GLYPHS.map((glyph, i) => (
            // A desktop Button draws its label alone, so a step's state is its variant, not a colour.
            <Button key={SCENE_KEYS.volume(i + 1)} variant={i < sound.volume ? 'primary' : 'secondary'} label={glyph} onPress={() => ctx.act.volume(i + 1)} />
          ))}
        </Box>
      </Box>
      <Text italic color={ROLE.neutral} wrap="truncate-end">
        {status}
      </Text>
    </Box>
  )
}

/**
 * The pane's toolbar on the desktop: the mode and the scene, as the app's own dropdowns, on a quiet glass bar fixed at
 * the top of the pane (it never scrolls: the content scrolls under it). Wide panes keep both on one row; narrow ones
 * stack them, labels aligned. Nothing on the terminal, which draws no scene.
 */
export function SceneToolbar(ctx: ViewContext) {
  if (!paintsGlass(ctx)) return null
  const els = ctx.els
  const { Box, Text } = els
  const mood = cleanMood(ctx.ui.mood)
  const scene = currentScene(mood)
  const modeOptions = MODES.map(m => ({ value: m.id, label: m.label }))
  const sceneOptions = scenesOf(mood.mode).map(s => ({ value: s.id, label: s.title }))
  const field = (label: string, control: unknown) => (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Box width={6} flexShrink={0}>
        <Text color={ROLE.neutral}>{label}</Text>
      </Box>
      {control as never}
    </Box>
  )
  const mode =
    'Select' in els ? (
      <els.Select key={SCENE_KEYS.mode} value={mood.mode} options={modeOptions} onSelect={value => ctx.act.mode(value)} />
    ) : (
      <Text>{MODES.find(m => m.id === mood.mode)?.label}</Text>
    )
  const sceneSelect =
    'Select' in els ? (
      <els.Select key={SCENE_KEYS.scene} value={scene.id} options={sceneOptions} onSelect={value => ctx.act.scene(value)} />
    ) : (
      <Text>{scene.title}</Text>
    )
  const oneRow = ctx.width >= TOOLBAR_ONE_ROW
  return (
    <Box key="sa-toolbar" flexDirection="column" {...glass(ctx, 'sunken')} paddingX={1} paddingY={1} marginBottom={1} flexShrink={0}>
      <Box flexDirection={oneRow ? 'row' : 'column'} columnGap={3} rowGap={1}>
        {field('Mode', mode)}
        {field('Scene', sceneSelect)}
      </Box>
      {scene.music ? (
        <Box flexDirection="column" marginTop={1}>
          {MusicRow(ctx)}
        </Box>
      ) : null}
      {GlassRow(ctx)}
    </Box>
  )
}

/** The scene's name and motto under the title (desktop): what the background is, in the scene's own words. */
export function ThemeLine(ctx: ViewContext) {
  if (!paintsGlass(ctx)) return null
  const { Text } = ctx.els
  const scene = currentScene(cleanMood(ctx.ui.mood))
  return (
    <Text key="sa-theme-line" wrap="truncate-end">
      <Text color={ROLE.accent}>❖ </Text>
      <Text italic color={ROLE.heading ?? ROLE.neutral}>
        {scene.title}
      </Text>
      <Text italic color={ROLE.neutral}>
        {' '}
        · {scene.motto}
      </Text>
    </Text>
  )
}

/** The scene's figures the background draws: the main context's fill and the active subagents. */
export function sceneFigures(ctx: ViewContext): { context: number | undefined; contextText: string; swarm: number } {
  const percent = contextViewFor(ctx.snapshot, 'main').percent
  const value = percent.measure === 'UNAVAILABLE' ? undefined : percent.value
  return {
    context: value === undefined ? undefined : value / 100,
    contextText: value === undefined ? '—' : `${percent.measure === 'ESTIMATED' ? '≈' : ''}${percentText(value)}`,
    swarm: subagents(ctx.snapshot).filter(a => a.state === 'active').length,
  }
}

/** The background picture's words (a blank alt makes the desktop drop it). */
export function backgroundAlt(ctx: ViewContext): string {
  const figures = sceneFigures(ctx)
  return `Background: ${sceneAlt(currentScene(cleanMood(ctx.ui.mood)), figures.contextText, figures.swarm)}`
}

/**
 * The scene behind the pane when its content is drawn in the engine tree (no still Client: the fallback). The pane
 * allows no fixed position, so the background is a frame over the visible window, at the scroll offset and the visible
 * rows tall, redrawn on each scroll step.
 */
export function Backdrop(ctx: ViewContext) {
  if (!paintsGlass(ctx) || !('Svg' in ctx.els)) return null
  const { Box, Svg } = ctx.els
  const scene = currentScene(cleanMood(ctx.ui.mood))
  const figures = sceneFigures(ctx)
  const width = Math.min(4096, Math.max(1, Math.round(ctx.width * PX_PER_COLUMN)))
  const height = Math.min(4096, Math.max(1, Math.round(ctx.rows * PX_PER_ROW)))
  const source = backgroundSvg({ scene, context: figures.context, contextText: figures.contextText, swarm: figures.swarm, frame: { width, height } })
  return (
    <Box key="sg-frame" position="absolute" top={ctx.scrollOffset ?? 0} left={0} width="100%" height={ctx.rows} overflow="hidden">
      <Svg source={source} alt={backgroundAlt(ctx)} width={width} height={height} />
    </Box>
  )
}

/**
 * A zero-size absolute mark that makes its parent a positioned Box, so the content it opens paints above the backdrop
 * drawn before it (desktop only).
 */
export function ContentAnchor(ctx: ViewContext) {
  if (!paintsGlass(ctx)) return null
  const { Box } = ctx.els
  return <Box key="sg-anchor" position="absolute" top={0} left={0} width={0} height={0} />
}

/** The header's breathing live dot while agents are active (desktop); nothing otherwise. */
export function LiveDot(ctx: ViewContext, live: boolean) {
  if (!live || !paintsGlass(ctx) || !('Svg' in ctx.els)) return null
  const { Svg } = ctx.els
  return <Svg key="sg-live" source={LIVE_DOT.source} alt={LIVE_DOT.alt} width={LIVE_DOT.height} height={LIVE_DOT.height} isInteractive />
}
