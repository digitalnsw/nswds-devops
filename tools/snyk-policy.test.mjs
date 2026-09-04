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
const { blockOf, renderBlock, splitAtMarker, migrateTail, compose, isConverted } = await import(
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
  // Load-bearing invariant: without it every converted repo reads as
  // unconverted and every lingering migrate directive re-arms at once. The
  // module throws at import if this is violated, so reaching this line at all
  // proves the guard held; assert the rendered block carries it too.
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

test('a spent migrate directive cannot delete policy added after conversion', () => {
  // The directive is documented as one-time, but a comment is not a safeguard:
  // re-running `tail: "none"` on a converted repo silently drops everything the
  // repo added below the marker. isConverted() disarms it from the file itself.
  const block = [SENTINEL_LINE, 'ignore:', '  # repo-specific'].join('\n')
  const ownPolicy = '\n\n  SNYK-JS-SOMETHING-123:\n    - \'*\':\n        reason: policy this repo owns\n'
  const converted = compose(block, ownPolicy)
  assert.ok(converted.includes('SNYK-JS-SOMETHING-123'))

  assert.equal(isConverted(converted), true)

  // What evaluate() now does: directive applies only while unconverted.
  const migrate = { tail: 'none' }
  const tail = migrate && !isConverted(converted) ? migrateTail(converted, migrate) : splitAtMarker(converted).tail
  assert.ok(compose(block, tail).includes('SNYK-JS-SOMETHING-123'), 'repo-owned policy was deleted')

  // Guard: the old unconditional behaviour is what destroyed it.
  assert.ok(!compose(block, migrateTail(converted, migrate)).includes('SNYK-JS-SOMETHING-123'))
})

test('an unconverted repo still takes its migrate directive', () => {
  // reviewers/nswds-email shape: marker sits ABOVE the licence list, old header.
  const unconverted = [
    '# Snyk (https://snyk.io) policy file',
    'ignore:',
    '  # repo-specific',
    '',
    '  snyk:lic:npm:x:MPL-2.0:',
  ].join('\n')
  assert.equal(isConverted(unconverted), false)
  assert.equal(migrateTail(unconverted, { tail: 'none' }), '')
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
