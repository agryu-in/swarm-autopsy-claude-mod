// Shared text between one agent's report and another agent's delegation
// prompt: the longest run of whole words both contain, found through an index
// of word 7-grams (linear in the texts' length, not quadratic).

export const GRAM = 7
const MIN_CHARS = 40

export type Overlap = { text: string; words: number }

function words(text: string): string[] {
  return text
    .replace(/[`*_"']/g, '')
    .split(/\s+/)
    .map(word => word.replace(/^[([{]+|[.,;:!?)\]}]+$/g, ''))
    .filter(word => word.length > 0)
}

type Indexed = { words: string[]; grams: string[]; set: Set<string>; flat: string }

function indexOf(text: string): Indexed {
  const list = words(text)
  const grams: string[] = []
  for (let i = 0; i + GRAM <= list.length; i += 1) grams.push(list.slice(i, i + GRAM).join(' '))
  return { words: list, grams, set: new Set(grams), flat: ` ${list.join(' ')} ` }
}

function overlapOf(a: Indexed, b: Indexed, boilerplate: Indexed): Overlap | undefined {
  if (a.grams.length === 0 || b.grams.length === 0) return undefined
  let best: Overlap | undefined
  let runStart = -1
  const close = (end: number) => {
    if (runStart < 0) return
    const text = a.words.slice(runStart, end + GRAM - 1).join(' ')
    const count = end - runStart + GRAM - 1
    const found = b.flat.includes(` ${text} `) ? { text, words: count } : { text: a.grams[runStart] ?? '', words: GRAM }
    if (found.text.length >= MIN_CHARS && (!best || found.words > best.words)) best = found
    runStart = -1
  }
  a.grams.forEach((gram, i) => {
    const shared = b.set.has(gram) && !boilerplate.set.has(gram)
    if (shared && runStart < 0) runStart = i
    if (!shared) close(i)
  })
  close(a.grams.length)
  return best
}

export type Overlapper = (source: string, target: string, exclude?: string) => Overlap | undefined

/**
 * A function finding the longest run of at least seven words and forty
 * characters of `source` that `target` also contains, ignoring any run
 * `exclude` contains too (text both were handed by the same coordinator is no
 * evidence one forwarded the other). It indexes each text once.
 */
export function createOverlapper(): Overlapper {
  const cache = new Map<string, Indexed>()
  const index = (text: string): Indexed => {
    const hit = cache.get(text)
    if (hit) return hit
    const made = indexOf(text)
    cache.set(text, made)
    return made
  }
  return (source, target, exclude = '') => overlapOf(index(source), index(target), index(exclude))
}

export function verbatimOverlap(source: string, target: string, exclude = ''): Overlap | undefined {
  return createOverlapper()(source, target, exclude)
}

/** A path-like mention both lists contain, equal or one a path suffix of the other. */
export function sharedMention(a: readonly string[], b: readonly string[]): string | undefined {
  for (const left of a) {
    for (const right of b) {
      if (left === right) return left
      if (left.includes('/') && right.includes('/') && (left.endsWith(`/${right}`) || right.endsWith(`/${left}`))) return left
    }
  }
  return undefined
}
