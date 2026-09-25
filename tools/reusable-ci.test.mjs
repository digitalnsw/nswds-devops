// Guards for how the shared `install / test` gate in reusable-ci.yml obtains
// .github/scripts/test-mode.mjs.
//
// Consumers do not have the script, so the job fetches it from this repo. The
// fetch has to be pinned to the commit of the reusable workflow being run
// (job.workflow_sha), not to a moving ref: the previous `ref: v1` meant a
// SHA-pinned caller's test gate changed on every Promote v1 without its pin
// moving. Nothing in this repo's own CI exercises the fetch — the caller here
// IS this repo, so the step is skipped — which is why the wiring is asserted
// directly. A regression would otherwise surface first as a fleet-wide red
// `install / test`, or worse, as a quietly unpinned green one.
//
// The workflow is read as text rather than with a YAML parser: the repo has
// no YAML dependency, and the assertions only need the `test` job's steps,
// which have a fixed six-space indent.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')

const WORKFLOW_REPOSITORY = '${{ fromJSON(toJSON(job)).workflow_repository }}'
const WORKFLOW_SHA = '${{ fromJSON(toJSON(job)).workflow_sha }}'
const SCRIPT = '.github/scripts/test-mode.mjs'

/** The body of a top-level job (two-space key) up to the next job or EOF. */
function jobBlock(source, name) {
  const lines = source.split('\n')
  const start = lines.indexOf(`  ${name}:`)
  assert.ok(start !== -1, `reusable-ci.yml has no \`${name}\` job`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^ {2}[A-Za-z_][\w-]*:\s*$/.test(line))
  return end === -1 ? rest : rest.slice(0, end)
}

/** The job's steps, each as its own list of lines, in order. */
function stepsOf(jobLines) {
  const steps = []
  for (const line of jobLines) {
    if (line.startsWith('      - ')) steps.push([line])
    else if (steps.length && (line.startsWith('        ') || line.trim() === '')) {
      steps.at(-1).push(line)
    }
  }
  return steps.map((lines) => lines.join('\n'))
}

/** The value of a `key: value` line inside a step (first match). */
function field(step, key) {
  const match = step.match(new RegExp(`^\\s+(?:- )?${key}: (.*)$`, 'm'))
  return match?.[1]
}

/** A step's `run: |` body with its indent removed, ready for bash -c. */
function runBody(step) {
  const lines = step.split('\n')
  const start = lines.findIndex((line) => /^\s+run: \|\s*$/.test(line))
  assert.ok(start !== -1, 'step has no `run: |` block')
  const body = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !line.startsWith('          ')) break
    body.push(line.slice(10))
  }
  return body.join('\n')
}

/** Runs a bash body with the given env; returns { status, output }. */
function bash(body, env) {
  try {
    const output = execFileSync('bash', ['-c', body], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, output }
  } catch (error) {
    return { status: error.status, output: `${error.stdout}${error.stderr}` }
  }
}

const steps = stepsOf(jobBlock(read('.github/workflows/reusable-ci.yml'), 'test'))
const named = (name) => {
  const step = steps.find((candidate) => field(candidate, 'name') === name)
  assert.ok(step, `test job has no step named "${name}"`)
  return step
}

const resolve = named("Resolve this workflow's source commit")
const fetch = named('Fetch the shared test-mode script')
const decide = named('Decide what to run')

test('the three steps are found, in resolve → fetch → decide order', () => {
  // Guards the guards: every assertion below reads one of these, and a
  // renamed step would otherwise fail with a confusing message or not at all.
  const order = [resolve, fetch, decide].map((step) => steps.indexOf(step))
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  )
})

test('the fetch is pinned to the reusable workflow’s own repository and commit', () => {
  assert.equal(field(fetch, 'repository'), WORKFLOW_REPOSITORY)
  assert.equal(field(fetch, 'ref'), WORKFLOW_SHA)
})

