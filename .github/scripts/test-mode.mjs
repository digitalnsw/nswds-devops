// Decide how the shared `install / test` job should run a repo's suite.
//
// WHY THIS IS A SCRIPT AND NOT SHELL IN THE WORKFLOW
// -------------------------------------------------
// It used to be shell. The consequence of a bug in it is not a red check — it
// is a GREEN one, on a repo whose tests never ran, which is the single failure
// this job exists to prevent. That is the same argument snyk-policy.mjs makes
// for itself, and the same reason tools/snyk-policy.test.mjs exists: paths that
// are almost never exercised by a real run need asserting directly.
//
// The shell version shipped four defects that only a test would have caught,
// each verified before this rewrite:
//
//   * `git ls-files` C-quotes any path with a byte >= 0x80 under the default
//     core.quotePath, so `apps/café/vitest.config.ts` arrived as
//     `"apps/caf\303\251/vitest.config.ts"`; the anchored regex then dropped
//     it, and if it was the only config the repo silently became `none`.
//     Fixed here by reading NUL-delimited output, which git never quotes.
//   * a directory named `-rf` reached `node -e '…' "$dir"` as an OPTION
//     (`node: bad option: -rf`), which the playwright probe read as "no
//     playwright" and silently skipped the browser install.
//   * `npm test -w <dir>` assumes <dir> is a declared npm workspace, but the
//     directory list comes from where configs sit. A config in a directory
//     outside the root `workspaces` globs failed with `No workspaces found`,
//     a hard job failure on a repo whose suite is fine.
//   * an unreadable root package.json was indistinguishable from one with no
//     `test` script, so a corrupt manifest resolved to `none` and reported
//     green having run nothing.
//
// WHAT THIS DOES NOT DECIDE
// -------------------------
// The precedence itself is a policy call, not this script's to make, and it is
// unchanged from the shell version: a root config wins, then the root's own
// `test` script, then workspace configs. In particular a root config still
// suppresses nested ones. That is deliberate — see the workflow comment — but
// it means a repo with both runs only the root suite.

import { readFileSync } from 'node:fs'

export const MODES = Object.freeze({
  ROOT_VITEST: 'root-vitest',
  NPM_TEST: 'npm-test',
  NESTED_VITEST: 'nested-vitest',
  NONE: 'none',
})

/** How a workspace's suite should be invoked once we know where it lives. */
export const RUNNERS = Object.freeze({
  WORKSPACE: 'workspace', // npm test -w <dir>   — dir is a declared workspace
  PREFIX: 'prefix', // npm --prefix <dir> test — it is not
  VITEST: 'vitest', // npx vitest run --root <dir> — no test script at all
})

// A vitest config, as vitest itself resolves it: `vitest.config` plus one
// all-alphabetic extension. Deliberately NOT matching `vitest.config.unit.ts`
// or `vitest.config.v2.ts` — vitest does not auto-load those either; they are
// passed with --config. `vitest.workspace.*` is also excluded: it was removed
// in vitest 4, which the whole fleet is on.
const CONFIG_PATTERN = /(?:^|\/)vitest\.config\.[A-Za-z]+$/

/** Directory of a tracked path, with the repo root spelled `.` as the sentinel. */
const dirOf = (file) => {
  const cut = file.lastIndexOf('/')
  return cut === -1 ? '.' : file.slice(0, cut)
}

/**
 * Directories holding a vitest config, sorted and deduplicated. `.` means the
 * repo root. Two configs in one directory collapse to a single entry.
 */
export function configDirsFrom(trackedFiles) {
  const dirs = new Set()
  for (const file of trackedFiles) {
    if (CONFIG_PATTERN.test(file)) dirs.add(dirOf(file))
  }
  return [...dirs].sort()
}

/**
 * Does this manifest declare a real `test` script? The npm-init default stub
 * ("Error: no test specified") is treated as absent, so onboarding a repo that
 * never wrote tests does not fail CI.
 */
export function hasRealTestScript(manifest) {
  const script = manifest?.scripts?.test ?? ''
  return Boolean(script) && !/no test specified/.test(script)
}

/**
 * Is `dir` covered by the root manifest's `workspaces` globs? Decides between
 * `npm test -w` (which requires membership and sets up the hoisted bin path)
 * and `npm --prefix` (which does not).
 *
 * Handles the shapes npm workspaces actually take in this fleet — an exact
 * path, a single `*` segment, and a trailing `**`. Anything more exotic falls
 * through to `false`, which costs a --prefix invocation rather than a failure.
 */
export function isDeclaredWorkspace(dir, rootManifest) {
  const patterns = Array.isArray(rootManifest?.workspaces)
    ? rootManifest.workspaces
    : (rootManifest?.workspaces?.packages ?? [])

  return patterns.some((pattern) => {
    const normalised = pattern.replace(/\/+$/, '')
    if (normalised === dir) return true
    const regex = new RegExp(
      `^${normalised
        .split('/')
        .map((segment) =>
          segment === '**' ? '.*' : segment === '*' ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        )
        .join('/')}$`,
    )
    return regex.test(dir)
  })
}

/**
 * The precedence, in one place. `hasRootTest` is only consulted when there is
 * no root config, matching the shell version exactly.
 */
