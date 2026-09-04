// Unit tests for the canonical Snyk policy renderer.
//
// The renderers are pure and the fleet is usually in sync, so these paths are
// almost never exercised by a real run — the same reasoning as
// renovate-fleet-dashboard.test.mjs. The consequence of a bug here is not a
// red check, it is a consumer repo silently losing security policy, so the
// tail-preservation properties are asserted directly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Set before the import: the module runs main() at load unless this is set.
process.env.SNYK_POLICY_LIB = '1'
const {
  blockOf, renderBlock, splitAtMarker, migrateTail, compose, isConverted, selectTail,
  findDuplicateKeys, reconcileBranch,
} = await import(
  '../.github/scripts/snyk-policy.mjs'
)

// The sentinel the renderer emits; a converted file carries it above the marker.
const SENTINEL_LINE = '# ── Canonical base (generated from nswds-devops snyk-policy/base.snyk) ─────'

const BASE = ['version: v1.25.0', 'ignore:', '  snyk:lic:npm:x:MPL-2.0:', '    - \'*\':', '  # repo-specific', ''].join('\n')

test('blockOf ends at the marker and keeps it', () => {
  const block = blockOf(BASE)
  assert.ok(block.endsWith('  # repo-specific'))
  assert.ok(block.includes('snyk:lic:npm:x:MPL-2.0:'))
})

test('blockOf refuses a base with no marker', () => {
  // A base that lost its marker would swallow every consumer's tail.
  assert.throws(() => blockOf('version: v1.25.0\nignore: {}\n'), /no "  # repo-specific" marker/)
})

test('renderBlock without a note is the block unchanged', () => {
  assert.equal(renderBlock(BASE, undefined), blockOf(BASE))
})

test('renderBlock puts a note above the marker, as comments', () => {
  const out = renderBlock(BASE, 'line one\nline two')
  const lines = out.split('\n')
  assert.equal(lines.at(-1), '  # repo-specific')
  assert.ok(out.includes('  # line one'))
  assert.ok(out.includes('  # line two'))
  // Every note line must be a comment; a bare line would be parsed as YAML.
  const noteIdx = lines.findIndex((l) => l === '  # line one')
  assert.ok(lines.slice(noteIdx, -1).every((l) => l.trim() === '' || l.trimStart().startsWith('#')))
})

test('splitAtMarker returns null when the repo has never been converted', () => {
  assert.equal(splitAtMarker('version: v1.25.0\nignore: {}\n'), null)
})

test('splitAtMarker gives back head + tail that recombine exactly', () => {
  const content = 'a\n  # repo-specific\nTAIL-1\nTAIL-2\n'
  const { head, tail } = splitAtMarker(content)
  assert.ok(head.endsWith('  # repo-specific'))
  assert.equal(tail, '\nTAIL-1\nTAIL-2\n')
  assert.equal(head + tail, content)
})

test('migrateTail "none" drops the whole existing file', () => {
  assert.equal(migrateTail('anything at all\n', { tail: 'none' }), '')
})

test('migrateTail {from} keeps everything from the matching line on', () => {
  const content = ['version: v1.25.0', 'ignore:', "  '*:lic:*':", '  # ── Snyk Code', "  'javascript/PT':"].join('\n')
  const tail = migrateTail(content, { tail: { from: '# ── Snyk Code' } })
  assert.ok(tail.includes("'javascript/PT':"))
  // The dead catch-all sits above the anchor and must be dropped.
  assert.ok(!tail.includes("'*:lic:*'"))
})

test('migrateTail throws when the anchor is absent rather than guessing', () => {
  assert.throws(() => migrateTail('a\nb\n', { tail: { from: 'NOPE' } }), /migrate\.tail\.from not found/)
})

test('migrateTail returns null for a manual repo', () => {
  assert.equal(migrateTail('a\n', 'manual'), null)
})

test('compose preserves the tail byte-for-byte, including trailing blank lines', () => {
  // Collapsing these would rewrite bytes the consumer owns — the guarantee the
  // whole mechanism rests on. Only a MISSING trailing newline may be added.
  assert.equal(compose('BLOCK', '\nTAIL\n\n\n'), 'BLOCK\nTAIL\n\n\n')
  assert.equal(compose('BLOCK', '\nTAIL'), 'BLOCK\nTAIL\n')
  assert.equal(compose('BLOCK', ''), 'BLOCK\n')
})