test('the fetch never uses a moving ref or the caller’s commit', () => {
  // `v1` is the regression this file exists for. github.workflow_sha is the
  // CALLER's commit (the consumer's ci.yml), which does not exist in this repo.
  assert.doesNotMatch(fetch, /ref: v\d/)
  assert.doesNotMatch(fetch, /github\.workflow_(sha|ref)/)
  assert.doesNotMatch(fetch, /repository: digitalnsw\//)
})

test('the resolve step runs in every caller, including this repo', () => {
  // It is the only step this repo's own CI runs against job.workflow_*, so it
  // is what proves the context is populated before any consumer depends on it.
  assert.equal(field(resolve, 'if'), undefined)
  assert.equal(field(resolve, 'WORKFLOW_REPOSITORY'), WORKFLOW_REPOSITORY)
  assert.equal(field(resolve, 'WORKFLOW_SHA'), WORKFLOW_SHA)
})

test('the resolve step fails when either identity value is missing', () => {
  const body = runBody(resolve)
  const sha = '6754b3494a47894d89e9d1b0106a64e13a1a9443'
  const cases = [
    { WORKFLOW_REPOSITORY: '', WORKFLOW_SHA: '' },
    { WORKFLOW_REPOSITORY: 'digitalnsw/nswds-devops', WORKFLOW_SHA: '' },
    { WORKFLOW_REPOSITORY: '', WORKFLOW_SHA: sha },
    {},
  ]
  for (const env of cases) {
    const { status, output } = bash(body, env)
    assert.equal(status, 1, `expected failure for ${JSON.stringify(env)}`)
    assert.match(output, /::error::job\.workflow_repository or job\.workflow_sha is empty/)
  }
})

test('the resolve step logs the pinned source when both values are present', () => {
  const env = {
    WORKFLOW_REPOSITORY: 'digitalnsw/nswds-devops',
    WORKFLOW_SHA: '6754b3494a47894d89e9d1b0106a64e13a1a9443',
  }
  const { status, output } = bash(runBody(resolve), env)
  assert.equal(status, 0)
  assert.match(output, /test-mode\.mjs source: digitalnsw\/nswds-devops@6754b349/)
})

test('fetch and decide key off the same caller-identity comparison', () => {
  // If these disagreed, a consumer could fetch the pinned copy and then run a
  // local one (or the reverse). File presence is not used: a consumer that
  // carries its own .github/scripts/test-mode.mjs must still get the pinned copy.
  const identity = 'fromJSON(toJSON(job)).workflow_repository'
  assert.equal(field(fetch, 'if'), `\${{ ${identity} != github.repository }}`)
  assert.equal(
    field(decide, 'TEST_MODE_SCRIPT'),
    `\${{ ${identity} == github.repository && '${SCRIPT}' || '.nswds-ci/${SCRIPT}' }}`,
  )
  for (const step of [resolve, fetch, decide]) {
    assert.doesNotMatch(step, /hashFiles\('\.github\/scripts\/test-mode\.mjs'\)/)
  }
})

test('the sparse checkout holds exactly the file decide runs', () => {
  assert.equal(field(fetch, 'path'), '.nswds-ci')
  assert.equal(field(fetch, 'sparse-checkout'), SCRIPT)
  assert.equal(field(fetch, 'sparse-checkout-cone-mode'), 'false')
  assert.equal(field(fetch, 'persist-credentials'), 'false')
})

test('test-mode.mjs imports only node: built-ins, so the one-file checkout is enough', () => {
  // A relative import would resolve on this repo's CI (full checkout) and fail
  // with MODULE_NOT_FOUND in every consumer, whose sparse copy has one file.
  const source = read(SCRIPT)
  const specifiers = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map(
    (match) => match[1],
  )
  assert.ok(specifiers.length > 0, 'found no imports at all; the scan is broken')
  for (const specifier of specifiers) {
    assert.match(specifier, /^node:/, `test-mode.mjs imports ${specifier}`)
  }
  assert.doesNotMatch(source, /\bimport\(/, 'test-mode.mjs uses a dynamic import')
  assert.doesNotMatch(source, /\brequire\(/, 'test-mode.mjs uses require()')
})

test('decide fails loudly when the chosen script is missing', () => {
  const { status, output } = bash(runBody(decide), {
    TEST_MODE_SCRIPT: '.nswds-ci/does-not-exist.mjs',
    RUNNER_TEMP: '/tmp',
  })
  assert.equal(status, 1)
  assert.match(output, /::error::\.nswds-ci\/does-not-exist\.mjs is missing/)
})
