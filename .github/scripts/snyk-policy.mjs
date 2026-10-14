// Canonical Snyk policy: check the fleet, or fan the base out as PRs.
//
// WHY THIS EXISTS AND NOT .github/sync.yml
// ----------------------------------------
// BetaHuhn/repo-file-sync-action overwrites whole destination files. `.snyk`
// is a Mechanism C file (docs/config-single-source-of-truth.md): part shared
// policy, part policy that is genuinely the repo's own — nswds-email-framework
// excludes its generated docs/ from Snyk Code, nswds-tokens accepts a
// javascript/PT finding in one script, nswds-app accepts two transitive
// postcss advisories, dtl-sandbox path-scopes js-yaml and the npm bundle.
// A whole-file sync deletes all of that, which is why `.snyk` was left out of
// the sync map and why the same policy change then had to be written by hand
// in four repos on 2026-08-31.
//
// The split this script enforces:
//
//     [ canonical block from snyk-policy/base.snyk ]
//       # repo-specific          <- marker, last line of the block
//     [ tail, preserved byte-for-byte ]
//
// Only the block is ever rewritten. The tail is never parsed, reformatted or
// reordered — it is copied through verbatim, so a repo cannot lose policy it
// owns. The single exception is a trailing newline added when the file would
// otherwise not end in one; trailing blank lines are left exactly as found.
//
// The block is delivered as ONE PR per repo on a chore/repo-sync/* branch,
// which scripts/branch-name-config.sh (REPO_SYNC_REGEX) already exempts from
// branch-name validation, with a `chore(ci): ` subject that passes commitlint
// and never triggers a semantic-release.
//
// Repo-local to nswds-devops — NOT synced to consumers.
//
// Usage:
//   node .github/scripts/snyk-policy.mjs --check            report drift only
//   node .github/scripts/snyk-policy.mjs --apply            open/refresh PRs
//   node .github/scripts/snyk-policy.mjs --check --repo x   one repo
//   node .github/scripts/snyk-policy.mjs --apply --dry-run  print, do not write
//
// GH_TOKEN is required for every mode, --dry-run included: dry-run suppresses
// WRITES, not reads — evaluating drift means fetching each consumer's .snyk.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

const MARKER = '  # repo-specific'
const BRANCH = 'chore/repo-sync/snyk-policy'
const POLICY_PATH = '.snyk'

// Emitted only by this script, so its presence in a consumer's file proves the
// file was produced by a fan-out rather than written before the convention.
//
// It does NOT disarm migrations — `migrate.fromSha` does, and deliberately so:
// an earlier version gated on this sentinel, which is mutable file content, so
// a consumer editing the canonical block re-armed spent directives. Do not
// reintroduce that. What the sentinel provides is RECOVERY: once the SHA no
// longer matches, it is how selectTail() recognises an already-converted file
// and preserves its tail instead of refusing.
const SENTINEL = 'Canonical base (generated from nswds-devops'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
// A flag with no value must FAIL, not fall through. `--apply --repo` used to
// leave ONLY undefined, which disabled the filter entirely and fanned out to
// every configured repository — the opposite of what the operator asked for,
// with the whole fleet as blast radius.
const valueOf = (f) => {
  const i = args.indexOf(f)
  if (i === -1) return null
  const value = args[i + 1]
  if (value === undefined || value.startsWith('-')) {
    console.error(`::error::${f} requires a value`)
    process.exit(1)
  }
  return value
}

const MODE = has('--apply') ? 'apply' : 'check'
const DRY_RUN = has('--dry-run')
const ONLY = valueOf('--repo')

const base = readFileSync(new URL('../../snyk-policy/base.snyk', import.meta.url), 'utf8')

// The sentinel is what isConverted() keys on. Since the migration gate became
// an immutable blob SHA it is no longer what prevents policy deletion — a
// missing sentinel on a converted file yields `refuse`, not a re-armed
// directive. What it still buys is RECOVERY: it is how a stale directive
// recognises an already-converted file and preserves its tail instead of
// refusing. Losing it would therefore turn every spent-directive repo from
// "quietly correct" into "blocked until a human looks", so it is still worth
// failing at startup.
if (!base.includes(SENTINEL)) {
  throw new Error(
    `snyk-policy/base.snyk must contain the sentinel ${JSON.stringify(SENTINEL)} — ` +
      'selectTail() needs it to recognise an already-converted file and preserve its tail once ' +
        'migrate.fromSha no longer matches. Without it those repos are refused rather than synced.',
  )
}
const config = JSON.parse(
  readFileSync(new URL('../../snyk-policy/repos.json', import.meta.url), 'utf8'),
)
const ORG = config.owner

