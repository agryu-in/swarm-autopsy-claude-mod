// Desktop-only vector painters for the visual redesign (DESIGN-CONTRACT §2,
// §6). Pure: each returns Svg markup sized by its viewBox (no fixed width, so it
// scales to its slot) and a one-line alt that carries every number it draws.
// A drawing never holds information its native twin (Text beside it) lacks.

import type { Measure } from '../../types'
import { pct } from '../lib/format'
import { SVG_HEX } from '../lib/palette'

export type SvgPicture = { source: string; alt: string; height: number }

/** Escapes text for an Svg attribute or text node. */
export function svgEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const r2 = (n: number): string => (Math.round(n * 100) / 100).toString()

/** The point at `fraction` of a full turn, clockwise from twelve o'clock. */
function pointAt(cx: number, cy: number, r: number, fraction: number): [number, number] {
  const angle = fraction * 2 * Math.PI
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]
}

/** An arc path from twelve o'clock over `fraction` of the circle (0 < fraction < 1). */
function arcPath(cx: number, cy: number, r: number, fraction: number): string {
  const [x, y] = pointAt(cx, cy, r, fraction)
  const large = fraction > 0.5 ? 1 : 0
  return `M ${r2(cx)} ${r2(cy - r)} A ${r} ${r} 0 ${large} 1 ${r2(x)} ${r2(y)}`
}

/**
 * A context ring: a faint track and an arc for `percent` (0–100), solid when OBSERVED and dashed when ESTIMATED, the
 * value in the middle. UNAVAILABLE draws no ring (the caller shows ∅ and the reason instead).
 */
export function ringSvg(input: { percent: number; measure: Measure; label?: string }): SvgPicture | undefined {
  if (input.measure === 'UNAVAILABLE' || !Number.isFinite(input.percent)) return undefined
  const size = 64
  const c = size / 2
  const r = 26
  const value = Math.min(100, Math.max(0, input.percent))
  const fraction = value / 100
  const estimated = input.measure === 'ESTIMATED'
  // OBSERVED: a cyan-to-blue arc (the context hue); ESTIMATED: a dashed amber arc (the estimate hue).
  const stroke = estimated ? SVG_HEX.caution : 'url(#sa-ring)'
  const ink = estimated ? SVG_HEX.caution : SVG_HEX.context
  const dash = estimated ? ' stroke-dasharray="5 3"' : ''
  // The same rounding as the text beside it (pct), so the ring never says ≈10% next to ≈ 9.9%.
  const shown = pct(value)
  const glyph = estimated ? '≈' : ''
  const arc =
    fraction >= 1
      ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${stroke}" stroke-width="6"${dash}/>`
      : fraction > 0
        ? `<path d="${arcPath(c, c, r, fraction)}" fill="none" stroke="${stroke}" stroke-width="6" stroke-linecap="round"${dash}/>`
        : ''
  const label = input.label ? `<title>${svgEscape(input.label)}</title>` : ''
  const gradient = estimated
    ? ''
    : `<defs><linearGradient id="sa-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${SVG_HEX.context}"/><stop offset="1" stop-color="${SVG_HEX.contextDeep}"/></linearGradient></defs>`
  const fontSize = shown.length > 4 ? 12 : 14
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${label}${gradient}` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${SVG_HEX.track}" stroke-opacity="0.25" stroke-width="6"/>` +
    arc +
    `<text x="${c}" y="${c + 5}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${fontSize}" font-weight="600" fill="${ink}">${svgEscape(glyph + shown)}</text>` +
    `</svg>`
  const kind = estimated ? 'estimated' : 'observed'
  return { source, alt: `Context ${glyph}${shown} (${kind})${input.label ? `: ${input.label}` : ''}`, height: size }
}

export type SparkMarker = { index: number; kind: 'compaction' | 'stop' }

/**
 * An area sparkline of per-request values, oldest first, with the newest point marked and optional ticks at captured
 * compactions or context stop reasons (by sample index). Fewer than two values draw nothing.
 */
export function sparkSvg(input: { values: readonly number[]; markers?: readonly SparkMarker[]; label: string }): SvgPicture | undefined {
  const values = input.values.filter(v => Number.isFinite(v) && v >= 0)
  if (values.length < 2) return undefined
  const w = 240
  const h = 48
  const pad = 4
  const max = Math.max(...values, 1)
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - 2 * pad)
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad)
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${r2(x(i))} ${r2(y(v))}`).join(' ')
  const area = `${line} L ${r2(x(values.length - 1))} ${h - pad} L ${r2(x(0))} ${h - pad} Z`
  const last = values.length - 1
  const ticks = (input.markers ?? [])
    .filter(m => m.index >= 0 && m.index < values.length)
    .map(m => {
      const colour = m.kind === 'compaction' ? SVG_HEX.analytic : SVG_HEX.caution
      return `<line x1="${r2(x(m.index))}" y1="${pad}" x2="${r2(x(m.index))}" y2="${h - pad}" stroke="${colour}" stroke-width="1.5" stroke-dasharray="3 2"/>`
    })
    .join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><title>${svgEscape(input.label)}</title>` +
    `<defs><linearGradient id="sa-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SVG_HEX.context}" stop-opacity="0.45"/><stop offset="1" stop-color="${SVG_HEX.context}" stop-opacity="0.04"/></linearGradient></defs>` +
    `<path d="${area}" fill="url(#sa-fill)"/>` +
    `<path d="${line}" fill="none" stroke="${SVG_HEX.context}" stroke-width="1.6" stroke-linejoin="round"/>` +
    ticks +
    `<circle cx="${r2(x(last))}" cy="${r2(y(values[last] ?? 0))}" r="2.6" fill="${SVG_HEX.context}"/>` +
    `</svg>`
  return { source, alt: input.label, height: h }
}

// ── The header's live dot (the pane's backdrop is the Midnight scene: scene.ts) ──

/**
 * The header's live dot: a cyan dot whose halo breathes while agents are active. Drawn as an interactive Svg with a
 * source that never changes, so the desktop keeps the frame (and the animation) across redraws; a reduced-motion
 * preference stops it.
 */
export const LIVE_DOT: SvgPicture = {
  get source() {
    return liveDotSource()
  },
  alt: 'live: agents are active',
  height: 14,
}

/** The live dot in the active theme's context light (its source changes only with the scene). */
function liveDotSource(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    `<style>@keyframes sa-breathe{0%,100%{opacity:.15;r:4px}50%{opacity:.55;r:7px}}.sa-halo{animation:sa-breathe 2.4s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.sa-halo{animation:none;opacity:.3}}</style>` +
    `<circle class="sa-halo" cx="8" cy="8" r="6" fill="${SVG_HEX.context}" opacity="0.3"/>` +
    `<circle cx="8" cy="8" r="3.2" fill="${SVG_HEX.context}"/>` +
    '</svg>'
  )
}
