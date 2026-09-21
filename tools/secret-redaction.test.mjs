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

test('two independent same-line PEM pairs both redact, preserving text between them', () => {
  // A single greedy `.*` would collapse from the first BEGIN to the LAST END,
  // eating the field between the two keys. Each pair must be redacted up to its
  // own END so the middle content survives.
  const input =
    '{"a":"-----BEGIN PRIVATE KEY-----\\nKEYONE\\n-----END PRIVATE KEY-----",' +
    '"note":"keepme",' +
    '"b":"-----BEGIN PRIVATE KEY-----\\nKEYTWO\\n-----END PRIVATE KEY-----"}'
  const out = redact(input)
  assert.doesNotMatch(out, /KEYONE/, 'first key body must be redacted')
  assert.doesNotMatch(out, /KEYTWO/, 'second key body must be redacted')
  assert.match(out, /"note":"keepme"/, 'content between the two pairs must survive')
})

test('a marker pair on a line inside an open block does not leak surrounding text', () => {
  // The inline-pair path preserves text around each pair, which is correct
  // OUTSIDE a block but must never run while a multi-line block is open: the
  // line sits between the block's BEGIN and END, so it is key-body content and
  // must be suppressed whole. Regression: an earlier draft ran the inline path
  // before the block-state check, printing the text around a body-line pair.
  const input = [
    '-----BEGIN PRIVATE KEY-----',
    '"leaked":"value", "inline":"-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----"',
    'MORESECRETBODY',
    '-----END PRIVATE KEY-----',
  ].join('\n')
  const out = redact(input)
  assert.doesNotMatch(out, /"leaked":"value"/, 'in-block body text must not leak')
  assert.doesNotMatch(out, /MORESECRETBODY/, 'in-block body must not leak')
})

test('text after a closing END marker on the same line survives, body does not', () => {
  // A multi-line PEM whose closing physical line carries a suffix (e.g. inside a
  // JSON value): the body and everything up to the END must be dropped, but the
  // legitimate suffix after the END must survive — and any secret in that suffix
  // must still be masked by the key/value stage.
  const input = [
    'before',
    '-----BEGIN PRIVATE KEY-----',
    'BASE64BODY',
    'LEAKYPREFIX-----END PRIVATE KEY-----","field":"value"',
    'after',
  ].join('\n')
  const out = redact(input)
  assert.doesNotMatch(out, /BASE64BODY/, 'key body must be suppressed')
  assert.doesNotMatch(out, /LEAKYPREFIX/, 'text before the closing END (still block body) must be suppressed')
  assert.match(out, /"field":"value"/, 'legitimate suffix after the closing END must survive')
  assert.match(out, /before/)
  assert.match(out, /after/)
  // A secret in the surviving suffix is still masked by the key/value stage.
  const withSecret = [
    '-----BEGIN PRIVATE KEY-----',
    'BODY',
    '-----END PRIVATE KEY-----","password":"hunter2","note":"keep"',
  ].join('\n')
  const out2 = redact(withSecret)
  assert.doesNotMatch(out2, /hunter2/, 'a secret in the surviving suffix must still be redacted')
  assert.match(out2, /"note":"keep"/, 'non-secret suffix content survives')
})

test('a close line that also starts the next block keeps the metadata between them', () => {
  // When a block's closing END is followed on the same line by more content and
  // a new BEGIN, the close rule must close at that END (not treat the trailing
  // BEGIN as "still nested") so the metadata between the two keys survives and
  // the second block is handled, rather than staying suppressed indefinitely.
  const input = [
    '-----BEGIN PRIVATE KEY-----',
    'BODY1',
    '-----END PRIVATE KEY-----","meta1":"keep1","key2":"-----BEGIN PRIVATE KEY-----',
    'BODY2',
    '-----END PRIVATE KEY-----","meta2":"keep2"',
  ].join('\n')
  const out = redact(input)
  assert.doesNotMatch(out, /BODY1/, 'first key body must be suppressed')
  assert.doesNotMatch(out, /BODY2/, 'second key body must be suppressed')
  assert.match(out, /"meta1":"keep1"/, 'metadata between the two keys must survive')
  assert.match(out, /"meta2":"keep2"/, 'trailing metadata after the last key must survive')
  // A secret in that surviving between-key metadata is still masked downstream.
  const withSecret = [
    '-----BEGIN PRIVATE KEY-----',
    'BODY',
    '-----END PRIVATE KEY-----","password":"hunter2","k":"-----BEGIN PRIVATE KEY-----',
    'B2',
    '-----END PRIVATE KEY-----',
  ].join('\n')
  assert.doesNotMatch(redact(withSecret), /hunter2/, 'a secret between keys must still be redacted')
})

test('stacked BEGINs on the opening line do not leak the outer block body', () => {
  // The opening rule seeds the depth counter with the number of unmatched BEGINs
  // on the line. If it assumed 1, an opening line with two BEGINs would be closed
  // by the first END and the content before the second END would leak.
  const input = [
    '-----BEGIN PRIVATE KEY-----X-----BEGIN PRIVATE KEY-----',
    '-----END PRIVATE KEY-----',
    'OUTERSECRET',
    '-----END PRIVATE KEY-----',
  ].join('\n')
  const out = redact(input)
  assert.doesNotMatch(out, /OUTERSECRET/, 'stacked BEGINs must need matching ENDs before content is emitted')
})

test('nested BEGIN markers across separate lines do not leak the outer block body', () => {
  // The block state is a depth counter, not a boolean: an inner BEGIN/END pair
  // on their own lines inside an outer block must not let the inner END close the
  // outer block, or the content between the inner END and the outer END leaks.
  const input = [
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN PRIVATE KEY-----',
    '-----END PRIVATE KEY-----',
    'OUTERSECRET',
    '-----END PRIVATE KEY-----',
  ].join('\n')
  const out = redact(input)
  assert.doesNotMatch(out, /OUTERSECRET/, 'outer block body must not leak across a nested inner END')
})

test('nested BEGIN markers on one line do not leak the outer block body', () => {
  // redact_inline_pairs took the FIRST END after a BEGIN. With stacked markers
  // (BEGIN…BEGIN…END…secret…END) that pairs the outer BEGIN with the inner END,
  // leaving the outer body ("OUTERSECRET") exposed. An intervening BEGIN before
  // the selected END now aborts the inline path so the caller opens block mode
  // and suppresses the rest.
  const nested =
    '-----BEGIN PRIVATE KEY-----AAA-----BEGIN PRIVATE KEY-----BBB' +
    '-----END PRIVATE KEY-----OUTERSECRET-----END PRIVATE KEY-----'
  assert.doesNotMatch(redact(nested), /OUTERSECRET/, 'outer block body must not leak')
  // Legit content before the nested markers must still survive.
  const withKeep = 'keep1 -----BEGIN PRIVATE KEY-----X-----END PRIVATE KEY----- keep2 ' + nested
  const out = redact(withKeep)
  assert.doesNotMatch(out, /OUTERSECRET/, 'outer block body must not leak')
  assert.match(out, /keep1/, 'content before an independent pair must survive')
  assert.match(out, /keep2/, 'content between pairs must survive')
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