// ── Pure rendering ─────────────────────────────────────────────────────────
// Kept free of I/O so the unit tests can exercise every branch directly.

// The marker must be the LAST line of the canonical block: everything after it
// belongs to the repo. A base that lost the marker would silently swallow every
// consumer's tail, so this is a hard failure rather than a warning.
export const blockOf = (baseText) => {
  const lines = baseText.split('\n')
  const at = lines.findIndex((l) => l.trimEnd() === MARKER)
  if (at === -1) throw new Error(`snyk-policy/base.snyk has no "${MARKER}" marker`)
  // Enforced, not merely documented. findIndex takes the FIRST marker, so
  // anything below it — a canonical ignore added in the wrong place, or a
  // second marker — would be dropped from every rendered policy with no
  // error. For a security policy file the failure mode is a new ignore that
  // silently never ships, so fail loudly instead.
  const trailing = lines.slice(at + 1).filter((l) => l.trim())
  if (trailing.length) {
    throw new Error(
      `snyk-policy/base.snyk has content after the "${MARKER}" marker, which would be ` +
        `silently dropped from every consumer: ${JSON.stringify(trailing[0])}`,
    )
  }
  return lines.slice(0, at + 1).join('\n')
}

// A repo note is prose about THIS repo that belongs with the block rather than
// in the tail (e.g. "nanoid is also a direct dependency here"). It renders just
// above the marker so it reads as part of the canonical explanation.
export const renderBlock = (baseText, note) => {
  const block = blockOf(baseText)
  if (!note) return block
  const body = note
    .split('\n')
    .map((l) => `  # ${l}`.trimEnd())
    .join('\n')
  const lines = block.split('\n')
  lines.splice(lines.length - 1, 0, `  # ── Repo note ──`, body, '')
  return lines.join('\n')
}

// Steady-state split. Returns null when the marker is absent, which means the
// repo has never been converted and needs a migrate directive.
//
// Split on the character offset at the END of the marker line, not on a line
// slice: `head + tail === content` has to hold exactly. Rejoining line arrays
// loses the newline that separates them, which glues the first tail line onto
// the marker for any repo whose tail does not happen to start with a blank
// line. The tail therefore always carries its own leading newline.
export const splitAtMarker = (content) => {
  let offset = 0
  for (const raw of content.split('\n')) {
    if (raw.trimEnd() === MARKER) {
      // End the head at the marker TEXT and leave the line's own terminator at
      // the front of the tail. Splitting after the whole line instead would put
      // a CRLF file's `\r` in the head and only `\n` in the tail, so replacing
      // the head with our LF block would quietly downgrade that one separator
      // from `\r\n` to `\n` — a tail byte we promised not to touch.
      const end = offset + raw.length - (raw.endsWith('\r') ? 1 : 0)
      return { head: content.slice(0, end), tail: content.slice(end) }
    }
    offset += raw.length + 1 // + the '\n' that split() removed
  }
  return null
}

// Has this repo already received a fan-out? True only when the file carries
// BOTH the marker and the generated-header sentinel above it, which together
// mean the split is trustworthy and the tail is genuinely the repo's own.
// A file that predates the convention has neither, or has a marker in the
// wrong place under an old hand-written header.
export const isConverted = (content) => {
  const split = splitAtMarker(content)
  return Boolean(split && split.head.includes(SENTINEL))
}

