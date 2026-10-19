// Deterministic reading of tool calls: what a call touches, whether it is a
// verification command, and what its result says. No guessing about meaning:
// every rule here is a string or field test a reader can check.

import type { Access, EditExcerpt, ToolFacts, ToolOutcome, VerificationVerdict } from '../../types'
import { statusNote, verificationKind } from './command'

export const COMMAND_CAP = 400
export const RESULT_CAP = 600
export const EDIT_CAP = 1200
export const MENTION_CAP = 40
export const REPORT_CAP = 2000

/** The tool a background subagent hands its report back through. */
export const HANDBACK_TOOL = 'SubagentHandback'

const READ_TOOLS = new Set(['Read', 'NotebookRead', 'LSP'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Glob', 'Grep', 'LS'])
const EXEC_TOOLS = new Set(['Bash', 'PowerShell'])
const PATH_FIELDS = ['file_path', 'notebook_path', 'filePath'] as const

// A path-like token: optional ./ ../ or /, directory parts, a name with an
// extension that starts with a letter.
const PATH_TOKEN =
  /(?:^|[\s`'"([<{,:=])((?:\.{1,2}\/|\/)?(?:[\w@+-][\w@.+-]*\/)*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s`'")\]>},:;.!?#])/g

const EXIT_CODE = /Exit code (\d+)/

// Error results that mean the command never ran, as the engine words them.
const NOT_RUN: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Permission to use \S+ has been denied/, 'permission was denied'],
  [/^PreToolUse:\S+ hook error/, 'a PreToolUse hook blocked it'],
]

/** Why an error result means the command never ran, when its text says so. */
export function notRunReason(text: string | undefined): string | undefined {
  const trimmed = (text ?? '').trimStart()
  return NOT_RUN.find(([pattern]) => pattern.test(trimmed))?.[1]
}

// Dotted abbreviations the path pattern would otherwise read as file names.
const ABBREVIATIONS = new Set(['e.g', 'i.e', 'a.k.a', 'n.b', 'p.s', 'vs.', 'etc.', 'cf.'])

export function accessFor(tool: string): Access {
  if (READ_TOOLS.has(tool)) return 'read'
  if (WRITE_TOOLS.has(tool)) return 'write'
  if (SEARCH_TOOLS.has(tool)) return 'search'
  if (EXEC_TOOLS.has(tool)) return 'exec'
  return 'other'
}

export function cap(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

export { verificationKind }

/** Path-like tokens in free text, deduplicated, in order of appearance. */
export function pathMentions(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(PATH_TOKEN)) {
    const token = (match[1] ?? '').replace(/^\.\//, '')
    const start = match.index ?? 0
    const isUrlPart = text.slice(Math.max(0, start - 3), start + 3).includes('://')
    if (ABBREVIATIONS.has(token.toLowerCase()) || isUrlPart || found.includes(token)) continue
    found.push(token)
    if (found.length >= MENTION_CAP) break
  }
  return found
}

export function baseName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

export function dirName(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash <= 0 ? '/' : path.slice(0, slash)
}

export function stemOf(path: string): string {
  const base = baseName(path)
  const dot = base.indexOf('.')
  return dot <= 0 ? base : base.slice(0, dot)
}

export type MentionMatch = 'path' | 'basename' | 'stem'

/**
 * How a mention names a concrete path: `path` when the mention carries a
 * directory and the path ends with it, `basename` when only the file name
 * matches.
 */
export function matchMention(mention: string, path: string): MentionMatch | undefined {
  const clean = mention.replace(/^\.\//, '')
  if (clean.includes('/')) {
    const tail = clean.startsWith('/') ? clean : `/${clean}`
    return path === clean || path.endsWith(tail) ? 'path' : undefined
  }
  return baseName(path) === clean ? 'basename' : undefined
}

/**
 * The strongest way a text refers to `path`: by a mention carrying its
 * directory, by its file name, or (weakest) by its stem as a whole word.
 */
export function textNamesPath(text: string, mentions: readonly string[], path: string): MentionMatch | undefined {
  let best: MentionMatch | undefined
  for (const mention of mentions) {
    const kind = matchMention(mention, path)
    if (kind === 'path') return 'path'
    if (kind === 'basename') best = 'basename'
  }
  if (best) return best
  const stem = stemOf(path)
  if (stem.length < 4 || GENERIC_STEMS.has(stem.toLowerCase())) return undefined
  const word = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(stem)}([^A-Za-z0-9]|$)`, 'i')
  return word.test(text) ? 'stem' : undefined
}

// File stems too common to tie a command to one file by name alone.
const GENERIC_STEMS = new Set([
  'index', 'main', 'test', 'tests', 'spec', 'build', 'utils', 'util', 'types', 'type', 'config',
  'setup', 'init', 'app', 'lib', 'src', 'mod', 'core', 'common', 'helpers', 'helper', 'base', 'readme',
])

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim()
}

function stringField(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function editExcerpt(tool: string, input: Readonly<Record<string, unknown>>): EditExcerpt | undefined {
  if (tool === 'Edit') {
    return {
      old: cap(stringField(input, 'old_string') ?? '', EDIT_CAP),
      new: cap(stringField(input, 'new_string') ?? '', EDIT_CAP),
      replaceAll: input.replace_all === true,
    }
  }
  if (tool === 'Write') {
    return { old: '', new: cap(stringField(input, 'content') ?? '', EDIT_CAP), replaceAll: false }
  }
  if (tool === 'NotebookEdit') {
    return { old: '', new: cap(stringField(input, 'new_source') ?? '', EDIT_CAP), replaceAll: false }
  }
  return undefined
}

/** What a tool call's arguments say, as plain data. */
export function factsFor(tool: string, input: Readonly<Record<string, unknown>>): ToolFacts {
  const access = accessFor(tool)
  const paths = PATH_FIELDS.map(key => stringField(input, key)).filter((p): p is string => p !== undefined)
  const searchRoot = access === 'search' ? stringField(input, 'path') : undefined
  const command = stringField(input, 'command')
  const content = stringField(input, 'content')
  const message = tool === HANDBACK_TOOL ? stringField(input, 'message') : undefined
  const mentionSource = command ?? message
  const verification = command && access === 'exec' ? verificationKind(command) : undefined
  return {
    tool,
    access,
    paths: searchRoot ? [...paths, searchRoot] : paths,
    command: command ? cap(command, COMMAND_CAP) : undefined,
    mentions: mentionSource ? pathMentions(mentionSource) : [],
    verification,
    statusNote: verification && command ? statusNote(command) : undefined,
    edit: editExcerpt(tool, input),
    bytes: content?.length,
    text: message ? cap(message, REPORT_CAP) : undefined,
    textLength: message?.length,
  }
}

/** The fields of a tool's result this module reads; every one optional. */
export type RawResult = {
  deny?: string
  isError?: boolean
  text?: string
  isReadOnly?: boolean
  result?: unknown
}

function resultFlag(result: unknown, key: string): unknown {
  return typeof result === 'object' && result !== null ? (result as Record<string, unknown>)[key] : undefined
}

/**
 * The verdict of a verification command's captured result. `passed` only
 * when the tool reported no error and nothing made the status ambiguous.
 */
export function verdictFor(raw: RawResult, note?: string): { verdict: VerificationVerdict; basis: string } {
  if (raw.deny !== undefined) return { verdict: 'inconclusive', basis: `the call was refused: ${cap(raw.deny, 120)}` }
  const result = raw.result
  if (resultFlag(result, 'interrupted') === true) return { verdict: 'inconclusive', basis: 'the command was interrupted' }
  if (typeof resultFlag(result, 'backgroundTaskId') === 'string') {
    return { verdict: 'inconclusive', basis: 'moved to the background; its final status was not captured' }
  }
  if (typeof resultFlag(result, 'timedOutAfterMs') === 'number') {
    return { verdict: 'inconclusive', basis: 'hit its timeout and was backgrounded' }
  }
  if (raw.isError === true) {
    const notRun = notRunReason(raw.text)
    if (notRun) return { verdict: 'inconclusive', basis: `the command did not run: ${notRun}` }
    const code = EXIT_CODE.exec(raw.text ?? '')?.[1]
    if (code && note) return { verdict: 'inconclusive', basis: `exit code ${code}, but ${note}` }
    if (code) return { verdict: 'failed', basis: `the tool reported an error: exit code ${code}` }
    return { verdict: 'inconclusive', basis: 'the tool reported an error with no exit code, so the command may not have run' }
  }
  if (note) return { verdict: 'inconclusive', basis: `the command exited 0, but ${note}` }
  const interpretation = resultFlag(result, 'returnCodeInterpretation')
  if (typeof interpretation === 'string' && interpretation.length > 0) {
    return { verdict: 'inconclusive', basis: `non-zero exit read as non-error: ${cap(interpretation, 120)}` }
  }
  return { verdict: 'passed', basis: 'the tool reported success (no error result)' }
}

function resultText(raw: RawResult): string {
  if (raw.deny !== undefined) return raw.deny
  if (typeof raw.text === 'string') return raw.text
  const stdout = resultFlag(raw.result, 'stdout')
  const stderr = resultFlag(raw.result, 'stderr')
  return [stdout, stderr].filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n')
}

/** What a tool call's captured result says. */
export function outcomeFor(facts: ToolFacts, raw: RawResult): ToolOutcome {
  const text = resultText(raw)
  const blocked = raw.isError === true && notRunReason(text) !== undefined
  const status = raw.deny !== undefined || blocked ? 'denied' : raw.isError === true ? 'error' : 'ok'
  const code = EXIT_CODE.exec(text)?.[1]
  const base: ToolOutcome = {
    status,
    text: cap(text, RESULT_CAP),
    exitCode: code !== undefined ? Number(code) : undefined,
    isReadOnly: raw.isReadOnly === true ? true : undefined,
  }
  if (!facts.verification) return base
  const { verdict, basis } = verdictFor(raw, facts.statusNote)
  return { ...base, verdict, verdictBasis: basis }
}
