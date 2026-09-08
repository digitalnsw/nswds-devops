// Tests for .github/scripts/test-mode.mjs — the decision behind the shared
// `install / test` gate.
//
// Every case below is either a shape a fleet repo actually has, or a defect the
// shell version of this logic shipped. The second group is the reason the file
// exists: each of those passed CI, because a wrong answer here produces a GREEN
// check on a repo whose tests never ran, and nothing was asserting the answer.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  configDirsFrom,
  hasRealTestScript,
  isDeclaredWorkspace,
  MODES,
  needsPlaywright,
  readManifest,
  resolveMode,
  RUNNERS,
  runnerFor,
} from '../.github/scripts/test-mode.mjs'

// ── Config discovery ────────────────────────────────────────────────────────

test('a root config is reported as the "." sentinel', () => {
  assert.deepEqual(configDirsFrom(['vitest.config.ts', 'README.md']), ['.'])
})

test('a workspace config is reported as its directory', () => {
  assert.deepEqual(configDirsFrom(['apps/storybook/vitest.config.ts']), ['apps/storybook'])
})

test('several configs are sorted and deduplicated', () => {
  const dirs = configDirsFrom([
    'packages/email/vitest.config.ts',
    'apps/docs/vitest.config.ts',
    'apps/docs/vitest.config.mts', // same directory, one entry
  ])
  assert.deepEqual(dirs, ['apps/docs', 'packages/email'])
})

test('a path containing a space survives intact', () => {
  // The shell version used `xargs -n1 dirname`, which word-split on the space
  // and emitted TWO entries — one of them `.`, which flipped the mode to
  // root-vitest and ran vitest at a root with no config at all.
  assert.deepEqual(configDirsFrom(['apps/my app/vitest.config.ts']), ['apps/my app'])
})

test('a non-ASCII path is found', () => {
  // git C-quotes these under the default core.quotePath, so the shell version's
  // anchored regex never matched and the config was silently dropped. The CLI
  // reads `git ls-files -z`, which is never quoted; this asserts the matcher
  // itself does not add a second barrier.
  assert.deepEqual(configDirsFrom(['apps/café/vitest.config.ts']), ['apps/café'])
})

test('a directory whose name starts with a dash is found', () => {
  // `-rf` reached `node -e '…' "$dir"` as an OPTION in the shell version
  // (`node: bad option: -rf`), which the playwright probe read as "no
  // playwright" and silently skipped the browser install.
  assert.deepEqual(configDirsFrom(['-rf/vitest.config.ts']), ['-rf'])
})

test('near-miss filenames are not configs', () => {
  assert.deepEqual(
    configDirsFrom([
      'vitest.config.ts.bak', // backup
      'vitest.config.', // no extension
      'vitest.config.unit.ts', // vitest does not auto-load this either
      'vitest.config.v2.ts', // digit in the extension segment
      'vitest.workspace.ts', // removed in vitest 4
      'a/vitest.config.ts/file.ts', // a DIRECTORY named like a config
      'notvitest.config.ts', // unanchored substring
    ]),
    [],
  )
})

test('every extension vitest actually loads is accepted', () => {
  for (const ext of ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']) {
    assert.deepEqual(configDirsFrom([`pkg/vitest.config.${ext}`]), ['pkg'], `.${ext} should be recognised`)
  }
})

// ── Test-script detection ───────────────────────────────────────────────────

