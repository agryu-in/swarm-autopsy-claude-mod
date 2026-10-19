// Shell command reading for verification: which segment of a command runs a
// test or a check, and whether the command's exit status is that segment's.
// A segment is read by the command at its head, never by words inside it.

import type { VerificationKind } from '../../types'

// A heredoc's body, from `<<EOF` (or <<-'EOF', <<"EOF") to its closing word.
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\s|$)/g
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
  return command
    .replace(HEREDOC, ' ')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\d*>&\d*|&>>?/g, ' ')
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