test('blockOf rejects content below the marker instead of dropping it', () => {
  // findIndex takes the FIRST marker, so anything below it would vanish from
  // every rendered policy with no error — a new canonical ignore that never
  // ships. Must fail loudly.
  assert.throws(
    () => blockOf(['ignore:', '  # repo-specific', '  snyk:lic:npm:late:MPL-2.0:'].join('\n')),
    /content after the .* marker/,
  )
  assert.throws(
    () => blockOf(['ignore:', '  # repo-specific', '', '  # repo-specific'].join('\n')),
    /content after the .* marker/,
  )
  // Blank lines below the marker are fine.
  assert.ok(blockOf(['ignore:', '  # repo-specific', '', ''].join('\n')).endsWith('  # repo-specific'))
})

test('the real base.snyk carries the sentinel isConverted depends on', () => {
  // Load-bearing for RECOVERY, not for disarming — `migrate.fromSha` disarms
  // migrations. Without the sentinel, a repo whose SHA has moved is no longer
  // recognised as converted, so selectTail() refuses it instead of preserving
  // its tail: correct but blocking, and blocking on every converted repo at
  // once. The module throws at import if this is violated, so reaching this
  // line at all proves the guard held; assert the rendered block carries it.
  const realBase = readFileSync(new URL('../snyk-policy/base.snyk', import.meta.url), 'utf8')
  assert.ok(blockOf(realBase).includes('Canonical base (generated from nswds-devops'))
})

test('isConverted requires BOTH the marker and the generated-header sentinel', () => {
  const converted = [SENTINEL_LINE, 'ignore:', '  # repo-specific', ''].join('\n')
  assert.equal(isConverted(converted), true)
  // Marker but hand-written header: predates the convention.
  assert.equal(isConverted(['# Snyk (https://snyk.io) policy file', 'ignore:', '  # repo-specific'].join('\n')), false)
  // Sentinel but no marker: cannot be split, so not trustworthy.
  assert.equal(isConverted([SENTINEL_LINE, 'ignore: {}'].join('\n')), false)
  // A sentinel appearing only BELOW the marker must not count as converted.
  assert.equal(isConverted(['ignore:', '  # repo-specific', `  # ${SENTINEL_LINE}`].join('\n')), false)
})

// ── selectTail: the one rule evaluate() and openPr() both use ──────────────
// These call PRODUCTION code. An earlier version of this suite reimplemented
// the condition, which meant it would have stayed green if the caller reverted
// to migrating unconditionally — the exact regression it existed to prevent.

const BLOCK = [SENTINEL_LINE, 'ignore:', '  # repo-specific'].join('\n')
const OWN = "\n\n  SNYK-JS-REPO-OWNED-999:\n    - '*':\n        reason: added after conversion\n"
const FROM_SHA = 'a'.repeat(40)

test('selectTail migrates only on an exact fromSha match', () => {
  const unconverted = ['# Snyk (https://snyk.io) policy file', 'ignore:', '  # repo-specific', '', '  snyk:lic:npm:x:MPL-2.0:'].join('\n')
  const settings = { migrate: { fromSha: FROM_SHA, tail: 'none' } }

  const hit = selectTail({ content: unconverted, sha: FROM_SHA, settings })
  assert.equal(hit.mode, 'migrate')
  assert.equal(hit.tail, '')
})

test('selectTail keeps post-conversion policy once the blob has moved', () => {
  // The N1 scenario: the migration merged, the repo added its own ignore, and
  // repos.json still carries the directive. It must not fire again.
  const converted = compose(BLOCK, OWN)
  const settings = { migrate: { fromSha: FROM_SHA, tail: 'none' } }

  const choice = selectTail({ content: converted, sha: 'b'.repeat(40), settings })
  assert.equal(choice.mode, 'steady')
  assert.equal(choice.spentDirective, true)
  assert.ok(compose(BLOCK, choice.tail).includes('SNYK-JS-REPO-OWNED-999'))
})

