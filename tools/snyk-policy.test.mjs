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


// The fleet is every repo the file-sync targets, plus nswds-devops itself.
// Returns NAMES, not a count: comparing cardinality alone let repos.json swap a
// consumer for an unrelated repo and still satisfy "all N are enrolled".
//
// Pure, so it can be unit-tested on synthetic YAML rather than only against the
// real sync.yml. Parse literal headers explicitly and validate entire target
// lines: silently extracting names can hide a config the sync action cannot use.
const parseFleet = (yml) => {
  const lines = yml.split('\n')
  const names = new Set(['nswds-devops'])
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^(\s*(?:-\s*)?)repos:\s*(.*)$/)
    if (!key) continue
    // LITERAL block scalars only: | with optional indentation and chomping
    // indicators in either order (|2, |-, |2-, |-2), and a separated comment.
    //
    // `>` is valid YAML and deliberately rejected. It FOLDS the lines into one
    // space-separated string, and repo-file-sync-action splits group.repos on
    // newlines alone (src/config.js:215 at the pinned 8b92be33), so
    // `repos: >` with two entries yields ONE name, which parseRepoName then
    // reads as user "digitalnsw", repo "a digitalnsw" -- the second repo silently
    // stops being synced. This parser reads raw pre-fold lines, so it would
    // count both and let the snapshot pass over a config the action mis-consumes.
    if (!/^\|(?:[1-9][+-]?|[+-][1-9]?)?(?:[ \t]+#.*)?$/.test(key[2].trim())) {
      throw new Error(
        `.github/sync.yml:${i + 1} has a "repos:" key that is not a LITERAL block scalar: ` +
          `${JSON.stringify(lines[i].trim())}. Use \`|\`. A folded \`>\` header collapses the ` +
          'entries into one line, which the sync action reads as a single malformed repo; ' +
          'anything else would be skipped here and undercount the fleet.',
      )
    }
    const keyIndent = key[1].length
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '') continue
      const indent = line.length - line.trimStart().length
      if (indent <= keyIndent) break // dedent closes the block scalar
      // Inside a scalar, # is content: the action consumes each trimmed line
      // verbatim. Refuse annotations instead of blessing malformed targets.
      const m = line.trim().match(/^digitalnsw\/([A-Za-z0-9._-]+)(?:@[^\s@#]+)?$/)
      if (!m) {
        throw new Error(
          `.github/sync.yml:${j + 1} has an unsupported repo entry: ${JSON.stringify(line.trim())}. ` +
            'Use digitalnsw/repo[@branch]; comments belong outside the scalar.',
        )
      }
      names.add(m[1])
    }
  }
  return names
}

const realFleetNames = () =>
  parseFleet(readFileSync(new URL('../.github/sync.yml', import.meta.url), 'utf8'))

// One numbered note from the canonical comment block.
//
// A note heading is `# N. ` with EXACTLY one space after the hash; a numbered
// list item inside prose is indented further (`#    1. ...`) and must not end
// the note. An earlier version broke on any `# N.` (truncating on list items),
// and the version after it only recognised SHOUTY headings, so a following
// `# 3. History.` was swallowed INTO this note and its text could satisfy a
// presence assertion belonging to a different note.
const noteBody = (base, heading) => {
  const lines = base.split('\n')
  const start = lines.findIndex((l) => l.includes(heading))
  if (start === -1) return null
  const out = [lines[start]]
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '') continue // a stripped-whitespace spacer must not truncate
    if (!t.startsWith('#')) break // end of the comment block
    if (/^#\s\d+\.\s/.test(t)) break // next note heading
    // A section divider also ends a note. Without this the LAST numbered note
    // is bounded only by the first non-comment line, so deleting the undici
    // entries -- which base.snyk instructs on expiry -- ran DEPTH on into the
    // licence-acceptance comment block, 2448 chars becoming 3793.
    if (/^#\s*──/.test(t)) break // next section divider
    out.push(lines[i])
  }
  return out.join('\n')
}