// The single rule deciding which tail a repo's next policy file keeps.
//
// Exported and used by BOTH evaluate() and openPr(), so there is one
// implementation and the tests exercise the real one. A test that reimplements
// this branch verifies the copy, not the product: it would stay green if the
// caller reverted to migrating unconditionally, which is the exact regression
// worth guarding.
//
// Returns { mode, tail } where mode is:
//   'migrate' — one-time conversion, gated on an EXACT pre-migration blob SHA
//   'steady'  — normal path: keep everything below the marker, byte-for-byte
//   'create'  — no policy file yet and none expected; start from the block
//   'refuse'  — cannot be decided safely; caller reports and writes nothing
//
// The SHA gate is what makes a migration exactly-once. Deriving "has this been
// converted?" from mutable file content is not safe: a consumer that edits the
// canonical block (dropping the sentinel or the marker) would make a spent
// directive look live again, and a `tail: "none"` directive would then delete
// policy added since. `migrate.fromSha` is immutable — it names the one blob
// the directive was written against, so it can match at most until the first
// fan-out merges, and never again.
//
// When a directive is configured but the SHA does not match, we do NOT quietly
// fall back to the marker split. For reviewers and nswds-email the marker sits
// above their licence list, so the split would emit those 28 keys twice. An
// unrecognised shape is refused for a human to look at.
export const selectTail = ({ content, sha, settings }) => {
  const directive = settings.migrate

  // No policy file at all. Creating a canonical-only one is right for a repo
  // simply opting in, but WRONG for a migration target: its directive exists to
  // extract a tail from a file that is supposed to be there, so creating
  // without it silently drops the policy the directive was written to preserve.
  // A deleted file also defeats the fromSha gate — there is no blob to match.
  if (content == null) {
    if (directive && directive !== 'manual') {
      return {
        mode: 'refuse',
        reason:
          'has a migrate directive but no .snyk to migrate — the file was deleted or never existed. ' +
          'Restore it, or drop the directive if this repo should start from the canonical block alone.',
      }
    }
    return { mode: 'create', tail: '' }
  }

  const converted = isConverted(content)
  const split = splitAtMarker(content)

  if (directive && directive !== 'manual') {
    if (!directive.fromSha) {
      return {
        mode: 'refuse',
        reason: 'migrate directive has no fromSha; add the pre-migration blob SHA to snyk-policy/repos.json',
      }
    }
    if (sha === directive.fromSha) return { mode: 'migrate', tail: migrateTail(content, directive) }
    if (converted && split) return { mode: 'steady', tail: split.tail, spentDirective: true }
    return {
      mode: 'refuse',
      reason:
        `migrate directive is stale: it targets blob ${directive.fromSha.slice(0, 12)} but the file is ` +
        `${String(sha).slice(0, 12)}, and the file is not in canonical shape. Re-check the anchor and ` +
        'refresh fromSha, or convert this repo by hand.',
    }
  }

  if (split) return { mode: 'steady', tail: split.tail }
  return {
    mode: 'refuse',
    reason: `no "${MARKER}" marker and no migrate directive in snyk-policy/repos.json`,
  }
}

// One-time conversion for a file written before the convention existed.
export const migrateTail = (content, migrate) => {
  if (!migrate || migrate === 'manual') return null
  const spec = migrate.tail
  if (spec === 'none') return ''
  if (spec && typeof spec.from === 'string') {
    // Slice the ORIGINAL content from the terminator preceding the anchor
    // line. Rebuilding with split/join would re-emit every line ending as '\n'
    // and hard-code the leading separator, reformatting a CRLF tail we promised
    // to copy through untouched.
    let offset = 0
    for (const raw of content.split('\n')) {
      if (raw.includes(spec.from)) {
        let start = offset
        if (start > 0 && content[start - 1] === '\n') {
          start -= 1
          if (start > 0 && content[start - 1] === '\r') start -= 1
        }
        return content.slice(start)
      }
      offset += raw.length + 1
    }
    throw new Error(`migrate.tail.from not found: ${JSON.stringify(spec.from)}`)
  }
  throw new Error(`unrecognised migrate directive: ${JSON.stringify(migrate)}`)
}

// The tail is emitted byte-for-byte. The only bytes this function may add are
// (a) a separating newline when a tail does not start on its own line — both
// producers already guarantee it does, so this only guards a hand-written
// directive from corrupting the marker line — and (b) a single trailing
// newline when the result would otherwise lack one.
//
// It deliberately does NOT normalise trailing blank lines. Collapsing them
// would rewrite bytes the repo owns, which is exactly the guarantee the whole
// mechanism rests on; how a consumer ends its own file is its business.
export const compose = (block, tail) => {
  const sep = tail && !/^\r?\n/.test(tail) ? '\n' : ''
  const out = `${block}${sep}${tail}`
  return out.endsWith('\n') ? out : `${out}\n`
}

