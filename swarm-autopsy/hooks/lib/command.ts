// Shell command reading for verification: which segment of a command runs a
// test or a check, and whether the command's exit status is that segment's.
// A segment is read by the command at its head, never by words inside it.

import type { VerificationKind } from '../../types'

// A heredoc's opener (`<<EOF`, <<-'EOF', <<"EOF") and a line that can close one: its first word, alone or followed by
// a space. Every scan below is one pass over the command, because a Bash command's text is not bounded.
const HEREDOC_OPENER = /<<-?\s*(['"]?)(\w+)\1/
const HEREDOC_CLOSER = /^\s*(\w+)(?=\s|$)/
// A redirection such as `2>&1` or `&>>`. The lookbehind starts a digit run's match only at its first digit.
const REDIRECTION = /(?<!\d)\d*>&\d*|&>>?/g
const SEPARATORS = new Set(['||', '&&', '|', ';', '\n', '&'])
const SPLIT = /(\|\||&&|\||;|\n|&)/

const RUNNER_PREFIX = String.raw`(?:npx\s+|bunx\s+|pnpm\s+(?:exec|dlx)\s+|yarn\s+)?(?:\.\/node_modules\/\.bin\/)?`
const SCRIPT_PREFIX = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:-\S+\s+)*(?:run\s+)?`
const END = String.raw`(?:\s|$)`

const TEST_HEADS: readonly RegExp[] = [
  new RegExp(`^${RUNNER_PREFIX}(?:pytest|py\\.test|jest|vitest|mocha|ava|tap|rspec|phpunit|ctest)${END}`),
  new RegExp(`^${SCRIPT_PREFIX}(?:test|t)(?::\\S+)?${END}`),
  new RegExp(`^(?:go\\s+test|cargo\\s+(?:test|nextest)|dotnet\\s+test|swift\\s+test|deno\\s+test|bun\\s+test)${END}`),
  new RegExp(`^node\\s+(?:\\S+\\s+)*--test${END}`),
  new RegExp(`^make\\s+(?:-\\S+\\s+)*(?:test|check)${END}`),
  new RegExp(`^mvn\\s+(?:-\\S+\\s+)*test${END}`),
  new RegExp(`^(?:\\.\\/)?gradlew?\\s+(?:\\S+\\s+)*test${END}`),
  new RegExp(`^python3?\\s+-m\\s+(?:pytest|unittest)${END}`),
  new RegExp(`^claude\\s+plugin\\s+test${END}`),
]

const CHECK_HEADS: readonly RegExp[] = [
  new RegExp(`^${RUNNER_PREFIX}(?:tsc|eslint|ruff|mypy|pyright|flake8|pylint|golangci-lint|biome)${END}`),
  new RegExp(`^${SCRIPT_PREFIX}(?:typecheck|type-check|lint|build|check)(?::\\S+)?${END}`),
  new RegExp(`^(?:cargo\\s+(?:check|clippy|build)|go\\s+(?:vet|build))${END}`),
  new RegExp(`^python3?\\s+-m\\s+(?:mypy|ruff|pyright|flake8)${END}`),
  new RegExp(`^claude\\s+plugin\\s+validate${END}`),
]

export type CommandSegment = {
  /** The segment's text, quotes and heredoc bodies blanked, env assignments dropped. */
  text: string
  /** The separator before it ('' for the first). */
  joiner: string
}

/** Blanks what is data, not command: heredoc bodies, quoted strings, `2>&1`-style redirections. */
function blankData(command: string): string {
  return blankQuotes(blankHeredocs(command)).replace(REDIRECTION, ' ')
}

/**
 * Each heredoc, from its `<<WORD` to the end of the first later line that closes it, becomes one space: the opener
 * line's text before `<<` and the closing line's text after the word stay. An unclosed heredoc stays as it is.
 */
function blankHeredocs(command: string): string {
  if (!command.includes('<<')) return command
  const lines = command.split('\n')
  const closersOf = new Map<string, number[]>()
  lines.forEach((line, index) => {
    const word = HEREDOC_CLOSER.exec(line)?.[1]
    if (word === undefined) return
    const known = closersOf.get(word)
    if (known) known.push(index)
    else closersOf.set(word, [index])
  })
  // Openers are met in line order, so each word's list is walked forward once.
  const passed = new Map<string, number>()
  const closerAfter = (word: string, index: number): number | undefined => {
    const closers = closersOf.get(word) ?? []
    let at = passed.get(word) ?? 0
    while (at < closers.length && (closers[at] ?? Infinity) <= index) at += 1
    passed.set(word, at)
    return closers[at]
  }
  const kept: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const opener = HEREDOC_OPENER.exec(line)
    const closer = opener ? closerAfter(opener[2] ?? '', index) : undefined
    if (!opener || closer === undefined) {
      kept.push(line)
      index += 1
      continue
    }
    kept.push(`${line.slice(0, opener.index)} ${(lines[closer] ?? '').replace(HEREDOC_CLOSER, '')}`)
    index = closer + 1
  }
  return kept.join('\n')
}

/**
 * Quoted strings emptied (`''`, `""`), read as the shell reads them: a backslash escapes the next character outside
 * single quotes. An unclosed quote leaves the rest of the command as it is.
 */
function blankQuotes(command: string): string {
  if (!/['"]/.test(command)) return command
  let blanked = ''
  let at = 0
  while (at < command.length) {
    const char = command[at]
    if (char === '\\') {
      blanked += command.slice(at, at + 2)
      at += 2
      continue
    }
    if (char !== "'" && char !== '"') {
      blanked += char
      at += 1
      continue
    }
    const end = closingQuote(command, at)
    if (end === undefined) return blanked + command.slice(at)
    blanked += char + char
    at = end + 1
  }
  return blanked
}

/** Where the quote opened at `start` closes, or undefined when it never does. */
function closingQuote(command: string, start: number): number | undefined {
  const quote = command[start]
  for (let at = start + 1; at < command.length; at += 1) {
    if (command[at] === quote) return at
    if (quote === '"' && command[at] === '\\') at += 1
  }
  return undefined
}

function head(text: string): string {
  return text
    .trim()
    .replace(/^(?:\w+=\S*\s+)+/, '')
    .replace(/^time\s+/, '')
}

export function commandSegments(command: string): CommandSegment[] {
  const segments: CommandSegment[] = []
  let joiner = ''
  for (const part of blankData(command).split(SPLIT)) {
    if (SEPARATORS.has(part)) {
      joiner = part
      continue
    }
    const text = head(part)
    if (text.length > 0) segments.push({ text, joiner })
  }
  return segments
}

function kindOf(segment: CommandSegment): VerificationKind | undefined {
  if (TEST_HEADS.some(re => re.test(segment.text))) return 'test'
  if (CHECK_HEADS.some(re => re.test(segment.text))) return 'check'
  return undefined
}

export function verificationKind(command: string): VerificationKind | undefined {
  const kinds = commandSegments(command).map(kindOf)
  if (kinds.includes('test')) return 'test'
  if (kinds.includes('check')) return 'check'
  return undefined
}

/**
 * Why the command's exit status may not be the verification's own: a later
 * step decides it (`| tail`, `|| true`, `; echo`), the check ran only if an
 * earlier step failed, or it was sent to the background. Undefined when the
 * last step is the check and nothing masks it.
 */
export function statusNote(command: string): string | undefined {
  const segments = commandSegments(command)
  const last = segments.map(kindOf).reduce<number>((found, kind, i) => (kind ? i : found), -1)
  if (last === -1) return undefined
  const after = segments.slice(last + 1)
  if (after.length > 0) {
    const step = after[after.length - 1]?.text ?? ''
    return `its exit status comes from a later step (\`${step.length > 30 ? `${step.slice(0, 29)}…` : step}\`), not from the check itself`
  }
  if (segments[last]?.joiner === '||') return 'the check runs only when an earlier step fails'
  if (/(^|[^&])&\s*$/.test(blankData(command))) return 'the check was sent to the background with &'
  return undefined
}

// `cd <dir>` at the head of a command, followed by `&&`, `;` or a new line.
const LEADING_CD = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;|\n)/

/** The directory a leading `cd <dir> &&` (or `;`) moves the rest of the command into. */
export function leadingDirectory(command: string): string | undefined {
  const match = LEADING_CD.exec(command)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

/**
 * `dir` resolved against `base`, `.` and `..` folded: the base itself when
 * there is no `dir`, and undefined when it cannot be known (`~`, or a relative
 * path with no base).
 */
export function resolveDir(dir: string | undefined, base: string | undefined): string | undefined {
  if (dir === undefined) return base
  if (dir.startsWith('~')) return undefined
  const joined = dir.startsWith('/') ? dir : base ? `${base}/${dir}` : undefined
  if (joined === undefined) return undefined
  const parts = joined.split('/').reduce<string[]>((acc, part) => {
    if (part === '' || part === '.') return acc
    return part === '..' ? acc.slice(0, -1) : [...acc, part]
  }, [])
  return `/${parts.join('/')}`
}