test('selectTail refuses a stale directive rather than guessing', () => {
  // Consumer-side edits to the canonical block used to make a spent directive
  // look live again, and a `tail: "none"` directive then deleted the repo's
  // own policy. The SHA no longer matches, and the shape is unrecognisable, so
  // the only safe answer is to refuse and let a human look.
  const converted = compose(BLOCK, OWN)
  const settings = { migrate: { fromSha: FROM_SHA, tail: 'none' } }
  const otherSha = 'b'.repeat(40)

  const mangled = {
    'sentinel removed': converted.split('\n').filter((l) => !l.includes('Canonical base (generated from nswds-devops')).join('\n'),
    'marker removed': converted.split('\n').filter((l) => l.trimEnd() !== '  # repo-specific').join('\n'),
  }
  for (const [name, content] of Object.entries(mangled)) {
    const choice = selectTail({ content, sha: otherSha, settings })
    assert.equal(choice.mode, 'refuse', `${name}: expected refusal, got ${choice.mode}`)
    assert.match(choice.reason, /stale|marker/)
    // The decisive property: nothing is written, so nothing is deleted.
    assert.equal(choice.tail, undefined)
  }
})

test('selectTail refuses a directive with no fromSha', () => {
  const choice = selectTail({ content: compose(BLOCK, OWN), sha: FROM_SHA, settings: { migrate: { tail: 'none' } } })
  assert.equal(choice.mode, 'refuse')
  assert.match(choice.reason, /fromSha/)
})

test('selectTail takes the steady path when no directive is configured', () => {
  const converted = compose(BLOCK, OWN)
  const choice = selectTail({ content: converted, sha: 'c'.repeat(40), settings: {} })
  assert.equal(choice.mode, 'steady')
  assert.ok(!choice.spentDirective)
  assert.ok(compose(BLOCK, choice.tail).includes('SNYK-JS-REPO-OWNED-999'))

  // Marker but no sentinel and no directive is still the steady path: those
  // repos (agile, nswds-design, nswds-email-starter) must not regress.
  const markerOnly = ['# hand-written header', 'ignore:', '  # repo-specific', '', '  SNYK-JS-X-1:'].join('\n')
  assert.equal(selectTail({ content: markerOnly, sha: 'd'.repeat(40), settings: {} }).mode, 'steady')
})

test('a second fan-out re-derived from the branch reproduces the same file', () => {
  // openPr() now renders from the SYNC BRANCH's bytes rather than the default
  // branch's, so a reviewer's edit to their own tail on the PR is not reverted.
  // That path must be idempotent, or every run would churn the branch.
  const settings = { migrate: { fromSha: FROM_SHA, tail: 'none' } }
  const unconverted = ['# hand-written', 'ignore:', '  # repo-specific', '', '  snyk:lic:npm:x:MPL-2.0:'].join('\n')

  const first = compose(BLOCK, selectTail({ content: unconverted, sha: FROM_SHA, settings }).tail)

  // Second run: the branch holds `first`, whose blob is no longer fromSha.
  const second = selectTail({ content: first, sha: 'f'.repeat(40), settings })
  assert.equal(second.mode, 'steady')
  assert.equal(compose(BLOCK, second.tail), first)

  // And a tail edited on the branch survives that re-derivation.
  const edited = compose(BLOCK, "\n\n  SNYK-JS-EDITED-ON-BRANCH:\n    - '*':\n")
  const third = selectTail({ content: edited, sha: 'f'.repeat(40), settings })
  assert.ok(compose(BLOCK, third.tail).includes('SNYK-JS-EDITED-ON-BRANCH'))
})

test('selectTail refuses a file with neither marker nor directive', () => {
  const choice = selectTail({ content: 'version: v1.25.0\nignore: {}\n', sha: 'e'.repeat(40), settings: {} })
  assert.equal(choice.mode, 'refuse')
  assert.match(choice.reason, /no "  # repo-specific" marker/)
})

test('a misplaced marker does not duplicate canonical keys (regression)', () => {
  // reviewers and nswds-email carried "# repo-specific" ABOVE their licence
  // list. Trusting the marker there emitted those keys twice — a duplicate-key
  // file where the tail silently shadows the canonical block. The migrate
  // directive must win over the marker.
  const existing = [
    'version: v1.25.0',
    'ignore:',
    '  # repo-specific',
    '',
    '  snyk:lic:npm:x:MPL-2.0:',
    "    - '*':",
  ].join('\n')

  const viaMarker = compose(renderBlock(BASE), splitAtMarker(existing).tail)
  const occurrences = viaMarker.split('snyk:lic:npm:x:MPL-2.0:').length - 1
  assert.equal(occurrences, 2, 'guard: trusting the marker is what duplicated the key')

  const viaDirective = compose(renderBlock(BASE), migrateTail(existing, { tail: 'none' }))
  assert.equal(viaDirective.split('snyk:lic:npm:x:MPL-2.0:').length - 1, 1)
})