// A comment note as flat prose, so assertions read across its line wrapping.
const asProse = (note) =>
  note
    .split('\n')
    .map((l) => l.replace(/^\s*#\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

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

test('the real base declares no duplicate keys', () => {
  // Guarded at startup too. If the base ever duplicated a key, every existing
  // consumer would be refused while a newly opted-in repo — whose tail is
  // empty, so the per-consumer gate never fires — would still be handed the
  // ambiguous policy. That split-brain is the reason this is checked centrally.
  const realBase = readFileSync(new URL('../snyk-policy/base.snyk', import.meta.url), 'utf8')
  assert.deepEqual(findDuplicateKeys(blockOf(realBase)), [])
})

test('an empty tail cannot introduce duplicates the base does not already have', () => {
  // The create path composes against '', so base validity is both necessary
  // and sufficient for it.
  const dupBase = ['ignore:', '  k:', '  k:', '  # repo-specific'].join('\n')
  assert.deepEqual(findDuplicateKeys(compose(blockOf(dupBase), '')), ['ignore.k'])
  const okBase = ['ignore:', '  k:', '  # repo-specific'].join('\n')
  assert.deepEqual(findDuplicateKeys(compose(blockOf(okBase), '')), [])
})

// ── The three helpers these guards rest on ──────────────────────────────────
// Unit-tested on synthetic input, like every other pure helper in this file.
// They were added without direct tests and exercised only against the one real
// base.snyk / sync.yml, which is how a block-header gap reached review: a
// parsing regression here does not fail loudly, it either stops guarding or
// fails blaming the wrong file.

test('parseFleet reads literal block-scalar headers with separated comments', () => {
  const group = (header) => `group:\n  - repos: ${header}\n      digitalnsw/a\n      digitalnsw/b\n    files:\n`
  // Literal | with indentation and chomping indicators in either order. Missing
  // the indicator form silently dropped a whole group, and the undercount then
  // made the REACH assertion demand a number that is not true.
  for (const header of ['|', '|-', '|+', '|2', '|2-', '|-2', '|2+', '|+2', '| # group', '|2- # group', '|-2 # group', '|+2\t# group']) {
    assert.deepEqual(
      [...parseFleet(group(header))].sort(),
      ['a', 'b', 'nswds-devops'],
      `block header ${header} should yield both repos`,
    )
  }
})

test('parseFleet refuses malformed literal headers', () => {
  for (const header of ['|0', '|22', '|++', '|--', '|+-', '|2-2', '|#group', '|2-#group']) {
    assert.throws(
      () => parseFleet(`group:\n  - repos: ${header}\n      digitalnsw/a\n`),
      /sync\.yml:2.*not a LITERAL block scalar/,
      `malformed header ${header} must be refused`,
    )
  }
})

test('parseFleet refuses annotations and malformed scalar targets', () => {
  for (const entry of [
    '# digitalnsw/retired', 'digitalnsw/b # note', 'prefix digitalnsw/a',
    'digitalnsw/a digitalnsw/b', 'digitalnsw/a@', 'digitalnsw/a@@main',
    'digitalnsw/a/extra', 'other-org/a',
  ]) {
    assert.throws(
      () => parseFleet(`group:\n  - repos: |\n      ${entry}\n`),
      /sync\.yml:3 has an unsupported repo entry/,
      `unsupported entry ${entry} must be refused`,
    )
  }
})

test('parseFleet refuses a folded > header, which the sync action mis-parses', () => {
  // Not a style rule. `>` folds "digitalnsw/a\n digitalnsw/b" into one string,
  // and repo-file-sync-action splits group.repos on newlines only, so the two
  // entries arrive as the single name "digitalnsw/a digitalnsw/b" and the
  // second repo silently drops out of the sync. Reading raw lines here would
  // count both and pass the snapshot over a broken config, so the header is
  // rejected rather than accepted.
  for (const header of ['>', '>-', '>+', '>2']) {
    assert.throws(
      () => parseFleet(`group:\n  - repos: ${header}\n      digitalnsw/a\n      digitalnsw/b\n`),
      /not a LITERAL block scalar/,
      `a folded ${header} header must be refused`,
    )
  }
})

test('parseFleet refuses a repos: key that is not a block scalar', () => {
  // Fail loudly naming sync.yml, rather than returning a short set that sends
  // the reader to base.snyk to "fix" a count that was never wrong.
  assert.throws(
    () => parseFleet('group:\n  - repos:\n      - digitalnsw/a\n'),
    /sync\.yml:2 has a "repos:" key that is not a LITERAL block scalar/,
  )
  assert.throws(() => parseFleet('group:\n  - repos: digitalnsw/a\n'), /not a LITERAL block scalar/)
})

test('parseFleet counts block contents only, and always includes nswds-devops', () => {
  const yml = [
    '# see digitalnsw/nswds-skills for prior art', // prose outside a block
    'group:',
    '  - repos: |',
    '      digitalnsw/a',
    '      digitalnsw/b@feature/onboarding', // branch suffix is not repo identity
    '',
    '      digitalnsw/c', // blank line does not close the block
    '    files:',
    '      - source: scripts/',
    '        dest: digitalnsw/not-a-repo', // below the block, must not count
    '  - repos: |',
    '      digitalnsw/d',
    '',
  ].join('\n')
  assert.deepEqual([...parseFleet(yml)].sort(), ['a', 'b', 'c', 'd', 'nswds-devops'])
})

test('noteBody cuts a note at the next heading, not at the next ignore key', () => {
  const base = [
    'ignore:',
    '  # 1. REACH. first line',
    '  #    still reach',
    '  #',
    '  #    1. an indented list item must not end the note',
    '  # 2. DEPTH. second note',
    '  #    still depth',
    '  SNYK-JS-X:',
  ].join('\n')
  const reach = noteBody(base, '# 1. REACH.')
  assert.ok(reach.includes('still reach'))
  assert.ok(reach.includes('an indented list item'), 'a numbered list item must not truncate')
  assert.ok(!reach.includes('DEPTH'), 'REACH must stop before the next heading')
  const depth = noteBody(base, '# 2. DEPTH.')
  assert.ok(depth.includes('still depth'))
  assert.ok(!depth.includes('SNYK-JS-X'), 'the note ends at the first non-comment line')
  assert.equal(noteBody(base, '# 9. NOPE.'), null)
})

test('noteBody survives a blank line and the ignore keys being deleted', () => {
  // base.snyk instructs deleting the undici entries on expiry; the note's own
  // boundary must not depend on them, and a whitespace-stripped spacer must not
  // truncate it either.
  const base = ['ignore:', '  # 2. DEPTH. a', '', '  #    b'].join('\n')
  const depth = noteBody(base, '# 2. DEPTH.')
  assert.ok(depth.includes('a') && depth.includes('b'))
})

test('noteBody bounds a note identically with and without the ignore entries', () => {
  // The property the divider boundary exists for: a note's extent must not
  // depend on whether the ignore keys below it are present, because base.snyk
  // instructs DELETING the undici entries on expiry (2026-12-31).
  //
  // Asserted on SYNTHETIC input, holding both variants. An earlier version
  // built the second variant by stripping the entries out of the real
  // base.snyk and asserted the strip removed something, so that it could not
  // pass vacuously. That guard turned the file's own expiry instruction into a
  // CI failure: once the entries are actually gone the strip is a no-op and the
  // assertion fires, with a message about test internals and no hint that the
  // fix is to edit the test. Constructing both inputs here cannot go vacuous
  // and cannot rot when the real file changes.
  const section = (body) => ['ignore:', '  # ── Vulnerability acceptances ──────', ...body].join('\n')
  const notes = [
    '  # 1. REACH. reach body',
    '  #    more reach',
    '  # 2. DEPTH. depth body',
    '  #    more depth',
  ]
  const keys = ["  SNYK-JS-X:", "    - '*':", '        reason: r']
  const nextSection = ['  # ── Licence acceptances ──────', '  #    licence prose', '  snyk:lic:a:']

  const withKeys = section([...notes, ...keys, ...nextSection])
  const withoutKeys = section([...notes, ...nextSection])
  assert.notEqual(withKeys, withoutKeys, 'the two variants must differ, or this test proves nothing')

  for (const heading of ['# 1. REACH.', '# 2. DEPTH.']) {
    assert.equal(
      noteBody(withoutKeys, heading),
      noteBody(withKeys, heading),
      `${heading} changes extent when the ignore keys are deleted, so its assertions would ` +
        'silently start reading the next section',
    )
  }
  // And the extent is the note itself, not the section beyond it.
  assert.ok(!noteBody(withKeys, '# 2. DEPTH.').includes('licence prose'))
  assert.ok(!noteBody(withoutKeys, '# 2. DEPTH.').includes('licence prose'))
})

test('every section divider in the real base.snyk uses the form the boundary keys on', () => {
  // noteBody ends a note at a divider, and it recognises the U+2500 form the
  // file uses (`# ── Title ───`). That is a typographic convention nothing
  // else enforces, and the file's prose uses ASCII `--` as an em-dash 24 times,
  // so a maintainer adding `# --- New section ---` would be writing something
  // that reads like a divider and does not act like one: the last numbered note
  // would run straight into it.
  //
  // Asserted on the real file rather than synthetically, because the risk is a
  // real edit to this specific file. It is independent of the undici entries,
  // so it keeps working after they expire and are deleted.
  const realBase = readFileSync(new URL('../snyk-policy/base.snyk', import.meta.url), 'utf8')
  const dividers = realBase.split('\n').filter((l) => /^\s*#\s*[-=_*~—–]{3,}/.test(l))
  assert.deepEqual(
    dividers,
    [],
    'section dividers must use the U+2500 form (# ── Title ───) that noteBody breaks on; ' +
      'these lines look like dividers but would not end a note',
  )
  // Non-vacuous: the U+2500 dividers this depends on are present.
  const real = realBase.split('\n').filter((l) => /^\s*#\s*──/.test(l))
  assert.ok(real.length >= 2, 'base.snyk should carry its section dividers')
})

test('noteBody stops at a section divider', () => {
  const base = [
    'ignore:',
    '  # 2. DEPTH. mine',
    '  #    still mine',
    '  # ── Licence acceptances ──────────',
    '  #    not mine',
    '  snyk:lic:x:',
  ].join('\n')
  const depth = noteBody(base, '# 2. DEPTH.')
  assert.ok(depth.includes('still mine'))
  assert.ok(!depth.includes('not mine'), 'a divider must end the note, like a heading does')
})

test('asProse flattens a wrapped comment note into one line', () => {
  const note = ['  # 2. DEPTH. one', '  #    two   three', '  #', '  #    four'].join('\n')
  assert.equal(asProse(note), '2. DEPTH. one two three four')
})

test('the base.snyk enrolment snapshot matches repos.json and the real fleet', () => {
  // The REACH note states a repo count, and that comment is copied verbatim
  // into every consumer. It has gone stale three times and CI caught none of
  // them. The failure is invisible: the policy still works, it just tells every
  // repo something untrue.
  const realBase = readFileSync(new URL('../snyk-policy/base.snyk', import.meta.url), 'utf8')
  const reach = noteBody(realBase, '# 1. REACH.')
  assert.ok(reach, 'base.snyk must carry a "# 1. REACH." note stating the enrolment snapshot')
  const prose = asProse(reach)

  const enrolled = new Set(
    Object.keys(
      JSON.parse(readFileSync(new URL('../snyk-policy/repos.json', import.meta.url), 'utf8')).repos,
    ),
  )
  const fleet = realFleetNames()

  // Identity, not cardinality: equal counts hid a consumer being swapped for an
  // unrelated repo, which silently stops that repo receiving policy updates.
  assert.deepEqual(
    [...enrolled].filter((r) => !fleet.has(r)).sort(),
    [],
    'repos.json enrols a repo that is not in the fleet (sync.yml + nswds-devops)',
  )

  // ANCHORED to the canonical "Snapshot <date>:" prefix. An unanchored search
  // matched the claim as a substring, so "it is NOT the case that all 29 repos
  // in the fleet are enrolled" satisfied it.
  const CLAIM = /Snapshot \d{4}-\d{2}-\d{2}: (?:all (\d+) repos in the fleet are enrolled|(\d+) of the fleet['\u2019]s (\d+) repos are enrolled)/g
  const claims = [...prose.matchAll(CLAIM)]
  assert.equal(
    claims.length,
    1,
    `the REACH note must carry exactly one "Snapshot <date>: ..." enrolment claim; found ${claims.length}. ` +
      'Two claims of the SAME shape previously passed, because only the first match was read.',
  )
  const [, allN, partN, partM] = claims[0]

  if (allN !== undefined) {
    const claimed = Number(allN)
    assert.equal(claimed, enrolled.size, `REACH claims ${claimed} enrolled; repos.json lists ${enrolled.size}`)
    assert.equal(
      claimed,
      fleet.size,
      `REACH claims all ${claimed} fleet repos are enrolled, but the fleet is ${fleet.size} — ` +
        'reword to "N of the fleet\'s M repos are enrolled"',
    )
    assert.deepEqual(
      [...fleet].filter((r) => !enrolled.has(r)).sort(),
      [],
      'REACH claims the fleet is fully enrolled, but these fleet repos are not in repos.json',
    )
  } else {
    const n = Number(partN)
    const m = Number(partM)
    assert.equal(n, enrolled.size, `REACH claims ${n} enrolled; repos.json lists ${enrolled.size}`)
    assert.equal(m, fleet.size, `REACH claims a fleet of ${m}; sync.yml + nswds-devops is ${fleet.size}`)
    // n < m, not merely n !== m: "30 of the fleet's 29 repos are enrolled" is
    // arithmetically impossible and previously passed.
    assert.ok(n < m, `REACH claims ${n} of ${m} enrolled; enrolled cannot exceed the fleet`)
  }
})

test('the DEPTH note declares the per-workspace policy in a machine-checkable form', () => {
  // Regex cannot read the intent of English prose, and three rounds proved it:
  //   absence detection   -> defeated by rewording
  //   presence detection  -> defeated by adding the bad advice alongside, and
  //                          by the "NEVER USE --policy-path" prefix
  //   negation exclusions -> defeated by "do not skip this step: add a .snyk
  //                          per workspace", by "do not hesitate to add", and by
  //                          placing the negation AFTER the term so a
  //                          backwards-looking pattern misses it
  // Every one of those passed while the note carried the advice this test
  // exists to block, which is worse than no test because a green suite stops
  // anyone looking.
  //
  // So this pins a DECLARED TOKEN rather than the prose. It cannot be satisfied
  // by accident, and reversing the decision requires editing a line that reads
  // REJECTED. What it does NOT do is prove the surrounding paragraph agrees
  // with the token — that is a human review job, and pretending otherwise is
  // what went wrong three times.
  const realBase = readFileSync(new URL('../snyk-policy/base.snyk', import.meta.url), 'utf8')
  const depth = noteBody(realBase, '# 2. DEPTH.')
  assert.ok(depth, 'base.snyk must carry a "# 2. DEPTH." note')

  assert.match(
    asProse(depth),
    /POLICY: per-workspace \.snyk = REJECTED; use --policy-path=\.snyk/,
    'the DEPTH note must declare, verbatim, ' +
      '"POLICY: per-workspace .snyk = REJECTED; use --policy-path=.snyk". ' +
      'Changing the decision means changing that line, deliberately.',
  )
})