export function resolveMode({ dirs, hasRootTest }) {
  if (dirs.includes('.')) return MODES.ROOT_VITEST
  if (hasRootTest) return MODES.NPM_TEST
  if (dirs.length > 0) return MODES.NESTED_VITEST
  return MODES.NONE
}

/** How to invoke one nested workspace's suite. */
export function runnerFor(dir, manifest, rootManifest) {
  if (!hasRealTestScript(manifest)) return RUNNERS.VITEST
  return isDeclaredWorkspace(dir, rootManifest) ? RUNNERS.WORKSPACE : RUNNERS.PREFIX
}

/** Is any of these directories, or the root, declaring playwright? */
export function needsPlaywright(manifests) {
  return manifests.some(
    (manifest) => Boolean(manifest?.devDependencies?.playwright) || Boolean(manifest?.dependencies?.playwright),
  )
}

/**
 * Read a package.json. Three outcomes, never two: the manifest, `null` when the
 * file is simply absent (legitimate), or a thrown error when it exists and
 * cannot be parsed. Collapsing the third into the second is how a corrupt
 * manifest used to resolve to `none` and report green.
 */
export function readManifest(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} exists but is not valid JSON: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// CLI. Invoked by the shared `install / test` job's probe step as:
//
//     node .github/scripts/test-mode.mjs "$RUNNER_TEMP/vitest-config-dirs"
//
// Writes `mode` and `needs_playwright` straight to $GITHUB_OUTPUT — both fixed
// enums — and the per-directory plan to the file named in argv[2], one
// `<runner>\t<dir>` line each. Directory names never become a step output:
// `${{ }}` is substituted into a run block as TEXT before bash parses it, and
// an earlier draft of this step executed `id` on the runner from a tracked
// `x$(id)y/vitest.config.ts`. A file read with `read -r` is data at every
// stage; an interpolated output is code.
//
// Diagnostics and ::error:: annotations go to stdout for the Actions log, which
// is why the mode is written to the file rather than piped — a redirect would
// put the error text into $GITHUB_OUTPUT instead of the log.
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Tracked files, NUL-delimited. `-z` is load-bearing rather than tidy: without
 * it git applies core.quotePath and any path with a byte >= 0x80 comes back
 * C-quoted and wrapped in double quotes, which no anchored pattern matches, so
 * the config is silently skipped.
 */
export function trackedFiles(cwd = process.cwd()) {
  const raw = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return raw.split('\0').filter(Boolean)
}

const fail = (message) => {
  process.stdout.write(`::error::${message}\n`)
  process.exit(1)
}

function main() {
  const planFile = process.argv[2]
  if (!planFile) fail('test-mode.mjs needs a path to write the run plan to.')

  // A listing that fails must fail the job. Reporting "no configs" for a tree
  // that was never scanned is indistinguishable from a clean repo, which is
  // the whole failure class this job exists to close.
  let files
  try {
    files = trackedFiles()
  } catch (error) {
    fail(`git ls-files failed, so the vitest config scan never ran. Failing instead of reporting no tests. ${error.message}`)
  }

  let rootManifest
  try {
    rootManifest = readManifest('package.json')
  } catch (error) {
    fail(`${error.message} Failing instead of treating it as "no test script".`)
  }

  const dirs = configDirsFrom(files)
  const mode = resolveMode({ dirs, hasRootTest: hasRealTestScript(rootManifest) })

  // Only the nested path consults per-directory manifests; in every other mode
  // the plan is unused and reading them would be noise that can only fail.
  const nested = mode === MODES.NESTED_VITEST ? dirs : []
  const plan = []
  for (const dir of nested) {
    let manifest
    try {
      manifest = readManifest(join(dir, 'package.json'))
    } catch (error) {
      fail(`${error.message} Failing instead of guessing how to run its suite.`)
    }
    plan.push({ dir, runner: runnerFor(dir, manifest, rootManifest) })
  }

  // Browser-mode suites need a real browser, and the dependency can sit in the
  // root manifest OR in the workspace that owns a config — nswds-ui declares it
  // in apps/storybook, not at the root. Only the vitest modes install it: an
  // aggregate `npm test` reaching a browser suite is a case no repo is in,
  // while nswds-email-framework would pay a Chromium install on every run for
  // a node:test suite that needs no browser.
  const playwrightDirs = mode === MODES.ROOT_VITEST || mode === MODES.NESTED_VITEST ? dirs : []
  const manifests = [rootManifest]
  for (const dir of playwrightDirs) {
    if (dir === '.') continue
    try {
      manifests.push(readManifest(join(dir, 'package.json')))
    } catch {
      // A manifest we cannot parse simply does not advertise playwright. The
      // nested path already failed loudly above if this mattered.
    }
  }
  const wantsPlaywright = playwrightDirs.length > 0 && needsPlaywright(manifests)

  writeFileSync(planFile, plan.map(({ runner, dir }) => `${runner}\t${dir}`).join('\n') + (plan.length ? '\n' : ''))

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\nneeds_playwright=${wantsPlaywright}\n`)
  }

  process.stdout.write(`Mode: ${mode}\n`)
  for (const dir of dirs) process.stdout.write(`  vitest config in: ${dir}\n`)
  for (const { runner, dir } of plan) process.stdout.write(`  will run ${dir} via ${runner}\n`)
  if (wantsPlaywright) process.stdout.write('  playwright declared — installing Chromium\n')
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
