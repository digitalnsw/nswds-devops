// Unit tests for the canonical Snyk policy renderer.
//
// The renderers are pure and the fleet is usually in sync, so these paths are
// almost never exercised by a real run — the same reasoning as
// renovate-fleet-dashboard.test.mjs. The consequence of a bug here is not a
// red check, it is a consumer repo silently losing security policy, so the
// tail-preservation properties are asserted directly.

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Set before the import: the module runs main() at load unless this is set.
process.env.SNYK_POLICY_LIB = '1'
const { blockOf, renderBlock, splitAtMarker, migrateTail, compose } = await import(
  '../.github/scripts/snyk-policy.mjs'
)

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

test('compose normalises to exactly one trailing newline', () => {
  assert.equal(compose('BLOCK', '\nTAIL\n\n\n'), 'BLOCK\nTAIL\n')
  assert.equal(compose('BLOCK', ''), 'BLOCK\n')
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
