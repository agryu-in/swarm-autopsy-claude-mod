// Colour maths for the scene themes: OKLCH (perceptual lightness, chroma, hue), contrast, and the harmonising step
// that turns a meaning's colour (green for verified, red for a failure) into its version for a scene. Pure.

export type Lch = { l: number; c: number; h: number }

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(at => parseInt(h.slice(at, at + 2), 16) / 255) as [number, number, number]
}

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

function rgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function oklabToRgb([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

export function toLch(hex: string): Lch {
  const [l, a, b] = rgbToOklab(hexToRgb(hex))
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h }
}

const inGamut = ([r, g, b]: [number, number, number]): boolean => [r, g, b].every(v => v >= -0.0005 && v <= 1.0005)

/** An OKLCH colour as `#rrggbb`, its chroma eased down until it fits sRGB (hue and lightness kept). */
export function fromLch({ l, c, h }: Lch): string {
  const rad = (h * Math.PI) / 180
  let chroma = c
  let rgb = oklabToRgb([l, chroma * Math.cos(rad), chroma * Math.sin(rad)])
  while (!inGamut(rgb) && chroma > 0) {
    chroma = Math.max(0, chroma - 0.004)
    rgb = oklabToRgb([l, chroma * Math.cos(rad), chroma * Math.sin(rad)])
  }
  return `#${rgb.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('')}`
}

/** The signed shortest turn from hue `from` to hue `to`, in degrees. */
export const hueTurn = (from: number, to: number): number => ((((to - from) % 360) + 540) % 360) - 180

/** How a scene bends a meaning's colour: toward its key hue by `pull`, its chroma scaled and capped, its lightness set. */
export type Harmony = { hue: number; pull: number; chroma: number; maxChroma: number }

/** A meaning's colour (`hue`, as a vivid reference) in a scene's harmony, at lightness `l`. */
export function harmonize(hue: number, harmony: Harmony, l: number, baseChroma = 0.15): string {
  const h = hue + harmony.pull * hueTurn(hue, harmony.hue)
  return fromLch({ l, c: Math.min(harmony.maxChroma, baseChroma * harmony.chroma), h: (h + 360) % 360 })
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Perceptual distance of two colours (Euclidean in OKLab): below about 0.08 two marks start to read as one. */
export function distance(a: string, b: string): number {
  const [l1, a1, b1] = rgbToOklab(hexToRgb(a))
  const [l2, a2, b2] = rgbToOklab(hexToRgb(b))
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** `top` (6- or 8-digit hex) composited over the opaque `under`, as 6-digit hex. */
export function over(top: string, under: string): string {
  const t = top.replace('#', '')
  const alpha = t.length === 8 ? parseInt(t.slice(6, 8), 16) / 255 : 1
  const [tr, tg, tb] = hexToRgb(`#${t.slice(0, 6)}`)
  const [ur, ug, ub] = hexToRgb(under)
  const mixc = (x: number, y: number) => Math.round((x * alpha + y * (1 - alpha)) * 255).toString(16).padStart(2, '0')
  return `#${mixc(tr, ur)}${mixc(tg, ug)}${mixc(tb, ub)}`
}