test('a real test script counts; the npm-init stub does not', () => {
  assert.equal(hasRealTestScript({ scripts: { test: 'vitest run' } }), true)
  assert.equal(hasRealTestScript({ scripts: { test: 'turbo test' } }), true)
  assert.equal(
    hasRealTestScript({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    false,
    'the npm-init default must read as absent, or onboarding a repo with no tests fails CI',
  )
  assert.equal(hasRealTestScript({ scripts: {} }), false)
  assert.equal(hasRealTestScript({}), false)
  assert.equal(hasRealTestScript(null), false)
})

// ── Precedence ──────────────────────────────────────────────────────────────

test('a root config wins over everything', () => {
  assert.equal(resolveMode({ dirs: ['.', 'apps/docs'], hasRootTest: true }), MODES.ROOT_VITEST)
})

test('the root test script beats a workspace config', () => {
  // Deliberate: an aggregate script is the repo's own entry point and may cover
  // more than a config scan can see. nswds-email-design's root script is
  // `turbo test`, which also reaches packages/semantic-release-config's
  // node:test suite that has no vitest config at all.
  assert.equal(resolveMode({ dirs: ['apps/docs', 'packages/email'], hasRootTest: true }), MODES.NPM_TEST)
})

test('a workspace config runs when there is no root config and no root script', () => {
  // nswds-ui. This is the case the whole change exists for: it used to resolve
  // to `none` and report a green `install / test` having run nothing.
  assert.equal(resolveMode({ dirs: ['apps/storybook'], hasRootTest: false }), MODES.NESTED_VITEST)
})

test('nothing anywhere resolves to none', () => {
  assert.equal(resolveMode({ dirs: [], hasRootTest: false }), MODES.NONE)
})

// ── Workspace membership ────────────────────────────────────────────────────

test('membership is decided by the root workspaces globs', () => {
  const root = { workspaces: ['apps/*', 'packages/*'] }
  assert.equal(isDeclaredWorkspace('apps/storybook', root), true)
  assert.equal(isDeclaredWorkspace('packages/ui', root), true)
  assert.equal(isDeclaredWorkspace('e2e', root), false)
  assert.equal(isDeclaredWorkspace('apps/nested/deep', root), false, '* matches one segment, not many')
})

test('exact paths, ** globs and the object form are all understood', () => {
  assert.equal(isDeclaredWorkspace('tools/thing', { workspaces: ['tools/thing'] }), true)
  assert.equal(isDeclaredWorkspace('a/b/c', { workspaces: ['a/**'] }), true)
  assert.equal(isDeclaredWorkspace('pkg/x', { workspaces: { packages: ['pkg/*'] } }), true)
})

test('a repo with no workspaces key has no members', () => {
  // Most of the fleet. The shell version ran `npm test -w <dir>` regardless,
  // which fails with `No workspaces found` — a hard job failure on a repo whose
  // suite is perfectly runnable.
  assert.equal(isDeclaredWorkspace('e2e', {}), false)
  assert.equal(isDeclaredWorkspace('e2e', null), false)
})

test('the runner follows membership, and falls back to bare vitest', () => {
  const root = { workspaces: ['apps/*'] }
  const withTest = { scripts: { test: 'vitest run' } }

  assert.equal(runnerFor('apps/storybook', withTest, root), RUNNERS.WORKSPACE)
  assert.equal(runnerFor('e2e', withTest, root), RUNNERS.PREFIX, 'not a workspace — must not use -w')
  assert.equal(runnerFor('e2e', {}, root), RUNNERS.VITEST, 'no test script — bare vitest with --root')
  assert.equal(runnerFor('e2e', null, root), RUNNERS.VITEST, 'no manifest at all — still runnable')
})

// ── Playwright ──────────────────────────────────────────────────────────────

test('playwright is found in a workspace manifest, not just the root', () => {
  // nswds-ui declares it in apps/storybook, not at the root. The original
  // root-only check would have skipped the browser install and failed the run.
  assert.equal(needsPlaywright([{}, { devDependencies: { playwright: '^1.52.0' } }]), true)
  assert.equal(needsPlaywright([{ dependencies: { playwright: '^1.58.2' } }]), true)
  assert.equal(needsPlaywright([{}, null, { devDependencies: {} }]), false)
})

// ── Manifest reading ────────────────────────────────────────────────────────

test('an absent manifest is null, but an unparseable one throws', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'test-mode-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  assert.equal(readManifest(join(dir, 'package.json')), null, 'absent is legitimate')

  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{ "name": "demo", "scripts": { "test": "vitest run" }') // truncated
  assert.throws(
    () => readManifest(broken),
    /not valid JSON/,
    'a corrupt manifest must not read as "no test script" — that resolved to none and reported green',
  )

  const good = join(dir, 'good.json')
  writeFileSync(good, JSON.stringify({ scripts: { test: 'vitest run' } }))
  assert.equal(hasRealTestScript(readManifest(good)), true)
})

// ── Fleet shapes, end to end ────────────────────────────────────────────────

test('the real fleet shapes resolve as intended', () => {
  const cases = [
    { name: 'nswds-ui', files: ['apps/storybook/vitest.config.ts'], hasRootTest: false, expect: MODES.NESTED_VITEST },
    { name: 'nswds-app', files: ['vitest.config.ts'], hasRootTest: false, expect: MODES.ROOT_VITEST },
    {
      name: 'nswds-email-design',
      files: ['apps/docs/vitest.config.ts', 'packages/email/vitest.config.ts'],
      hasRootTest: true,
      expect: MODES.NPM_TEST,
    },
    { name: 'nswds-devops', files: [], hasRootTest: true, expect: MODES.NPM_TEST },
    { name: 'nswds-tokens', files: [], hasRootTest: false, expect: MODES.NONE },
  ]

  for (const { name, files, hasRootTest, expect } of cases) {
    assert.equal(resolveMode({ dirs: configDirsFrom(files), hasRootTest }), expect, `${name} resolved wrongly`)
  }
})
