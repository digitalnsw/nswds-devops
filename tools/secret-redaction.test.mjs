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

test('masks the whole value: single-quoted, multi-word, backtick and #-bearing', () => {
  // A single token that stopped at the first space/quote/# left the rest of a
  // passphrase, single-quoted value, or #-bearing value exposed.
  const cases = [
    ["CLIENT_SECRET='abc def'", 'CLIENT_SECRET=[REDACTED]'],
    ['DB_PASSWORD: correct horse battery staple', 'DB_PASSWORD: [REDACTED]'],
    ['PASSWORD=ab#cd', 'PASSWORD=[REDACTED]'],
    ['SECRET=`tmpl with spaces`', 'SECRET=[REDACTED]'],
    ["authorization='Bearer abc def'", 'authorization=[REDACTED]'],
    // Double-quoted values stay masked in place, preserving the quotes.
    ['  "client_secret": "a b c",', '  "client_secret": "[REDACTED]",'],
    ['secret: "multi word val"', 'secret: "[REDACTED]"'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(redact(input).trimEnd(), expected, `redacting ${JSON.stringify(input)}`)
  }
})

test('masks double-quoted values that contain escaped quotes', () => {
  // `[^"]*` ended at the first `"`, including an escaped one, leaking the rest;
  // the value class now consumes `\.` (an escaped char) as a unit.
  const cases = [
    ['  "client_secret": "abc\\"def",', '  "client_secret": "[REDACTED]",'],
    ['client_secret: "abc\\"def"', 'client_secret: "[REDACTED]"'],
    ['  "Authorization": "Bearer ab\\"cd",', '  "Authorization": "[REDACTED]",'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(redact(input).trimEnd(), expected, `redacting ${JSON.stringify(input)}`)
  }
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

// --- Private-key block path (findings 1 & 2) -------------------------------
// The block path had no coverage at all, which is why ENCRYPTED/PGP blocks
// leaked and a single-line PEM silently truncated the rest of the input.

// Every PEM marker spelling the BEGIN/END class must cover. ENCRYPTED and PGP
// are the two that the old `(RSA|OPENSSH|EC|DSA)? ?PRIVATE KEY` pattern missed.
const PEM_VARIANTS = [
  ['plain', 'PRIVATE KEY'],
  ['RSA', 'RSA PRIVATE KEY'],
  ['OPENSSH', 'OPENSSH PRIVATE KEY'],
  ['EC', 'EC PRIVATE KEY'],
  ['DSA', 'DSA PRIVATE KEY'],
  ['ENCRYPTED', 'ENCRYPTED PRIVATE KEY'],
  ['PGP', 'PGP PRIVATE KEY BLOCK'],
]

test('redacts every PEM block variant, body and all (finding 1)', () => {
  for (const [name, marker] of PEM_VARIANTS) {
    const input = `-----BEGIN ${marker}-----\nMIISECRETBODY${name}\n-----END ${marker}-----`
    const out = redact(input)
    assert.match(out, /\[REDACTED_PRIVATE_KEY_BLOCK\]/, `${name}: block placeholder`)
    assert.doesNotMatch(out, /SECRETBODY/, `${name}: body must not survive`)
    assert.doesNotMatch(out, /BEGIN .*PRIVATE KEY/, `${name}: BEGIN marker must not survive`)
  }
})

test('detection warns on every PEM block variant (finding 1)', () => {
  // Redaction and detection failed together for ENCRYPTED/PGP, so assert the
  // DETECTION regex directly — a redaction-only test cannot tell them apart.
  for (const [name, marker] of PEM_VARIANTS) {
    assert.equal(detectsExit(`-----BEGIN ${marker}-----`), true, `should detect ${name}`)
  }
})

test('a single-line BEGIN/END PEM does not swallow following lines (finding 2)', () => {
  // The GCP service-account JSON shape: the whole key on one line with `\n`
  // escapes. The old rule printed the placeholder and `next`ed, so `in_private
  // _key` stayed set and every later line was dropped. Assert the SURVIVING
  // content, not just the placeholder — that is the actual regression.
  const input = [
    '+ line one',
    '+ "private_key": "-----BEGIN PRIVATE KEY-----\\nMIISECRETBODY\\n-----END PRIVATE KEY-----"',
    '+ line three',
    '+ line four',
  ].join('\n')
  const out = redact(input)
  assert.match(out, /line one/)
  assert.match(out, /line three/, 'lines after a single-line PEM must survive')
  assert.match(out, /line four/, 'lines after a single-line PEM must survive')
  assert.doesNotMatch(out, /MIISECRETBODY/, 'the key body must be redacted')
  assert.doesNotMatch(out, /BEGIN PRIVATE KEY/, 'the BEGIN marker must not survive')
})

test('a same-line PEM redacts every marker variant in place', () => {
  // Parity with the multi-line variant matrix: the single-line (GCP-JSON) shape
  // must handle ENCRYPTED and PGP too, not just plain — and the content that
  // follows the closing quote on the same line must survive.
  for (const [name, marker] of PEM_VARIANTS) {
    const input = `{"k":"-----BEGIN ${marker}-----\\nBODYSECRET${name}\\n-----END ${marker}-----","keep":"me"}`
    const out = redact(input)
    assert.doesNotMatch(out, /BODYSECRET/, `${name}: same-line body must be redacted`)
    assert.match(out, /"keep":"me"|keep/, `${name}: trailing same-line content must survive`)
  }
})

test('an END marker before a BEGIN on one line does not bypass block redaction', () => {
  // The same-line rule keys off the ordered BEGIN…END pattern, not BEGIN and END
  // independently. A line where an END precedes the BEGIN that opens a real
  // multi-line block must fall through to block mode — otherwise the body that
  // follows leaks. (Regression: an earlier draft used `/BEGIN/ && /END/`, whose
  // gsub could not match the reversed order, so block mode was never entered.)
  const input = [
    'prefix -----END PRIVATE KEY----- then -----BEGIN PRIVATE KEY-----',
    'SECRETBODYXYZ',
    'morebase64SECRET',
    '-----END PRIVATE KEY-----',
    'trailing line',
  ].join('\n')
  const out = redact(input)
  assert.doesNotMatch(out, /SECRETBODYXYZ/, 'the key body must not leak')
  assert.doesNotMatch(out, /morebase64SECRET/, 'the key body must not leak')
  assert.match(out, /trailing line/, 'content after the closed block must survive')
})

// --- Newly covered key spellings (finding 3) -------------------------------

test('redacts passwd, pwd, credentials, private_key and passphrase values', () => {
  const cases = [
    ['passwd=hunter2', 'passwd=[REDACTED]'],
    ['pwd=hunter2', 'pwd=[REDACTED]'],
    ['credential: hunter2', 'credential: [REDACTED]'],
    ['credentials: hunter2', 'credentials: [REDACTED]'],
    ['private_key: abc123', 'private_key: [REDACTED]'],
    ['private-key=abc123', 'private-key=[REDACTED]'],
    ['passphrase=letmein', 'passphrase=[REDACTED]'],
    ['  "passphrase": "letmein",', '  "passphrase": "[REDACTED]",'],
    ['  "private_key": "not-a-pem-just-an-id",', '  "private_key": "[REDACTED]",'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(redact(input).trimEnd(), expected, `redacting ${JSON.stringify(input)}`)
  }
})

test('detection warns on the newly added key spellings (finding 3)', () => {
  for (const input of [
    'passwd=hunter2',
    'pwd=hunter2',
    'credentials: hunter2',
    'private_key: abc123',
    'passphrase=letmein',
  ]) {
    assert.equal(detectsExit(input), true, `should detect ${JSON.stringify(input)}`)
  }
})

test('the pwd shell builtin is not redacted or detected as a secret', () => {
  // `pwd` is now a matched word, but the key/value rules require a `:`/`=`
  // after the key — so the builtin invocations `$(pwd)` and `pwd)` (which have
  // neither) must pass through untouched and must not trip the warning.
  const untouched = ['echo $(pwd)', 'DIR=$(pwd)', '  cd "$(pwd)"', 'esac; pwd)']
  for (const input of untouched) {
    assert.equal(redact(input).trimEnd(), input, `should not redact ${JSON.stringify(input)}`)
    assert.equal(detectsExit(input), false, `should not detect ${JSON.stringify(input)}`)
  }
})
