import { describe, expect, test } from 'claude-code/testing'

import {
  factsFor,
  matchMention,
  outcomeFor,
  pathMentions,
  textNamesPath,
  verdictFor,
  verificationKind,
} from '../hooks/lib/classify'
import { leadingDirectory, resolveDir } from '../hooks/lib/command'

describe('classify', () => {
  test('reads paths and access from file tools', () => {
    const edit = factsFor('Edit', { file_path: '/repo/src/auth/token.ts', old_string: 'a', new_string: 'b' })
    expect(edit.access).toBe('write')
    expect(edit.paths).toEqual(['/repo/src/auth/token.ts'])
    expect(edit.edit).toEqual({ old: 'a', new: 'b', replaceAll: false })
    expect(factsFor('Read', { file_path: '/repo/a.py' }).access).toBe('read')
    expect(factsFor('WebSearch', { query: 'x' }).access).toBe('other')
  })

  test('detects verification commands without matching ordinary ones', () => {
    expect(verificationKind('npm test')).toBe('test')
    expect(verificationKind('cd app && python -m pytest tests/test_token.py -q')).toBe('test')
    expect(verificationKind('go test ./...')).toBe('test')
    expect(verificationKind('npx tsc -p .')).toBe('check')
    expect(verificationKind('npm run lint')).toBe('check')
    expect(verificationKind('git status')).toBeUndefined()
    expect(verificationKind('cat test/readme.md')).toBeUndefined()
    expect(verificationKind('ls tests')).toBeUndefined()
  })

  // Review finding: bare words anywhere in a command were read as test runners.
  test('reads the command at the head of each segment, not words inside it', () => {
    expect(verificationKind('npm install -D jest')).toBeUndefined()
    expect(verificationKind('pip install pytest')).toBeUndefined()
    expect(verificationKind('git commit -m "fix tap handler"')).toBeUndefined()
    expect(verificationKind('grep -r mocha src/')).toBeUndefined()
    expect(verificationKind("cat > notes.md <<'EOF'\nrun npm test later\nEOF")).toBeUndefined()
    expect(verificationKind('pnpm -r test')).toBe('test')
    expect(verificationKind('make -j4 test')).toBe('test')
    expect(verificationKind('npm t')).toBe('test')
    expect(verificationKind('./node_modules/.bin/jest --ci')).toBe('test')
    expect(verificationKind('CI=1 npx vitest run')).toBe('test')
    expect(verificationKind("cat >> a.js <<'EOF'\nx\nEOF\nnode --test test/a.test.js")).toBe('test')
  })

  // An empty heredoc closes on the very next line, so what follows it runs.
  test('a heredoc closes at its first closing line, even with an empty body', () => {
    expect(verificationKind('cat > a.txt <<EOF\nEOF\nnpm test\nEOF')).toBe('test')
    expect(verificationKind("cat <<-'END'\n\tnpm test\n\tEND\necho done")).toBeUndefined()
  })

  // Found by the security audit: the heredoc pattern backtracked over the whole command for every `<<`, so a
  // crafted command of a few hundred KB stalled the tool call it rode on for seconds (the digits for 90 s). Each now
  // takes well under 100 ms alone; the budget leaves room for a loaded machine running every test file at once.
  test('reads a crafted command in linear time', () => {
    const SIZE = 200_000
    const BUDGET_MS = 1000
    const crafted = [
      `cat <<${'A'.repeat(SIZE / 10)}\n${'x'.repeat(SIZE)}`,
      'cat <<A\n'.repeat(SIZE / 8),
      `cat <<'${'B'.repeat(SIZE)}`,
      `echo ${'1'.repeat(SIZE)}`,
      `echo ${'"a\\'.repeat(SIZE / 3)}`,
    ]
    for (const command of crafted) {
      const started = performance.now()
      verificationKind(command)
      expect(performance.now() - started).toBeLessThan(BUDGET_MS)
    }
  })

  // Found in the in-session run: `cd <demo> && npm test` was read as running in the session's directory.
  test('a leading cd sets the directory the rest of the command runs in', () => {
    expect(leadingDirectory('cd /repo/app && npm test')).toBe('/repo/app')
    expect(leadingDirectory('cd "my dir" && npm test')).toBe('my dir')
    expect(leadingDirectory('cd app; pytest -q')).toBe('app')
    expect(leadingDirectory('npm test')).toBeUndefined()
    expect(leadingDirectory('cd /x || exit 1')).toBeUndefined()
    expect(resolveDir('app/../web', '/repo')).toBe('/repo/web')
    expect(resolveDir('/abs/path/', '/repo')).toBe('/abs/path')
    expect(resolveDir(undefined, '/repo')).toBe('/repo')
    expect(resolveDir('~/x', '/repo')).toBeUndefined()
  })

  test('a result whose exit status comes from another step is inconclusive', () => {
    const piped = factsFor('Bash', { command: 'npx vitest run 2>&1 | tail -30' })
    expect(outcomeFor(piped, { text: 'FAIL 3 tests' }).verdict).toBe('inconclusive')
    const masked = factsFor('Bash', { command: 'npm test || true' })
    expect(outcomeFor(masked, { text: 'ok' }).verdict).toBe('inconclusive')
    const chained = factsFor('Bash', { command: 'cd app && npm test 2>&1' })
    expect(outcomeFor(chained, { text: 'ok' }).verdict).toBe('passed')
    expect(outcomeFor(chained, { isError: true, text: 'Exit code 1' }).verdict).toBe('failed')
  })

  test('extracts path mentions and ignores URLs and abbreviations', () => {
    const text = 'The bug is in `src/auth/token.ts:42`, e.g. see token.ts. Docs: https://example.com/a.js'
    expect(pathMentions(text)).toEqual(['src/auth/token.ts', 'token.ts'])
  })

  test('matches mentions to concrete paths by strength', () => {
    expect(matchMention('src/auth/token.ts', '/repo/src/auth/token.ts')).toBe('path')
    expect(matchMention('token.ts', '/repo/src/auth/token.ts')).toBe('basename')
    expect(matchMention('lib/token.ts', '/repo/src/auth/token.ts')).toBeUndefined()
    expect(textNamesPath('pytest -k token', [], '/repo/src/auth/token.ts')).toBe('stem')
    expect(textNamesPath('pytest -k tokens', [], '/repo/src/auth/token.ts')).toBeUndefined()
  })

  test('labels a test passed only when success was captured', () => {
    expect(verdictFor({ text: 'ok' }).verdict).toBe('passed')
    expect(verdictFor({ isError: true, text: 'Exit code 1\nFAIL' })).toEqual({
      verdict: 'failed',
      basis: 'the tool reported an error: exit code 1',
    })
    expect(verdictFor({ result: { interrupted: true } }).verdict).toBe('inconclusive')
    expect(verdictFor({ result: { backgroundTaskId: 'b1' } }).verdict).toBe('inconclusive')
    expect(verdictFor({ result: { returnCodeInterpretation: 'No matches' } }).verdict).toBe('inconclusive')
    expect(verdictFor({ deny: 'blocked' }).verdict).toBe('inconclusive')
  })

  // Found in live run 20261016T092741Z: a denied command was reported as a failed test.
  test('a command that never ran is inconclusive, never failed', () => {
    const facts = factsFor('Bash', { command: 'cat > x && node --test' })
    const denied = outcomeFor(facts, { isError: true, text: 'Permission to use Bash has been denied. IMPORTANT: …' })
    expect(denied.status).toBe('denied')
    expect(denied.verdict).toBe('inconclusive')
    expect(denied.verdictBasis).toContain('did not run')
    const hooked = outcomeFor(facts, { isError: true, text: 'PreToolUse:Bash hook error: [Gate] present these facts' })
    expect(hooked.status).toBe('denied')
    expect(hooked.verdict).toBe('inconclusive')
    const unknown = outcomeFor(facts, { isError: true, text: 'something went wrong' })
    expect(unknown.status).toBe('error')
    expect(unknown.verdict).toBe('inconclusive')
    expect(unknown.verdictBasis).toContain('no exit code')
  })

  test('outcome carries a verdict only for verification commands', () => {
    const test = factsFor('Bash', { command: 'npm test' })
    const other = factsFor('Bash', { command: 'git status' })
    expect(outcomeFor(test, { isError: true, text: 'Exit code 2' }).verdict).toBe('failed')
    expect(outcomeFor(test, { isError: true, text: 'Exit code 2' }).exitCode).toBe(2)
    expect(outcomeFor(other, { text: 'clean' }).verdict).toBeUndefined()
  })
})
