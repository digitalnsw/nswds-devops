// Guards for how reusable-release.yml closes the release-failure issue that
// its alert-on-failure job files.
//
// Nothing in this repo's CI exercises the step against real issues, so the
// wiring is asserted directly and the step's shell body is run against a fake
// `gh` on PATH. The two properties that matter most are structural: the close
// runs inside the `release` job (whose concurrency group orders it before any
// later run's failure alert) and it can never fail a release that succeeded.
//
// The workflow is read as text rather than with a YAML parser, as in
// reusable-ci.test.mjs: the repo has no YAML dependency, and steps have a
// fixed six-space indent.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = readFileSync(path.join(root, '.github/workflows/reusable-release.yml'), 'utf8')

const CLOSE_STEP = 'Close release-failure issues superseded by this successful release'

/** The body of a top-level job (two-space key) up to the next job or EOF. */
function jobBlock(source, name) {
  const lines = source.split('\n')
  const start = lines.indexOf(`  ${name}:`)
  assert.ok(start !== -1, `reusable-release.yml has no \`${name}\` job`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^ {2}[A-Za-z_][\w-]*:\s*$/.test(line))
  return end === -1 ? rest : rest.slice(0, end)
}

/** The job's steps, each as its own string, in order. */
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

/** A step's `run: |` body with its indent removed, ready for bash. */
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

const releaseSteps = stepsOf(jobBlock(workflow, 'release'))
const closeStep = releaseSteps.find((step) => field(step, 'name') === CLOSE_STEP)

/**
 * Runs the close step's body the way Actions does (`bash -e`) with a fake
 * `gh` that logs each call and answers `issue list` with `listOutput`.
 * `closeFails` makes every `gh issue close` exit 1.
 */
function runClose({ listOutput, closeFails = false }) {
  assert.ok(closeStep, `release job has no "${CLOSE_STEP}" step`)
  const body = runBody(closeStep)
  const dir = mkdtempSync(path.join(tmpdir(), 'reusable-release-'))
  try {
    const log = path.join(dir, 'gh.log')
    writeFileSync(
      path.join(dir, 'gh'),
      [
        '#!/usr/bin/env bash',
        // Args NUL-separated, calls separated by 0x1E: comments contain newlines.
        `printf '%s\\0' "$@" >> ${JSON.stringify(log)}`,
        `printf '\\036' >> ${JSON.stringify(log)}`,
        'if [ "$1 $2" = "issue list" ]; then printf "%s" "$GH_LIST_OUTPUT"; fi',
        `if [ "$1 $2" = "issue close" ] && [ "$GH_CLOSE_FAILS" = 1 ]; then exit 1; fi`,
        'exit 0',
      ].join('\n'),
      { mode: 0o755 },
    )
    const env = {
      PATH: `${dir}:${process.env.PATH}`,
      GH_LIST_OUTPUT: listOutput,
      GH_CLOSE_FAILS: closeFails ? '1' : '0',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'digitalnsw/example',
      GITHUB_RUN_ID: '12345',
      GITHUB_SHA: 'abc123',
    }
    let status = 0
    let output
    try {
      output = execFileSync('bash', ['-e', '-c', body], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      status = error.status
      output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
    let calls = []
    try {
      calls = readFileSync(log, 'utf8')
        .split('\x1e')
        .filter(Boolean)
        .map((call) => call.split('\0').slice(0, -1))
    } catch {
      // No log file: gh was never called.
    }
    return { status, output, calls }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the close step is the last step of the release job, right after Release', () => {
  assert.ok(closeStep, `release job has no "${CLOSE_STEP}" step`)
  const names = releaseSteps.map((step) => field(step, 'name'))
  assert.equal(names.at(-1), CLOSE_STEP)
  assert.equal(names.at(-2), 'Release')
})

test('the close step cannot fail a release that already succeeded', () => {
  assert.equal(field(closeStep, 'continue-on-error'), 'true')
  assert.equal(field(closeStep, 'if'), undefined, 'the step must keep the default success() gate')
})

test('it closes exactly what alert-on-failure files: bot-authored, labelled, open', () => {
  const body = runBody(closeStep)
  assert.match(body, /gh issue list [^\n]*--label release-failure /)
  assert.match(body, /gh issue list [^\n]*--state open /)
  assert.match(body, /gh issue list [^\n]*--author app\/github-actions /)
  const alert = stepsOf(jobBlock(workflow, 'alert-on-failure')).join('\n')
  assert.match(alert, /--label release-failure/, 'the alert must file under the label the close step reads')
})

test('with no open issue it exits cleanly and closes nothing', () => {
  const { status, output, calls } = runClose({ listOutput: '' })
  assert.equal(status, 0, output)
  assert.deepEqual(
    calls.map((args) => args.slice(0, 2).join(' ')),
    ['issue list'],
  )
})

test('it closes every open issue as completed, citing the green run and commit', () => {
  const { status, output, calls } = runClose({ listOutput: '643\n650\n' })
  assert.equal(status, 0, output)
  const closes = calls.filter((args) => args[0] === 'issue' && args[1] === 'close')
  assert.deepEqual(
    closes.map((args) => args[2]),
    ['643', '650'],
  )
  for (const args of closes) {
    assert.equal(args[args.indexOf('--repo') + 1], 'digitalnsw/example')
    assert.equal(args[args.indexOf('--reason') + 1], 'completed')
    const comment = args[args.indexOf('--comment') + 1]
    assert.match(comment, /https:\/\/github\.com\/digitalnsw\/example\/actions\/runs\/12345/)
    assert.match(comment, /abc123/)
    assert.match(comment, /tag without its release artefacts/)
  }
})

test('a failed close is reported as a failed step, not swallowed', () => {
  const { status } = runClose({ listOutput: '643\n', closeFails: true })
  assert.notEqual(status, 0)
})
