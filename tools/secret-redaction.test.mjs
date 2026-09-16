// Behaviour tests for scripts/secret-redaction.sh, the shared helper that masks
// secrets before any diff or change metadata is sent to the AI Gateway.
//
// The script is sourced into bash and its function/variable exercised directly,
// so these tests fail if the redaction or detection ever narrows (a real secret
// slips through) or over-broadens (a code identifier's value gets redacted
// across a whole diff). Both directions have bitten this helper: the redaction
// once missed every all-caps and compound key name (AWS_SECRET_ACCESS_KEY,
// CLIENT_SECRET), and a first broadening pass over-redacted `tokenizer = …`.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'secret-redaction.sh',
)

/** Run redact_sensitive_diff on `input` and return its stdout. */
const redact = (input) =>
  execFileSync('bash', ['-c', 'source "$1"; redact_sensitive_diff "$2"', 'bash', script, input], {
    encoding: 'utf8',
  })

/** True when SENSITIVE_REGEX (as every caller uses it, `grep -Eqi`) matches. */
function detectsExit(input) {
  try {
    execFileSync(
      'bash',
      ['-c', 'source "$1"; printf %s "$2" | grep -Eqi "$SENSITIVE_REGEX"', 'bash', script, input],
      { stdio: 'ignore' },
    )
    return true
  } catch {
    return false
  }
}

test('redacts compound and all-caps key names across env, YAML and JSON', () => {
  const cases = [
    ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIexamplevalue', 'AWS_SECRET_ACCESS_KEY=[REDACTED]'],
    ['CLIENT_SECRET=abc123', 'CLIENT_SECRET=[REDACTED]'],
    ['DB_PASSWORD=hunter2', 'DB_PASSWORD=[REDACTED]'],
    ['X_API_KEY: sk-livevalue', 'X_API_KEY: [REDACTED]'],
    ['api-key = live_abc', 'api-key = [REDACTED]'],
    ['clientSecret=abc', 'clientSecret=[REDACTED]'],
    ['  "client_secret": "supersecret",', '  "client_secret": "[REDACTED]",'],
    ['  "clientSecret": "xyz",', '  "clientSecret": "[REDACTED]",'],
    ['aws_secret_access_key: "literalvalue"', 'aws_secret_access_key: "[REDACTED]"'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(redact(input).trimEnd(), expected, `redacting ${JSON.stringify(input)}`)
  }
})

test('redacts high-signal token/key shapes regardless of surrounding key', () => {
  assert.match(redact('key: AKIAIOSFODNN7EXAMPLE'), /\[REDACTED_AWS_KEY\]/)
  assert.match(redact('x ghp_0123456789012345678901234567890123 y'), /\[REDACTED_GITHUB_TOKEN\]/)
  assert.match(
    redact('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'),
    /\[REDACTED_PRIVATE_KEY_BLOCK\]/,
  )
})

test('redacts the whole authorization value: bare, all-caps, compound, quoted, scheme-less', () => {
  // The scheme (Bearer/Basic/…) is masked along with the credential — a plain
  // key/value rule would keep "Bearer" and leak the token after it.
  const cases = [
    ['Authorization: Bearer abc.def.ghi', 'Authorization: [REDACTED]'],
    ['AUTHORIZATION=Bearer xyz', 'AUTHORIZATION=[REDACTED]'],
    ['HTTP_AUTHORIZATION=Bearer abc', 'HTTP_AUTHORIZATION=[REDACTED]'],
    ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: [REDACTED]'],
    ['authorization = opaquetoken', 'authorization = [REDACTED]'],
    ['  "authorization": "Bearer abc",', '  "authorization": "[REDACTED]",'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(redact(input).trimEnd(), expected, `redacting ${JSON.stringify(input)}`)
  }
  // A camelCase identifier that merely starts with "authorization" must survive.
  const code = 'const authorizationHeader = req.headers.authorization'
  assert.equal(redact(code).trimEnd(), code)
})

test('leaves code identifiers and non-secret keys intact', () => {
  // The value after `=` must survive: over-redacting these across a diff would
  // degrade every AI commit/PR title in the fleet.
  const untouched = [
    'const tokenizer = new Tokenizer()',
    'let secretSauce = compute(x)',
    'passwordField = form.ref',
    'apiKeyInput = document.querySelector()',
    'cache_key=lookupvalue',
    'retry_count=5',
    '  "secretSauce": "not-a-secret",',
  ]
  for (const input of untouched) {
    assert.equal(redact(input).trimEnd(), input, `should not redact ${JSON.stringify(input)}`)
  }
})

test('detection warns on compound keys but not on code identifiers', () => {
  for (const input of [
    'AWS_SECRET_ACCESS_KEY=x',
    'CLIENT_SECRET=y',
    'DB_PASSWORD=z',
    'HTTP_AUTHORIZATION=Bearer x',
  ]) {
    assert.equal(detectsExit(input), true, `should detect ${JSON.stringify(input)}`)
  }
  for (const input of ['const tokenizer = new T()', 'cache_key=lookup', 'retry_count=5']) {
    assert.equal(detectsExit(input), false, `should not detect ${JSON.stringify(input)}`)
  }
})
