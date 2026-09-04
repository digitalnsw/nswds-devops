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

const MARKER = '  # repo-specific'
const BRANCH = 'chore/repo-sync/snyk-policy'
const POLICY_PATH = '.snyk'

// Emitted only by this script, so its presence in a consumer's file proves the
// file was produced by a fan-out rather than written before the convention.
// That is what lets a one-time `migrate` directive disarm itself — see
// isConverted() and the directive handling in evaluate().
const SENTINEL = 'Canonical base (generated from nswds-devops'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valueOf = (f) => {
  const i = args.indexOf(f)
  return i === -1 ? null : args[i + 1]
}

const MODE = has('--apply') ? 'apply' : 'check'
const DRY_RUN = has('--dry-run')
const ONLY = valueOf('--repo')

const base = readFileSync(new URL('../../snyk-policy/base.snyk', import.meta.url), 'utf8')

// The sentinel is what isConverted() keys on, so it is load-bearing for the
// self-disarming migrate directives: if it were ever edited out of the base,
// every converted repo would read as unconverted and every lingering directive
// would re-arm at once, deleting policy across the fleet. Fail at startup.
if (!base.includes(SENTINEL)) {
  throw new Error(
    `snyk-policy/base.snyk must contain the sentinel ${JSON.stringify(SENTINEL)} — ` +
      'converted-state detection, and therefore migrate-directive disarming, depends on it',
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
  const lines = content.split('\n')
  const at = lines.findIndex((l) => l.trimEnd() === MARKER)
  if (at === -1) return null
  const offset = lines.slice(0, at + 1).join('\n').length
  return { head: content.slice(0, offset), tail: content.slice(offset) }
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

// One-time conversion for a file written before the convention existed.
export const migrateTail = (content, migrate) => {
  if (!migrate || migrate === 'manual') return null
  const spec = migrate.tail
  if (spec === 'none') return ''
  if (spec && typeof spec.from === 'string') {
    const lines = content.split('\n')
    const at = lines.findIndex((l) => l.includes(spec.from))
    if (at === -1) throw new Error(`migrate.tail.from not found: ${JSON.stringify(spec.from)}`)
    return '\n' + lines.slice(at).join('\n')
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
  const sep = tail && !tail.startsWith('\n') ? '\n' : ''
  const out = `${block}${sep}${tail}`
  return out.endsWith('\n') ? out : `${out}\n`
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
  if (!file) return null
  return { sha: file.sha, content: Buffer.from(file.content, 'base64').toString('utf8') }
}

// ── Per-repo evaluation ────────────────────────────────────────────────────

const evaluate = async (repo, settings) => {
  const wanted = renderBlock(base, settings.note)
  const current = await getPolicy(repo)

  if (settings.migrate === 'manual') {
    return { repo, state: 'manual', reason: settings.$why ?? 'excluded from automated conversion' }
  }

  // Absent policy: the repo opts in by appearing in repos.json, so create it.
  if (!current) {
    return { repo, state: 'create', next: compose(wanted, ''), sha: null }
  }

  // A migrate directive wins over the marker ONLY while the repo is still
  // unconverted. Two failure modes have to be avoided at once:
  //
  //   Trusting the marker too early — reviewers and nswds-email carry it above
  //   their licence list, which the base now owns, so the split would emit
  //   those 28 keys twice: a duplicate-key file whose tail silently shadows
  //   the canonical block.
  //
  //   Trusting the directive too long — once a repo has been converted its
  //   marker is correct and its tail is genuinely its own. Re-running a
  //   `tail: "none"` directive then DELETES any policy added since the first
  //   fan-out, which is the exact loss this mechanism exists to prevent.
  //
  // isConverted() settles it from the file itself, so the directive disarms
  // automatically and a forgotten entry in repos.json cannot destroy policy.
  const split = splitAtMarker(current.content)
  const converted = isConverted(current.content)
  let tail
  if (settings.migrate && !converted) {
    tail = migrateTail(current.content, settings.migrate)
  } else if (split) {
    tail = split.tail
  } else {
    return {
      repo,
      state: 'unmigrated',
      reason: `no "${MARKER}" marker and no migrate directive in snyk-policy/repos.json`,
    }
  }

  // Nudge rather than fail: a spent directive is now harmless, but leaving it
  // in repos.json makes the config lie about the repo's state.
  const spentDirective = Boolean(settings.migrate && settings.migrate !== 'manual' && converted)

  const next = compose(wanted, tail)
  if (next === current.content) return { repo, state: 'ok', spentDirective }
  return {
    repo,
    state: settings.migrate && !converted ? 'migrate' : 'drift',
    next,
    sha: current.sha,
    before: current.content,
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
  // Re-read on the branch: a previous run may already have written the file
  // there, in which case the default-branch sha would be rejected as stale.
  const onBranch = await getPolicy(repo, BRANCH)
  if (onBranch && onBranch.content === result.next) {
    console.log(`  ${repo}: branch already carries the change`)
  } else {
    await api(`/repos/${ORG}/${repo}/contents/${POLICY_PATH}`, {
      method: 'PUT',
      body: {
        message: 'chore(ci): sync canonical Snyk policy block from nswds-devops',
        content: Buffer.from(result.next, 'utf8').toString('base64'),
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
  const attention = [...by('unmigrated'), ...by('error')]

  for (const r of results) {
    const label = { ok: '✅', drift: '🔁', migrate: '🚚', create: '➕', manual: '✋', unmigrated: '⚠️', error: '❌' }[r.state]
    console.log(`${label} ${r.repo}: ${r.state}${r.reason ? ` — ${r.reason}` : ''}`)
    if (r.spentDirective) {
      console.log(
        `   ℹ️  ${r.repo} is already converted, so its migrate directive is now inert — delete it from snyk-policy/repos.json`,
      )
    }
  }

  if (MODE === 'apply' && actionable.length && !DRY_RUN) {
    console.log('\nOpening PRs:')
    for (const r of actionable) {
      try {
        const url = await openPr(r.repo, r)
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
      `${by('manual').length} manual · ${attention.length} need attention`,
  )
  // A canary that fails is a canary that gets muted: drift is reported through
  // the tracking issue, not the exit code. Only a real error fails the job.
  if (by('error').length) process.exit(1)
}

// Importable for the unit tests without firing the network.
if (!process.env.SNYK_POLICY_LIB) await main()