test('a repo-owned tail survives verbatim, including top-level keys', () => {
  const tail = ['', '  SNYK-JS-POSTCSS-16189065:', "    - '*':", 'exclude:', '  global:', '    - docs/**'].join('\n')
  const out = compose(renderBlock(BASE), tail)
  for (const line of tail.split('\n').filter((l) => l.trim())) {
    assert.ok(out.includes(line), `lost tail line: ${line}`)
  }
})

// ── findDuplicateKeys ──────────────────────────────────────────────────────
// YAML takes the LAST occurrence of a duplicated key, so a key present in both
// the canonical block and a repo's tail means the tail silently shadows the
// fleet value. Reachable by promoting an ignore out of a repo's tail into
// base.snyk without removing it there.

test('findDuplicateKeys is quiet on a well-formed policy', () => {
  const ok = [
    'version: v1.25.0',
    'ignore:',
    '  snyk:lic:npm:x:MPL-2.0:',
    "    - '*':",
    '        reason: fine',
    '  # repo-specific',
    '  SNYK-JS-OWNED-1:',
    "    - '*':",
    'exclude:',
    '  global:',
    '    - docs/**',
  ].join('\n')
  assert.deepEqual(findDuplicateKeys(ok), [])
})

test('findDuplicateKeys catches a canonical key shadowed by the tail', () => {
  const shadowed = [
    'version: v1.25.0',
    'ignore:',
    '  snyk:lic:npm:x:MPL-2.0:',
    "    - '*':",
    '        reason: canonical',
    '  # repo-specific',
    '  snyk:lic:npm:x:MPL-2.0:',
    "    - '*':",
    '        reason: repo copy that would win',
  ].join('\n')
  assert.deepEqual(findDuplicateKeys(shadowed), ['ignore.snyk:lic:npm:x:MPL-2.0'])
})

test('findDuplicateKeys handles keys containing colons and quotes', () => {
  // Licence ids are full of colons; Snyk Code ids are quoted.
  const dupes = findDuplicateKeys(
    ['ignore:', "  'javascript/PT':", '    - a', "  'javascript/PT':", '    - b'].join('\n'),
  )
  assert.deepEqual(dupes, ['ignore.javascript/PT'])
})

test('findDuplicateKeys catches a repeated top-level key', () => {
  assert.deepEqual(findDuplicateKeys(['ignore:', '  a:', 'exclude:', '  global:', 'exclude:'].join('\n')), ['exclude'])
})

test('findDuplicateKeys ignores comments and list items', () => {
  // `  # repo-specific` is a comment, not a key, and `    - '*':` is a value.
  const content = ['ignore:', '  # repo-specific', '  # repo-specific', '  k:', "    - '*':", "    - '*':"].join('\n')
  assert.deepEqual(findDuplicateKeys(content), [])
})

test('every rendered fleet policy is duplicate-free', () => {
  // The real base composed against a realistic repo-owned tail.
  const realBase = readFileSync(new URL('../snyk-policy/base.snyk', import.meta.url), 'utf8')
  const tail = "\n\n  SNYK-JS-POSTCSS-16189065:\n    - '*':\n        reason: repo owned\n"
  assert.deepEqual(findDuplicateKeys(compose(renderBlock(realBase), tail)), [])
  assert.deepEqual(findDuplicateKeys(compose(renderBlock(realBase), '')), [])
})

// ── CRLF byte-preservation ─────────────────────────────────────────────────
// The tail is promised byte-for-byte. Splitting after the whole marker line
// put a CRLF file's `\r` in the head and only `\n` in the tail, so replacing
// the head with our LF block downgraded that separator to `\n`. No fleet file
// is CRLF today, which is exactly why this needs a test rather than luck.

const CRLF_FILE = ['# hand-written header', 'ignore:', '  # repo-specific', '  SNYK-JS-OWNED-1:', "    - '*':"].join('\r\n') + '\r\n'

test('splitAtMarker leaves a CRLF terminator with the tail', () => {
  const { head, tail } = splitAtMarker(CRLF_FILE)
  assert.equal(head + tail, CRLF_FILE, 'split must be lossless')
  assert.ok(tail.startsWith('\r\n'), `tail lost its CR: ${JSON.stringify(tail.slice(0, 8))}`)
  assert.ok(head.endsWith('# repo-specific'), 'head should stop at the marker text')
})