// Duplicate mapping keys in the composed file. YAML takes the LAST occurrence,
// so a key present in both the canonical block and a repo's tail means the
// tail silently shadows the fleet value — the same failure the misplaced-marker
// regression guards against, reachable by a different route: promoting an
// ignore out of one repo's tail into base.snyk without removing it there.
//
// Deliberately a structural scan rather than a YAML parse: a parser either
// keeps the last duplicate silently or throws on the first, and this has to
// report every collision by name. The shape is narrow — top-level keys at column 0 and
// ignore entries at two spaces, whose keys legitimately contain colons
// (snyk:lic:npm:...:MPL-2.0). Anything deeper is a value, not a key.
export const findDuplicateKeys = (content) => {
  const duplicates = []
  const seenTop = new Set()
  const seenIn = new Map()
  let section = null

  for (const raw of content.split('\n')) {
    // Drop a trailing comment outside quotes, so `  KEY: # note` is still a key.
    const line = raw.replace(/\s+#[^'"]*$/, '').replace(/\s+$/, '')
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    const top = line.match(/^([A-Za-z_][\w.-]*):/)
    if (top) {
      section = top[1]
      if (seenTop.has(section)) duplicates.push(section)
      else seenTop.add(section)
      continue
    }

    // Two-space indent, ending in a colon: an ignore key. Take everything
    // before the FINAL colon so licence ids survive intact.
    const entry = line.match(/^ {2}(\S.*):$/)
    if (entry && section) {
      const key = entry[1].replace(/^['"]|['"]$/g, '')
      if (!seenIn.has(section)) seenIn.set(section, new Set())
      const seen = seenIn.get(section)
      if (seen.has(key)) duplicates.push(`${section}.${key}`)
      else seen.add(key)
    }
  }
  return duplicates
}

// Vulnerability acceptances that are wider or longer-lived than base.snyk's
// rules allow (snyk-policy/README.md, "Rules that are load-bearing"). Returns
// one message per problem; an empty array means the policy is acceptable.
//
// - Every scope must name the vulnerable package as its LAST segment. For npm
//   advisories (SNYK-JS-<PKG>-n, or legacy npm:<pkg>:<date>) that must be the
//   package the id names. A scope containing '*' must also name a parent; a
//   fully explicit path ('gray-matter', '@maizzle/framework > gray-matter')
//   is already narrow. '*', '* > pkg' or a path that stops at a parent
//   accepts the advisory on every route below it.
// - Every scope must expire, as a real ISO 8601 date (a time needs Z or an
//   offset), no further ahead than `maxDays`. A date already in the past is
//   NOT flagged: Snyk stops honouring it by itself, and flagging it would fail
//   the suite on the calendar alone.
// - Licence keys (snyk:lic:…) legitimately use '*' and are not scope-checked.
//
// The policy is PARSED (js-yaml, the parser family Snyk itself uses), so
// quoting, comments, block scalars and indentation mean exactly what they
// mean to Snyk. Parsing would silently resolve YAML anchors, aliases, merge
// keys and tags, though, so those are refused by a text pass first: no
// legitimate policy needs them, and an alias can smuggle a '*' into a scope.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/
const npmPackageOf = (id) => (id.match(/^SNYK-JS-(.+)-\d+$/i) || id.match(/^npm:(.+):\d+$/i))?.[1]
// Drop a trailing @version, keep any @scope/, and compare alphanumerics only:
// Snyk keeps the scope in its ids (@babel/traverse -> BABELTRAVERSE).
const normalisePackage = (name) => name.replace(/(.)@[^@/]*$/, '$1').replace(/[^A-Za-z0-9]/g, '').toUpperCase()

const readExpiry = (raw) => {
  const text = raw instanceof Date ? raw.toISOString() : String(raw ?? '')
  const m = text.match(ISO_DATE)
  if (!m) return null
  // Reject impossible calendar dates (2099-13-45) rather than letting them roll over.
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const day = new Date(Date.UTC(y, mo - 1, d))
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null
  const when = new Date(text)
  return Number.isNaN(when.getTime()) ? null : when
}

// YAML features that parsing would resolve silently. Checked on the text
// outside quoted scalars and comments.
const findYamlIndirection = (content) => {
  const problems = []
  content.split(/\r?\n/).forEach((raw, i) => {
    let quote = null
    let bare = ''
    for (let j = 0; j < raw.length; j++) {
      const c = raw[j]
      if (quote === '"') {
        if (c === '\\') j++
        else if (c === '"') quote = null
      } else if (quote === "'") {
        if (c === "'" && raw[j + 1] === "'") j++
        else if (c === "'") quote = null
      } else if (c === '#' && (j === 0 || /\s/.test(raw[j - 1]))) {
        break
      } else if ((c === '"' || c === "'") && (j === 0 || /[\s:,[{-]/.test(raw[j - 1]))) {
        quote = c
        bare += ' '
      } else {
        bare += c
      }
    }
    if (/(^|[\s,[{:-])[&*!][^\s,\]}]/.test(bare) || /(^|\s)<<\s*:/.test(bare)) {
      problems.push(`line ${i + 1}: anchors, aliases, merge keys and tags are not allowed: ${raw.trim()}`)
    }
  })
  return problems
}

export const findLooseAcceptances = (content, { now = new Date(), maxDays = 550 } = {}) => {
  const problems = findYamlIndirection(content)
  const limit = now.getTime() + maxDays * 24 * 60 * 60 * 1000

  let doc
  try {
    // CORE_SCHEMA keeps timestamps as the strings written, so an impossible
    // date is checked as written instead of being rolled over to a real one.
    doc = yaml.load(content, { schema: yaml.CORE_SCHEMA })
  } catch (err) {
    return [...problems, `not valid YAML: ${err.reason ?? err.message}`]
  }
  if (!doc || typeof doc !== 'object' || !('ignore' in doc)) return [...problems, 'no ignore section found']
  if (!doc.ignore || typeof doc.ignore !== 'object' || Array.isArray(doc.ignore)) {
    return [...problems, 'ignore must be a mapping of issue ids']
  }

  for (const [id, rules] of Object.entries(doc.ignore)) {
    if (!Array.isArray(rules) || !rules.length) {
      problems.push(`${id}: must be a non-empty list of scopes`)
      continue
    }
    if (/^snyk:lic:/i.test(id)) continue
    const pkg = npmPackageOf(id)
    if (/^(SNYK-JS-|npm:)/i.test(id) && !pkg) problems.push(`${id}: cannot read the package from this id`)

    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        problems.push(`${id}: each list item must map a scope to its properties`)
        continue
      }
      for (const [path, props] of Object.entries(rule)) {
        const segments = path.split('>').map((x) => x.trim())
        const named = segments.filter((x) => x && x !== '*')
        const wildcard = named.length !== segments.length
        if (segments.at(-1) === '*' || !named.length || (wildcard && named.length < 2)) {
          problems.push(`${id}: scope '${path}' must name the package and at least one parent`)
        } else if (pkg && normalisePackage(segments.at(-1)) !== normalisePackage(pkg)) {
          problems.push(`${id}: scope '${path}' must end in the package the advisory names`)
        }
        const raw = props && typeof props === 'object' ? props.expires : undefined
        if (raw === undefined || raw === null) {
          problems.push(`${id}: scope '${path}' has no expiry`)
          continue
        }
        const when = readExpiry(raw)
        if (!when) problems.push(`${id}: expiry '${raw}' is not a valid ISO 8601 date`)
        else if (when.getTime() > limit) problems.push(`${id}: scope '${path}' expires more than ${maxDays} days ahead`)
      }
    }
  }
  return problems
}

// Which bytes may be written to an existing sync branch, given what the branch
// renders to and what the default branch renders to.
//
// A pure helper rather than an inline comparison so the safety rule is
// exercised by the suite: an inverted or deleted `===` inside openPr() would
// otherwise leave every test green while one side's repo-owned policy is
// discarded.
//
// Divergence means both tails are real and neither is safely discardable — the
// branch may carry a reviewer's edit, while the default branch may have gained
// policy from another PR merged while this one sat open. Picking a side
// silently deletes the other, so this refuses and leaves it to a human.
export const reconcileBranch = ({ fromDefault, fromBranch }) => {
  if (fromBranch === fromDefault) return { mode: 'write', content: fromBranch }
  return {
    mode: 'refuse',
    reason:
      "the sync branch's tail has diverged from the default branch's. Refusing to write, because " +
      "either side would delete the other's policy. Reconcile the branch (update it from the " +
      'default branch, or merge/close the open PR) and re-run.',
  }
}

// ── GitHub ─────────────────────────────────────────────────────────────────

const token = process.env.GH_TOKEN

const api = async (path, { method = 'GET', body, allow404 = false } = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'nswds-devops-snyk-policy',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (res.status === 404 && allow404) return null
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

const getPolicy = async (repo, ref) => {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const file = await api(`/repos/${ORG}/${repo}/contents/${POLICY_PATH}${q}`, { allow404: true })
  if (file) return { sha: file.sha, content: Buffer.from(file.content, 'base64').toString('utf8') }

  // A missing file and an unreachable repository return the same 404 here.
  // Treating both as "no policy yet" turns a renamed or deleted repo — or one
  // outside the App installation — into a cheerful "create it", which is
  // exactly the read failure --check is supposed to surface. Confirm the repo
  // is readable before believing the absence.
  const exists = await api(`/repos/${ORG}/${repo}`, { allow404: true })
  if (!exists) {
    throw new Error(
      `repository ${ORG}/${repo} is not readable — renamed, deleted, or outside the sync App installation`,
    )
  }
  return null
}

// ── Per-repo evaluation ────────────────────────────────────────────────────

const evaluate = async (repo, settings) => {
  const wanted = renderBlock(base, settings.note)
  const current = await getPolicy(repo)

  // Manual means "never rewrite this repo", not "stop looking at it". The
  // existence check still applies: a deleted .snyk on a manual repo is a real
  // policy gap, and reporting it as a plain exclusion would hide it forever.
  if (settings.migrate === 'manual') {
    const why = settings.$why ?? 'excluded from automated conversion'
    return current
      ? { repo, state: 'manual', reason: why }
      : { repo, state: 'manual', reason: `POLICY FILE IS MISSING — ${why}`, missing: true }
  }

  // Absent policy — selectTail() decides whether that is an opt-in or a gap.
  if (!current) {
    const choice = selectTail({ content: null, sha: null, settings })
    if (choice.mode === 'refuse') return { repo, state: 'unmigrated', reason: choice.reason }
    return { repo, state: 'create', next: compose(wanted, choice.tail), sha: null, settings }
  }

  // One rule, shared with openPr(). See selectTail() for why the migration gate
  // is an immutable blob SHA rather than anything read out of the file.
  const choice = selectTail({ content: current.content, sha: current.sha, settings })
  if (choice.mode === 'refuse') {
    return { repo, state: 'unmigrated', reason: choice.reason }
  }

  const next = compose(wanted, choice.tail)
  const duplicates = findDuplicateKeys(next)
  if (duplicates.length) {
    return {
      repo,
      state: 'unmigrated',
      reason:
        `composing would produce duplicate keys, so the tail would silently shadow the canonical ` +
        `value: ${duplicates.join(', ')}. Remove them from this repo's tail, or from base.snyk.`,
    }
  }

  const spentDirective = Boolean(choice.spentDirective)
  if (next === current.content) return { repo, state: 'ok', spentDirective }
  return {
    repo,
    state: choice.mode === 'migrate' ? 'migrate' : 'drift',
    next,
    sha: current.sha,
    before: current.content,
    settings,
    spentDirective,
  }
}

// ── Applying ───────────────────────────────────────────────────────────────

const ensureBranch = async (repo) => {
  const existing = await api(`/repos/${ORG}/${repo}/git/ref/heads/${BRANCH}`, { allow404: true })
  if (existing) return
  const { default_branch: def } = await api(`/repos/${ORG}/${repo}`)
  const head = await api(`/repos/${ORG}/${repo}/git/ref/heads/${def}`)
  await api(`/repos/${ORG}/${repo}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${BRANCH}`, sha: head.object.sha },
  })
}

const PR_BODY = [
  'Regenerates the canonical Snyk policy block from',
  '[`snyk-policy/base.snyk`](https://github.com/digitalnsw/nswds-devops/blob/main/snyk-policy/base.snyk)',
  'in nswds-devops.',
  '',
  'Everything below the `# repo-specific` marker is this repo\'s own policy and',
  'is copied through byte-for-byte — the sync never parses, reorders or',
  'reformats it. The only byte it may add is a trailing newline when the file',
  'would otherwise not end in one.',
  '',
  'Opened by `.github/workflows/snyk-policy-sync.yml`. Edit the base in',
  'nswds-devops, not here: a local edit to the block is overwritten on the next',
  'fan-out and reported by the weekly canary.',
].join('\n')

const openPr = async (repo, result) => {
  await ensureBranch(repo)
  // Re-read on the branch — for its sha, but more importantly for its BYTES.
  //
  // result.next was rendered from the DEFAULT branch. Writing it here would
  // overwrite whatever the sync branch actually holds, and the branch is
  // exactly where a repo's tail is most likely to have moved: a reviewer who
  // amends their own repo-specific policy on this PR would have it silently
  // reverted by the next fan-out. So re-derive the tail from the branch and
  // render against that; the branch is the file we are about to update.
  // The default branch may have moved since evaluate() read it: every repo is
  // evaluated before any PR is opened, so there is a real window. A sync branch
  // that still matches the stale snapshot would sail through reconcileBranch()
  // and its PR would delete whatever landed on the default branch meanwhile.
  const fresh = await getPolicy(repo)
  if ((fresh?.sha ?? null) !== (result.sha ?? null)) {
    throw new Error(
      `${POLICY_PATH} changed on the default branch since this run evaluated it ` +
        `(${String(result.sha).slice(0, 12)} -> ${String(fresh?.sha).slice(0, 12)}). ` +
        'Re-run so the render is based on current content.',
    )
  }

  const onBranch = await getPolicy(repo, BRANCH)

  let next = result.next
  if (onBranch && result.settings) {
    const choice = selectTail({
      content: onBranch.content,
      sha: onBranch.sha,
      settings: result.settings,
    })
    if (choice.mode === 'refuse') {
      throw new Error(`branch ${BRANCH} holds an unrecognised policy: ${choice.reason}`)
    }
    next = compose(renderBlock(base, result.settings.note), choice.tail)
    const duplicates = findDuplicateKeys(next)
    if (duplicates.length) {
      throw new Error(
        `branch ${BRANCH} would compose to duplicate keys (${duplicates.join(', ')}); refusing to write`,
      )
    }
    const reconciled = reconcileBranch({ fromDefault: result.next, fromBranch: next })
    if (reconciled.mode === 'refuse') throw new Error(reconciled.reason)
    next = reconciled.content
  }

  if (onBranch && onBranch.content === next) {
    console.log(`  ${repo}: branch already carries the change`)
  } else {
    await api(`/repos/${ORG}/${repo}/contents/${POLICY_PATH}`, {
      method: 'PUT',
      body: {
        message: 'chore(ci): sync canonical Snyk policy block from nswds-devops',
        content: Buffer.from(next, 'utf8').toString('base64'),
        branch: BRANCH,
        ...(onBranch ? { sha: onBranch.sha } : {}),
      },
    })
  }

  const open = await api(
    `/repos/${ORG}/${repo}/pulls?state=open&head=${encodeURIComponent(`${ORG}:${BRANCH}`)}`,
  )
  if (open.length) return open[0].html_url

  const { default_branch: def } = await api(`/repos/${ORG}/${repo}`)
  const pr = await api(`/repos/${ORG}/${repo}/pulls`, {
    method: 'POST',
    body: {
      title: 'chore(ci): sync canonical Snyk policy block from nswds-devops',
      head: BRANCH,
      base: def,
      body: PR_BODY,
    },
  })
  return pr.html_url
}

// ── Main ───────────────────────────────────────────────────────────────────

const main = async () => {
  // Checked here rather than at import time so the unit tests can pull the
  // pure renderers in without a token. Required in every mode: --dry-run
  // suppresses writes, but evaluating drift still reads each consumer's .snyk,
  // and a tokenless run would send `Bearer undefined` and report 401s as
  // per-repo errors instead of a usable preview.
  if (!token) {
    console.error('::error::GH_TOKEN is required (--dry-run still reads the API)')
    process.exit(1)
  }

  // Validate the BASE once, rather than only catching duplicates per consumer.
  // The create path composes an empty tail and would otherwise hand a newly
  // opted-in repo an ambiguous policy while every existing consumer was
  // refused — a split-brain fleet from one bad edit here.
  const baseDuplicates = findDuplicateKeys(blockOf(base))
  if (baseDuplicates.length) {
    console.error(
      `::error::snyk-policy/base.snyk declares duplicate keys, so the later one silently wins: ${baseDuplicates.join(', ')}`,
    )
    process.exit(1)
  }

  // Refuse to fan out an over-broad or never-expiring acceptance. The unit
  // suite checks the same thing, but snyk-policy-sync.yml can also be run by
  // hand from an unmerged branch, which skips CI. That branch runs its own copy
  // of this script, so this catches a bad base, not a branch that also edits
  // the check away.
  const loose = findLooseAcceptances(blockOf(base))
  if (loose.length) {
    console.error(`::error::snyk-policy/base.snyk has acceptances that are too broad or too long-lived: ${loose.join('; ')}`)
    process.exit(1)
  }

  const entries = Object.entries(config.repos).filter(([r]) => !ONLY || r === ONLY)
  if (!entries.length) {
    console.error(`::error::no repo matched --repo ${ONLY}`)
    process.exit(1)
  }

  const results = []
  for (const [repo, settings] of entries) {
    try {
      results.push(await evaluate(repo, settings))
    } catch (err) {
      results.push({ repo, state: 'error', reason: err.message })
    }
  }

  const by = (s) => results.filter((r) => r.state === s)
  const actionable = [...by('drift'), ...by('migrate'), ...by('create')]
  // `manual` is non-actionable but IS reported: repos.json promises manual
  // repos stay visible, and once the automated migrations land dtl-sandbox is
  // the only entry left — excluding it would make `drifted` false and silence
  // the weekly canary on the one repo still waiting for a human.
  const attention = [...by('unmigrated'), ...by('error'), ...by('manual')]

  for (const r of results) {
    const label = { ok: '✅', drift: '🔁', migrate: '🚚', create: '➕', manual: '✋', unmigrated: '⚠️', error: '❌' }[r.state]
    console.log(`${label} ${r.repo}: ${r.state}${r.reason ? ` — ${r.reason}` : ''}`)
    if (r.spentDirective) {
      console.log(
        `   ℹ️  ${r.repo} is already converted, so its migrate directive is now inert — delete it from snyk-policy/repos.json`,
      )
    }
  }

  // The PRs this run opened or refreshed, in the order they were processed.
  // Emitted so the workflow's auto-merge step can arm exactly these, rather
  // than discovering them by search — which lags PR creation by seconds and,
  // unlike the file-sync fan-out, these carry no label to search on.
  const openedUrls = []
  if (MODE === 'apply' && actionable.length && !DRY_RUN) {
    console.log('\nOpening PRs:')
    for (const r of actionable) {
      try {
        const url = await openPr(r.repo, r)
        openedUrls.push(url)
        console.log(`  ${r.repo}: ${url}`)
      } catch (err) {
        r.state = 'error'
        r.reason = err.message
        console.log(`  ❌ ${r.repo}: ${err.message}`)
      }
    }
  }

  const drifted = actionable.length + attention.length > 0
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `drifted=${drifted}\n`)
    // A JSON array, matching repo-file-sync-action's `pull_request_urls`
    // output that sync.yml already feeds to enable-sync-automerge.sh — so the
    // auto-merge step consumes it identically. Empty ([]) on check, dry-run,
    // or a run that opened nothing, which the step treats as "nothing to arm".
    appendFileSync(process.env.GITHUB_OUTPUT, `pull_request_urls=${JSON.stringify(openedUrls)}\n`)
    const body = join(tmpdir(), 'snyk-policy-report.md')
    writeFileSync(
      body,
      [
        'The canonical Snyk policy in `snyk-policy/base.snyk` does not match the fleet.',
        '',
        ...actionable.map((r) => `- \`${r.repo}\` — **${r.state}**: the canonical block differs from the base.`),
        ...attention.map((r) => `- \`${r.repo}\` — **${r.state}**: ${r.reason}`),
        '',
        'Run the **Sync Snyk policy** workflow to open the PRs, or fix the base.',
      ].join('\n'),
    )
    appendFileSync(process.env.GITHUB_OUTPUT, `body_file=${body}\n`)
  }

  console.log(
    `\n${by('ok').length} in sync · ${actionable.length} to change · ` +
      `${attention.length} need attention (of which ${by('manual').length} manual)`,
  )
  // A canary that fails is a canary that gets muted: drift is reported through
  // the tracking issue, not the exit code. Only a real error fails the job.
  if (by('error').length) process.exit(1)
}

// Importable for the unit tests without firing the network.
if (!process.env.SNYK_POLICY_LIB) await main()
