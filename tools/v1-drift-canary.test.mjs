// Guards for how v1-drift-canary.yml opens and closes its tracking issue.
//
// The open step stays silent while any v1-drift issue is open, so an issue
// that never closes hides every later drift. The close step is what prevents
// that, and it only runs on the weekly schedule, so nothing in this repo's CI
// exercises it. The wiring is asserted directly, the drift step is run against
// a throwaway git repo to pin which outcomes reach the close step, and the
// close step is run against a fake `gh` on PATH.
//
// The workflow is read as text rather than with a YAML parser, as in
// reusable-release.test.mjs: the repo has no YAML dependency, and steps have a
// fixed six-space indent.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflow = readFileSync(path.join(root, '.github/workflows/v1-drift-canary.yml'), 'utf8')

const DRIFT_STEP = 'Measure unpromoted reusable-workflow changes'
const OPEN_STEP = 'Open tracking issue when v1 has drifted'
const CLOSE_STEP = 'Close the tracking issue once v1 has caught up'

/** The body of a top-level job (two-space key) up to the next job or EOF. */
function jobBlock(source, name) {
  const lines = source.split('\n')
  const start = lines.indexOf(`  ${name}:`)
  assert.ok(start !== -1, `v1-drift-canary.yml has no \`${name}\` job`)
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

const probeSteps = stepsOf(jobBlock(workflow, 'probe'))
const stepNamed = (name) => probeSteps.find((step) => field(step, 'name') === name)
const driftStep = stepNamed(DRIFT_STEP)
const openStep = stepNamed(OPEN_STEP)
const closeStep = stepNamed(CLOSE_STEP)

/** Parses a $GITHUB_OUTPUT file of single-line `key=value` entries. */
function readOutputs(file) {
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

/**
 * Runs the drift step in a throwaway repo where v1 tags the first commit and
 * origin/main carries `commits` on top, each `{ file, daysAgo }`.
 */
function runDrift(commits) {
  assert.ok(driftStep, `probe job has no "${DRIFT_STEP}" step`)
  const dir = mkdtempSync(path.join(tmpdir(), 'v1-drift-canary-'))
  try {
    const repo = path.join(dir, 'repo')
    const git = (args, env = {}) =>
      execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          ...env,
        },
      }).trim()
    execFileSync('git', ['init', '-q', repo])
    git(['commit', '-q', '--allow-empty', '-m', 'base'])
    git(['tag', 'v1'])
    for (const [index, { file, daysAgo }] of commits.entries()) {
      const target = path.join(repo, file)
      execFileSync('mkdir', ['-p', path.dirname(target)])
      writeFileSync(target, `change ${index}\n`)
      git(['add', file])
      const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString()
      git(['commit', '-q', '-m', `change ${index}`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
    }
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    const output = path.join(dir, 'output')
    writeFileSync(output, '')
    execFileSync('bash', ['-e', '-c', runBody(driftStep)], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output, RUNNER_TEMP: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { outputs: readOutputs(output), v1: git(['rev-parse', 'v1']) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Runs the close step's body the way Actions does (`bash -e`) with a fake
 * `gh` that logs each call and answers `issue list` with `listOutput`.
 * `closeFails` makes every `gh issue close` exit 1.
 */
function runClose({ listOutput, closeFails = false }) {
  assert.ok(closeStep, `probe job has no "${CLOSE_STEP}" step`)
  const dir = mkdtempSync(path.join(tmpdir(), 'v1-drift-canary-'))
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
      GITHUB_REPOSITORY: 'digitalnsw/nswds-devops',
      GITHUB_RUN_ID: '12345',
      V1_SHA: 'a4229c0b0bf4e87fb2b64deb54fd4996b99f8e94',
    }
    let status = 0
    let output
    try {
      output = execFileSync('bash', ['-e', '-c', runBody(closeStep)], {
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

test('the close step runs exactly when the open step does not', () => {
  assert.ok(openStep, `probe job has no "${OPEN_STEP}" step`)
  assert.ok(closeStep, `probe job has no "${CLOSE_STEP}" step`)
  assert.equal(field(openStep, 'if'), "steps.drift.outputs.drifted == 'true'")
  // No status function: the default success() gate keeps a failed probe from
  // closing an issue it never measured.
  assert.equal(field(closeStep, 'if'), "steps.drift.outputs.drifted != 'true'")
  assert.equal(field(driftStep, 'id'), 'drift')
})

test('it closes under the label the open step files and checks', () => {
  const close = runBody(closeStep)
  assert.match(close, /gh issue list [^\n]*--state open /)
  assert.match(close, /gh issue list [^\n]*--label v1-drift /)
  const open = runBody(openStep)
  assert.match(open, /gh issue list --state open --label v1-drift /)
  assert.match(open, /gh issue create [^]*--label v1-drift /)
})

test('no unpromoted change: not drifted, so the close step runs, with v1 reported', () => {
  const { outputs, v1 } = runDrift([])
  assert.equal(outputs.drifted, 'false')
  assert.equal(outputs.v1, v1)
})

test('only fresh or off-surface changes: not drifted, so a stale issue still closes', () => {
  const { outputs } = runDrift([
    { file: 'README.md', daysAgo: 30 },
    { file: '.github/workflows/reusable-ci.yml', daysAgo: 2 },
  ])
  assert.equal(outputs.drifted, 'false')
})

test('week-old change to the executable surface: drifted, so the issue stays open', () => {
  for (const file of ['.github/workflows/reusable-release.yml', '.github/scripts/test-mode.mjs']) {
    const { outputs, v1 } = runDrift([{ file, daysAgo: 8 }])
    assert.equal(outputs.drifted, 'true', file)
    assert.equal(outputs.v1, v1)
  }
})

test('with no open issue it exits cleanly and closes nothing', () => {
  const { status, output, calls } = runClose({ listOutput: '' })
  assert.equal(status, 0, output)
  assert.deepEqual(
    calls.map((args) => args.slice(0, 2).join(' ')),
    ['issue list'],
  )
})

test('it closes every open issue as completed, citing v1 and the run', () => {
  const { status, output, calls } = runClose({ listOutput: '157\n160\n' })
  assert.equal(status, 0, output)
  const closes = calls.filter((args) => args[0] === 'issue' && args[1] === 'close')
  assert.deepEqual(
    closes.map((args) => args[2]),
    ['157', '160'],
  )
  for (const args of closes) {
    assert.equal(args[args.indexOf('--reason') + 1], 'completed')
    const comment = args[args.indexOf('--comment') + 1]
    assert.match(comment, /a4229c0b0bf4e87fb2b64deb54fd4996b99f8e94/)
    assert.match(comment, /https:\/\/github\.com\/digitalnsw\/nswds-devops\/actions\/runs\/12345/)
    assert.doesNotMatch(comment, /^ /m, 'the comment must not carry the YAML indent')
  }
})

test('a failed close fails the run, so the canary shows red', () => {
  const { status } = runClose({ listOutput: '157\n', closeFails: true })
  assert.notEqual(status, 0)
})