test('compose preserves a CRLF tail exactly, separator included', () => {
  const { tail } = splitAtMarker(CRLF_FILE)
  const out = compose('BLOCK\n  # repo-specific', tail)
  assert.ok(out.includes('  # repo-specific\r\n'), 'marker separator was downgraded to LF')
  assert.ok(out.endsWith(tail), 'tail bytes were altered')
})

test('migrateTail {from} slices original bytes rather than rebuilding them', () => {
  const tail = migrateTail(CRLF_FILE, { tail: { from: 'SNYK-JS-OWNED-1' } })
  assert.ok(tail.startsWith('\r\n'), 'leading separator was rebuilt as LF')
  assert.ok(CRLF_FILE.endsWith(tail), 'tail is not a verbatim slice of the source')
})

test('LF files are unaffected by the CRLF handling', () => {
  const lf = ['# hdr', 'ignore:', '  # repo-specific', '  SNYK-JS-OWNED-1:'].join('\n') + '\n'
  const { head, tail } = splitAtMarker(lf)
  assert.equal(head + tail, lf)
  assert.ok(tail.startsWith('\n') && !tail.startsWith('\r'))
  assert.ok(migrateTail(lf, { tail: { from: 'SNYK-JS-OWNED-1' } }).startsWith('\n'))
})

test('migrateTail {from} still throws when the anchor is absent', () => {
  // The rewrite moved this check inside the scan loop; keep it covered.
  assert.throws(() => migrateTail(CRLF_FILE, { tail: { from: 'NOT-PRESENT' } }), /migrate\.tail\.from not found/)
})

// ── Missing policy file ────────────────────────────────────────────────────
// Creating a canonical-only file is right for an opt-in, but for a migration
// target it silently drops the tail the directive exists to preserve — and a
// deleted file has no blob for the fromSha gate to match.

test('selectTail creates for an opt-in repo with no policy yet', () => {
  const choice = selectTail({ content: null, sha: null, settings: {} })
  assert.equal(choice.mode, 'create')
  assert.equal(choice.tail, '')
})

test('selectTail refuses a migration target whose policy has been deleted', () => {
  const choice = selectTail({ content: null, sha: null, settings: { migrate: { fromSha: FROM_SHA, tail: { from: '# postcss XSS' } } } })
  assert.equal(choice.mode, 'refuse')
  assert.match(choice.reason, /no \.snyk to migrate/)
  assert.equal(choice.tail, undefined, 'nothing may be written')
})

test('selectTail still creates for a manual repo with no policy', () => {
  // evaluate() reports manual repos separately; selectTail must not claim a
  // migration is possible for one.
  assert.equal(selectTail({ content: null, sha: null, settings: { migrate: 'manual' } }).mode, 'create')
})

// ── reconcileBranch ────────────────────────────────────────────────────────
// The branch/default divergence rule is a safety decision, so it is a helper
// the suite can drive. Inlined as a bare `===` inside openPr() it was
// untestable: inverting or deleting the comparison left every test green while
// one side's repo-owned policy was discarded.

test('reconcileBranch writes when the branch agrees with the default branch', () => {
  const same = 'BLOCK\n  # repo-specific\n  SNYK-JS-OWNED-1:\n'
  const out = reconcileBranch({ fromDefault: same, fromBranch: same })
  assert.equal(out.mode, 'write')
  assert.equal(out.content, same)
})

test('reconcileBranch refuses when the tails diverge', () => {
  // Both sides are real: the branch may hold a reviewer's edit, the default
  // branch may have gained policy from another PR merged meanwhile.
  const fromDefault = 'BLOCK\n  # repo-specific\n  SNYK-JS-FROM-MAIN:\n'
  const fromBranch = 'BLOCK\n  # repo-specific\n  SNYK-JS-EDITED-ON-BRANCH:\n'
  const out = reconcileBranch({ fromDefault, fromBranch })
  assert.equal(out.mode, 'refuse')
  assert.match(out.reason, /diverged/)
  assert.equal(out.content, undefined, 'nothing may be written on divergence')
})

test('reconcileBranch is byte-exact, not fuzzy', () => {
  // A single differing byte in the repo-owned tail is a real divergence.
  const a = 'BLOCK\n  # repo-specific\n  K:\n'
  assert.equal(reconcileBranch({ fromDefault: a, fromBranch: a + '\n' }).mode, 'refuse')
})
